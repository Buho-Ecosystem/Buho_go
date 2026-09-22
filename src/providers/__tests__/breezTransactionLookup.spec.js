import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline test'); };
const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');

try {
  const calls = [];
  const provider = new BreezSparkWalletProvider('source', { _testSdk: {
    getPayment: async request => {
      calls.push(request);
      return { payment: { id: request.paymentId, paymentType: 'send', method: 'spark', amount: 2, fees: 0, status: 'completed', timestamp: 1790000000 } };
    },
    listPayments: async () => { throw new Error('Must not search paginated history'); },
  } });
  provider.isConnected = true;
  const tx = await provider.getTransaction('exact-id');
  assert.deepEqual(calls, [{ paymentId: 'exact-id' }]);
  assert.equal(tx.id, 'exact-id');
  assert.equal(tx.type, 'send');
  assert.equal(tx.amount, 2);
  assert.equal(tx.sparkTransfer, true);
  provider.sdk.getPayment = async () => ({});
  assert.equal(await provider.getTransaction('missing'), null);
  provider.isConnected = false;
  await assert.rejects(() => provider.getTransaction('locked'));
  console.log('PASS: exact Spark payment lookup, canonical mapping, absent payment and locked wallet');
  process.exit(0); // The imported fiat service owns a background interval.
} catch (error) {
  console.error(error);
  process.exit(1);
}
