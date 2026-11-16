import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';
import * as merchantUtils from '../../utils/kioskMerchant.js';
import * as capabilities from '../../utils/walletCapabilities.js';

const script = readFileSync(new URL('../KioskModePage.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);

async function mountOwner(ctx, { enabled = true, setupCompleted = enabled, wallets = [{ id: 'shop', name: 'Counter', type: 'spark' }], orders = [], failedWrite = false, native = false, revision, catalogCurrency = 'EUR' } = {}) {
  const calls = [];
  const wallet = Vue.reactive({ wallets, kioskEnabled: enabled, kioskOwnerAccess: true, kioskWalletId: 'shop', activeWalletId: 'shop', preferredFiatCurrency: 'EUR', kioskDisplayCurrency: 'sats',
    async enableKiosk(pin, id) { calls.push(['enable', pin, id]); this.kioskEnabled = true; },
    async setKioskDisplayCurrency(unit) { calls.push(['unit', unit]); this.kioskDisplayCurrency = unit; },
    async activateKioskMode() { calls.push(['lock']); this.kioskOwnerAccess = false; },
    async setKioskWallet(id) { calls.push(['wallet', id]); this.kioskWalletId = id; },
  });
  const merchant = Vue.reactive({ data: revision === undefined ? undefined : { revision }, products: [], categories: [], savedBaskets: [], orders, setupCompleted, catalogCurrency, draft: merchantUtils.emptyKioskDraft(catalogCurrency), currentOrder: null, canRestore: !orders.length,
    getOrder(id) { return this.orders.find(order => order.id === id); },
    async initialize() { calls.push(['initialize']); }, async flush() { if (failedWrite) throw { code: 'KIOSK_STORAGE_FAILED' }; },
    async completeSetup() { calls.push(['complete']); if (failedWrite) throw { code: 'KIOSK_STORAGE_FAILED' }; this.setupCompleted = true; },
    async setDraft(draft) { this.draft = draft; }, async setCatalogCurrency(currency) { calls.push(['currency', currency]); this.catalogCurrency = currency; },
    salesCsv(selected) { calls.push(['csv', selected.map(order => order.id)]); return merchantUtils.kioskSalesCsv(selected); },
  });
  const route = Vue.reactive({ query: {} });
  const router = { async push(target) { calls.push(['route', target]); if (typeof target === 'object') route.query = target.query; }, async replace(target) { route.query = target.query; } };
  const stub = { render: () => null };
  const modules = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native } },
    '@iconify/vue': { Icon: stub },
    '../services/fileExport.js': { async saveFile(file) { calls.push(['save', file]); } },
    '../composables/useKioskPayments.js': { useKioskPayments: () => ({ ready: Promise.resolve(), async resume(id) { calls.push(['resume', id]); } }) },
    '../stores/wallet': { useWalletStore: () => wallet },
    '../stores/kioskMerchant.js': { useKioskMerchantStore: () => merchant },
    '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ getConfig: () => null }) },
    '../utils/walletCapabilities.js': capabilities,
    '../utils/walletNames.js': { walletTypeLabel: value => value.type },
    '../utils/fiatCurrencies.js': { SELECTABLE_FIAT_CURRENCIES: ['EUR', 'USD'] },
    '../utils/kioskMerchant.js': merchantUtils,
    '../utils/autoTransferCopy.js': { destinationLabel: () => '', statusText: () => ({ text: '' }) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name.endsWith('.vue')) return stub;
    assert.ok(name in modules, name);
    return modules[name];
  }, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') });
  Object.assign(app.config.globalProperties, { $t: t, $i18n: { locale: 'en-US' }, $q: { dark: { isActive: false }, notify() {} }, $route: route, $router: router });
  const vm = app.mount({ children: [] });
  ctx.after(() => app.unmount());
  await new Promise(resolve => setImmediate(resolve));
  return { vm, merchant, wallet, route, calls };
}
const order = (id, currency, { base = 1200, tip = 200, status = 'paid' } = {}) => ({
  id, currency, walletId: 'shop', walletName: 'Counter', items: [{ id: `item-${id}`, name: 'Tea', category: '', qty: 1, unit: 'fiat', priceMinor: 100, lineMinor: 100, lineSats: base, currency }],
  status, createdAt: Date.now(), paidAt: status === 'paid' ? Date.now() : null, baseSats: base, tipSats: tip, roundUpSats: 0, totalSats: base + tip, subtotalMinor: 100, tipMinor: 15, roundUpMinor: 0, totalMinor: 115, label: '', method: 'QR', attempts: [],
});

