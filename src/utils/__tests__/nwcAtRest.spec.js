/**
 * NWC connection strings are saved encrypted with the device key and kept
 * plain in memory; a save writes in one synchronous step after sealing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createNwcAtRest, STAND_IN_SECRET, withStandInSecret } from '../nwcAtRest.js';

const SECRET = '5e'.repeat(32);
const URL = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${SECRET}`;

/** Real AES-GCM, like utils/deviceCrypto, with a key of its own. */
async function aes() {
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return {
    encrypt: async (plain) => {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
      return Buffer.concat([iv, data]).toString('base64');
    },
    decrypt: async (envelope) => {
      const bytes = Buffer.from(envelope, 'base64');
      return new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
    },
  };
}

const nwc = (extra = {}) => ({ id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: URL, metadata: {}, ...extra });

test('a saved connection carries no secret, and opens to the same string', async () => {
  const crypto = await aes();
  const atRest = createNwcAtRest(crypto);
  const wallets = [nwc(), { id: 'spark', type: 'spark', connectionData: { encryptedMnemonic: 'x' } }];
  assert.equal(atRest.isSealed(wallets), false);
  await atRest.seal(wallets);
  assert.equal(atRest.isSealed(wallets), true);
  const saved = wallets.map((w) => atRest.toSaved(w));
  const text = JSON.stringify(saved);
  assert.ok(!text.includes(SECRET), 'the secret is nowhere in what is saved');
  assert.equal(saved[0].nwcUrl, URL.replace(SECRET, STAND_IN_SECRET), 'only the stand-in, for older versions');
  assert.deepEqual(saved[1], wallets[1], 'other wallets are saved as they are');

  const reopened = createNwcAtRest(crypto);
  const { wallet, plain } = await reopened.fromSaved(saved[0]);
  assert.deepEqual(wallet, wallets[0]);
  assert.equal(plain, false);
  assert.equal(reopened.isSealed([wallet]), true, 'its envelope is reused, not made again');
});

test('a string is encrypted once, whatever the number of saves', async () => {
  let encryptions = 0;
  const atRest = createNwcAtRest({ encrypt: async (plain) => { encryptions += 1; return `e:${plain.length}`; }, decrypt: async () => URL });
  for (let i = 0; i < 3; i += 1) await atRest.seal([nwc()]);
  assert.equal(encryptions, 1);
  assert.equal(atRest.toSaved(nwc()).sealedNwcUrl, atRest.toSaved(nwc()).sealedNwcUrl);
});

test('a wallet saved before strings were sealed is told apart, so it is sealed once', async () => {
  const atRest = createNwcAtRest(await aes());
  assert.equal((await atRest.fromSaved(nwc())).plain, true);
  assert.equal((await atRest.fromSaved({ id: 's', type: 'spark' })).plain, false);
});

test('an envelope that cannot be opened comes back as saved, to be set aside, not lost', async () => {
  const warnings = [];
  const atRest = createNwcAtRest({ ...(await aes()), warn: (...args) => warnings.push(args.join(' ')) });
  const saved = { id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: withStandInSecret(URL), sealedNwcUrl: 'b3Blbg==' };
  const { wallet } = await atRest.fromSaved(saved);
  assert.deepEqual(wallet, { id: 'hub', type: 'nwc', name: 'Hub', sealedNwcUrl: 'b3Blbg==' });
  assert.equal(wallet.nwcUrl, undefined, 'never connected with the stand-in');
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes(SECRET));
});

test('a device that cannot encrypt saves the string as before rather than not at all', async () => {
  const atRest = createNwcAtRest({ encrypt: async () => { throw new Error('no WebCrypto'); }, decrypt: async () => '' });
  await atRest.seal([nwc()]);
  assert.equal(atRest.isSealed([nwc()]), true, 'nothing left to wait for');
  assert.equal(atRest.toSaved(nwc()).nwcUrl, URL);
});

test('a removed wallet\'s envelope is dropped from memory', async () => {
  const atRest = createNwcAtRest(await aes());
  await atRest.seal([nwc()]);
  await atRest.seal([]);
  assert.equal(atRest.isSealed([nwc()]), false, 'it would be sealed afresh');
});

test('an older version keeps a sealed wallet, and saves it back so a newer one opens it again', async () => {
  const crypto = await aes();
  const atRest = createNwcAtRest(crypto);
  await atRest.seal([nwc()]);
  const saved = atRest.toSaved(nwc());
  // What 1.10 does: keep an NWC wallet whose string has the right scheme,
  // and save every wallet back as it was read.
  assert.ok(saved.nwcUrl.startsWith('nostr+walletconnect://'));
  const throughOlder = JSON.parse(JSON.stringify({ ...saved, name: 'Renamed there' }));
  const { wallet } = await createNwcAtRest(crypto).fromSaved(throughOlder);
  assert.equal(wallet.nwcUrl, URL);
  assert.equal(wallet.name, 'Renamed there');
  assert.equal(wallet.sealedNwcUrl, undefined);
});

test('the stand-in replaces every secret and keeps the rest of the string', () => {
  const url = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Fr.example&secret=${SECRET}&lud16=me%40example.com`;
  assert.equal(withStandInSecret(url), url.replace(SECRET, STAND_IN_SECRET));
  assert.equal(withStandInSecret(`${url}&Secret=${SECRET}`).includes(SECRET), false);
});
