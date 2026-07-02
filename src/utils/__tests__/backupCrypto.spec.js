// Smoke tests for the cloud-backup encryption envelope. We exercise the
// happy path (roundtrip), the auth-failure path (wrong passphrase), and a
// couple of negative shapes (bad version, modified ciphertext) to make sure
// the format-versioning and tamper-detection guards behave as advertised.
//
// Run with: node src/utils/__tests__/backupCrypto.spec.js
//
// Web Crypto is available on Node 19+ via globalThis.crypto. This test
// matches the project's existing no-framework Node convention — tiny
// `assert.equal`-style helpers, exits non-zero on first failure.

import assert from 'node:assert/strict';
import {
  encryptBackup,
  decryptBackup,
  WrongPassphraseError,
  InvalidBackupError,
  BACKUP_FORMAT,
} from '../backupCrypto.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('roundtrip: encrypts then decrypts back to the original payload', async () => {
  const payload = {
    v: 1,
    spark: { mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident', network: 'MAINNET' },
    identity: { mnemonic: 'zone year yellow worth worry word wool wood wonder woman wolf wizard' },
  };
  const envelope = await encryptBackup(payload, 'correct horse battery staple');
  const restored = await decryptBackup(envelope, 'correct horse battery staple');
  assert.deepEqual(restored, payload);
});

test('envelope advertises the format we documented', async () => {
  const env = await encryptBackup({ hello: 'world' }, 'pw');
  assert.equal(env.v, BACKUP_FORMAT.VERSION);
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.equal(env.cipher, 'AES-GCM');
  assert.equal(env.iterations, BACKUP_FORMAT.ITERATIONS);
  assert.ok(env.salt && env.iv && env.ct);
  assert.ok(typeof env.createdAt === 'string');
});

test('wrong passphrase throws WrongPassphraseError, not the generic decrypt error', async () => {
  const env = await encryptBackup({ secret: 'shh' }, 'right');
  await assert.rejects(
    () => decryptBackup(env, 'wrong'),
    (err) => err instanceof WrongPassphraseError && err.code === 'WRONG_PASSPHRASE',
  );
});

test('ciphertext tampering surfaces as WrongPassphraseError too (GCM auth tag covers it)', async () => {
  const env = await encryptBackup({ x: 1 }, 'pw');
  // Mutate a byte inside the ciphertext (not the trailing '='/padding).
  // Picking the first character and swapping it for a deterministic
  // alternative guarantees the decoded bytes differ regardless of which
  // characters the original happens to contain.
  const original = env.ct;
  const head = original[0];
  const replacement = head === 'A' ? 'B' : 'A';
  const tampered = { ...env, ct: replacement + original.slice(1) };
  await assert.rejects(
    () => decryptBackup(tampered, 'pw'),
    (err) => err instanceof WrongPassphraseError,
  );
});

test('unsupported version throws InvalidBackupError before doing PBKDF2 work', async () => {
  const env = await encryptBackup({ x: 1 }, 'pw');
  env.v = 999;
  await assert.rejects(
    () => decryptBackup(env, 'pw'),
    (err) => err instanceof InvalidBackupError,
  );
});

test('parses an envelope passed as a JSON string', async () => {
  const env = await encryptBackup({ k: 'v' }, 'pw');
  const restored = await decryptBackup(JSON.stringify(env), 'pw');
  assert.deepEqual(restored, { k: 'v' });
});

test('empty passphrase is rejected at encrypt time', async () => {
  await assert.rejects(() => encryptBackup({ x: 1 }, ''));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(err);
    }
  }
  console.log(`\n  ${tests.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
