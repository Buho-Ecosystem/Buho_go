/**
 * Chat runtime tests.
 *
 * Real: the messages store (Pinia, in-memory encrypted storage), the inbox,
 * the request service, the key holder, the gift wrap crypto and the protocol.
 * Fake: the relay transport (scripted, records every publish and lets a test
 * push wraps in), the inbox relay resolver (a table), wallets (a Spark
 * provider with the real method shapes), the notification poster and a manual
 * clock with manual timers.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/runtime.spec.js
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { generateSecretKey, getPublicKey } from 'nostr-core';
import { createPinia, setActivePinia } from 'pinia';
import { configureMessages, resetMessagesConfig, useMessagesStore } from '../../../stores/messages.js';
import { createDmStorage, createMemoryBackend } from '../../../utils/dmStorage.js';
import { stableNotificationId } from '../../paymentNotifications.js';
import { DM_INBOX_RELAYS } from '../constants.js';
import { DM_ERROR, DmError } from '../errors.js';
import { sealAndWrap } from '../giftWrap.js';
import {
  CHAT_ACTIONS,
  REACHABILITY,
  contactChatRoute,
  createChatRuntime,
  createInboxStoreAdapter,
  unknownChatRoute,
} from '../runtime.js';
import {
  buildReactionTemplate,
  buildRequestTemplate,
  buildStatusTemplate,
  buildTextTemplate,
  parseRumor,
} from '../protocol.js';
import { NOW, makeInvoice } from './invoiceFixture.js';

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const meKey = generateSecretKey();
const ME = getPublicKey(meKey);
const aliceKey = generateSecretKey();
const ALICE = getPublicKey(aliceKey);
const bobKey = generateSecretKey();
const BOB = getPublicKey(bobKey);
const OTHER_ME = getPublicKey(generateSecretKey());

const ALICE_RELAYS = ['wss://alice.one.example', 'wss://alice.two.example'];
const PROFILE_ADDRESS = 'me@buho.example';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createClock() {
  const clock = { ms: NOW * 1_000, seq: 0, timers: new Map() };
  clock.now = () => clock.ms;
  clock.setTimer = (fn, delay) => {
    clock.seq += 1;
    clock.timers.set(clock.seq, { fn, at: clock.ms + delay });
    return clock.seq;
  };
  clock.clearTimer = (handle) => clock.timers.delete(handle);
  clock.advance = async (ms) => {
    const target = clock.ms + ms;
    await flush();
    for (;;) {
      const due = [...clock.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock.timers.delete(due[0]);
      clock.ms = Math.max(clock.ms, due[1].at);
      due[1].fn();
      await flush();
    }
    clock.ms = target;
    await flush();
  };
  return clock;
}

/** A transport that records publishes and lets the test push wraps into the subscription. */
function createFakeTransport() {
  const t = {
    published: [],
    subscriptions: [],
    closed: 0,
    identityResets: 0,
    failPublishes: false,
    warmUp: async () => {},
    subscribe(relays, filter, handlers) {
      const sub = { relays, filter, handlers, closed: false };
      t.subscriptions.push(sub);
      return { close: () => { sub.closed = true; } };
    },
    publish(relays, event) {
      t.published.push({ relays, event });
      const results = relays.map((relay) => (t.failPublishes
        ? { relay, ok: false, prefix: null, message: 'down', code: DM_ERROR.RELAY_UNAVAILABLE, attempts: 1 }
        : { relay, ok: true, prefix: null, message: '', code: null, attempts: 1 }));
      const first = results.find((r) => r.ok) ?? null;
      return { firstAccept: Promise.resolve(first), allSettled: Promise.resolve(results) };
    },
    status: () => [],
    resetIdentity() { t.identityResets += 1; },
    close() { t.closed += 1; },
    /** Deliver a wrap to the live subscription, as a relay that already sent its stored events. */
    async deliver(event) {
      const sub = t.subscriptions[t.subscriptions.length - 1];
      const relay = sub.relays[0];
      sub.handlers.oneose(relay);
      sub.handlers.onevent(event, relay);
      await flush();
    },
  };
  return t;
}

/** Resolver table: pubkey -> result. Unknown pubkeys are `unknown`. */
function createFakeResolver(table) {
  const resolver = {
    table,
    calls: [],
    resolve: async (pubkey, options = {}) => {
      resolver.calls.push({ pubkey, options });
      return table.get(pubkey) ?? { status: 'unknown', relays: [], checkedAt: 0 };
    },
    invalidate() {},
    snapshot: () => ({ version: 1, entries: {} }),
    hydrate: () => 0,
  };
  return resolver;
}

