/**
 * The Drive backup store: what the payload carries for Spark, how a restore
 * applies it, and when the backup refreshes itself after wallet changes.
 * Runs the real store with the transport, crypto and other stores scripted.
 */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as sparkBackup from '../../utils/sparkBackup.js';
import { memoryStorage } from './sparkWalletHarness.js';

function harness({ wallets = [], meta = null, remote = null, platform = true, restoreResult = null, restoreError = null } = {}) {
  globalThis.localStorage = memoryStorage(meta ? { buhoGO_cloud_backup_meta_v1: JSON.stringify(meta) } : {});
  const log = [];
  const drive = { remote, uploads: [], listError: null };
  const wallet = {
    wallets,
    isInitialized: true,
    get hasAnySparkWallet() { return wallets.some((w) => w.type === 'spark'); },
    get sparkWallet() { return wallets.find((w) => w.type === 'spark'); },
    hasArkadeWallet: false,
    async getSparkMnemonic() { return 'phrase words'; },
    async restoreSparkWallets(args) {
      log.push(['restoreSpark', args]);
      if (restoreError) throw restoreError;
      return restoreResult || { merged: false, added: [{ id: 'w' }] };
    },
    async addWallet() { throw new Error('relay offline'); },
  };
  const deps = {
    pinia: { defineStore: (_, options) => options },
    '../utils/backupCrypto.js': { encryptBackup: async (payload) => ({ createdAt: new Date().toISOString(), payload }), decryptBackup: async (json) => JSON.parse(json).payload },
    '../services/cloudStorage.js': {
      isAvailable: async () => ({ available: true }),
      isCloudBackupPlatform: () => platform,
      uploadBackup: async (json) => { drive.uploads.push(JSON.parse(json).payload); return { modifiedAt: new Date().toISOString() }; },
      downloadBackup: async () => JSON.stringify({ payload: drive.payload }),
      uploadBackupKey: async () => {},
      downloadBackupKey: async () => JSON.stringify({ v: 1, k: 'key' }),
      getRemoteBackupInfo: async () => { if (drive.listError) throw drive.listError; return drive.remote; },
      deleteBackup: async () => {},
    },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', NWC: 'nwc', LNBITS: 'lnbits', ARKADE: 'arkade' } },
    './wallet.js': { useWalletStore: () => wallet },
    './identity.js': { useIdentityStore: () => ({ bootstrapped: false, async hydrate() {} }) },
    '../services/exitKit.js': { exitKitService: () => ({
      kitsForBackup: async () => [{ sparkAddress: 'spark1a', accountNumber: 1, exitState: 's', exportedAt: 1 }],
      stashRestoredKits: async (kits) => { log.push(['stash', kits.length]); return kits.length; },
      markBackedUp() {},
    }) },
    '../utils/sparkBackup.js': sparkBackup,
  };
  const source = readFileSync(new URL('../cloudBackup.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useCloudBackupStore;
  const store = { ...options.state() };
  for (const [name, fn] of Object.entries(options.actions)) store[name] = fn;
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter.call(store, store), configurable: true });
  }
  store.init();
  return { store, drive, log, wallet };
}

const spark = (id, accountNumber, name) => ({ id, type: 'spark', name, connectionData: { accountNumber, network: 'MAINNET' }, metadata: { lud16: `${id}@btc.example.com`, sparkAddress: `spark1${id}` } });

test('a backup carries the phrase once and the list of Spark wallets it covers', async () => {
  const { store, drive } = harness({ wallets: [spark('b', 2, 'Savings'), spark('a', 1, 'Main')] });
  await store.backup();
  const payload = drive.uploads[0];
  assert.equal(payload.v, 2, 'still version 2, so older apps can restore the phrase');
  assert.equal(payload.spark.mnemonic, 'phrase words');
  assert.deepEqual(payload.spark.accounts.map((a) => [a.accountNumber, a.name, a.lud16]), [[1, 'Main', 'a@btc.example.com'], [2, 'Savings', 'b@btc.example.com']]);
  assert.equal(payload.exitKits.length, 1);
});

