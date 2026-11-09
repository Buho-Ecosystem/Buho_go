/**
 * NIP-47 payment requests BuhoGO signs carry a NIP-40 expiration, so a
 * wallet that wakes late never pays something BuhoGO stopped waiting for.
 * Reads carry none, so a phone clock that is off stops no reads.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNwcClient, createNwcProvider, expirePayments, REQUEST_TTL_S, withExpiration } from '../nwcClient.js';
import { LOOKUP_DELAYS_MS } from '../nwcPayment.js';

/** A real public key (the curve's generator, private key 1), so the SDK's encryption works. */
const WALLET = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const URL = `nostr+walletconnect://${WALLET}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const request = (extra = {}) => ({ kind: 23194, created_at: 1_800_000_000, tags: [['p', 'ab'], ['encryption', 'nip44_v2']], content: 'x', ...extra });
const expirationOf = (event) => event.tags.find((tag) => tag[0] === 'expiration')?.[1];

test('a payment request stays valid through the wait for its answer and the lookups after it', () => {
  assert.equal(REQUEST_TTL_S, 60 + LOOKUP_DELAYS_MS.reduce((a, b) => a + b, 0) / 1000);
  const tagged = withExpiration(request());
  assert.equal(expirationOf(tagged), String(1_800_000_000 + REQUEST_TTL_S));
  assert.deepEqual(tagged.tags.slice(0, 2), [['p', 'ab'], ['encryption', 'nip44_v2']], 'the SDK\'s own tags stay');
});

test('only requests expire; an expiration already there is replaced, not doubled', () => {
  const info = { kind: 13194, created_at: 1, tags: [], content: '' };
  assert.equal(withExpiration(info), info);
  const again = withExpiration(withExpiration(request()));
  assert.equal(again.tags.filter((tag) => tag[0] === 'expiration').length, 1);
});

test('the client tags what it encrypted as a payment, and nothing else', async () => {
  const signed = [];
  const client = {
    async encrypt(_pubkey, plain) { return `cipher:${plain}`; },
    async signEvent(event) { signed.push(event); return { ...event, id: `e${signed.length}`, sig: 's' }; },
  };
  expirePayments(client);
  expirePayments(client); // a second wrap changes nothing
  for (const method of ['pay_invoice', 'get_balance', 'make_invoice', 'pay_keysend']) {
    const content = await client.encrypt('w', JSON.stringify({ method, params: {} }));
    await client.signEvent(request({ content }));
  }
  assert.deepEqual(signed.map((event) => !!expirationOf(event)), [true, false, false, true]);
  await client.signEvent(request({ content: 'cipher:not-json' }));
  assert.equal(expirationOf(signed.at(-1)), undefined);
});

/**
 * The real SDK client up to the relay: every event it would publish is
 * kept, and no answer ever comes.
 */
function offline(client) {
  const published = [];
  client._checkConnected = async () => {};
  client._selectEncryptionType = async () => { client._encryptionType = 'nip44_v2'; };
  client.pool = {
    publishTimeout: 5000,
    subscribe: () => ({ close() {} }),
    publish: (_relays, event) => { published.push(event); return [Promise.resolve('ok')]; },
  };
  return published;
}

async function until(done) {
  for (let i = 0; i < 1000 && !done(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), 'the SDK published');
}

test('through the SDK itself: a payment leaves with an expiration, a read without one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {}); // the SDK reports each unanswered request
  for (const client of [createNwcClient(URL), createNwcProvider(URL).client]) {
    const published = offline(client);
    const pay = client.payInvoice({ invoice: 'lnbc1' }).catch((error) => error);
    await until(() => published.length === 1);
    const read = client.getBalance().catch((error) => error);
    await until(() => published.length === 2);
    t.mock.timers.tick(61_000); // the SDK's reply waits run out
    await Promise.all([pay, read]);

    const [payment, balance] = published;
    assert.equal(Number(expirationOf(payment)), payment.created_at + REQUEST_TTL_S, 'the payment expires');
    assert.match(payment.sig, /^[0-9a-f]{128}$/, 'still signed by the SDK');
    assert.equal(expirationOf(balance), undefined, 'the read does not');
  }
});
