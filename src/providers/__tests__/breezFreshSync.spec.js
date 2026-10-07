/**
 * Fresh synchronization versus cached reads (#291).
 *
 * getInfo({ ensureSynced: true }) only waits for the SDK's initial sync and
 * then reads the local cache, so it is no proof that Spark answered. These
 * tests run the REAL provider class against a scripted SDK and pin the
 * contract: a fresh read performs syncWallet, a cache read never records
 * network health, a failed sync stays visibly stale, money callers can
 * demand freshness, concurrent reads share one sync, and a sync that
 * outlives its connection cannot report success for the replacement.
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezFreshSync.spec.js
 */

import { strict as assert } from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => { throw new Error('network disabled under test'); };

const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');
const { sparkHealth } = await import('../../utils/sparkHealth.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failed += 1;
  }
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function scriptedSdk({ balance = 1000, sync = async () => ({}) } = {}) {
  const sdk = {
    balance,
    syncCalls: 0,
    ensureSyncedCalls: 0,
    async syncWallet() { sdk.syncCalls += 1; return sync(); },
    async getInfo(req = {}) {
      if (req.ensureSynced) sdk.ensureSyncedCalls += 1;
      return { balanceSats: sdk.balance, identityPubkey: '02' + '11'.repeat(32) };
    },
  };
  return sdk;
}

let seq = 0;
function providerWith(sdk) {
  const id = `w-fresh-${++seq}`;
  const provider = new BreezSparkWalletProvider(id, { name: 'test', _testSdk: sdk });
  provider.isConnected = true;
  return provider;
}

console.log('breez fresh sync contract');

await test('a fresh read performs a real sync after startup and says so', async () => {
  const sdk = scriptedSdk({ balance: 2686 });
  const provider = providerWith(sdk);
  await provider.whenInitiallySynced();
  const first = await provider.getBalance();
  const second = await provider.getBalance();
  assert.equal(sdk.syncCalls, 2, 'every fresh read asks the network');
  assert.equal(first.balance, 2686);
  assert.equal(first.fresh, true);
  assert.equal(first.source, 'sync');
  assert.ok(second.syncedAt >= first.syncedAt);
  assert.equal(provider.lastSyncedAt(), second.syncedAt);
});

await test('initial readiness and cache reads never record network health', async () => {
  const sdk = scriptedSdk();
  const provider = providerWith(sdk);
  sparkHealth().recordFailure(provider.walletId);
  await provider.whenInitiallySynced();
  const cached = await provider.getCachedBalance();
  assert.equal(cached.fresh, false);
  assert.equal(cached.source, 'cache');
  assert.equal(sdk.syncCalls, 0);
  assert.equal(sparkHealth().lastSuccessAt(provider.walletId), null, 'no success from a local read');
  assert.ok(sparkHealth().unreachableFor(provider.walletId) >= 0);
  assert.ok(store.get('buhoGO_spark_health_v1').includes(provider.walletId));
});

await test('a completed sync records success and clears the outage streak', async () => {
  const provider = providerWith(scriptedSdk());
  sparkHealth().recordFailure(provider.walletId);
  await provider.getBalance();
  assert.ok(sparkHealth().lastSuccessAt(provider.walletId));
  assert.equal(sparkHealth().unreachableFor(provider.walletId), 0);
});

await test('a failed sync keeps the last value, labelled stale, and records failure', async () => {
  const sdk = scriptedSdk({ balance: 500, sync: async () => { throw new Error('transport error'); } });
  const provider = providerWith(sdk);
  const result = await provider.getBalance();
  assert.equal(result.balance, 500, 'last known value survives');
  assert.equal(result.fresh, false);
  assert.equal(result.source, 'cache');
  assert.match(result.syncError, /transport error/);
  assert.equal(sparkHealth().lastSuccessAt(provider.walletId), null);
  assert.ok(sparkHealth().unreachableFor(provider.walletId) >= 0);
});

await test('money callers can require fresh data and see the failure', async () => {
  const provider = providerWith(scriptedSdk({ sync: async () => { throw new Error('offline'); } }));
  await assert.rejects(() => provider.getBalance({ requireFresh: true }), /offline/);
});

