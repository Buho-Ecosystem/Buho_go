/**
 * Profile fetcher tests.
 *
 * The fetcher is the read-side counterpart to publishToRelaysEager.
 * Coverage here pins the BuhoGO correctness rules every higher-level
 * read (address-book sync, find-by-handle, contact detail) depends
 * on: signature verification, pubkey filtering, replaceable-event
 * tie-break, never-throw-on-network failure mode.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrFetch.spec.js
 */

import { strict as assert } from 'node:assert';
import { finalizeEvent, getPublicKey } from 'nostr-core';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  PROFILE_KIND,
  compareEventFreshness,
  fetchProfile,
  parseProfileContent,
} from '../nostrFetch.js';

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
// Fixtures
//
// Two deterministic keypairs let us build genuinely signed events
// for both the "right author" and "wrong author" cases. The
// forged-event test takes a valid signed event and corrupts its
// content so the signature stops verifying.
// ---------------------------------------------------------------------------

const ALICE_SECRET = new Uint8Array(32).fill(0x11);
const BOB_SECRET = new Uint8Array(32).fill(0x22);
const ALICE_PUBKEY = getPublicKey(ALICE_SECRET);
const BOB_PUBKEY = getPublicKey(BOB_SECRET);

function makeKind0(secret, content, createdAt) {
  return finalizeEvent({
    kind: PROFILE_KIND,
    tags: [],
    content: JSON.stringify(content),
    created_at: createdAt,
  }, secret);
}

/**
 * Minimal fake pool that satisfies the surface `fetchProfile`
 * actually consumes. `eventsByRelay` is a per-URL list of events
 * to return; `throwError` makes querySync reject; `latency` lets a
 * test verify the `maxWait` plumbing.
 */
function fakePool({ eventsByRelay = {}, throwError = null, latency = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async querySync(urls, filter, params) {
      calls.push({ urls: [...urls], filter, params });
      if (throwError) throw throwError;
      if (latency) await new Promise((r) => setTimeout(r, latency));
      const merged = [];
      for (const url of urls) {
        const evs = eventsByRelay[url] || [];
        merged.push(...evs);
      }
      return merged;
    },
  };
}

const TEST_RELAYS = Object.freeze([
  'wss://relay-a.test',
  'wss://relay-b.test',
  'wss://relay-c.test',
]);

console.log('nostrFetch');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

await test('PROFILE_KIND is 0', () => {
  assert.equal(PROFILE_KIND, 0);
});

await test('DEFAULT_FETCH_TIMEOUT_MS is a positive finite number', () => {
  assert.ok(Number.isFinite(DEFAULT_FETCH_TIMEOUT_MS));
  assert.ok(DEFAULT_FETCH_TIMEOUT_MS > 0);
});

// ---------------------------------------------------------------------------
// parseProfileContent
// ---------------------------------------------------------------------------

await test('parseProfileContent returns the parsed object on valid JSON', () => {
  const event = { content: JSON.stringify({ name: 'satoshi', lud16: 'sat@x' }) };
  assert.deepEqual(parseProfileContent(event), { name: 'satoshi', lud16: 'sat@x' });
});

await test('parseProfileContent returns {} on missing event', () => {
  assert.deepEqual(parseProfileContent(null), {});
  assert.deepEqual(parseProfileContent(undefined), {});
  assert.deepEqual(parseProfileContent({}), {});
});

await test('parseProfileContent returns {} on non-string content', () => {
  assert.deepEqual(parseProfileContent({ content: 42 }), {});
  assert.deepEqual(parseProfileContent({ content: { name: 'x' } }), {});
});

await test('parseProfileContent returns {} on invalid JSON', () => {
  assert.deepEqual(parseProfileContent({ content: '{not json' }), {});
});

await test('parseProfileContent returns {} when content parses to a non-object', () => {
  assert.deepEqual(parseProfileContent({ content: '"a string"' }), {});
  assert.deepEqual(parseProfileContent({ content: '[1,2,3]' }), {});
  assert.deepEqual(parseProfileContent({ content: 'null' }), {});
});

