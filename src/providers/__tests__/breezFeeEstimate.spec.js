/**
 * The Lightning fee check before a send: a guess when Spark answered with a
 * failure, never a guess when nothing reached Spark at all. Runs the REAL
 * provider class against a scripted SDK (the constructor's `_testSdk` seam).
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezFeeEstimate.spec.js
 */

import { strict as assert } from 'node:assert';

// The provider's import graph touches browser storage and fetches live
// rates at module scope; both stay local under test.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async () => {
  throw new Error('network disabled under test');
};

const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');

const SPARK_UNREACHABLE = 'SparkSdkError: Service error: service provider error: authentication error: '
  + 'network error: Request error: error sending request : JsValue(TypeError: Failed to fetch)';

function providerFailingWith(message) {
  const sdk = { async prepareSendPayment() { throw new Error(message); } };
  const provider = new BreezSparkWalletProvider('w-test', { name: 'test', _testSdk: sdk });
  provider.isConnected = true;
  return provider;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('breez lightning fee check');

await test('nothing reached Spark: the check fails instead of showing a guessed fee', async () => {
  await assert.rejects(
    () => providerFailingWith(SPARK_UNREACHABLE).getLightningSendFeeEstimate('lnbc-under-test'),
    (error) => error.message === SPARK_UNREACHABLE,
  );
});

await test('Spark answered with a failure: the guess stays, marked as one', async () => {
  const estimate = await providerFailingWith('no route found').getLightningSendFeeEstimate('lnbc-under-test');
  assert.equal(estimate.isEstimated, true);
  assert.equal(estimate.estimatedFeeSats, BreezSparkWalletProvider.calculateRecommendedFee(10000));
});

console.log(`\n${passed} passed, ${failed} failed`);
// Explicit exit: the fiat-rate service's refresh interval holds the loop open.
process.exit(failed > 0 ? 1 : 0);
