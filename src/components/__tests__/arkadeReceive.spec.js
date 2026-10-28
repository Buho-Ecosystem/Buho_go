import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { createPaymentMonitor, PaymentStatus } from '../../utils/paymentMonitor.js';

const source = readFileSync(new URL('../ReceiveModal.vue', import.meta.url), 'utf8');
const { code } = transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' });
const module = { exports: {} };
const deps = {
  '../utils/paymentMonitor': {
    PaymentStatus,
    createPaymentMonitor: config => createPaymentMonitor({ ...config, initialInterval: 60000 }),
  },
  '../services/incomingPayments.js': { expectReceiveFunds() {}, forgetReceiveFunds() {} },
  '../utils/qrShare': { qrBlobFromRef: async () => null },
  '../utils/share': { shareContent: async () => ({ success: false, reason: 'unsupported' }) },
};
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
const methods = module.exports.default.methods;
const now = () => Math.floor(Date.now() / 1000);
const received = (id, amount, extra = {}) => ({ id, type: 'incoming', status: 'completed', amount, timestamp: now(), ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, initial = []) {
  let rows = initial;
  let callback;
  let stopped = 0;
  const statuses = [];
  const provider = {
    getTransactions: async () => rows,
    startIncomingFundsListener: async fn => { callback = fn; return () => { stopped++; }; },
  };
  const vm = {
    ...methods, show: true, isPaymentConfirmed: false,
    walletStore: { activeWalletId: 'ark', ensureArkadeConnected: async () => provider },
    handlePaymentStatus: (status, data) => { statuses.push({ status, data }); },
  };
  t.after(() => vm.stopPaymentMonitor());
  return { vm, provider, statuses, setRows(value) { rows = value; }, get stopped() { return stopped; },
    async event(funds) { callback(funds); await tick(); },
    confirmed: () => statuses.filter(({ status }) => status === PaymentStatus.CONFIRMED),
  };
}

test('spend-only events, outgoing change and unconfirmed boarding do not confirm a receipt', async t => {
  const h = harness(t, [received('old', 1000, { timestamp: now() - 60 })]);
  await h.vm.startArkadeNativeMonitor();
  h.setRows([received('old', 1000), received('send', 100, { type: 'outgoing' })]);
  await h.event({ type: 'vtxo', newVtxos: [], spentVtxos: [{ value: 100 }] });
  h.setRows([received('deposit', 5000, { status: 'pending' })]);
  await h.event({ type: 'utxo', coins: [{ value: 5000, status: { confirmed: false } }] });
  assert.equal(h.confirmed().length, 0);
});

test('a receipt reports its actual amount, independent of the request or simultaneous spend', async t => {
  const h = harness(t);
  h.vm.generatedInvoice = { amount: 5000 };
  await h.vm.startArkadeNativeMonitor();
  h.setRows([received('sent', 9000, { type: 'outgoing' }), received('receipt', 2100)]);
  await h.event({ type: 'vtxo', newVtxos: [{ value: 2100 }] });
  assert.equal(h.confirmed().length, 1);
  assert.equal(h.confirmed()[0].data.amount, 2100);
});

test('polling catches a boarding receipt settling after a missed SDK event', async t => {
  const h = harness(t, [received('boarding', 6000, { status: 'pending', timestamp: now() - 3600 })]);
  await h.vm.startArkadeNativeMonitor();
  h.setRows([received('boarding', 6000, { timestamp: now() - 3600 })]);
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.confirmed()[0].data.amount, 6000);
});

test('old history discovered by a restore scan does not confirm the current request', async t => {
  const h = harness(t);
  await h.vm.startArkadeNativeMonitor();
  h.setRows([received('restored', 6000, { timestamp: now() - 3600 })]);
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.confirmed().length, 0);
});

test('a failed initial history read still arms polling without confirming old funds', async t => {
  const h = harness(t);
  h.provider.getTransactions = async () => { throw new Error('offline'); };
  await h.vm.startArkadeNativeMonitor();
  h.provider.getTransactions = async () => [received('old', 5000, { timestamp: now() - 3600 }), received('new', 900)];
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.confirmed()[0].data.amount, 900);
});

test('closing or switching wallets during a receipt lookup cannot confirm the old screen', async t => {
  for (const close of [true, false]) {
    const h = harness(t);
    await h.vm.startArkadeNativeMonitor();
    let resolve;
    h.provider.getTransactions = () => new Promise(done => { resolve = done; });
    const checking = h.vm.paymentMonitor.checkNow();
    if (close) { h.vm.show = false; h.vm.stopPaymentMonitor(); }
    else h.vm.walletStore.activeWalletId = 'another';
    resolve([received('late', 1000)]);
    await checking;
    assert.equal(h.confirmed().length, 0);
  }
});

test('a subscription that finishes after close is immediately released', async t => {
  const h = harness(t);
  let subscribed;
  h.provider.startIncomingFundsListener = () => new Promise(resolve => { subscribed = resolve; });
  const starting = h.vm.startArkadeNativeMonitor();
  await tick();
  h.vm.show = false;
  h.vm.stopPaymentMonitor();
  let released = 0;
  subscribed(() => { released++; });
  await starting;
  assert.equal(released, 1);
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
