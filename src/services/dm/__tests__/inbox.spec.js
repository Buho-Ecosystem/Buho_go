/**
 * Inbox coordinator tests.
 *
 * Real cryptography (gift wraps, seals, signatures, the session key holder and
 * the inbound gates), fake edges: one in-memory relay network shared by two
 * people, a fake store port, a manual clock and manual timers. A message
 * written by Alice travels through `send`, the network and Bob's `inbox`
 * exactly as in production, so the tests check the whole path, not mocks of it.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/inbox.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey, verifyEventSignature, verifyAuthEvent } from 'nostr-core';
import { DM_DISCOVERY_RELAYS, DM_INBOX_RELAYS, KIND, SINCE_SLACK_SECONDS } from '../constants.js';
import { DM_ERROR, DmError } from '../errors.js';
import { MAX_WRAP_STRIKES, OUTBOX_DEFAULTS, createInbox, createSignAuth } from '../inbox.js';
import { parseInboxRelayList } from '../inboxRelays.js';
import { buildReactionTemplate, buildTextTemplate } from '../protocol.js';
import { createLocalDmSigner } from '../dmSigner.js';
import { createSessionKey } from '../sessionKey.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const START_MS = 1_760_000_000_000;
const START_S = START_MS / 1000;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** One in-memory relay network; every person gets their own transport on it. */
function createNetwork() {
  // Relay URLs compare without the trailing slash `normalizeURL` adds.
  const key = (url) => url.replace(/\/$/, '');
  /** @type {Map<string, object[]>} */
  const stored = new Map();
  const subs = new Set();
  const network = {
    /** Relay URL -> 'ok' | 'fail' | { prefix } ; default 'ok'. */
    behavior: new Map(),
    /** Every publish call: { relay, event }. */
    published: [],
    /** Every subscribe call: { relays, filter, handlers }. */
    subscribed: [],
    /** When true, EOSE is withheld until `releaseEose()`. */
    holdEose: false,
    closedSubs: 0,
    eventsAt: (relay) => stored.get(key(relay)) ?? [],
    releaseEose() {
      network.holdEose = false;
      for (const sub of subs) {
        for (const relay of sub.relays) sub.handlers.oneose?.(relay);
      }
    },
    /** Put an event on a relay as if it were published, delivering it to live subscribers. */
    inject(relay, event) {
      const url = key(relay);
      const list = stored.get(url) ?? [];
      stored.set(url, list);
      list.push(event);
      for (const sub of subs) {
        const target = sub.relays.find((r) => key(r) === url);
        if (target && matches(sub.filter, event)) sub.handlers.onevent?.(event, target);
      }
    },
    transport() {
      return {
        warmUp: async () => {},
        subscribe(relays, filter, handlers) {
          network.subscribed.push({ relays, filter, handlers });
          const sub = { relays, filter, handlers };
          subs.add(sub);
          Promise.resolve().then(() => {
            if (!subs.has(sub)) return;
            for (const relay of relays) {
              for (const event of stored.get(key(relay)) ?? []) {
                if (matches(filter, event)) handlers.onevent?.(event, relay);
              }
              if (!network.holdEose) handlers.oneose?.(relay);
            }
          });
          return {
            close() {
              if (subs.delete(sub)) network.closedSubs += 1;
            },
          };
        },
        publish(relays, event) {
          const results = relays.map((raw) => {
            const relay = key(raw);
            network.published.push({ relay, event });
            const behavior = network.behavior.get(relay) ?? 'ok';
            if (behavior === 'fail') {
              return { relay, ok: false, prefix: null, message: 'down', code: DM_ERROR.RELAY_UNAVAILABLE, attempts: 1 };
            }
            if (typeof behavior === 'object') {
              return { relay, ok: false, prefix: behavior.prefix, message: 'no', code: DM_ERROR.NO_RELAY_ACCEPTED, attempts: 1 };
            }
            const known = (stored.get(relay) ?? []).some((e) => e.id === event.id);
            if (!known) network.inject(relay, event);
            return { relay, ok: true, prefix: known ? 'duplicate' : null, message: '', code: null, attempts: 1 };
          });
          const firstOk = results.find((r) => r.ok) ?? null;
          return { firstAccept: Promise.resolve(firstOk), allSettled: Promise.resolve(results) };
        },
      };
    },
  };
  return network;
}

function matches(filter, event) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  const p = filter['#p'];
  if (p && !event.tags.some((t) => t[0] === 'p' && p.includes(t[1]))) return false;
  return true;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** The store port, in memory, with the semantics the real adapter has. */
function createFakeStore({ cursor = null, blocked = [] } = {}) {
  const messages = new Map();
  const outboxMap = new Map();
  const store = {
    messages,
    outboxMap,
    cursor,
    blocked: new Set(blocked),
    snapshot: null,
    setCursorCalls: [],
    ingestCalls: [],
    getSyncCursor: () => store.cursor,
    setSyncCursor(seconds) {
      store.setCursorCalls.push(seconds);
      store.cursor = seconds;
    },
    hasMessage: (id) => messages.has(id),
    handled: new Map(),
    hasHandledWrap: (wrapId) => store.handled.has(wrapId),
    rememberHandledWrap(wrapId, createdAt) {
      store.handled.set(wrapId, createdAt);
    },
    ingest(message, options) {
      store.ingestCalls.push({ message, options });
      if (!message.outgoing && store.blocked.has(message.sender)) return false;
      const existing = messages.get(message.id);
      if (existing) {
        if (existing.outgoing) existing.delivery = 'sent';
        return false;
      }
      messages.set(message.id, { ...message, delivery: message.outgoing ? 'sent' : undefined });
      return true;
    },
    addOutgoing(message, { delivery }) {
      if (messages.has(message.id)) return false;
      messages.set(message.id, { ...message, delivery });
      return true;
    },
    setDelivery(id, delivery) {
      const message = messages.get(id);
      if (!message || message.delivery === 'sent') return false;
      message.delivery = delivery;
      return true;
    },
    isBlocked: (pubkey) => store.blocked.has(pubkey),
    outbox: {
      list: () => [...outboxMap.values()].map(clone),
      put: (item) => outboxMap.set(item.id, clone(item)),
      remove: (id) => outboxMap.delete(id),
    },
    getInboxRelaySnapshot: () => store.snapshot,
    setInboxRelaySnapshot(snapshot) {
      store.snapshot = snapshot;
    },
  };
  store.raw = store;
  return store;
}

