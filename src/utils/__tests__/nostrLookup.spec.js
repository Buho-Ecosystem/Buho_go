/**
 * nostrLookup — universal identifier resolver tests.
 *
 * Coverage focus:
 *   - classifyIdentifier returns the right tag for every input shape
 *     (synchronous, no network — used by the UI to decide whether to
 *     debounce)
 *   - lookupIdentifier collapses all four input shapes to the same
 *     normalised result
 *   - typed errors propagate (npub/nprofile/hex code on decode failure;
 *     NIP05_* codes pass through unchanged from the nip05 resolver)
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrLookup.spec.js
 */

import { strict as assert } from 'node:assert';
import { getPublicKey, nip19 } from 'nostr-core';
import {
  classifyIdentifier,
  lookupIdentifier,
  LOOKUP_ERROR,
  NIP05_ERROR,
} from '../nostrLookup.js';

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
// ---------------------------------------------------------------------------

const ALICE_SECRET = new Uint8Array(32).fill(0x11);
const ALICE_PUBKEY = getPublicKey(ALICE_SECRET);
const ALICE_NPUB = nip19.npubEncode(ALICE_PUBKEY);
const ALICE_NPROFILE = nip19.nprofileEncode({
  pubkey: ALICE_PUBKEY,
  relays: ['wss://relay-a.test', 'wss://relay-b.test'],
});

class MockResponse {
  constructor({ status = 200, body }) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this._body = body;
  }
  async json() {
    if (typeof this._body === 'string') throw new SyntaxError('not json');
    return this._body;
  }
}

function fakeFetchOK(body) {
  return async () => new MockResponse({ body });
}

console.log('nostrLookup');

// ---------------------------------------------------------------------------
// classifyIdentifier — synchronous, no network
// ---------------------------------------------------------------------------

await test('classifyIdentifier: null / non-string / empty → null', () => {
  assert.equal(classifyIdentifier(null), null);
  assert.equal(classifyIdentifier(undefined), null);
  assert.equal(classifyIdentifier(123), null);
  assert.equal(classifyIdentifier(''), null);
  assert.equal(classifyIdentifier('   '), null);
});

await test('classifyIdentifier: hex pubkey', () => {
  assert.equal(classifyIdentifier(ALICE_PUBKEY), 'hex');
  assert.equal(classifyIdentifier(ALICE_PUBKEY.toUpperCase()), 'hex');
});

await test('classifyIdentifier: npub', () => {
  assert.equal(classifyIdentifier(ALICE_NPUB), 'npub');
});

await test('classifyIdentifier: nprofile', () => {
  assert.equal(classifyIdentifier(ALICE_NPROFILE), 'nprofile');
});

await test('classifyIdentifier: nip05', () => {
  assert.equal(classifyIdentifier('alice@example.com'), 'nip05');
  assert.equal(classifyIdentifier('_@example.com'), 'nip05');
});

await test('classifyIdentifier: nostr: prefix is stripped before classifying', () => {
  assert.equal(classifyIdentifier(`nostr:${ALICE_NPUB}`), 'npub');
  assert.equal(classifyIdentifier(`nostr:${ALICE_NPROFILE}`), 'nprofile');
  assert.equal(classifyIdentifier(`NOSTR:${ALICE_PUBKEY}`), 'hex');
});

await test('classifyIdentifier: gibberish → null', () => {
  assert.equal(classifyIdentifier('hello'), null);
  assert.equal(classifyIdentifier('npub-not-bech32'), null);
});

// ---------------------------------------------------------------------------
// lookupIdentifier — happy paths
// ---------------------------------------------------------------------------

await test('lookupIdentifier(npub): returns pubkey + same npub', async () => {
  const r = await lookupIdentifier(ALICE_NPUB);
  assert.equal(r.source, 'npub');
  assert.equal(r.pubkey, ALICE_PUBKEY);
  assert.equal(r.npub, ALICE_NPUB);
  assert.deepEqual(r.relays, []);
});

