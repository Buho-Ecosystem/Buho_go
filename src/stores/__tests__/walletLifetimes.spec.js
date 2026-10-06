/**
 * Wallet lifetimes in the store (ported from the PR #296/#297 review).
 *
 * Runs the real store actions with scripted providers: concurrent Spark
 * connects share one attempt, a removal during a connect cannot resurrect
 * the wallet, and removing a grouped wallet removes exactly its group.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as balanceState from '../../utils/balanceState.js';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function load({ createProvider }) {
  const source = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', NWC: 'nwc', LNBITS: 'lnbits', ARKADE: 'arkade' }, createWalletProvider: createProvider, inferWalletType: () => 'spark' },
    '../utils/deviceCrypto': { decryptString: async () => 'test mnemonic' },
    '../utils/balanceState.js': balanceState,
    '../stores/autoWithdraw': {},
    './autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {}, removeConfig: async () => {} }) },
    './exitKit': { useExitKitStore: () => ({ remove() {} }) },
    '../services/exitKit.js': { exitKitService: () => ({ onSparkConnected() {}, onSparkDisconnected() {}, preserveBeforeRemoval: async () => {} }), clearExitData: async () => {} },
    '../services/breezSdk': { deleteWalletStorage: async () => {}, deleteAllStorage: async () => {} },
    '../boot/i18n': { i18n: { global: { t: (k) => k } } },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({ has: () => false, add() {} }) },
    '../utils/backupStatus.js': { isWalletBackedUp: () => true },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useWalletStore;
  const store = { ...options.state(), persistState: async () => {} };
  for (const [name, fn] of Object.entries(options.actions)) if (!(name in store)) store[name] = fn;
  store.persistState = async () => {};
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter.call(store, store), configurable: true });
  }
  return store;
}

function sparkWallet(id, group = 'g') {
  return { id, type: 'spark', name: id, connectionData: { encryptedMnemonic: 'x', accountNumber: id === 'B' ? 1 : 2, walletGroupId: group }, metadata: {} };
}

function scriptedProvider(init) {
  return {
    isConnected: false,
    disconnected: 0,
    async initializeWithMnemonic() { await init?.(); this.isConnected = true; },
    async getBalance() { return { balance: 1234, fresh: true }; },
    async getInfo() { return { sparkAddress: null }; },
    async disconnect() { this.disconnected += 1; this.isConnected = false; },
  };
}

test('concurrent Spark connects share one attempt and one provider', async () => {
  const gate = deferred();
  let built = 0;
  const store = load({ createProvider: () => { built += 1; return scriptedProvider(() => gate.promise); } });
  store.wallets = [sparkWallet('B')];
  const calls = [store.connectSparkWallet('B'), store.connectSparkWallet('B'), store.connectSparkWallet('B')];
  gate.resolve();
  await Promise.all(calls);
  assert.equal(built, 1, 'one provider wrapper for three callers');
  assert.equal(store.connectionStates.B.connected, true);
  assert.equal(store.balanceStates.B.value, 1234);
});

test('a wallet removed during its connect is not resurrected', async () => {
  const gate = deferred();
  const providers = [];
  const store = load({ createProvider: () => { const p = scriptedProvider(() => gate.promise); providers.push(p); return p; } });
  store.wallets = [sparkWallet('B')];
  const connecting = store.connectSparkWallet('B');
  await new Promise((r) => setImmediate(r));
  store.wallets = []; // removed mid-initialization
  store._bumpWalletEpoch('B');
  gate.resolve();
  await assert.rejects(connecting, /cancelled/);
  assert.equal(store.providers.B, undefined, 'no provider published');
  assert.equal(store.connectionStates.B, undefined, 'no connection state written');
  assert.equal(store.balanceStates.B, undefined, 'no balance published');
  assert.equal(providers[0].disconnected, 1, 'the abandoned SDK connection is released');
});

test('a rebuild supersedes an older attempt without letting it publish', async () => {
  const first = deferred();
  const built = [];
  const store = load({ createProvider: () => { const p = scriptedProvider(built.length === 0 ? () => first.promise : null); built.push(p); return p; } });
  store.wallets = [sparkWallet('B')];
  const old = store.connectSparkWallet('B');
  const rebuild = store.connectSparkWallet('B', { forceReinit: true });
  first.resolve();
  await old.catch(() => {});
  await rebuild;
  assert.equal(store.providers.B, built[built.length - 1], 'the newest provider owns the wallet');
});

test('removing a grouped wallet removes its group, never an unrelated wallet', async () => {
  const store = load({ createProvider: () => scriptedProvider() });
  const other = { id: 'N', type: 'nwc', name: 'Alby', connectionData: {}, metadata: {} };
  // Personal first, then Business, then an unrelated wallet: removing
  // Personal used to splice by a stale index and drop the wrong wallet.
  store.wallets = [sparkWallet('P'), sparkWallet('B'), other];
  store.activeWalletId = 'B';
  store.disconnectWallet = async () => {};
  store.switchActiveWallet = async (id) => { store.activeWalletId = id; };
  await store.removeWallet('P');
  assert.deepEqual(store.wallets.map((w) => w.id), ['N']);
  assert.equal(store.activeWalletId, 'N', 'a surviving wallet is selected even when a sibling was active');
});
