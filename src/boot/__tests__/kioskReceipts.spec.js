import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
function load() {
  const { code } = transformSync(readFileSync(new URL('../kiosk-payments.js', import.meta.url), 'utf8'), { format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  const dependencies = { 'quasar/wrappers': { boot: fn => fn }, 'stores/wallet': {}, 'stores/kioskMerchant': {}, 'stores/transactionMetadata': {}, '../composables/useKioskPayments.js': {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  return module.exports.annotateKioskReceipt;
}
const annotate = load();
const order = { baseSats: 1000, tipSats: 100, roundUpSats: 20, tipPercent: 10, totalSats: 1120, label: 'Table 2', items: [{ qty: 2 }, { qty: 1 }] };
const attempt = { walletId: 'wallet', paymentHash: 'a'.repeat(64) };
function metadata() {
  const calls = [];
  return { calls, setSourceForTransaction: async (...args) => calls.push(['source', ...args]),
    setLabelForTransaction: async (...args) => calls.push(['label', ...args]),
    setSaleBreakdownForTransaction: async (...args) => calls.push(['breakdown', ...args]),
    enqueuePendingContactLink: () => assert.fail('never associate a sale by amount or time') };
}
test('a payment hash alone never guesses a history ID or queues amount/time matching', async () => {
  const store = metadata();
  await annotate(store, order, attempt, { paid: true, paymentHash: attempt.paymentHash, amount: 1120 });
  assert.deepEqual(store.calls, []);
});
test('an authoritative transaction ID receives the exact wallet and sale breakdown', async () => {
  const store = metadata();
  await annotate(store, order, attempt, { paid: true, transactionId: 'history-id' });
  assert.deepEqual(store.calls, [
    ['source', 'history-id', 'wallet', 'kiosk'], ['label', 'history-id', 'wallet', 'Table 2'],
    ['breakdown', 'history-id', 'wallet', { baseSats: 1000, tipSats: 120, tipPercent: 10, roundUp: true, discountSats: 0, itemCount: 3, totalSats: 1120 }],
  ]);
});
