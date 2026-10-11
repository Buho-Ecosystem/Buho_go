/**
 * Identities from another app: reading a pasted secret key, keeping stored
 * records safe, and refusing a signer that answers for another key.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey, nip19, createSecretKeySigner } from 'nostr-core';
import { parseSecretKeyInput, sanitizeExternalIdentities, verifiedSigner } from '../externalIdentity.js';
import { bytesToHex } from '../identityCrypto.js';

const SECRET = generateSecretKey();
const PUBKEY = getPublicKey(SECRET);
const OTHER = generateSecretKey();

test('a pasted secret key is read as nsec or hex, and never mistaken for a public code', () => {
  for (const input of [nip19.nsecEncode(SECRET), `  ${nip19.nsecEncode(SECRET).toUpperCase()}  `, bytesToHex(SECRET)]) {
    const parsed = parseSecretKeyInput(input);
    assert.equal(parsed.ok, true, input.slice(0, 8));
    assert.equal(parsed.pubkeyHex, PUBKEY);
    assert.match(parsed.npub, /^npub1/);
  }
  assert.deepEqual(parseSecretKeyInput(nip19.npubEncode(PUBKEY)), { ok: false, problem: 'public_code' });
  assert.deepEqual(parseSecretKeyInput(''), { ok: false, problem: 'empty' });
  for (const junk of ['nsec1notakey', 'abc', 'f'.repeat(63), 'hello world']) {
    assert.deepEqual(parseSecretKeyInput(junk), { ok: false, problem: 'invalid' }, junk);
  }
});

test('stored records keep only what is safe to use', () => {
  const bunker = { remotePubkey: 'b'.repeat(64), relays: ['wss://relay.test', 'http://plain.test'] };
  const records = sanitizeExternalIdentities([
    { id: 'x1', kind: 'secretKey', pubkeyHex: PUBKEY.toUpperCase(), label: '  Main  ', createdAt: 5 },
    { id: 'x2', kind: 'nip46', pubkeyHex: 'c'.repeat(64), bunker },
    { id: 'x1', kind: 'nip07', pubkeyHex: 'd'.repeat(64) },
    { id: 'x3', kind: 'password', pubkeyHex: 'e'.repeat(64) },
    { id: 'x4', kind: 'nip07', pubkeyHex: 'not-hex' },
    { id: 'x5', kind: 'nip46', pubkeyHex: 'f'.repeat(64), bunker: { remotePubkey: 'b'.repeat(64), relays: ['http://plain.test'] } },
    null,
  ]);
  assert.deepEqual(records.map((r) => r.id), ['x1', 'x2']);
  assert.equal(records[0].pubkeyHex, PUBKEY, 'lowercased');
  assert.equal(records[0].label, 'Main');
  assert.deepEqual(records[1].bunker.relays, ['wss://relay.test'], 'only secure relays');
  assert.deepEqual(sanitizeExternalIdentities('junk'), []);
});

test('a signer is checked on every answer', async () => {
  const signer = verifiedSigner(createSecretKeySigner(SECRET), PUBKEY);
  const event = await signer.signEvent({ kind: 1, tags: [], content: 'hi', created_at: 1 });
  assert.equal(event.pubkey, PUBKEY);
  assert.equal(await signer.getPublicKey(), PUBKEY);

  const impostor = verifiedSigner(createSecretKeySigner(OTHER), PUBKEY);
  await assert.rejects(() => impostor.signEvent({ kind: 1, tags: [], content: 'hi', created_at: 1 }), (err) => err.code === 'SIGNER_MISMATCH');
  await assert.rejects(() => impostor.getPublicKey(), (err) => err.code === 'SIGNER_MISMATCH');

  const forged = verifiedSigner({ ...createSecretKeySigner(SECRET), signEvent: async (t) => ({ ...(await createSecretKeySigner(SECRET).signEvent(t)), content: 'changed' }) }, PUBKEY);
  await assert.rejects(() => forged.signEvent({ kind: 1, tags: [], content: 'hi', created_at: 1 }), (err) => err.code === 'SIGNER_MISMATCH', 'a bad signature is refused');
});
