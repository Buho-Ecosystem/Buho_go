import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createPinia, setActivePinia } from 'pinia';
import * as Vue from 'vue';
import * as roundUp from '../../utils/roundUp.js';
import * as fiat from '../../utils/fiatCurrencies.js';
import * as amountFormatting from '../../utils/amountFormatting.js';
import * as merchantDomain from '../../utils/kioskMerchant.js';
import * as keypad from '../../utils/amountKeypad.js';
import * as cardPayment from '../../composables/useKioskCardPayment.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import { useKioskMerchantStore } from '../../stores/kioskMerchant.js';
import { useKioskPayments } from '../../composables/useKioskPayments.js';
const script = readFileSync(new URL('../KioskDashboard.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
const tick = async () => { for (let index = 0; index < 40; index++) { await Promise.resolve(); await Vue.nextTick(); } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function harness(ctx, options = {}) {
  const h = { created: [], authorized: [], lookups: [], monitors: [], notices: [], dialogs: [], priceLoads: 0, paidHashes: new Set() };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame ??= fn => setTimeout(fn, 0);
  let saved = options.saved || null;
  const repository = { async load() { return saved && structuredClone(saved); }, async commit(next, previous) { assert.equal(saved?.revision || 0, previous?.revision || 0); saved = JSON.parse(JSON.stringify(next)); } };
  setActivePinia(createPinia());
  h.merchant = useKioskMerchantStore();
  await h.merchant.initialize({ storage: repository, legacyStorage: null, amountUnit: options.storeState?.kioskDisplayCurrency || 'sats' });
  const invoices = new Map();
  const provider = {
    async createInvoice(request) {
      h.created.push(request);
      const hash = h.created.length.toString(16).padStart(64, '0');
      const result = { paymentRequest: `lnbc${request.amount * 10}n1qqqq`, paymentHash: hash };
      invoices.set(result.paymentRequest, { paymentHash: hash, expiresAt: Math.floor(Date.now() / 1000) + 900 });
      return options.create ? options.create(request, result) : result;
    },
    async lookupInvoice(hash) { h.lookups.push(hash); if (h.offline) throw new Error('offline'); return { paid: h.paidHashes.has(hash), paymentHash: hash }; },
  };
  h.store = Vue.reactive({
    kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'merchant',
    get isKioskRestricted() { return this.kioskEnabled && !this.kioskOwnerAccess; },
    get kioskWallet() { return this.wallets.find(wallet => wallet.id === this.kioskWalletId); },
    wallets: [{ id: 'merchant', name: 'Register', type: 'lnbits' }], activeWalletId: 'personal',
    kioskTipEnabled: false, kioskTipValues: [5, 10, 20], kioskRoundUpEnabled: false,
    kioskDisplayCurrency: 'sats', preferredFiatCurrency: 'USD', exchangeRates: {}, exchangeRateTimes: {}, balances: { merchant: 0 }, pendingDeepLink: options.pending || null,
    async loadExchangeRates() { h.priceLoads++; },
    async ensureWalletConnectedForTransfer(id) { assert.equal(id, 'merchant'); return provider; },
    async createInvoiceDetailsOnWallet(id, amount, description) { assert.equal(id, 'merchant'); return provider.createInvoice({ amount, description }); },
    async lookupInvoiceOnWallet(id, hash) { assert.equal(id, 'merchant'); return provider.lookupInvoice(hash); },
    setKioskDisplayCurrency(unit) { this.kioskDisplayCurrency = unit; },
    ...options.storeState,
  });
  const monitorFactory = () => {
    let args;
    const monitor = { async start(value) { args = value; }, stop() {}, async checkNow() { if (args) return args.provider.lookupInvoice(); } };
    h.monitors.push(monitor); return monitor;
  };
  const dependencies = {
    vue: Vue, 'vue-router': { useRouter: () => ({ replace: () => assert.fail('unexpected navigation'), push: () => {} }) },
    '../stores/wallet.js': { useWalletStore: () => h.store },
    '../stores/kioskMerchant.js': { useKioskMerchantStore: () => h.merchant },
    '../composables/useKioskPayments.js': { useKioskPayments: args => useKioskPayments({ ...args, monitorFactory, decodeInvoice: request => invoices.get(request), document: null }) },
    '../utils/roundUp.js': roundUp, '../utils/fiatCurrencies.js': fiat, '../utils/amountFormatting.js': amountFormatting,
    '../utils/kioskMerchant.js': merchantDomain, '../utils/amountKeypad.js': keypad,
    '../components/KioskPinPad.vue': {}, '../components/AmountKeypad.vue': {}, '../components/kiosk/KioskProducts.vue': {}, '../components/kiosk/KioskReceipt.vue': {},
    qrcode: { toDataURL: async () => 'data:image/png;base64,test' },
    '../components/WithdrawAuthorization.vue': {}, '../components/CardFace.vue': {},
    '../utils/nfc.js': { isNfcAvailable: async () => false },
    '../utils/haptics.js': { haptics: { tap() {}, medium() {}, success() {}, error() {} } },
    quasar: { useQuasar: () => ({ notify: notice => h.notices.push(notice), dialog: value => ({ onOk: ok => h.dialogs.push({ value, ok }) }) }), copyToClipboard: async () => {} },
    '../composables/useKioskCardPayment.js': { ...cardPayment, useKioskCardPayment: args => cardPayment.useKioskCardPayment({ ...args, resolve: async () => ({ callback: 'https://card.example/callback', defaultDescription: 'Card', minSats: 1, maxSats: 10000 }), paymentWaitMs: options.cardPaymentWaitMs }) },
    '../utils/share.js': { shareContent: async () => ({ success: false, reason: 'unsupported' }) },
    '../services/lnurlWithdraw.js': { safeWithdrawError: error => error },
    '../utils/walletCapabilities.js': walletCapabilities,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') });
  app.config.globalProperties.$t = key => key;
  app.config.globalProperties.$i18n = { locale: 'en-US' };
  h.vm = app.mount({ children: [] });
  h.vm.cardAuthorization = { cancel() {}, submit: async (...args) => { h.authorized.push(args); return options.authorize?.(...args); } };
  h.tap = () => { h.store.pendingDeepLink = { type: 'lnurl', data: 'lnurlw://card.example/tap', target: 'kiosk', receivedAt: Date.now() }; };
  h.settle = async () => { await tick(); await h.merchant.flush(); await tick(); };
  h.input = async value => { h.vm.editAmount(value); await h.settle(); };
  h.charge = async value => { await h.input(value); await h.vm.proceedToTipOrCharge(); await h.settle(); };
  ctx.after(() => { app.unmount(); h.vm.payments.dispose(); });
  await h.vm.payments.ready; await h.settle();
  return h;
}

test('cold-start card waits for an explicit amount review and uses the register wallet', async ctx => {
  const h = await harness(ctx, { pending: { data: 'lnurlw://card.example/tap', target: 'kiosk', receivedAt: Date.now() } });
  assert.equal(h.store.pendingDeepLink, null); assert.equal(h.vm.card.phase.value, 'ready'); assert.equal(h.created.length, 0);
  await h.charge('100');
  assert.equal(h.vm.card.phase.value, 'review'); assert.equal(h.authorized.length, 0);
  h.vm.confirmHeldCard(); await h.settle();
  assert.equal(h.authorized.length, 1); assert.equal(h.authorized[0][2], 100); assert.equal(h.store.activeWalletId, 'personal'); assert.equal(h.store.kioskOwnerAccess, false);
  assert.equal(h.merchant.currentOrder.walletId, 'merchant');
});

test('tips are explicit and card acknowledgment cannot confirm payment or submit twice', async ctx => {
  const h = await harness(ctx, { storeState: { kioskTipEnabled: true } });
  await h.input('100'); h.tap(); await h.settle();
  assert.equal(h.vm.state, 'tipping'); assert.equal(h.created.length, 0);
  h.vm.selectedTipPercent = 10; await h.vm.confirmTip(); await h.settle();
  assert.equal(h.created[0].amount, 110);
  await h.vm.card.confirm({ amountSats: 110 }); await h.vm.card.confirm({ amountSats: 110 });
  assert.equal(h.authorized.length, 1); assert.equal(h.authorized[0][1], h.vm.invoiceData.paymentRequest); assert.equal(h.authorized[0][2], 110);
  assert.equal(h.vm.state, 'payment'); assert.equal(h.merchant.sales.length, 0);
});

test('QR-first card reuses the durable invoice; unrelated balance changes never settle a sale', async ctx => {
  const h = await harness(ctx); await h.charge('100'); h.tap(); await h.settle();
  assert.equal(h.created.length, 1); assert.equal(h.authorized.length, 1);
  h.store.balances.merchant = 999999; await h.vm.payments.checkNow(); await h.settle();
  assert.equal(h.vm.state, 'payment'); assert.equal(h.merchant.sales.length, 0);
  const hash = h.vm.invoiceData.paymentHash; h.paidHashes.add(hash);
  await h.vm.payments.checkNow(); await h.settle();
  assert.equal(h.vm.state, 'success'); assert.equal(h.merchant.sales.length, 1); assert.equal(h.merchant.sales[0].totalSats, 100); assert.ok(h.lookups.every(value => value === hash));
  assert.equal(h.merchant.sales[0].method, 'card', 'the card paid its own request');
  await h.vm.payments.checkNow(); assert.equal(h.merchant.sales.length, 1);
});

for (const [tips, rounding, selected, expected] of [[false, false, false, 100], [true, false, false, 100], [true, false, true, 110], [false, true, true, 500], [true, true, true, 500]]) {
  test(`tip ${tips}, round-up ${rounding}, selected ${selected} keeps exact immutable extras`, async ctx => {
    const h = await harness(ctx, { storeState: { kioskTipEnabled: tips, kioskRoundUpEnabled: rounding } });
    await h.charge('100');
    if (tips || rounding) {
      assert.equal(h.vm.state, 'tipping');
      if (selected) { h.vm.selectedTipPercent = tips ? 10 : 0; h.vm.useRoundUp = rounding; }
      await h.vm.confirmTip(); await h.settle();
    }
    assert.equal(h.created[0].amount, expected);
    const sale = h.merchant.currentOrder;
    assert.equal(sale.baseSats + sale.tipSats + sale.roundUpSats, expected);
    assert.equal(sale.tipSats, selected && tips ? 10 : 0);
  });
}

test('fiat input needs a fresh price while explicit sats can charge without one', async ctx => {
  const h = await harness(ctx, { storeState: { kioskDisplayCurrency: 'fiat' } });
  assert.equal(h.priceLoads, 1); await h.charge('12.50'); assert.equal(h.vm.priceMissing, true); assert.equal(h.created.length, 0);
  h.store.exchangeRates = { usd: 100_000 }; h.store.exchangeRateTimes = { usd: Date.now() - 61 * 60 * 1000 }; await h.settle();
  await h.vm.proceedToTipOrCharge(); assert.equal(h.created.length, 0);
  h.store.exchangeRateTimes = { usd: Date.now() }; await h.settle(); await h.vm.proceedToTipOrCharge(); await h.settle();
  assert.equal(h.created[0].amount, 12_500);
});

test('tap amount unit switching preserves tiny exact sats through a fiat display', async ctx => {
  const h = await harness(ctx, { storeState: { exchangeRates: { usd: 100_000 }, exchangeRateTimes: { usd: Date.now() } } });
  await h.input('8'); const switched = keypad.swapKeypadUnit('8', { fiat: false, rate: 100_000, exactSats: 8 });
  h.vm.swapAmount({ ...switched, sats: 8 }); h.vm.editAmount(switched.value); await h.settle();
  assert.equal(h.vm.amountSats, 8); assert.equal(h.merchant.draft.exactSats, 8); assert.equal(h.store.kioskDisplayCurrency, 'fiat');
  await h.vm.proceedToTipOrCharge(); await h.settle(); assert.equal(h.created[0].amount, 8);
  await h.vm.resetToInput(); assert.equal(h.merchant.draft.amountUnit, 'fiat');
});

test('combined products and typed fiat are priced once and retain the catalog currency', async ctx => {
  const h = await harness(ctx, { storeState: { kioskDisplayCurrency: 'fiat', preferredFiatCurrency: 'EUR', exchangeRates: { usd: 60_000 }, exchangeRateTimes: { usd: Date.now() } } });
  const product = await h.merchant.saveProduct({ name: 'Coffee', priceMinor: 1, currency: 'USD' });
  h.vm.addProduct(product); await h.settle(); await h.input('0.01');
  assert.equal(h.vm.totalSatsForCharge, 33); await h.vm.proceedToTipOrCharge(); await h.settle();
  assert.equal(h.created[0].amount, 33); assert.equal(h.merchant.currentOrder.currency, 'USD'); assert.equal(h.merchant.currentOrder.items.reduce((sum, item) => sum + item.lineSats, 0), 33);
});

test('a wallet without receive or confirmation permission cannot generate a request', async ctx => {
  const h = await harness(ctx, { storeState: { wallets: [{ id: 'merchant', type: 'nwc', metadata: { methods: ['make_invoice'] } }] } });
  await h.charge('100'); assert.equal(h.created.length, 0); assert.equal(h.merchant.orders.length, 0); assert.equal(h.vm.canCharge, false);
});

test('a detached invoice remains linked to its original customer and can settle during another sale', async ctx => {
  const h = await harness(ctx); await h.charge('100'); const first = h.merchant.currentOrder; const hash = h.vm.invoiceData.paymentHash;
  await h.vm.resetToInput(); await h.charge('200'); assert.equal(h.created.length, 2);
  h.paidHashes.add(hash); await h.vm.payments.checkNow(); await h.settle();
  assert.equal(h.merchant.getOrder(first.id).status, 'paid'); assert.equal(h.vm.state, 'payment'); assert.equal(h.vm.invoiceData.amountSats, 200); assert.equal(h.merchant.sales.length, 1);
});

test('repeated charge presses share one pending creation and keep its late result', async ctx => {
  const pending = deferred(); let answer;
  const h = await harness(ctx, { create: (_, result) => { answer = result; return pending.promise; } });
  await h.input('100'); const first = h.vm.proceedToTipOrCharge(); await tick();
  await h.vm.proceedToTipOrCharge(); assert.equal(h.created.length, 1);
  await h.vm.resetToInput(); pending.resolve(answer); await first; await h.settle();
  assert.equal(h.vm.state, 'input'); assert.equal(h.merchant.pendingAttempts.length, 1); assert.equal(h.merchant.pendingAttempts[0].paymentHash, answer.paymentHash);
});

test('switching to products makes an entered amount visible in the basket exactly once', async ctx => {
  const h = await harness(ctx); await h.input('101');
  await h.vm.setEntryMode('products'); await h.settle();
  assert.equal(h.vm.draft.amountRaw, ''); assert.equal(h.vm.draft.exactSats, null);
  assert.equal(h.vm.draft.items.length, 1); assert.equal(h.vm.draft.items[0].unitSats, 101); assert.equal(h.vm.totalSatsForCharge, 101);
  await h.vm.setEntryMode('amount'); await h.vm.setEntryMode('products'); await h.settle();
  assert.equal(h.vm.draft.items.length, 1);
  await h.vm.proceedToTipOrCharge(); await h.settle(); assert.equal(h.created[0].amount, 101);
});

test('switching an unquoted fiat amount to products keeps its visible price and waits for a rate', async ctx => {
  const h = await harness(ctx, { storeState: { kioskDisplayCurrency: 'fiat' } }); await h.input('2.50');
  await h.vm.setEntryMode('products'); await h.settle();
  assert.equal(h.vm.draft.amountRaw, ''); assert.equal(h.vm.draft.amountUnit, 'fiat');
  assert.equal(h.vm.draft.items.length, 1); assert.equal(h.vm.draft.items[0].priceMinor, 250); assert.equal(h.vm.priceMissing, true); assert.equal(h.vm.canCharge, false);
  await h.vm.proceedToTipOrCharge(); assert.equal(h.created.length, 0);
});

test('fiat checkout keeps its quoted currency visible and never reprices the payment display', async ctx => {
  const h = await harness(ctx, { storeState: { kioskDisplayCurrency: 'fiat', exchangeRates: { usd: 100000 }, exchangeRateTimes: { usd: Date.now() } } });
  await h.input('12.50');
  assert.match(h.vm.chargeLabel, /\$12\.50/);
  await h.vm.proceedToTipOrCharge(); await h.settle();
  assert.equal(h.created[0].amount, 12500);
  assert.equal(h.vm.paymentAmount, '$12.50');
  h.store.exchangeRates = { usd: 200000 }; await h.settle();
  assert.equal(h.vm.paymentAmount, '$12.50');
  assert.equal(h.vm.invoiceData.amountSats, 12500);
});

test('the register shows amounts in the Bitcoin format chosen in Settings (#453)', async ctx => {
  const h = await harness(ctx);
  const n = (1234).toLocaleString('en-US');
  assert.equal(h.vm.displaySats(1234), `₿\u00a0${n}`, 'the default format puts ₿ in front');
  h.store.useBip177Format = false; await h.settle();
  assert.equal(h.vm.displaySats(1234), `${n}\u00a0sats`, 'only the legacy format says sats');
});

test('Back on the tip screen returns to the amount without creating a request', async ctx => {
  const h = await harness(ctx, { storeState: { kioskTipEnabled: true } });
  await h.input('1000'); await h.vm.proceedToTipOrCharge(); await h.settle();
  assert.equal(h.vm.state, 'tipping');
  h.vm.leaveTip(); await h.settle();
  assert.equal(h.vm.state, 'input');
  assert.equal(h.created.length, 0);
});

test('a request that never came back is not charged, and Try again makes a new one without asking', async ctx => {
  let calls = 0;
  const h = await harness(ctx, { create: (request, result) => { if (++calls === 1) throw new Error('HTTP 500'); return result; } });
  await h.charge('100');
  assert.equal(h.vm.payments.status.value, 'not-charged');
  assert.ok(h.vm.interruption.retry, 'offers a new request');
  h.vm.retryCharge(); await h.settle();
  assert.equal(h.dialogs.length, 0, 'nothing could have been paid, so nothing to ask');
  assert.equal(h.created.length, 2);
  assert.equal(h.vm.state, 'payment');
});

test('Clear basket asks first and keeps the basket until confirmed', async ctx => {
  const h = await harness(ctx);
  await h.input('100'); await h.vm.addToAccumulated(); await h.settle();
  h.vm.clearAll();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.vm.hasDraft, true);
  await h.dialogs[0].ok(); await h.settle();
  assert.equal(h.vm.hasDraft, false);
});

test('Check payment again after an outage confirms the original request instead of making another', async ctx => {
  const h = await harness(ctx);
  await h.charge('100');
  h.offline = true; await h.vm.payments.checkNow().catch(() => {}); await h.settle();
  assert.ok(h.vm.paymentProblem, 'the screen says no payment is confirmed yet');
  h.offline = false; h.paidHashes.add(h.vm.invoiceData.paymentHash);
  await h.vm.payments.reconnect(); await h.settle();
  assert.equal(h.vm.payments.status.value, 'paid');
  assert.equal(h.created.length, 1);
  assert.equal(h.merchant.currentOrder.method, 'qr', 'the details say how it was paid, as the register saw it');
});
