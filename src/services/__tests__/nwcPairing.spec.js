/**
 * services/nwcPairing: keeping a pairing request (encrypted, one at a
 * time, taken once) and recognising the wallet's answer on a relay.
 *
 *   node --test src/services/__tests__/nwcPairing.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-core';
import { createPairingRequest, PAIRING_TTL_MS } from '../../utils/nwcPairing.js';
import {
  clearPairing, listenForWalletAnswer, loadPairing, savePairing, takePairing,
  waitForApproval, walletKnowsConnection,
} from '../nwcPairing.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => [...map.values()].join(''),
  };
}
// A stand-in for the device key: reversible, and visibly not plain JSON.
const crypt = {
  encrypt: async (text) => `enc:${Buffer.from(text).toString('base64')}`,
  decrypt: async (text) => Buffer.from(text.slice(4), 'base64').toString(),
};

test('a request is kept encrypted and read back', async () => {
  const storage = memoryStorage();
  const request = createPairingRequest('hub', { hubUrl: 'https://hub.example.com' });
  await savePairing(request, { storage, encrypt: crypt.encrypt });
  assert.ok(!storage.dump().includes(request.secret), 'the secret is not stored in the clear');
  assert.deepEqual(await loadPairing({ storage, decrypt: crypt.decrypt, now: request.createdAt }), request);
});

test('an expired request is dropped', async () => {
  const storage = memoryStorage();
  const request = createPairingRequest('code', { now: 1000 });
  await savePairing(request, { storage, encrypt: crypt.encrypt });
  assert.equal(await loadPairing({ storage, decrypt: crypt.decrypt, now: 1001 + PAIRING_TTL_MS }), null);
  assert.equal(storage.getItem('buhoGO_nwc_pairing'), null);
});

test('a request is taken once, even by two answers at the same time', async () => {
  const storage = memoryStorage();
  const request = createPairingRequest('hub');
  await savePairing(request, { storage, encrypt: crypt.encrypt });
  const options = { storage, decrypt: crypt.decrypt, now: request.createdAt };
  const [first, second] = await Promise.all([takePairing(request.id, options), takePairing(request.id, options)]);
  assert.deepEqual([first?.id, second], [request.id, null]);
  assert.equal(await takePairing(request.id, options), null);
});

test('a request with another id is not taken', async () => {
  const storage = memoryStorage();
  const request = createPairingRequest('hub');
  await savePairing(request, { storage, encrypt: crypt.encrypt });
  assert.equal(await takePairing('other', { storage, decrypt: crypt.decrypt, now: request.createdAt }), null);
  clearPairing({ storage });
  assert.equal(await loadPairing({ storage, decrypt: crypt.decrypt }), null);
});

/** A relay that hands every subscription the events it is given. */
function fakeRelays(eventsByUrl, { unreachable = [] } = {}) {
  const made = [];
  const createRelay = (url) => {
    const relay = {
      url,
      closed: false,
      filters: null,
      connect: async () => { if (unreachable.includes(url)) throw new Error('refused'); },
      subscribe(filters, { onevent }) {
        relay.filters = filters;
        queueMicrotask(() => { for (const event of eventsByUrl[url] || []) onevent(event); });
        return { close() {} };
      },
      close() { relay.closed = true; },
    };
    made.push(relay);
    return relay;
  };
  return { made, createRelay };
}

const walletKey = generateSecretKey();
const signedAnswer = (request, tags) => finalizeEvent({ kind: 13194, created_at: Math.floor(Date.now() / 1000), tags, content: 'pay_invoice get_info' }, walletKey);

test('the wallet answer on a relay finishes the wait, once', async () => {
  const request = createPairingRequest('code');
  const event = signedAnswer(request, [['p', request.pubkey], ['state', request.state]]);
  const { made, createRelay } = fakeRelays({ 'wss://relay.getalby.com': [event, event] }, { unreachable: ['wss://relay2.getalby.com'] });
  const answers = [];
  await new Promise((resolve) => {
    listenForWalletAnswer(request, ['wss://relay.getalby.com', 'wss://relay2.getalby.com'], (a) => { answers.push(a); resolve(); }, { createRelay });
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(answers, [{ walletPubkey: getPublicKey(walletKey), relays: ['wss://relay.getalby.com'] }]);
  assert.deepEqual(made[0].filters, [{ kinds: [13194], '#p': [request.pubkey], since: Math.floor(request.createdAt / 1000) - 60 }]);
  assert.ok(made.every((r) => r.closed), 'every relay is closed after the answer');
});

test('a forged or foreign answer is ignored', async () => {
  const request = createPairingRequest('code');
  // Through JSON, as a relay delivers it: a spread would carry nostr-core's
  // "already verified" mark from finalizeEvent onto the forgery.
  const forged = JSON.parse(JSON.stringify({ ...signedAnswer(request, [['p', request.pubkey], ['state', request.state]]), pubkey: 'c'.repeat(64) }));
  const wrongState = signedAnswer(request, [['p', request.pubkey], ['state', 'f'.repeat(32)]]);
  const { createRelay } = fakeRelays({ 'wss://relay.getalby.com': [forged, wrongState] });
  let answered = false;
  const stop = listenForWalletAnswer(request, ['wss://relay.getalby.com'], () => { answered = true; }, { createRelay });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(answered, false);
});

test('Coinos counts as approved once it answers, or refuses as not allowed', async () => {
  const client = (behaviour) => () => ({ getInfo: async () => behaviour(), close() {} });
  assert.equal(await walletKnowsConnection('c', { createClient: client(() => ({ alias: 'coinos' })) }), true);
  assert.equal(await walletKnowsConnection('c', { createClient: client(() => { throw Object.assign(new Error('no'), { code: 'RESTRICTED' }); }) }), true);
  assert.equal(await walletKnowsConnection('c', { createClient: client(() => { throw Object.assign(new Error('no'), { code: 'UNAUTHORIZED' }); }) }), false);
  assert.equal(await walletKnowsConnection('c', { createClient: client(() => { throw new Error('reply timeout'); }) }), false);
});

test('waiting for approval asks until the wallet knows the connection, and stops on cancel', async () => {
  let asks = 0;
  const approved = await waitForApproval('c', { signal: new AbortController().signal, ask: async () => ++asks === 3, pauseMs: 1 });
  assert.equal(approved, true);
  assert.equal(asks, 3);

  const cancel = new AbortController();
  const waiting = waitForApproval('c', { signal: cancel.signal, ask: async () => false, pauseMs: 50 });
  setTimeout(() => cancel.abort(), 5);
  assert.equal(await waiting, false);
});
