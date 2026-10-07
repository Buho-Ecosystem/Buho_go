import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';
import * as monitor from '../../utils/paymentMonitor.js';
import * as roundUp from '../../utils/roundUp.js';
import * as fiat from '../../utils/fiatCurrencies.js';
import { useKioskCardPayment } from '../../composables/useKioskCardPayment.js';
const script = readFileSync(new URL('../KioskDashboard.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
async function settle() { for (let i = 0; i < 25; i++) await Vue.nextTick(); }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(ctx, options = {}) {
  const h = { paid: false, created: [], authorized: [], lookups: [], receipts: [], errors: [], monitors: [] };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const provider = {
    async createInvoice(request) { h.created.push(request); return options.create ? options.create(request) : { paymentRequest: 'lnbc-sale', paymentHash: 'sale-hash' }; },
    async lookupInvoice(hash) { h.lookups.push(hash); return { paid: h.paid }; },
    async getBalance() { return { balance: 100000 }; },
  };
  const store = Vue.reactive({
    kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'merchant',
    kioskWallet: { id: 'merchant', name: 'Register', type: 'lnbits' },
    wallets: [{ id: 'merchant', type: 'lnbits' }], activeWalletId: 'personal',
    kioskTipEnabled: false, kioskTipValues: [5, 10, 20], kioskRoundUpEnabled: false,
    kioskDisplayCurrency: 'sats', preferredFiatCurrency: 'USD', exchangeRates: {},
    providers: { merchant: provider }, balances: { merchant: 0 }, pendingDeepLink: options.pending || null,
    async ensureWalletConnectedForTransfer(id) { assert.equal(id, 'merchant'); return provider; },
    showPaymentError: error => h.errors.push(error),
    refreshBalance: async id => { assert.equal(id, 'merchant'); },
  });
  const dependencies = {
    vue: Vue, 'vue-router': { useRouter: () => ({ replace: () => assert.fail('unexpected navigation') }) },
    'stores/wallet': { useWalletStore: () => store },
    'stores/transactionMetadata': { useTransactionMetadataStore: () => ({ enqueuePendingContactLink: async receipt => h.receipts.push(receipt) }) },
    'components/KioskPinPad.vue': {}, 'src/utils/roundUp': roundUp, 'src/utils/fiatCurrencies': fiat,
    qrcode: { toDataURL: async () => 'data:image/png;base64,test' }, '@getalby/lightning-tools': {},
    '../components/PaymentConfirmSheet.vue': {}, '../components/WithdrawAuthorization.vue': {},
    '../composables/useKioskCardPayment.js': { useKioskCardPayment: args => useKioskCardPayment({ ...args, resolve: async () => ({ callback: 'https://card.example/callback', defaultDescription: 'Bolt Card', minSats: 1, maxSats: 10000 }) }) },
    '../services/lnurlWithdraw.js': { safeWithdrawError: error => error },
    '../utils/paymentMonitor.js': { ...monitor, createPaymentMonitor: config => { const instance = monitor.createPaymentMonitor(config); h.monitors.push(instance); return instance; } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') });
  app.config.globalProperties.$t = key => key;
  const vm = app.mount({ children: [] });
  vm.cardAuthorization = { submit: async (...args) => { h.authorized.push(args); return options.authorize?.(...args); } };
  ctx.after(() => app.unmount());
  h.vm = vm; h.store = store;
  h.tap = () => { store.pendingDeepLink = { type: 'lnurl', data: 'lnurlw://card.example/tap', target: 'kiosk', receivedAt: Date.now() }; };
  return h;
}

test('cold-start card waits for amount and reuses the existing confirmation payload', async ctx => {
  const h = harness(ctx, { pending: { data: 'lnurlw://card.example/tap', target: 'kiosk', receivedAt: Date.now() } });
  await settle();
  assert.equal(h.store.pendingDeepLink, null);
  assert.equal(h.vm.card.phase.value, 'ready');
  assert.equal(h.created.length, 0);
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 1);
  assert.equal(h.vm.card.phase.value, 'review');
  assert.equal(h.vm.card.payment.value.amount.fixedSats, 100);
  assert.equal(h.authorized.length, 0);
  assert.equal(h.store.activeWalletId, 'personal');
  assert.equal(h.store.kioskOwnerAccess, false);
});

test('amount-first tap includes confirmed tips and charges the kiosk invoice exactly once', async ctx => {
  const h = harness(ctx);
  await settle();
  h.store.kioskTipEnabled = true;
  h.vm.rawInput = '100'; h.tap(); await settle();
  assert.equal(h.vm.state, 'tipping');
  assert.equal(h.created.length, 0);
  h.vm.selectedTipPercent = 10; h.vm.confirmTip(); await settle();
  assert.equal(h.created[0].amount, 110);
  assert.equal(h.vm.card.payment.value.amount.fixedSats, 110);
  await h.vm.card.confirm({ amountSats: 110 });
  await h.vm.card.confirm({ amountSats: 110 });
  assert.equal(h.authorized.length, 1);
  assert.equal(h.authorized[0][1], 'lnbc-sale');
  assert.equal(h.vm.state, 'payment', 'callback OK cannot declare paid');
});

test('QR-first tap reuses invoice and unrelated balance growth cannot settle the sale', async ctx => {
  const h = harness(ctx);
  await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.tap(); await settle();
  await h.vm.card.confirm({ amountSats: 100 });
  assert.equal(h.created.length, 1);
  h.store.balances.merchant = 999999;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'payment');
  h.paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].walletId, 'merchant');
  assert.equal(h.receipts[0].amountSats, 100);
  assert.ok(h.lookups.every(hash => hash === 'sale-hash'));
});

