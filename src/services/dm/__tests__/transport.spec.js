/**
 * Contact chat transport tests.
 *
 * The transport is the one module that talks to hostile third parties, so the
 * cases are the relay behaviours that make NIP-42 AUTH hard, replayed against
 * an in-memory relay (`fakeRelay.js`): a challenge on connect, a challenge only
 * after a refusal, a nested `ERROR: auth-required` prefix, an AUTH the relay
 * rejects or never answers, drops, refused and never-opening connections,
 * silent relays. The two rules that must never break get their own tests: the
 * identity authenticates only read sockets, and an ephemeral key only write
 * sockets. Every test ends by proving that no timer and no socket is left
 * behind.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/transport.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthEvent, generateSecretKey, getPublicKey } from 'nostr-core';
import { DM_ERROR, DmError } from '../errors.js';
import {
  DM_TRANSPORT_DEFAULTS,
  RELAY_ROLE,
  RELAY_STATE,
  backoffDelay,
  createDmTransport,
} from '../transport.js';
import { RELAY_TEXT, createFakeNetwork, liveRelayProfiles, makeEvent } from './fakeRelay.js';

const NOSTR1 = 'wss://auth.nostr1.com';
const DAMUS = 'wss://relay.damus.io';
const OPEN = 'wss://nos.lol';
const PROFILES = liveRelayProfiles();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isCode = (code) => (err) => DmError.is(err, code);

/** Poll until `condition()` holds; fail loudly (with `label`) instead of hanging. */
async function waitFor(condition, label = 'condition', timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await sleep(2);
  }
}

/** Let in-flight frames and timers settle when the test needs to see that nothing more happens. */
const settle = (ms = 40) => sleep(ms);

/**
 * Everything a transport test needs: a network, an identity, a signer that
 * records its calls, ephemeral keys that record their public keys, and timers
 * that remember what is still outstanding.
 */
/**
 * Time budgets. The harness runs on real timers, so its default must leave room
 * for a busy machine (Schnorr signing, a loaded CI): a handshake that would
 * succeed must never time out. It only bounds a hang; a passing test resolves
 * on events, not on these. A test ABOUT a timeout opts into SHORT explicitly.
 */
const RELAXED_MS = 1_500;
const SHORT_MS = 60;
const SHORT_TIMEOUTS = Object.freeze({ connectTimeoutMs: SHORT_MS, publishTimeoutMs: SHORT_MS, authTimeoutMs: SHORT_MS });

function createHarness(overrides = {}) {
  const network = createFakeNetwork();
  const identity = generateSecretKey();
  const identityPubkey = getPublicKey(identity);
  const signCalls = [];
  const ephemeralPubkeys = [];
  const statuses = [];
  const liveTimers = new Set();
  let clock = 0;

  const signAuth = overrides.signAuth ?? (async ({ relay, challenge }) => {
    signCalls.push({ relay, challenge });
    return createAuthEvent({ relay, challenge }, identity);
  });
  const setTimer = (fn, ms) => {
    const handle = setTimeout(() => {
      liveTimers.delete(handle);
      fn();
    }, ms);
    liveTimers.add(handle);
    return handle;
  };
  const clearTimer = (handle) => {
    liveTimers.delete(handle);
    clearTimeout(handle);
  };

  const transport = createDmTransport({
    signAuth,
    WebSocket: network.WebSocket,
    connectTimeoutMs: RELAXED_MS,
    publishTimeoutMs: RELAXED_MS,
    authTimeoutMs: RELAXED_MS,
    connectRetry: { initialDelay: 5, maxDelay: 20, factor: 2, jitter: 0 },
    reconnect: { initialDelay: 5, maxDelay: 20, factor: 2, jitter: 0, connectionTimeout: RELAXED_MS },
    writeIdleMs: 5_000,
    readIdleMs: 5_000,
    authRetryCooldownMs: 1_000,
    createEphemeralKey: () => {
      const key = generateSecretKey();
      ephemeralPubkeys.push(getPublicKey(key));
      return key;
    },
    random: () => 0.5,
    now: () => clock,
    setTimer,
    clearTimer,
    onStatus: (snapshot) => statuses.push(snapshot),
    ...overrides.options,
  });

  return {
    network,
    identity,
    identityPubkey,
    transport,
    signCalls,
    ephemeralPubkeys,
    statuses,
    liveTimers,
    setClock: (value) => { clock = value; },
    /** The state of the (single) connection of a role to a relay. */
    stateOf(url, role = RELAY_ROLE.READ) {
      const key = network.relay(url).url;
      return transport.status().find((s) => s.url === key && s.role === role);
    },
    /** Close everything and prove nothing leaked. */
    finish() {
      transport.close();
      assert.equal(liveTimers.size, 0, 'transport timers must all be cleared by close()');
      network.dispose();
    },
  };
}

/** Run `body` with a harness and always tear it down. */
async function withHarness(overrides, body) {
  const harness = createHarness(overrides);
  try {
    await body(harness);
  } finally {
    harness.finish();
  }
}

/** Handlers that record everything a subscription reports. */
function collector() {
  const events = [];
  const eoses = [];
  const closed = [];
  return {
    events,
    eoses,
    closed,
    handlers: {
      onevent: (event, relay) => events.push({ id: event.id, relay }),
      oneose: (relay) => eoses.push(relay),
      onclosed: (relay, reason) => closed.push({ relay, reason }),
    },
  };
}

const inboxFilter = (pubkey) => ({ kinds: [1059], '#p': [pubkey] });

/** A wrap-like event addressed to `pubkey`, signed by a stranger. */
function wrapFor(pubkey, content = 'x') {
  return makeEvent(generateSecretKey(), { kind: 1059, content, tags: [['p', pubkey]] });
}

const frames = (server, type) => server.received.filter((r) => r.frame[0] === type);

// ---------------------------------------------------------------------------
// Construction and pure helpers
// ---------------------------------------------------------------------------

test('createDmTransport requires a signer and a WebSocket implementation', () => {
  const WebSocket = createFakeNetwork().WebSocket;
  assert.throws(() => createDmTransport({ WebSocket }), isCode(DM_ERROR.INVALID_ARGUMENT));
  assert.throws(() => createDmTransport({ signAuth: 'nope', WebSocket }), isCode(DM_ERROR.INVALID_ARGUMENT));
  assert.throws(
    () => createDmTransport({ signAuth: async () => ({}), WebSocket: 'ws' }),
    isCode(DM_ERROR.INVALID_ARGUMENT),
  );
});

test('createDmTransport rejects nonsensical timing options', () => {
  const base = { signAuth: async () => ({}), WebSocket: createFakeNetwork().WebSocket };
  for (const bad of [
    { connectTimeoutMs: 0 },
    { publishTimeoutMs: -1 },
    { authTimeoutMs: Number.NaN },
    { writeIdleMs: '5' },
    { connectRetry: { jitter: 2 } },
    { connectRetry: { initialDelay: 0 } },
  ]) {
    assert.throws(() => createDmTransport({ ...base, ...bad }), isCode(DM_ERROR.INVALID_ARGUMENT), JSON.stringify(bad));
  }
});