const PREIMAGE = 'ab'.repeat(32);

/** A Spark provider with the real method shapes. */
function createFakeSpark(invoice) {
  const spark = {
    isConnected: true,
    created: [],
    listeners: new Set(),
    ledger: new Map(),
    async createInvoice(params) {
      spark.created.push(params);
      return { paymentRequest: invoice.bolt11, paymentHash: invoice.paymentHash };
    },
    async lookupInvoice(hash) {
      const hit = spark.ledger.get(hash);
      return hit ? { paid: true, preimage: hit } : { paid: false, preimage: null };
    },
    onPaymentReceived(callback) {
      spark.listeners.add(callback);
      return () => spark.listeners.delete(callback);
    },
    pay(hash, preimage = PREIMAGE) {
      spark.ledger.set(hash, preimage);
      const payment = { id: 'p1', timestamp: NOW + 5, details: { type: 'lightning', htlcDetails: { paymentHash: hash, preimage } } };
      for (const listener of [...spark.listeners]) listener('p1', 0, payment);
    },
  };
  return spark;
}

const noLnurl = {
  fetchPayRequest: async () => { throw new Error('unexpected lnurl'); },
  requestInvoice: async () => { throw new Error('unexpected lnurl'); },
  verifyPayment: async () => { throw new Error('unexpected lnurl'); },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let backend;
let clock;

beforeEach(() => {
  backend = createMemoryBackend();
  clock = createClock();
  resetMessagesConfig();
  configureMessages({
    storage: createDmStorage({
      backend,
      cipher: { encrypt: async (s) => `e:${s}`, decrypt: async (s) => s.slice(2) },
      warn: () => {},
    }),
    now: () => Math.floor(clock.ms / 1000),
    nowMs: () => clock.ms,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isKnownContact: (pubkey) => pubkey === ALICE,
    warn: () => {},
  });
});

async function setup({
  invoice = makeInvoice({ sats: 12_000 }),
  partners = new Map([[ALICE, { status: 'found', relays: ALICE_RELAYS, checkedAt: 0 }]]),
  locked = false,
  hidden = false,
  profileAddress = PROFILE_ADDRESS,
  notifyResult = true,
  notifyThrows = false,
} = {}) {
  setActivePinia(createPinia());
  const store = useMessagesStore();
  await store.setScope(ME);

  const env = {
    store,
    locked,
    hidden,
    transport: createFakeTransport(),
    resolver: createFakeResolver(partners),
    spark: createFakeSpark(invoice),
    invoice,
    keyLoads: 0,
    notifications: [],
    links: [],
    connectCalls: [],
    contactsById: new Map([[ALICE, { id: 'contact-alice', name: 'Alice' }]]),
    profileAddress,
  };
  const wallets = [{ id: 'w1', type: 'spark', accountNumber: 1, lightningAddress: PROFILE_ADDRESS }];
  env.wallets = wallets;

  env.runtime = createChatRuntime({
    me: ME,
    loadSecretKey: async () => {
      env.keyLoads += 1;
      return Uint8Array.from(meKey);
    },
    isLocked: () => env.locked,
    store,
    wallets: {
      list: () => env.wallets,
      getProvider: (id) => (id === 'w1' ? env.spark : null),
      ensureConnected: async (id) => {
        env.connectCalls.push(id);
        return env.spark;
      },
    },
    getProfileAddress: () => env.profileAddress,
    lnurl: noLnurl,
    contacts: { find: (pubkey) => env.contactsById.get(pubkey) ?? null },
    notifications: {
      message: async (payload) => {
        env.notifications.push(payload);
        if (notifyThrows) throw new Error('plugin down');
        return notifyResult;
      },
    },
    formatNotification: (message) => `body:${message.type}`,
    channelName: 'Messages',
    isHidden: () => env.hidden,
    linkPayment: async (link) => { env.links.push(link); },
    ensureRelay: async () => { throw new Error('the resolver is faked'); },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    factories: {
      createTransport: () => env.transport,
      createResolver: () => env.resolver,
    },
    inboxOptions: { random: () => 0.5 },
  });
  return env;
}

/** Open every wrap published for `secretKey`'s owner and return the parsed messages. */
async function publishedMessages(env, secretKey, pubkey) {
  const { openGiftWrap } = await import('../openWrap.js');
  const out = [];
  for (const { event } of env.transport.published) {
    if (!event.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey)) continue;
    const opened = openGiftWrap(event, secretKey, { me: pubkey });
    if (opened.ok) out.push(parseRumor(opened.rumor, { me: pubkey }));
  }
  return out;
}

