/**
 * LUD-09 successAction tests.
 *
 * This boundary parses an untrusted object from a remote LNURL-pay server and,
 * for the `aes` variant, decrypts a secret using the payment preimage. A silent
 * regression here would either drop a legitimate merchant message or mishandle
 * a decrypted secret, so the parse / validate / decrypt paths are pinned here.
 *
 * Run with the Node runtime directly (matches the other specs):
 *   node src/utils/__tests__/successAction.spec.js
 */

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

// Web Crypto is a browser / Capacitor WebView global at runtime; expose it in
// Node (older line-ups don't surface it globally) so the module under test and
// these helpers share the same `globalThis.crypto`.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  parseSuccessAction,
  resolveSuccessAction,
  decryptAesSuccessAction,
  SUCCESS_ACTION_MAX_CHARS,
} from '../successAction.js';

// --- harness (async-aware variant of the shared spec pattern) ------------

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

// --- helpers -------------------------------------------------------------

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Produce a base64 AES-256-CBC ciphertext the way an LN service would, so the
// decrypt path can be exercised against a real vector we control.
async function aesEncryptBase64(plaintext, preimageHex, ivBytes) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw', hexToBytes(preimageHex), { name: 'AES-CBC' }, false, ['encrypt'],
  );
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes }, key, new TextEncoder().encode(plaintext),
  );
  return bytesToBase64(new Uint8Array(ct));
}

// Shared aes vector.
const preimage = 'a1b2c3d4e5f6071829304152637485960a1b2c3d4e5f6071829304152637485a';
const iv = new Uint8Array(16); // deterministic zero IV for the test vector
const ivB64 = bytesToBase64(iv);
const secret = 'REDEEM-7F3K-9912';
const ciphertext = await aesEncryptBase64(secret, preimage, iv);

// --- parseSuccessAction --------------------------------------------------

await test('parse: rejects null / garbage / unknown tag', () => {
  assert.equal(parseSuccessAction(null), null);
  assert.equal(parseSuccessAction(undefined), null);
  assert.equal(parseSuccessAction('nope'), null);
  assert.equal(parseSuccessAction({ tag: 'unknown' }), null);
});

await test('parse: message', () => {
  assert.deepEqual(
    parseSuccessAction({ tag: 'message', message: 'Thanks!' }),
    { tag: 'message', message: 'Thanks!' },
  );
  assert.equal(parseSuccessAction({ tag: 'message', message: '   ' }), null);
});

await test('parse: clamps message to the spec cap', () => {
  const long = 'x'.repeat(200);
  assert.equal(
    parseSuccessAction({ tag: 'message', message: long }).message.length,
    SUCCESS_ACTION_MAX_CHARS,
  );
});

await test('parse: url accepts http(s), rejects other schemes', () => {
  assert.deepEqual(
    parseSuccessAction({ tag: 'url', description: 'Receipt', url: 'https://ex.com/r/1' }),
    { tag: 'url', description: 'Receipt', url: 'https://ex.com/r/1' },
  );
  assert.equal(parseSuccessAction({ tag: 'url', url: 'ftp://x' }), null);
  assert.equal(parseSuccessAction({ tag: 'url', url: 'not a url' }), null);
  assert.equal(parseSuccessAction({ tag: 'url', url: 'javascript:alert(1)' }), null);
});

await test('parse: aes requires ciphertext + iv', () => {
  assert.deepEqual(
    parseSuccessAction({ tag: 'aes', description: 'Code', ciphertext: 'AAAA', iv: 'BBBB' }),
    { tag: 'aes', description: 'Code', ciphertext: 'AAAA', iv: 'BBBB' },
  );
  assert.equal(parseSuccessAction({ tag: 'aes', ciphertext: 'AAAA' }), null);
  assert.equal(parseSuccessAction({ tag: 'aes', iv: 'BBBB' }), null);
});

// --- aes decrypt ---------------------------------------------------------

await test('aes: decrypts a round-tripped secret with the preimage', async () => {
  const decrypted = await decryptAesSuccessAction({ ciphertext, iv: ivB64 }, preimage);
  assert.equal(decrypted, secret);
});

// --- resolveSuccessAction ------------------------------------------------

await test('resolve: null in, null out', async () => {
  assert.equal(await resolveSuccessAction(null), null);
});

await test('resolve: message / url pass through unchanged', async () => {
  assert.deepEqual(
    await resolveSuccessAction({ tag: 'message', message: 'Hi' }),
    { tag: 'message', message: 'Hi' },
  );
  assert.deepEqual(
    await resolveSuccessAction({ tag: 'url', description: 'd', url: 'https://ex.com' }),
    { tag: 'url', description: 'd', url: 'https://ex.com' },
  );
});

await test('resolve: aes decrypts to secret', async () => {
  const resolved = await resolveSuccessAction(
    { tag: 'aes', description: 'Code', ciphertext, iv: ivB64 }, preimage,
  );
  assert.deepEqual(resolved, { tag: 'aes', description: 'Code', secret, decryptError: false });
});

await test('resolve: aes failure degrades to decryptError without throwing', async () => {
  const resolved = await resolveSuccessAction(
    { tag: 'aes', description: 'Code', ciphertext, iv: ivB64 }, 'deadbeef', // not a 32-byte preimage
  );
  assert.equal(resolved.decryptError, true);
  assert.equal(resolved.secret, null);
  assert.equal(resolved.description, 'Code');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
