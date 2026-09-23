import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { transformSync } from 'esbuild';

function load(path, deps = {}) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8');
  if (path.endsWith('.vue')) source = parse(source).descriptor.script.content;
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
  return module.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('closing Receive during connection cannot install a late payment listener', async () => {
  const component = load('../../components/ReceiveModal.vue', { '../utils/paymentMonitor': { PaymentStatus: { CONFIRMED: 'confirmed' } } }).default;
  const gate = deferred(); let subscriptions = 0;
  const vm = { ...component.methods, generatedInvoice: { payment_hash: 'expected' },
    walletStore: { activeWalletId: 'A', ensureSparkConnected: () => gate.promise } };
  const pending = vm.startSparkEventMonitor();
  vm.stopPaymentMonitor();
  gate.resolve({ onPaymentReceived() { subscriptions++; return () => {}; } });
  await pending;
  assert.equal(subscriptions, 0);
});

test('a resume lookup for an old invoice cannot confirm its replacement', async () => {
  const component = load('../../components/ReceiveModal.vue', { '../utils/paymentMonitor': { PaymentStatus: { CONFIRMED: 'confirmed' } } }).default;
  const gate = deferred(); const confirmed = [];
  const vm = { ...component.methods, generatedInvoice: { invoice_id: 'first' },
    handlePaymentStatus: (...args) => confirmed.push(args), sparkPollState: { cancelled: false } };
  const pending = vm.checkSparkInvoiceOnce({ getLightningReceiveStatus: () => gate.promise }, 'first');
  vm.generatedInvoice = { invoice_id: 'second' };
  gate.resolve({ isPaid: true, amount: 100 });
  await pending;
  assert.deepEqual(confirmed, []);
});

test('a manual Bitcoin claim cannot use a quote belonging to another wallet', async () => {
  const component = load('../../components/L1BitcoinReceive.vue').default;
  let submitted = 0;
  const vm = { ...component.methods, claimWalletId: 'A', claimingDeposit: { txId: 'tx', outputIndex: 0 },
    claimFeeQuote: { feeSats: 2 }, manualClaimAllowed: () => true,
    walletStore: { activeWalletId: 'B', isDepositClaimInFlight: () => false,
      markDepositClaimInFlight() {}, clearDepositClaimInFlight() {},
      ensureSparkConnected: async () => ({ claimDeposit: async () => { submitted++; throw Error('wrong wallet'); } }),
      showPaymentError() {}, refreshWalletData: async () => {}, },
    getUserFriendlyError: () => ({}), $t: s => s, $q: { notify() {} } };
  await vm.confirmClaim();
  assert.equal(submitted, 0);
});

test('auto-withdraw disabled during the fresh read cannot send afterwards', async () => {
  const options = load('../../stores/autoWithdraw.js', {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark' } },
  }).useAutoWithdrawStore;
  const gate = deferred(); let sent = 0;
  const config = { enabled: true, thresholdSats: 100, payoutType: 'spark', sparkAddress: 'destination' };
  const store = { ...options.state(), ...options.actions, configs: { A: config },
    _executeSparkPayout: async () => { sent++; return {}; }, persistConfigs: async () => {} };
  const provider = { getBalance: () => gate.promise };
  const walletStore = { wallets: [{ id: 'A', type: 'spark' }], providers: { A: provider }, walletEpoch: () => 0 };
  const pending = store.checkAndExecute('A', 1000, walletStore);
  config.enabled = false;
  gate.resolve({ balance: 1000 });
  await pending;
  assert.equal(sent, 0);
});