test('the exposed API is frozen and the defaults are sane', () => {
  const harness = createHarness();
  try {
    assert.ok(Object.isFrozen(harness.transport));
    assert.deepEqual(
      Object.keys(harness.transport).sort(),
      ['close', 'publish', 'resetIdentity', 'status', 'subscribe', 'warmUp'],
    );
  } finally {
    harness.finish();
  }
  assert.ok(Object.isFrozen(DM_TRANSPORT_DEFAULTS));
  assert.ok(DM_TRANSPORT_DEFAULTS.connectRetry.initialDelay < DM_TRANSPORT_DEFAULTS.connectRetry.maxDelay);
});

test('backoffDelay grows exponentially, is capped, and jitters symmetrically', () => {
  const retry = { initialDelay: 1000, maxDelay: 8000, factor: 2, jitter: 0.5 };
  const mid = () => 0.5;
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((n) => backoffDelay(retry, n, mid)), [1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(backoffDelay(retry, 0, () => 0), 500);
  assert.equal(backoffDelay(retry, 0, () => 1), 1500);
  assert.equal(backoffDelay({ ...retry, jitter: 0 }, 2, () => 0.99), 4000);
  assert.ok(backoffDelay(retry, 0, () => 0.1234) >= 0);
});

// ---------------------------------------------------------------------------
// subscribe: AUTH on read connections
// ---------------------------------------------------------------------------

test('read: challenge on connect (auth.nostr1.com) is answered with the identity and the inbox is served', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const stored = wrapFor(h.identityPubkey);
    relay.inject(stored);
    const c = collector();

    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1, 'the stored wrap');
    await waitFor(() => c.eoses.length === 1, 'EOSE');

    assert.deepEqual(c.events, [{ id: stored.id, relay: 'wss://auth.nostr1.com/' }]);
    assert.equal(h.signCalls.length, 1);
    assert.equal(h.signCalls[0].relay, 'wss://auth.nostr1.com/');
    assert.deepEqual(relay.authLog.map((a) => [a.pubkey, a.accepted]), [[h.identityPubkey, true]]);
    // REQ, CLOSED auth-required, AUTH, then exactly one more REQ.
    assert.equal(frames(relay, 'REQ').length, 2);
    assert.deepEqual(h.stateOf(NOSTR1), {
      url: 'wss://auth.nostr1.com/',
      role: 'read',
      state: 'ready',
      authenticated: true,
      lastReason: null,
    });
    assert.deepEqual(c.closed, []);
  });
});

test('read: live events pushed after AUTH reach the subscriber', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => h.stateOf(NOSTR1).authenticated && c.eoses.length === 1, 'authenticated and EOSE');

    const live = wrapFor(h.identityPubkey);
    relay.inject(live);
    await waitFor(() => c.events.length === 1, 'the live wrap');
    assert.equal(c.events[0].id, live.id);
  });
});

test('read: challenge only after the refusal (damus-like relay with working AUTH) still ends served', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, { ...PROFILES.damus, authResult: 'ok' });
    const stored = wrapFor(h.identityPubkey);
    relay.inject(stored);
    const c = collector();

    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1, 'the stored wrap after late AUTH');

    assert.equal(h.signCalls.length, 1);
    assert.equal(frames(relay, 'REQ').length, 2, 'one REQ, one re-REQ after AUTH');
    assert.deepEqual(c.closed, []);
    assert.equal(h.stateOf(DAMUS).authenticated, true);
  });
});

test('read: a CLOSED that was already on the wire when AUTH completed is re-sent at once, not awaited', async () => {
  await withHarness({}, async (h) => {
    // The refusal is held back until after our AUTH was accepted.
    const relay = h.network.addRelay(NOSTR1, { ...PROFILES.nostr1, refusalDelayMs: 40 });
    const stored = wrapFor(h.identityPubkey);
    relay.inject(stored);
    const c = collector();

    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1, 'the stored wrap');
    assert.equal(h.signCalls.length, 1);
    assert.equal(frames(relay, 'REQ').length, 2);
    assert.deepEqual(c.closed, []);
  });
});

test('read: the nested "ERROR: auth-required: ..." prefix is recognised as auth-required', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, {
      challengeAfterRefusal: true,
      requireAuthToRead: true,
      readRefusal: RELAY_TEXT.AUTH_REQUIRED_NESTED,
    });
    relay.inject(wrapFor(h.identityPubkey));
    const c = collector();
    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1, 'the stored wrap');
    assert.deepEqual(c.closed, []);
  });
});

test('read: damus/nostr.net whose AUTH is broken report onclosed once, mark auth-failed, and are never retried', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, PROFILES.damus);
    const c = collector();

    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed');

    assert.equal(c.closed[0].relay, 'wss://relay.damus.io/');
    assert.equal(c.closed[0].reason, `auth-failed: ${RELAY_TEXT.AUTH_BROKEN}`);
    const status = h.stateOf(DAMUS);
    assert.equal(status.state, RELAY_STATE.AUTH_FAILED);
    assert.equal(status.authenticated, false);
    assert.equal(status.lastReason, `auth-failed: ${RELAY_TEXT.AUTH_BROKEN}`);

    // Nothing keeps trying: one challenge, one AUTH, one REQ, one socket.
    await settle(80);
    assert.equal(h.signCalls.length, 1);
    assert.equal(relay.authLog.length, 1);
    assert.equal(frames(relay, 'REQ').length, 1);
    assert.equal(h.network.sockets.length, 1);
    assert.equal(c.closed.length, 1);
  });
});

test('read: a relay that fails AUTH does not take the healthy relays down with it', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(DAMUS, PROFILES.damus);
    const good = h.network.addRelay(OPEN, PROFILES.open);
    const stored = wrapFor(h.identityPubkey);
    good.inject(stored);
    const c = collector();

    h.transport.subscribe([DAMUS, OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1 && c.closed.length === 1, 'one event and one closed');

    assert.deepEqual(c.events, [{ id: stored.id, relay: 'wss://nos.lol/' }]);
    assert.equal(c.closed[0].relay, 'wss://relay.damus.io/');
    assert.equal(h.stateOf(OPEN).state, 'ready');
  });
});

test('read: open relays never see a signature and report not authenticated', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const stored = wrapFor(h.identityPubkey);
    relay.inject(stored);
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length === 1, 'EOSE');

    assert.equal(c.events.length, 1);
    assert.equal(h.signCalls.length, 0);
    assert.equal(relay.authLog.length, 0);
    assert.deepEqual(
      [h.stateOf(OPEN).state, h.stateOf(OPEN).authenticated],
      ['ready', false],
    );
  });
});

