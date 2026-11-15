import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { reactive, watch } from 'vue';
import { PaymentStatus } from '../../utils/paymentMonitor.js';
import { createWalletWatch } from '../../services/walletWatch.js';
import { createReceiptLedger } from '../../services/paymentReceipts.js';
import { expectReceiveFunds, forgetReceiveFunds } from '../../services/incomingPayments.js';

const source = readFileSync(new URL('../ReceiveModal.vue', import.meta.url), 'utf8');
const { code } = transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' });
const module = { exports: {} };
const deps = {
  '../utils/paymentMonitor': { PaymentStatus },
  '../services/incomingPayments.js': { expectReceiveFunds, forgetReceiveFunds },
  '../utils/qrShare': { qrBlobFromRef: async () => null },
  '../utils/share': { shareContent: async () => ({ success: false, reason: 'unsupported' }) },
};
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
const methods = module.exports.default.methods;
const now = () => Math.floor(Date.now() / 1000);
const received = (id, amount, extra = {}) => ({ id, type: 'incoming', status: 'completed', amount, timestamp: now(), ...extra });
async function harness(t, initial = []) {
  let rows = initial;
  const statuses = [];
  const store = reactive({ activeWalletId: 'ark', lastReceipt: null });
  const provider = { getTransactions: async ({ offset = 0, limit = 20 } = {}) => rows.slice(offset, offset + limit) };
  const vm = {
    ...methods, show: true, isPaymentConfirmed: false, walletStore: store,
    $watch: (source, callback, options) => watch(source, callback, options),
    handlePaymentStatus(status, data) {
      statuses.push({ status, data });
      if (status === PaymentStatus.CONFIRMED) { vm.isPaymentConfirmed = true; vm.stopPaymentMonitor(); }
    },
  };
  const memory = new Map();
  const ledger = createReceiptLedger({ storage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) } });
  const watcher = createWalletWatch({
    wallets: () => [{ id: 'ark', type: 'arkade' }], connect: async () => provider,
    paymentsOf: () => ({ watch: async () => ({ stop() {} }), readPage: (p, offset, limit) => p.getTransactions({ offset, limit }) }),
    canReadHistory: () => true, ruleFor: () => null, refreshBalance: async () => {}, ledger,
    deliver: receipt => { store.lastReceipt = { walletId: receipt.walletId, amountSats: receipt.amountSats, at: Date.now(), paymentId: receipt.id }; },
    setTimer: () => ({}), clearTimer() {},
  });
  t.after(() => { vm.stopPaymentMonitor(); watcher.stop(); });
  await watcher.start();
  vm.startArkadeNativeMonitor();
  return { vm, provider, store, statuses, setRows(value) { rows = value; }, check: () => watcher.check('ark'),
    confirmed: () => statuses.filter(({ status }) => status === PaymentStatus.CONFIRMED),
  };
}

test('spends, change and unconfirmed deposits never reach the Receive sheet as receipts', async t => {
  const h = await harness(t, [received('old', 1000, { timestamp: now() - 60 })]);
  h.setRows([received('old', 1000), received('send', 100, { type: 'outgoing' })]);
  await h.check();
  h.setRows([received('deposit', 5000, { status: 'pending' })]);
  await h.check();
  assert.equal(h.confirmed().length, 0);
});

test('the shared ledger confirms the actual amount, independent of the request and simultaneous spends', async t => {
  const h = await harness(t);
  h.vm.generatedInvoice = { amount: 5000 };
  h.setRows([received('sent', 9000, { type: 'outgoing' }), received('receipt', 2100)]);
  await h.check();
  await h.check();
  assert.equal(h.confirmed().length, 1);
  assert.equal(h.confirmed()[0].data.amount, 2100);
});

test('catch-up confirms a previously pending deposit only once it is spendable', async t => {
  const h = await harness(t, [received('boarding', 6000, { status: 'pending', timestamp: now() - 3600 })]);
  h.setRows([received('boarding', 6000, { timestamp: now() - 3600 })]);
  await h.check();
  assert.equal(h.confirmed()[0].data.amount, 6000);
});

test('restored historical funds cannot confirm the current receive request', async t => {
  const h = await harness(t);
  h.setRows([received('restored', 6000, { timestamp: now() - 3600 })]);
  await h.check();
  assert.equal(h.confirmed().length, 0);
});

test('closing or switching wallets during history lookup cannot confirm the old screen', async t => {
  for (const close of [true, false]) {
    const h = await harness(t);
    let resolve;
    h.provider.getTransactions = () => new Promise(done => { resolve = done; });
    const checking = h.check();
    while (!resolve) await new Promise(done => setImmediate(done));
    if (close) { h.vm.show = false; h.vm.stopPaymentMonitor(); }
    else h.store.activeWalletId = 'another';
    resolve([received('late', 1000)]);
    await checking;
    assert.equal(h.confirmed().length, 0);
  }
});

test('restarting the address monitor leaves one watcher and ignores invalid receipt amounts', async t => {
  const h = await harness(t);
  h.vm.startArkadeNativeMonitor();
  for (const amountSats of [0, -1, NaN, undefined]) h.store.lastReceipt = { walletId: 'ark', at: Date.now(), amountSats };
  assert.equal(h.confirmed().length, 0);
  h.store.lastReceipt = { walletId: 'ark', at: Date.now(), amountSats: 2100 };
  assert.equal(h.confirmed().length, 1);
});

test('QR copy and sharing fallback preserve the request; address menu items remain bare', async t => {
  const copied = [];
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => copied.push(value) } } });
  t.after(() => Object.defineProperty(globalThis, 'navigator', navigatorDescriptor));
  const vm = {
    ...methods, arkadeUnifiedQrValue: 'bitcoin:bc1-test?amount=0.000021&ark=ark1-test&message=Lunch',
    arkadeBoardingAddress: 'bc1-test', arkadeAddress: 'ark1-test', $refs: {},
    $t: value => value, $q: { notify() {} },
  };
  await vm.copyArkadeRequest();
  await vm.shareArkadeBoardingAddress();
  await vm.copyArkadeBoardingAddress();
  await vm.copyArkadeAddress();
  assert.deepEqual(copied, [vm.arkadeUnifiedQrValue, vm.arkadeUnifiedQrValue, 'bc1-test', 'ark1-test']);
});
