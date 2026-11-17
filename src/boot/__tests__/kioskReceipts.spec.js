import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
function load() {
  const { code } = transformSync(readFileSync(new URL('../kiosk-payments.js', import.meta.url), 'utf8'), { format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  const dependencies = { 'quasar/wrappers': { boot: fn => fn }, vue: { watch: () => () => {} }, 'stores/wallet': {}, 'stores/kioskMerchant': {}, 'stores/transactionMetadata': {}, '../composables/useKioskPayments.js': {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  return module.exports;
}
const { annotateKioskReceipt: annotate, startWhenKioskIsOn } = load();
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
test('payment checks start only once Kiosk is on, and only once', () => {
  let starts = 0, onChange = null, stopped = 0;
  const watchFlag = (_source, callback) => { onChange = callback; return () => { stopped++; }; };
  const walletStore = { kioskEnabled: false };
  startWhenKioskIsOn(walletStore, () => { starts++; }, watchFlag);
  assert.equal(starts, 0, 'someone who never turns Kiosk on never opens the register');
  onChange(false);
  assert.equal(starts, 0);
  onChange(true);
  assert.equal(starts, 1);
  assert.equal(stopped, 1, 'the watch ends once the checks run');
  startWhenKioskIsOn({ kioskEnabled: true }, () => { starts++; }, () => assert.fail('no watch when Kiosk is already on'));
  assert.equal(starts, 2);
});