test('read: signAuth rejecting (KEY_WIPED) fails AUTH without anything reaching the relay', async () => {
  const signAuth = async () => { throw new DmError(DM_ERROR.KEY_WIPED, 'key wiped'); };
  await withHarness({ signAuth }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed');

    assert.equal(c.closed[0].reason, 'auth-failed: key wiped');
    assert.equal(relay.authLog.length, 0, 'no AUTH event was ever sent');
    assert.equal(h.stateOf(NOSTR1).state, 'auth-failed');
  });
});

test('read: a signer that returns something other than a kind 22242 event fails AUTH', async () => {
  const signAuth = async () => ({ id: 'abc', kind: 1 });
  await withHarness({ signAuth }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed');
    assert.match(c.closed[0].reason, /^auth-failed: /);
    assert.equal(relay.authLog.length, 0);
  });
});

test('read: an AUTH the relay never answers times out into auth-failed', async () => {
  await withHarness({ options: SHORT_TIMEOUTS }, async (h) => {
    h.network.addRelay(NOSTR1, { ...PROFILES.nostr1, authResult: 'silent' });
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed after the AUTH timeout');
    assert.equal(c.closed[0].reason, 'auth-failed: auth timed out');
    assert.equal(h.stateOf(NOSTR1).state, 'auth-failed');
  });
});

test('read: a relay that demands auth but never sends a challenge fails after authTimeoutMs', async () => {
  await withHarness({ options: SHORT_TIMEOUTS }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, { requireAuthToRead: true });
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);

    await waitFor(() => h.stateOf(NOSTR1)?.state === 'authenticating', 'waiting for a challenge');
    await waitFor(() => c.closed.length === 1, 'onclosed after the challenge wait');
    assert.match(c.closed[0].reason, /^auth-failed: relay sent no auth challenge/);
    assert.equal(h.signCalls.length, 0);
    assert.equal(frames(relay, 'REQ').length, 1);
  });
});

test('read: refused although authenticated is re-sent once per AUTH, then reported, never looped', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, {
      challengeOnConnect: true,
      readRefusalAlways: true,
    });
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed');
    await settle(60);

    assert.equal(c.closed[0].reason, RELAY_TEXT.AUTH_REQUIRED);
    assert.equal(frames(relay, 'REQ').length, 2, 'initial REQ plus one re-send after the AUTH');
    assert.equal(h.signCalls.length, 1);
  });
});

test('read: other CLOSED reasons are reported verbatim and not retried', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, {
      requireAuthToRead: true,
      readRefusal: 'blocked: you are not welcome',
    });
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed');
    await settle(40);
    assert.deepEqual(c.closed, [{ relay: 'wss://nos.lol/', reason: 'blocked: you are not welcome' }]);
    assert.equal(frames(relay, 'REQ').length, 1);
    assert.equal(h.signCalls.length, 0);
  });
});

test('read: a transient CLOSED (rate-limited) is retried with backoff and then served', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, {
      requireAuthToRead: true,
      readRefusal: 'rate-limited: slow down',
    });
    relay.inject(wrapFor(h.identityPubkey));
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);

    await waitFor(() => frames(relay, 'REQ').length >= 2, 'a second REQ');
    relay.behavior.requireAuthToRead = false; // the relay calms down
    await waitFor(() => c.events.length === 1, 'the stored wrap');
    assert.deepEqual(c.closed, []);
  });
});

test('read: a relay that rate-limits for ever is given up on after maxResubscribes', async () => {
  await withHarness({ options: { maxResubscribes: 2 } }, async (h) => {
    const relay = h.network.addRelay(OPEN, { readRefusalAlways: true, readRefusal: 'error: try later' });
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.closed.length === 1, 'onclosed after the retry budget');
    assert.equal(c.closed[0].reason, 'error: try later');
    assert.equal(frames(relay, 'REQ').length, 3, 'initial + 2 re-sends');
  });
});

test('read: duplicates from several relays are all delivered', async () => {
  await withHarness({}, async (h) => {
    const shared = wrapFor(h.identityPubkey);
    for (const url of [OPEN, NOSTR1]) {
      const relay = h.network.addRelay(url, url === NOSTR1 ? PROFILES.nostr1 : PROFILES.open);
      relay.inject(shared);
    }
    const c = collector();
    h.transport.subscribe([OPEN, NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 2, 'both copies');
    assert.deepEqual(c.events.map((e) => e.relay).sort(), ['wss://auth.nostr1.com/', 'wss://nos.lol/']);
    assert.equal(new Set(c.events.map((e) => e.id)).size, 1);
  });
});

test('read: a throwing handler is contained and later events still arrive', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const seen = [];
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), {
      onevent: (event) => { seen.push(event.id); throw new Error('consumer bug'); },
      oneose: () => { throw new Error('consumer bug'); },
    });
    await waitFor(() => frames(relay, 'REQ').length === 1, 'REQ');
    const first = wrapFor(h.identityPubkey);
    const second = wrapFor(h.identityPubkey);
    relay.inject(first);
    relay.inject(second);
    await waitFor(() => seen.length === 2, 'both events despite throwing handlers');
  });
});

test('read: relays are keyed by normalised URL, so spelling variants share one socket', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const c = collector();
    h.transport.subscribe(['WSS://NOS.LOL', 'wss://nos.lol/', 'nos.lol'], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length >= 1, 'EOSE');
    await settle(20);
    assert.equal(h.network.sockets.length, 1);
    assert.equal(frames(relay, 'REQ').length, 1);
    assert.equal(h.transport.status().length, 1);
  });
});

test('read: two logical subscriptions share a socket and close independently', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const a = collector();
    const b = collector();
    const subA = h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), a.handlers);
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), b.handlers);
    await waitFor(() => a.eoses.length === 1 && b.eoses.length === 1, 'both EOSE');
    assert.equal(h.network.sockets.length, 1);

    subA.close();
    subA.close(); // idempotent
    await waitFor(() => frames(relay, 'CLOSE').length === 1, 'CLOSE for the first only');
    relay.inject(wrapFor(h.identityPubkey));
    await waitFor(() => b.events.length === 1, 'event for the remaining subscription');
    assert.equal(a.events.length, 0);
    assert.deepEqual(a.closed, [], 'closing yourself is not reported');
  });
});

test('subscribe validates its arguments synchronously', async () => {
  await withHarness({}, async (h) => {
    const f = inboxFilter(h.identityPubkey);
    const bad = isCode(DM_ERROR.INVALID_ARGUMENT);
    assert.throws(() => h.transport.subscribe('wss://nos.lol', f), bad);
    assert.throws(() => h.transport.subscribe([42], f), bad);
    assert.throws(() => h.transport.subscribe(['http://nos.lol.example'], f), bad, 'ws:// is refused for non-loopback hosts');
    assert.throws(() => h.transport.subscribe(['wss://user:pw@nos.lol'], f), bad);
    assert.throws(() => h.transport.subscribe(['wss://nos.lol'], []), bad);
    assert.throws(() => h.transport.subscribe(['wss://nos.lol'], 'filter'), bad);
    assert.throws(() => h.transport.subscribe(['wss://nos.lol'], f, { onevent: 'x' }), bad);
    assert.equal(h.network.sockets.length, 0, 'invalid calls open nothing');
    const none = h.transport.subscribe([], f);
    none.close();
  });
});

