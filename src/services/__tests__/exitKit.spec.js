import '../../__tests__/memoryStorage.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExitKitService } from '../exitKit.js';
import { openKitStorage, kitKey } from '../../utils/kitStorage.js';
import { deriveKitPassphrase, kitFilename, kitState, kitCopies, toExitNetwork } from '../../utils/exitKit.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SPARK = 'spark1pgssxvvv';

function memoryMeta() {
  const kits = {};
  return {
    kits,
    kitFor: id => kits[id] || null,
    upsert(id, patch) { kits[id] = { ...(kits[id] || { walletId: id }), ...patch }; return kits[id]; },
    markFailed(id, message) { this.upsert(id, { failedSince: kits[id]?.failedSince || 1, lastError: String(message) }); },
    setRefreshing() {},
  };
}

function fakeProvider(overrides = {}) {
  const calls = { export: 0, import: [], prepare: [], events: [] };
  return {
    calls,
    isConnected: true,
    async exportUnilateralExitState() { calls.export++; return 'EXIT-STATE-' + calls.export; },
    async importUnilateralExitState(state) { calls.import.push(state); },
    async prepareUnilateralExit(request) { calls.prepare.push(request); return { recoverableValueSat: 89700, totalFeeSat: 8800, singleUtxoFundingSat: 8500, leaves: [{}, {}] }; },
    async getBalanceSatsLocal() { return 99600; },
    onExitDataChanged(cb) { calls.events.push(cb); return () => calls.events.splice(calls.events.indexOf(cb), 1); },
    ...overrides,
  };
}

function harness({ provider = fakeProvider(), connected = true } = {}) {
  let clock = 1_000_000;
  const storage = openKitStorage({ indexedDB: undefined });
  const meta = memoryMeta();
  const wallet = { id: 'w1', name: 'Personal', connectionData: { network: 'MAINNET', accountNumber: 2 }, metadata: { sparkAddress: SPARK } };
  const delivered = [];
  const service = createExitKitService({
    getWallet: id => (id === wallet.id ? wallet : null),
    getProvider: id => (id === wallet.id && connected ? provider : null),
    getMnemonic: async () => MNEMONIC,
    storage, meta,
    feeRate: async () => 3,
    encrypt: async (payload, passphrase) => ({ ct: JSON.stringify(payload).length, passphrase }),
    deliver: async args => { delivered.push(args); return { saved: true, shared: true }; },
    now: () => clock,
    schedule: fn => { fn(); return 0; },
  });
  return { service, storage, meta, provider, delivered, wallet, tick: ms => { clock += ms; } };
}

