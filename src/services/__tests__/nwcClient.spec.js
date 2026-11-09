/**
 * Every NIP-47 request BuhoGO signs carries a NIP-40 expiration, so a wallet
 * that wakes late never acts on a request BuhoGO has stopped waiting for.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNwcClient, createNwcProvider, expireRequests, REQUEST_TTL_S, withExpiration } from '../nwcClient.js';
import { LOOKUP_DELAYS_MS } from '../nwcPayment.js';

const URL = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const request = (extra = {}) => ({ kind: 23194, created_at: 1_800_000_000, tags: [['p', 'ab'], ['encryption', 'nip44_v2']], content: 'x', ...extra });
const expirationOf = (event) => event.tags.find((tag) => tag[0] === 'expiration')?.[1];

test('a request stays valid through the wait for a payment and the lookups after it', () => {
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

test('the client signs with the expiration, through its own signEvent', async () => {
  const signed = [];
  const client = { async signEvent(event) { signed.push(event); return { ...event, id: 'e1', sig: 's' }; } };
  expireRequests(client);
  expireRequests(client); // a second wrap changes nothing
  const event = await client.signEvent(request());
  assert.equal(signed.length, 1);
  assert.equal(expirationOf(signed[0]), String(1_800_000_000 + REQUEST_TTL_S));
  assert.equal(event.id, 'e1');
});

test('the real SDK client and provider sign requests that expire', async () => {
  for (const client of [createNwcClient(URL), createNwcProvider(URL).client]) {
    const event = await client.signEvent(request({ created_at: Math.floor(Date.now() / 1000) }));
    assert.ok(Number(expirationOf(event)) > event.created_at, 'expiration tag present');
    assert.match(event.sig, /^[0-9a-f]{128}$/, 'still signed by the SDK');
    client.close?.();
  }
});