// ---------------------------------------------------------------------------
// subscribe: connection failures, drops, reconnects
// ---------------------------------------------------------------------------

test('read: a relay that is down at start is retried with backoff until it comes up', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, { ...PROFILES.open, refuse: true });
    relay.inject(wrapFor(h.identityPubkey));
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);

    await waitFor(() => h.network.sockets.length >= 3, 'several connection attempts');
    // Between attempts the state flips offline -> connecting; the reason stays.
    assert.ok(['offline', 'connecting'].includes(h.stateOf(OPEN).state));
    assert.match(h.stateOf(OPEN).lastReason, /^connect failed: /);
    assert.deepEqual(c.closed, [], 'connection trouble is not a closed subscription');

    relay.behavior.refuse = false;
    await waitFor(() => c.events.length === 1, 'the wrap once the relay is back');
    assert.equal(h.stateOf(OPEN).state, 'ready');
    assert.equal(h.network.liveSockets.length, 1);
  });
});

test('read: a connection that never opens times out, its socket is closed, and it is retried', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, { ...PROFILES.open, hang: true });
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);

    await waitFor(() => h.network.sockets.length >= 2, 'a second attempt after the timeout');
    assert.equal(h.network.sockets[0].readyState, 3, 'the hung socket was closed, not leaked');

    relay.behavior.hang = false;
    await waitFor(() => c.eoses.length === 1, 'EOSE once it opens');
    assert.equal(h.network.liveSockets.length, 1);
  });
});

test('read: closing the subscription during backoff stops all connection attempts', async () => {
  await withHarness({ options: { readIdleMs: 10 } }, async (h) => {
    h.network.addRelay(OPEN, { refuse: true });
    const sub = h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), {});
    await waitFor(() => h.network.sockets.length >= 2, 'retries under way');
    sub.close();
    await waitFor(() => h.transport.status().length === 0, 'the idle read connection retired');
    const attempts = h.network.sockets.length;
    await settle(60);
    assert.equal(h.network.sockets.length, attempts, 'no attempt after close');
    assert.equal(h.liveTimers.size, 0);
  });
});

test('read: after a drop the relay reconnects, re-authenticates and serves new events', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => h.stateOf(NOSTR1).authenticated && c.eoses.length === 1, 'first AUTH');

    relay.dropAll();
    await waitFor(() => h.stateOf(NOSTR1).state === 'offline', 'offline after the drop');
    assert.equal(h.stateOf(NOSTR1).authenticated, false);
    await waitFor(() => h.stateOf(NOSTR1).authenticated, 're-authenticated on the new socket');

    assert.equal(h.signCalls.length, 2);
    assert.equal(relay.authLog.filter((a) => a.accepted).length, 2);
    assert.notEqual(relay.authLog[0].connection, relay.authLog[1].connection);

    await waitFor(() => relay.open[0] && [...relay.open[0].subs.keys()].length === 1, 'REQ restored');
    const afterDrop = wrapFor(h.identityPubkey);
    relay.inject(afterDrop);
    await waitFor(() => c.events.some((e) => e.id === afterDrop.id), 'an event after the reconnect');
    assert.deepEqual(c.closed, []);
  });
});

test('read: with nostr-core reconnect disabled the transport recovers by itself', async () => {
  await withHarness({ options: { reconnect: false } }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => h.stateOf(NOSTR1).authenticated && c.eoses.length === 1, 'first AUTH');

    relay.dropAll();
    await waitFor(() => h.signCalls.length === 2 && h.stateOf(NOSTR1).authenticated, 'second AUTH');
    const afterDrop = wrapFor(h.identityPubkey);
    await waitFor(() => relay.open[0] && relay.open[0].subs.size === 1, 'REQ restored');
    relay.inject(afterDrop);
    await waitFor(() => c.events.some((e) => e.id === afterDrop.id), 'an event after the recovery');
    assert.equal(h.network.liveSockets.length, 1);
  });
});

test('read: a drop while AUTH is in flight does not strand the subscription or send the stale signature', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const identity = generateSecretKey();
  const pubkey = getPublicKey(identity);
  let calls = 0;
  const signAuth = async ({ relay, challenge }) => {
    calls += 1;
    if (calls === 1) await gate; // the first signature is held while the socket drops
    return createAuthEvent({ relay, challenge }, identity);
  };
  await withHarness({ signAuth }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(pubkey), c.handlers);
    await waitFor(() => calls === 1, 'signer called');
    relay.dropAll();
    await waitFor(() => calls === 2, 'second challenge on the new socket');
    relay.inject(wrapFor(pubkey));
    await waitFor(() => c.events.length === 1, 'served after recovery');
    release();
    await settle(30);
    assert.equal(relay.authLog.length, 1, 'the stale first signature was never sent');
  });
});

// ---------------------------------------------------------------------------
// Challenge handling is hardened against hostile relays
// ---------------------------------------------------------------------------

test('hostile challenges: non-strings are ignored and floods are coalesced', async () => {
  let active = 0;
  let maxActive = 0;
  const identity = generateSecretKey();
  const signAuth = async ({ relay, challenge }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(5);
    active -= 1;
    return createAuthEvent({ relay, challenge }, identity);
  };
  await withHarness({ signAuth }, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length === 1, 'connected');

    const connection = relay.connections[0];
    for (const junk of [42, null, '', { x: 1 }, ['a']]) connection.send(['AUTH', junk]);
    await settle(30);
    assert.equal(maxActive, 0, 'junk challenges never reach the signer');

    for (let i = 0; i < 20; i += 1) relay.challengeAll();
    await waitFor(() => relay.authLog.length >= 2, 'the coalesced challenges answered');
    await settle(60);
    assert.equal(maxActive, 1, 'never two signatures at once');
    assert.equal(relay.authLog.length, 2, 'the first challenge plus only the newest queued one');
    assert.deepEqual(
      relay.authLog.map((a) => a.accepted),
      [false, true],
      'the first answer was stale by then; the newest challenge was answered before giving up',
    );
    assert.equal(h.stateOf(OPEN).authenticated, true);
  });
});

test('hostile challenges: a relay re-challenging for ever gets a bounded number of answers', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length === 1, 'connected');

    for (let i = 0; i < 14; i += 1) {
      relay.challengeAll();
      await sleep(12);
    }
    assert.equal(h.signCalls.length, 8);
  });
});