/** A wrap from `senderKey` to ME carrying `template`. */
function wrapFor(senderKey, template) {
  return sealAndWrap({ template, senderSecretKey: senderKey, recipients: [ME], selfCopy: false }).wraps[0].event;
}

const textFrom = (senderKey, text) => wrapFor(senderKey, buildTextTemplate({ recipient: ME, text }));

// ---------------------------------------------------------------------------
// Store adapter
// ---------------------------------------------------------------------------

test('the store adapter maps the inbox port and answers true from ingest only for new messages', async () => {
  setActivePinia(createPinia());
  const store = useMessagesStore();
  await store.setScope(ME);
  const port = createInboxStoreAdapter(store, ME);

  const rumor = { id: 'a'.repeat(64), kind: 14, type: 'text', sender: ALICE, recipient: ME, partner: ALICE,
    outgoing: false, createdAt: 100, text: 'hi', replyTo: null, request: null, status: null, payment: null,
    reaction: null, degraded: false };
  assert.equal(port.hasMessage(rumor.id), false);
  assert.equal(port.ingest(rumor, { live: true }), true);
  assert.equal(port.ingest(rumor, { live: true }), false, 'a duplicate is not new');
  assert.equal(port.hasMessage(rumor.id), true);

  assert.equal(port.getSyncCursor(), null);
  port.setSyncCursor(500);
  assert.equal(port.getSyncCursor(), 500);

  port.outbox.put({ id: 'b'.repeat(64), partner: ALICE, attempts: 0 });
  const [listed] = port.outbox.list();
  listed.attempts = 9; // an edit of the copy ...
  assert.equal(store.outbox[0].attempts, 0, '... does not reach the store');
  port.outbox.put(listed);
  assert.equal(store.outbox[0].attempts, 9);
  port.outbox.remove(listed.id);
  assert.deepEqual(port.outbox.list(), []);

  port.setInboxRelaySnapshot({ version: 1, entries: {} });
  assert.deepEqual(port.getInboxRelaySnapshot(), { version: 1, entries: {} });
  store.block(BOB);
  assert.equal(port.isBlocked(BOB), true);
});

