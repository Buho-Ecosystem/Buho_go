/**
 * The wallet store's NWC rules: whether a wallet answered is recorded
 * apart from whether its connection is set up, and a spending limit whose
 * period has ended no longer holds a payment back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './sparkWalletHarness.js';

const URL_A = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const timeout = () => Object.assign(new Error('reply timeout: event abc'), { code: 'INTERNAL' });

function nwcWallet(store, client) {
  store.wallets = [{ id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: URL_A, metadata: { methods: ['pay_invoice', 'get_info', 'get_budget'] } }];
  store.connectionStates.hub = { connected: true, nwcInstance: { client }, error: null };
  store._schedulePersist = () => {};
}

test('a wallet that misses one reply stays connected; its status says it was silent', async () => {
  const { store } = createHarness();
  nwcWallet(store, { getInfo: async () => { throw timeout(); } });
  assert.equal(await store.refreshNwcDetails('hub'), 'no-answer');
  assert.equal(store.nwcStatus.hub, 'no-answer');
  assert.equal(store.connectionStates.hub.connected, true, 'still offered for payments, which wait longer');
  assert.equal(store.connectionStates.hub.error, null);
});

test('an answer refreshes the name, the grants and the limit', async () => {
  const { store } = createHarness();
  nwcWallet(store, {
    getInfo: async () => ({ alias: 'Alby Hub', pubkey: '02ab', methods: ['pay_invoice', 'make_invoice', 'get_budget'] }),
    getBudget: async () => ({ total_budget: 10_000_000, used_budget: 4_000_000, renews_at: 4_000_000_000 }),
  });
  assert.equal(await store.refreshNwcDetails('hub'), 'answering');
  assert.equal(store.wallets[0].metadata.alias, 'Alby Hub');
  assert.deepEqual(store.wallets[0].metadata.methods, ['pay_invoice', 'make_invoice', 'get_budget']);
  assert.equal(store.nwcLimitFor('hub').remainingSats, 6000);
});

test('a limit whose period has ended no longer holds a payment back', () => {
  const { store } = createHarness();
  store.nwcLimits.hub = { totalSats: 10_000, usedSats: 10_000, remainingSats: 0, renewsAt: Date.now() - 1000, period: 'monthly' };
  assert.equal(store.nwcLimitFor('hub'), null);
  store.nwcLimits.hub = { ...store.nwcLimits.hub, renewsAt: Date.now() + 60_000 };
  assert.equal(store.nwcLimitFor('hub').remainingSats, 0);
  store.nwcLimits.hub = { ...store.nwcLimits.hub, renewsAt: null };
  assert.equal(store.nwcLimitFor('hub').remainingSats, 0, 'a limit that never renews keeps holding');
});