await test('a timeout is bounded and falls back to a stale value', async () => {
  const hang = deferred();
  const provider = providerWith(scriptedSdk({ balance: 42, sync: () => hang.promise }));
  const started = Date.now();
  const result = await provider.getBalance({ timeoutMs: 30 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.fresh, false);
  assert.match(result.syncError, /timeout/);
  await assert.rejects(() => provider.getBalance({ timeoutMs: 30, requireFresh: true }), (e) => e.code === 'BREEZ_SYNC_TIMEOUT');
  hang.resolve({});
});

await test('concurrent reads share one network sync', async () => {
  const gate = deferred();
  const sdk = scriptedSdk({ sync: () => gate.promise });
  const provider = providerWith(sdk);
  const reads = Promise.all([provider.getBalance(), provider.getBalance(), provider.syncNow()]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sdk.syncCalls, 1);
  gate.resolve({});
  const [a, b] = await reads;
  assert.equal(a.fresh, true);
  assert.equal(b.fresh, true);
  // The next request after completion starts a new sync.
  await provider.getBalance();
  assert.equal(sdk.syncCalls, 2);
});

await test('a sync that outlives its connection is rejected, never applied', async () => {
  const gate = deferred();
  const oldSdk = scriptedSdk({ balance: 999, sync: () => gate.promise });
  const provider = providerWith(oldSdk);
  const pending = provider.getBalance();
  await new Promise((r) => setTimeout(r, 5));
  provider.sdk = scriptedSdk({ balance: 5 }); // rebuild / replacement
  gate.resolve({});
  await assert.rejects(pending, (e) => e.code === 'BREEZ_SYNC_OBSOLETE');
  assert.equal(sparkHealth().lastSuccessAt(provider.walletId), null, 'old instance cannot vouch for the new one');
});

await test('reachability probes use a real sync', async () => {
  const sdk = scriptedSdk();
  const provider = providerWith(sdk);
  assert.equal(await provider.probeReachability({ timeoutMs: 100 }), true);
  assert.equal(sdk.syncCalls, 1);
  assert.equal(sdk.ensureSyncedCalls, 0);
  const down = providerWith(scriptedSdk({ sync: async () => { throw new Error('down'); } }));
  assert.equal(await down.probeReachability({ timeoutMs: 100 }), false);
  provider.isConnected = false;
  assert.equal(await provider.probeReachability(), false);
});

await test('a sync the SDK resolves while Spark never answered is not fresh (Breez 0.25 offline)', async () => {
  const { createSparkNetworkObserver } = await import('../../utils/sparkNetwork.js');
  const network = createSparkNetworkObserver();
  const offlineFetch = network.wrap(async () => { throw new TypeError('Failed to fetch'); });
  const onlineFetch = network.wrap(async () => ({ status: 200 }));
  let online = false;
  // The real SDK swallows its request failures and resolves syncWallet.
  const sdk = scriptedSdk({ balance: 77, sync: async () => {
    await Promise.allSettled([1, 2, 3].map(() => (online ? onlineFetch : offlineFetch)('https://0.spark.lightspark.com/rpc')));
    await new Promise((r) => setImmediate(r));
    return {};
  } });
  const provider = new BreezSparkWalletProvider('w-observed', { name: 't', _testSdk: sdk, _testNetwork: network });
  provider.isConnected = true;
  const stale = await provider.getBalance();
  assert.equal(stale.fresh, false);
  assert.equal(stale.balance, 77, 'last value kept');
  assert.match(stale.syncError, /did not answer/);
  assert.equal(sparkHealth().lastSuccessAt('w-observed'), null);
  await assert.rejects(() => provider.getBalance({ requireFresh: true }), (e) => e.code === 'BREEZ_SYNC_UNVERIFIED');
  online = true;
  const fresh = await provider.getBalance();
  assert.equal(fresh.fresh, true);
  assert.ok(sparkHealth().lastSuccessAt('w-observed'));
});

console.log(`\n${passed} passed, ${failed} failed`);
// The fiat-rate service's module-scope interval holds the event loop open.
process.exit(failed > 0 ? 1 : 0);