test('the store adapter is inert while the store belongs to another identity', async () => {
  setActivePinia(createPinia());
  const store = useMessagesStore();
  await store.setScope(ME);
  const port = createInboxStoreAdapter(store, ME);
  await store.setScope(OTHER_ME);

  port.setSyncCursor(900);
  port.outbox.put({ id: 'c'.repeat(64), partner: ALICE });
  port.setInboxRelaySnapshot({ version: 1 });
  assert.equal(store.syncCursor, null);
  assert.deepEqual(store.outbox, []);
  assert.equal(store.inboxRelays, null);
  assert.equal(port.ingest({ id: 'd'.repeat(64) }, { live: true }), false);
  assert.deepEqual(port.outbox.list(), []);
  assert.equal(port.getSyncCursor(), null);
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('a runtime refuses missing dependencies and exposes every UI action', async () => {
  assert.throws(() => createChatRuntime({}), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  const env = await setup();
  for (const name of CHAT_ACTIONS) assert.equal(typeof env.runtime[name], 'function', name);
});

// ---------------------------------------------------------------------------
// Text, reactions, retry
// ---------------------------------------------------------------------------

test('sendText stores the message and publishes the recipient copy to their relays and the self copy to ours', async () => {
  const env = await setup();
  const message = await env.runtime.sendText(ALICE, 'hello there');
  await env.runtime.whenIdle();

  assert.equal(message.text, 'hello there');
  assert.equal(env.store.thread(ALICE).messages.length, 1);
  assert.equal(env.store.thread(ALICE).messages[0].delivery, 'sent');
  const relays = env.transport.published.map((p) => p.relays);
  assert.ok(relays.some((r) => r.join() === ALICE_RELAYS.join()));
  assert.equal(relays.length, 2, 'one publish per copy');
  const toOurInbox = relays.filter((r) => r.length === DM_INBOX_RELAYS.length && r.every((url) => !url.includes('alice')));
  assert.equal(toOurInbox.length, 1, 'the self copy goes to our own inbox relays');
  const seenByAlice = await publishedMessages(env, aliceKey, ALICE);
  assert.equal(seenByAlice[0].text, 'hello there');
});

test('sendText with a reply keeps the reference, and bad input is refused before anything is stored', async () => {
  const env = await setup();
  const first = await env.runtime.sendText(ALICE, 'one');
  const reply = await env.runtime.sendText(ALICE, 'two', { replyTo: first.id });
  assert.equal(reply.replyTo, first.id);

  await assert.rejects(env.runtime.sendText('nope', 'x'), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(env.runtime.sendText(ALICE, '   '), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(
    env.runtime.sendText(ALICE, `my key nsec1${'q'.repeat(58)}`),
    (e) => DmError.is(e, DM_ERROR.SECRET_KEY_IN_TEXT),
  );
  assert.equal(env.store.thread(ALICE).messages.length, 2);
});

test('a partner without an inbox list gets no message and nothing is stored', async () => {
  const env = await setup({ partners: new Map([[ALICE, { status: 'missing', relays: [], checkedAt: 0 }]]) });
  await assert.rejects(env.runtime.sendText(ALICE, 'hi'), (e) => DmError.is(e, DM_ERROR.NO_INBOX_RELAYS));
  assert.equal(env.store.thread(ALICE).messages.length, 0);
  assert.equal(await env.runtime.partnerReachability(ALICE), REACHABILITY.MISSING);
});

test('partnerReachability reports found, missing and unknown, and never throws', async () => {
  const env = await setup({ partners: new Map([
    [ALICE, { status: 'found', relays: ALICE_RELAYS, checkedAt: 0 }],
    [BOB, { status: 'missing', relays: [], checkedAt: 0 }],
  ]) });
  assert.equal(await env.runtime.partnerReachability(ALICE), 'found');
  assert.equal(await env.runtime.partnerReachability(BOB), 'missing');
  assert.equal(await env.runtime.partnerReachability(getPublicKey(generateSecretKey())), 'unknown');
  env.resolver.resolve = async () => { throw new Error('boom'); };
  assert.equal(await env.runtime.partnerReachability(ALICE), 'unknown');
  assert.deepEqual(env.store.inboxRelays, { version: 1, entries: {} }, 'the relay cache is saved');
});

test('react sends a reaction that lands in the thread, and retry resends a failed message', async () => {
  const env = await setup();
  const message = await env.runtime.sendText(ALICE, 'hi');
  await env.runtime.whenIdle();
  await env.runtime.react(ALICE, message.id, '👍');
  assert.deepEqual(env.store.reactionsFor(ALICE, message.id).map((r) => [r.emoji, r.mine]), [['👍', true]]);

  env.transport.failPublishes = true;
  const failing = await env.runtime.sendText(ALICE, 'will fail');
  await env.runtime.whenIdle();
  assert.equal(env.store.outbox.some((item) => item.id === failing.id), true);
  env.transport.failPublishes = false;
  assert.equal(await env.runtime.retry(failing.id), true);
  await env.runtime.whenIdle();
  assert.equal(env.store.outbox.some((item) => item.id === failing.id), false);
  assert.equal(await env.runtime.retry('f'.repeat(64)), false);
});

// ---------------------------------------------------------------------------
// Requesting money
// ---------------------------------------------------------------------------

test('requestMoney mints one invoice, sends a request with the profile address and records where it is paid', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: ' Pizza ', walletId: 'w1' });
  await env.runtime.whenIdle();

  assert.equal(env.spark.created.length, 1);
  assert.equal(message.type, 'request');
  assert.equal(message.request.amountSats, 12_000);
  assert.equal(message.request.note, 'Pizza');
  assert.equal(message.request.lud16, PROFILE_ADDRESS);
  assert.equal(message.request.bolt11, env.invoice.bolt11);
  const source = env.store.requestSource(message.id);
  assert.equal(source.walletId, 'w1');
  assert.equal(source.method, 'direct');
  assert.equal(source.paymentHash, env.invoice.paymentHash);
  assert.equal(source.paidAt, null);
  assert.equal(env.runtime.requestState(message.id), 'pending');
  assert.equal((await publishedMessages(env, aliceKey, ALICE))[0].type, 'request');
});

test('requestMoney to a partner who cannot receive messages mints no invoice', async () => {
  const env = await setup({ partners: new Map([[ALICE, { status: 'missing', relays: [], checkedAt: 0 }]]) });
  await assert.rejects(
    env.runtime.requestMoney(ALICE, { amountSats: 1_000 }),
    (e) => DmError.is(e, DM_ERROR.NO_INBOX_RELAYS),
  );
  assert.equal(env.spark.created.length, 0);
});

test('requestMoney surfaces wallet problems as DmErrors and stores nothing', async () => {
  const env = await setup();
  env.wallets = [];
  await assert.rejects(
    env.runtime.requestMoney(ALICE, { amountSats: 1_000 }),
    (e) => DmError.is(e, DM_ERROR.WALLET_CANNOT_INVOICE),
  );
  await assert.rejects(
    env.runtime.requestMoney(ALICE, { amountSats: 0 }),
    (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT),
  );
  assert.equal(env.store.thread(ALICE).messages.length, 0);
});

test('a paid request is settled once: source marked, transaction linked, paid status sent', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: 'Pizza', walletId: 'w1' });
  await env.runtime.whenIdle();
  const before = env.transport.published.length;

  env.spark.pay(env.invoice.paymentHash);
  await flush();
  await env.runtime.whenIdle();

  const source = env.store.requestSource(message.id);
  assert.ok(source.paidAt);
  assert.equal(source.preimage, PREIMAGE);
  assert.equal(source.announced, true);
  assert.equal(env.runtime.requestState(message.id), 'paid');
  assert.equal(env.store.requestStatus(message.id), 'pending', 'the store derives paid from the payer only');
  assert.deepEqual(env.links, [{ contactId: 'contact-alice', walletId: 'w1', amountSats: 12_000, note: 'Pizza' }]);
  assert.ok(env.transport.published.length > before);
  const status = (await publishedMessages(env, aliceKey, ALICE)).find((m) => m.type === 'status');
  assert.equal(status.status.value, 'paid');
  assert.equal(status.status.requestId, message.id);
  assert.equal(status.status.preimage, PREIMAGE);

  // A second event for the same payment changes nothing.
  const count = env.transport.published.length;
  env.spark.pay(env.invoice.paymentHash);
  await flush();
  await env.runtime.whenIdle();
  assert.equal(env.transport.published.length, count);
  assert.equal(env.links.length, 1);
});

