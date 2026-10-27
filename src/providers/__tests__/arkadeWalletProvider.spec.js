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

test('disconnect releases a subscription still being established', async () => {
  const subscribing = deferred();
  let stopped = 0;
  const provider = connectedArkade({ notifyIncomingFunds: () => subscribing.promise, dispose: async () => {} });
  const start = provider.startIncomingFundsListener(() => {});
  await provider.disconnect();
  subscribing.resolve(() => { stopped++; });
  await start;
  assert.equal(stopped, 1);
  assert.equal(provider._stopIncoming, null);
});
