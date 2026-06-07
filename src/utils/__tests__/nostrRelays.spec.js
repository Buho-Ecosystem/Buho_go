/**
 * Relay layer tests.
 *
 * The default relay set is a frozen product decision and the
 * publish-fanout wrapper is the single normalisation point for every
 * event we send. Coverage here protects the eager-success contract
 * every higher-level module (profileStore, address book, etc) depends
 * on.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrRelays.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  DEFAULT_BLOSSOM_SERVER,
  DEFAULT_PUBLISH_TIMEOUT_MS,
  DEFAULT_RELAYS,
  anyAccepted,
  publishToRelaysEager,
} from '../nostrRelays.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// Fake pool factory
//
// Mirrors the small slice of nostr-core's `RelayPool` we actually
// use: `ensureRelay(url)` returns a Relay-like object whose
// `publish(event)` either resolves (relay accepted) or rejects
// (relay refused). Each test wires its own per-URL behaviour and an
// optional artificial delay so we can verify the eager-success
// property — the outer promise must resolve on the *first* ok,
// regardless of how slow the other relays are.
// ---------------------------------------------------------------------------

function fakePool(behaviour = {}, opts = {}) {
  const calls = [];
  return {
    calls,
    ensureRelay(url) {
      if (opts.ensureRelayFails === true || opts.ensureRelayFails === url) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve({
        url,
        publish(event) {
          const decision = behaviour[url] ?? 'ok';
          const delay = (opts.delays && opts.delays[url]) || 0;
          calls.push({ url, event, decision });
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (decision === 'ok') {
                resolve('OK');
              } else if (decision === 'reject') {
                reject(new Error('Relay did not accept'));
              } else if (decision === 'throw-bare') {
                // Non-Error rejection — exercises the defensive
                // fallback message path.
                // eslint-disable-next-line prefer-promise-reject-errors
                reject('bare string');
              } else if (decision === 'hang') {
                // Never resolves — hits the per-relay timeout.
              } else {
                reject(new Error(`unknown decision: ${decision}`));
              }
            }, delay);
          });
        },
      });
    },
  };
}

const SAMPLE_EVENT = Object.freeze({
  id: 'deadbeef'.repeat(8),
  pubkey: 'cafef00d'.repeat(8),
  created_at: 1700000000,
  kind: 0,
  tags: [],
  content: '{}',
  sig: '0'.repeat(128),
});

const RELAYS = Object.freeze([
  'wss://relay-a.test',
  'wss://relay-b.test',
  'wss://relay-c.test',
]);

console.log('nostrRelays');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

await test('DEFAULT_RELAYS contains exactly the five locked URLs in order', () => {
  assert.deepEqual([...DEFAULT_RELAYS], [
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://nostr-01.yakihonne.com',
    'wss://nostr-02.yakihonne.com',
  ]);
});

await test('DEFAULT_RELAYS is frozen at runtime', () => {
  assert.ok(Object.isFrozen(DEFAULT_RELAYS));
  assert.equal(DEFAULT_RELAYS.length, 5);
});

await test('DEFAULT_BLOSSOM_SERVER is the Primal default', () => {
  assert.equal(DEFAULT_BLOSSOM_SERVER, 'https://blossom.primal.net');
});

await test('DEFAULT_PUBLISH_TIMEOUT_MS is a positive finite number', () => {
  assert.ok(Number.isFinite(DEFAULT_PUBLISH_TIMEOUT_MS));
  assert.ok(DEFAULT_PUBLISH_TIMEOUT_MS > 0);
});

// ---------------------------------------------------------------------------
// publishToRelaysEager — shape
// ---------------------------------------------------------------------------

await test('publishToRelaysEager returns an object with firstAccept and allSettled', () => {
  const fanout = publishToRelaysEager(fakePool(), RELAYS, SAMPLE_EVENT);
  assert.ok(fanout.firstAccept instanceof Promise);
  assert.ok(fanout.allSettled instanceof Promise);
});

await test('publishToRelaysEager: empty URL list resolves immediately to null + []', async () => {
  let touched = false;
  const pool = {
    ensureRelay() { touched = true; return Promise.resolve({}); },
  };
  const fanout = publishToRelaysEager(pool, [], SAMPLE_EVENT);
  assert.equal(await fanout.firstAccept, null);
  assert.deepEqual(await fanout.allSettled, []);
  assert.equal(touched, false, 'should not touch the pool for an empty URL list');
});

await test('publishToRelaysEager: non-array urls collapses to empty fan-out', async () => {
  const fanout = publishToRelaysEager(fakePool(), null, SAMPLE_EVENT);
  assert.equal(await fanout.firstAccept, null);
  assert.deepEqual(await fanout.allSettled, []);
});

// ---------------------------------------------------------------------------
// publishToRelaysEager — success paths
// ---------------------------------------------------------------------------

await test('publishToRelaysEager: all accept → firstAccept resolves with first ok, allSettled has every ok=true', async () => {
  const fanout = publishToRelaysEager(fakePool(), RELAYS, SAMPLE_EVENT);
  const first = await fanout.firstAccept;
  assert.ok(first && first.ok === true);
  assert.ok(RELAYS.includes(first.relay));
  const settled = await fanout.allSettled;
  assert.equal(settled.length, RELAYS.length);
  for (const r of settled) {
    assert.equal(r.ok, true);
    assert.equal(r.error, null);
  }
});

await test('publishToRelaysEager: allSettled preserves input URL order', async () => {
  const fanout = publishToRelaysEager(fakePool(), RELAYS, SAMPLE_EVENT);
  const settled = await fanout.allSettled;
  for (let i = 0; i < RELAYS.length; i += 1) {
    assert.equal(settled[i].relay, RELAYS[i]);
  }
});

await test('publishToRelaysEager: ONE accepting relay is enough for firstAccept', async () => {
  const fanout = publishToRelaysEager(
    fakePool({
      'wss://relay-a.test': 'reject',
      'wss://relay-b.test': 'reject',
      'wss://relay-c.test': 'ok',
    }),
    RELAYS,
    SAMPLE_EVENT,
  );
  const first = await fanout.firstAccept;
  assert.ok(first && first.ok === true);
  assert.equal(first.relay, 'wss://relay-c.test');
});

await test('publishToRelaysEager: firstAccept wins before slow relays finish (eager semantics)', async () => {
  // relay-a is instant; relay-b and -c take 200ms. firstAccept should
  // resolve well before allSettled.
  const fanout = publishToRelaysEager(
    fakePool({}, { delays: {
      'wss://relay-a.test': 0,
      'wss://relay-b.test': 200,
      'wss://relay-c.test': 200,
    }}),
    RELAYS,
    SAMPLE_EVENT,
    { timeoutMs: 2000 },
  );
  const t0 = Date.now();
  const first = await fanout.firstAccept;
  const elapsedFirst = Date.now() - t0;
  assert.ok(first && first.ok);
  assert.ok(
    elapsedFirst < 150,
    `firstAccept should resolve quickly, took ${elapsedFirst}ms`,
  );
  // allSettled still has to wait for the slow ones.
  await fanout.allSettled;
  const elapsedSettle = Date.now() - t0;
  assert.ok(
    elapsedSettle >= 200,
    `allSettled should wait for slow relays, took ${elapsedSettle}ms`,
  );
});

// ---------------------------------------------------------------------------
// publishToRelaysEager — failure paths
// ---------------------------------------------------------------------------

await test('publishToRelaysEager: all reject → firstAccept resolves null, allSettled carries errors', async () => {
  const fanout = publishToRelaysEager(
    fakePool({
      'wss://relay-a.test': 'reject',
      'wss://relay-b.test': 'reject',
      'wss://relay-c.test': 'reject',
    }),
    RELAYS,
    SAMPLE_EVENT,
  );
  assert.equal(await fanout.firstAccept, null);
  const settled = await fanout.allSettled;
  for (const r of settled) {
    assert.equal(r.ok, false);
    assert.match(r.error, /did not accept/);
  }
});

await test('publishToRelaysEager: ensureRelay failure becomes per-relay ok=false', async () => {
  const fanout = publishToRelaysEager(
    fakePool({}, { ensureRelayFails: 'wss://relay-a.test' }),
    RELAYS,
    SAMPLE_EVENT,
  );
  const settled = await fanout.allSettled;
  const a = settled.find((r) => r.relay === 'wss://relay-a.test');
  assert.equal(a.ok, false);
  assert.match(a.error, /connection refused/);
  // The other two still accept, so firstAccept resolves with one of them.
  const first = await fanout.firstAccept;
  assert.ok(first && first.ok);
  assert.notEqual(first.relay, 'wss://relay-a.test');
});

await test('publishToRelaysEager: a hanging publish hits the per-relay timeout', async () => {
  const fanout = publishToRelaysEager(
    fakePool({
      'wss://relay-a.test': 'hang',
      'wss://relay-b.test': 'hang',
      'wss://relay-c.test': 'hang',
    }),
    RELAYS,
    SAMPLE_EVENT,
    { timeoutMs: 40 },
  );
  assert.equal(await fanout.firstAccept, null);
  const settled = await fanout.allSettled;
  for (const r of settled) {
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/i);
  }
});

await test('publishToRelaysEager: non-Error rejection from a misbehaving relay stays safe', async () => {
  const fanout = publishToRelaysEager(
    fakePool({
      'wss://relay-a.test': 'throw-bare',
      'wss://relay-b.test': 'throw-bare',
      'wss://relay-c.test': 'throw-bare',
    }),
    RELAYS,
    SAMPLE_EVENT,
  );
  assert.equal(await fanout.firstAccept, null);
  const settled = await fanout.allSettled;
  for (const r of settled) {
    assert.equal(r.ok, false);
    // Falls back to the generic message when err.message is missing.
    assert.equal(r.error, 'Relay did not accept');
  }
});

await test('publishToRelaysEager: one accept + others fail still keeps firstAccept resolved with the ok', async () => {
  const fanout = publishToRelaysEager(
    fakePool(
      {
        'wss://relay-a.test': 'reject',
        'wss://relay-b.test': 'ok',
        'wss://relay-c.test': 'hang',
      },
      { delays: { 'wss://relay-b.test': 30 } },
    ),
    RELAYS,
    SAMPLE_EVENT,
    { timeoutMs: 80 },
  );
  const first = await fanout.firstAccept;
  assert.ok(first && first.ok);
  assert.equal(first.relay, 'wss://relay-b.test');
  const settled = await fanout.allSettled;
  assert.deepEqual(settled.map((r) => [r.relay, r.ok]), [
    ['wss://relay-a.test', false],
    ['wss://relay-b.test', true],
    ['wss://relay-c.test', false],
  ]);
});

// ---------------------------------------------------------------------------
// anyAccepted predicate
// ---------------------------------------------------------------------------

await test('anyAccepted returns true if at least one relay succeeded', () => {
  assert.equal(anyAccepted([
    { relay: 'wss://a', ok: false, error: 'x' },
    { relay: 'wss://b', ok: true, error: null },
  ]), true);
});

await test('anyAccepted returns false when every relay failed', () => {
  assert.equal(anyAccepted([
    { relay: 'wss://a', ok: false, error: 'x' },
    { relay: 'wss://b', ok: false, error: 'y' },
  ]), false);
});

await test('anyAccepted returns false for empty / non-array input', () => {
  assert.equal(anyAccepted([]), false);
  assert.equal(anyAccepted(null), false);
  assert.equal(anyAccepted(undefined), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