test('a payment found while the app was away is settled by reconcile, and an owed paid status is resent', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, walletId: 'w1' });
  await env.runtime.whenIdle();
  env.spark.listeners.clear(); // no push: only the ledger knows
  env.spark.ledger.set(env.invoice.paymentHash, PREIMAGE);

  env.transport.failPublishes = true;
  const result = await env.runtime.reconcile();
  await env.runtime.whenIdle();
  assert.equal(result.paid, 1);
  assert.equal(env.store.requestSource(message.id).paidAt > 0, true);
  assert.equal(env.store.requestSource(message.id).announced, true, 'the self copy and the status were queued, the record is done');
  assert.equal(env.runtime.requestState(message.id), 'paid');
  assert.equal(env.links.length, 1);
});

test('when the payer already said paid, no second paid status is sent', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, walletId: 'w1' });
  await env.runtime.whenIdle();
  await env.runtime.start();
  await env.transport.deliver(wrapFor(aliceKey, buildStatusTemplate({
    recipient: ME, requestId: message.id, value: 'paid', preimage: PREIMAGE, amountSats: 12_000,
  })));
  assert.equal(env.store.requestStatus(message.id), 'paid');

  const before = env.transport.published.length;
  env.spark.pay(env.invoice.paymentHash);
  await flush();
  await env.runtime.whenIdle();
  assert.equal(env.transport.published.length, before, 'nothing to add');
  assert.equal(env.store.requestSource(message.id).announced, true);
  assert.equal(env.links.length, 1, 'the transaction is still linked');
});