/** Resolver fake: answers from a table the test edits. */
function createFakeResolver() {
  const table = new Map();
  const calls = [];
  return {
    table,
    calls,
    invalidated: [],
    hydrated: [],
    resolve: async (pubkey, options = {}) => {
      calls.push({ pubkey, options });
      return clone(table.get(pubkey) ?? { status: 'unknown', relays: [], checkedAt: 0 });
    },
    invalidate(pubkey) {
      this.invalidated.push(pubkey);
    },
    snapshot: () => ({ version: 1, entries: {} }),
    hydrate(snapshot) {
      this.hydrated.push(snapshot);
      return 0;
    },
  };
}

function createClock() {
  const clock = {
    ms: START_MS,
    timers: [],
    now: () => clock.ms,
    setTimer(fn, ms) {
      const handle = { fn, ms, at: clock.ms + ms, cleared: false };
      clock.timers.push(handle);
      return handle;
    },
    clearTimer(handle) {
      handle.cleared = true;
    },
    pendingTimers: () => clock.timers.filter((t) => !t.cleared && !t.fired),
    /** Advance the clock and run every timer that became due. */
    async advance(ms) {
      clock.ms += ms;
      for (const timer of clock.timers) {
        if (!timer.cleared && !timer.fired && timer.at <= clock.ms) {
          timer.fired = true;
          timer.fn();
        }
      }
      await flush();
    },
  };
  return clock;
}

/** A person with a key holder, a store and an inbox on the shared network. */
function makePerson(network, clock, options = {}) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const keyState = { available: true, loads: 0 };
  const sessionKey = createSessionKey({
    pubkey,
    load: async () => {
      keyState.loads += 1;
      if (!keyState.available) throw new Error('locked');
      return Uint8Array.from(secretKey);
    },
  });
  const signer = (options.wrapSigner ?? ((local) => local))(createLocalDmSigner({ pubkey, sessionKey }));
  const store = createFakeStore(options.store);
  const resolver = createFakeResolver();
  const incoming = [];
  const inbox = createInbox({
    me: pubkey,
    signer,
    transport: network.transport(),
    resolver,
    store,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    inboxRelays: options.inboxRelays ?? ['wss://inbox.one.example', 'wss://inbox.two.example'],
    discoveryRelays: options.discoveryRelays ?? ['wss://disco.example'],
    onIncoming: (message, info) => incoming.push({ message, info }),
    random: () => 0.5,
    ...options.inbox,
  });
  return { secretKey, pubkey, keyState, sessionKey, signer, store, resolver, inbox, incoming, inboxRelays: options.inboxRelays ?? ['wss://inbox.one.example', 'wss://inbox.two.example'] };
}

/** Tell `from` where `to` receives. */
function knows(from, to) {
  from.resolver.table.set(to.pubkey, { status: 'found', relays: to.inboxRelays.map((r) => r + '/'), checkedAt: START_MS });
}

const textTo = (to, text = 'hello') => buildTextTemplate({ recipient: to.pubkey, text, now: () => START_S });

/** Two people who know each other's inbox relays, with both inboxes started. */
async function pair({ aliceOptions, bobOptions } = {}) {
  const network = createNetwork();
  const clock = createClock();
  const alice = makePerson(network, clock, { inboxRelays: ['wss://inbox.alice.example', 'wss://inbox.alice2.example'], ...aliceOptions });
  const bob = makePerson(network, clock, { inboxRelays: ['wss://inbox.bob.example'], ...bobOptions });
  knows(alice, bob);
  knows(bob, alice);
  return { network, clock, alice, bob };
}

async function settle(...people) {
  await flush();
  for (const person of people) await person.inbox.whenIdle();
  await flush();
  for (const person of people) await person.inbox.whenIdle();
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('createInbox: rejects missing collaborators and bad relays', () => {
  const network = createNetwork();
  const clock = createClock();
  const person = makePerson(network, clock);
  const base = {
    me: person.pubkey,
    signer: person.signer,
    transport: network.transport(),
    resolver: person.resolver,
    store: person.store,
  };
  assert.doesNotThrow(() => createInbox(base));
  for (const patch of [
    { me: 'nope' },
    { signer: null },
    { transport: {} },
    { resolver: null },
    { store: null },
    { inboxRelays: [] },
    { inboxRelays: ['ws://insecure.example.com'] },
  ]) {
    assert.throws(() => createInbox({ ...base, ...patch }), (err) => DmError.is(err, DM_ERROR.INVALID_ARGUMENT));
  }
});

test('createSignAuth: signs the NIP-42 answer through the chat signer', async () => {
  const { alice } = await pair();
  const signAuth = createSignAuth(alice.signer);
  const event = await signAuth({ relay: 'wss://relay.example.com', challenge: 'abc' });
  assert.equal(event.kind, KIND.AUTH);
  assert.equal(event.pubkey, alice.pubkey);
  assert.equal(verifyAuthEvent(event, 'abc', 'wss://relay.example.com'), true);
});

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

test('end to end: Alice sends, Bob receives live, Alice sees her self copy', async () => {
  const { network, alice, bob } = await pair();
  await alice.inbox.start();
  await bob.inbox.start();
  await settle(alice, bob);
  assert.equal(bob.inbox.status().synced, true);

  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'hi Bob') });
  assert.equal(sent.outgoing, true);
  assert.equal(sent.partner, bob.pubkey);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sending');
  await settle(alice, bob);

  // Alice: sent, outbox empty.
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);

  // Wire: recipient wrap to Bob's relay only, self copy to Alice's relays only.
  const toBob = network.published.filter((p) => p.relay === 'wss://inbox.bob.example');
  assert.equal(toBob.length, 1);
  const toAlice = network.published.filter((p) => p.relay.includes('alice'));
  assert.ok(toAlice.length >= 1);
  assert.notEqual(toBob[0].event.id, toAlice[0].event.id);
  assert.equal(toBob[0].event.kind, KIND.GIFT_WRAP);

  // Bob: stored once, as incoming, announced as live.
  const received = bob.store.raw.messages.get(sent.id);
  assert.equal(received.text, 'hi Bob');
  assert.equal(received.outgoing, false);
  assert.equal(received.sender, alice.pubkey);
  assert.equal(bob.incoming.length, 1);
  assert.deepEqual(bob.incoming[0].info, { live: true });
  assert.equal(bob.incoming[0].message.id, sent.id);

  // Alice's own self copy came back through her subscription: no announcement,
  // and no news for the store (only Bob's relay accepting it made it "sent").
  assert.equal(alice.incoming.length, 0);
  assert.equal(alice.store.raw.ingestCalls.some((c) => c.message.id === sent.id), false);
  assert.ok(alice.store.raw.handled.has(toAlice[0].event.id), 'the self copy is remembered as handled');
});