test('receipt printing is offered in browsers and guarded in native builds', async ctx => {
  const previous = globalThis.window;
  let printed = 0;
  globalThis.window = { print: () => { printed++; } };
  ctx.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const web = await mountOwner(ctx, { orders: [order('sale', 'EUR')] });
  web.route.query = { view: 'receipt', sale: 'sale' };
  assert.equal(web.vm.moreActions.some(action => action.id === 'print'), true);
  await web.vm.performMore('print');
  assert.equal(printed, 1);
  const native = await mountOwner(ctx, { native: true, orders: [order('sale', 'EUR')] });
  native.route.query = { view: 'receipt', sale: 'sale' };
  assert.equal(native.vm.moreActions.some(action => action.id === 'print'), false);
  await native.vm.performMore('print');
  assert.equal(printed, 1);
});

test('first setup refreshes an untouched default currency and preserves stored or nonempty registers', async ctx => {
  const fresh = await mountOwner(ctx, { enabled: false, revision: 0, catalogCurrency: 'USD' });
  assert.equal(fresh.vm.setupCurrency, 'EUR');
  for (const options of [{ revision: 1 }, { revision: 0, setupCompleted: true }, { revision: 0, orders: [order('existing', 'USD')] }]) {
    const saved = await mountOwner(ctx, { enabled: false, catalogCurrency: 'USD', ...options });
    assert.equal(saved.vm.setupCurrency, 'USD');
    assert.equal(saved.calls.some(call => call[0] === 'currency'), false);
  }
});

test('an active unpaid request keeps its receiving wallet until finished or set aside', async ctx => {
  const { vm, merchant, wallet, calls } = await mountOwner(ctx, { wallets: [{ id: 'shop', name: 'Counter', type: 'spark' }, { id: 'other', name: 'Other', type: 'spark' }] });
  merchant.currentOrder = order('waiting', 'EUR', { status: 'waiting' });
  await vm.setWallet('other');
  assert.equal(wallet.kioskWalletId, 'shop');
  assert.equal(calls.some(call => call[0] === 'wallet'), false);
  assert.match(vm.error, /current payment/);
  merchant.currentOrder.status = 'paid';
  await vm.setWallet('other');
  assert.equal(wallet.kioskWalletId, 'other');
});

test('resume conflicts leave owner access unlocked and allow reopening the same payment', async ctx => {
  const { vm, merchant, calls, wallet } = await mountOwner(ctx);
  merchant.currentOrder = order('current', 'EUR', { status: 'waiting' });
  merchant.draft = { ...merchant.draft, amountRaw: '101', exactSats: 101 };
  await vm.resumePayment('other');
  assert.equal(wallet.kioskOwnerAccess, true);
  assert.equal(calls.some(call => call[0] === 'lock' || call[0] === 'resume'), false);
  assert.match(vm.error, /basket/);
  await vm.resumePayment('current');
  assert.deepEqual(calls.find(call => call[0] === 'resume'), ['resume', 'current']);
  wallet.kioskOwnerAccess = true;
  calls.length = 0;
  merchant.currentOrder = null;
  await vm.resumePayment('other');
  assert.equal(wallet.kioskOwnerAccess, true);
  assert.equal(calls.some(call => call[0] === 'lock'), false);
});

test('resuming a saved basket advances the paid sale before restoring its items', async ctx => {
  const { vm, merchant, calls } = await mountOwner(ctx);
  merchant.currentOrder = order('paid', 'EUR');
  merchant.draft = { ...merchant.draft, amountRaw: '101', exactSats: 101 };
  merchant.startNextSale = async () => { calls.push(['next']); merchant.currentOrder = null; merchant.draft = merchantUtils.emptyKioskDraft('EUR'); };
  merchant.resumeBasket = async id => { assert.equal(merchantUtils.kioskDraftHasValue(merchant.draft), false); calls.push(['basket', id]); merchant.draft.items = [{ name: 'Saved tea' }]; };
  vm.openRegister = async () => { calls.push(['open']); };
  let choose;
  vm.$q.dialog = () => ({ onOk(fn) { choose = fn; } });
  vm.basketActions({ id: 'saved', name: 'Saved basket' });
  await choose('resume');
  assert.deepEqual(calls.filter(call => ['next', 'basket', 'open'].includes(call[0])), [['next'], ['basket', 'saved'], ['open']]);
  assert.equal(merchant.draft.items[0].name, 'Saved tea');
});

