/**
 * Fresh synchronization versus cached reads (#291).
 *
 * getInfo({ ensureSynced: true }) only waits for the SDK's initial sync and
 * then reads the local cache, so it is no proof that Spark answered. These
 * tests run the REAL provider class against a scripted SDK and pin the
 * contract: a fresh read performs syncWallet, a cache read never reports
 * Spark reachability, a failed sync stays visibly stale and never marks
 * Spark down by itself, one attempt reports one outcome however many
 * callers wait on it (#381), money callers can demand freshness,
 * concurrent reads share one sync, and a sync that outlives its connection
 * cannot report success for the replacement.
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
const { sparkReachability } = await import('../../utils/sparkReachability.js');
const { startReachabilityChecks, stopReachabilityChecks } = await import('../../services/sparkReachabilityCheck.js');

const settled = () => new Promise((r) => setImmediate(r));
const lastAnswer = () => sparkReachability().stored().lastAnsweredAt;

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

await test('initial readiness and cache reads never report reachability', async () => {
  const sdk = scriptedSdk();
  const provider = providerWith(sdk);
  sparkReachability().clear();
  await provider.whenInitiallySynced();
  const cached = await provider.getCachedBalance();
  await settled();
  assert.equal(cached.fresh, false);
  assert.equal(cached.source, 'cache');
  assert.equal(sdk.syncCalls, 0);
  assert.equal(lastAnswer(), null, 'no answer from a local read');
});

await test('a completed sync reports that Spark answered', async () => {
  const provider = providerWith(scriptedSdk());
  sparkReachability().clear();
  await provider.getBalance();
  await settled();
  assert.ok(lastAnswer());
});

await test('a failed sync keeps the last value, labelled stale, and never marks Spark down by itself', async () => {
  const sdk = scriptedSdk({ balance: 500, sync: async () => { throw new Error('transport error'); } });
  const provider = providerWith(sdk);
  const result = await provider.getBalance();
  assert.equal(result.balance, 500, 'last known value survives');
  assert.equal(result.fresh, false);
  assert.equal(result.source, 'cache');
  assert.match(result.syncError, /transport error/);
  await settled();
  assert.equal(sparkReachability().stored().firstDownAt, null);
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
  sparkReachability().clear();
  const gate = deferred();
  const oldSdk = scriptedSdk({ balance: 999, sync: () => gate.promise });
  const provider = providerWith(oldSdk);
  const pending = provider.getBalance();
  await new Promise((r) => setTimeout(r, 5));
  provider.sdk = scriptedSdk({ balance: 5 }); // rebuild / replacement
  gate.resolve({});
  await assert.rejects(pending, (e) => e.code === 'BREEZ_SYNC_OBSOLETE');
  await settled();
  assert.equal(lastAnswer(), null, 'old instance cannot vouch for the new one');
});

await test('one sync attempt reports one outcome, however many callers wait on it (#381)', async () => {
  const checker = startReachabilityChecks();
  const reports = [];
  checker.reportFailedAttempt = (outcome) => reports.push(outcome);
  checker.reportAnswered = () => reports.push('answered');
  try {
    const gate = deferred();
    const provider = providerWith(scriptedSdk({ sync: () => gate.promise }));
    const callers = Promise.allSettled([provider.getBalance(), provider.getBalance(), provider.syncNow(), provider.getBalance()]);
    await settled();
    gate.reject(new Error('down'));
    await callers;
    await settled();
    assert.deepEqual(reports, [{ errored: false }]);
  } finally {
    stopReachabilityChecks();
  }
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
  await settled();
  assert.equal(lastAnswer(), null);
  await assert.rejects(() => provider.getBalance({ requireFresh: true }), (e) => e.code === 'BREEZ_SYNC_UNVERIFIED');
  online = true;
  const fresh = await provider.getBalance();
  assert.equal(fresh.fresh, true);
  await settled();
  assert.ok(lastAnswer());
});

await test('a failed sync that still got real Spark answers counts as Spark answering', async () => {
  const { createSparkNetworkObserver } = await import('../../utils/sparkNetwork.js');
  const network = createSparkNetworkObserver();
  let n = 0;
  const flaky = network.wrap(async () => { n += 1; if (n > 1) throw new TypeError('Failed to fetch'); return { status: 200 }; });
  const sdk = scriptedSdk({ sync: async () => {
    await Promise.allSettled([1, 2, 3].map(() => flaky('https://2.spark.flashnet.xyz/rpc')));
    await new Promise((r) => setImmediate(r));
    return {};
  } });
  const provider = new BreezSparkWalletProvider('w-flaky', { name: 't', _testSdk: sdk, _testNetwork: network });
  provider.isConnected = true;
  sparkReachability().clear();
  const result = await provider.getBalance();
  await settled();
  assert.equal(result.fresh, false, 'more failures than answers: not fresh');
  assert.ok(lastAnswer(), 'but Spark is reachable');
});

await test('a sync that answers only with server errors is not fresh and never counts as an answer', async () => {
  const { createSparkNetworkObserver } = await import('../../utils/sparkNetwork.js');
  const network = createSparkNetworkObserver();
  const errorPage = network.wrap(async () => ({ status: 503 }));
  const sdk = scriptedSdk({ sync: async () => {
    await Promise.allSettled([1, 2].map(() => errorPage('https://0.spark.lightspark.com/rpc')));
    await new Promise((r) => setImmediate(r));
    return {};
  } });
  const provider = new BreezSparkWalletProvider('w-503', { name: 't', _testSdk: sdk, _testNetwork: network });
  provider.isConnected = true;
  const checker = startReachabilityChecks();
  const reports = [];
  checker.reportFailedAttempt = (outcome) => reports.push(outcome);
  checker.reportAnswered = () => reports.push('answered');
  try {
    const result = await provider.getBalance();
    await settled();
    assert.equal(result.fresh, false);
    assert.deepEqual(reports, [{ errored: true }]);
  } finally {
    stopReachabilityChecks();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
// The fiat-rate service's module-scope interval holds the event loop open.
process.exit(failed > 0 ? 1 : 0);
