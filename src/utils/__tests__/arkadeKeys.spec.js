/**
 * arkadeKeys — Arkade (Ark L2) key derivation tests.
 *
 * The single most safety-critical property of the Arkade integration: the
 * mnemonic → key derivation MUST stay byte-identical to BIP-86 (Taproot)
 * `m/86'/coinType'/0'/0/0` — the path the official Arkade wallet uses. If this
 * ever drifts, BuhoGO-created seeds stop restoring elsewhere and funds appear
 * lost. This locks it against the published BIP-86 test vector.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/arkadeKeys.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  deriveArkadePrivateKey,
  arkadeIdentityFromMnemonic,
  generateArkadeMnemonic,
  isValidArkadeMnemonic,
  isMainnetNetwork,
} from '../arkadeKeys.js';

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
    failed += 1;
  }
}

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

// BIP-39 all-zero-entropy canonical phrase — also the BIP-86 spec test vector.
const VECTOR_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

await test('derives the published BIP-86 mainnet vector (m/86h/0h/0h/0/0)', async () => {
  const priv = deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: true });
  assert.equal(priv.length, 32, 'private key must be 32 bytes');
  // BIP-86 test vector: first receiving key's x-only internal pubkey.
  // https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
  const identity = arkadeIdentityFromMnemonic(VECTOR_MNEMONIC, { isMainnet: true });
  const xonly = await identity.xOnlyPublicKey();
  assert.equal(
    toHex(xonly),
    'cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115',
    'x-only pubkey must match the BIP-86 spec vector — derivation has drifted!'
  );
});

await test('derivation is deterministic', () => {
  const a = toHex(deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: true }));
  const b = toHex(deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: true }));
  assert.equal(a, b);
});

await test('mainnet (coinType 0) and testnet (coinType 1) derive different keys', () => {
  const mainKey = toHex(deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: true }));
  const testKey = toHex(deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: false }));
  assert.notEqual(mainKey, testKey);
});

await test('normalises case / whitespace before deriving (same key)', () => {
  const a = toHex(deriveArkadePrivateKey(VECTOR_MNEMONIC, { isMainnet: true }));
  const b = toHex(deriveArkadePrivateKey(`  ${VECTOR_MNEMONIC.toUpperCase()}  `, { isMainnet: true }));
  assert.equal(a, b);
});

await test('isValidArkadeMnemonic: accepts valid, rejects garbage / bad checksum / non-strings', () => {
  assert.equal(isValidArkadeMnemonic(VECTOR_MNEMONIC), true);
  // Wrong last word -> checksum failure.
  assert.equal(isValidArkadeMnemonic(VECTOR_MNEMONIC.replace(/about$/, 'zoo')), false);
  assert.equal(isValidArkadeMnemonic('not a real recovery phrase at all'), false);
  assert.equal(isValidArkadeMnemonic(''), false);
  assert.equal(isValidArkadeMnemonic(null), false);
});

await test('generateArkadeMnemonic: 12 valid words, unique per call', () => {
  const m1 = generateArkadeMnemonic();
  const m2 = generateArkadeMnemonic();
  assert.equal(m1.split(' ').length, 12);
  assert.equal(isValidArkadeMnemonic(m1), true);
  assert.notEqual(m1, m2);
});

await test('deriveArkadePrivateKey throws on an invalid phrase', () => {
  assert.throws(() => deriveArkadePrivateKey('clearly not valid', { isMainnet: true }));
});

await test('isMainnetNetwork: bitcoin = mainnet, others not', () => {
  assert.equal(isMainnetNetwork('bitcoin'), true);
  assert.equal(isMainnetNetwork(), true); // default
  assert.equal(isMainnetNetwork('testnet'), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