test('refresh exports the kit under the Spark address, checks it with an offline quote, and debounces', async () => {
  const h = harness();
  assert.deepEqual(await h.service.refresh('w1', { reason: 'connect' }), { ok: true });
  const record = await h.storage.get(kitKey(SPARK));
  assert.equal(record.exitState, 'EXIT-STATE-1');
  assert.equal(record.importedFor, 'w1');
  const kit = h.meta.kitFor('w1');
  assert.equal(kit.destinationAddress, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(kit.fundingAddress, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  assert.equal(kit.recoverableSat, 89700);
  assert.equal(kit.notWorthSat, 9900);
  assert.equal(kit.feeRate, 3);
  assert.equal(h.provider.calls.prepare[0].destination, kit.destinationAddress);
  assert.deepEqual(await h.service.refresh('w1'), { ok: false, reason: 'debounced' });
  h.tick(61_000);
  assert.deepEqual(await h.service.refresh('w1'), { ok: true });
  assert.equal(h.provider.calls.export, 2);
});

test('an export failure is recorded and cleared by the next success; a quote failure keeps the kit', async () => {
  const provider = fakeProvider();
  const h = harness({ provider });
  provider.exportUnilateralExitState = async () => { throw new Error('storage locked'); };
  assert.equal((await h.service.refresh('w1')).reason, 'failed');
  assert.ok(h.meta.kitFor('w1').failedSince);
  assert.equal(h.meta.kitFor('w1').lastError, 'storage locked');
  provider.exportUnilateralExitState = async () => 'EXIT-STATE-OK';
  provider.prepareUnilateralExit = async () => { throw new Error('no leaves'); };
  assert.deepEqual(await h.service.refresh('w1', { force: true }), { ok: true });
  assert.equal(h.meta.kitFor('w1').failedSince, null);
  assert.equal(h.meta.kitFor('w1').quoteError, 'no leaves');
  assert.equal((await h.storage.get(kitKey(SPARK))).exitState, 'EXIT-STATE-OK');
});

test('a stored kit from a previous wallet id is imported once on connect', async () => {
  const h = harness();
  await h.storage.set(kitKey(SPARK), { v: 1, sparkAddress: SPARK, exitState: 'OLD', exportedAt: 5, importedFor: 'old-id' });
  assert.equal(await h.service.importStoredKit('w1'), true);
  assert.deepEqual(h.provider.calls.import, ['OLD']);
  assert.equal(await h.service.importStoredKit('w1'), false);
  assert.equal((await h.storage.get(kitKey(SPARK))).importedFor, 'w1');
});

test('connect subscribes to exit data changes and refreshes; disconnect unsubscribes', async () => {
  const h = harness();
  h.service.onSparkConnected('w1');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(h.provider.calls.events.length, 1);
  assert.equal(h.provider.calls.export, 1);
  h.tick(61_000);
  h.provider.calls.events[0]('paymentSucceeded');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(h.provider.calls.export, 2);
  h.service.onSparkDisconnected('w1');
  assert.equal(h.provider.calls.events.length, 0);
});

test('removal takes a last export while connected and reports when it cannot', async () => {
  const h = harness();
  assert.deepEqual(await h.service.preserveBeforeRemoval('w1'), { ok: true });
  const offline = harness({ connected: false });
  assert.deepEqual(await offline.service.preserveBeforeRemoval('w1'), { ok: false, reason: 'not_connected' });
});

test('kits travel with the backup and newer restored kits replace older ones', async () => {
  const h = harness();
  await h.service.refresh('w1');
  const kits = await h.service.kitsForBackup(['w1', 'missing']);
  assert.equal(kits.length, 1);
  assert.deepEqual(Object.keys(kits[0]).sort(), ['accountNumber', 'exitState', 'exportedAt', 'network', 'sparkAddress']);
  h.service.markBackedUp(['w1'], 42);
  assert.equal(h.meta.kitFor('w1').driveAt, 42);
  assert.equal(await h.service.stashRestoredKits([{ sparkAddress: SPARK, exitState: 'OLDER', exportedAt: 1 }]), 0);
  assert.equal(await h.service.stashRestoredKits([{ sparkAddress: SPARK, exitState: 'NEWER', exportedAt: h.meta.kitFor('w1').exportedAt + 1 }]), 1);
  const record = await h.storage.get(kitKey(SPARK));
  assert.equal(record.exitState, 'NEWER');
  assert.equal(record.importedFor, null);
});

test('sharing encrypts the kit with a key from the words and keeps the file', async () => {
  const h = harness();
  await assert.rejects(() => h.service.share('w1'), error => error.code === 'NO_KIT');
  await h.service.refresh('w1');
  const result = await h.service.share('w1');
  assert.equal(result.saved, true);
  assert.match(h.delivered[0].filename, /^buhogo-exit-kit-personal-\d{4}-\d{2}-\d{2}\.json$/);
  const envelope = JSON.parse(h.delivered[0].data);
  assert.equal(envelope.passphrase, deriveKitPassphrase(MNEMONIC));
  assert.notEqual(envelope.passphrase, MNEMONIC);
  assert.ok(h.meta.kitFor('w1').sharedAt);
});

test('pure helpers: names, states and copies', () => {
  assert.equal(kitFilename('Personal', Date.UTC(2026, 8, 21, 12)), 'buhogo-exit-kit-personal-2026-09-21.json');
  assert.equal(kitFilename('', 0), 'buhogo-exit-kit-spark-1970-01-01.json');
  assert.equal(kitState(null), 'none');
  assert.equal(kitState({ exportedAt: 1, failedSince: 2 }), 'failed');
  assert.equal(kitState({ exportedAt: 1, checkedAt: 1 }), 'checked');
  assert.equal(kitState({ exportedAt: 1 }), 'saved');
  assert.deepEqual(kitCopies({ exportedAt: 10, driveAt: 9, sharedAt: 3 }), ['phone', 'drive', 'file']);
  assert.deepEqual(kitCopies({ exportedAt: 10 * 24 * 3600 * 1000, driveAt: 1 }), ['phone']);
  assert.equal(toExitNetwork('REGTEST'), 'regtest');
  assert.equal(toExitNetwork(undefined), 'mainnet');
  assert.equal(deriveKitPassphrase(MNEMONIC).length, 64);
});
