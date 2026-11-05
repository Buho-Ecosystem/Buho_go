import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';
import * as monitor from '../../utils/paymentMonitor.js';
import * as roundUp from '../../utils/roundUp.js';
import * as fiat from '../../utils/fiatCurrencies.js';
import * as amountFormatting from '../../utils/amountFormatting.js';
import * as cardPayment from '../../composables/useKioskCardPayment.js';
import { useKioskParkedSales } from '../../composables/useKioskParkedSales.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as nwcErrors from '../../utils/nwcErrors.js';
const script = readFileSync(new URL('../KioskDashboard.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
async function settle() { for (let i = 0; i < 25; i++) await Vue.nextTick(); }
const wait = ms => new Promise(done => setTimeout(done, ms));
let saleNumber = 0;
const nextSale = () => { saleNumber++; return { paymentRequest: `lnbc-sale-${saleNumber}`, paymentHash: `sale-hash-${saleNumber}`, expiresAt: Math.floor(Date.now() / 1000) + 900 }; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(ctx, options = {}) {
  const h = { paid: false, created: [], authorized: [], lookups: [], receipts: [], errors: [], monitors: [], notices: [], dialogs: [], priceLoads: 0 };
  h.storage = options.storage || new Map();
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame ??= fn => setTimeout(fn, 0);
  h.paidHashes = new Set();
  const provider = {
    async createInvoice(request) { h.created.push(request); return options.create ? options.create(request) : { paymentRequest: 'lnbc-sale', paymentHash: 'sale-hash' }; },
    async lookupInvoice(hash) { h.lookups.push(hash); return { paid: h.paid || h.paidHashes.has(hash) }; },
    async getBalance() { return { balance: 100000 }; },
  };
  const store = Vue.reactive({
    kioskEnabled: true, kioskOwnerAccess: false, kioskWalletId: 'merchant',
    kioskWallet: { id: 'merchant', name: 'Register', type: 'lnbits' },
    wallets: [{ id: 'merchant', type: 'lnbits' }], activeWalletId: 'personal',
    kioskTipEnabled: false, kioskTipValues: [5, 10, 20], kioskRoundUpEnabled: false,
    kioskDisplayCurrency: 'sats', preferredFiatCurrency: 'USD', exchangeRates: {}, exchangeRateTimes: {},
    async loadExchangeRates() { h.priceLoads += 1; },
    providers: { merchant: provider }, balances: { merchant: 0 }, pendingDeepLink: options.pending || null,
    async ensureWalletConnectedForTransfer(id) { assert.equal(id, 'merchant'); return provider; },
    // The store's receive methods, answered by the stand-in wallet above.
    async createInvoiceDetailsOnWallet(id, amount, description) { assert.equal(id, 'merchant'); return provider.createInvoice({ amount, description }); },
    async lookupInvoiceOnWallet(id, hash) { assert.equal(id, 'merchant'); return provider.lookupInvoice(hash); },
    showPaymentError: error => h.errors.push(error),
    ...options.storeState,
    refreshBalance: async id => { assert.equal(id, 'merchant'); },
  });
  const dependencies = {
    vue: Vue, 'vue-router': { useRouter: () => ({ replace: () => assert.fail('unexpected navigation') }) },
    'stores/wallet': { useWalletStore: () => store },
    'stores/transactionMetadata': { useTransactionMetadataStore: () => ({ enqueuePendingContactLink: async receipt => h.receipts.push(receipt) }) },
    'components/KioskPinPad.vue': {}, 'src/utils/roundUp': roundUp, 'src/utils/fiatCurrencies': fiat,
    'src/utils/amountFormatting': amountFormatting,
    qrcode: { toDataURL: async () => 'data:image/png;base64,test' }, '@getalby/lightning-tools': {},
    '../components/WithdrawAuthorization.vue': {}, '../components/CardFace.vue': {},
    '../composables/useKioskParkedSales.js': { useKioskParkedSales: args => useKioskParkedSales({ ...args, watchMs: 5, storage: { getItem: key => h.storage.get(key) ?? null, setItem: (key, value) => h.storage.set(key, value) } }) },
    '../utils/nfc.js': { isNfcAvailable: async () => false },
    '../utils/haptics.js': { haptics: { tap() {}, medium() {}, success() {}, error() {} } },
    quasar: { useQuasar: () => ({ notify: notice => h.notices.push(notice), dialog: options => ({ onOk: ok => h.dialogs.push({ options, ok }) }) }) },
    '../composables/useKioskCardPayment.js': { ...cardPayment, useKioskCardPayment: args => cardPayment.useKioskCardPayment({ ...args, resolve: async () => ({ callback: 'https://card.example/callback', defaultDescription: 'Bolt Card', minSats: 1, maxSats: 10000 }), paymentWaitMs: options.cardPaymentWaitMs }) },
    '../services/lnurlWithdraw.js': { safeWithdrawError: error => error },
    '../utils/walletCapabilities.js': walletCapabilities,
    '../utils/nwcErrors.js': nwcErrors,
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

test('cold-start card waits for the amount, then for an explicit charge of exactly the sale', async ctx => {
  const h = harness(ctx, { pending: { data: 'lnurlw://card.example/tap', target: 'kiosk', receivedAt: Date.now() } });
  await settle();
  assert.equal(h.store.pendingDeepLink, null);
  assert.equal(h.vm.card.phase.value, 'ready');
  assert.equal(h.created.length, 0);
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 1);
  assert.equal(h.vm.card.phase.value, 'review');
  assert.equal(h.authorized.length, 0, 'its holder never saw the amount');
  h.vm.confirmHeldCard(); await settle();
  assert.equal(h.authorized.length, 1);
  assert.equal(h.authorized[0][2], 100);
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
  await h.vm.card.confirm({ amountSats: 110 });
  await h.vm.card.confirm({ amountSats: 110 });
  assert.equal(h.authorized.length, 1);
  assert.equal(h.authorized[0][2], 110, 'the tip is charged');
  assert.equal(h.authorized[0][1], 'lnbc-sale');
  assert.equal(h.vm.state, 'payment', 'callback OK cannot declare paid');
});

test('QR-first tap reuses invoice and unrelated balance growth cannot settle the sale', async ctx => {
  const h = harness(ctx);
  await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.tap(); await settle();
  assert.equal(h.authorized.length, 1, 'a tap on the pay screen pays at once');
  await h.vm.card.confirm({ amountSats: 100 });
  assert.equal(h.authorized.length, 1);
  assert.equal(h.vm.cardBusy, true, 'the card stays on screen while the sale settles');
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
  assert.equal(h.vm.paidByCard, true);
  assert.ok(h.lookups.every(hash => hash === 'sale-hash'));
});

test('parking clears card credentials and resuming preserves the invoice including tip', async ctx => {
  const h = harness(ctx); await settle();
  h.store.kioskTipEnabled = true;
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); h.vm.selectedTipPercent = 10; h.vm.confirmTip(); await settle();
  h.vm.parkInvoice();
  assert.equal(h.vm.card.phase.value, 'empty');
  assert.equal(h.vm.parkedCount, 1);
  assert.equal(h.vm.state, 'input');
  await h.vm.resumeParked(h.vm.parkedList[0].id); await settle();
  assert.equal(h.vm.parkedCount, 0);
  h.tap(); await settle();
  assert.equal(h.vm.invoiceData.amountSats, 110);
  assert.equal(h.authorized[0][2], 110, 'the resumed sale is charged with its tip');
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
  assert.equal(h.errors.length, 0, 'no dialog at the counter');
  assert.match(h.vm.cardProblem, /No answer from the card's service/);
  assert.equal(h.vm.cardBusy, false, 'the QR is back');
  assert.equal(h.vm.state, 'payment');
  assert.equal(h.authorized.length, 1);
  h.paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.equal(h.created.length, 1);
});

// A card whose service answered OK but never pays (#460).
async function cardThatNeverPays(ctx, cardPaymentWaitMs = 20) {
  const h = harness(ctx, { cardPaymentWaitMs }); await settle();
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  h.tap(); await settle();
  assert.equal(h.vm.card.phase.value, 'waiting');
  assert.equal(h.vm.cardBusy, true, '"Paying…" in the QR\'s place');
  return h;
}

test('a card that never pays gives the sale back to the QR with Park and Cancel, and a late payment still counts', async ctx => {
  const h = await cardThatNeverPays(ctx);
  await wait(30); await settle();
  assert.equal(h.vm.cardBusy, false, 'the QR, Park and Cancel are back');
  assert.equal(h.vm.cardProblem, 'No payment came from the card.');
  assert.equal(h.vm.state, 'payment');
  assert.equal(h.errors.length, 0, 'no dialog at the counter');
  h.paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.equal(h.vm.paidByCard, false, 'who paid late is not known');
  assert.equal(h.created.length, 1);
});

test('after a card that never paid, the next tap tries the same invoice again', async ctx => {
  const h = await cardThatNeverPays(ctx);
  await wait(30); await settle();
  h.tap(); await settle();
  assert.equal(h.authorized.length, 2);
  assert.equal(h.authorized[1][1], h.authorized[0][1], 'the same invoice');
  assert.equal(h.vm.cardProblem, '', 'the new tap clears the old line');
  assert.equal(h.vm.cardBusy, true);
});

test('an invoice that expires while the card waits lets go of the card', async ctx => {
  // The full wait, so only the expiry can end it here.
  const h = await cardThatNeverPays(ctx, cardPayment.CARD_PAYMENT_WAIT_MS);
  h.monitors[0].invoice.expires_at = Math.floor(Date.now() / 1000) - 1;
  await h.monitors[0].checkNow(); await settle();
  assert.equal(h.vm.paymentProblem, 'Payment expired');
  assert.equal(h.vm.card.phase.value, 'empty');
  assert.equal(h.vm.cardBusy, false, 'Park and Cancel are back');
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

test('a kiosk on an NWC wallet charges and sees the payment through the store (#397)', async ctx => {
  const h = harness(ctx); await settle();
  // An NWC connection has no createInvoice/lookupInvoice the kiosk could call
  // directly; only the store knows how to ask it.
  const provider = await h.store.ensureWalletConnectedForTransfer('merchant');
  delete provider.createInvoice; delete provider.lookupInvoice;
  const asked = [];
  h.store.createInvoiceDetailsOnWallet = async (id, amount, description) => {
    asked.push(['invoice', id, amount, description]);
    return { paymentRequest: 'lnbc-nwc-sale', paymentHash: 'nwc-hash', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  };
  let paid = false;
  h.store.lookupInvoiceOnWallet = async (id, hash) => { asked.push(['lookup', id, hash]); return { paid, amount: 100 }; };
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.vm.state, 'payment', 'QR shown, waiting');
  assert.deepEqual(h.errors, []);
  paid = true;
  await h.monitors[0].checkNow();
  assert.equal(h.vm.state, 'success');
  assert.deepEqual(asked[0], ['invoice', 'merchant', 100, 'Kiosk Payment']);
  assert.ok(asked.slice(1).every((entry) => entry.join() === ['lookup', 'merchant', 'nwc-hash'].join()));
});

test('a kiosk wallet that may not create invoices says why instead of charging', async ctx => {
  const h = harness(ctx); await settle();
  h.store.createInvoiceDetailsOnWallet = async () => { throw Object.assign(new Error('This connection cannot create invoices'), { code: 'NWC_RECEIVE_NOT_ALLOWED' }); };
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.vm.state, 'input');
  assert.equal(h.errors[0]?.code, 'NWC_RECEIVE_NOT_ALLOWED', 'shown in the payment-error dialog');
});

test('a kiosk wallet that can no longer see payments refuses the sale before a QR is shown', async ctx => {
  const h = harness(ctx); await settle();
  // Chosen when it could; its connection has since lost lookup and list.
  h.store.wallets = [{ id: 'merchant', type: 'nwc', metadata: { methods: ['make_invoice'] } }];
  h.vm.rawInput = '100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 0, 'no invoice made');
  assert.equal(h.vm.state, 'input');
  assert.equal(h.errors[0]?.code, 'NWC_CONFIRM_NOT_ALLOWED');
});

// ── Parked sales ──────────────────────────────────────────────────────────

async function chargeAndPark(h, amount) {
  h.vm.rawInput = String(amount); h.vm.proceedToTipOrCharge(); await settle();
  h.vm.parkInvoice(); await settle();
}

test('parking keeps every sale and keeps watching it; a paid one is recorded wherever the register is', async ctx => {
  const h = harness(ctx, { create: nextSale }); await settle();
  await chargeAndPark(h, 100);
  await chargeAndPark(h, 200);
  assert.equal(h.vm.parkedCount, 2, 'a second park never drops the first');
  h.vm.rawInput = '300'; h.vm.proceedToTipOrCharge(); await settle();
  const first = h.vm.parkedList.find(sale => sale.invoiceData.amountSats === 100);
  h.paidHashes.add(first.invoiceData.paymentHash);
  await wait(30); await settle();
  assert.equal(h.vm.parkedCount, 1);
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].amountSats, 100);
  assert.equal(h.notices.length, 1);
  assert.equal(h.vm.state, 'payment', 'the sale on screen is untouched');
  assert.equal(h.vm.invoiceData.amountSats, 300);
});

test('cancelling the sale on screen leaves parked sales alone', async ctx => {
  const h = harness(ctx, { create: nextSale }); await settle();
  await chargeAndPark(h, 100);
  h.vm.rawInput = '50'; h.vm.proceedToTipOrCharge(); await settle();
  h.vm.cancelPayment();
  assert.equal(h.vm.parkedCount, 1);
});

test('a full list refuses to park and drops nothing', async ctx => {
  const h = harness(ctx, { create: nextSale }); await settle();
  for (let i = 1; i <= 6; i++) await chargeAndPark(h, i * 10);
  assert.equal(h.vm.parkedCount, 6);
  h.vm.rawInput = '70'; h.vm.proceedToTipOrCharge(); await settle();
  h.vm.parkInvoice();
  assert.equal(h.vm.parkedCount, 6);
  assert.equal(h.vm.state, 'payment', 'the seventh sale stays on screen');
  assert.equal(h.notices.at(-1).message, '{n} sales are parked');
});

test('parked sales survive a restart and are still watched', async ctx => {
  const storage = new Map();
  const before = harness(ctx, { create: nextSale, storage }); await settle();
  await chargeAndPark(before, 100);
  const hash = before.vm.parkedList[0].invoiceData.paymentHash;
  const after = harness(ctx, { storage }); await settle();
  assert.equal(after.vm.parkedCount, 1);
  after.paidHashes.add(hash);
  await wait(30); await settle();
  assert.equal(after.vm.parkedCount, 0);
  assert.equal(after.receipts.length, 1);
});

test('a parked sale opens only on an empty register, and an expired one not at all', async ctx => {
  const h = harness(ctx, { create: () => ({ ...nextSale(), expiresAt: Math.floor(Date.now() / 1000) + 1 }) }); await settle();
  await chargeAndPark(h, 100);
  const id = h.vm.parkedList[0].id;
  h.vm.rawInput = '5';
  await h.vm.resumeParked(id);
  assert.equal(h.vm.parkedCount, 1, 'typing on the register keeps it parked');
  assert.equal(h.vm.state, 'input');
  h.vm.rawInput = '0';
  await wait(1100); await wait(30); await settle();
  assert.equal(h.vm.parkedList[0].status, 'expired', 'checked once more after expiry, then shown expired');
  h.vm.removeParked(h.vm.parkedList[0]);
  assert.equal(h.vm.parkedCount, 0, 'an expired sale goes without asking');
});

test('removing a sale that can still be paid asks first', async ctx => {
  const h = harness(ctx, { create: nextSale }); await settle();
  await chargeAndPark(h, 100);
  h.vm.removeParked(h.vm.parkedList[0]);
  assert.equal(h.vm.parkedCount, 1);
  assert.equal(h.dialogs.length, 1);
  h.dialogs[0].ok();
  assert.equal(h.vm.parkedCount, 0);
});

test('the register shows amounts in the Bitcoin format chosen in Settings (#453)', async ctx => {
  const h = harness(ctx); await settle();
  const n = (1234).toLocaleString();
  assert.equal(h.vm.amountPrefix, '₿', 'the default format puts ₿ in front');
  assert.equal(h.vm.showSatsSuffix, false);
  assert.equal(h.vm.displaySats(1234), `₿ ${n}`);
  h.store.useBip177Format = false; await settle();
  assert.equal(h.vm.amountPrefix, '');
  assert.equal(h.vm.showSatsSuffix, true, 'only the legacy format says sats');
  assert.equal(h.vm.displaySats(1234), `${n} sats`);
  h.store.kioskDisplayCurrency = 'fiat'; h.store.exchangeRates = { usd: 100_000 }; h.store.exchangeRateTimes = { usd: Date.now() }; await settle();
  assert.equal(h.vm.amountPrefix, '$');
  assert.equal(h.vm.showSatsSuffix, false);
  assert.equal(h.vm.displaySats(1234), '$ 1.23', 'fiat keeps its two decimals');
});

test('a fiat register charges only with a Bitcoin price from the last hour, and says why it waits (#456)', async ctx => {
  const h = harness(ctx, { storeState: { kioskDisplayCurrency: 'fiat' } }); await settle();
  assert.equal(h.priceLoads, 1, 'the register asks for the price itself');
  h.vm.rawInput = '12.50'; await settle();
  assert.equal(h.vm.priceMissing, true);
  assert.equal(h.vm.amountSats, 0, 'without a price the typed number is never read as Bitcoin');
  h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 0, 'nothing is charged');
  h.store.exchangeRates = { usd: 100_000 }; h.store.exchangeRateTimes = { usd: Date.now() - 61 * 60 * 1000 }; await settle();
  assert.equal(h.vm.priceMissing, true, 'a price older than an hour is not used');
  h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 0);
  h.store.exchangeRateTimes = { usd: Date.now() - 59 * 60 * 1000 }; await settle();
  assert.equal(h.vm.priceMissing, false, 'the last known price counts for an hour');
  h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].amount, 12_500, '12.50 at 100,000 per bitcoin');
});

test('a register in Bitcoin needs no price and never fetches one', async ctx => {
  const h = harness(ctx); await settle();
  assert.equal(h.priceLoads, 0);
  assert.equal(h.vm.priceMissing, false);
  h.vm.rawInput = '2100'; h.vm.proceedToTipOrCharge(); await settle();
  assert.equal(h.created[0].amount, 2100);
});