test('end to end: Bob answers and the conversation flows both ways', async () => {
  const { alice, bob } = await pair();
  await alice.inbox.start();
  await bob.inbox.start();
  await settle(alice, bob);

  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'ping') });
  await settle(alice, bob);
  await bob.inbox.send({ partner: alice.pubkey, template: textTo(alice, 'pong') });
  await settle(alice, bob);

  assert.deepEqual(alice.incoming.map((i) => i.message.text), ['pong']);
  assert.deepEqual(bob.incoming.map((i) => i.message.text), ['ping']);
});

test('reactions are stored but never announced', async () => {
  const { alice, bob } = await pair();
  await alice.inbox.start();
  await bob.inbox.start();
  await settle(alice, bob);
  const first = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice, bob);
  const reaction = buildReactionTemplate({ recipient: alice.pubkey, targetId: first.id, emoji: '+', now: () => START_S + 1 });
  await bob.inbox.send({ partner: alice.pubkey, template: reaction });
  await settle(alice, bob);
  assert.equal(alice.incoming.length, 0);
  assert.ok(alice.store.raw.ingestCalls.some((c) => c.message.type === 'reaction'));
});

test('self copy from another device is ingested and not announced', async () => {
  const { network, alice, bob } = await pair();
  // Another device of Alice sends; its self copy sits on Alice's inbox relay.
  const other = makePerson(network, createClock());
  other.sessionKey.dispose();
  const { sealAndWrap } = await import('../giftWrap.js');
  const template = textTo(bob, 'from my other device');
  const sealed = await sealAndWrap({ template, signer: alice.signer, recipients: [bob.pubkey] });
  const self = sealed.wraps.find((w) => w.self);
  network.inject('wss://inbox.alice.example', self.event);

  await alice.inbox.start();
  await settle(alice);
  const stored = alice.store.raw.messages.get(sealed.rumor.id);
  assert.equal(stored.outgoing, true);
  assert.equal(stored.partner, bob.pubkey);
  assert.equal(alice.incoming.length, 0);
});

test('duplicate wraps (same wrap on two relays, redelivery) are ingested once', async () => {
  const { network, alice, bob } = await pair({ bobOptions: { inboxRelays: ['wss://inbox.bob.example', 'wss://inbox.bob2.example'] } });
  await bob.inbox.start();
  await settle(bob);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice, bob);
  assert.equal(network.published.filter((p) => p.relay.includes('bob')).length, 2);
  assert.equal(bob.incoming.length, 1);
  assert.equal(bob.store.raw.ingestCalls.filter((c) => c.message.id === sent.id).length, 1);

  // The same wrap arrives again later.
  const wrap = network.published.find((p) => p.relay === 'wss://inbox.bob.example').event;
  network.inject('wss://inbox.bob.example', wrap);
  await settle(bob);
  assert.equal(bob.incoming.length, 1);
  assert.equal(bob.store.raw.ingestCalls.filter((c) => c.message.id === sent.id).length, 1);
});

test('a second wrap of a stored message is dropped before the rate limit sees it', async () => {
  const { network, alice, bob } = await pair({ bobOptions: { inbox: { liveRate: { max: 1, windowMs: 60_000 } } } });
  await bob.inbox.start();
  await settle(bob);
  const first = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'one') });
  await settle(alice, bob);
  // Same rumor, freshly wrapped (e.g. another sender device): known id, so no rate charge, no second ingest.
  const { sealAndWrap } = await import('../giftWrap.js');
  assert.ok(first);
  const rewrap = await sealAndWrap({ template: textTo(bob, 'one'), signer: alice.signer, recipients: [bob.pubkey], selfCopy: false });
  assert.equal(rewrap.rumor.id, first.id);
  network.inject('wss://inbox.bob.example', rewrap.wraps[0].event);
  await settle(bob);
  assert.equal(bob.store.raw.ingestCalls.filter((c) => c.message.id === first.id).length, 1);
});

test('blocked sender: dropped after unwrap, nothing stored or announced', async () => {
  const { alice, bob } = await pair();
  bob.store.raw.blocked.add(alice.pubkey);
  await bob.inbox.start();
  await settle(bob);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'spam') });
  await settle(alice, bob);
  assert.equal(bob.store.raw.messages.has(sent.id), false);
  assert.equal(bob.store.raw.ingestCalls.length, 0);
  assert.equal(bob.incoming.length, 0);
});

test('garbage wraps (wrong recipient key, forged content) are ignored', async () => {
  const { network, alice, bob } = await pair();
  await bob.inbox.start();
  await settle(bob);
  const { sealAndWrap } = await import('../giftWrap.js');
  const stranger = makePerson(network, createClock());
  const other = makePerson(network, createClock());
  // Wrap tagged for Bob but encrypted to someone else.
  const wrongKey = await sealAndWrap({ template: textTo(other), signer: stranger.signer, recipients: [other.pubkey], selfCopy: false });
  const tampered = { ...wrongKey.wraps[0].event, tags: [['p', bob.pubkey]] };
  network.inject('wss://inbox.bob.example', tampered);
  await settle(bob);
  assert.equal(bob.store.raw.ingestCalls.length, 0);
  assert.equal(bob.inbox.status().pendingWraps, 0);
  assert.ok(alice);
});

// ---------------------------------------------------------------------------
// Live versus backfill
// ---------------------------------------------------------------------------

test('backfill is stored without announcement or rate limit; live is announced and rate limited', async () => {
  const { network, alice, bob } = await pair({ bobOptions: { inbox: { liveRate: { max: 2, windowMs: 60_000 } } } });
  // Five messages already waiting on Bob's relay while he was away.
  for (let i = 0; i < 5; i += 1) {
    await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, `old ${i}`) });
  }
  await settle(alice);
  network.holdEose = false;
  await bob.inbox.start();
  await settle(bob);
  assert.equal(bob.store.raw.messages.size, 5);
  assert.equal(bob.incoming.length, 0);

  // Live burst of four: only two pass the rate limit.
  for (let i = 0; i < 4; i += 1) {
    await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, `new ${i}`), created_at: START_S + 10 + i } });
  }
  await settle(alice, bob);
  assert.deepEqual(bob.incoming.map((i) => i.message.text), ['new 0', 'new 1']);
  assert.equal(bob.store.raw.messages.size, 7);
});