test('auth-failed read sockets are only retried by a later subscribe, after the cooldown', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(DAMUS, PROFILES.damus);
    const first = collector();
    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), first.handlers);
    await waitFor(() => first.closed.length === 1, 'first failure');
    assert.equal(h.network.sockets.length, 1);

    // Inside the cooldown a new subscribe reuses the failed socket: refused, reported, no new AUTH.
    h.setClock(500);
    const second = collector();
    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), second.handlers);
    await waitFor(() => second.closed.length === 1, 'refusal inside the cooldown');
    assert.equal(h.network.sockets.length, 1);
    assert.equal(h.signCalls.length, 1);
    assert.equal(second.closed[0].reason, first.closed[0].reason);

    // After the cooldown the next subscribe is a new connection and may try AUTH again.
    h.setClock(5_000);
    const third = collector();
    h.transport.subscribe([DAMUS], inboxFilter(h.identityPubkey), third.handlers);
    await waitFor(() => h.signCalls.length === 2, 'a second AUTH attempt on a fresh socket');
    await waitFor(() => third.closed.length === 1, 'the third refusal');
    assert.equal(h.network.sockets.length, 2);
  });
});

test('an AUTH the signer could not answer (app locked) is retried by the next subscribe, without cooldown', async () => {
  const identity = generateSecretKey();
  const pubkey = getPublicKey(identity);
  let locked = true;
  const signAuth = async ({ relay, challenge }) => {
    if (locked) throw new DmError(DM_ERROR.KEY_WIPED, 'the app is locked');
    return createAuthEvent({ relay, challenge }, identity);
  };
  await withHarness({ signAuth }, async (h) => {
    h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const first = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(pubkey), first.handlers);
    await waitFor(() => first.closed.length === 1, 'refused while locked');

    // Unlocked a moment later, well inside the 1 s cooldown: the next subscribe authenticates.
    locked = false;
    h.setClock(10);
    const second = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(pubkey), second.handlers);
    await waitFor(() => second.eoses.length === 1, 'served after AUTH');
    assert.equal(second.closed.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Roles: identity vs ephemeral key
// ---------------------------------------------------------------------------

test('roles: a relay in both sets gets two sockets; only the read socket carries the identity', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length === 1, 'read ready');

    const event = makeEvent(generateSecretKey(), { kind: 1059, tags: [['p', 'c'.repeat(64)]] });
    const { allSettled } = h.transport.publish([NOSTR1], event);
    const [outcome] = await allSettled;
    assert.equal(outcome.ok, true);

    assert.equal(relay.connections.length, 2, 'one read and one write socket');
    assert.equal(h.network.liveSockets.length, 2);
    const reader = relay.connections.find((conn) => conn.received.some((f) => f[0] === 'REQ'));
    const writer = relay.connections.find((conn) => conn.received.some((f) => f[0] === 'EVENT'));
    assert.notEqual(reader, writer);
    assert.equal(reader.authedPubkey, h.identityPubkey);
    assert.notEqual(writer.authedPubkey, h.identityPubkey);
    assert.equal(writer.authedPubkey, h.ephemeralPubkeys[0]);
    assert.equal(h.signCalls.length, 1, 'signAuth (identity) ran for the read socket only');
    assert.ok(!h.ephemeralPubkeys.includes(reader.authedPubkey));
    assert.deepEqual(
      h.transport.status().map((s) => s.role).sort(),
      ['read', 'write'],
    );
  });
});

test('roles: across many relays and publishes the identity never signs on a write socket', async () => {
  await withHarness({}, async (h) => {
    const urls = ['wss://a.test', 'wss://b.test', 'wss://c.test'];
    const servers = urls.map((url) => h.network.addRelay(url, PROFILES.nostr1));
    h.transport.subscribe(urls, inboxFilter(h.identityPubkey), {});
    for (let i = 0; i < 3; i += 1) {
      const event = makeEvent(generateSecretKey(), { kind: 1059, content: `m${i}` });
      await h.transport.publish(urls, event).allSettled;
    }
    for (const server of servers) {
      for (const conn of server.connections) {
        const reads = conn.received.some((f) => f[0] === 'REQ');
        const writes = conn.received.some((f) => f[0] === 'EVENT');
        assert.ok(!(reads && writes), 'a socket never mixes roles');
        if (writes) {
          assert.notEqual(conn.authedPubkey, h.identityPubkey);
          assert.ok(h.ephemeralPubkeys.includes(conn.authedPubkey));
        }
        if (reads) assert.equal(conn.authedPubkey, h.identityPubkey);
      }
    }
    assert.equal(new Set(h.ephemeralPubkeys).size, h.ephemeralPubkeys.length, 'a fresh key per connection');
  });
});

test('roles: a new write connection after a drop uses a new ephemeral key', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    await h.transport.publish([NOSTR1], makeEvent(generateSecretKey())).allSettled;
    relay.dropAll();
    await waitFor(() => h.stateOf(NOSTR1, 'write').state === 'offline', 'write socket noticed the drop');
    const [again] = await h.transport.publish([NOSTR1], makeEvent(generateSecretKey(), { content: 'two' })).allSettled;
    assert.equal(again.ok, true);
    assert.equal(h.ephemeralPubkeys.length, 2);
    assert.notEqual(h.ephemeralPubkeys[0], h.ephemeralPubkeys[1]);
    assert.deepEqual(
      relay.authLog.map((a) => a.pubkey),
      h.ephemeralPubkeys,
    );
    assert.equal(h.signCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

test('publish: an open relay accepts; the result has the documented shape', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const event = makeEvent(generateSecretKey());
    const { firstAccept, allSettled } = h.transport.publish([OPEN], event);
    const first = await firstAccept;
    const all = await allSettled;

    assert.deepEqual(first, {
      relay: 'wss://nos.lol/', ok: true, prefix: null, message: '', code: null, attempts: 1,
    });
    assert.deepEqual(all, [first]);
    assert.deepEqual(relay.events.map((e) => e.id), [event.id]);
    assert.equal(h.signCalls.length, 0);
    assert.equal(relay.authLog.length, 0);
  });
});

test('publish: auth.nostr1.com refuses anonymous writes, so the write socket authenticates (ephemeral) and succeeds', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const event = makeEvent(generateSecretKey());
    const [outcome] = await h.transport.publish([NOSTR1], event).allSettled;

    assert.equal(outcome.ok, true);
    assert.ok(outcome.attempts <= 2);
    assert.deepEqual(relay.events.map((e) => e.id), [event.id]);
    assert.equal(relay.authLog.length, 1);
    assert.equal(relay.authLog[0].pubkey, h.ephemeralPubkeys[0]);
    assert.equal(h.stateOf(NOSTR1, 'write').authenticated, true);
  });
});

