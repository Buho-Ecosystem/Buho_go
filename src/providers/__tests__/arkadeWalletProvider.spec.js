import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectedArkade, deferred } from './arkadeHarness.js';

test('a transient read failure preserves the live SDK; the next read can recover', async () => {
  let fail = true;
  const provider = connectedArkade({ getBalance: async () => {
    if (fail) throw new Error('offline');
    return { available: 2100 };
  } });
  await assert.rejects(provider.getBalance(), /offline/);
  assert.equal(provider.isConnected, true);
  fail = false;
  assert.equal((await provider.getBalance()).balance, 2100);
});

test('a boarding receipt keeps its id when settlement adds the commitment id', async () => {
  const tx = { key: { boardingTxid: 'deposit' }, type: 'RECEIVED', amount: 2100, createdAt: Date.now() };
  const provider = connectedArkade({ getTransactionHistory: async () => [tx] });
  assert.equal((await provider.getTransactions())[0].id, 'deposit');
  tx.key.commitmentTxid = 'settlement';
  tx.settled = true;
  assert.equal((await provider.getTransactions())[0].id, 'deposit');
});

test('disconnect cancels a payment watch whose contract manager is still loading', async () => {
  const loading = deferred();
  let subscriptions = 0;
  const provider = connectedArkade({ getContractManager: () => loading.promise, dispose: async () => {} });
  const starting = provider.watchPayments(() => {});
  await provider.disconnect();
  loading.resolve({ onContractEvent: () => { subscriptions++; return () => {}; } });
  const watch = await starting;
  watch.stop();
  assert.equal(subscriptions, 0);
  assert.equal(provider._watches.size, 0);
});

test('a failed recovery check retries after a short backoff, rather than six hours', async t => {
  let time = 1000000;
  t.mock.method(Date, 'now', () => time);
  t.mock.method(console, 'warn', () => {});
  let checks = 0;
  let recovered = 0;
  const provider = connectedArkade({ getVtxoManager: async () => {
    checks++;
    if (checks === 1) throw new Error('offline');
    return { getRecoverableBalance: async () => ({ recoverable: 1000 }), recoverVtxos: async () => { recovered++; } };
  } });
  await provider.checkLiveness();
  time += 29000;
  await provider.checkLiveness();
  assert.equal(checks, 1, 'failed checks do not spin on every read');
  time += 1000;
  await provider.checkLiveness();
  assert.equal(checks, 2);
  assert.equal(recovered, 1);
  time += 30000;
  await provider.checkLiveness();
  assert.equal(checks, 2, 'a successful check keeps the long cooldown');
});

test('forced and ordinary recovery callers share an in-flight settlement', async () => {
  const settling = deferred();
  let recoveries = 0;
  const maintenance = [];
  const provider = connectedArkade({ getVtxoManager: async () => ({
    getRecoverableBalance: async () => ({ recoverable: 1000 }),
    recoverVtxos: async () => { recoveries++; await settling.promise; },
  }) });
  provider._onMaintenance = active => maintenance.push(active);
  const checks = [provider.checkLiveness(), provider.checkLiveness({ force: true })];
  settling.resolve();
  assert.deepEqual(await Promise.all(checks), [{ recovered: true }, { recovered: true }]);
  assert.equal(recoveries, 1);
  assert.deepEqual(maintenance, [true, false]);
});