test('events before a relay EOSE are backfill, events after it are live', async () => {
  const { network, alice, bob } = await pair();
  network.holdEose = true;
  await bob.inbox.start();
  await settle(bob);
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'before eose') });
  await settle(alice, bob);
  assert.equal(bob.incoming.length, 0);
  network.releaseEose();
  await settle(bob);
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'after eose'), created_at: START_S + 5 } });
  await settle(alice, bob);
  assert.deepEqual(bob.incoming.map((i) => i.message.text), ['after eose']);
});

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

test('cursor: first sync has no since; the cursor moves to the subscription start after EOSE', async () => {
  const { network, clock, alice, bob } = await pair();
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob), created_at: START_S - 10_000 } });
  clock.ms += 5_000;
  await bob.inbox.start();
  assert.equal('since' in network.subscribed.at(-1).filter, false);
  assert.deepEqual(network.subscribed.at(-1).filter.kinds, [KIND.GIFT_WRAP]);
  assert.deepEqual(network.subscribed.at(-1).filter['#p'], [bob.pubkey]);
  await settle(bob);
  // The start time, not any event timestamp.
  assert.deepEqual(bob.store.raw.setCursorCalls, [START_S + 5]);
});

test('cursor: not advanced without EOSE, not for a closed relay', async () => {
  const { network, bob } = await pair();
  network.holdEose = true;
  await bob.inbox.start();
  await settle(bob);
  assert.equal(bob.store.raw.setCursorCalls.length, 0);
  assert.equal(bob.inbox.status().synced, false);
  network.releaseEose();
  await settle(bob);
  assert.equal(bob.store.raw.setCursorCalls.length, 1);
});

test('cursor: later syncs overlap by the slack and the cursor never moves back', async () => {
  const { network, clock, bob } = await pair({ bobOptions: { store: { cursor: START_S + 100 } } });
  await bob.inbox.start();
  assert.equal(network.subscribed.at(-1).filter.since, START_S + 100 - SINCE_SLACK_SECONDS);
  await settle(bob);
  // The run started before the stored cursor: nothing to write.
  assert.equal(bob.store.raw.setCursorCalls.length, 0);
  bob.inbox.stop();

  clock.ms += 1_000_000;
  await bob.inbox.start();
  await settle(bob);
  assert.deepEqual(bob.store.raw.setCursorCalls, [START_S + 1_000]);
});

test('cursor: a young cursor never produces a negative since', async () => {
  const { network, bob } = await pair({ bobOptions: { store: { cursor: 5 } } });
  await bob.inbox.start();
  assert.equal(network.subscribed.at(-1).filter.since, 0);
});

test('start: hydrates the resolver, warms the inbox relays and subscribes on them', async () => {
  const { network, bob } = await pair({ bobOptions: { store: {} } });
  bob.store.raw.snapshot = { version: 1, entries: {} };
  await bob.inbox.start();
  assert.deepEqual(bob.resolver.hydrated, [bob.store.raw.snapshot]);
  assert.deepEqual(network.subscribed.at(-1).relays, ['wss://inbox.bob.example/']);
  // A second start while running changes nothing.
  await bob.inbox.start();
  assert.equal(network.subscribed.length, 1);
});

test('default relay sets are the shared constants', async () => {
  const network = createNetwork();
  const clock = createClock();
  const person = makePerson(network, clock);
  const inbox = createInbox({
    me: person.pubkey,
    signer: person.signer,
    transport: network.transport(),
    resolver: person.resolver,
    store: person.store,
  });
  await inbox.start();
  inbox.stop();
  assert.deepEqual(network.subscribed.at(-1).relays.map((r) => r.replace(/\/$/, '')), [...DM_INBOX_RELAYS]);
  assert.ok(DM_DISCOVERY_RELAYS.length > 0);
});

// ---------------------------------------------------------------------------
// Wiped key
// ---------------------------------------------------------------------------

test('wiped key: wraps wait in a queue, the cursor stays, and they are opened after the next successful use', async () => {
  const { network, alice, bob } = await pair();
  await alice.inbox.start();
  await settle(alice);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'while locked') });
  await settle(alice);
  bob.keyState.available = false;
  network.holdEose = true;
  await bob.inbox.start();
  await settle(bob);
  network.releaseEose();
  await settle(bob);
  assert.equal(bob.store.raw.messages.has(sent.id), false);
  assert.equal(bob.inbox.status().pendingWraps, 1);
  assert.equal(bob.store.raw.setCursorCalls.length, 0, 'cursor must not pass a wrap we could not open');

  // Unlock; any successful use of the key (here: a retry run) drains the queue.
  bob.keyState.available = true;
  await bob.inbox.retryOutbox();
  await settle(bob);
  assert.equal(bob.store.raw.messages.get(sent.id).text, 'while locked');
  assert.equal(bob.inbox.status().pendingWraps, 0);
  assert.equal(bob.store.raw.setCursorCalls.length, 1);
  assert.ok(network);
});

test('a wrap handled in one run is not opened again after a restart', async () => {
  let decrypts = 0;
  const { alice, bob } = await pair({
    bobOptions: { wrapSigner: (local) => ({ ...local, nip44Decrypt: (...args) => { decrypts += 1; return local.nip44Decrypt(...args); } }) },
  });
  await bob.inbox.start();
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'once') });
  await settle(alice, bob);
  assert.equal(decrypts, 2, 'wrap and seal, opened once');
  assert.equal(bob.store.raw.handled.size, 1);

  bob.inbox.stop();
  await bob.inbox.start();
  await settle(bob);
  assert.equal(decrypts, 2, 'the restart re-reads the wrap but does not decrypt it again');
  assert.equal([...bob.store.raw.messages.values()].filter((m) => m.text === 'once').length, 1);
});