test('publish asIdentity: a relay that refused an anonymous write is answered with the identity, on its own socket', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const anonymous = makeEvent(generateSecretKey());
    const known = makeEvent(generateSecretKey());
    assert.equal((await h.transport.publish([NOSTR1], anonymous).allSettled)[0].ok, true);
    const [outcome] = await h.transport.publish([NOSTR1], known, { asIdentity: true }).allSettled;

    assert.equal(outcome.ok, true);
    assert.deepEqual(relay.authLog.map((auth) => auth.pubkey), [h.ephemeralPubkeys[0], h.identityPubkey]);
    assert.equal(h.signCalls.length, 1, 'the identity signed exactly one AUTH, for the identity write');
    assert.equal(h.stateOf(NOSTR1, RELAY_ROLE.WRITE).authenticated, true, 'the anonymous socket stays anonymous');
    assert.equal(h.stateOf(NOSTR1, RELAY_ROLE.IDENTITY_WRITE).authenticated, true);
  });
});

test('resetIdentity also closes the identity write sockets; anonymous ones stay', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(NOSTR1, PROFILES.nostr1);
    await h.transport.publish([NOSTR1], makeEvent(generateSecretKey())).allSettled;
    await h.transport.publish([NOSTR1], makeEvent(generateSecretKey()), { asIdentity: true }).allSettled;
    assert.deepEqual(h.transport.status().map((s) => s.role).sort(), [RELAY_ROLE.IDENTITY_WRITE, RELAY_ROLE.WRITE].sort());
    h.transport.resetIdentity();
    assert.deepEqual(h.transport.status().map((s) => s.role), [RELAY_ROLE.WRITE]);
  });
});

test('publish: a challenge that only comes with the refusal (damus-like) is answered and the event re-sent once', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, {
      challengeAfterRefusal: true,
      requireAuthToWrite: true,
      writeRefusal: RELAY_TEXT.AUTH_REQUIRED_NESTED,
    });
    const event = makeEvent(generateSecretKey());
    const [outcome] = await h.transport.publish([DAMUS], event).allSettled;
    assert.equal(outcome.ok, true);
    assert.equal(outcome.attempts, 2);
    assert.equal(frames(relay, 'EVENT').length, 2);
    assert.equal(relay.authLog.length, 1);
  });
});

test('publish: an EVENT refused while its AUTH completes is re-sent immediately', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, { ...PROFILES.nostr1, refusalDelayMs: 40 });
    const [outcome] = await h.transport.publish([NOSTR1], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.ok, true);
    assert.equal(relay.events.length, 1);
  });
});

test('publish: AUTH rejected by the relay ends in AUTH_FAILED without a retry loop', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, {
      challengeAfterRefusal: true,
      requireAuthToWrite: true,
      authResult: 'reject',
    });
    const [outcome] = await h.transport.publish([DAMUS], makeEvent(generateSecretKey())).allSettled;

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, DM_ERROR.AUTH_FAILED);
    assert.equal(outcome.prefix, 'auth-required');
    await settle(60);
    assert.equal(relay.authLog.length, 1);
    assert.equal(frames(relay, 'EVENT').length, 1);
    assert.equal(h.stateOf(DAMUS, 'write').state, 'auth-failed');
  });
});

test('publish: a relay that demands auth, then refuses again after it, ends in AUTH_FAILED', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    relay.eventReplies.push({ ok: false, reason: RELAY_TEXT.AUTH_REQUIRED });
    relay.eventReplies.push({ ok: false, reason: RELAY_TEXT.AUTH_REQUIRED });
    const [outcome] = await h.transport.publish([NOSTR1], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, DM_ERROR.AUTH_FAILED);
    assert.equal(frames(relay, 'EVENT').length, 2, 'one re-send, not more');
  });
});

test('publish: a relay that wants auth and never challenges fails after authTimeoutMs', async () => {
  await withHarness({ options: SHORT_TIMEOUTS }, async (h) => {
    h.network.addRelay(OPEN, { requireAuthToWrite: true });
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, DM_ERROR.AUTH_FAILED);
    assert.match(outcome.message, /relay sent no auth challenge/);
  });
});

test('publish: duplicate counts as delivered', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(OPEN, PROFILES.open);
    const event = makeEvent(generateSecretKey());
    await h.transport.publish([OPEN], event).allSettled;
    const [again] = await h.transport.publish([OPEN], event).allSettled;
    assert.equal(again.ok, true);
    assert.equal(again.prefix, 'duplicate');
    assert.equal(again.message, 'already have this event');
    assert.equal(again.code, null);
  });
});

test('publish: rate-limited is retried once after a short backoff', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push({ ok: false, reason: 'rate-limited: slow down' });
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.ok, true);
    assert.equal(outcome.attempts, 2);
  });
});

test('publish: refusing twice is final and carries the relay prefix and text', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push({ ok: false, reason: 'error: db down' }, { ok: false, reason: 'error: db down' });
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.deepEqual(outcome, {
      relay: 'wss://nos.lol/', ok: false, prefix: 'error', message: 'db down', code: 'NO_RELAY_ACCEPTED', attempts: 2,
    });
  });
});

test('publish: blocked / invalid / restricted / unknown refusals are final at once', async () => {
  for (const reason of ['blocked: banned', 'invalid: bad sig', 'restricted: no', 'pow: more work', 'something weird', '']) {
    await withHarness({}, async (h) => {
      const relay = h.network.addRelay(OPEN, PROFILES.open);
      relay.eventReplies.push({ ok: false, reason });
      const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
      assert.equal(outcome.ok, false, reason);
      assert.equal(outcome.code, DM_ERROR.NO_RELAY_ACCEPTED, reason);
      assert.equal(outcome.attempts, 1, reason);
      assert.equal(frames(relay, 'EVENT').length, 1, reason);
    });
  }
});

test('publish: a relay that never answers yields TIMEOUT', async () => {
  await withHarness({ options: SHORT_TIMEOUTS }, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push(null);
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, DM_ERROR.TIMEOUT);
    assert.equal(outcome.attempts, 1);
  });
});

test('publish: a relay that is silent from the start also yields TIMEOUT', async () => {
  await withHarness({ options: SHORT_TIMEOUTS }, async (h) => {
    h.network.addRelay(OPEN, { silent: true });
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.code, DM_ERROR.TIMEOUT);
  });
});

test('publish: refused and never-opening connections yield RELAY_UNAVAILABLE', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay('wss://refused.test', { refuse: true });
    h.network.addRelay('wss://hang.test', { hang: true });
    const { allSettled } = h.transport.publish(
      ['wss://refused.test', 'wss://hang.test', 'wss://unknown.test'],
      makeEvent(generateSecretKey()),
    );
    const results = await allSettled;
    assert.deepEqual(results.map((r) => [r.ok, r.code, r.attempts]), [
      [false, 'RELAY_UNAVAILABLE', 1],
      [false, 'RELAY_UNAVAILABLE', 1],
      [false, 'RELAY_UNAVAILABLE', 1],
    ]);
    assert.equal(h.network.liveSockets.length, 0, 'failed connects leave no socket behind');
  });
});

