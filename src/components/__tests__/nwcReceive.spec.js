import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { reactive, watch } from 'vue';
import { createPaymentMonitor, PaymentStatus } from '../../utils/paymentMonitor.js';
import { lookupNwcInvoice, notifiesPayments } from '../../services/nwcReceive.js';
import { createWalletWatch } from '../../services/walletWatch.js';
import { createReceiptLedger } from '../../services/paymentReceipts.js';
import * as incoming from '../../services/incomingPayments.js';
import { capabilitiesOf } from '../../utils/nwcWallet.js';

const HASH = 'ab'.repeat(32), OTHER = 'cd'.repeat(32);
const source = readFileSync(new URL('../ReceiveModal.vue', import.meta.url), 'utf8');
const { code } = transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' });
const module = { exports: {} };
let visibility, ledger;
const deps = {
  '../utils/paymentMonitor': { createPaymentMonitor, PaymentStatus },
  '../services/nwcReceive.js': { lookupNwcInvoice, notifiesPayments },
  '../utils/nwcWallet.js': { capabilitiesOf },
  '../utils/appVisibility.js': { onAppVisibility: callback => {
    visibility = callback;
    return () => { visibility = null; };
  } },
  '../services/incomingPayments.js': incoming,
  '../services/paymentReceiptsApp.js': { noteReceiptShown: (walletId, hash) => ledger.markSeen(walletId, hash) },
  '../utils/haptics.js': { haptics: { success() {} } },
};
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
const component = module.exports.default;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(t, { notifications = true, methods = ['make_invoice', 'lookup_invoice', 'list_transactions'] } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_900_000_000_000 });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const online = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: online });
  const wallet = { id: 'nwc', type: 'nwc', metadata: { methods, notifications: notifications ? ['payment_received'] : [] } };
  const store = reactive({ wallets: [wallet], activeWalletId: 'nwc', activeWalletType: 'nwc', lastReceipt: null });
  const invoice = { walletId: 'nwc', payment_hash: HASH, amount: 5000, expires_at: 1_900_003_600 };
  const requests = [], statuses = [], refreshes = [], notices = [], activities = [];
  let rows = [], subscribers = [], lookups = 0, connections = 0;
  let lookup = () => ({ state: 'pending' });
  let connect = () => connection;
  const connection = {
    connected: true,
    listTransactions: async () => ({ transactions: rows }), // WebLN amounts are sats.
    client: {
      connected: true,
      subscribeNotifications: async callback => { subscribers.push(callback); return () => { subscribers = subscribers.filter(s => s !== callback); }; },
      lookupInvoice: async params => { lookups++; requests.push(params); return lookup(); },
      listTransactions: async () => ({ transactions: rows.map(r => ({ ...r, amount: r.amount * 1000 })) }),
    },
  };
  store.nwcConnection = async id => { assert.equal(id, 'nwc'); connections++; return connect(); };
  store.refreshWalletData = async id => { refreshes.push(id); };
  store.recordConfirmedReceive = activity => { activities.push(activity); return activity; };
  const memory = new Map();
  ledger = createReceiptLedger({ storage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) } });
  const localLedger = ledger;
  const vm = {
    ...component.methods, show: true, hasActiveWallet: true, isValidAmount: true, amountInSats: 5000, description: 'Lunch',
    generatedInvoice: invoice, walletStore: store, monitorGeneration: 0, isPaymentConfirmed: false,
    $watch: (source, callback, options) => watch(source, callback, options),
    $t: value => value, $q: { notify: value => notices.push(value) }, $nextTick: fn => Promise.resolve().then(fn),
    $emit() {}, formatInvoiceFiat: amount => String(amount),
    handlePaymentStatus(status, data) { statuses.push(status); component.methods.handlePaymentStatus.call(vm, status, data); },
  };
  // Vue runs this watcher on every active-wallet change in the actual sheet.
  const stopWallet = watch(() => store.activeWalletId, (next, previous) => component.watch['walletStore.activeWalletId'].call(vm, next, previous), { flush: 'sync' });
  component.watch.generatedInvoice.call(vm, invoice, null);
  t.after(() => {
    vm.stopPaymentMonitor(); stopWallet(); incoming.forgetReceiveInvoice(HASH); incoming.forgetReceiveInvoice(OTHER);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  const deliver = receipt => { store.lastReceipt = { walletId: receipt.walletId, paymentHash: receipt.paymentHash, paymentId: receipt.id, amountSats: receipt.amountSats, at: Date.now() }; };
  return {
    vm, store, connection, requests, statuses, refreshes, notices, activities, ledger: localLedger,
    get lookups() { return lookups; }, get connections() { return connections; }, get subscribers() { return subscribers.length; },
    setLookup(fn) { lookup = fn; }, setConnect(fn) { connect = fn; }, setRows(value) { rows = value; },
    receipt(extra = {}) { store.lastReceipt = { walletId: 'nwc', paymentHash: HASH, amountSats: 2100, at: Date.now(), ...extra }; },
    async tick(ms) { t.mock.timers.tick(ms); await flush(); },
    async resume() { visibility?.(true); online.dispatchEvent(new Event('online')); await flush(); },
    async startWatch() {
      const watcher = createWalletWatch({
        wallets: () => store.wallets, connect: async () => connection, canReadHistory: () => true,
        ruleFor: () => null, refreshBalance: async () => {}, ledger: localLedger, deliver,
        setTimer: () => ({}), clearTimer() {},
      });
      await watcher.start();
      t.after(() => watcher.stop());
      return { watcher, async hint(hash = HASH) {
        for (const callback of [...subscribers]) callback({ notification_type: 'payment_received', notification: { payment_hash: hash } });
        await watcher.check('nwc'); await flush();
      } };
    },
  };
}

test('one shared NWC subscription verifies history and confirms the exact invoice without sheet polling', async t => {
  const h = harness(t), { hint, watcher } = await h.startWatch();
  h.vm.startNWCReceiveMonitor();
  await h.tick(15000);
  assert.equal(h.lookups, 0);
  assert.equal(h.subscribers, 1, 'the sheet did not add a relay subscription');
  h.setRows([{ payment_hash: HASH, type: 'incoming', amount: 2100, state: 'settled', settled_at: Date.now() / 1000 }]);
  await hint(); await hint(); await watcher.check('nwc');
  assert.equal(h.vm.confirmedAmount, 2100, 'actual paid amount, not the requested 5000');
  assert.equal(h.vm.showPaymentConfirmation, true);
  assert.equal(h.statuses.filter(s => s === PaymentStatus.CONFIRMED).length, 1);
  assert.equal(h.lookups, 0);
  assert.equal(h.vm.paymentMonitor, null);
  assert.deepEqual(h.refreshes, ['nwc']);
  assert.equal(h.ledger.isSeen('nwc', HASH), true);
  assert.equal(incoming.shownByReceive(h.store.lastReceipt), true, 'the host leaves this receipt to the sheet');
  assert.equal(h.activities.length, 1);
  assert.equal(h.activities[0].paymentHash, HASH);
  assert.equal(h.activities[0].amountSats, 2100);
});

test('an unpaid notification and another invoice cannot confirm the sheet', async t => {
  const h = harness(t), { hint } = await h.startWatch();
  h.vm.startNWCReceiveMonitor();
  await hint();
  h.setRows([{ payment_hash: OTHER, type: 'incoming', amount: 2100, state: 'settled', settled_at: Date.now() / 1000 }]);
  await hint(OTHER);
  assert.equal(h.vm.isPaymentConfirmed, false);
  assert.equal(h.activities.length, 0, 'unpaid activity is not recorded as a receive');
  assert.equal(incoming.shownByReceive(h.store.lastReceipt), false, 'another invoice remains news for the host');
});

test('receipt matching requires its wallet, hash and a valid actual amount; hash casing is harmless', t => {
  const h = harness(t);
  h.vm.startNWCReceiveMonitor();
  for (const extra of [{ walletId: 'other' }, { paymentHash: OTHER }, { paymentHash: null }, ...[0, -1, NaN, Infinity, 1.5].map(amountSats => ({ amountSats }))]) h.receipt(extra);
  assert.equal(h.vm.isPaymentConfirmed, false);
  h.receipt({ paymentHash: HASH.toUpperCase() });
  assert.equal(h.vm.confirmedAmount, 2100);
});

test('missed notifications use a slow lookup on the same connection', async t => {
  const h = harness(t);
  h.vm.startNWCReceiveMonitor();
  h.setLookup(() => ({ state: 'settled', amount: 2100000 }));
  await h.tick(59999);
  assert.equal(h.lookups, 0);
  await h.tick(1);
  assert.equal(h.lookups, 1);
  assert.deepEqual(h.requests, [{ payment_hash: HASH }]);
  assert.equal(h.vm.confirmedAmount, 2100);
  assert.equal(h.store.lastReceipt, null, 'the sheet can confirm before the shared ledger delivers');
  assert.equal(h.activities.length, 1, 'Home still receives the confirmed activity');
  assert.equal(h.activities[0].walletId, 'nwc');
  assert.equal(h.activities[0].paymentHash, HASH);
  assert.equal(h.activities[0].amountSats, 2100);
  assert.equal(h.ledger.ingest('nwc', { id: HASH, type: 'incoming', status: 'completed', amount: 2100, timestamp: Date.now() / 1000 }), null,
    'the sheet suppression can silence later ledger delivery without losing Home activity');
});

test('deposit activity keeps its owning wallet and an accepted unsettled claim is not a receipt', t => {
  const h = harness(t);
  h.vm.calculateFiatAmount = amount => String(amount);
  h.vm.handleBitcoinDepositClaimed({ walletId: 'original', amount: 2100, processing: true });
  h.vm.handleBitcoinDepositClaimed({ walletId: 'original', amount: 2100, settled: false });
  assert.equal(h.activities.length, 0);
  assert.equal(h.vm.showPaymentConfirmation, undefined);
  h.vm.handleBitcoinDepositClaimed({ walletId: 'original', amount: 2100, transferId: 'claim-payment' });
  assert.equal(h.activities[0].walletId, 'original');
  assert.equal(h.activities[0].paymentId, 'claim-payment');
  assert.equal(h.vm.confirmedAmount, 2100);
});

test('without notifications, preserve the existing four-second polling and history-only fallback', async t => {
  const h = harness(t, { notifications: false, methods: ['make_invoice', 'list_transactions'] });
  h.vm.startNWCReceiveMonitor();
  h.setRows([{ payment_hash: HASH, state: 'settled', type: 'incoming', amount: 21 }]);
  await h.tick(3999);
  assert.equal(h.connections, 0);
  await h.tick(1);
  assert.equal(h.vm.confirmedAmount, 21);
  assert.equal(h.lookups, 0, 'lookup_invoice is not granted');
});

test('a lookup-only connection keeps regular invoice checks even when it advertises notifications', async t => {
  const h = harness(t, { methods: ['make_invoice', 'lookup_invoice'] });
  h.vm.startNWCReceiveMonitor();
  h.setLookup(() => ({ state: 'settled', amount: 21000 }));
  await h.tick(4000);
  assert.equal(h.lookups, 1);
  assert.equal(h.vm.confirmedAmount, 21);
});

test('returning to the app and back online coalesce into one invoice lookup', async t => {
  const h = harness(t), pending = deferred();
  h.vm.startNWCReceiveMonitor(); h.setLookup(() => pending.promise);
  await h.resume();
  assert.equal(h.lookups, 1);
  pending.resolve({ state: 'settled', amount: 21000 }); await flush();
  assert.equal(h.vm.confirmedAmount, 21);
  await h.resume();
  assert.equal(h.lookups, 1, 'listeners were removed on confirmation');
  assert.equal(visibility, null);
});

for (const change of ['close', 'wallet switch', 'wallet removal', 'invoice replacement', 'unmount']) {
  test(`${change} prevents a late lookup or receipt from confirming the sheet`, async t => {
    const h = harness(t), pending = deferred();
    h.vm.startNWCReceiveMonitor(); h.setLookup(() => pending.promise);
    const checking = h.vm.paymentMonitor.checkNow(); await flush();
    if (change === 'close') { h.vm.show = false; component.watch.show.call(h.vm, false); }
    if (change === 'wallet switch') h.store.activeWalletId = 'other';
    if (change === 'wallet removal') h.store.wallets = [];
    if (change === 'invoice replacement') { h.vm.generatedInvoice = { ...h.vm.generatedInvoice, payment_hash: OTHER }; h.vm.startNWCReceiveMonitor(); }
    if (change === 'unmount') component.beforeUnmount.call({ ...h.vm, stopPaymentMonitor: () => h.vm.stopPaymentMonitor(), handleResize() {} });
    pending.resolve({ state: 'settled', amount: 21000 }); await checking;
    h.receipt();
    assert.equal(h.vm.isPaymentConfirmed, false);
    if (['close', 'wallet switch', 'unmount'].includes(change)) assert.equal(h.vm.paymentMonitor, null);
  });
}

test('a stopped connection attempt cannot start a lookup after the sheet closes', async t => {
  const h = harness(t), pending = deferred();
  h.vm.startNWCReceiveMonitor(); h.setConnect(() => pending.promise);
  const checking = h.vm.paymentMonitor.checkNow();
  h.vm.show = false; h.vm.stopPaymentMonitor();
  pending.resolve(h.connection); await checking;
  assert.equal(h.lookups, 0);
  assert.equal(h.vm.isPaymentConfirmed, false);
});

test('a live receipt wins an in-flight fallback check and confirms once', async t => {
  const h = harness(t), pending = deferred();
  h.vm.startNWCReceiveMonitor(); h.setLookup(() => pending.promise);
  const checking = h.vm.paymentMonitor.checkNow(); await flush();
  h.receipt(); pending.resolve({ state: 'settled', amount: 99000 }); await checking;
  assert.equal(h.vm.confirmedAmount, 2100);
  assert.equal(h.statuses.filter(s => s === PaymentStatus.CONFIRMED).length, 1);
});

test('restarting monitoring leaves one receipt watcher', t => {
  const h = harness(t);
  h.vm.startNWCReceiveMonitor(); h.vm.startNWCReceiveMonitor(); h.receipt();
  assert.equal(h.statuses.filter(s => s === PaymentStatus.CONFIRMED).length, 1);
});

test('reconnection is resolved afresh for every fallback lookup', async t => {
  const h = harness(t);
  h.vm.startNWCReceiveMonitor();
  await h.vm.paymentMonitor.checkNow();
  h.setConnect(() => ({ client: { lookupInvoice: async () => ({ state: 'settled', amount: 21000 }) } }));
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.connections, 2);
  assert.equal(h.vm.confirmedAmount, 21);
});

