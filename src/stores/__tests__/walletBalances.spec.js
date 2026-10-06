import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';
import * as Pinia from 'pinia';
import * as balanceState from '../../utils/balanceState.js';
import * as amount from '../../utils/amountFormatting.js';
import { createSparkLifecycle } from '../../services/sparkLifecycle.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function load(file, deps = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || source;
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
  return module.exports;
}
const home = load('../../pages/Wallet.vue').default;
const settings = load('../../pages/Settings.vue', { pinia: { mapState: () => ({}), mapActions: () => ({}) }, '../utils/amountFormatting.js': amount }).default;
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); }, remove() {},
  setElementText(node, text) { node.text = text; }, setText(node, text) { node.text = text; }, parentNode: n => n.parent, nextSibling: () => null, patchProp() {},
});
function harness(ctx, type = 'lnbits') {
  const saved = new Map();
  const notices = [];
  globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const useStore = load('../wallet.js', {
    pinia: Pinia,
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', LNBITS: 'lnbits', ARKADE: 'arkade', NWC: 'nwc' } },
    '../utils/balanceState.js': balanceState,
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
    './autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {}, async initialize() {} }) },
    './notifications': { useNotificationsStore: () => ({ canNotify: true, notifyIfEnabled: async message => notices.push(message) }) },
    '../utils/amountFormatting.js': amount,
    '../boot/i18n': { i18n: { global: { t: (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name) } } },
  }).useWalletStore;
  const store = useStore(Pinia.createPinia());
  store.wallets = [{ id: 'A', type, name: 'Personal', metadata: {} }, { id: 'B', type, name: 'Business', metadata: {} }];
  for (const wallet of store.wallets) wallet.connectionData = { serverUrl: 'https://wallet.invalid', adminKey: 'test-key' };
  store.activeWalletId = 'A';
  let value = 1747, failure = null;
  const provider = Vue.markRaw({ isConnected: true, getBalance: async () => { if (failure) throw failure; return { balance: value }; }, getInfo: async () => ({}), async disconnect() {} });
  store.providers.A = provider;
  store.connectionStates.A = { connected: true, nwcInstance: provider };
  store.ensureWalletConnectedForTransfer = async id => { assert.equal(id, 'A'); return provider; };
  const root = { children: [] };
  const app = renderer.createApp({
    data: () => ({ walletStore: store, currentDisplayMode: 'bitcoin', balanceRefreshes: 0, balanceAwaitedSince: 0 }),
    computed: { activeWallet: home.computed.activeWallet, activeCanonicalBalance: home.computed.activeCanonicalBalance, activeBalanceState: home.computed.activeBalanceState, balanceNumericValue: home.computed.balanceNumericValue },
    methods: { updateWalletBalance: home.methods.updateWalletBalance, loadLastTransaction() {} },
    render() { return Vue.h('div', String(this.balanceNumericValue)); },
  });
  const vm = app.mount(root);
  ctx.after(() => { app.unmount(); clearTimeout(store._persistTimer); store.$dispose(); });
  const row = () => settings.methods.walletBalanceText.call({ walletStore: vm.walletStore, formatBalance: n => n }, 'A');
  async function restart() {
    const restored = useStore(Pinia.createPinia());
    restored.loadExchangeRates = async () => {};
    restored.connectLNBitsWallet = async id => {
      restored.providers[id] = provider;
      restored.connectionStates[id] = { connected: true };
      await restored.refreshBalance(id, { provider, source: 'connect' });
    };
    ctx.after(() => { clearTimeout(restored._persistTimer); restored.$dispose(); });
    vm.walletStore = restored;
    await restored.initialize();
    assert.equal(restored.lastError, null);
    await Vue.nextTick();
    return restored;
  }
  return { store, provider, vm, root, saved, row, notices, restart, setBalance: n => { value = n; failure = null; }, fail: () => { failure = new Error('offline'); } };
}

for (const type of ['lnbits', 'nwc', 'spark', 'arkade']) {
  test(`${type}: verified send/receive balances update Home, Manage wallets, total and durable snapshot`, async ctx => {
    const h = harness(ctx, type);
    if (type === 'spark') h.store.reconcileSpark = async () => h.store.refreshBalance('A');
    h.store.applyBalance('B', 16);
    await h.vm.updateWalletBalance();
    for (const next of [37, 237, 0]) {
      h.setBalance(next);
      await h.vm.updateWalletBalance(); await Vue.nextTick();
      assert.equal(h.vm.balanceNumericValue, next);
      assert.equal(h.root.children[0].text, String(next));
      assert.equal(h.row(), next);
      assert.equal(h.store.totalBalance, next + 16);
      assert.equal(h.store.balances.A, next);
      assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, next);
    }
  });
}

