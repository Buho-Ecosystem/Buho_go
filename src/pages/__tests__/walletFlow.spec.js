import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as addresses from '../../utils/addressUtils.js';
import * as metadata from '../../utils/lnurlMetadata.js';
import * as lnurlPay from '../../utils/lnurlPay.js';

// Run the production Options-API methods with controlled provider promises.
function evaluate(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || source;
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports);
  return module.exports;
}
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const component = (dependencies = {}) => evaluate('../Wallet.vue', {
  '../utils/addressUtils.js': addresses,
  '../utils/lnurlMetadata.js': metadata,
  '../utils/amountFormatting.js': { formatAmount: n => `${n} sats` },
  '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ getConfig: () => null, checkAndExecute() {} }) },
  '../utils/fiatRates': { fiatRatesService: { convertSatsToFiat: async () => null } },
  ...dependencies,
}).default;

function balanceHarness() {
  const notices = [];
  const options = evaluate('../../stores/wallet.js', {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark' } },
    '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {} }) },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
    './notifications': { useNotificationsStore: () => ({ canNotify: true, notifyIfEnabled: async message => notices.push(message) }) },
    '../utils/amountFormatting.js': { formatAmount: n => `${n} sats` },
    '../boot/i18n': { i18n: { global: { t } } },
  }).useWalletStore;
  const a = { id: 'A', name: 'Wallet A' }, b = { id: 'B', name: 'Wallet B' };
  const store = { ...options.actions, activeWalletId: a.id, isActiveWalletSpark: true };
  store.noticeIncomingPayment(a, 1000);
  store.noticeIncomingPayment(b, 100);
  const vm = { ...component().methods, walletStore: store, activeWallet: a, walletState: { balance: 1000 }, loadLastTransaction() {} };
  globalThis.localStorage = { setItem() {} };
  return { store, vm, a, b, notices };
}

test('a delayed balance read cannot update or notify a newly selected wallet', async () => {
  const { store, vm, b, notices } = balanceHarness();
  const read = deferred();
  store.ensureSparkConnected = async () => ({ getBalance: () => read.promise });
  const pending = vm.updateWalletBalance();
  await Promise.resolve();
  store.activeWalletId = b.id;
  vm.activeWallet = b;
  vm.walletState.balance = 100;
  read.resolve({ balance: 1000 });
  await pending;
  assert.equal(vm.walletState.balance, 100);
  assert.deepEqual(notices, []);
});

test('older same-wallet reads cannot roll back the notification baseline', () => {
  const { store, vm, a, notices } = balanceHarness();
  const old = store.beginBalanceRead(a.id);
  const latest = store.beginBalanceRead(a.id);
  assert.equal(vm.applyTickBalance(1200, latest), true);
  assert.equal(vm.applyTickBalance(1000, old), false);
  const next = store.beginBalanceRead(a.id);
  vm.applyTickBalance(1200, next);
  assert.equal(vm.walletState.balance, 1200);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].body, '200 sats · Wallet A');
});

test('confirmed withdrawal shows only the authoritative remaining balance', async () => {
  const refresh = deferred();
  const voucher = { id: 'v', maxSats: 25000 };
  const vm = { ...component().methods, $t: t, walletStore: {}, walletState: {},
    pendingPayment: { voucherId: 'v' }, lnurlWithdrawStatus: 'monitoring', withdrawReceiptVersion: 0,
    withdrawVouchersStore: { byId: () => voucher, displaySats: v => v.maxSats, refresh: () => refresh.promise },
    updateWalletBalance: async () => {},
  };
  await vm.handleWithdrawConfirmed(10000);
  assert.equal(vm.withdrawSuccessNote, 'Find your voucher under Receive.');
  voucher.maxSats = 15000;
  refresh.resolve({ ok: true, voucher });
  await Promise.resolve();
  assert.equal(vm.withdrawSuccessNote, '15000 sats left on this voucher. Find it under Receive.');
  // A refresh belonging to an earlier receipt cannot rewrite the next receipt.
  vm.withdrawReceiptVersion++;
  vm.withdrawSuccessNote = 'Next receipt';
  await vm.refreshVoucherAfterWithdraw('v', 1);
  assert.equal(vm.withdrawSuccessNote, 'Next receipt');
});

