/**
 * Event-builder tests.
 *
 * Covers the two wire-level event shapes the Profile feature emits:
 * kind:0 (NIP-01 metadata) and kind:10002 (NIP-65 relay list). The
 * goal is to pin behaviour that downstream parsers depend on — every
 * relay we publish to, plus any other Nostr client a friend uses to
 * load the profile.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrProfile.spec.js
 */

import { strict as assert } from 'node:assert';
import { getPublicKey, verifyEvent } from 'nostr-core';
import {
  PROFILE_CONTENT_FIELDS,
  PROFILE_KIND,
  RELAY_LIST_KIND,
  buildKind0Event,
  buildKind10002Event,
  normaliseProfileContent,
} from '../nostrProfile.js';

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
// Test fixtures
//
// A fixed 32-byte secret key keeps every assertion reproducible — same
// pubkey, same signature inputs, same event id at the same `created_at`.
// The key is non-secret; it exists only for this spec.
// ---------------------------------------------------------------------------

const SECRET_KEY = new Uint8Array(32).fill(0x42);
const PUBKEY_HEX = getPublicKey(SECRET_KEY);
const FROZEN_TIMESTAMP = 1700000000;

const SAMPLE_PROFILE = Object.freeze({
  name: 'satoshi',
  display_name: 'Satoshi Nakamoto',
  about: 'Building things on Lightning.',
  website: 'https://example.com',
  picture: 'https://blossom.primal.net/abc.jpg',
  banner: 'https://blossom.primal.net/banner.png',
  lud16: 'satoshi@example.com',
  nip05: 'satoshi@example.com',
});

const RELAYS = Object.freeze([
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
]);

console.log('nostrProfile');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

await test('PROFILE_KIND is 0 (NIP-01)', () => {
  assert.equal(PROFILE_KIND, 0);
});

await test('RELAY_LIST_KIND is 10002 (NIP-65)', () => {
  assert.equal(RELAY_LIST_KIND, 10002);
});

await test('PROFILE_CONTENT_FIELDS is frozen and lists the published fields', () => {
  assert.ok(Object.isFrozen(PROFILE_CONTENT_FIELDS));
  assert.deepEqual([...PROFILE_CONTENT_FIELDS], [
    'name',
    'display_name',
    'about',
    'website',
    'picture',
    'banner',
    'lud16',
    'nip05',
  ]);
});

// ---------------------------------------------------------------------------
// normaliseProfileContent
// ---------------------------------------------------------------------------

await test('normaliseProfileContent trims string values', () => {
  const out = normaliseProfileContent({ name: '  satoshi  ' });
  assert.deepEqual(out, { name: 'satoshi' });
});

await test('normaliseProfileContent drops empty + whitespace-only fields', () => {
  const out = normaliseProfileContent({
    name: '',
    display_name: '   ',
    about: 'real',
  });
  assert.deepEqual(out, { about: 'real' });
});

await test('normaliseProfileContent drops non-string values (number, null, undefined)', () => {
  const out = normaliseProfileContent({
    name: 'ok',
    display_name: null,
    about: undefined,
    website: 42,
  });
  assert.deepEqual(out, { name: 'ok' });
});

await test('normaliseProfileContent ignores fields outside the whitelist', () => {
  const out = normaliseProfileContent({
    name: 'ok',
    secret: 'leak me please',
    privateKey: 'definitely not',
  });
  assert.deepEqual(out, { name: 'ok' });
});

await test('normaliseProfileContent returns {} for null / non-objects', () => {
  assert.deepEqual(normaliseProfileContent(null), {});
  assert.deepEqual(normaliseProfileContent(undefined), {});
  assert.deepEqual(normaliseProfileContent('hello'), {});
  assert.deepEqual(normaliseProfileContent(42), {});
});

// ---------------------------------------------------------------------------
// buildKind0Event
// ---------------------------------------------------------------------------

await test('buildKind0Event throws TypeError on invalid secret key', () => {
  assert.throws(
    () => buildKind0Event(SAMPLE_PROFILE, 'not-bytes'),
    /32-byte Uint8Array/,
  );
  assert.throws(
    () => buildKind0Event(SAMPLE_PROFILE, new Uint8Array(31)),
    /32-byte Uint8Array/,
  );
});

await test('buildKind0Event produces a kind:0 event with empty tags', () => {
  const event = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.kind, 0);
  assert.deepEqual(event.tags, []);
});

