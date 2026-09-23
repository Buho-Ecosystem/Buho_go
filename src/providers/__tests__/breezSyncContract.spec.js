/**
 * Fresh synchronization versus cached reads (#291).
 *
 * `getInfo({ ensureSynced: true })` in the pinned SDK only waits for the
 * INITIAL sync and then reads the local cache, so it proved nothing after
 * startup yet recorded Spark as healthy. These tests run the real provider
 * against a scripted SDK and pin the contract that replaced it:
 *   - freshness comes from a real `syncWallet`, never from a cache read;
 *   - only a real sync records health; a timeout records a failure;
 *   - a failed sync still returns the last-known value, labelled stale;
 *   - money decisions can require fresh data and get the failure;
 *   - concurrent requests share one sync; a completion after disconnect
 *     or rebuild is not recorded against the new instance.
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezSyncContract.spec.js
 */

import { strict as assert } from 'node:assert';

const storage = {};
globalThis.localStorage = {
  getItem: k => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = v; },
  removeItem: k => { delete storage[k]; },
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

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function scriptedSdk({ balance = 1000 } = {}) {
  const sdk = {
    balance,
    syncs: 0,
    infoCalls: [],
    nextSync: null,
    async getInfo(req) { sdk.infoCalls.push(req); return { balanceSats: sdk.balance }; },
    syncWallet() {
      sdk.syncs += 1;
      return sdk.nextSync ? sdk.nextSync.promise : Promise.resolve({});
    },
  };
  return sdk;
}

let seq = 0;
function providerWith(sdk) {
  const provider = new BreezSparkWalletProvider(`w-sync-${++seq}`, { name: 'test', _testSdk: sdk });
  provider.isConnected = true;
  return provider;
}

console.log('Breez sync contract');

await test('a fresh read performs a real sync and records health', async () => {
  const sdk = scriptedSdk();
  const p = providerWith(sdk);
  const result = await p.getBalance();
  assert.equal(sdk.syncs, 1);
  assert.equal(result.fresh, true);
  assert.equal(result.balance, 1000);
  assert.ok(result.syncedAt);
  assert.ok(sparkHealth().lastSuccessAt(p.walletId));
  assert.ok(sdk.infoCalls.every(r => !r?.ensureSynced), 'no ensureSynced shortcut');
});

await test('every later fresh read syncs again (not only the initial one)', async () => {
  const sdk = scriptedSdk();
  const p = providerWith(sdk);
  await p.getBalance();
  await p.getBalance();
  assert.equal(sdk.syncs, 2);
});

await test('a cached read never records network health', async () => {
  const sdk = scriptedSdk();
  const p = providerWith(sdk);
  const result = await p.getCachedBalance();
  assert.equal(result.fresh, false);
  assert.equal(sdk.syncs, 0);
  assert.equal(sparkHealth().lastSuccessAt(p.walletId), null);
});

await test('a timed-out sync returns the last-known value labelled stale and records a failure', async () => {
  const sdk = scriptedSdk({ balance: 25000 });
  sdk.nextSync = deferred();
  const p = providerWith(sdk);
  const result = await p.getBalance({ timeoutMs: 5 });
  assert.equal(result.balance, 25000, 'unknown never becomes a verified zero');
  assert.equal(result.fresh, false);
  assert.match(String(result.error?.message), /timeout/);
  assert.equal(sparkHealth().lastSuccessAt(p.walletId), null);
  assert.ok(sparkHealth().unreachableFor(p.walletId) >= 0);
  sdk.nextSync.resolve({});
});

await test('money decisions requiring fresh data get the failure, not a cached number', async () => {
  const sdk = scriptedSdk();
  sdk.nextSync = deferred();
  const p = providerWith(sdk);
  await assert.rejects(() => p.getBalance({ requireFresh: true, timeoutMs: 5 }), e => e.code === 'SPARK_BALANCE_UNVERIFIED');
  sdk.nextSync.resolve({});
});

await test('concurrent requests share one bounded sync', async () => {
  const sdk = scriptedSdk();
  sdk.nextSync = deferred();
  const p = providerWith(sdk);
  const reads = [p.getBalance(), p.getBalance(), p.probeReachability()];
  await new Promise(r => setImmediate(r));
  assert.equal(sdk.syncs, 1);
  sdk.nextSync.resolve({});
  const [a, b, reachable] = await Promise.all(reads);
  assert.equal(a.fresh && b.fresh && reachable, true);
  sdk.nextSync = null;
  await p.getBalance();
  assert.equal(sdk.syncs, 2, 'a finished sync is not reused for a later request');
});

await test('a sync that completes after a rebuild is not recorded against the new instance', async () => {
  const oldSdk = scriptedSdk();
  oldSdk.nextSync = deferred();
  const p = providerWith(oldSdk);
  const pending = p.syncNow({ timeoutMs: 1000 }).catch(e => e);
  p.sdk = scriptedSdk(); // rebuild / reconnect
  oldSdk.nextSync.resolve({});
  const outcome = await pending;
  assert.ok(outcome instanceof Error);
  assert.equal(p.lastSyncedAt, null);
  assert.equal(sparkHealth().lastSuccessAt(p.walletId), null);
});

await test('a failed sync then a successful retry clears the outage streak', async () => {
  const sdk = scriptedSdk();
  sdk.nextSync = deferred();
  const p = providerWith(sdk);
  await p.getBalance({ timeoutMs: 5 });
  sdk.nextSync.resolve({});
  sdk.nextSync = null;
  const result = await p.getBalance();
  assert.equal(result.fresh, true);
  assert.equal(sparkHealth().unreachableFor(p.walletId), 0);
  assert.equal(p.lastSyncError, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
// The fiat-rate service arms an auto-update timer at import; exit explicitly.
process.exit(failed > 0 ? 1 : 0);