await test('lookupIdentifier(hex): returns pubkey + derived npub', async () => {
  const r = await lookupIdentifier(ALICE_PUBKEY);
  assert.equal(r.source, 'hex');
  assert.equal(r.pubkey, ALICE_PUBKEY);
  assert.equal(r.npub, ALICE_NPUB);
});

await test('lookupIdentifier(nprofile): unpacks relay hints', async () => {
  const r = await lookupIdentifier(ALICE_NPROFILE);
  assert.equal(r.source, 'nprofile');
  assert.equal(r.pubkey, ALICE_PUBKEY);
  assert.deepEqual(r.relays, ['wss://relay-a.test', 'wss://relay-b.test']);
});

await test('lookupIdentifier: nostr: URI prefix is honoured', async () => {
  const r = await lookupIdentifier(`nostr:${ALICE_NPUB}`);
  assert.equal(r.pubkey, ALICE_PUBKEY);
});

await test('lookupIdentifier(nip05): resolves through the injected fetch', async () => {
  const fetchFn = fakeFetchOK({
    names: { alice: ALICE_PUBKEY },
    relays: { [ALICE_PUBKEY]: ['wss://hint.test'] },
  });
  const r = await lookupIdentifier('alice@example.com', { fetch: fetchFn });
  assert.equal(r.source, 'nip05');
  assert.equal(r.pubkey, ALICE_PUBKEY);
  assert.equal(r.npub, ALICE_NPUB);
  assert.deepEqual(r.relays, ['wss://hint.test']);
  assert.equal(r.nip05, 'alice@example.com');
});

// ---------------------------------------------------------------------------
// lookupIdentifier — error surfaces
// ---------------------------------------------------------------------------

await test('lookupIdentifier: empty string → LOOKUP_EMPTY', async () => {
  await assert.rejects(
    () => lookupIdentifier(''),
    (err) => err.code === LOOKUP_ERROR.EMPTY,
  );
  await assert.rejects(
    () => lookupIdentifier('   '),
    (err) => err.code === LOOKUP_ERROR.EMPTY,
  );
});

await test('lookupIdentifier: non-string → LOOKUP_EMPTY', async () => {
  await assert.rejects(
    () => lookupIdentifier(null),
    (err) => err.code === LOOKUP_ERROR.EMPTY,
  );
});

await test('lookupIdentifier: unknown shape → LOOKUP_UNRECOGNIZED', async () => {
  await assert.rejects(
    () => lookupIdentifier('not-a-real-identifier'),
    (err) => err.code === LOOKUP_ERROR.UNRECOGNIZED,
  );
});

await test('lookupIdentifier: malformed npub → LOOKUP_INVALID_NPUB', async () => {
  await assert.rejects(
    () => lookupIdentifier('npub1abc'), // too short, fails bech32
    (err) => err.code === LOOKUP_ERROR.INVALID_NPUB,
  );
});

await test('lookupIdentifier: malformed nprofile → LOOKUP_INVALID_NPROFILE', async () => {
  await assert.rejects(
    () => lookupIdentifier('nprofile1abc'),
    (err) => err.code === LOOKUP_ERROR.INVALID_NPROFILE,
  );
});

await test('lookupIdentifier: NIP-05 not-found preserves NIP05_NOT_FOUND code', async () => {
  const fetchFn = fakeFetchOK({ names: { bob: 'a'.repeat(64) } });
  await assert.rejects(
    () => lookupIdentifier('alice@example.com', { fetch: fetchFn }),
    (err) => err.code === NIP05_ERROR.NOT_FOUND,
  );
});

await test('lookupIdentifier: NIP-05 bad-format preserves NIP05_INVALID_FORMAT code', async () => {
  // Classifies as nip05 (has @ + dot) but trips parseNip05's stricter
  // TLD-length rule — proves the NIP-05 path's typed code passes
  // through unchanged.
  await assert.rejects(
    () => lookupIdentifier('alice@example.x'),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('lookupIdentifier: pre-aborted signal → LOOKUP_CANCELLED', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    () => lookupIdentifier(ALICE_NPUB, { signal: c.signal }),
    (err) => err.code === LOOKUP_ERROR.CANCELLED,
  );
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