test('a fee-bearing NWC lookup preserves its credited amount on Home and the confirmation', async t => {
  const h = harness(t, { methods: ['lookup_invoice'] });
  h.vm.startNWCReceiveMonitor();
  h.setLookup(() => ({ state: 'settled', amount: 2100000, fees_paid: 5000 }));
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.vm.confirmedAmount, 2100);
  assert.equal(h.activities.at(-1).amountSats, 2100);
});

for (const paid of [true, false]) {
  test(`resume after expiry reads settlement before reporting ${paid ? 'confirmed' : 'expired'}`, async t => {
    const h = harness(t, { methods: ['lookup_invoice'] });
    h.vm.generatedInvoice.expires_at = Date.now() / 1000 - 1;
    h.vm.startNWCReceiveMonitor();
    h.setLookup(() => ({ state: paid ? 'settled' : 'expired', amount: 21000 }));
    await h.resume();
    assert.equal(h.statuses.at(-1), paid ? PaymentStatus.CONFIRMED : PaymentStatus.EXPIRED);
    assert.equal(h.lookups, 1);
  });
}

test('a lookup error cannot turn an expired invoice into an unpaid invoice', async t => {
  const h = harness(t, { methods: ['lookup_invoice'] });
  h.vm.generatedInvoice.expires_at = 1;
  h.vm.startNWCReceiveMonitor(); h.setLookup(() => { throw new Error('offline'); });
  await h.resume();
  assert.ok(!h.statuses.includes(PaymentStatus.EXPIRED));
  assert.ok(!h.statuses.includes(PaymentStatus.CONFIRMED));
  h.setLookup(() => ({ state: 'settled', amount: 21000 }));
  await h.vm.paymentMonitor.checkNow();
  assert.equal(h.vm.confirmedAmount, 21);
});