test('an obsolete Home snapshot cannot replace a verified balance on remount or restart', async ctx => {
  const h = harness(ctx);
  h.store.applyBalance('A', 37); h.store.applyBalance('B', 16);
  h.saved.set('buhoGO_wallet_state', JSON.stringify({ balance: 1747, activeWalletId: 'A' }));
  h.fail(); await h.vm.updateWalletBalance(); await Vue.nextTick();
  assert.equal(h.vm.balanceNumericValue, 37); assert.equal(h.row(), 37);
  assert.equal(h.store.balanceStateFor('A').status, 'stale');
  const restored = await h.restart();
  assert.equal(h.vm.balanceNumericValue, 37); assert.equal(h.row(), 37);
  assert.equal(restored.totalBalance, 53);
});

test('conflicting legacy caches need verification; migration cannot downgrade an already verified value', async ctx => {
  const h = harness(ctx);
  h.store.wallets[0].metadata.cachedBalance = 1747;
  const legacy = { activeWalletId: 'A', balance: 37, connectedWallets: [{ id: 'A', balance: 1747 }] };
  h.store.hydrateBalanceStates(legacy);
  h.fail(); await h.vm.updateWalletBalance();
  assert.equal(h.vm.activeCanonicalBalance, null); assert.equal(h.row(), '—');
  assert.equal(h.store.totalBalanceInfo.complete, false);
  await h.store.persistState();
  assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, null);
  h.setBalance(37); await h.vm.updateWalletBalance();
  h.store.hydrateBalanceStates(legacy);
  assert.equal(h.vm.balanceNumericValue, 37); assert.equal(h.row(), 37);
});

test('upgrade clears conflicting saved balances durably, then recovers from the provider', async ctx => {
  const h = harness(ctx);
  h.store.wallets[0].metadata.cachedBalance = 1747;
  h.store.wallets[1].metadata.cachedBalance = 16;
  h.saved.set('buhoGO_wallet_store', JSON.stringify({ wallets: h.store.wallets, activeWalletId: 'A' }));
  h.saved.set('buhoGO_wallet_state', JSON.stringify({ activeWalletId: 'A', balance: 37, connectedWallets: [{ id: 'A', balance: 1747 }] }));
  h.fail();
  const migrated = await h.restart();
  assert.equal(h.vm.activeCanonicalBalance, null); assert.equal(h.row(), '—');
  assert.equal(migrated.totalBalanceInfo.complete, false);
  await migrated.persistState();
  const offline = await h.restart();
  assert.equal(offline.balanceStates.A.value, null, 'a restart must not recover the rejected 1747 cache');
  h.setBalance(37);
  await offline.refreshBalance('A', { provider: h.provider });
  h.fail();
  const restored = await h.restart();
  assert.equal(h.vm.balanceNumericValue, 37); assert.equal(h.row(), 37);
  assert.equal(restored.totalBalance, 53);
});

test('a verified unchanged value repairs an inconsistent durable snapshot immediately', ctx => {
  const h = harness(ctx);
  h.store.applyBalance('A', 37, { at: 100 });
  h.store.wallets[0].metadata.cachedBalance = 1747;
  h.store.applyBalance('A', 37, { at: 200 });
  assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, 37);
  assert.equal(h.store.applyBalance('A', 1747, { at: 150 }), false);
  assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, 37);
});

test('failed cache reads preserve funds and never persist an unverified zero', async ctx => {
  const h = harness(ctx, 'spark');
  h.store.applyBalance('A', 37);
  h.provider.getBalance = async () => ({ balance: 0, fresh: false, syncError: 'offline' });
  assert.equal(await h.store.refreshBalance('A'), false);
  assert.equal(h.row(), 37);
  assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, 37);
});

test('Home and Manage refreshes share receipt tracking without duplicate notices', async ctx => {
  const h = harness(ctx);
  await h.vm.updateWalletBalance();
  h.setBalance(1847);
  await h.vm.updateWalletBalance();
  await h.store.refreshWalletData('A');
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].body, /100/);
});

