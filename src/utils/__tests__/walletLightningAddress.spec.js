/**
 * A wallet's own Lightning address (utils/walletLightningAddress.js): the one
 * reading Receive, Settings, Get paid and the refund row share.
 *
 * Run: node --test src/utils/__tests__/walletLightningAddress.spec.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletLightningAddress } from '../walletLightningAddress.js';

const NWC = 'nostr+walletconnect://' + 'ab'.repeat(32) + '?relay=wss%3A%2F%2Frelay.example&secret=' + 'cd'.repeat(32);

test('Spark: the live address first, the kept copy while the wallet is not connected', () => {
  const wallet = { id: 's', type: 'spark', metadata: { lud16: 'kept@spark.example' } };
  assert.equal(walletLightningAddress(wallet, { s: { lightningAddress: 'live@spark.example' } }), 'live@spark.example');
  assert.equal(walletLightningAddress(wallet, {}), 'kept@spark.example');
  assert.equal(walletLightningAddress(wallet), 'kept@spark.example', 'no wallet info at all');
  assert.equal(walletLightningAddress({ ...wallet, metadata: {} }, { s: { lightningAddress: '' } }), null, 'none claimed yet');
});

test('Spark never reads an address out of a connection string', () => {
  assert.equal(walletLightningAddress({ id: 's', type: 'spark', nwcUrl: `${NWC}&lud16=x%40y.example` }), null);
});

test('NWC and LNbits: the kept address, trimmed', () => {
  for (const type of ['nwc', 'lnbits']) {
    assert.equal(walletLightningAddress({ id: 'w', type, metadata: { lud16: '  me@hub.example ' } }), 'me@hub.example', type);
  }
});

test('an address saved with the connection string glued on is cut back out', () => {
  const wallet = { id: 'w', type: 'nwc', metadata: { lud16: `me@hub.example${NWC}` } };
  assert.equal(walletLightningAddress(wallet), 'me@hub.example');
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', metadata: { lud16: `me@hub.example nostr+walletconnect://x` } }), 'me@hub.example');
});

test('an NWC wallet without a kept address reads its connection string\'s lud16', () => {
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', nwcUrl: `${NWC}&lud16=me%40hub.example` }), 'me@hub.example');
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', connectionData: { nwcUrl: `${NWC}&lud16=me%40hub.example` } }), 'me@hub.example');
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', nwcUrl: NWC }), null, 'none in it');
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', nwcUrl: `${NWC}&lud16=not-an-address` }), null);
  assert.equal(walletLightningAddress({ id: 'w', type: 'nwc', nwcUrl: 'nostr+walletconnect://%%%' }), null, 'unreadable');
});

test('the check Receive and Settings always used: an international domain still shows', () => {
  assert.equal(walletLightningAddress({ id: 'w', type: 'lnbits', metadata: { lud16: 'maria@münchen.example' } }), 'maria@münchen.example');
  assert.equal(walletLightningAddress({ id: 'w', type: 'lnbits', metadata: { lud16: 'maria@xn--mnchen-3ya.example' } }), 'maria@xn--mnchen-3ya.example');
});

test('Arkade, and anything that is not an address, gives none', () => {
  assert.equal(walletLightningAddress({ id: 'a', type: 'arkade', metadata: {} }), null);
  for (const lud16 of ['', 'me', 'me@', '@hub.example', 'me@hub', 'a@b@c.example', 'me @hub.example', 'https://hub.example/.well-known/lnurlp/me', 42, null, { address: 'me@hub.example' }]) {
    assert.equal(walletLightningAddress({ id: 'w', type: 'lnbits', metadata: { lud16 } }), null, JSON.stringify(lud16));
  }
  for (const wallet of [null, undefined, 'spark', 0]) assert.equal(walletLightningAddress(wallet), null);
});
