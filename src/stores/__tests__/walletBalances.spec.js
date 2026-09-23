import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Evaluate the real store module with its dependencies stubbed, then build a
// store object whose getters are live (computed on access like Pinia's).
function makeStore(initial = {}) {
  const { code } = transformSync(readFileSync(new URL('../wallet.js', import.meta.url), 'utf8'), { format: 'cjs', supported: { 'dynamic-import': false } });
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', LNBITS: 'lnbits', ARKADE: 'arkade', NWC: 'nwc' } },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
    '../boot/i18n': { i18n: { global: { t: k => k } } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
  const options = module.exports.useWalletStore;
  const store = { ...options.state(), ...initial, persistState: async () => {} };
  for (const [name, fn] of Object.entries(options.actions)) store[name] = fn.bind(store);
  store.persistState = async () => {};
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter.call(store, store), enumerable: true });
  }
  return store;
}

const spark = (id, metadata = {}) => ({ id, type: 'spark', name: id, metadata });

test('cold start publishes saved balances as stale instead of inventing zeros', () => {
  const store = makeStore({ wallets: [spark('biz', { cachedBalance: 25000 }), spark('personal', { cachedBalance: 0 })] });
  assert.equal(store.totalBalance, 0, 'before hydration nothing is known');
  assert.equal(store.totalBalanceView.complete, false);
  store._hydratePersistedBalances();
  assert.equal(store.totalBalance, 25000);
  const view = store.balanceView('biz');
  assert.equal(view.value, 25000);
  assert.equal(view.known, true);
  assert.equal(view.stale, true, 'a persisted value is last-known, not verified');
  assert.equal(store.balanceView('personal').known, true, 'a saved zero is a real zero');
  assert.deepEqual(store.totalBalanceView, { total: 25000, complete: true, missing: 0, stale: true });
});

test('an account with no value is unknown, and the total says it is incomplete', () => {
  const store = makeStore({ wallets: [spark('biz', { cachedBalance: 25000 }), spark('personal')] });
  store._hydratePersistedBalances();
  const missing = store.balanceView('personal');
  assert.equal(missing.known, false);
  assert.equal(missing.value, null, 'unknown is not zero');
  assert.equal(store.getDisplayBalance('personal').isKnown, false);
  assert.equal(store.totalBalanceView.complete, false);
  assert.equal(store.totalBalanceView.missing, 1);
});

test('a verified read is fresh everywhere and updates the persisted cache', () => {
  const wallet = spark('biz', { cachedBalance: 25000 });
  const store = makeStore({ wallets: [wallet], connectionStates: { biz: { connected: true } } });
  store._hydratePersistedBalances();
  const read = store.beginBalanceRead('biz');
  assert.equal(store.acceptBalance('biz', 0, { read, source: 'sync', verified: true }), true);
  const view = store.balanceView('biz');
  assert.deepEqual([view.value, view.known, view.stale], [0, true, false], 'a verified zero displays as zero');
  assert.equal(wallet.metadata.cachedBalance, 0);
  assert.equal(store.getDisplayBalance('biz').balance, 0);
  assert.equal(store.getDisplayBalance('biz').isKnown, true);
});

test('a failed refresh keeps the last-known value visible and marks it stale', () => {
  const store = makeStore({ wallets: [spark('biz')], connectionStates: { biz: { connected: true } } });
  store.acceptBalance('biz', 5000, { source: 'sync', verified: true });
  store.markBalanceError('biz', new Error('breez sync timeout'));
  const view = store.balanceView('biz');
  assert.equal(view.value, 5000);
  assert.equal(view.stale, true);
  assert.match(view.error, /timeout/);
});

test('a cache fallback is accepted but stays stale; disconnected is stale too', () => {
  const store = makeStore({ wallets: [spark('biz')], connectionStates: { biz: { connected: true } } });
  store.acceptBalance('biz', 700, { source: 'cache', verified: false, error: 'breez sync timeout' });
  assert.equal(store.balanceView('biz').stale, true);
  store.acceptBalance('biz', 800, { source: 'sync', verified: true });
  assert.equal(store.balanceView('biz').stale, false);
  store.connectionStates.biz = { connected: false };
  assert.equal(store.balanceView('biz').stale, true);
});

test('out-of-order reads cannot overwrite a newer accepted value', () => {
  const store = makeStore({ wallets: [spark('biz')] });
  const older = store.beginBalanceRead('biz');
  const newer = store.beginBalanceRead('biz');
  assert.equal(store.acceptBalance('biz', 2000, { read: newer }), true);
  assert.equal(store.acceptBalance('biz', 1000, { read: older }), false);
  assert.equal(store.balances.biz, 2000);
});

test('the total covers every configured wallet, not only runtime entries', () => {
  const store = makeStore({ wallets: [spark('biz'), spark('personal'), { id: 'nwc', type: 'nwc', metadata: {} }] });
  store.acceptBalance('biz', 100, { verified: true });
  store.acceptBalance('personal', 200, { verified: true });
  store.balances.removed = 99999; // a leftover entry for a wallet no longer configured
  assert.equal(store.totalBalance, 300);
  assert.equal(store.totalBalanceView.complete, false, 'the NWC wallet has no value yet');
});

test('unknown with a read under way is loading', () => {
  const store = makeStore({ wallets: [spark('biz')] });
  store.markBalanceRefreshing('biz');
  assert.equal(store.balanceView('biz').loading, true);
  assert.equal(store.balanceView('biz').known, false);
});
