/**
 * Chat runtime tests.
 *
 * Real: the messages store (Pinia, in-memory encrypted storage), the inbox,
 * the request service, the key holder, the gift wrap crypto and the protocol.
 * Fake: the relay transport (scripted, records every publish and lets a test
 * push wraps in), the inbox relay resolver (a table), the LNURL server and the
 * profile lookup, the notification poster and a manual clock with manual timers.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/runtime.spec.js
 */

import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { test, beforeEach } from 'node:test';
import { generateSecretKey, getPublicKey } from 'nostr-core';
import { createPinia, setActivePinia } from 'pinia';
import { configureMessages, resetMessagesConfig, useMessagesStore } from '../../../stores/messages.js';
import { createDmStorage, createMemoryBackend } from '../../../utils/dmStorage.js';
import { stableNotificationId } from '../../paymentNotifications.js';
import { DM_INBOX_RELAYS, REQUEST_LIFETIME_SECONDS } from '../constants.js';
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
  buildPaymentTemplate,
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
const ALICE_ADDRESS = 'alice@alice.example';

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
const HASH_OF_PREIMAGE = bytesToHex(sha256(Uint8Array.from(PREIMAGE.match(/../g), (pair) => parseInt(pair, 16))));

/** A fake LNURL-pay server for every address: records the calls, hands out `answer`. */
function createLnurlServer(answer = null, { minSendable = 1_000, maxSendable = 100_000_000_000, commentAllowed = 255 } = {}) {
  const server = {
    fetched: [],
    requested: [],
    answer,
    failFetch: false,
    async fetchPayRequest(url) {
      server.fetched.push(url);
      if (server.failFetch) throw new Error('lnurl down');
      return { tag: 'payRequest', callback: 'https://buho.example/cb', minSendable, maxSendable, commentAllowed };
    },
    async requestInvoice(payRequest, amountMsat, options) {
      server.requested.push({ amountMsat, comment: options?.comment });
      return { pr: server.answer.bolt11, routes: [] };
    },
  };
  return server;
}

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
  partners = new Map([[ALICE, { status: 'found', relays: ALICE_RELAYS, checkedAt: 0 }]]),
  locked = false,
  hidden = false,
  profileAddress = PROFILE_ADDRESS,
  notifyResult = true,
  notifyThrows = false,
  lnurl = createLnurlServer(),
  profiles = new Map(),
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
    lnurl,
    /** pubkey -> kind 0 content, what `fetchProfile` finds. */
    profiles,
    keyLoads: 0,
    notifications: [],
    links: [],
    contactsById: new Map([[ALICE, { id: 'contact-alice', name: 'Alice' }]]),
    profileAddress,
    /** What the user's wallets show as settled incoming money (payment-claim verification). */
    incoming: [],
  };

  env.runtime = createChatRuntime({
    me: ME,
    loadSecretKey: async () => {
      env.keyLoads += 1;
      return Uint8Array.from(meKey);
    },
    isLocked: () => env.locked,
    store,
    getProfileAddress: () => env.profileAddress,
    fetchProfile: async (pubkey) => (env.profiles.has(pubkey)
      ? { kind: 0, pubkey, content: JSON.stringify(env.profiles.get(pubkey)) }
      : null),
    lnurl,
    loadIncomingTransactions: async () => env.incoming,
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

test('requestMoney checks the profile address, then sends a request that is only a notice', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: ' Pizza ' });
  await env.runtime.whenIdle();

  assert.deepEqual(env.lnurl.fetched, ['https://buho.example/.well-known/lnurlp/me']);
  assert.equal(env.lnurl.requested.length, 0, 'no invoice is created for a request');
  assert.equal(message.type, 'request');
  assert.deepEqual(message.request, {
    amountSats: 12_000, note: 'Pizza', lud16: PROFILE_ADDRESS, validUntil: NOW + REQUEST_LIFETIME_SECONDS,
  });
  assert.equal(env.runtime.requestState(message.id), 'pending');
  assert.equal(env.runtime.requestSettlement(message.id), null);
  const sent = (await publishedMessages(env, aliceKey, ALICE))[0];
  assert.equal(sent.type, 'request');
  assert.equal(sent.request.lud16, PROFILE_ADDRESS);
});

test('requestMoney to a partner who cannot receive messages asks nothing of the address', async () => {
  const env = await setup({ partners: new Map([[ALICE, { status: 'missing', relays: [], checkedAt: 0 }]]) });
  await assert.rejects(
    env.runtime.requestMoney(ALICE, { amountSats: 1_000 }),
    (e) => DmError.is(e, DM_ERROR.NO_INBOX_RELAYS),
  );
  assert.deepEqual(env.lnurl.fetched, []);
});