// ---------------------------------------------------------------------------
// compareEventFreshness
// ---------------------------------------------------------------------------

await test('compareEventFreshness ranks newer created_at first', () => {
  const a = { id: 'a', created_at: 100 };
  const b = { id: 'b', created_at: 200 };
  assert.ok(compareEventFreshness(a, b) > 0); // b before a
  assert.ok(compareEventFreshness(b, a) < 0);
});

await test('compareEventFreshness tie-breaks on lexically lowest id', () => {
  const a = { id: 'aaa', created_at: 100 };
  const b = { id: 'bbb', created_at: 100 };
  assert.ok(compareEventFreshness(a, b) < 0); // a wins (lower id)
});

await test('compareEventFreshness handles missing fields without throwing', () => {
  assert.equal(compareEventFreshness(null, null), 0);
  assert.equal(compareEventFreshness({}, {}), 0);
});

// ---------------------------------------------------------------------------
// fetchProfile — input validation
// ---------------------------------------------------------------------------

await test('fetchProfile throws TypeError on non-hex pubkey', async () => {
  await assert.rejects(
    () => fetchProfile('not hex', { pool: fakePool() }),
    TypeError,
  );
  await assert.rejects(
    () => fetchProfile('a'.repeat(63), { pool: fakePool() }),
    TypeError,
  );
});

await test('fetchProfile throws TypeError when pool lacks querySync', async () => {
  await assert.rejects(
    () => fetchProfile(ALICE_PUBKEY, { pool: {} }),
    TypeError,
  );
});

// ---------------------------------------------------------------------------
// fetchProfile — happy paths
// ---------------------------------------------------------------------------

await test('fetchProfile queries the pool with kind:0 + authors filter + limit:1', async () => {
  const event = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [event] },
  });
  await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(pool.calls.length, 1);
  const [{ urls, filter, params }] = pool.calls;
  assert.deepEqual(urls, [...TEST_RELAYS]);
  assert.deepEqual(filter, { kinds: [0], authors: [ALICE_PUBKEY], limit: 1 });
  assert.ok(Number.isFinite(params.maxWait));
});

await test('fetchProfile returns the event when one relay has it', async () => {
  const event = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [event] },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got?.id, event.id);
});