test('publish: one accepting relay completes firstAccept while a slow one is still pending', async () => {
  await withHarness({}, async (h) => {
    const slow = h.network.addRelay('wss://slow.test', PROFILES.open);
    slow.eventReplies.push(null);
    h.network.addRelay('wss://fast.test', PROFILES.open);
    h.network.addRelay('wss://bad.test', PROFILES.open).eventReplies.push({ ok: false, reason: 'blocked: no' });
    const { firstAccept, allSettled } = h.transport.publish(
      ['wss://slow.test', 'wss://bad.test', 'wss://fast.test'],
      makeEvent(generateSecretKey()),
    );
    const first = await firstAccept;
    assert.equal(first.relay, 'wss://fast.test/');

    const all = await allSettled;
    assert.deepEqual(all.map((r) => r.relay), ['wss://slow.test/', 'wss://bad.test/', 'wss://fast.test/'], 'input order');
    assert.deepEqual(all.map((r) => r.code), ['TIMEOUT', 'NO_RELAY_ACCEPTED', null]);
  });
});

test('publish: when every relay fails firstAccept is null and nothing rejects', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(OPEN, { refuse: true });
    const { firstAccept, allSettled } = h.transport.publish([OPEN], makeEvent(generateSecretKey()));
    assert.equal(await firstAccept, null);
    assert.equal((await allSettled)[0].ok, false);
  });
});

test('publish: an empty relay list resolves immediately and touches nothing', async () => {
  await withHarness({}, async (h) => {
    const { firstAccept, allSettled } = h.transport.publish([], makeEvent(generateSecretKey()));
    assert.equal(await firstAccept, null);
    assert.deepEqual(await allSettled, []);
    assert.equal(h.network.sockets.length, 0);
  });
});

test('publish validates its arguments synchronously', async () => {
  await withHarness({}, async (h) => {
    const bad = isCode(DM_ERROR.INVALID_ARGUMENT);
    const event = makeEvent(generateSecretKey());
    assert.throws(() => h.transport.publish('wss://nos.lol', event), bad);
    assert.throws(() => h.transport.publish(['not a url'], event), bad);
    assert.throws(() => h.transport.publish(['wss://nos.lol'], null), bad);
    assert.throws(() => h.transport.publish(['wss://nos.lol'], { kind: 1 }), bad);
    assert.throws(() => h.transport.publish(['wss://nos.lol'], 'event'), bad);
    assert.equal(h.network.sockets.length, 0);
  });
});

test('publish: spelling variants of one relay publish once', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const results = await h.transport.publish(['wss://nos.lol', 'WSS://NOS.LOL/', 'nos.lol'], makeEvent(generateSecretKey())).allSettled;
    assert.equal(results.length, 1);
    assert.equal(frames(relay, 'EVENT').length, 1);
  });
});

test('publish: the same event published twice at once shares one send on the wire', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    const event = makeEvent(generateSecretKey());
    const a = h.transport.publish([OPEN], event);
    const b = h.transport.publish([OPEN], event);
    const [ra] = await a.allSettled;
    const [rb] = await b.allSettled;
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    assert.equal(frames(relay, 'EVENT').length, 1);
    assert.equal(h.network.sockets.length, 1);
  });
});

test('publish: a connection lost mid-publish is retried once on a fresh socket', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push(null); // the first EVENT is never answered
    const pending = h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    await waitFor(() => frames(relay, 'EVENT').length === 1, 'the first EVENT');
    relay.dropAll();
    const [outcome] = await pending;
    assert.equal(outcome.ok, true);
    assert.equal(outcome.attempts, 2);
    assert.equal(h.network.sockets.length, 2);
  });
});

test('publish: the write connection is reused, then closed after writeIdleMs', async () => {
  await withHarness({ options: { writeIdleMs: 40 } }, async (h) => {
    h.network.addRelay(OPEN, PROFILES.open);
    await h.transport.publish([OPEN], makeEvent(generateSecretKey(), { content: '1' })).allSettled;
    await h.transport.publish([OPEN], makeEvent(generateSecretKey(), { content: '2' })).allSettled;
    assert.equal(h.network.sockets.length, 1, 'reused');
    assert.equal(h.stateOf(OPEN, 'write').state, 'ready');

    await waitFor(() => h.transport.status().length === 0, 'the idle write connection retired');
    await waitFor(() => h.network.liveSockets.length === 0, 'its socket closed');

    const [again] = await h.transport.publish([OPEN], makeEvent(generateSecretKey(), { content: '3' })).allSettled;
    assert.equal(again.ok, true);
    assert.equal(h.network.sockets.length, 2, 'reopened on demand');
  });
});

test('publish: a connection that is busy is not closed as idle', async () => {
  await withHarness({ options: { writeIdleMs: 20, publishTimeoutMs: 120 } }, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push(null);
    const [outcome] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(outcome.code, DM_ERROR.TIMEOUT, 'waited out the full publish timeout despite writeIdleMs=20');
    assert.equal(h.network.sockets.length, 1);
  });
});

test('publish: auth-failed write sockets are recycled by a later publish after the cooldown', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(DAMUS, {
      challengeAfterRefusal: true,
      requireAuthToWrite: true,
      authResult: 'reject',
    });
    const first = (await h.transport.publish([DAMUS], makeEvent(generateSecretKey(), { content: '1' })).allSettled)[0];
    assert.equal(first.code, DM_ERROR.AUTH_FAILED);

    h.setClock(5_000);
    relay.behavior.authResult = 'ok';
    const second = (await h.transport.publish([DAMUS], makeEvent(generateSecretKey(), { content: '2' })).allSettled)[0];
    assert.equal(second.ok, true);
    assert.equal(h.network.sockets.length, 2, 'a new socket with a new ephemeral key');
    assert.equal(h.ephemeralPubkeys.length, 2);
  });
});

// ---------------------------------------------------------------------------
// warmUp, status, resetIdentity, close
// ---------------------------------------------------------------------------

test('warmUp connects and authenticates in advance; subscribe then reuses the socket', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    h.network.addRelay(DAMUS, { refuse: true });
    await h.transport.warmUp([NOSTR1, DAMUS]);

    await waitFor(() => h.stateOf(NOSTR1).authenticated, 'pre-authenticated');
    assert.equal(h.signCalls.length, 1);
    assert.equal(frames(relay, 'REQ').length, 0, 'warm-up does not subscribe');

    const stored = wrapFor(h.identityPubkey);
    relay.inject(stored);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.events.length === 1, 'served on the pre-authenticated socket');
    assert.equal(frames(relay, 'REQ').length, 1, 'no refusal round trip needed');
    assert.equal(h.signCalls.length, 1);
    assert.equal(relay.connections.length, 1);
  });
});