test('requestMoney sends nothing when the preflight fails: no address, address down, amount out of range', async () => {
  const none = await setup({ profileAddress: null });
  await assert.rejects(none.runtime.requestMoney(ALICE, { amountSats: 1_000 }), (e) => DmError.is(e, DM_ERROR.NO_PAYMENT_ADDRESS));
  assert.deepEqual(none.transport.published, []);
  assert.equal(none.store.thread(ALICE).messages.length, 0);

  const down = await setup();
  down.lnurl.failFetch = true;
  await assert.rejects(down.runtime.requestMoney(ALICE, { amountSats: 1_000 }), (e) => DmError.is(e, DM_ERROR.PAYMENT_ADDRESS_UNREACHABLE));
  assert.equal(down.store.thread(ALICE).messages.length, 0);

  const narrow = await setup({ lnurl: createLnurlServer(null, { minSendable: 5_000_000, maxSendable: 6_000_000 }) });
  await assert.rejects(narrow.runtime.requestMoney(ALICE, { amountSats: 1_000 }), (e) => DmError.is(e, DM_ERROR.AMOUNT_OUT_OF_RANGE));
  assert.equal(narrow.store.thread(ALICE).messages.length, 0);

  const env = await setup();
  await assert.rejects(env.runtime.requestMoney(ALICE, { amountSats: 0 }), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  assert.equal(env.store.thread(ALICE).messages.length, 0);
});

test('cancelRequest withdraws an open request of the user only once', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();

  const cancel = await env.runtime.cancelRequest(ALICE, message.id);
  await env.runtime.whenIdle();
  assert.equal(cancel.status.value, 'cancelled');
  assert.equal(env.store.requestStatus(message.id), 'cancelled');

  await assert.rejects(env.runtime.cancelRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(env.runtime.remindRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

test('remindRequest sends a reminder for an open request of the user only', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  const reminder = await env.runtime.remindRequest(ALICE, message.id);
  assert.equal(reminder.status.value, 'reminder');
  assert.equal(env.store.requestStatus(message.id), 'pending');
  await assert.rejects(env.runtime.declineRequest(ALICE, message.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

test('declineRequest answers a request the partner sent, and one past its lifetime cannot be declined', async () => {
  const env = await setup();
  await env.runtime.start();
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 800, lud16: ALICE_ADDRESS, now: () => NOW,
  })));
  const [request] = env.store.pendingRequestsFrom(ALICE, NOW);
  assert.ok(request);

  const declined = await env.runtime.declineRequest(ALICE, request.id);
  assert.equal(declined.status.value, 'declined');
  assert.equal(env.store.requestStatus(request.id), 'declined');

  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 900, lud16: ALICE_ADDRESS, validUntil: NOW + 600, now: () => NOW + 1,
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
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 800, lud16: ALICE_ADDRESS, now: () => NOW,
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
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: 900, lud16: ALICE_ADDRESS, now: () => NOW + 1,
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

// ---------------------------------------------------------------------------
// Paying a request: the invoice is created now (docs section 8a)
// ---------------------------------------------------------------------------

/** A request from ALICE to ME that names her signed address. */
async function deliverAliceRequest(env, { sats = 800, lud16 = ALICE_ADDRESS, validUntil } = {}) {
  await env.transport.deliver(wrapFor(aliceKey, buildRequestTemplate({
    recipient: ME, amountSats: sats, lud16, note: 'Pizza', validUntil, now: () => NOW,
  })));
  return env.store.thread(ALICE).messages.find((m) => m.type === 'request' && m.request.amountSats === sats);
}

test('fetchRequestInvoice pulls the invoice from the signed address, for exactly the amount', async () => {
  const fresh = makeInvoice({ sats: 800, hash: 21 });
  const server = createLnurlServer(fresh);
  const env = await setup({ lnurl: server });
  await env.runtime.start();
  const request = await deliverAliceRequest(env, { lud16: 'Alice@alice.example' });
  // A saved address for Alice in the address book must play no part.
  env.contactsById.set(ALICE, { id: 'contact-alice', name: 'Alice', address: 'evil@evil.example' });

  assert.equal(await env.runtime.fetchRequestInvoice(ALICE, request.id), fresh.bolt11);
  assert.deepEqual(server.fetched, ['https://alice.example/.well-known/lnurlp/Alice']);
  assert.deepEqual(server.requested, [{ amountMsat: 800_000, comment: `buho:req:${request.id.slice(0, 12)}` }]);
});

test('fetchRequestInvoice follows the requester\'s current profile address over the signed one', async () => {
  const server = createLnurlServer(makeInvoice({ sats: 800, hash: 22 }));
  const env = await setup({ lnurl: server });
  await env.runtime.start();
  const request = await deliverAliceRequest(env);
  env.profiles.set(ALICE, { lud16: 'Alice@new-wallet.example' });

  await env.runtime.fetchRequestInvoice(ALICE, request.id);
  assert.deepEqual(server.fetched, ['https://new-wallet.example/.well-known/lnurlp/alice']);
  assert.equal(await env.runtime.requestAddress(ALICE, request.id), 'alice@new-wallet.example');

  // A profile with no usable address falls back to the one signed in the request.
  env.profiles.set(ALICE, { name: 'Alice' });
  assert.equal(await env.runtime.requestAddress(ALICE, request.id), ALICE_ADDRESS);
});

test('fetchRequestInvoice reports a failing address and creates nothing', async () => {
  const server = createLnurlServer(makeInvoice({ sats: 800, hash: 23 }));
  const env = await setup({ lnurl: server });
  await env.runtime.start();
  const request = await deliverAliceRequest(env);
  server.failFetch = true;
  await assert.rejects(env.runtime.fetchRequestInvoice(ALICE, request.id), (e) => DmError.is(e, DM_ERROR.INVOICE_FETCH_FAILED));
  assert.deepEqual(server.requested, []);
});

test('fetchRequestInvoice refuses what it cannot serve: a request past its lifetime, an own or unknown request', async () => {
  const server = createLnurlServer(makeInvoice({ sats: 800, hash: 24 }));
  const env = await setup({ lnurl: server });
  await env.runtime.start();

  const own = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  server.fetched.length = 0;
  await assert.rejects(env.runtime.fetchRequestInvoice(ALICE, own.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(env.runtime.fetchRequestInvoice(ALICE, 'f'.repeat(64)), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(env.runtime.requestAddress(ALICE, own.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));

  const short = await deliverAliceRequest(env, { sats: 900, validUntil: NOW + 600 });
  await clock.advance(3_600_000);
  await assert.rejects(env.runtime.fetchRequestInvoice(ALICE, short.id), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  assert.deepEqual(server.fetched, [], 'nothing was asked of any server');
  assert.equal(await env.runtime.requestAddress(ALICE, short.id), ALICE_ADDRESS, '"Send anyway" still finds the address');
});

// ---------------------------------------------------------------------------
// Request lifetime (docs section 8a)
// ---------------------------------------------------------------------------

test('the request stays open for 30 days, then expires; it can be reminded meanwhile', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await clock.advance(2 * 24 * 60 * 60 * 1000);
  assert.equal(env.runtime.requestState(message.id), 'pending');
  await env.runtime.remindRequest(ALICE, message.id);
  await clock.advance(REQUEST_LIFETIME_SECONDS * 1000);
  assert.equal(env.runtime.requestState(message.id), 'expired');
});

// ---------------------------------------------------------------------------
// Detecting paid: the payer's claim against the own ledger
// ---------------------------------------------------------------------------

/** The payer's two messages for a request: the payment and the paid status. */
async function deliverClaim(env, requestId, { sats = 12_000, preimage = PREIMAGE, at = NOW + 7_300 } = {}) {
  await env.transport.deliver(wrapFor(aliceKey, buildPaymentTemplate({
    recipient: ME, amountSats: sats, preimage, requestId, now: () => at,
  })));
  await env.transport.deliver(wrapFor(aliceKey, buildStatusTemplate({
    recipient: ME, requestId, value: 'paid', preimage, amountSats: sats, now: () => at + 1,
  })));
  await flush();
}

test('a payment the partner reports is verified against the own ledger: paid, linked once, no status sent back', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: 'Pizza' });
  await env.runtime.whenIdle();
  await env.runtime.start();

  env.incoming = [{ amountSats: 12_000, settledAt: NOW + 7_300, paymentHash: HASH_OF_PREIMAGE, walletId: 'w1' }];
  await deliverClaim(env, message.id);

  assert.deepEqual(env.runtime.requestSettlement(message.id), { verified: true, walletId: 'w1' });
  assert.equal(env.runtime.requestState(message.id), 'paid');
  assert.deepEqual(env.links, [{ contactId: 'contact-alice', walletId: 'w1', amountSats: 12_000, note: 'Pizza' }]);
  const before = env.transport.published.length;
  await env.runtime.settleClaims();
  assert.equal(env.links.length, 1, 'never linked twice');
  assert.equal(env.transport.published.length, before, 'the payer needs no paid status back');
});

test('a claim no wallet shows stays "reported, not verified" and is checked again later', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await env.runtime.start();

  await deliverClaim(env, message.id);
  assert.equal(env.runtime.requestState(message.id), 'paid', 'the store follows the payer');
  assert.deepEqual(env.runtime.requestSettlement(message.id), { verified: false, walletId: null });
  assert.equal(env.links.length, 0);

  // The wallet history catches up: the retry finds it.
  env.incoming = [{ amountSats: 12_000, settledAt: NOW + 7_310, paymentHash: HASH_OF_PREIMAGE, walletId: 'w1' }];
  await clock.advance(5_000);
  assert.deepEqual(env.runtime.requestSettlement(message.id), { verified: true, walletId: 'w1' });
  assert.equal(env.links.length, 1);
});

test('without a preimage the amount and the time window decide; a wrong amount or a stale payment does not', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await env.runtime.start();
  await env.transport.deliver(wrapFor(aliceKey, buildStatusTemplate({
    recipient: ME, requestId: message.id, value: 'paid', amountSats: 12_000, now: () => NOW + 7_300,
  })));
  await flush();

  env.incoming = [
    { amountSats: 11_999, settledAt: NOW + 7_300, walletId: 'w1' },
    { amountSats: 12_000, settledAt: NOW + 7_300 - 3_600, walletId: 'w1' },
  ];
  await env.runtime.settleClaims();
  assert.equal(env.runtime.requestSettlement(message.id).verified, false);

  env.incoming.push({ amountSats: 12_000, settledAt: NOW + 7_320, walletId: 'w1' });
  await env.runtime.settleClaims();
  assert.deepEqual(env.runtime.requestSettlement(message.id), { verified: true, walletId: 'w1' });
});

test('a claim below the requested amount is not verified', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await env.runtime.start();
  await deliverClaim(env, message.id, { sats: 5_000 });
  env.incoming = [{ amountSats: 5_000, settledAt: NOW + 7_300, paymentHash: HASH_OF_PREIMAGE, walletId: 'w1' }];
  await env.runtime.settleClaims();
  assert.equal(env.runtime.requestSettlement(message.id).verified, false);
});

test('one transaction verifies one claim, and claims about requests of the partner are ignored', async () => {
  const env = await setup();
  const first = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: 'one' });
  const second = await env.runtime.requestMoney(ALICE, { amountSats: 12_000, note: 'two' });
  await env.runtime.whenIdle();
  await env.runtime.start();
  const theirs = await deliverAliceRequest(env);
  for (const id of [first.id, second.id, theirs.id]) {
    await env.transport.deliver(wrapFor(aliceKey, buildStatusTemplate({
      recipient: ME, requestId: id, value: 'paid', amountSats: 12_000, now: () => NOW + 7_300,
    })));
  }
  env.incoming = [{ amountSats: 12_000, settledAt: NOW + 7_300, walletId: 'w1' }];
  await env.runtime.settleClaims();
  const verified = [first.id, second.id].filter((id) => env.runtime.requestSettlement(id).verified);
  assert.equal(verified.length, 1, 'a single payment cannot vouch for two requests');
  assert.equal(env.links.length, 1);
});