test('cancelRequest withdraws an open request and stops watching its invoice', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, walletId: 'w1' });
  await env.runtime.whenIdle();
  assert.equal(env.spark.listeners.size, 1);

  const cancel = await env.runtime.cancelRequest(ALICE, message.id);
  await env.runtime.whenIdle();
  assert.equal(cancel.status.value, 'cancelled');
  assert.equal(env.store.requestStatus(message.id), 'cancelled');
  assert.equal(env.store.requestSource(message.id), null);
  assert.equal(env.spark.listeners.size, 0);

  await assert.rejects(env.runtime.cancelRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(env.runtime.remindRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

test('remindRequest sends a reminder for an open request of the user only', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, walletId: 'w1' });
  const reminder = await env.runtime.remindRequest(ALICE, message.id);
  assert.equal(reminder.status.value, 'reminder');
  assert.equal(env.store.requestStatus(message.id), 'pending');
  await assert.rejects(env.runtime.declineRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

test('declineRequest answers a request the partner sent, and an expired one cannot be declined', async () => {
  const env = await setup();
  await env.runtime.start();
  const invoice = makeInvoice({ sats: 800, hash: 5 });
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 800, bolt11: invoice.bolt11, now: () => NOW,
  })));
  const [request] = env.store.pendingRequestsFrom(ALICE, NOW);
  assert.ok(request);

  const declined = await env.runtime.declineRequest(ALICE, request.id);
  assert.equal(declined.status.value, 'declined');
  assert.equal(env.store.requestStatus(request.id), 'declined');

  const late = makeInvoice({ sats: 900, hash: 6, expiry: 60 });
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 900, bolt11: late.bolt11, now: () => NOW + 1,
  })));
  const lateRequest = env.store.thread(ALICE).messages.find((m) => m.request?.amountSats === 900);
  await clock.advance(3_600_000);
  await assert.rejects(env.runtime.declineRequest(ALICE, lateRequest.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

// ---------------------------------------------------------------------------
// Announcing a payment
// ---------------------------------------------------------------------------

test('announcePayment sends a payment message', async () => {
  const env = await setup();
  const result = await env.runtime.announcePayment(ALICE, { amountSats: 5_000, note: 'Coffee', preimage: PREIMAGE });
  await env.runtime.whenIdle();
  assert.equal(result.payment.payment.amountSats, 5_000);
  assert.equal(result.payment.payment.note, 'Coffee');
  assert.equal(result.status, null);
  const types = (await publishedMessages(env, aliceKey, ALICE)).map((m) => m.type);
  assert.deepEqual(types, ['payment']);
});

test('announcePayment for a request sends the payment and the paid status; a failing status is returned, not thrown', async () => {
  const env = await setup();
  await env.runtime.start();
  const invoice = makeInvoice({ sats: 800, hash: 7 });
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 800, bolt11: invoice.bolt11, now: () => NOW,
  })));
  const [request] = env.store.pendingRequestsFrom(ALICE, NOW);

  const result = await env.runtime.announcePayment(ALICE, {
    amountSats: 800, preimage: PREIMAGE, requestId: request.id,
  });
  await env.runtime.whenIdle();
  assert.equal(result.payment.payment.requestId, request.id);
  assert.equal(result.status.status.value, 'paid');
  assert.equal(env.store.requestStatus(request.id), 'paid');

  // The partner's relay list disappears between the two messages: the money
  // is out, the follow-up fails, and that is reported, not thrown.
  const other = makeInvoice({ sats: 900, hash: 9 });
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 900, bolt11: other.bolt11, now: () => NOW + 1,
  })));
  const second = env.store.pendingRequestsFrom(ALICE, NOW + 1).find((m) => m.request.amountSats === 900);
  let calls = 0;
  env.resolver.resolve = async () => {
    calls += 1;
    return calls === 1
      ? { status: 'found', relays: ALICE_RELAYS, checkedAt: 0 }
      : { status: 'missing', relays: [], checkedAt: 0 };
  };
  const partial = await env.runtime.announcePayment(ALICE, { amountSats: 900, requestId: second.id });
  assert.equal(partial.payment.type, 'payment');
  assert.equal(partial.status, null);
  assert.equal(partial.statusError, DM_ERROR.NO_INBOX_RELAYS);
});

test('announcePayment throws when the payment message itself cannot be sent', async () => {
  const env = await setup({ partners: new Map([[ALICE, { status: 'missing', relays: [], checkedAt: 0 }]]) });
  await assert.rejects(
    env.runtime.announcePayment(ALICE, { amountSats: 5_000 }),
    (e) => DmError.is(e, DM_ERROR.NO_INBOX_RELAYS),
  );
  await assert.rejects(
    env.runtime.announcePayment(ALICE, { amountSats: -1 }),
    (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT),
  );
});

// ---------------------------------------------------------------------------
// Paying: checkPayable
// ---------------------------------------------------------------------------