test('boot handles native background state and announces delayed SDK events after resume', async t => {
  const documentEvents = {}; const windowEvents = {}; let appEvent, delivery;
  const toasts = [], notices = [], wake = [];
  t.mock.method(Date, 'now', () => 1_700_000_100_000);
  globalThis.document = { hidden: false, addEventListener: (name, fn) => { documentEvents[name] = fn; } };
  globalThis.window = { addEventListener: (name, fn) => { windowEvents[name] = fn; } };
  const lifecycle = { attach() {}, onWake: reason => wake.push(reason), onVisibilityChanged() {}, diagnostics: () => [] };
  const boot = load('../../boot/spark-lifecycle.js', {
    'quasar/wrappers': { boot: fn => fn }, quasar: { Notify: { create: args => toasts.push(args) } },
    '../stores/wallet.js': { useWalletStore: () => ({ wallets: [{ id: 'A', name: 'Business' }] }) },
    '../stores/bitcoinDeposits.js': { useBitcoinDepositsStore: () => ({}) },
    '../stores/notifications.js': { useNotificationsStore: () => ({ enabled: true, canNotify: true,
      initialize: async () => {}, notifyIfEnabled: args => notices.push(args) }) },
    '../services/sparkLifecycle.js': { configureSparkLifecycle: () => lifecycle },
    '../services/paymentReceipts.js': { createPaymentReceipts: opts => { delivery = opts.deliver; return {}; } },
    '../services/exitKit.js': { exitKitService: () => ({}) },
    '../utils/amountFormatting.js': { formatAmount: n => `${n} sats` },
    './i18n.js': { i18n: { global: { t: key => key } } },
    '@capacitor/app': { App: { addListener: async (_, fn) => { appEvent = fn; } } },
  }).default;
  await boot();
  for (let i = 0; i < 3; i++) {
    appEvent({ isActive: false });
    await delivery({ walletId: 'A', amountSats: 12, timestamp: 1_700_000_050, source: 'event' });
    appEvent({ isActive: true });
    documentEvents.visibilitychange();
    await delivery({ walletId: 'A', amountSats: 12, timestamp: 1_700_000_050, source: 'event' });
  }
  assert.equal(notices.length, 3);
  assert.equal(toasts.length, 3);
  assert.equal(wake.length, 6);
});

test('scanner retries demoted native after web failure but respects permission denial', async () => {
  const component = load('../../components/ScannerOverlay.vue', {
    '../utils/nativeScanner': { isNativeScannerAvailable: () => true },
    '../utils/scannerEngine': await import('../../utils/scannerEngine.js'),
  }).default;
  const { getEngineMemory } = await import('../../utils/scannerEngine.js');
  getEngineMemory().recordNativeFailure('unavailable');
  for (const [name, nativeCalls] of [['NotFoundError', 1], ['NotAllowedError', 0]]) {
    let called = 0;
    const vm = { ...component.methods, startSeq: 0, startNative: async () => { called++; return true; },
      startWeb: async () => Object.assign(new Error('camera'), { name }), showError() {} };
    await vm.start();
    assert.equal(called, nativeCalls);
  }
  getEngineMemory().restoreNative();
});

test('a submitted claim finishing later cannot close or clear a replacement deposit sheet', async () => {
  const component = load('../../components/L1BitcoinReceive.vue').default;
  const gate = deferred(), started = deferred();
  const oldDeposit = { txId: 'old', outputIndex: 0 };
  const newDeposit = { txId: 'new', outputIndex: 1 };
  const vm = { ...component.methods, showClaimDialog: true, claimWalletId: 'A', claimingDeposit: oldDeposit,
    claimFeeQuote: { feeSats: 2 }, manualClaimAllowed: () => true, pendingDeposits: [oldDeposit, newDeposit],
    walletStore: { activeWalletId: 'A', isDepositClaimInFlight: () => false,
      markDepositClaimInFlight() {}, clearDepositClaimInFlight() {}, markDepositClaimed() {}, signalDepositsRefresh() {},
      ensureSparkConnected: async () => ({ claimDeposit: () => { started.resolve(); return gate.promise; } }),
      refreshWalletData: async () => {}, showPaymentError() {} },
    $emit() {}, $t: s => s, $q: { notify() {} }, getUserFriendlyError: () => ({}) };
  const pending = vm.confirmClaim();
  await started.promise;
  vm.claimingDeposit = newDeposit;
  vm.claimFeeQuote = { feeSats: 3 };
  gate.resolve({ processing: false });
  await pending;
  assert.equal(vm.showClaimDialog, true);
  assert.equal(vm.claimingDeposit, newDeposit);
  assert.equal(vm.claimFeeQuote.feeSats, 3);
});