test('only the invoice response can authorize a reusable payment link', async () => {
  for (const early of [false, true, undefined]) {
    for (const disposable of [false, true, null, undefined]) {
      let call = 0;
      const methods = component({
        '../utils/lnurlPay.js': lnurlPay,
        '../utils/lnurlHttp.js': { lnurlGetJson: async () => ({ ok: true, data: ++call === 1
          ? { tag: 'payRequest', callback: 'https://coffee.example/cb', minSendable: 1000, maxSendable: 100000, metadata: '[]', disposable: early }
          : { pr: 'fixture', disposable } }) },
        '../utils/lud23.js': { assertPaymentInput() {} },
        '../utils/successAction.js': { parseSuccessAction: () => null },
        '../utils/lnurlVerify.js': { validateVerifyUrl: () => null },
      }).methods;
      const result = await methods.fetchLNURLInvoice.call({ decodeLNURL: () => 'https://coffee.example/pay', walletStore: {} }, 'https://coffee.example/pay', 10);
      assert.equal(!!result.payLink, disposable === false);
    }
  }
});

test('pending service sends retain payment identity without offering completed-payment actions', async () => {
  const methods = component({
    '../services/nostrRecipient': { npubFromLightningAddress: () => null },
    '../services/lnAddressServices': { matchLnAddressService: () => null },
    '../utils/successAction.js': { resolveSuccessAction: async () => null },
  }).methods;
  for (const status of ['pending', 'completed']) {
    const queued = [];
    let success;
    const vm = { ...methods, $t: t, canConfirmPayment: true,
      pendingPayment: { type: 'lnurl_pay', lnurl: 'https://coffee.example/pay', amount: 100 },
      walletStore: { activeWalletType: 'spark', showPaymentError: error => assert.fail(error.message) }, activeWallet: { id: 'A' },
      addressBookStore: { findContactByAddress: () => null },
      transactionMetadataStore: { enqueuePendingContactLink: async value => queued.push(value) },
      sendSparkPayment: async () => ({ id: 'payment-1', status, payLink: 'https://coffee.example/pay', serviceMeta: { description: 'Coffee', identifier: 'alice@coffee.example' } }),
      rememberServiceImage() {}, openSendSuccess: value => { success = value; }, updateWalletBalance: async () => {},
    };
    await vm.confirmPayment();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].transactionId, 'payment-1');
    assert.equal(queued[0].walletId, 'A');
    assert.equal(queued[0].recipientAddress, 'alice@coffee.example');
    assert.equal(queued[0].payLink, addresses.canonicalLnurl('https://coffee.example/pay'));
    assert.equal(success.recipient, 'Coffee');
    assert.equal(success.showSaveContact, status === 'completed');
    if (status === 'completed') assert.equal(vm.saveContactData.service.payLink, queued[0].payLink);
  }
});

test('Pay again is unavailable until a payment completes, including failed payments', () => {
  const details = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) } }).default;
  for (const status of ['pending', 'failed', 'completed']) {
    const link = details.computed.reusablePayLink.call({ transaction: { id: 'p', type: 'outgoing', status },
      metadataWalletId: 'A', metadataStore: { getPayLinkForTransaction: () => 'lnurl1service' } });
    assert.equal(link, status === 'completed' ? 'lnurl1service' : null);
  }
});


test('page ticks and store refreshes share ordering and notification history', async () => {
  const { store, vm, a, notices } = balanceHarness();
  const old = deferred();
  a.type = 'spark';
  Object.assign(store, { wallets: [a], providers: { A: { getBalance: () => old.promise, getInfo: async () => ({}) } },
    connectionStates: { A: { connected: true } }, balances: { A: 1000 }, walletInfos: {}, persistState: async () => {} });
  const pending = store.refreshWalletData('A');
  const latest = store.beginBalanceRead('A');
  vm.applyTickBalance(1200, latest);
  old.resolve({ balance: 1000 });
  await pending;
  assert.equal(notices.length, 1);
  vm.applyTickBalance(1200, store.beginBalanceRead('A'));
  assert.equal(notices.length, 1);
  assert.equal(vm.walletState.balance, 1200);
});

