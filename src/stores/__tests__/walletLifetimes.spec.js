/**
 * Wallet lifetimes in the store (ported from the PR #296/#297 review).
 *
 * Runs the real store actions with scripted providers: concurrent Spark
 * connects share one attempt, a removal during a connect cannot resurrect
 * the wallet, and removing a Spark wallet removes exactly that wallet. The
 * lifetime starts with the load at start: the saved wallets are in memory
 * before any boot task or screen reads or saves them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as balanceState from '../../utils/balanceState.js';
import * as breezPayments from '../../utils/breezPayments.js';
import { createClaimedDepositRegistry } from '../../utils/claimedDeposits.js';
import * as sparkAccounts from '../../utils/sparkAccounts.js';
import * as walletRemoval from '../../utils/walletRemoval.js';
import * as exitLedger from '../../utils/exitLedger.js';
import * as nwcWallet from '../../utils/nwcWallet.js';
import * as nwcConnection from '../../utils/nwcConnection.js';
import * as nwcErrors from '../../utils/nwcErrors.js';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function load({ createProvider, extraDeps = {} }) {
  const source = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', NWC: 'nwc', LNBITS: 'lnbits', ARKADE: 'arkade' }, createWalletProvider: createProvider, inferWalletType: () => 'spark' },
    '../utils/deviceCrypto': { decryptString: async () => 'test mnemonic' },
    '../utils/balanceState.js': balanceState,
    // The pure NWC rules the store follows (connection grants, names, errors).
    '../utils/nwcWallet.js': nwcWallet,
    '../utils/nwcConnection.js': nwcConnection,
    '../utils/nwcErrors.js': nwcErrors,
    '../stores/autoWithdraw': {},
    './autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {}, removeConfig: async () => {} }) },
    './exitKit': { useExitKitStore: () => ({ remove() {} }) },
    '../services/exitKit.js': { exitKitService: () => ({ onSparkConnected() {}, onSparkDisconnected() {}, preserveBeforeRemoval: async () => {} }), clearExitData: async () => {} },
    '../services/breezSdk': { deleteWalletStorage: async () => {}, deleteAllStorage: async () => {} },
    '../boot/i18n': { i18n: { global: { t: (k) => k } } },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({ has: () => false, add() {} }) },
    '../utils/backupStatus.js': { isWalletBackedUp: () => true },
    '../utils/txCache.js': { clearCachedTransactions: async () => {} },
    '../utils/sparkAccounts.js': sparkAccounts,
    '../utils/walletRemoval.js': walletRemoval,
    '../utils/exitLedger.js': exitLedger,
    './emergencyExit': { useEmergencyExitStore: () => ({ exitFor: () => null }) },
    ...extraDeps,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useWalletStore;
  // A device whose saved state is loaded (nothing saved): removals may go
  // ahead. Saving itself is stubbed out.
  const store = { ...options.state(), savedStateLoaded: true, persistState: async () => {} };
  for (const [name, fn] of Object.entries(options.actions)) if (!(name in store)) store[name] = fn;
  store.persistState = async () => {};
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter.call(store, store), configurable: true });
  }
  return store;
}

function sparkWallet(id) {
  return { id, type: 'spark', name: id, connectionData: { encryptedMnemonic: 'x', accountNumber: id === 'B' ? 1 : 2 }, metadata: {} };
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

test('removing a Spark wallet removes exactly that wallet, never a sibling or an unrelated one', async () => {
  const store = load({ createProvider: () => scriptedProvider() });
  const other = { id: 'N', type: 'nwc', name: 'Alby', connectionData: {}, metadata: {} };
  // Removing the first entry used to splice by a stale index and drop the
  // wrong wallet; removing one Spark account used to take its sibling too.
  store.wallets = [sparkWallet('P'), sparkWallet('B'), other];
  store.activeWalletId = 'P';
  store.disconnectWallet = async () => {};
  store.switchActiveWallet = async (id) => { store.activeWalletId = id; };
  store.applyBalance('P', 0, { source: 'sync' });
  await store.removeWallet('P');
  assert.deepEqual(store.wallets.map((w) => w.id), ['B', 'N']);
  assert.equal(store.activeWalletId, 'B', 'selection moves to the remaining Spark wallet');
});

test('a wallet being removed cannot be connected meanwhile', async () => {
  const store = load({ createProvider: () => scriptedProvider() });
  store.wallets = [sparkWallet('P'), sparkWallet('B')];
  store.activeWalletId = 'B';
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  store.disconnectWallet = async () => { await gate; };
  store.applyBalance('P', 0, { source: 'sync' });
  const removal = store.removeWallet('P');
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => store.connectSparkWallet('P'), /cancelled/);
  release();
  await removal;
  assert.deepEqual(store.wallets.map((w) => w.id), ['B']);
  assert.equal(store.providers.P, undefined, 'no engine outlives the removal');
});

test('a claimed mark the SDK proves wrong is released; a fresh or in-flight one is not', () => {
  const registry = createClaimedDepositRegistry();
  const store = load({
    createProvider: () => scriptedProvider(),
    extraDeps: {
      '../utils/breezPayments.js': breezPayments,
      '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => registry },
    },
  });
  const failedRow = (txid) => ({ txid, vout: 0, amountSats: 132516, isMature: true, claimError: { type: 'maxDepositClaimFeeExceeded' } });
  // Marks from an earlier session (the lock bug): one per-output, one legacy bare txid.
  registry.add('stuck:0');
  registry.add('legacy');
  const deposits = breezPayments.mergePendingDeposits({
    chain: [], sdkRows: [failedRow('stuck'), failedRow('legacy'), failedRow('fresh'), failedRow('busy')], requiredConfirmations: 3,
  });
  store.markDepositClaimed('fresh', 0); // this session, moments ago
  registry.add('busy:0');
  store.markDepositClaimInFlight('busy', 0);

  assert.equal(store.reconcileDepositClaims(deposits), 2);
  assert.equal(store.isDepositClaimed('stuck', 0), false);
  assert.equal(store.isDepositClaimed('legacy', 0), false);
  assert.equal(store.isDepositClaimed('fresh', 0), true, 'a claim just made may meet a stale SDK read');
  assert.equal(store.isDepositClaimed('busy', 0), true, 'a claim in flight is left alone');

  // Explorer-only deposits carry no SDK proof and never release a mark.
  registry.add('chainonly:0');
  assert.equal(store.reconcileDepositClaims([{ txId: 'chainonly', outputIndex: 0, confirmed: true }]), 0);
  assert.equal(store.isDepositClaimed('chainonly', 0), true);
});

// ---- The load at start -------------------------------------------------------

const settle = () => new Promise((resolve) => setImmediate(resolve));
// A start that waits forever must fail here, not hang the run.
const BOUNDED = { timeout: 5000 };

test('the load at start waits for the saved wallets, is bounded, and never rejects', BOUNDED, async (t) => {
  const { loadSavedWalletsAtStart } = await import('../../utils/walletHydration.js');
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));

  const loading = deferred();
  const store = { hydrated: false, savedStateLoaded: false, whenHydrated: () => loading.promise };
  let started = false;
  const start = loadSavedWalletsAtStart(store, { waitMs: 60000 }).then(() => { started = true; });
  await settle();
  assert.equal(started, false, 'the start waits while the saved wallets load');
  Object.assign(store, { hydrated: true, savedStateLoaded: true });
  loading.resolve();
  await start;
  assert.deepEqual(warnings, []);

  await loadSavedWalletsAtStart({ hydrated: false, whenHydrated: () => new Promise(() => {}) }, { waitMs: 5 });
  assert.match(warnings.pop(), /still loading after 5 ms/, 'a load that never lands holds the start only so long');

  for (const whenHydrated of [() => Promise.reject(new Error('boom')), () => { throw new Error('boom'); }]) {
    await loadSavedWalletsAtStart({ hydrated: true, savedStateLoaded: true, whenHydrated }, { waitMs: 5 });
    assert.match(warnings.pop(), /Loading the saved wallets failed: boom/);
  }

  await loadSavedWalletsAtStart({ hydrated: true, savedStateLoaded: false, whenHydrated: async () => {} });
  assert.match(warnings.pop(), /could not be loaded/, 'a failed read is reported once at start');
});

test('the wallet-store boot holds the start until the saved wallets are loaded', BOUNDED, async () => {
  const hydration = await import('../../utils/walletHydration.js');
  const loading = deferred();
  const store = { hydrated: false, savedStateLoaded: false, whenHydrated: () => loading.promise };
  const { code } = transformSync(readFileSync(new URL('../../boot/wallet-store.js', import.meta.url), 'utf8'), { format: 'cjs' });
  const module = { exports: {} };
  const deps = { 'quasar/wrappers': { boot: (fn) => fn }, 'stores/wallet': { useWalletStore: () => store }, 'src/utils/walletHydration': hydration };
  new Function('require', 'module', 'exports', code)((name) => deps[name], module, module.exports);
  let done = false;
  const boot = Promise.resolve(module.exports.default({})).then(() => { done = true; });
  await settle();
  assert.equal(done, false, 'Quasar runs the next boot only after this one');
  Object.assign(store, { hydrated: true, savedStateLoaded: true });
  loading.resolve();
  await boot;
  assert.equal(done, true);
});

test("'wallet-store' boots after i18n and before every boot that reads or saves the wallets", () => {
  const config = readFileSync(new URL('../../../quasar.config.js', import.meta.url), 'utf8');
  const list = config.match(/boot:\s*\[([\s\S]*?)\]\.filter\(Boolean\)/)[1].replace(/\/\/.*$/gm, '');
  const order = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  const position = (name) => {
    const index = order.indexOf(name);
    assert.notEqual(index, -1, `'${name}' is registered`);
    return index;
  };
  assert.ok(position('wallet-store') > position('i18n'), 'after i18n');
  for (const later of ['kiosk', 'secure-screen', 'profile-sync', 'payment-address', 'emergency-exit', 'deep-links', 'nfc']) {
    assert.ok(position('wallet-store') < position(later), `before '${later}'`);
  }
});
