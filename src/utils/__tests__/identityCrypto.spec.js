/**
 * LUD-04 / LUD-05 derivation correctness tests.
 *
 * The crypto here is the security boundary for every LUD-04 login — a
 * silent regression would cause every existing user to appear at every
 * linked site as a stranger. The asserts below are intentionally
 * specific and tied to canonical spec vectors so any drift is loud.
 *
 * Run with the Node runtime directly:
 *   node src/utils/__tests__/identityCrypto.spec.js
 *
 * (BuhoGO doesn't have a test runner configured at the time this file
 * was added; the script-style assertions keep the test runnable without
 * jest/vitest/etc. while keeping the door open to a runner later.)
 */

import { strict as assert } from 'node:assert';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { mnemonicToSeedSync } from '@scure/bip39';

import {
  buildLud05Path,
  bytesToHex,
  computeIdentityFingerprint,
  deriveLinkingKey,
  deriveNostrIdentity,
  generateIdentityMnemonic,
  hexToBytes,
  isValidIdentityMnemonic,
  npubFromHex,
  signLud04Challenge,
} from '../identityCrypto.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

console.log('identityCrypto');

// ---------------------------------------------------------------------------
// LUD-05 spec vector (https://github.com/lnurl/luds/blob/luds/05.md)
//
// Given hashing private key 7d417a6a5e9a6a4a879aeaba11a11838764c8fa2b959c242d43dea682b3e409b
// and domain "site.com", the path indices must be:
//   [1588488367, 2659270754, 38110259, 4136336762]
// This vector targets only the HMAC + uint32 extraction stage of the
// derivation — that's what the spec actually pins down.
// ---------------------------------------------------------------------------

test('LUD-05 HMAC stage matches the spec vector for site.com', () => {
  const hashingKey = hexToBytes(
    '7d417a6a5e9a6a4a879aeaba11a11838764c8fa2b959c242d43dea682b3e409b',
  );
  const dhash = hmac(sha256, hashingKey, new TextEncoder().encode('site.com'));
  const view = new DataView(dhash.buffer, dhash.byteOffset, dhash.byteLength);
  const indices = [
    view.getUint32(0, false),
    view.getUint32(4, false),
    view.getUint32(8, false),
    view.getUint32(12, false),
  ];
  assert.deepEqual(indices, [1588488367, 2659270754, 38110259, 4136336762]);
});

// ---------------------------------------------------------------------------
// End-to-end derivation properties.
//
// Without a published seed-to-key vector we can't pin the final pubkey to a
// hex string, so we test the properties LUD-04 actually depends on:
//   1. Deterministic — same mnemonic + domain ⇒ same key
//   2. Per-domain unique — different domain ⇒ different key
//   3. Per-identity unique — different mnemonic ⇒ different key
//   4. ECDSA signature validates and is DER-encoded
// ---------------------------------------------------------------------------

const fixedMnemonic =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

test('mnemonic validation accepts a valid BIP-39 phrase', () => {
  assert.equal(isValidIdentityMnemonic(fixedMnemonic), true);
});

test('mnemonic validation rejects malformed input', () => {
  assert.equal(isValidIdentityMnemonic('not a real seed phrase'), false);
  assert.equal(isValidIdentityMnemonic(''), false);
  assert.equal(isValidIdentityMnemonic(null), false);
});

test('deriveLinkingKey is deterministic per (mnemonic, domain)', () => {
  const a = deriveLinkingKey(fixedMnemonic, 'stacker.news');
  const b = deriveLinkingKey(fixedMnemonic, 'stacker.news');
  assert.equal(bytesToHex(a.privateKey), bytesToHex(b.privateKey));
  assert.equal(bytesToHex(a.publicKey), bytesToHex(b.publicKey));
});

test('deriveLinkingKey produces different keys per domain', () => {
  const a = deriveLinkingKey(fixedMnemonic, 'stacker.news');
  const b = deriveLinkingKey(fixedMnemonic, 'nostr.land');
  assert.notEqual(bytesToHex(a.privateKey), bytesToHex(b.privateKey));
  assert.notEqual(bytesToHex(a.publicKey), bytesToHex(b.publicKey));
});

test('deriveLinkingKey produces different keys per mnemonic', () => {
  const fresh = generateIdentityMnemonic();
  const a = deriveLinkingKey(fixedMnemonic, 'stacker.news');
  const b = deriveLinkingKey(fresh, 'stacker.news');
  assert.notEqual(bytesToHex(a.privateKey), bytesToHex(b.privateKey));
});

test('public key is compressed secp256k1 (33 bytes, 0x02 or 0x03 prefix)', () => {
  const { publicKey } = deriveLinkingKey(fixedMnemonic, 'site.com');
  assert.equal(publicKey.length, 33);
  assert.ok(publicKey[0] === 0x02 || publicKey[0] === 0x03, `unexpected prefix 0x${publicKey[0].toString(16)}`);
});

test('signLud04Challenge produces a DER-encoded signature (leading 0x30)', () => {
  const { privateKey } = deriveLinkingKey(fixedMnemonic, 'site.com');
  const k1 = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) k1[i] = i;
  const sig = signLud04Challenge(k1, privateKey);
  assert.equal(sig[0], 0x30);
  // DER ECDSA signatures over secp256k1 are 70-72 bytes typically. Hard
  // upper bound of 72 catches encoding bugs that produce raw-compact (64
  // bytes) or any oversize variant.
  assert.ok(sig.length >= 70 && sig.length <= 72, `sig length ${sig.length}`);
});