test('wallet information failure or delay never blocks a fresh balance', async ctx => {
  const h = harness(ctx), info = deferred();
  h.store.applyBalance('A', 1747); h.setBalance(37);
  h.provider.getInfo = () => info.promise;
  const refreshing = h.store.refreshWalletData('A');
  for (let i = 0; i < 15; i++) await Vue.nextTick();
  assert.equal(h.row(), 37); assert.equal(h.vm.balanceNumericValue, 37);
  info.reject(new Error('wallet info unavailable')); await refreshing;
  assert.equal(h.store.balanceStateFor('A').status, 'fresh');
});

for (const outcome of ['success', 'error']) {
  test(`a late ${outcome} from an older read cannot replace a newer verified balance`, async ctx => {
    const h = harness(ctx), old = deferred();
    h.provider.getBalance = () => old.promise;
    const pending = h.store.refreshBalance('A'); await Vue.nextTick();
    h.provider.getBalance = async () => ({ balance: 37 });
    await h.store.refreshBalance('A');
    outcome === 'success' ? old.resolve({ balance: 1747 }) : old.reject(new Error('old timeout'));
    await pending;
    assert.equal(h.row(), 37); assert.equal(h.store.balanceStateFor('A').status, 'fresh');
  });
}

test('switching wallets keeps a delayed reading bound to its original wallet', async ctx => {
  const h = harness(ctx), old = deferred();
  h.store.applyBalance('B', 16); h.provider.getBalance = () => old.promise;
  const pending = h.vm.updateWalletBalance(); await Vue.nextTick();
  h.store.activeWalletId = 'B'; old.resolve({ balance: 37 }); await pending;
  assert.equal(h.vm.balanceNumericValue, 16); assert.equal(h.row(), 37);
  assert.equal(h.store.totalBalance, 53);
});

test('removal invalidates late reads and cannot resurrect balances in totals or persistence', async ctx => {
  const h = harness(ctx), old = deferred();
  h.provider.getBalance = () => old.promise;
  const pending = h.store.refreshBalance('A'); await Vue.nextTick();
  h.store.wallets = h.store.wallets.filter(w => w.id !== 'A'); h.store.forgetBalance('A');
  old.resolve({ balance: 1747 }); await pending;
  assert.equal(h.store.balanceStates.A, undefined); assert.equal(h.store.balances.A, undefined);
});

test('disconnect invalidates a pending read before reconnect publishes the new balance', async ctx => {
  const h = harness(ctx), old = deferred();
  h.provider.getBalance = () => old.promise;
  const pending = h.store.refreshBalance('A'); await Vue.nextTick();
  await h.store.disconnectWallet('A');
  h.provider.getBalance = async () => ({ balance: 37 });
  await h.store.refreshBalance('A', { provider: h.provider, source: 'connect' });
  old.resolve({ balance: 1747 }); await pending;
  assert.equal(h.row(), 37); assert.equal(h.store.balanceStates.A.refreshing, false);
});

for (const outcome of ['success', 'error']) {
  test(`Spark events supersede an older ${outcome} across lifecycle/store reads without leaving a loading balance`, async ctx => {
    const h = harness(ctx, 'spark'), old = deferred();
    let emit;
    const entry = {};
    const lifecycle = createSparkLifecycle({ store: h.store, peekEntry: () => entry,
      subscribe: (_, fn) => { emit = fn; return () => {}; }, syncedEventVerified: () => true });
    ctx.after(() => lifecycle.stop());
    h.provider.getBalance = () => old.promise;
    h.provider.getCachedBalance = async () => ({ balance: 37 });
    const pending = lifecycle.reconcile('A', 'resume');
    await Vue.nextTick();
    emit({ type: 'synced' }); await Vue.nextTick(); await Vue.nextTick();
    assert.equal(h.row(), 37); assert.equal(h.store.balanceStates.A.refreshing, false);
    outcome === 'success' ? old.resolve({ balance: 1747 }) : old.reject(new Error('old timeout'));
    await pending;
    assert.equal(h.row(), 37); assert.equal(h.store.balanceStateFor('A').status, 'fresh');
    assert.equal(JSON.parse(h.saved.get('buhoGO_wallet_store')).wallets[0].metadata.cachedBalance, 37);
  });
}