test('a service profile groups payments to both its identifier and original pay link', async () => {
  const profile = evaluate('../ContactProfilePage.vue', { '../services/txNormalizer.js': { normalizeTx: tx => tx } }).default;
  const payLink = addresses.canonicalLnurl('https://coffee.example/pay');
  const transactions = ['identifier', 'link', 'other'].map(id => ({ id, type: 'outgoing', status: 'completed', amount: 100, timestamp: Date.now() }));
  const vm = { ...profile.methods, _historyToken: 0, entry: { id: 'coffee', service: { payLink, identifier: 'alice@coffee.example' } },
    entryAddress: 'alice@coffee.example',
    walletStore: { wallets: [{ id: 'A' }], providers: { A: { getTransactions: async () => transactions } } },
    txMetadata: { getMetadataForTransaction: id => ({ recipientAddress: id === 'identifier' ? 'alice@coffee.example' : id === 'link' ? payLink : 'bob@example.com' }) },
  };
  await vm.loadHistory();
  assert.deepEqual(vm.history.map(tx => tx.id).sort(), ['identifier', 'link']);
});

test('payment review retains a service identity and its exact payment destination', () => {
  const options = component({ '../services/nostrRecipient': { npubFromLightningAddress: () => null } });
  const address = addresses.canonicalLnurl('https://coffee.example/pay');
  for (const contact of [null, { name: 'My coffee shop', address: 'shop@coffee.example', service: { payLink: address } }]) {
    const vm = { ...options.methods, $t: t, $q: { dark: { isActive: false } },
      pendingPayment: { type: 'lnurl_pay', lnurl: address, description: 'Corner Coffee', serviceMeta: { description: 'Corner Coffee' } },
      addressBookStore: { findContactByAddress: value => { assert.equal(value, address); return contact; } },
      serviceImagesStore: { get: () => 'data:image/png;base64,fixture' },
      resolveWalletBrand: () => null, walletStore: {},
    };
    const result = options.computed.paymentSheetProps.call(vm);
    assert.equal(result.recipient.name, contact ? 'My coffee shop' : 'Corner Coffee');
    assert.equal(result.recipient.addressLabel, 'coffee.example');
    assert.equal(result.recipient.address, address);
    assert.equal(result.recipient.service, true);
    assert.equal(result.recipient.verification, undefined, 'service metadata is not merchant verification');
    if (contact) assert.equal(result.recipient.logoUrl, 'data:image/png;base64,fixture');
    else assert.equal(result.description, '', 'do not repeat the merchant name as a memo');
  }
});

test('receipt note edits save explicitly; failures preserve the draft for retry', async () => {
  const methods = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) } }).default.methods;
  const saved = [], notices = [];
  const vm = { ...methods, $t: t, currentNote: 'Coffee', transaction: { id: 'p' }, metadataWalletId: 'A',
    metadataStore: { setNoteForTransaction: async (...args) => saved.push(args) },
    $q: { notify: value => notices.push(value) },
  };
  vm.editNote();
  assert.equal(vm.noteDraft, 'Coffee');
  vm.noteDraft = 'Breakfast';
  assert.equal(saved.length, 0, 'opening or typing must not write a note');
  await vm.saveNote();
  assert.deepEqual(saved, [['p', 'A', 'Breakfast']]);
  assert.equal(vm.showNoteEditor, false);
  vm.editNote();
  vm.noteDraft = 'Retry this';
  vm.metadataStore.setNoteForTransaction = async () => { throw Error('offline'); };
  await vm.saveNote();
  assert.equal(vm.showNoteEditor, true);
  assert.equal(vm.noteDraft, 'Retry this');
  assert.equal(vm.savingNote, false);
  assert.equal(notices[0].message, 'Failed to save note');
});


