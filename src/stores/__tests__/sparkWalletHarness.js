/**
 * Runs the real wallet store (src/stores/wallet.js) against scripted Spark
 * providers, an in-memory localStorage and the real pure modules that own
 * the multi-wallet rules. Shared by the Spark multi-wallet specs.
 */
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as balanceState from '../../utils/balanceState.js';
import * as backupStatus from '../../utils/backupStatus.js';
import * as sparkAccounts from '../../utils/sparkAccounts.js';
import * as sparkWalletMigration from '../../utils/sparkWalletMigration.js';
import * as walletNames from '../../utils/walletNames.js';
import * as walletRemoval from '../../utils/walletRemoval.js';
import * as exitLedger from '../../utils/exitLedger.js';
import * as sparkAccountScan from '../../services/sparkAccountScan.js';

export const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const OTHER_PHRASE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** Envelope stand-in: readable in tests, distinct per encryption like the real one. */
let envelopeCounter = 0;
export const encrypt = async (phrase) => `enc:${++envelopeCounter}:${phrase}`;
export const decrypt = async (envelope) => {
  const match = /^enc:\d+:(.*)$/.exec(envelope || '');
  if (!match) throw new Error('cannot decrypt');
  return match[1];
};

/**
 * @param {object} options
 * @param {object} [options.evidence]   account -> probe result, an Error to throw, or a function returning either
 * @param {Function} [options.connect]  (wallet) => void | throws, before a provider goes live
 * @param {object} [options.storage]    initial localStorage contents
 * @param {object} [options.exits]      walletId -> exit ledger record
 */
export function createHarness({ evidence = {}, connect = null, storage = {}, exits = {} } = {}) {
  const local = memoryStorage(storage);
  globalThis.localStorage = local;
  const calls = { probes: [], deletedStorage: [], reconciled: [], removedConfigs: [], kitsRemoved: [], preserved: [], backupNotes: 0 };
  const balances = {};

  const createWalletProvider = (wallet) => ({
    isConnected: false,
    async initializeWithMnemonic(mnemonic) {
      if (connect) await connect(wallet, mnemonic);
      this.isConnected = true;
    },
    async getBalance() { return { balance: balances[wallet.id] ?? 0, fresh: true }; },
    async getInfo() { return { sparkAddress: `spark-${wallet.connectionData.accountNumber}` }; },
    async ensureLightningAddress({ previousAddress } = {}) { return previousAddress || `user${wallet.connectionData.accountNumber}@example.com`; },
    async disconnect() { this.isConnected = false; },
  });

  const probeAccountActivity = async (mnemonic, { accountNumber }) => {
    calls.probes.push(accountNumber);
    let result = evidence[accountNumber];
    if (typeof result === 'function') result = await result();
    if (result instanceof Error) throw result;
    return result || { balanceSats: 0, paymentCount: 0, hasUnclaimedDeposit: false, lightningAddress: null, synced: true };
  };

  const exitStore = { exits, exitFor: (id) => exits[id] || null };
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', NWC: 'nwc', LNBITS: 'lnbits', ARKADE: 'arkade' }, createWalletProvider, inferWalletType: (w) => w.type || 'nwc' },
    '../utils/deviceCrypto': { encryptString: encrypt, decryptString: decrypt, isOldPinFormat: async () => false },
    '../utils/balanceState.js': balanceState,
    '../utils/backupStatus.js': backupStatus,
    '../utils/sparkAccounts.js': sparkAccounts,
    '../utils/sparkWalletMigration.js': sparkWalletMigration,
    '../utils/walletNames.js': walletNames,
    '../utils/walletRemoval.js': walletRemoval,
    '../utils/exitLedger.js': exitLedger,
    '../services/sparkAccountScan.js': sparkAccountScan,
    '../services/breezSdk': {
      deleteWalletStorage: async (id) => { calls.deletedStorage.push(id); },
      deleteAllStorage: async () => {},
      probeAccountActivity,
    },
    '../services/sparkLifecycleApp.js': {
      sparkLifecycle: () => ({ start() {}, reconcile(id) { calls.reconciled.push(id); return Promise.resolve(); } }),
      forgetSparkWallet: () => {},
    },
    './autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {}, async initialize() {}, removeConfig: async (id) => { calls.removedConfigs.push(id); } }) },
    './exitKit': { useExitKitStore: () => ({ remove: (id) => calls.kitsRemoved.push(id) }) },
    './emergencyExit': { useEmergencyExitStore: () => exitStore },
    '../services/exitKit.js': {
      exitKitService: () => ({ onSparkConnected() {}, onSparkDisconnected() {}, preserveBeforeRemoval: async (id) => { calls.preserved.push(id); } }),
      clearExitData: async () => {},
    },
    '../boot/i18n': { i18n: { global: { t: (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name) } } },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({ has: () => false, add() {} }) },
    '../utils/txCache.js': { clearCachedTransactions: () => {} },
    './cloudBackup.js': { useCloudBackupStore: () => ({ noteWalletsChanged: () => { calls.backupNotes += 1; } }) },
  };

  const source = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useWalletStore;

  const store = { ...options.state() };
  store.$patch = (patch) => Object.assign(store, patch);
  store.$subscribe = () => () => {};
  for (const [name, fn] of Object.entries(options.actions)) store[name] = fn;
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter.call(store, store), configurable: true });
  }
  // Network-facing helpers outside these specs.
  store.loadExchangeRates = async () => {};
  store.validateWallets = async () => {};
  store._syncProfilePaymentAddress = async () => {};

  return {
    store,
    calls,
    local,
    exits,
    setBalance(walletId, sats) {
      balances[walletId] = sats;
      const at = Date.now();
      store.balanceStates[walletId] = { ...balanceState.emptyBalanceState(), value: sats, source: 'sync', verifiedAt: at, updatedAt: at };
    },
    saved: () => JSON.parse(local.getItem('buhoGO_wallet_store') || 'null'),
  };
}

/** A saved Spark wallet entry as earlier versions wrote it. */
export async function savedSpark(id, accountNumber, { phrase = PHRASE, name = id, group = 'group-1', extra = {} } = {}) {
  return {
    id,
    type: 'spark',
    name,
    createdAt: 1000 + (accountNumber ?? 9),
    connectionData: { encryptedMnemonic: await encrypt(phrase), network: 'MAINNET', accountNumber, ...(group ? { walletGroupId: group } : {}) },
    metadata: { sparkAddress: `spark-${accountNumber}`, hasBackedUp: true, ...extra },
  };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));