test('checkPayable judges a request against the wallet that would pay it', async () => {
  const env = await setup();
  env.wallets = [
    { id: 'w1', type: 'spark' },
    { id: 'ark', type: 'arkade' },
    { id: 'n1', type: 'nwc' },
  ];
  const invoice = makeInvoice({ sats: 800, hash: 8 });
  const request = { bolt11: invoice.bolt11, amountSats: 800, expiresAt: NOW + 3_600 };
  assert.deepEqual(env.runtime.checkPayable(request, 'w1'), { ok: true });
  assert.deepEqual(env.runtime.checkPayable(request, 'n1'), { ok: true });
  assert.equal(env.runtime.checkPayable(request, 'ark').reason, DM_ERROR.WALLET_CANNOT_PAY);
  assert.equal(env.runtime.checkPayable(request, 'ghost').reason, DM_ERROR.WALLET_CANNOT_PAY);
  assert.equal(env.runtime.checkPayable({ ...request, amountSats: 799 }, 'w1').reason, DM_ERROR.INVALID_INVOICE);
  await clock.advance(7_200_000);
  assert.equal(env.runtime.checkPayable(request, 'w1').reason, DM_ERROR.INVOICE_EXPIRED);
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test('a new message from a contact posts one notification for that chat, routed to the contact', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.transport.deliver(textFrom(aliceKey, 'hello'));

  assert.equal(env.notifications.length, 1);
  assert.deepEqual(env.notifications[0], {
    title: 'Alice',
    body: 'body:text',
    id: stableNotificationId(`chat:${ALICE}`),
    group: `chat:${ALICE}`,
    route: contactChatRoute('contact-alice'),
    force: false,
    channelName: 'Messages',
  });
  assert.equal(env.store.unreadFor(ALICE), 1);
});

test('an unknown sender is shown by a short npub and routed to the unknown-sender route', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.transport.deliver(textFrom(bobKey, 'who am I'));

  assert.equal(env.notifications.length, 1);
  assert.match(env.notifications[0].title, /^npub1[a-z0-9]{7}…$/);
  assert.equal(env.notifications[0].route, unknownChatRoute(BOB));
  assert.equal(env.notifications[0].id, stableNotificationId(`chat:${BOB}`));
});

test('the same chat reuses one notification id', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.transport.deliver(textFrom(aliceKey, 'one'));
  await env.transport.deliver(textFrom(aliceKey, 'two'));
  assert.equal(env.notifications.length, 2);
  assert.equal(env.notifications[0].id, env.notifications[1].id);
});

test('muted chats, blocked senders, reactions, own self copies and the open chat stay silent', async () => {
  const env = await setup();
  await env.runtime.start();

  env.store.mute(ALICE, true);
  await env.transport.deliver(textFrom(aliceKey, 'muted'));
  env.store.mute(ALICE, false);

  env.store.block(BOB);
  await env.transport.deliver(textFrom(bobKey, 'blocked'));

  const target = await env.runtime.sendText(ALICE, 'mine');
  await env.runtime.whenIdle();
  await env.transport.deliver(wrapFor(aliceKey, buildReactionTemplate({ recipient: ME, targetId: target.id, emoji: '👍' })));

  env.store.setOpenThread(ALICE);
  await env.transport.deliver(textFrom(aliceKey, 'on screen'));
  env.store.setOpenThread(null);

  // The self copy of our own message comes back through the subscription.
  const selfCopy = env.transport.published.map((p) => p.event).find((event) => event.tags.some((t) => t[1] === ME));
  await env.transport.deliver(selfCopy);

  assert.deepEqual(env.notifications, []);
});

test('a message that arrives while the app is hidden is forced, even for the open chat', async () => {
  const env = await setup({ hidden: true });
  await env.runtime.start();
  await env.transport.deliver(textFrom(aliceKey, 'psst'));
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0].force, true);

  env.store.setOpenThread(ALICE);
  await env.transport.deliver(textFrom(aliceKey, 'still hidden'));
  assert.equal(env.notifications.length, 2, 'an open chat does not count while nobody is looking');
});

test('a notification failure never disturbs the receive loop', async () => {
  const env = await setup({ notifyThrows: true });
  await env.runtime.start();
  await env.transport.deliver(textFrom(aliceKey, 'kept anyway'));
  assert.equal(env.notifications.length, 1, 'it was attempted');
  assert.equal(env.store.thread(ALICE).messages.some((m) => m.text === 'kept anyway'), true);
  await env.transport.deliver(textFrom(aliceKey, 'and the next one'));
  assert.equal(env.store.thread(ALICE).messages.length, 2);
});

