/**
 * The error dialog says why no server answered: the real wallet store's
 * showPaymentError with a scripted connection check.
 *
 * Run directly with Node:
 *   node src/stores/__tests__/paymentErrorConnection.spec.js
 */

import { strict as assert } from 'node:assert';
import * as userErrors from '../../utils/userErrors.js';
import { createHarness } from './sparkWalletHarness.js';

const SPARK_UNREACHABLE = 'SparkSdkError: Service error: service provider error: authentication error: '
  + 'network error: Request error: error sending request : JsValue(TypeError: Failed to fetch)';

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

/** A store whose connection check answers `kind` when the test lets it. */
function storeWithCheck() {
  const check = { asked: 0 };
  const answer = new Promise((resolve) => { check.answer = resolve; });
  const { store } = createHarness({
    deps: {
      '../utils/userErrors': userErrors,
      '../utils/connectivity.js': { diagnoseConnection: () => { check.asked += 1; return answer; } },
    },
  });
  return { store, check };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

await test('no server answered: the dialog checks the connection, then says what it found', async () => {
  const { store, check } = storeWithCheck();
  store.showPaymentError(new Error(SPARK_UNREACHABLE), { context: 'payment', walletType: 'spark' });
  assert.equal(store.paymentError.visible, true);
  assert.equal(store.paymentError.reason, 'Checking your connection...');
  check.answer('service');
  await settle();
  assert.equal(store.paymentError.reason, "Spark can't be reached right now. Your internet works, so try again in a moment.");
  assert.equal(store.paymentError.technical.raw, SPARK_UNREACHABLE);
});

await test('a dialog closed before the check ends stays closed', async () => {
  const { store, check } = storeWithCheck();
  store.showPaymentError(new Error(SPARK_UNREACHABLE), { context: 'payment' });
  store.dismissPaymentError();
  check.answer('no-internet');
  await settle();
  assert.equal(store.paymentError.visible, false);
  assert.equal(store.paymentError.reason, '');
});

await test("a caller's own reason wins, and no check runs", async () => {
  const { store, check } = storeWithCheck();
  store.showPaymentError(new Error('Failed to fetch'), { context: 'payment', reason: 'Our own words.' });
  assert.equal(store.paymentError.reason, 'Our own words.');
  assert.equal(check.asked, 0);
});

await test('a server that answered with an error is not a connection problem', async () => {
  const { store, check } = storeWithCheck();
  store.showPaymentError(new Error('Route not found'), { context: 'payment' });
  assert.equal(store.paymentError.reason, 'Route not found');
  assert.equal(check.asked, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