test('warmUp validates, never rejects for network trouble, and is a no-op once closed', async () => {
  const h = createHarness();
  try {
    h.network.addRelay(OPEN, { refuse: true });
    h.network.addRelay('wss://hang.test', { hang: true });
    assert.throws(() => h.transport.warmUp('nope'), isCode(DM_ERROR.INVALID_ARGUMENT));
    await h.transport.warmUp([OPEN, 'wss://hang.test']);
    await h.transport.warmUp([]);
    h.transport.close();
    await h.transport.warmUp([OPEN]);
    assert.equal(h.transport.status().length, 0);
  } finally {
    h.finish();
  }
});

test('status: plain snapshots per relay and role, pushed through onStatus on every change', async () => {
  await withHarness({}, async (h) => {
    h.network.addRelay(NOSTR1, PROFILES.nostr1);
    assert.deepEqual(h.transport.status(), []);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => h.stateOf(NOSTR1)?.authenticated, 'authenticated');

    const snapshot = h.transport.status();
    assert.equal(snapshot.length, 1);
    assert.deepEqual(Object.keys(snapshot[0]).sort(), ['authenticated', 'lastReason', 'role', 'state', 'url']);
    assert.doesNotThrow(() => JSON.stringify(snapshot));

    const seen = h.statuses.map((all) => all[0]?.state);
    assert.ok(seen.includes('connecting'));
    assert.ok(seen.includes('authenticating'));
    assert.equal(seen.at(-1), 'ready');
    for (let i = 1; i < h.statuses.length; i += 1) {
      assert.notDeepEqual(h.statuses[i], h.statuses[i - 1], 'only real changes are reported');
    }
  });
});

test('status: a throwing onStatus consumer cannot break the transport', async () => {
  await withHarness({ options: { onStatus: () => { throw new Error('ui bug'); } } }, async (h) => {
    h.network.addRelay(OPEN, PROFILES.open);
    const c = collector();
    h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey), c.handlers);
    await waitFor(() => c.eoses.length === 1, 'EOSE');
  });
});

test('resetIdentity closes read connections silently, keeps write connections, and the next subscribe authenticates anew', async () => {
  await withHarness({}, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    const c = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), c.handlers);
    await h.transport.publish([NOSTR1], makeEvent(generateSecretKey())).allSettled;
    await waitFor(() => h.stateOf(NOSTR1).authenticated, 'read authenticated');
    const writeSocket = relay.connections.find((conn) => conn.received.some((f) => f[0] === 'EVENT')).socket;

    h.transport.resetIdentity();
    assert.deepEqual(h.transport.status().map((s) => s.role), ['write']);
    await waitFor(() => relay.open.length === 1, 'only the write socket stays open');
    assert.equal(relay.open[0].socket, writeSocket);
    assert.deepEqual(c.closed, [], 'no onclosed for a reset the caller asked for');

    const next = collector();
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), next.handlers);
    await waitFor(() => h.signCalls.length === 2, 'fresh AUTH for the new identity');
    await waitFor(() => next.eoses.length === 1, 'served');
  });
});

test('resetIdentity: a signature still being produced for the old identity is never sent', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const old = generateSecretKey();
  const signAuth = async ({ relay, challenge }) => {
    await gate;
    return createAuthEvent({ relay, challenge }, old);
  };
  await withHarness({ signAuth }, async (h) => {
    const relay = h.network.addRelay(NOSTR1, PROFILES.nostr1);
    h.transport.subscribe([NOSTR1], inboxFilter(h.identityPubkey), {});
    await waitFor(() => h.stateOf(NOSTR1)?.state === 'authenticating', 'signing in progress');
    h.transport.resetIdentity();
    release();
    await settle(40);
    assert.equal(relay.authLog.length, 0, 'the old identity never authenticated');
  });
});

test('close: every socket and timer is gone, subscribe throws, publish resolves unavailable, a second close is a no-op', async () => {
  const h = createHarness();
  try {
    h.network.addRelay(NOSTR1, PROFILES.nostr1);
    h.network.addRelay(OPEN, { refuse: true });
    const c = collector();
    h.transport.subscribe([NOSTR1, OPEN], inboxFilter(h.identityPubkey), c.handlers);
    h.transport.publish([NOSTR1], makeEvent(generateSecretKey()));
    await waitFor(() => h.stateOf(NOSTR1).authenticated, 'busy transport');

    h.transport.close();
    h.transport.close();
    assert.equal(h.liveTimers.size, 0);
    await waitFor(() => h.network.liveSockets.length === 0, 'all sockets closed');
    assert.deepEqual(h.transport.status(), []);
    assert.deepEqual(c.closed, [], 'close() is silent');

    assert.throws(() => h.transport.subscribe([OPEN], inboxFilter(h.identityPubkey)), isCode(DM_ERROR.RELAY_UNAVAILABLE));
    const [after] = await h.transport.publish([OPEN], makeEvent(generateSecretKey())).allSettled;
    assert.equal(after.ok, false);
    assert.equal(after.code, DM_ERROR.RELAY_UNAVAILABLE);
    assert.equal(after.attempts, 0);
    assert.doesNotThrow(() => h.transport.resetIdentity());
    h.transport.warmUp([OPEN]);
  } finally {
    h.finish();
  }
});

test('close: a publish in flight settles instead of hanging', async () => {
  await withHarness({ options: { publishTimeoutMs: 5_000 } }, async (h) => {
    const relay = h.network.addRelay(OPEN, PROFILES.open);
    relay.eventReplies.push(null);
    const { allSettled } = h.transport.publish([OPEN], makeEvent(generateSecretKey()));
    await waitFor(() => frames(relay, 'EVENT').length === 1, 'EVENT sent');
    h.transport.close();
    const [outcome] = await allSettled;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, DM_ERROR.RELAY_UNAVAILABLE);
  });
});

test('no unhandled rejections or stray timers across a chaotic run', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await withHarness({}, async (h) => {
      h.network.addRelay(NOSTR1, PROFILES.nostr1);
      h.network.addRelay(DAMUS, PROFILES.damus);
      h.network.addRelay(OPEN, PROFILES.open);
      h.network.addRelay('wss://down.test', { refuse: true });
      h.network.addRelay('wss://silent.test', { silent: true });
      const urls = [NOSTR1, DAMUS, OPEN, 'wss://down.test', 'wss://silent.test'];
      const c = collector();
      h.transport.subscribe(urls, inboxFilter(h.identityPubkey), c.handlers);
      const publishing = h.transport.publish(urls, makeEvent(generateSecretKey())).allSettled;
      await sleep(15);
      h.network.relay(NOSTR1).dropAll();
      h.network.relay(OPEN).dropAll();
      await publishing;
      h.transport.resetIdentity();
      h.transport.subscribe(urls, inboxFilter(h.identityPubkey), c.handlers);
      await sleep(30);
    });
    await settle(150);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
