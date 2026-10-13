/**
 * Identities from another app: reading a pasted secret key, keeping stored
 * records safe, and refusing a signer that answers for another key.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey, nip19, createSecretKeySigner } from 'nostr-core';
import { parseSecretKeyInput, sanitizeExternalIdentities, verifiedSigner } from '../externalIdentity.js';
import { bytesToHex } from '../identityCrypto.js';
import {
  adoptBunker, approvalUrl, BUNKER_PERMISSIONS, bunkerSigner, closeSigner, onSignerApproval, pairBunker,
} from '../../services/identitySigners.js';
import { KIND } from '../../services/dm/constants.js';
import { CONTACTS_DOC_KIND, RELAY_LIST_KIND } from '../nostrContactsDoc.js';
import { BLOSSOM_AUTH_KIND } from '../blossomProfileMedia.js';
import { createFakeRemoteSigner } from './fakeRemoteSigner.js';

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

/** A fake remote signer as the global WebSocket for one test; `ids` are closed after it. */
function remoteSigner(t, ...ids) {
  const signer = createFakeRemoteSigner();
  signer.install();
  t.after(async () => {
    await Promise.all(ids.map(closeSigner));
    signer.dispose();
  });
  return signer;
}

const note = () => ({ kind: 1, tags: [], content: 'hi', created_at: 1 });

test('a freshly paired remote signer keeps answering after the import sheet wiped its copy of the key', async (t) => {
  const signer = remoteSigner(t, 'paired');
  const paired = await pairBunker(`bunker://${signer.bunker.remotePubkey}?relay=${encodeURIComponent(signer.bunker.relays[0])}`);
  adoptBunker('paired', paired.connection);
  paired.clientKey.fill(0);
  const connection = await bunkerSigner('paired', signer.bunker, async () => assert.fail('no reconnect'));
  assert.equal((await connection.signEvent(note())).pubkey, signer.userPubkey);
});

test('a remote signer reconnected after a restart keeps answering', async (t) => {
  const signer = remoteSigner(t, 'restart');
  const clientKey = generateSecretKey();
  const connection = await bunkerSigner('restart', signer.bunker, async () => clientKey);
  assert.ok(clientKey.every((byte) => byte === 0), 'the loaded copy is wiped');
  assert.equal((await connection.signEvent(note())).pubkey, signer.userPubkey);
  assert.deepEqual(signer.requests.map((r) => r.method), ['connect', 'sign_event']);
});

test('callers that need a remote signer at the same time share one reconnect', async (t) => {
  const signer = remoteSigner(t, 'shared');
  const load = async () => generateSecretKey();
  const [a, b] = await Promise.all([bunkerSigner('shared', signer.bunker, load), bunkerSigner('shared', signer.bunker, load)]);
  assert.equal(a, b);
  assert.deepEqual(signer.requests.map((r) => r.method), ['connect']);
});

test('a remote signer that cannot be reached leaves no pairing key behind', async (t) => {
  const signer = remoteSigner(t);
  const clientKey = generateSecretKey();
  await assert.rejects(() => bunkerSigner('gone', { ...signer.bunker, relays: ['wss://nowhere.test'] }, async () => clientKey));
  assert.ok(clientKey.every((byte) => byte === 0));
});

test('a remote signer is asked at pairing for everything BuhoGO signs with it', async (t) => {
  const signer = remoteSigner(t, 'perms');
  await bunkerSigner('perms', signer.bunker, async () => generateSecretKey());
  const [connect] = signer.requests;
  assert.equal(connect.method, 'connect');
  assert.equal(connect.params[2], BUNKER_PERMISSIONS);

  const asked = BUNKER_PERMISSIONS.split(',');
  assert.equal(new Set(asked).size, asked.length);
  const kinds = [0, RELAY_LIST_KIND, CONTACTS_DOC_KIND, BLOSSOM_AUTH_KIND,
    KIND.SEAL, KIND.AUTH, KIND.DM_RELAYS, KIND.MUTE_LIST];
  for (const wanted of ['nip44_encrypt', 'nip44_decrypt', ...kinds.map((kind) => `sign_event:${kind}`)]) {
    assert.ok(asked.includes(wanted), wanted);
  }
});

test('a signer that asks for approval on its page gets it offered, and the request still completes', async (t) => {
  const signer = remoteSigner(t, 'approval');
  const offered = [];
  const stops = [onSignerApproval((url) => offered.push(url)), onSignerApproval(() => { throw new Error('a broken listener'); })];
  t.after(() => stops.forEach((stop) => stop()));
  const connection = await bunkerSigner('approval', signer.bunker, async () => generateSecretKey());
  signer.askApproval('https://signer.test/approve?id=1');
  signer.askApproval('intent://approve#Intent;end');
  assert.equal((await connection.signEvent(note())).pubkey, signer.userPubkey);
  assert.deepEqual(offered, ['https://signer.test/approve?id=1']);
});

test('only a plain https approval page from a signer is offered', () => {
  assert.equal(approvalUrl(' https://nsec.app/confirm?id=1 '), 'https://nsec.app/confirm?id=1');
  for (const unsafe of ['http://nsec.app/confirm', 'intent://x#Intent;end', 'javascript:alert(1)',
    'https://user:pass@nsec.app/', 'https://user@nsec.app/', 'not a link', '', null, undefined]) {
    assert.equal(approvalUrl(unsafe), null, String(unsafe));
  }
});