test('a signer app that is offline keeps wraps waiting, says why, and they open on retry', async () => {
  let online = false;
  const { alice, bob } = await pair({
    bobOptions: {
      wrapSigner: (local) => ({
        ...local,
        nip44Decrypt: (...args) => (online ? local.nip44Decrypt(...args) : Promise.reject(new DmError(DM_ERROR.SIGNER_UNAVAILABLE))),
      }),
    },
  });
  await bob.inbox.start();
  await settle(bob);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'held') });
  await settle(alice, bob);
  assert.equal(bob.store.raw.messages.has(sent.id), false);
  assert.equal(bob.store.raw.handled.size, 0, 'a held wrap is not handled');
  assert.equal(bob.inbox.status().pendingWraps, 1);
  assert.equal(bob.inbox.status().signerHold, DM_ERROR.SIGNER_UNAVAILABLE);

  online = true;
  bob.inbox.retryWaiting();
  await settle(bob);
  assert.equal(bob.store.raw.messages.get(sent.id).text, 'held');
  assert.equal(bob.inbox.status().pendingWraps, 0);
  assert.equal(bob.inbox.status().signerHold, null);
});

test('one wrap the signer never reads does not hold back the rest, and is given up after a few drains', async () => {
  let online = false;
  let poisonPeer = null;
  const { network, alice, bob } = await pair({
    bobOptions: {
      wrapSigner: (local) => ({
        ...local,
        nip44Decrypt: (peer, payload) => (online && peer !== poisonPeer
          ? local.nip44Decrypt(peer, payload)
          : Promise.reject(new DmError(DM_ERROR.SIGNER_UNAVAILABLE))),
      }),
    },
  });
  await bob.inbox.start();
  await settle(bob);
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'unreadable'), created_at: START_S } });
  const after = await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'after'), created_at: START_S + 1 } });
  await settle(alice, bob);
  assert.equal(bob.inbox.status().pendingWraps, 2, 'signer away: both wait');
  const poison = network.published.find((p) => p.relay.includes('bob')).event;
  poisonPeer = poison.pubkey;

  online = true;
  bob.inbox.retryWaiting();
  await settle(bob);
  assert.equal(bob.store.raw.messages.get(after.id).text, 'after', 'the next message is not held back');
  assert.equal(bob.inbox.status().pendingWraps, 1);

  for (let i = 1; i < MAX_WRAP_STRIKES; i += 1) {
    bob.inbox.retryWaiting();
    await settle(bob);
  }
  assert.equal(bob.inbox.status().pendingWraps, 1, 'alone it proves nothing: the signer may just be away');

  // A strike needs evidence the signer works: another wrap opening in the same drain.
  for (let i = 0; i < MAX_WRAP_STRIKES; i += 1) {
    await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, `more ${i}`) });
    await settle(alice, bob);
  }
  assert.equal(bob.inbox.status().pendingWraps, 0, 'given up as unreadable');
  assert.ok(bob.store.raw.handled.has(poison.id), 'and remembered, so it is never asked again');
});

test('wiped key: a successful use by an incoming wrap also drains the queue, in order', async () => {
  const { alice, bob } = await pair();
  await bob.inbox.start();
  await settle(bob);
  bob.keyState.available = false;
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'first'), created_at: START_S } });
  await settle(alice, bob);
  assert.equal(bob.inbox.status().pendingWraps, 1);

  bob.keyState.available = true;
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'second'), created_at: START_S + 1 } });
  await settle(alice, bob);
  assert.equal(bob.inbox.status().pendingWraps, 0);
  assert.deepEqual(
    [...bob.store.raw.messages.values()].map((m) => m.text).sort(),
    ['first', 'second'],
  );
});

test('wiped key: a real wipe between wraps defers instead of dropping', async () => {
  const { alice, bob } = await pair();
  await bob.inbox.start();
  await settle(bob);
  bob.keyState.available = false;
  bob.sessionKey.wipe('lock');
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'after lock') });
  await settle(alice, bob);
  assert.equal(bob.inbox.status().pendingWraps, 1);
  bob.keyState.available = true;
  await bob.inbox.retryOutbox();
  await settle(bob);
  assert.equal(bob.store.raw.messages.size, 1);
});

test('wiped key: an overflowing queue keeps the newest wraps and blocks the cursor for the run', async () => {
  const { network, alice, bob } = await pair();
  const { MAX_PENDING_WRAPS } = await import('../inbox.js');
  network.holdEose = true;
  bob.keyState.available = false;
  await bob.inbox.start();
  await settle(bob);
  const { sealAndWrap } = await import('../giftWrap.js');
  for (let i = 0; i < MAX_PENDING_WRAPS + 2; i += 1) {
    const sealed = await sealAndWrap({ template: { ...textTo(bob, `m${i}`), created_at: START_S + i }, signer: alice.signer, recipients: [bob.pubkey], selfCopy: false });
    network.inject('wss://inbox.bob.example', sealed.wraps[0].event);
  }
  await settle(bob);
  assert.equal(bob.inbox.status().pendingWraps, MAX_PENDING_WRAPS);
  bob.keyState.available = true;
  network.releaseEose();
  await bob.inbox.retryOutbox();
  await settle(bob);
  assert.equal(bob.inbox.status().pendingWraps, 0);
  assert.equal(bob.store.raw.messages.size, MAX_PENDING_WRAPS);
  assert.equal(bob.store.raw.setCursorCalls.length, 0, 'wraps were lost, so a restart must fetch them again');
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test('send: a partner without an inbox list throws NO_INBOX_RELAYS and stores nothing', async () => {
  const { alice, bob } = await pair();
  alice.resolver.table.set(bob.pubkey, { status: 'missing', relays: [], checkedAt: START_MS });
  await assert.rejects(
    alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) }),
    (err) => DmError.is(err, DM_ERROR.NO_INBOX_RELAYS),
  );
  assert.equal(alice.store.raw.messages.size, 0);
  assert.equal(alice.store.raw.outboxMap.size, 0);
});

test('send: rejects bad partners and templates that address someone else', async () => {
  const { alice, bob } = await pair();
  const carol = makePerson(createNetwork(), createClock());
  for (const partner of ['x', alice.pubkey, undefined]) {
    await assert.rejects(
      alice.inbox.send({ partner, template: textTo(bob) }),
      (err) => DmError.is(err, DM_ERROR.INVALID_ARGUMENT),
    );
  }
  await assert.rejects(
    alice.inbox.send({ partner: bob.pubkey, template: textTo(carol) }),
    (err) => DmError.is(err, DM_ERROR.INVALID_ARGUMENT),
  );
  await assert.rejects(
    alice.inbox.send({ partner: bob.pubkey, template: { kind: 14 } }),
    (err) => DmError.is(err, DM_ERROR.INVALID_ARGUMENT),
  );
  assert.equal(alice.store.raw.messages.size, 0);
});