test('parking clears card credentials and resuming preserves the invoice including tip', async ctx => {
  const h = harness(ctx); await settle();
  h.store.kioskTipEnabled = true;
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); h.vm.selectedTipPercent = 10; h.vm.confirmTip(); await settle();
  h.tap(); await settle();
  h.vm.parkInvoice();
  assert.equal(h.vm.card.phase.value, 'empty');
  h.vm.resumeParked(); h.tap(); await settle();
  assert.equal(h.vm.card.payment.value.amount.fixedSats, 110);
  assert.equal(h.vm.invoiceData.amountSats, 110);
  assert.equal(h.created.length, 1);
});

for (const change of ['cancel', 'unlock', 'wallet change']) {
  test(`${change} invalidates an in-flight invoice creation`, async ctx => {
    const pending = deferred();
    const h = harness(ctx, { create: () => pending.promise }); await settle();
    h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
    if (change === 'cancel') h.vm.cancelPayment();
    if (change === 'unlock') h.store.kioskOwnerAccess = true;
    if (change === 'wallet change') h.store.kioskWalletId = 'other';
    pending.resolve({ paymentRequest: 'old-invoice', paymentHash: 'old-hash' }); await settle();
    assert.equal(h.vm.state, 'input');
    assert.equal(h.vm.invoiceData, null);
    assert.equal(h.monitors.length, 0);
  });
}

test('repeated charge actions cannot replace an invoice being created', async ctx => {
  const pending = deferred();
  const h = harness(ctx, { create: () => pending.promise }); await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.vm.proceedToTipOrCharge(); h.vm.confirmTip(); await settle();
  assert.equal(h.created.length, 1);
  pending.resolve({ paymentRequest: 'original-invoice', paymentHash: 'original-hash' }); await settle();
  assert.equal(h.vm.invoiceData.paymentRequest, 'original-invoice');
});

test('a card-server timeout is visible and the same invoice can still settle', async ctx => {
  const h = harness(ctx, { authorize: async () => { throw new DOMException('The server did not respond in time', 'TimeoutError'); } });
  await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.tap(); await settle();
  await h.vm.card.confirm({ amountSats: 100 });
  assert.equal(h.errors.length, 1);
  assert.equal(h.vm.state, 'payment');
  assert.equal(h.authorized.length, 1);
  h.paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.equal(h.created.length, 1);
});

test('a sale paid while asleep still succeeds when resumed after invoice expiry', async ctx => {
  const h = harness(ctx); await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.monitors[0].invoice.expires_at = Math.floor(Date.now() / 1000) - 1;
  h.paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.equal(h.receipts.length, 1);
});
