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
import * as addressUtils from '../../utils/addressUtils.js';
import * as lightningAddressNames from '../../utils/lightningAddressNames.js';

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
 * @param {object} [options.deps]       more module stand-ins (import path -> exports), e.g. other providers
 * @param {boolean} [options.validate]  run the store's own wallet validation on load (skipped otherwise)
 */
export function createHarness({ evidence = {}, connect = null, storage = {}, exits = {}, deps: extraDeps = {}, validate = false } = {}) {
  const local = memoryStorage(storage);
  globalThis.localStorage = local;
  const calls = { probes: [], deletedStorage: [], reconciled: [], removedConfigs: [], kitsRemoved: [], preserved: [], backupNotes: 0 };
  const balances = {};
  // A stand-in for the Lightning address server: one address per identity key.
  const server = { byPubkey: new Map(), random: 0, ensures: 0, failClaim: false };
  const holder = (username) => [...server.byPubkey].find(([, name]) => name === username)?.[0];
  const domain = 'btc.example.com';

  const createWalletProvider = (wallet) => {
    const pubkey = `pk-${wallet.connectionData.accountNumber}`;
    return {
      isConnected: false,
      async initializeWithMnemonic(mnemonic) {
        if (connect) await connect(wallet, mnemonic);
        this.isConnected = true;
      },
      async getBalance() { return { balance: balances[wallet.id] ?? 0, fresh: true }; },
      async getInfo() { return { sparkAddress: `spark-${wallet.connectionData.accountNumber}` }; },
      identityPubkey: () => pubkey,
      async getLightningAddress() {
        const name = server.byPubkey.get(pubkey);
        return name ? { lightningAddress: `${name}@${domain}`, username: name } : null;
      },
      async ensureLightningAddress({ previousAddress } = {}) {
        server.ensures += 1;
        await tick();
        if (server.offlineFor === pubkey) throw new Error('lookup failed');
        const held = server.byPubkey.get(pubkey);
        if (held) return `${held}@${domain}`;
        const previous = previousAddress ? String(previousAddress).split('@')[0] : '';
        if (previous && !holder(previous)) { server.byPubkey.set(pubkey, previous); return `${previous}@${domain}`; }
        server.random += 1;
        const name = `random${server.random}`;
        server.byPubkey.set(pubkey, name);
        return `${name}@${domain}`;
      },
      async authorizeLightningAddressTransfer(transfereePubkey) {
        const username = server.byPubkey.get(pubkey);
        if (!username) throw new Error('no address');
        return { username, pubkey: transfereePubkey, signature: `sig-${pubkey}`, domain, timestamp: 1 };
      },
      async claimLightningAddressTransfer(authorization) {
        if (server.claimGate) await server.claimGate;
        if (server.failClaim) throw new Error('claim rejected');
        if (authorization.pubkey !== pubkey) throw new Error('not for this wallet');
        server.byPubkey.delete(holder(authorization.username));
        server.byPubkey.set(pubkey, authorization.username);
        return { lightningAddress: `${authorization.username}@${domain}`, username: authorization.username };
      },
      async disconnect() { this.isConnected = false; },
    };
  };

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
    '../utils/addressUtils.js': addressUtils,
    '../utils/lightningAddressNames.js': lightningAddressNames,
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
    '../utils/fiatRates.js': { fiatRatesService: { formatFiatAmount: (amount, currency) => `${currency} ${amount.toFixed(2)}` } },
    './cloudBackup.js': { useCloudBackupStore: () => ({ noteWalletsChanged: () => { calls.backupNotes += 1; } }) },
    ...extraDeps,
  };

  const source = readFileSync(new URL('../wallet.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  // The store reads its own storage, not the global one: work a store leaves
  // running after its test (a background discovery, a late connect) must
  // never write into the next test's device.
  new Function('require', 'module', 'exports', 'localStorage', code)((name) => deps[name] || {}, module, module.exports, local);
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
  store._syncProfilePaymentAddress = async () => {};
  // Saved fixtures may hold entries that validation would set aside.
  if (!validate) store.validateWallets = async () => {};

  return {
    store,
    /** The store's own actions, including the ones stubbed above. */
    actions: options.actions,
    calls,
    local,
    exits,
    server,
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