test('send: with the key unavailable the error reaches the caller and nothing is stored', async () => {
  const { alice, bob } = await pair();
  alice.keyState.available = false;
  await assert.rejects(
    alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) }),
    (err) => DmError.is(err, DM_ERROR.NO_IDENTITY),
  );
  assert.equal(alice.store.raw.outboxMap.size, 0);
});

test('send: an unknown partner relay list queues the message and the timer delivers it later', async () => {
  const { network, clock, alice, bob } = await pair();
  alice.resolver.table.delete(bob.pubkey);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'later') });
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'queued');
  assert.equal(alice.store.raw.outboxMap.size, 1);
  assert.equal(network.published.length, 0);
  assert.equal(clock.pendingTimers().length, 1);

  // Still unknown on the first retry: it keeps waiting, with a longer pause.
  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs);
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'queued');
  assert.equal(alice.store.raw.outboxMap.get(sent.id).attempts, 1);
  assert.equal(clock.pendingTimers().length, 1);

  knows(alice, bob);
  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs * 2);
  await bob.inbox.start();
  await settle(alice, bob);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);
  assert.equal(clock.pendingTimers().length, 0);
  assert.equal(bob.store.raw.messages.get(sent.id).text, 'later');
});

test('send: a delivery long after the wraps were made goes out in a fresh wrap around the same seal', async () => {
  // A wrap's timestamp is randomised up to two days back when it is made; republished
  // much later it could lie before what the recipient reads, and no relay would serve it.
  const { network, clock, alice, bob } = await pair();
  alice.resolver.table.delete(bob.pubkey);
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'late') });
  const first = alice.store.raw.outboxMap.get(sent.id).wraps.recipient;

  await clock.advance(OUTBOX_DEFAULTS.rewrapAfterMs + 1);
  knows(alice, bob);
  await bob.inbox.start();
  await alice.inbox.retry(sent.id);
  await settle(alice, bob);

  const toBob = network.published.filter((p) => p.relay.includes('bob')).map((p) => p.event);
  assert.equal(toBob.length, 1);
  assert.notEqual(toBob[0].id, first.id, 'a fresh wrap, not the one made before the wait');
  assert.ok(toBob[0].created_at >= Math.floor(Date.now() / 1000) - SINCE_SLACK_SECONDS - 5, 'its timestamp is fresh');
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(bob.store.raw.messages.get(sent.id).text, 'late', 'the same message (one rumor id) arrives');
});

test('send: the self copy also goes to a relay list the person already had from another app', async () => {
  const { network, alice, bob } = await pair();
  await alice.inbox.start();
  await settle(alice);
  alice.resolver.table.set(alice.pubkey, { status: 'found', relays: ['wss://theirs.example.com/'], checkedAt: START_MS });
  await alice.inbox.ensureOwnRelayList();
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob, 'seen elsewhere') });
  await settle(alice);
  const selfRelays = network.published.filter((p) => p.relay.includes('theirs') || p.relay.includes('alice')).map((p) => p.relay);
  assert.ok(selfRelays.some((relay) => relay.includes('theirs.example.com')), 'their other app reads this relay');
  assert.ok(selfRelays.some((relay) => relay.includes('inbox.alice')), 'ours still get it');
});

test('send: all relays failing keeps the wraps in the outbox and retries with exponential backoff', async () => {
  const { network, clock, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'queued');
  const item = alice.store.raw.outboxMap.get(sent.id);
  assert.equal(item.attempts, 1);
  assert.equal(item.nextAttemptAt, START_MS + OUTBOX_DEFAULTS.baseDelayMs);
  assert.equal(item.stale, true);
  assert.deepEqual(alice.resolver.invalidated, [bob.pubkey]);

  // Too early: the timer is not due, an explicit run honours the wait.
  await alice.inbox.retryOutbox();
  assert.equal(alice.store.raw.outboxMap.get(sent.id).attempts, 1);

  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs);
  await settle(alice);
  assert.equal(alice.store.raw.outboxMap.get(sent.id).attempts, 2);
  assert.equal(
    alice.store.raw.outboxMap.get(sent.id).nextAttemptAt,
    clock.ms + OUTBOX_DEFAULTS.baseDelayMs * 2,
  );
  // A stale list is looked up again with force.
  assert.equal(alice.resolver.calls.at(-1).options.force, true);

  // Relay recovers; the same wrap is delivered.
  network.behavior.delete('wss://inbox.bob.example');
  await bob.inbox.start();
  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs * 2);
  await settle(alice, bob);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);
  const publishedIds = new Set(network.published.filter((p) => p.relay.includes('bob')).map((p) => p.event.id));
  assert.equal(publishedIds.size, 1, 'quick retries re-send the same wrap');
  assert.equal(bob.store.raw.messages.get(sent.id).text, 'hello');
});

test('send: ignoreBackoff retries at once (network is back)', async () => {
  const { network, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  network.behavior.delete('wss://inbox.bob.example');
  const run = await alice.inbox.retryOutbox({ ignoreBackoff: true });
  assert.equal(run.attempted, 1);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
});

test('send: gives up after maxAttempts, keeps the item for a manual retry', async () => {
  const { network, clock, alice, bob } = await pair({ aliceOptions: { inbox: { outbox: { maxAttempts: 3 } } } });
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  for (let i = 0; i < 2; i += 1) {
    await clock.advance(OUTBOX_DEFAULTS.maxDelayMs);
    await settle(alice);
  }
  const item = alice.store.raw.outboxMap.get(sent.id);
  assert.equal(item.attempts, 3);
  assert.equal(item.exhausted, true);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'failed');
  assert.equal(clock.pendingTimers().length, 0, 'no timer for an exhausted item');
  assert.equal(alice.inbox.status().exhausted, 1);

  // Not touched by a scheduled run...
  const before = network.published.length;
  await alice.inbox.retryOutbox();
  assert.equal(network.published.length, before);

  // ...but the network coming back gives a message that failed only on reachability a fresh try.
  await alice.inbox.retryOutbox({ ignoreBackoff: true });
  assert.equal(network.published.length, before + 1);
  await settle(alice);

  // And the user can retry it.
  network.behavior.delete('wss://inbox.bob.example');
  assert.equal(await alice.inbox.retry(sent.id), true);
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);
  assert.equal(await alice.inbox.retry(sent.id), false);
});