test('settleClaims on resume verifies a claim that arrived while the wallet history was behind', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await env.runtime.start();
  await env.transport.deliver(wrapFor(aliceKey, buildStatusTemplate({
    recipient: ME, requestId: message.id, value: 'paid', preimage: PREIMAGE, now: () => NOW + 7_300,
  })));
  await flush();
  assert.equal(env.runtime.requestSettlement(message.id).verified, false);
  env.incoming = [{ amountSats: 12_000, settledAt: NOW + 7_300, paymentHash: HASH_OF_PREIMAGE, walletId: 'w1' }];
  await env.runtime.settleClaims();
  assert.equal(env.runtime.requestSettlement(message.id).verified, true);
});

test('a verified settlement survives a restart', async () => {
  const env = await setup();
  const message = await env.runtime.requestMoney(ALICE, { amountSats: 12_000 });
  await env.runtime.whenIdle();
  await env.runtime.start();
  env.incoming = [{ amountSats: 12_000, settledAt: NOW + 7_300, paymentHash: HASH_OF_PREIMAGE, walletId: 'w1' }];
  await deliverClaim(env, message.id);
  await env.store.flush();
  env.runtime.dispose();

  const again = await setup();
  await again.store.setScope(null);
  await again.store.setScope(ME);
  assert.deepEqual(again.runtime.requestSettlement(message.id), { verified: true, walletId: 'w1' });
});
