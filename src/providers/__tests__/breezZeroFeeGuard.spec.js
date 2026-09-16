/**
 * Spark-rail sends assert the fee the UI promises: zero.
 *
 * WalletFactory marks spark transfers `isZeroFee` and every confirm surface
 * says fee-free, but nothing on the sparkAddress/sparkInvoice send path
 * disclosed or capped the fee the prepare response quotes. These tests run
 * the REAL provider class against a scripted SDK (the constructor's
 * `_testSdk` seam) and pin the guard: a nonzero quote refuses BEFORE any
 * money moves; a zero or absent quote sends exactly as before.
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezZeroFeeGuard.spec.js
 */

import { strict as assert } from 'node:assert';

// The provider's import graph touches browser storage at module scope
// (guarded reads; the stub keeps them deterministic under node).
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
// The graph also pulls the fiat-rate service, which fetches live rates at
// module scope. Tests stay offline: the service tolerates a failed fetch.
globalThis.fetch = async () => {
  throw new Error('network disabled under test');
};

const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');
const { encodeSparkAddress } = await import('../../utils/sparkPayment.js');

const SPARK_ADDRESS = encodeSparkAddress({
  identityPublicKey: '02' + '11'.repeat(32),
  network: 'MAINNET',
});

/** A provider wired to a scripted SDK, connected, ready to send. */
function providerWith(sdk) {
  const provider = new BreezSparkWalletProvider('w-test', { name: 'test', _testSdk: sdk });
  provider.isConnected = true;
  return provider;
}

function sdkQuoting({ type, fee, extra = {} }) {
  const sdk = {
    sends: 0,
    async prepareSendPayment() {
      return { paymentMethod: { type, fee, ...extra } };
    },
    async sendPayment() {
      sdk.sends += 1;
      return { payment: { id: 'p-1', status: 'completed' } };
    },
  };
  return sdk;
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

console.log('breez spark-rail zero-fee guard');

await test('spark-address send refuses a nonzero quoted fee before sending', async () => {
  const sdk = sdkQuoting({ type: 'sparkAddress', fee: '10' });
  await assert.rejects(
    () => providerWith(sdk).transferToSparkAddress(SPARK_ADDRESS, 100),
    /10 sat fee.*fee-free/,
  );
  assert.equal(sdk.sends, 0, 'refusal must happen before any money moves');
});

await test('spark-address send proceeds on a zero or absent fee', async () => {
  for (const fee of ['0', 0, undefined]) {
    const sdk = sdkQuoting({ type: 'sparkAddress', fee });
    const result = await providerWith(sdk).transferToSparkAddress(SPARK_ADDRESS, 100);
    assert.deepEqual(result, { id: 'p-1', status: 'completed' });
    assert.equal(sdk.sends, 1);
  }
});

await test('spark-invoice send refuses a nonzero quoted fee before sending', async () => {
  const sdk = sdkQuoting({ type: 'sparkInvoice', fee: '7', extra: { sparkInvoiceDetails: {} } });
  await assert.rejects(
    () => providerWith(sdk).fulfillSparkInvoice('sparkinvoice-under-test'),
    /7 sat fee.*fee-free/,
  );
  assert.equal(sdk.sends, 0);
});

await test('spark-invoice send proceeds on a zero fee', async () => {
  const sdk = sdkQuoting({ type: 'sparkInvoice', fee: '0', extra: { sparkInvoiceDetails: {} } });
  const result = await providerWith(sdk).fulfillSparkInvoice('sparkinvoice-under-test');
  assert.deepEqual(result, { id: 'p-1', status: 'completed' });
  assert.equal(sdk.sends, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
// Explicit exit either way: the fiat-rate service's module-scope refresh
// interval holds the event loop open, and a green run must not hang the
// `&&`-chained test script.
process.exit(failed > 0 ? 1 : 0);