test('send: a refusal that cannot change (blocked) fails at once; only the person sends it again', async () => {
  const { network, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', { prefix: 'blocked' });
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'failed');
  // Kept for "Send again", but the network coming back does not resend a refusal.
  assert.equal(alice.store.raw.outboxMap.get(sent.id).exhausted, true);
  const before = network.published.length;
  await alice.inbox.retryOutbox({ ignoreBackoff: true });
  assert.equal(network.published.length, before);
  assert.equal(await alice.inbox.retry(sent.id), true);
});

test('send: a transient refusal (rate-limited) is retried', async () => {
  const { network, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', { prefix: 'rate-limited' });
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'queued');
  assert.equal(alice.store.raw.outboxMap.size, 1);
});

test('send: one accepting relay is enough; a failing self copy is retried without re-sending to the partner', async () => {
  const { network, clock, alice, bob } = await pair();
  network.behavior.set('wss://inbox.alice.example', 'fail');
  network.behavior.set('wss://inbox.alice2.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  const item = alice.store.raw.outboxMap.get(sent.id);
  assert.deepEqual(item.delivered, { recipient: true, self: false });

  network.behavior.delete('wss://inbox.alice.example');
  const toBobBefore = network.published.filter((p) => p.relay.includes('bob')).length;
  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs);
  await settle(alice);
  assert.equal(alice.store.raw.outboxMap.size, 0);
  assert.equal(network.published.filter((p) => p.relay.includes('bob')).length, toBobBefore);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
});

test('send: partial relay failure still counts as sent (first accept decides)', async () => {
  const { network, alice, bob } = await pair({ bobOptions: { inboxRelays: ['wss://inbox.bob.example', 'wss://inbox.bob2.example'] } });
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);
});

test('send: a stale list that turns into "missing" fails the message, kept for Send again', async () => {
  const { network, clock, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  alice.resolver.table.set(bob.pubkey, { status: 'missing', relays: [], checkedAt: clock.ms });
  await clock.advance(OUTBOX_DEFAULTS.baseDelayMs);
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'failed');
  assert.equal(alice.store.raw.outboxMap.get(sent.id).lastCode, DM_ERROR.NO_INBOX_RELAYS);
});

test('outbox: concurrency is bounded', async () => {
  const { network, alice, bob } = await pair({ aliceOptions: { inbox: { outbox: { concurrency: 2 } } } });
  network.behavior.set('wss://inbox.bob.example', 'fail');
  for (let i = 0; i < 5; i += 1) {
    await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, `m${i}`), created_at: START_S + i } });
  }
  await settle(alice);
  assert.equal(alice.store.raw.outboxMap.size, 5);

  // Measure parallelism of the next run.
  let running = 0;
  let peak = 0;
  const transport = network.transport();
  const original = transport.publish;
  assert.ok(original);
  const inbox = createInbox({
    me: alice.pubkey,
    signer: alice.signer,
    transport: {
      ...transport,
      publish(relays, event) {
        running += 1;
        peak = Math.max(peak, running);
        const result = network.transport().publish(relays, event);
        const done = new Promise((resolve) => setImmediate(resolve)).then(() => {
          running -= 1;
        });
        return { firstAccept: done.then(() => result.firstAccept), allSettled: done.then(() => result.allSettled) };
      },
    },
    resolver: alice.resolver,
    store: alice.store,
    now: () => START_MS,
    setTimer: () => 0,
    clearTimer: () => {},
    inboxRelays: ['wss://inbox.alice.example'],
    outbox: { concurrency: 2 },
    random: () => 0.5,
  });
  await inbox.retryOutbox({ ignoreBackoff: true });
  assert.ok(peak <= 4, `peak publishes ${peak}`); // two messages, two copies each
  assert.ok(peak >= 2);
});

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

test('stop: closes the subscription, ignores later events, clears timers, keeps the store', async () => {
  const { network, clock, alice, bob } = await pair();
  await bob.inbox.start();
  await settle(bob);
  network.behavior.set('wss://inbox.bob.example', 'fail');
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  assert.equal(clock.pendingTimers().length, 1);

  bob.inbox.stop();
  assert.equal(network.closedSubs, 1);
  assert.equal(bob.inbox.status().running, false);
  network.behavior.delete('wss://inbox.bob.example');

  alice.inbox.stop();
  assert.equal(clock.pendingTimers().length, 0);
  assert.equal(alice.store.raw.outboxMap.size, 1, 'the store stays intact');

  const { sealAndWrap } = await import('../giftWrap.js');
  const later = await sealAndWrap({ template: textTo(bob, 'late'), signer: alice.signer, recipients: [bob.pubkey], selfCopy: false });
  network.inject('wss://inbox.bob.example', later.wraps[0].event);
  await settle(bob);
  assert.equal(bob.store.raw.ingestCalls.length, 0);

  // Stop twice is fine; start again works.
  bob.inbox.stop();
  await bob.inbox.start();
  await settle(bob);
  assert.equal(bob.store.raw.messages.get(later.rumor.id).text, 'late');
});

test('start: resumes the outbox of an earlier session', async () => {
  const { network, alice, bob } = await pair();
  network.behavior.set('wss://inbox.bob.example', 'fail');
  const sent = await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  alice.inbox.stop();
  network.behavior.delete('wss://inbox.bob.example');
  await alice.inbox.start();
  await settle(alice);
  assert.equal(alice.store.raw.messages.get(sent.id).delivery, 'sent');
  assert.equal(alice.store.raw.outboxMap.size, 0);
});

// ---------------------------------------------------------------------------
// Own relay list
// ---------------------------------------------------------------------------