// ---------------------------------------------------------------------------
// Key, lock, dispose
// ---------------------------------------------------------------------------

test('while the app is locked the key is never loaded; the wrap waits and is opened after unlock', async () => {
  const env = await setup({ locked: true });
  await env.runtime.start();
  await env.transport.deliver(textFrom(aliceKey, 'while locked'));
  assert.equal(env.keyLoads, 0, 'no key in memory while locked');
  assert.equal(env.store.thread(ALICE).messages.length, 0);
  assert.equal(env.runtime.status().pendingWraps, 1);

  env.locked = false;
  await env.runtime.retryOutbox();
  await env.runtime.whenIdle();
  assert.equal(env.keyLoads, 1);
  assert.equal(env.store.thread(ALICE).messages[0].text, 'while locked');
  assert.equal(env.notifications.length, 1);
});

test('wipeKey zeroes the key and the next use loads it again; wipeKeyAfter and cancelKeyWipe drive the timer', async () => {
  const env = await setup();
  await env.runtime.sendText(ALICE, 'loads the key');
  await env.runtime.whenIdle();
  assert.equal(env.runtime.isKeyLoaded(), true);
  env.runtime.wipeKey('lock');
  assert.equal(env.runtime.isKeyLoaded(), false);

  await env.runtime.sendText(ALICE, 'again');
  await env.runtime.whenIdle();
  assert.equal(env.keyLoads, 2);

  env.runtime.wipeKeyAfter(1_000);
  await clock.advance(500);
  assert.equal(env.runtime.isKeyLoaded(), true);
  env.runtime.cancelKeyWipe();
  await clock.advance(5_000);
  assert.equal(env.runtime.isKeyLoaded(), true, 'a cancelled wipe does not happen');
  env.runtime.wipeKeyAfter(1_000);
  await clock.advance(1_000);
  assert.equal(env.runtime.isKeyLoaded(), false);
});

test('dispose wipes the key, closes the transport and makes every action refuse', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.runtime.sendText(ALICE, 'hi');
  await env.runtime.whenIdle();
  env.runtime.dispose();
  env.runtime.dispose();

  assert.equal(env.runtime.isKeyLoaded(), false);
  assert.equal(env.runtime.isDisposed(), true);
  assert.equal(env.runtime.isStarted(), false);
  assert.equal(env.transport.closed, 1);
  assert.ok(env.transport.identityResets >= 1);
  assert.equal(env.transport.subscriptions[0].closed, true);
  await assert.rejects(env.runtime.sendText(ALICE, 'late'), (e) => DmError.is(e, DM_ERROR.NO_IDENTITY));
  await assert.rejects(env.runtime.start(), (e) => DmError.is(e, DM_ERROR.NO_IDENTITY));
  assert.deepEqual(await env.runtime.retryOutbox(), { attempted: 0 });
});

test('a runtime refuses to act once the store holds another identity, and never writes into it', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.store.setScope(OTHER_ME);
  await assert.rejects(env.runtime.sendText(ALICE, 'wrong scope'), (e) => DmError.is(e, DM_ERROR.NO_IDENTITY));
  await env.transport.deliver(textFrom(aliceKey, 'for the old identity'));
  assert.deepEqual(env.store.threads, {});
  assert.deepEqual(env.notifications, []);
});

test('start is idempotent, stop closes the subscription and start can run again', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.runtime.start();
  assert.equal(env.transport.subscriptions.length, 1);
  env.runtime.stop();
  assert.equal(env.transport.subscriptions[0].closed, true);
  assert.equal(env.runtime.isStarted(), false);
  await env.runtime.start();
  assert.equal(env.transport.subscriptions.length, 2);
  assert.equal(env.runtime.isStarted(), true);
});

test('a request that is still open after a restart is watched again', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, walletId: 'w1' });
  await env.runtime.whenIdle();
  await env.store.flush();
  env.runtime.dispose();

  // A new runtime over the same persisted store state.
  const again = await setup({ invoice: env.invoice });
  await again.store.setScope(null);
  await again.store.setScope(ME);
  assert.ok(again.store.requestSource(message.id), 'the source survived the restart');
  await again.runtime.start();
  await flush();
  assert.equal(again.spark.listeners.size, 1, 'the invoice is watched again');
  again.spark.pay(again.invoice.paymentHash);
  await flush();
  await again.runtime.whenIdle();
  assert.equal(again.runtime.requestState(message.id), 'paid');
});
