/**
 * Relay layer tests.
 *
 * The default relay set is a frozen product decision and the publish-
 * fanout wrapper is the single normalisation point for every event we
 * send. Coverage here protects the contract every higher-level module
 * (profileStore, address book, etc) depends on.
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
  publishToRelays,
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
// The signature mirrors RelayPool.publish from nostr-core:
//   publish(urls: string[], event: NostrEvent): Promise<string[]>
// Each behaviour models one production failure mode we care about.
// ---------------------------------------------------------------------------

function fakePool(behaviour) {
  return {
    publish(urls /* , event */) {
      switch (behaviour) {
        case 'all':
          return Promise.resolve([...urls]);
        case 'partial':
          // Accept only the first URL, rest fail.
          return Promise.resolve(urls.slice(0, 1));
        case 'none':
          return Promise.resolve([]);
        case 'throw':
          return Promise.reject(new Error('event validation failed'));
        case 'hang':
          // Never resolves — exercises the timeout safety net.
          return new Promise(() => {});
        default:
          throw new Error(`unknown fake pool behaviour: ${behaviour}`);
      }
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
  // Strict mode would throw on mutation; in non-strict it silently fails.
  // Asserting on the length is enough proof the array is locked.
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
// publishToRelays — every path
// ---------------------------------------------------------------------------

await test('publishToRelays returns one result per input URL, in order', async () => {
  const results = await publishToRelays(fakePool('all'), DEFAULT_RELAYS, SAMPLE_EVENT);
  assert.equal(results.length, DEFAULT_RELAYS.length);
  for (let i = 0; i < DEFAULT_RELAYS.length; i += 1) {
    assert.equal(results[i].relay, DEFAULT_RELAYS[i]);
  }
});

await test('publishToRelays marks every relay ok when the pool accepts all', async () => {
  const results = await publishToRelays(fakePool('all'), DEFAULT_RELAYS, SAMPLE_EVENT);
  for (const r of results) {
    assert.equal(r.ok, true);
    assert.equal(r.error, null);
  }
});

await test('publishToRelays surfaces partial failure cleanly', async () => {
  const results = await publishToRelays(fakePool('partial'), DEFAULT_RELAYS, SAMPLE_EVENT);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].error, null);
  for (let i = 1; i < results.length; i += 1) {
    assert.equal(results[i].ok, false);
    assert.match(results[i].error, /did not accept/);
  }
});

await test('publishToRelays marks every relay failed when the pool accepts none', async () => {
  const results = await publishToRelays(fakePool('none'), DEFAULT_RELAYS, SAMPLE_EVENT);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.match(r.error, /did not accept/);
  }
});

await test('publishToRelays collapses a pool-level throw to per-relay failure carrying the message', async () => {
  const results = await publishToRelays(fakePool('throw'), DEFAULT_RELAYS, SAMPLE_EVENT);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.error, 'event validation failed');
  }
});

await test('publishToRelays times out a hanging publish and reports it', async () => {
  // 30 ms is plenty for a test; production uses DEFAULT_PUBLISH_TIMEOUT_MS.
  const results = await publishToRelays(
    fakePool('hang'),
    DEFAULT_RELAYS,
    SAMPLE_EVENT,
    { timeoutMs: 30 },
  );
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/i);
  }
});

await test('publishToRelays returns [] for an empty URL list without calling the pool', async () => {
  let called = false;
  const pool = { publish() { called = true; return Promise.resolve([]); } };
  const results = await publishToRelays(pool, [], SAMPLE_EVENT);
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

await test('publishToRelays never throws, even when the pool misbehaves', async () => {
  // Pool that rejects with a non-Error value — defensive against bad
  // third-party code in the future.
  const oddPool = { publish() { return Promise.reject('bare string'); } };
  const results = await publishToRelays(oddPool, ['wss://x'], SAMPLE_EVENT);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  // Non-Error rejection falls back to the generic message.
  assert.equal(results[0].error, 'Relay did not accept');
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

await test('anyAccepted returns false for an empty array or non-array input', () => {
  assert.equal(anyAccepted([]), false);
  assert.equal(anyAccepted(null), false);
  assert.equal(anyAccepted(undefined), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