test('deposit refresh signals update home immediately only for their owning wallet', () => {
  const options = component();
  const calls = [];
  const vm = { walletStore: { activeWalletId: 'A', lastDepositsRefreshWalletId: 'B', isDepositClaimed: () => true },
    pendingBitcoinDeposits: [{ txId: 'deposit' }], checkPendingBitcoinDeposits: () => calls.push('deposits'),
    updateWalletBalance: () => calls.push('balance') };
  options.watch['walletStore.depositsRefreshSignal'].call(vm);
  assert.deepEqual(calls, []);
  vm.walletStore.lastDepositsRefreshWalletId = 'A';
  options.watch['walletStore.depositsRefreshSignal'].call(vm);
  assert.deepEqual(calls, ['deposits', 'balance']);
  assert.deepEqual(vm.pendingBitcoinDeposits, []);
});

test('overlapping deposit polls cannot restore an older list or show another wallet’s deposits', async () => {
  const { vm, store } = balanceHarness();
  const provider = {};
  Object.assign(vm, { isSparkWallet: true, pendingBitcoinDeposits: [], bitcoinDepositRead: 0,
    bitcoinDepositsStore: { processDeposits: async () => {} } });
  store.ensureSparkConnected = async () => provider;
  store.isDepositClaimed = () => false;
  for (const switchWallet of [false, true]) {
    const old = deferred(), reading = deferred();
    provider.getPendingDeposits = () => { reading.resolve(); return old.promise; };
    const pending = vm.checkPendingBitcoinDeposits();
    await reading.promise;
    if (switchWallet) store.activeWalletId = 'B';
    else {
      provider.getPendingDeposits = async () => [];
      await vm.checkPendingBitcoinDeposits();
    }
    old.resolve([{ txId: 'deposit', confirmed: true }]);
    await pending;
    assert.deepEqual(vm.pendingBitcoinDeposits, []);
  }
});

function depositSheetHarness(provider) {
  const options = evaluate('../../components/L1BitcoinReceive.vue').default;
  return { ...options.methods, claimQuoteRequest: 0, walletStore: { activeWalletId: 'A', ensureSparkConnected: async () => provider },
    bitcoinDepositsStore: { needsManual: () => true, reconsiderQuote() {} } };
}

test('a deposit poll can replace the row object without stranding its manual fee loader', async () => {
  const quote = deferred(), started = deferred();
  const vm = depositSheetHarness({ getClaimFeeQuote: () => { started.resolve(); return quote.promise; } });
  const deposit = { txId: 'deposit', confirmed: true };
  const pending = vm.openDepositSheet(deposit);
  await started.promise;
  vm.claimingDeposit = { ...deposit, confirmations: 4 };
  quote.resolve({ creditAmountSats: 1000 });
  await pending;
  assert.equal(vm.claimFeeQuote.creditAmountSats, 1000);
  assert.equal(vm.isLoadingQuote, false);
});

test('a late manual quote cannot overwrite a different deposit sheet or clear its loader', async () => {
  const old = deferred(), next = deferred(), started = deferred();
  const vm = depositSheetHarness({ getClaimFeeQuote: id => { if (id === 'old') started.resolve(); return id === 'old' ? old.promise : next.promise; } });
  const first = vm.openDepositSheet({ txId: 'old', confirmed: true });
  await started.promise;
  vm.cancelClaim();
  const second = vm.openDepositSheet({ txId: 'next', confirmed: true });
  old.resolve({ creditAmountSats: 1000 });
  await first;
  assert.equal(vm.claimingDeposit.txId, 'next');
  assert.equal(vm.claimFeeQuote, null);
  assert.equal(vm.isLoadingQuote, true);
  next.resolve({ creditAmountSats: 2000 });
  await second;
  assert.equal(vm.claimFeeQuote.creditAmountSats, 2000);
  assert.equal(vm.isLoadingQuote, false);
});
