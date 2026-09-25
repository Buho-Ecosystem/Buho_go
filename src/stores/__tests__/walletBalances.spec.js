import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Evaluate the real store module with its dependencies stubbed, then build a
// store object whose getters are live (computed on access like Pinia's).
function makeStore(initial = {}, overrides = {}) {
  const { code } = transformSync(readFileSync(new URL('../wallet.js', import.meta.url), 'utf8'), { format: 'cjs', supported: { 'dynamic-import': false } });
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', LNBITS: 'lnbits', ARKADE: 'arkade', NWC: 'nwc' } },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
    '../boot/i18n': { i18n: { global: { t: k => k } } },
  };
  Object.assign(deps, overrides);
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
  assert.equal(store.balanceView('biz').known, false, 'failed first read stays unknown');
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


test('an unverified cache read cannot clear a failure or replace a saved balance with startup zero', () => {
  const store = makeStore({ wallets: [spark('biz', { cachedBalance: 5000 })], connectionStates: { biz: { connected: true } } });
  store._hydratePersistedBalances();
  store.acceptBalance('biz', 0, { source: 'cache', error: 'timeout' });
  assert.equal(store.balanceView('biz').value, 5000);
  store.acceptBalance('biz', 5000, { source: 'sync', verified: true });
  store.markBalanceError('biz', 'offline');
  store.acceptBalance('biz', 5000, { source: 'cache' });
  assert.equal(store.balanceView('biz').stale, true);
  assert.equal(store.balanceView('biz').error, 'offline');
  store.acceptBalance('biz', 0, { source: 'event' });
  assert.equal(store.balanceView('biz').value, 5000, 'a partial SDK event must not replace saved funds after a failed sync');
  assert.equal(store.wallets[0].metadata.cachedBalance, 5000);
  store.acceptBalance('biz', 0, { source: 'sync', verified: true });
  assert.equal(store.balanceView('biz').value, 0, 'a successful retry can confirm an actual zero');
  assert.equal(store.balanceView('biz').stale, false);
});

test('a partial cache event after failed initialization leaves an unknown balance unknown', () => {
  const store = makeStore({ wallets: [spark('biz')] });
  store.markBalanceError('biz', 'timeout');
  store.acceptBalance('biz', 0, { source: 'event' });
  assert.equal(store.balanceView('biz').known, false);
  assert.equal(store.wallets[0].metadata.cachedBalance, undefined);
});

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function connectionHarness() {
  const gate = deferred();
  const calls = [];
  const wallet = { ...spark('biz'), connectionData: { encryptedMnemonic: 'encrypted' } };
  const provider = {
    async initializeWithMnemonic() { calls.push('initialize'); await gate.promise; this.isConnected = true; },
    async getBalance() { return { balance: 12, fresh: true }; },
    async getInfo() { return {}; },
    async disconnect() { calls.push('disconnect'); this.isConnected = false; },
  };
  const store = makeStore({ wallets: [wallet] }, {
    '../utils/deviceCrypto': { decryptString: async () => 'test phrase' },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark' }, createWalletProvider: () => provider },
    '../services/sparkLifecycle.js': { sparkLifecycle: () => ({ onSparkConnected() { calls.push('attach'); } }) },
    '../services/exitKit.js': { exitKitService: () => ({ onSparkConnected() {} }) },
  });
  return { store, provider, gate, calls };
}

test('concurrent Spark connections share one provider initialization', async () => {
  const h = connectionHarness();
  const a = h.store.connectSparkWallet('biz');
  const b = h.store.connectSparkWallet('biz');
  await new Promise(r => setImmediate(r));
  h.gate.resolve();
  await Promise.all([a, b]);
  assert.equal(h.calls.filter(c => c === 'initialize').length, 1);
  assert.equal(h.calls.filter(c => c === 'attach').length, 1);
});

test('removal during initialization cannot resurrect a provider or its state', async () => {
  const h = connectionHarness();
  const pending = h.store.connectSparkWallet('biz').catch(e => e);
  await new Promise(r => setImmediate(r));
  h.store._bumpWalletEpoch('biz');
  h.store.wallets = [];
  h.gate.resolve();
  await pending;
  assert.equal(h.store.providers.biz, undefined);
  assert.equal(h.store.connectionStates.biz, undefined);
  assert.equal(h.store.walletInfos.biz, undefined);
  assert.ok(h.calls.includes('disconnect'));
  assert.ok(!h.calls.includes('attach'));
});


test('removing Personal removes its group and selects a remaining wallet', async () => {
  const biz = { ...spark('biz'), connectionData: { walletGroupId: 'pair' } };
  const personal = { ...spark('personal'), connectionData: { walletGroupId: 'pair' } };
  const external = { id: 'external', type: 'nwc' };
  const store = makeStore({ wallets: [biz, personal, external], activeWalletId: 'biz' }, {
    './autoWithdraw': { useAutoWithdrawStore: () => ({ removeConfig: async () => {} }) },
    '../services/breezSdk': { deleteWalletStorage: async () => {} },
    '../services/exitKit.js': { exitKitService: () => ({ preserveBeforeRemoval: async () => {} }) },
  });
  store.disconnectWallet = async () => {};
  store.switchActiveWallet = async id => { store.activeWalletId = id; };
  await store.removeWallet('personal');
  assert.deepEqual(store.wallets.map(w => w.id), ['external']);
  assert.equal(store.activeWalletId, 'external');
});

for (const type of ['lnbits', 'arkade', 'nwc']) {
  test(`${type}: refresh failure preserves funds and a successful retry restores freshness`, async () => {
    let fail = false;
    const provider = {
      async getBalance() { if (fail) throw new Error('temporary connection failure'); return { balance: 500, pending: 30, recoverable: 20 }; },
      async getInfo() { return { alias: 'external wallet' }; },
    };
    const store = makeStore({ wallets: [{ id: 'external', type, metadata: {} }],
      providers: { external: provider }, connectionStates: { external: { connected: true, nwcInstance: provider } } }, {
      './autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {} }) },
    });
    await store.refreshWalletData('external');
    assert.equal(store.balanceView('external').value, 500);
    assert.equal(store.balanceView('external').stale, false);
    assert.equal(store.wallets[0].metadata.cachedBalance, 500);
    if (type === 'arkade') assert.deepEqual(store.balanceDetails.external, { pending: 30, recoverable: 20 });
    fail = true;
    await store.refreshWalletData('external');
    assert.equal(store.balanceView('external').value, 500);
    assert.equal(store.balanceView('external').stale, true);
    fail = false;
    store.connectionStates.external.connected = true;
    await store.refreshWalletData('external');
    assert.equal(store.balanceView('external').stale, false);
    assert.equal(store.balanceView('external').error, null);
  });
}