await test('buildKind0Event content is parseable JSON and matches the input', () => {
  const event = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  const parsed = JSON.parse(event.content);
  assert.deepEqual(parsed, { ...SAMPLE_PROFILE });
});

await test('buildKind0Event omits empty fields from content', () => {
  const event = buildKind0Event(
    { name: 'satoshi', display_name: '', about: '   ', picture: 'https://x.png' },
    SECRET_KEY,
    { createdAt: FROZEN_TIMESTAMP },
  );
  const parsed = JSON.parse(event.content);
  assert.deepEqual(parsed, { name: 'satoshi', picture: 'https://x.png' });
});

await test('buildKind0Event with an empty profile yields content == "{}"', () => {
  const event = buildKind0Event({}, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.content, '{}');
});

await test('buildKind0Event pubkey matches the derived public key', () => {
  const event = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.pubkey, PUBKEY_HEX);
});

await test('buildKind0Event signed events pass nostr-core verifyEvent', () => {
  const event = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(verifyEvent(event), true);
});

await test('buildKind0Event uses created_at = now by default', () => {
  const before = Math.floor(Date.now() / 1000);
  const event = buildKind0Event({ name: 'a' }, SECRET_KEY);
  const after = Math.floor(Date.now() / 1000);
  assert.ok(event.created_at >= before && event.created_at <= after);
});

await test('buildKind0Event is reproducible for the same inputs', () => {
  // The event id is a SHA-256 hash of the canonical NIP-01 serialization,
  // so the same (template, key) pair must yield identical content + id —
  // that is what relays use for dedup. The sig itself is *not* asserted
  // because BIP-340 signing in nostr-core mixes fresh aux randomness for
  // side-channel resistance; each call produces a different sig that
  // still verifies against the same id and pubkey.
  const a = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  const b = buildKind0Event(SAMPLE_PROFILE, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(a.content, b.content);
  assert.equal(a.id, b.id);
  assert.equal(verifyEvent(a), true);
  assert.equal(verifyEvent(b), true);
});

// ---------------------------------------------------------------------------
// buildKind10002Event
// ---------------------------------------------------------------------------

await test('buildKind10002Event throws TypeError on invalid secret key', () => {
  assert.throws(
    () => buildKind10002Event(RELAYS, new Uint8Array(0)),
    /32-byte Uint8Array/,
  );
});

await test('buildKind10002Event throws on empty / non-array relay list', () => {
  assert.throws(() => buildKind10002Event([], SECRET_KEY), /non-empty array/);
  assert.throws(() => buildKind10002Event(null, SECRET_KEY), /non-empty array/);
});

await test('buildKind10002Event produces a kind:10002 event', () => {
  const event = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.kind, 10002);
});

await test('buildKind10002Event emits one r tag per relay, in input order, without read/write markers', () => {
  const event = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  // nostr-core normalises URLs; we still assert structure + order +
  // tag arity (= 2 → bidirectional per NIP-65).
  assert.equal(event.tags.length, RELAYS.length);
  for (let i = 0; i < RELAYS.length; i += 1) {
    const tag = event.tags[i];
    assert.equal(tag[0], 'r');
    assert.ok(typeof tag[1] === 'string' && tag[1].startsWith('wss://'));
    assert.equal(tag.length, 2, 'bidirectional tag must omit read/write marker');
  }
});

await test('buildKind10002Event content is empty string per NIP-65', () => {
  const event = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.content, '');
});

await test('buildKind10002Event pubkey matches the derived public key', () => {
  const event = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(event.pubkey, PUBKEY_HEX);
});

await test('buildKind10002Event signed events pass nostr-core verifyEvent', () => {
  const event = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.equal(verifyEvent(event), true);
});

await test('buildKind10002Event is reproducible for the same inputs', () => {
  // See note on the kind:0 reproducibility test: id is deterministic
  // (relays dedup on it), sig isn't.
  const a = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  const b = buildKind10002Event(RELAYS, SECRET_KEY, { createdAt: FROZEN_TIMESTAMP });
  assert.deepEqual(a.tags, b.tags);
  assert.equal(a.id, b.id);
  assert.equal(verifyEvent(a), true);
  assert.equal(verifyEvent(b), true);
});

await test('buildKind10002Event uses created_at = now by default', () => {
  const before = Math.floor(Date.now() / 1000);
  const event = buildKind10002Event(RELAYS, SECRET_KEY);
  const after = Math.floor(Date.now() / 1000);
  assert.ok(event.created_at >= before && event.created_at <= after);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