test('ensureOwnRelayList: publishes a signed kind 10050 when none exists', async () => {
  const { network, alice } = await pair();
  alice.resolver.table.set(alice.pubkey, { status: 'missing', relays: [], checkedAt: START_MS });
  const result = await alice.inbox.ensureOwnRelayList();
  assert.deepEqual(result, { status: 'published' });
  const published = network.published.filter((p) => p.event.kind === KIND.DM_RELAYS);
  assert.equal(published.length, 1);
  assert.equal(published[0].relay, 'wss://disco.example');
  const event = published[0].event;
  assert.equal(event.pubkey, alice.pubkey);
  assert.equal(verifyEventSignature(event), true);
  assert.deepEqual(parseInboxRelayList(event), ['wss://inbox.alice.example/', 'wss://inbox.alice2.example/']);
  assert.equal(event.created_at, START_S);
  assert.deepEqual(alice.resolver.invalidated, [alice.pubkey]);
  assert.equal(alice.resolver.calls[0].options.force, true);
});

test('ensureOwnRelayList: does nothing when the published list already matches (any order)', async () => {
  const { network, alice } = await pair();
  alice.resolver.table.set(alice.pubkey, {
    status: 'found',
    relays: ['wss://inbox.alice2.example/', 'wss://inbox.alice.example/'],
    checkedAt: START_MS,
  });
  assert.deepEqual(await alice.inbox.ensureOwnRelayList(), { status: 'unchanged' });
  assert.equal(network.published.length, 0);
});

test('cursor: it moves only once every relay we read has sent its stored events', async () => {
  const { network, alice } = await pair();
  network.holdEose = true;
  await alice.inbox.start();
  await settle(alice);
  const { relays, handlers } = network.subscribed.at(-1);
  assert.equal(relays.length, 2);
  handlers.oneose(relays[0]);
  await settle(alice);
  assert.equal(alice.store.raw.setCursorCalls.length, 0, 'a message only the slower relay holds must not be skipped');
  handlers.oneose(relays[1]);
  await settle(alice);
  assert.equal(alice.store.raw.setCursorCalls.length, 1);
});

test('resubscribe: relays the transport gave up on are read again on resume, and only then', async () => {
  const { network, alice } = await pair();
  await alice.inbox.start();
  await settle(alice);
  const before = network.subscribed.length;
  alice.inbox.resubscribe();
  assert.equal(network.subscribed.length, before, 'nothing was closed: nothing to do');
  network.subscribed.at(-1).handlers.onclosed(network.subscribed.at(-1).relays[0], 'auth-required: locked');
  alice.inbox.resubscribe();
  assert.equal(network.subscribed.length, before + 1);
  assert.equal(network.closedSubs, 1, 'the old subscription was closed');
});

test('ensureOwnRelayList: a list the person already has is kept and read as well', async () => {
  const { network, alice } = await pair();
  await alice.inbox.start();
  await settle(alice);
  const published = network.published.length;
  alice.resolver.table.set(alice.pubkey, { status: 'found', relays: ['wss://theirs.example.com/'], checkedAt: START_MS });
  assert.deepEqual(await alice.inbox.ensureOwnRelayList(), { status: 'kept' });
  assert.equal(network.published.length, published, 'nothing was replaced');
  const latest = network.subscribed.at(-1);
  assert.ok(latest.relays.includes('wss://theirs.example.com/'), 'their inbox relay is read too');
  assert.ok(latest.relays.includes('wss://inbox.alice.example/'), 'ours still are');
});

test('ensureOwnRelayList: offline (nobody answered) publishes nothing; a refusing relay reports failed', async () => {
  const { network, alice } = await pair();
  assert.deepEqual(await alice.inbox.ensureOwnRelayList(), { status: 'unknown' });
  assert.equal(network.published.length, 0);

  alice.resolver.table.set(alice.pubkey, { status: 'missing', relays: [], checkedAt: START_MS });
  network.behavior.set('wss://disco.example', 'fail');
  assert.deepEqual(await alice.inbox.ensureOwnRelayList(), { status: 'failed' });
});

test('ensureOwnRelayList: never throws (key unavailable) and concurrent calls share one run', async () => {
  const { network, alice } = await pair();
  alice.resolver.table.set(alice.pubkey, { status: 'missing', relays: [], checkedAt: START_MS });
  alice.keyState.available = false;
  assert.deepEqual(await alice.inbox.ensureOwnRelayList(), { status: 'failed' });

  alice.keyState.available = true;
  const [a, b] = await Promise.all([alice.inbox.ensureOwnRelayList(), alice.inbox.ensureOwnRelayList()]);
  assert.deepEqual(a, b);
  assert.equal(network.published.filter((p) => p.event.kind === KIND.DM_RELAYS).length, 1);
});

test('start: publishes the own relay list in the background', async () => {
  const { network, alice } = await pair();
  alice.resolver.table.set(alice.pubkey, { status: 'missing', relays: [], checkedAt: START_MS });
  await alice.inbox.start();
  await settle(alice);
  assert.equal(network.published.filter((p) => p.event.kind === KIND.DM_RELAYS).length, 1);
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test('a throwing onIncoming or a store that throws on one wrap does not stall the inbox', async () => {
  const { alice, bob } = await pair({ bobOptions: { inbox: { onIncoming: () => { throw new Error('ui bug'); } } } });
  await bob.inbox.start();
  await settle(bob);
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'one'), created_at: START_S } });
  await settle(alice, bob);

  const original = bob.store.raw.ingest;
  let calls = 0;
  bob.store.raw.ingest = (...args) => {
    calls += 1;
    if (calls === 1) throw new Error('store bug');
    return original(...args);
  };
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'two'), created_at: START_S + 1 } });
  await alice.inbox.send({ partner: bob.pubkey, template: { ...textTo(bob, 'three'), created_at: START_S + 2 } });
  await settle(alice, bob);
  assert.deepEqual([...bob.store.raw.messages.values()].map((m) => m.text).sort(), ['one', 'three']);
});

test('status: reports sync, queue and outbox', async () => {
  const { network, alice, bob } = await pair();
  assert.deepEqual(alice.inbox.status(), {
    running: false, synced: false, syncedRelays: 0, cursor: null, pendingWraps: 0, signerHold: null, outbox: 0, exhausted: 0, sending: 0,
  });
  await alice.inbox.start();
  await settle(alice);
  network.behavior.set('wss://inbox.bob.example', 'fail');
  await alice.inbox.send({ partner: bob.pubkey, template: textTo(bob) });
  await settle(alice);
  const status = alice.inbox.status();
  assert.equal(status.running, true);
  assert.equal(status.synced, true);
  assert.equal(status.syncedRelays, 2);
  assert.equal(status.outbox, 1);
  assert.equal(status.cursor, START_S);
});