test('fresh setup confirms wallet and currency, repeats PIN, and starts fiat without enabling on a mismatched PIN', async ctx => {
  const { vm, calls, merchant, wallet } = await mountOwner(ctx, { enabled: false });
  assert.equal(vm.setupStep, 'welcome');
  vm.startSetup();
  assert.equal(vm.setupWalletId, 'shop');
  assert.equal(vm.setupCurrency, 'EUR');
  await vm.confirmDefaults();
  await vm.setupPin('1234');
  await vm.setupPin('1235');
  assert.equal(calls.some(call => call[0] === 'enable'), false);
  await vm.setupPin('1234');
  await vm.setupPin('1234');
  assert.equal(vm.setupStep, 'ready');
  assert.equal(wallet.kioskDisplayCurrency, 'fiat');
  assert.equal(merchant.draft.amountUnit, 'fiat');
  assert.equal(vm.firstPin, '');
  assert.deepEqual(calls.filter(call => call[0] === 'enable'), [['enable', '1234', 'shop']]);
});

test('existing register keeps its entry unit and cannot open when records cannot be saved', async ctx => {
  const { vm, calls, wallet } = await mountOwner(ctx, { failedWrite: true });
  assert.equal(vm.setupStep, null);
  await vm.openRegister();
  assert.equal(wallet.kioskDisplayCurrency, 'sats');
  assert.equal(calls.some(call => call[0] === 'lock'), false);
  assert.equal(calls.some(call => call[0] === 'route'), false);
  assert.match(vm.error, /save/);
});

test('receiving eligibility is checked before setup and again before opening the register', async ctx => {
  const { vm, calls, wallet } = await mountOwner(ctx, { enabled: false, wallets: [{ id: 'shop', name: 'Counter', type: 'arkade' }] });
  vm.startSetup();
  assert.equal(vm.eligibleWallets.length, 0);
  await vm.confirmDefaults();
  assert.equal(vm.setupStep, 'defaults');
  wallet.kioskEnabled = true;
  await vm.openRegister();
  assert.equal(vm.walletSheetOpen, true);
  assert.equal(calls.some(call => call[0] === 'lock'), false);
});

test('sales summary separates original fiat currencies, excludes pending, and keeps extras outside base sales', async ctx => {
  const { vm } = await mountOwner(ctx, { orders: [order('eur', 'EUR'), order('usd', 'USD'), order('pending', 'EUR', { status: 'waiting' })] });
  vm.period = 'all';
  assert.equal(vm.visibleSales.length, 3);
  assert.deepEqual(vm.summary.map(group => ({ currency: group.currency, count: group.count, minor: group.minor, base: group.baseSats, extras: group.extrasSats })).sort((a,b) => a.currency.localeCompare(b.currency)), [
    { currency: 'EUR', count: 1, minor: 100, base: 1200, extras: 200 },
    { currency: 'USD', count: 1, minor: 100, base: 1200, extras: 200 },
  ]);
});

test('export confirmation freezes the selected scope even if filters change before the person confirms', async ctx => {
  const { vm, calls } = await mountOwner(ctx, { orders: [order('eur', 'EUR'), order('usd', 'USD')] });
  vm.period = 'all'; vm.saleCurrency = 'EUR';
  let confirm;
  vm.ask = () => new Promise(resolve => { confirm = resolve; });
  const exporting = vm.exportSales();
  vm.saleCurrency = 'USD';
  confirm(true);
  await exporting;
  assert.deepEqual(calls.find(call => call[0] === 'csv'), ['csv', ['eur']]);
  const saved = calls.find(call => call[0] === 'save');
  assert.match(saved[1].data, /"eur"/);
  assert.doesNotMatch(saved[1].data, /"usd"/);
});


test('a wallet removed during PIN setup is not announced ready or enabled', async ctx => {
  const { vm, wallet, calls } = await mountOwner(ctx, { enabled: false });
  vm.startSetup();
  await vm.confirmDefaults();
  await vm.setupPin('1234');
  wallet.wallets = [];
  await Vue.nextTick();
  await vm.setupPin('1234');
  assert.equal(vm.setupStep, 'defaults');
  assert.equal(vm.firstPin, '');
  assert.equal(calls.some(call => call[0] === 'enable'), false);
});