await test('fetchProfile picks the newest event when multiple relays return copies', async () => {
  // Three different versions of Alice's kind:0, one per relay.
  // The newest created_at must win regardless of arrival order.
  const old = makeKind0(ALICE_SECRET, { name: 'alice old' }, 1700000000);
  const newer = makeKind0(ALICE_SECRET, { name: 'alice newer' }, 1700001000);
  const newest = makeKind0(ALICE_SECRET, { name: 'alice newest' }, 1700002000);
  const pool = fakePool({
    eventsByRelay: {
      'wss://relay-a.test': [old],
      'wss://relay-b.test': [newest],
      'wss://relay-c.test': [newer],
    },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got.id, newest.id);
  assert.equal(parseProfileContent(got).name, 'alice newest');
});

await test('fetchProfile breaks created_at ties on lexically lowest id (NIP-01)', async () => {
  // Build two events with the same content + timestamp by using
  // identical templates; finalizeEvent's id derivation is
  // deterministic so we manually craft two-tie events here.
  const a = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  // Forge a second valid event with the same created_at by appending
  // a benign tag, which changes the id deterministically.
  const b = finalizeEvent({
    kind: PROFILE_KIND,
    tags: [['t', 'tie']],
    content: JSON.stringify({ name: 'alice' }),
    created_at: 1700000000,
  }, ALICE_SECRET);
  // Find which of a / b has the lexically lower id; that's the
  // "winner" the function should return.
  const winner = a.id < b.id ? a : b;
  const pool = fakePool({
    eventsByRelay: {
      'wss://relay-a.test': [a],
      'wss://relay-b.test': [b],
    },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: ['wss://relay-a.test', 'wss://relay-b.test'] });
  assert.equal(got.id, winner.id);
});

// ---------------------------------------------------------------------------
// fetchProfile — security rules
// ---------------------------------------------------------------------------

await test('fetchProfile rejects events whose author does not match the requested pubkey', async () => {
  // Relay misbehaves: serves a valid kind:0 signed by Bob when we
  // asked for Alice's profile. The function MUST drop it.
  const wrongAuthor = makeKind0(BOB_SECRET, { name: 'bob' }, 1700000000);
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [wrongAuthor] },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

await test('fetchProfile rejects events whose signature does not verify', async () => {
  // Tamper with a real Alice event: change content after signing.
  // verifyEvent must catch this and the function must drop the event.
  // NOTE: spread (`{ ...valid }`) preserves nostr-core's internal
  // verifiedSymbol, which short-circuits the verify check. Build a
  // fresh object with only the wire-level fields to simulate what
  // a relay would actually send over the WebSocket (JSON has no
  // symbols).
  const valid = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  const tampered = {
    id: valid.id,
    pubkey: valid.pubkey,
    kind: valid.kind,
    tags: valid.tags,
    content: JSON.stringify({ name: 'forged' }),
    created_at: valid.created_at,
    sig: valid.sig,
  };
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [tampered] },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

await test('fetchProfile rejects non-kind:0 events even from the right author', async () => {
  const wrongKind = finalizeEvent({
    kind: 1, // text note, not profile
    tags: [],
    content: 'hello world',
    created_at: 1700000000,
  }, ALICE_SECRET);
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [wrongKind] },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

await test('fetchProfile keeps the valid event when one of N relays returns a forged one', async () => {
  const valid = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700001000);
  const wrongAuthor = makeKind0(BOB_SECRET, { name: 'bob' }, 1700002000); // newer but wrong author
  const pool = fakePool({
    eventsByRelay: {
      'wss://relay-a.test': [wrongAuthor], // should be dropped despite being "newer"
      'wss://relay-b.test': [valid],
    },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got.id, valid.id);
});

// ---------------------------------------------------------------------------
// fetchProfile — failure paths
// ---------------------------------------------------------------------------

await test('fetchProfile returns null when no relay has the profile', async () => {
  const pool = fakePool({ eventsByRelay: {} });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

await test('fetchProfile returns null on pool-level throw (never propagates)', async () => {
  const pool = fakePool({ throwError: new Error('relay layer exploded') });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

await test('fetchProfile returns null when every returned event fails the validation gate', async () => {
  // Two relays each return one bogus event: one tampered (sig
  // fails) and one with the wrong author (sig is fine but pubkey
  // mismatch). Nothing should survive the filter.
  const valid = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  const tampered = {
    id: valid.id,
    pubkey: valid.pubkey,
    kind: valid.kind,
    tags: valid.tags,
    content: JSON.stringify({ name: 'forged' }),
    created_at: valid.created_at,
    sig: valid.sig,
  };
  const wrongAuthor = makeKind0(BOB_SECRET, { name: 'bob' }, 1700001000);
  const pool = fakePool({
    eventsByRelay: {
      'wss://relay-a.test': [tampered],
      'wss://relay-b.test': [wrongAuthor],
    },
  });
  const got = await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS });
  assert.equal(got, null);
});

// ---------------------------------------------------------------------------
// fetchProfile — opts plumbing
// ---------------------------------------------------------------------------

await test('fetchProfile threads opts.timeoutMs into the pool maxWait', async () => {
  const pool = fakePool();
  await fetchProfile(ALICE_PUBKEY, { pool, relays: TEST_RELAYS, timeoutMs: 123 });
  assert.equal(pool.calls[0].params.maxWait, 123);
});

await test('fetchProfile lowercases the pubkey before filtering', async () => {
  const event = makeKind0(ALICE_SECRET, { name: 'alice' }, 1700000000);
  const pool = fakePool({
    eventsByRelay: { 'wss://relay-a.test': [event] },
  });
  // Send an uppercase variant; the filter that hits the pool must
  // still use the lowercase form.
  await fetchProfile(ALICE_PUBKEY.toUpperCase(), { pool, relays: TEST_RELAYS });
  assert.equal(pool.calls[0].filter.authors[0], ALICE_PUBKEY);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