test('NWC invoice creation reuses the store path and retains its hash and expiry', async t => {
  const h = harness(t);
  const calls = [];
  h.store.createInvoiceDetailsOnWallet = async (...args) => { calls.push(args); return { paymentRequest: 'lnbc-test', paymentHash: HASH, expiresAt: 1_900_003_600 }; };
  await h.vm.createInvoice();
  assert.deepEqual(calls, [['nwc', 5000, 'Lunch']]);
  assert.equal(h.vm.generatedInvoice.payment_hash, HASH);
  assert.equal(h.vm.generatedInvoice.walletId, 'nwc');
  assert.equal(h.vm.generatedInvoice.expires_at, 1_900_003_600);
  assert.equal(h.vm.generatedInvoice.amount, 5000);
  assert.ok(h.vm.paymentMonitor.isActive());
});

for (const change of ['close', 'wallet switch']) {
  test(`invoice creation finishing after ${change} cannot publish or monitor its invoice`, async t => {
    const h = harness(t), pending = deferred();
    h.vm.generatedInvoice = null;
    h.store.createInvoiceDetailsOnWallet = () => pending.promise;
    const creating = h.vm.createInvoice();
    if (change === 'close') { h.vm.show = false; h.vm.stopPaymentMonitor(); }
    else h.store.activeWalletId = 'other';
    pending.resolve({ paymentRequest: 'lnbc-test', paymentHash: HASH }); await creating;
    assert.equal(h.vm.generatedInvoice, null);
    assert.equal(h.vm.paymentMonitor ?? null, null);
  });
}