test('a restore stores the exit kits first, then restores exactly the listed wallets', async () => {
  const { store, drive, log } = harness();
  drive.payload = { v: 2, spark: { mnemonic: 'phrase words', network: 'weird', accounts: [{ accountNumber: 3, name: 'Shop' }, { accountNumber: 1, name: 'Main' }] }, exitKits: [{ sparkAddress: 'x', exitState: 's' }] };
  const result = await store.restore();
  assert.deepEqual(log.map((entry) => entry[0]), ['stash', 'restoreSpark'], 'kits are in place before the first connect');
  const [, args] = log[1];
  assert.equal(args.network, 'MAINNET', 'an unknown network falls back to mainnet');
  assert.deepEqual(args.accounts, [{ accountNumber: 1, name: 'Main' }, { accountNumber: 3, name: 'Shop' }]);
  assert.deepEqual(result.restored, ['spark']);
});

test('an older backup restores its wallets through the exit kits; another phrase is skipped', async () => {
  const older = harness();
  older.drive.payload = { v: 2, spark: { mnemonic: 'phrase words' }, exitKits: [{ sparkAddress: 'x', accountNumber: 2, exitState: 's' }] };
  await older.store.restore();
  assert.deepEqual(older.log[1][1].accounts, [{ accountNumber: 2, name: '' }]);

  const other = harness({ restoreError: Object.assign(new Error('other phrase'), { code: 'SPARK_OTHER_PHRASE' }) });
  other.drive.payload = { v: 2, spark: { mnemonic: 'other words' } };
  const result = await other.store.restore();
  assert.deepEqual(result.skipped, ['spark']);
  assert.deepEqual(result.failed, []);
});

const configured = (extra = {}) => ({ wallets: [spark('a', 1, 'Main')], meta: { lastBackupAt: '2026-10-01T10:00:00.000Z', signedInEmail: 'me@example.com' }, ...extra });

test('after a wallet change the device that wrote the backup refreshes it, once, a few seconds later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, drive } = harness(configured({ remote: { modifiedAt: '2026-10-01T10:00:30.000Z' } }));
  store.noteWalletsChanged();
  store.noteWalletsChanged();
  assert.equal(store.backupOutOfDate, true);
  t.mock.timers.tick(4000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drive.uploads.length, 1, 'two changes, one upload');
  assert.equal(store.backupOutOfDate, false);
  assert.equal(store.autoBackupBlocked, null);
});

test('no silent upload without an earlier backup from this device, a signed-in account, or the platform', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const options of [{ meta: null }, { meta: { lastBackupAt: '2026-10-01T10:00:00.000Z' } }, configured({ platform: false })]) {
    const { store, drive } = harness({ wallets: [spark('a', 1, 'Main')], ...options });
    store.noteWalletsChanged();
    t.mock.timers.tick(10000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drive.uploads.length, 0);
    assert.ok(store.changedAt, 'the change is still remembered');
  }
});

test('a backup written by another phone in the meantime is never replaced silently', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, drive } = harness(configured({ remote: { modifiedAt: '2026-10-05T08:00:00.000Z' } }));
  store.noteWalletsChanged();
  t.mock.timers.tick(4000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drive.uploads.length, 0);
  assert.equal(store.autoBackupBlocked, 'remote_newer');
  store.noteWalletsChanged();
  t.mock.timers.tick(10000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drive.uploads.length, 0, 'stays paused');
  await store.backup();
  assert.equal(store.autoBackupBlocked, null, 'a backup the person starts clears it');
});

test('a restore that could not bring everything back pauses silent uploads', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, drive } = harness(configured());
  drive.payload = { v: 2, nwc: [{ name: 'Alby', nwcUrl: 'nostr+walletconnect://x' }] };
  const result = await store.restore();
  assert.equal(result.failed.length, 1);
  assert.equal(store.autoBackupBlocked, 'restore_incomplete');
  store.noteWalletsChanged();
  t.mock.timers.tick(10000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drive.uploads.length, 0, 'the backup still holds the wallet that did not come back');
});

test('an expired sign-in turns into a quiet note, never a prompt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, drive } = harness(configured());
  drive.listError = new Error('auth-required');
  store.noteWalletsChanged();
  t.mock.timers.tick(4000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.autoBackupBlocked, 'auth');
  assert.equal(store.signedIn, false);
  assert.equal(drive.uploads.length, 0);
});