test('signLud04Challenge rejects malformed inputs', () => {
  const { privateKey } = deriveLinkingKey(fixedMnemonic, 'site.com');
  assert.throws(() => signLud04Challenge(new Uint8Array(31), privateKey), /32-byte/);
  assert.throws(() => signLud04Challenge(new Uint8Array(32), new Uint8Array(31)), /32-byte/);
  assert.throws(() => signLud04Challenge('not-bytes', privateKey), /Uint8Array/);
});

test('buildLud05Path returns four indices and a parseable canonical path string', () => {
  const seed = mnemonicToSeedSync(fixedMnemonic);
  const { path, indices } = buildLud05Path(seed, 'site.com');
  assert.equal(indices.length, 4);
  // `m/138'/<a>/<b>/<c>/<d>` with each step either a plain integer or
  // <(uint - 2^31)>' (hardened) when the LUD-05 uint32 exceeded 2^31.
  assert.match(path, /^m\/138'\/[\d']+\/[\d']+\/[\d']+\/[\d']+$/);
});

test('computeIdentityFingerprint is stable and 16 hex chars', () => {
  const fp1 = computeIdentityFingerprint(fixedMnemonic);
  const fp2 = computeIdentityFingerprint(fixedMnemonic);
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{16}$/);
});

test('computeIdentityFingerprint differs across mnemonics', () => {
  const fresh = generateIdentityMnemonic();
  assert.notEqual(
    computeIdentityFingerprint(fixedMnemonic),
    computeIdentityFingerprint(fresh),
  );
});

// ---------------------------------------------------------------------------
// NIP-06 spec vectors (https://github.com/nostr-protocol/nips/blob/master/06.md)
//
// Two official vectors are published in NIP-06. We pin both — any drift in
// BIP-39 → BIP-32 → schnorr x-only public key conversion would change one
// or both, and Nostr identity must be deterministic across clients.
// ---------------------------------------------------------------------------

const NIP06_VECTOR_1 = {
  mnemonic:
    'leader monkey parrot ring guide accident before fence cannon height naive bean',
  privateKey:
    '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a',
  publicKey:
    '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917',
  npub: 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu',
};

const NIP06_VECTOR_2 = {
  mnemonic:
    'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade',
  privateKey:
    'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add',
  publicKey:
    'd41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573',
  npub: 'npub16sdj9zv4f8sl85e45vgq9n7nsgt5qphpvmf7vk8r5hhvmdjxx4es8rq74h',
};

test('deriveNostrIdentity matches NIP-06 vector 1 (12-word mnemonic)', () => {
  const key = deriveNostrIdentity(NIP06_VECTOR_1.mnemonic);
  assert.equal(bytesToHex(key.privateKey), NIP06_VECTOR_1.privateKey);
  assert.equal(key.publicKeyHex, NIP06_VECTOR_1.publicKey);
  assert.equal(key.npub, NIP06_VECTOR_1.npub);
  assert.equal(key.path, "m/44'/1237'/0'/0/0");
});

test('deriveNostrIdentity matches NIP-06 vector 2 (24-word mnemonic)', () => {
  const key = deriveNostrIdentity(NIP06_VECTOR_2.mnemonic);
  assert.equal(bytesToHex(key.privateKey), NIP06_VECTOR_2.privateKey);
  assert.equal(key.publicKeyHex, NIP06_VECTOR_2.publicKey);
  assert.equal(key.npub, NIP06_VECTOR_2.npub);
});

test('deriveNostrIdentity returns an x-only public key (32 bytes hex)', () => {
  const key = deriveNostrIdentity(fixedMnemonic);
  assert.equal(key.publicKeyHex.length, 64);
  assert.match(key.publicKeyHex, /^[0-9a-f]{64}$/);
  assert.equal(key.privateKey.length, 32);
});

test('deriveNostrIdentity produces a valid nsec', () => {
  const key = deriveNostrIdentity(NIP06_VECTOR_1.mnemonic);
  assert.match(key.nsec, /^nsec1[02-9ac-hj-np-z]+$/);
});

test('deriveNostrIdentity is deterministic for the same (mnemonic, account)', () => {
  const a = deriveNostrIdentity(fixedMnemonic, 0);
  const b = deriveNostrIdentity(fixedMnemonic, 0);
  assert.equal(a.publicKeyHex, b.publicKeyHex);
  assert.equal(bytesToHex(a.privateKey), bytesToHex(b.privateKey));
});

test('deriveNostrIdentity produces a different key per account index', () => {
  const a = deriveNostrIdentity(fixedMnemonic, 0);
  const b = deriveNostrIdentity(fixedMnemonic, 1);
  assert.notEqual(a.publicKeyHex, b.publicKeyHex);
  assert.notEqual(a.npub, b.npub);
  assert.equal(b.path, "m/44'/1237'/1'/0/0");
});

test('deriveNostrIdentity rejects invalid mnemonics', () => {
  assert.throws(() => deriveNostrIdentity('not a real seed phrase'), /Invalid identity mnemonic/);
});

test('deriveNostrIdentity rejects out-of-range account indices', () => {
  assert.throws(() => deriveNostrIdentity(fixedMnemonic, -1), RangeError);
  assert.throws(() => deriveNostrIdentity(fixedMnemonic, 2 ** 31), RangeError);
  assert.throws(() => deriveNostrIdentity(fixedMnemonic, 1.5), RangeError);
});

test('npubFromHex round-trips with deriveNostrIdentity', () => {
  const key = deriveNostrIdentity(NIP06_VECTOR_1.mnemonic);
  assert.equal(npubFromHex(key.publicKeyHex), key.npub);
});

test('npubFromHex rejects malformed hex', () => {
  assert.throws(() => npubFromHex('deadbeef'), /64 hex characters/);
  assert.throws(() => npubFromHex(null), /64 hex characters/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
