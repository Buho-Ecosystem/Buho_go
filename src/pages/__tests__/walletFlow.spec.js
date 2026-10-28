import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as addresses from '../../utils/addressUtils.js';
import * as metadata from '../../utils/lnurlMetadata.js';
import * as lnurlPay from '../../utils/lnurlPay.js';
import * as lnurlWithdraw from '../../utils/lnurlWithdraw.js';
import * as payingWallets from '../../utils/payingWallets.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as errorOrigin from '../../utils/errorOrigin.js';
import * as branta from '../../utils/branta.js';
import * as payAgain from '../../utils/payAgain.js';
import * as recipientPayments from '../../services/recipientPayments.js';
import * as haptics from '../../utils/haptics.js';
import * as nwcErrors from '../../utils/nwcErrors.js';
import * as userErrors from '../../utils/userErrors.js';

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
  '../utils/lnurlWithdraw.js': lnurlWithdraw,
  '../utils/branta.js': branta,
  '../utils/amountFormatting.js': { formatAmount: n => `${n} sats` },
  '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ getConfig: () => null, checkAndExecute() {} }) },
  '../utils/fiatRates': { fiatRatesService: { convertSatsToFiat: async () => null } },
  '../utils/payAgain.js': payAgain,
  '../utils/haptics.js': haptics,
  '../utils/nwcErrors.js': nwcErrors,
    '../utils/userErrors.js': userErrors,
  '../services/paymentNotifications.js': { isInternalRoute: (route) => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') },
  ...dependencies,
}).default;

function balanceHarness() {
  const notices = [];
  const options = evaluate('../../stores/wallet.js', {
    pinia: { defineStore: (_, options) => options },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark' } },
    '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ checkAndExecute() {} }) },
    '../utils/claimedDeposits.js': { createClaimedDepositRegistry: () => ({}) },
    './notifications': { useNotificationsStore: () => ({ canNotifyPayments: true, notifyIfEnabled: async message => notices.push(message) }) },
    '../utils/amountFormatting.js': { formatAmount: n => `${n} sats` },
    '../boot/i18n': { i18n: { global: { t } } },
  }).useWalletStore;
  const a = { id: 'A', name: 'Wallet A' }, b = { id: 'B', name: 'Wallet B' };
  const store = { ...options.actions, activeWalletId: a.id, isActiveWalletSpark: true, wallets: [] };
  store.noticeIncomingPayment(a, 1000);
  store.noticeIncomingPayment(b, 100);
  const vm = { ...component().methods, walletStore: store, activeWallet: a, loadLastTransaction() {} };
  globalThis.localStorage = { setItem() {}, getItem: () => null };
  return { store, vm, a, b, notices };
}

test('confirmed withdrawal shows only the authoritative remaining balance', async () => {
  const refresh = deferred();
  const voucher = { id: 'v', maxSats: 25000 };
  const vm = { ...component().methods, $t: t, walletStore: {},
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

test('an LNURL server\'s refusal is marked as its own; our fallback is not', async () => {
  const fetchWith = (answers) => {
    let call = 0;
    const methods = component({
      '../utils/errorOrigin.js': errorOrigin,
      '../utils/lnurlPay.js': lnurlPay,
      '../utils/lnurlHttp.js': { lnurlGetJson: async () => ({ ok: true, data: answers[call++] }) },
      '../utils/lud23.js': { assertPaymentInput() {} },
    }).methods;
    return methods.fetchLNURLInvoice.call({ decodeLNURL: () => 'https://coffee.example/pay', walletStore: {} }, 'https://coffee.example/pay', 10).catch((error) => error);
  };
  const payRequest = { tag: 'payRequest', callback: 'https://coffee.example/cb', minSendable: 1000, maxSendable: 100000, metadata: '[]' };
  const refused = await fetchWith([payRequest, { status: 'ERROR', reason: 'Amount is above the maximum' }]);
  assert.deepEqual([refused.message, errorOrigin.isCounterpartyError(refused)], ['Amount is above the maximum', true]);
  const closed = await fetchWith([{ status: 'ERROR', reason: 'This shop is closed' }]);
  assert.equal(errorOrigin.isCounterpartyError(closed), true);
  const garbled = await fetchWith([{ tag: 'withdrawRequest', reason: 'not a refusal' }]);
  assert.deepEqual([garbled.message, errorOrigin.isCounterpartyError(garbled)], ['LNURL error', false]);
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
  const details = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) }, '../utils/payAgain.js': payAgain }).default;
  for (const status of ['pending', 'failed', 'completed']) {
    const target = details.computed.payAgainTarget.call({ transaction: { id: 'p', type: 'outgoing', status },
      metadataWalletId: 'A', metadataStore: { getMetadataForTransaction: (id, walletId) => (id === 'p' && walletId === 'A' ? { payLink: 'lnurl1service' } : null) } });
    assert.equal(target?.address ?? null, status === 'completed' ? 'lnurl1service' : null);
  }
});


test('an NWC receipt opened from History loads from the wallet store\'s wallet, also a few pages down', async () => {
  const details = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) }, '../utils/payAgain.js': payAgain }).default;
  const listed = Array.from({ length: 130 }, (_, i) => ({ payment_hash: `h${i}`, type: 'outgoing', amount: 100 + i, fees_paid: 1, settled_at: 1791300000 - i }));
  const asked = [];
  const nwc = { listTransactions: async ({ limit, offset }) => { asked.push(offset); return { transactions: listed.slice(offset, offset + limit) }; } };
  const vm = {
    ...details.methods,
    transaction: null,
    walletState: {},
    // The wallet as History names it: from the store, with nwcUrl and no nwcString.
    walletStore: { activeWallet: null, nwcConnection: async (id) => { assert.equal(id, 'main'); return nwc; } },
    normalizeForDetails: (tx) => tx,
  };
  const wallet = { id: 'main', type: 'nwc', nwcUrl: 'nostr+walletconnect://x' };
  await vm.fetchNWCTransaction('h3', wallet);
  assert.equal(vm.transaction.id, 'h3');
  assert.deepEqual(asked, [0]);

  asked.length = 0;
  await vm.fetchNWCTransaction('h120', wallet);
  assert.equal(vm.transaction.id, 'h120', 'found on the second page');
  assert.deepEqual(asked, [0, 100]);

  asked.length = 0;
  vm.transaction = null;
  await vm.fetchNWCTransaction('missing', wallet);
  assert.equal(vm.transaction, null);
  assert.deepEqual(asked, [0, 100], 'stops at the end of the list');

  await assert.rejects(vm.fetchNWCTransaction('h3', { id: 'spark', type: 'spark' }), /No active NWC wallet/);
  vm.walletStore.activeWallet = wallet;
  vm.transaction = null;
  await vm.fetchNWCTransaction('h3');
  assert.equal(vm.transaction.id, 'h3', 'no route wallet: the active one');
});

test('Spark wallets are never announced from a balance difference', () => {
  const { store, notices } = balanceHarness();
  const spark = { id: 'S', name: 'Business', type: 'spark' };
  store.noticeIncomingPayment(spark, 1000);
  store.noticeIncomingPayment(spark, 5000);
  assert.equal(notices.length, 0, 'receipts come from the payment-id ledger instead');
});

test('a service profile groups payments to both its identifier and original pay link', async () => {
  const profile = evaluate('../ContactProfilePage.vue', { '../services/recipientPayments.js': recipientPayments }).default;
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

test('contact history reloads when a wallet connects after the page opened, and per contact', () => {
  const profile = evaluate('../ContactProfilePage.vue', {}).default;
  const providers = {};
  const vm = { $route: { params: { id: 'anna' } }, walletStore: { wallets: [{ id: 'A' }, { id: 'B' }], providers } };
  const key = () => profile.computed.historyKey.call(vm);
  const cold = key();
  providers.A = { getTransactions: async () => [] };
  assert.notEqual(key(), cold, 'a wallet that connected changes what the history is drawn from');
  const connected = key();
  vm.$route.params.id = 'ben';
  assert.notEqual(key(), connected, 'another contact on the same page');

  let loads = 0;
  const page = { entry: { id: 'ben' }, history: [{ id: 'old' }], addressRevealed: true, loadHistory: () => { loads += 1; } };
  profile.watch.historyKey.call(page);
  profile.watch['$route.params.id'].call(page);
  assert.equal(loads, 1);
  assert.deepEqual([page.history, page.addressRevealed], [[], false], 'the last contact\'s payments are not shown for this one');
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


test('wallet redemption uses shared authorization before starting its existing receipt monitor', async () => {
  const { methods } = component();
  const calls = [];
  const request = { type: 'lnurl_withdraw', defaultDescription: 'Bolt Card' };
  const invoice = { payment_request: 'lnbc-wallet-invoice' };
  const vm = {
    ...methods, pendingPayment: request, canConfirmWithdraw: true, withdrawAmountSats: 100,
    createInvoiceForWithdraw: async (amount, description) => {
      assert.equal(amount, 100); assert.equal(description, 'Bolt Card'); return invoice;
    },
    $refs: { withdrawAuthorization: { submit: async (...args) => calls.push(args) } },
    startWithdrawPaymentMonitor: async (...args) => calls.push(args),
  };
  await vm.executeWithdraw();
  assert.deepEqual(calls, [[request, 'lnbc-wallet-invoice', 100], [invoice, 100]]);
  assert.equal(vm.lnurlWithdrawStatus, 'monitoring');
});

test('wallet PIN cancellation does not start receipt monitoring', async () => {
  const { methods } = component();
  let reset = false;
  const vm = {
    ...methods, pendingPayment: { type: 'lnurl_withdraw' }, canConfirmWithdraw: true, withdrawAmountSats: 100,
    createInvoiceForWithdraw: async () => ({ payment_request: 'lnbc-wallet-invoice' }),
    $refs: { withdrawAuthorization: { submit: async () => { throw new DOMException('cancelled', 'AbortError'); } } },
    startWithdrawPaymentMonitor: () => assert.fail('must not monitor a cancelled authorization'),
    resetWithdrawState: () => { reset = true; },
  };
  await vm.executeWithdraw();
  assert.equal(reset, true);
});


// ─────────────────────────────────────────────────────────────────────────
// "Pay with": the wallet that pays. Every payment is bound to ONE wallet id
// (the active wallet until a caller or the user chooses another); these
// tests drive the real Wallet.vue methods and computeds against fake
// providers and prove that id is what decides capability, balance, fee
// estimate, routing and the metadata writes - and that the active wallet is
// never switched along the way.
// ─────────────────────────────────────────────────────────────────────────

const PAY_WALLETS = [
  { id: 'biz', name: 'Business', type: 'spark' },
  { id: 'personal', name: 'Personal', type: 'spark' },
  { id: 'alby', name: 'Alby Hub', type: 'nwc', nwcUrl: 'nostr+walletconnect://alby' },
  { id: 'lnb', name: 'My LNbits', type: 'lnbits' },
  { id: 'ark', name: 'Arkade', type: 'arkade' },
];
const PAY_FUNDS = { biz: 50000, personal: 40000, alby: 30000, lnb: 20000, ark: 10000 };
const INVOICE_SATS = { 'inv-1000': 1000, 'inv-zero': 0, 'inv-big': 45000 };

function payingHarness({ wallets = PAY_WALLETS, active = 'biz', funds = PAY_FUNDS, cached = [], connectionStates = {}, bus = { emit() {} }, deps = {} } = {}) {
  const calls = [];     // provider-level traffic, in order: [walletId, method, ...details]
  const lightning = []; // NWC service traffic: [step, the wallet whose connection it uses (null: none), ...]
  const notices = [];
  const sent = {};      // what the success screen / metadata writes received
  class FakeLightningService {
    constructor(nwc = null) { this.wallet = nwc?.walletId ?? null; lightning.push(['new', this.wallet]); }
    async processPaymentInput(input) {
      lightning.push(['process', this.wallet, input]);
      return { type: 'lightning_address', address: input, minSendable: 1000, maxSendable: 1e9, minSats: 1, maxSats: 1e6,
        isFixedAmount: false, fixedAmountSats: null, amount: null, commentAllowed: 0, callback: 'https://cb.example/pay',
        description: `Payment to ${input}` };
    }
    async sendPayment(data, amount, comment) { lightning.push(['send', this.wallet, data, amount, comment]); return { preimage: 'ff', status: 'completed' }; }
  }
  const providerFor = id => ({
    payInvoice: async args => { calls.push([id, 'payInvoice', args.invoice]); return { id: `tx-${id}`, status: 'completed' }; },
    payLightningAddress: async (address, amount) => { calls.push([id, 'payLightningAddress', address, amount]); return { id: `tx-${id}`, status: 'completed' }; },
    transferToSparkAddress: async (address, amount) => { calls.push([id, 'transferToSparkAddress', address, amount]); return { id: `tx-${id}`, status: 'completed' }; },
    transferToArkadeAddress: async ({ arkadeAddress, amount }) => { calls.push([id, 'transferToArkadeAddress', arkadeAddress, amount]); return { id: `tx-${id}`, status: 'completed' }; },
    withdrawToL1: async args => { calls.push([id, 'withdrawToL1', args.destinationAddress, args.amountSats]); return { requestId: 'req-1' }; },
    waitForWithdrawalCompletion: async requestId => { calls.push([id, 'waitForWithdrawalCompletion', requestId]); return { isFailed: false, txId: 'tx' }; },
    getLightningSendFeeEstimate: async () => { calls.push([id, 'getLightningSendFeeEstimate']); return { estimatedFeeSats: 7 }; },
  });
  const store = {
    nwcLimitFor: () => null,
    // The wallet's one NWC connection (#395), named by its wallet.
    nwcConnection: async (id) => ({ walletId: id }),
    wallets, activeWalletId: active, connectionStates, balances: funds,
    balanceStates: Object.fromEntries(Object.entries(funds).map(([id, value]) => [id, { value }])),
    get activeWallet() { return this.wallets.find(w => w.id === this.activeWalletId) || null; },
    get activeWalletType() { return this.activeWallet?.type ?? null; },
    // `cached`: these balances are saved or older figures, not verified just now.
    getDisplayBalance: id => ({ known: id in funds, isCached: cached.includes(id), refreshing: false }),
    getSparkAddress: id => `spark1${id}`,
    ensureSparkConnected: async (id = null) => { calls.push([id, 'ensureSparkConnected']); return providerFor(id || store.activeWalletId); },
    ensureLNBitsConnected: async id => { calls.push([id, 'ensureLNBitsConnected']); return providerFor(id || store.activeWalletId); },
    ensureArkadeConnected: async id => { calls.push([id, 'ensureArkadeConnected']); return providerFor(id || store.activeWalletId); },
    getProvider: id => providerFor(id),
    getActiveProvider: () => providerFor(store.activeWalletId),
    reconcileSpark: async (ids, reason) => { calls.push(['*', 'reconcileSpark', ids, reason]); },
    refreshBalance: async id => { calls.push([id, 'refreshBalance']); },
    switchActiveWallet: async () => assert.fail('"Pay with" must never switch the active wallet'),
    setActiveWallet: async () => assert.fail('"Pay with" must never switch the active wallet'),
    showPaymentError: error => assert.fail(`unexpected payment error: ${error.message}`),
  };
  const options = component({
    '../utils/payingWallets.js': payingWallets,
    '../utils/walletCapabilities.js': walletCapabilities,
    '../utils/eventBus.js': { EventBus: bus, PAYMENT_SENT: 'payment:sent' },
    '../utils/lightning.js': { LightningPaymentService: FakeLightningService },
    '../utils/lightningInvoice.js': { parseLightningInvoice: input => ({ invoice: input, amount: INVOICE_SATS[input] ?? 0, description: 'memo' }) },
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
    '../utils/successAction.js': { resolveSuccessAction: async () => null },
    '../services/nostrRecipient': { npubFromLightningAddress: () => null },
    '../services/lnAddressServices': { matchLnAddressService: () => null },
    '../utils/sparkPayment.js': { decodeSparkDestination: value => ({ kind: 'address', receiverAddress: value }) },
    '../utils/lud4.js': { looksLikeLud04: () => false },
    '../utils/bip21.js': { parseBip21: () => null, bip21AmountToSats: () => 0 },
    '../utils/merchantQR.js': { SA_RETAIL_SOURCE: 'sa_retail', parseZARFromMetadata: () => null },
    '../utils/l1WithdrawErrors.js': { describeL1WithdrawError: error => ({ title: 'error', description: error.message }) },
    ...deps,
  });
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const dispatched = [];
  const vm = {
    ...options.methods, ...options.data.call({}),
    $t: t, $refs: {}, walletStore: store,
    $q: { dark: { isActive: false }, notify: notice => notices.push(notice) },
    addressBookStore: { findContactByAddress: () => null, findContactByPubkey: () => null, getEntryById: id => (id === 'c1' ? { id: 'c1' } : undefined) },
    transactionMetadataStore: { enqueuePendingContactLink: async link => { (sent.links ||= []).push(link); } },
    serviceImagesStore: { get: () => '' },
    runBrantaVerification() {}, runNostrRecipientEnrichment() {}, rememberServiceImage() {},
    openSendSuccess: value => { sent.success = value; },
    updateWalletBalance: async () => { calls.push(['*', 'updateWalletBalance']); },
    loadLastTransaction() {},
    fetchLightningAddressInfo: async () => ({ minSendable: 1000, maxSendable: 1e9, minSats: 1, maxSats: 1e6, isFixedAmount: false,
      fixedAmountSats: null, commentAllowed: 0, description: 'memo' }),
    fetchLightningAddressInvoice: async () => ({ pr: 'lnbc-resolved', successAction: null, verify: null }),
    fetchLNURLInvoice: async () => ({ pr: 'lnbc-resolved', successAction: null, verify: null, payLink: null, serviceMeta: null }),
  };
  for (const [name, getter] of Object.entries(options.computed)) {
    Object.defineProperty(vm, name, { get: () => getter.call(vm), configurable: true });
  }
  return { vm, store, options, calls, lightning, notices, sent, dispatched, providerFor };
}

const lnAddressPayment = extra => ({
  type: 'lightning_address', data: 'bob@example.com', lightningAddress: 'bob@example.com',
  minSendable: 1000, maxSendable: 1e9, minSats: 1, maxSats: 1e6, isFixedAmount: false, fixedAmountSats: null, commentAllowed: 0,
  ...extra,
});
const invoicePayment = (invoice = 'inv-1000') => ({
  type: 'lightning_invoice', data: invoice, invoice, amount: INVOICE_SATS[invoice], description: 'memo',
});
const quietly = async fn => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};
const callsTo = (calls, method) => calls.filter(call => call[1] === method);

test('Arkade onchain requires a quote for this wallet, destination and recipient amount', async () => {
  const { vm, store, options } = payingHarness({ active: 'ark' });
  vm.pendingPayment = { type: 'bitcoin_address', bitcoinAddress: 'bc1-destination', fixedAmountSats: 2100 };
  store.ensureArkadeConnected = async () => ({ getBitcoinSendFeeEstimate: async ({ amount }) => ({ amount, fee: 130, total: amount + 130 }) });
  assert.equal(vm.sendSheetCommitGate, false);
  await vm.updateFeeEstimate();
  assert.equal(vm.sendSheetCommitGate, true);
  assert.equal(vm.estimatedFee, 130);
  assert.equal(vm.currentArkadeFeeQuote.total, 2230);
  vm.sendSheetAmountSats = 3000;
  assert.equal(vm.sendSheetCommitGate, false, 'changing the amount invalidates the old quote immediately');
  assert.equal(options.watch.sendSheetAmountSats, 'updateFeeEstimate');
  await vm.updateFeeEstimate();
  assert.equal(vm.sendSheetCommitGate, true);
  vm.pendingPayment.bitcoinAddress = 'bc1-another';
  assert.equal(vm.sendSheetCommitGate, false);
  vm.sendingWalletId = 'personal';
  assert.equal(vm.currentArkadeFeeQuote, null);
});

test('an Arkade quote failure explains why sending is disabled; late quotes cannot overwrite a new amount', async () => {
  const { vm, store } = payingHarness({ active: 'ark' });
  vm.pendingPayment = { type: 'bitcoin_address', bitcoinAddress: 'bc1-destination', fixedAmountSats: 2100 };
  store.ensureArkadeConnected = async () => ({ getBitcoinSendFeeEstimate: async () => { throw new Error('Network unavailable'); } });
  await vm.updateFeeEstimate();
  assert.equal(vm.sendSheetCommitGate, false);
  assert.ok(vm.connectionNotice);
  const old = deferred();
  store.ensureArkadeConnected = async () => ({ getBitcoinSendFeeEstimate: async ({ amount }) => amount === 2100 ? old.promise : { amount, fee: 150, total: amount + 150 } });
  const first = vm.updateFeeEstimate();
  vm.sendSheetAmountSats = 3000;
  await vm.updateFeeEstimate();
  old.resolve({ amount: 2100, fee: 1, total: 2101 });
  await first;
  assert.equal(vm.estimatedFee, 150);
  assert.equal(vm.currentArkadeFeeQuote.amount, 3000);
});

test('Arkade sends hold the approved fee across awaits and reprice a refused send', async () => {
  const { vm, store } = payingHarness({ active: 'ark' });
  vm.pendingPayment = { type: 'bitcoin_address', bitcoinAddress: 'bc1-destination', fixedAmountSats: 2100 };
  vm.arkadeFeeQuote = { walletId: 'ark', address: 'bc1-destination', amount: 2100, fee: 130, total: 2230 };
  const connecting = deferred();
  store.ensureArkadeConnected = () => connecting.promise;
  const attempt = vm.sendArkadePayment(2100, null, null, 'ark');
  vm.arkadeFeeQuote = null; // a queued UI watcher refreshed its state
  let repriced = 0;
  vm.updateFeeEstimate = async () => { repriced++; };
  connecting.resolve({ offboardToBitcoin: async args => {
    assert.equal(args.maxFee, 130);
    assert.equal(args.amount, 2100);
    throw Object.assign(new Error('fee changed'), { code: 'ARKADE_OFFBOARD_FEE_CHANGED' });
  } });
  await assert.rejects(attempt, { code: 'ARKADE_OFFBOARD_FEE_CHANGED' });
  assert.equal(repriced, 1);
});

test('Pay with: an untouched payment is paid by the active wallet, whatever its type', async () => {
  for (const active of ['biz', 'personal', 'alby', 'lnb']) {
    const { vm, store } = payingHarness({ active });
    await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
    assert.equal(vm.showSendSheet, true);
    assert.equal(vm.sendingWalletId, active, `${active} pays by default`);
    assert.equal(vm.getSendingWallet().id, active);
    assert.equal(store.activeWalletId, active);
    assert.equal(vm.paymentSheetWalletCanPay, true);
    assert.equal('sendingWalletId' in vm.pendingPayment, false, 'who pays is not part of what is paid');
  }
});

test('Pay with: when the active wallet cannot pay the rail, the first wallet that can is the default', () => {
  const lightningWithArkade = payingHarness({ active: 'ark' });
  assert.equal(lightningWithArkade.vm.chooseSendingWalletId('lightning_invoice'), 'biz');
  const sparkFromNwc = payingHarness({ active: 'alby' });
  assert.equal(sparkFromNwc.vm.chooseSendingWalletId('spark_address'), 'biz');
  const arkadeAddress = payingHarness({ active: 'biz' });
  assert.equal(arkadeAddress.vm.chooseSendingWalletId('arkade_address'), 'ark');
  const onChain = payingHarness({ active: 'lnb' });
  assert.equal(onChain.vm.chooseSendingWalletId('bitcoin_address'), 'biz');
  // Nobody can: the active wallet stays chosen so the sheet can say why.
  const nobody = payingHarness({ wallets: PAY_WALLETS.filter(w => w.type !== 'spark' && w.type !== 'arkade'), active: 'alby' });
  assert.equal(nobody.vm.chooseSendingWalletId('bitcoin_address'), 'alby');
});

test('Pay with: the default pick passes over a wallet that cannot cover a known amount', async () => {
  const funds = { ...PAY_FUNDS, biz: 500 };
  const { vm, store } = payingHarness({ funds });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
  assert.equal(vm.sendingWalletId, 'personal');
  assert.equal(store.activeWalletId, 'biz', 'the active wallet is untouched');
  // An amountless invoice has nothing to compare yet: the active wallet stays.
  const amountless = payingHarness({ funds });
  await amountless.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-zero' });
  assert.equal(amountless.vm.sendingWalletId, 'biz');
});

test('Pay with: a caller can preselect the wallet; an unknown id is ignored', async () => {
  const picked = payingHarness();
  await picked.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'alby' });
  assert.equal(picked.vm.sendingWalletId, 'alby');
  assert.equal(picked.store.activeWalletId, 'biz');
  assert.equal('sendingWalletId' in picked.vm.pendingPayment, false);

  const unknown = payingHarness();
  await unknown.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'gone' });
  assert.equal(unknown.vm.sendingWalletId, 'biz');

  // A preselected wallet that cannot pay stays selected - and blocks, with the shared words.
  const blocked = payingHarness();
  await blocked.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'ark' });
  assert.equal(blocked.vm.sendingWalletId, 'ark');
  assert.equal(blocked.vm.paymentSheetWalletCanPay, false);
  assert.equal(blocked.vm.paymentSheetWalletHint, 'Lightning is temporarily unavailable on Arkade - switch to another wallet');
});

test('Pay with: the preselection survives the Nostr and NIP-05 re-dispatch', async () => {
  const { vm } = payingHarness();
  vm.resolveNostrTarget = async () => ({ kind: 'lightning_address', address: 'carol@example.com', pubkey: 'pk', npub: 'npub1x', profile: {}, profileEvent: {}, relayHints: [] });
  await vm.onPaymentDetected({ type: 'nostr_identifier', data: 'npub1carol', sendingWalletId: 'lnb' });
  assert.equal(vm.showSendSheet, true);
  assert.equal(vm.pendingPayment.lightningAddress, 'carol@example.com');
  assert.equal(vm.sendingWalletId, 'lnb');
  assert.equal(vm.pendingPayment.nostrPubkey, 'pk');
});

test('Pay with: a redeem has no paying wallet', async () => {
  const { vm } = payingHarness();
  vm.sendingWalletId = 'alby';
  vm.fetchLNURLInfo = async () => ({ lnurlType: 'withdrawRequest', minSats: 10, maxSats: 100, isFixedAmount: false });
  vm.withdrawVouchersStore = { track: async () => null };
  vm.resetWithdrawState = () => {};
  await vm.onPaymentDetected({ type: 'lnurl', data: 'lnurl1withdraw' });
  assert.equal(vm.showWithdrawSheet, true);
  assert.equal(vm.sendingWalletId, null);
  assert.deepEqual(vm.payingWalletEntries, []);
});

test('Pay with: a contact is payable from another wallet when the active one cannot pay it', () => {
  const { vm, notices } = payingHarness({ active: 'ark' });
  const dispatched = [];
  vm.onPaymentDetected = async payload => { dispatched.push(payload); };
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', name: 'Bob' });
  assert.deepEqual(notices, []);
  // No wallet is forced: the default pick runs once the amount is known (and finds Business).
  assert.deepEqual(dispatched, [{ type: 'lightning_address', data: 'bob@example.com', contactName: 'Bob', paymentOnly: true, sendingWalletId: null }]);
});

test('Pay with: a contact payment carries the caller\'s wallet and is gated on THAT wallet', () => {
  const { vm, notices } = payingHarness();
  const dispatched = [];
  vm.onPaymentDetected = async payload => { dispatched.push(payload); };
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', name: 'Bob', sendingWalletId: 'lnb' });
  assert.equal(dispatched[0].sendingWalletId, 'lnb');
  // The chosen wallet cannot pay this rail: the old warning, no payment started.
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', name: 'Bob', sendingWalletId: 'ark' });
  assert.equal(dispatched.length, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, 'Cannot pay this contact');
  assert.equal(notices[0].caption, 'Lightning is temporarily unavailable on Arkade - switch to another wallet');
  // An unknown id is dropped: the default pick decides instead of failing.
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', sendingWalletId: 'gone' });
  assert.equal(dispatched[1].sendingWalletId, null);
  // A Spark contact from an NWC-active user is payable from a Spark wallet.
  const nwcActive = payingHarness({ active: 'alby' });
  nwcActive.vm.onPaymentDetected = async payload => { nwcActive.dispatched.push(payload); };
  nwcActive.vm.payContactDestination({ address: 'spark1abc', addressType: 'spark', name: 'Sam' });
  assert.equal(nwcActive.dispatched[0].type, 'spark_address');
  assert.equal(nwcActive.dispatched[0].sendingWalletId, null);
});

test('Pay with: a contact nobody can pay keeps the original warning', () => {
  const { vm, notices } = payingHarness({ wallets: [PAY_WALLETS[4]], active: 'ark', funds: { ark: 5 } });
  vm.onPaymentDetected = async () => assert.fail('nothing can pay this');
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', name: 'Bob' });
  assert.equal(notices[0].message, 'Cannot pay this contact');
  assert.equal(notices[0].caption, 'Lightning is temporarily unavailable on Arkade - switch to another wallet');
});

test('Pay with: the route query hands over the wallet', async () => {
  for (const [query, expected] of [
    [{ action: 'pay_contact', address: 'bob@example.com', addressType: 'lightning', walletId: 'alby' }, 'alby'],
    [{ action: 'pay_contact', address: 'bob@example.com', walletId: ['alby', 'lnb'] }, null],
    [{ action: 'pay_contact', address: 'bob@example.com' }, null],
    [{ action: 'bitcoin_withdrawal', address: 'bc1qxyz', walletId: 'alby' }, null],
  ]) {
    const { vm } = payingHarness();
    const handed = [];
    let replaced;
    Object.assign(vm, { $route: { query }, $router: { replace: value => { replaced = value; } }, _walletsReady: Promise.resolve(),
      payContactDestination: value => handed.push(value) });
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(handed.length, 1);
    assert.equal(handed[0].sendingWalletId, expected, JSON.stringify(query));
    assert.deepEqual(replaced, { query: {} });
  }
});

test('a handed-over payment opens once the wallets are ready, without waiting for the page sync', async () => {
  const { vm } = payingHarness();
  const handed = [];
  let ready;
  Object.assign(vm, {
    $route: { query: { action: 'pay_contact', address: 'lnbc1invoice', addressType: 'invoice' } },
    $router: { replace() {} },
    // The page's own start-up (fresh Spark sync, rates, history) can stall for a long time.
    _walletInitPromise: new Promise(() => {}),
    _walletsReady: new Promise((resolve) => { ready = resolve; }),
    payContactDestination: (value) => handed.push(value),
  });
  vm.handlePaymentFromQuery();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handed.length, 0, 'not before the wallets are loaded and connected');
  ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handed.length, 1, 'the stalled page start-up does not hold it back');
});

test('a handed-over payment returns to the screen that handed it over, when cancelled or done', async () => {
  for (const [returnTo, expected] of [['/address-book/c1/chat', '/address-book/c1/chat'], ['https://evil.example', null], ['//evil.example', null]]) {
    const { vm } = payingHarness();
    const replaced = [];
    Object.assign(vm, {
      $route: { query: { action: 'pay_contact', address: 'bob@example.com', returnTo } },
      $router: { replace: (value) => replaced.push(value), options: { history: { state: { back: null } } } },
      _walletsReady: Promise.resolve(),
      payContactDestination: () => {},
      cancelBrantaLookup: () => {},
    });
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(vm.payReturnTo, expected, returnTo);
    vm.onSendSheetCancel();
    assert.deepEqual(replaced.slice(1), expected ? [expected] : [], 'only an in-app path is followed');
    assert.equal(vm.payReturnTo, null, 'used once');
  }
});

test('a handed-over payment steps back to the screen right behind it, so Back is not spent on a copy', async () => {
  for (const returnTo of ['/wallet', '/address-book/c1/chat']) {
    const { vm } = payingHarness();
    const replaced = [];
    let backs = 0;
    Object.assign(vm, {
      $route: { query: { action: 'pay_contact', address: 'bob@example.com', returnTo } },
      // The hand-over pushed the wallet page on top of `returnTo`.
      $router: { replace: (value) => replaced.push(value), back: () => { backs += 1; }, options: { history: { state: { back: returnTo } } } },
      _walletsReady: Promise.resolve(),
      payContactDestination: () => {},
      cancelBrantaLookup: () => {},
    });
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    vm.onSendSheetCancel();
    assert.equal(backs, 1, returnTo);
    assert.deepEqual(replaced, [{ query: {} }], 'no second entry for the same screen');
  }
});

test('Pay with: the payload takes the shape of the paying wallet\'s backend', async () => {
  // Paid by an NWC wallet: resolved for NWC, and reading the address needs no connection.
  const nwc = payingHarness({ active: 'biz' });
  await nwc.vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com', sendingWalletId: 'alby' });
  assert.deepEqual(nwc.lightning, [['new', null], ['process', null, 'bob@example.com']]);
  assert.equal(nwc.vm.pendingPayment.address, 'bob@example.com');
  assert.equal(nwc.vm.sendingWalletId, 'alby');

  // Paid by a Spark wallet while an NWC wallet is active: no NWC service is touched.
  const spark = payingHarness({ active: 'alby' });
  await spark.vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com', sendingWalletId: 'personal' });
  assert.deepEqual(spark.lightning, []);
  assert.equal(spark.vm.pendingPayment.minSats, 1);
  assert.equal(spark.vm.sendingWalletId, 'personal');
});

test('Pay with: choosing another wallet moves the verdict, the hint and the commit gate with it', async () => {
  const { vm, store } = payingHarness({ funds: { ...PAY_FUNDS, personal: 100 } });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-zero' });
  vm.paymentAmount = '5000';
  vm.sendSheetAmountSats = 5000;
  assert.equal(vm.sendingWalletId, 'biz');
  assert.equal(vm.canConfirmPayment, true);
  assert.deepEqual(vm.payingWalletEntries.map(w => w.id), ['biz', 'personal', 'alby', 'lnb', 'ark']);
  assert.deepEqual(vm.payingWalletEntries.map(w => w.reason), [null, 'insufficient-balance', null, null, 'unsupported-destination']);

  // Unusable rows are refused: the selection does not move.
  vm.onSendingWalletChange('personal');
  vm.onSendingWalletChange('ark');
  vm.onSendingWalletChange('gone');
  assert.equal(vm.sendingWalletId, 'biz');

  vm.l1Fee = { ready: true };
  vm.onSendingWalletChange('alby');
  assert.equal(vm.sendingWalletId, 'alby');
  assert.equal(vm.l1Fee, null, 'a quote priced for another wallet is dropped');
  assert.equal(vm.canConfirmPayment, true);
  assert.equal(store.activeWalletId, 'biz', 'the active wallet is untouched');
  assert.equal(vm.sendingWalletBalance, 30000, 'the sheet shows the paying wallet\'s balance');
  assert.equal(vm.payerWalletId, 'alby');

  // A larger amount outgrows the selected wallet: the gate closes, the hint names it.
  vm.sendSheetAmountSats = 45000;
  assert.equal(vm.paymentSheetWalletCanPay, false);
  assert.equal(vm.paymentSheetWalletHint, 'Not enough balance in Alby Hub. Choose another wallet or send less.');
  assert.equal(vm.canConfirmPayment, false);

  // Mid-send the choice is frozen.
  vm.sendSheetAmountSats = 5000;
  vm.isSendingPayment = true;
  vm.onSendingWalletChange('lnb');
  assert.equal(vm.sendingWalletId, 'alby');
});

test('Pay with: an unusable selection blocks the commit, in the sheet and in the pipeline', async () => {
  const { vm, calls, lightning } = payingHarness();
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'ark' });
  assert.equal(vm.paymentSheetWalletCanPay, false);
  assert.equal(vm.canConfirmPayment, false);
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(calls, [], 'no provider was asked to pay');
  assert.deepEqual(lightning, []);
  assert.equal(vm.isSendingPayment, false);

  // A wallet whose last connection failed is not blocked: paying reconnects it, as before Pay with.
  const down = payingHarness({ connectionStates: { alby: { connected: false, error: 'relay unreachable' } } });
  await down.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'alby' });
  assert.equal(down.vm.paymentSheetWalletCanPay, true);
  assert.equal(down.vm.paymentSheetWalletHint, '');
});

test('Pay with: a single wallet that holds too little says so before the slide, like several do', async () => {
  const lone = payingHarness({ wallets: [PAY_WALLETS[2]], active: 'alby', funds: { alby: 3 } });
  await lone.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-big' });
  assert.equal(lone.vm.sendingWalletId, 'alby');
  assert.equal(lone.vm.payingWalletEntries.length, 1);
  assert.equal(lone.vm.paymentSheetWalletCanPay, false);
  assert.equal(lone.vm.canConfirmPayment, false);
  assert.equal(lone.vm.paymentSheetWalletHint, 'Not enough balance in Alby Hub.', 'no other wallet to suggest');
  await quietly(() => lone.vm.confirmPayment());
  assert.deepEqual(lone.lightning.filter(([step]) => step === 'send'), [], 'nothing was sent');

  // A saved or older figure may be behind money that arrived meanwhile: it is
  // re-read when the payment opens and refuses nothing until then.
  const behind = payingHarness({ wallets: [PAY_WALLETS[2]], active: 'alby', funds: { alby: 3 }, cached: ['alby'] });
  await behind.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-big' });
  assert.equal(behind.vm.paymentSheetWalletCanPay, true);
  assert.equal(behind.vm.paymentSheetWalletHint, '');
  // ...which the opening payment starts, for a single wallet too.
  behind.options.watch['payingWalletEntries.length'].call(behind.vm, 1, 0);
  assert.deepEqual(behind.calls.filter(([, step]) => step === 'refreshBalance'), [['alby', 'refreshBalance']]);

  const arkadeOnly = payingHarness({ wallets: [PAY_WALLETS[4]], active: 'ark' });
  await arkadeOnly.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
  assert.equal(arkadeOnly.vm.paymentSheetWalletCanPay, false, 'the rail gate is unchanged');
  assert.equal(arkadeOnly.vm.paymentSheetWalletHint, 'Lightning is temporarily unavailable on Arkade - switch to another wallet');
});

test('Pay with: zero-fee rails reserve nothing, so a whole balance can be sent', async () => {
  const funds = { ...PAY_FUNDS, biz: 1000 };
  const { vm } = payingHarness({ funds });
  await vm.onPaymentDetected({ type: 'spark_address', data: 'spark1friend', sendingWalletId: 'biz' });
  vm.sendSheetAmountSats = 1000;
  assert.equal(vm.paymentSheetWalletCanPay, true, 'Spark to Spark is free: 1000 of 1000 is fine');
  vm.sendSheetAmountSats = 1001;
  assert.equal(vm.paymentSheetWalletCanPay, false);
  // A known Lightning fee is reserved; an unknown one is not guessed.
  const ln = payingHarness({ funds });
  await ln.vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com', sendingWalletId: 'biz' });
  ln.vm.sendSheetAmountSats = 1000;
  assert.equal(ln.vm.paymentSheetWalletCanPay, true, 'no fee is known yet');
  ln.vm.estimatedFee = 7;
  assert.equal(ln.vm.paymentSheetWalletCanPay, false, '1000 + 7 > 1000');
});

test('Pay with: a guessed Spark fee is shown but never held back from the balance', async () => {
  const funds = { ...PAY_FUNDS, biz: 1000 };
  for (const [isEstimated, canPay] of [[true, true], [false, false]]) {
    const { vm, store } = payingHarness({ funds });
    store.ensureSparkConnected = async () => ({ getLightningSendFeeEstimate: async () => ({ estimatedFeeSats: 7, isEstimated }) });
    vm.pendingPayment = invoicePayment();
    vm.sendingWalletId = 'biz';
    await vm.updateFeeEstimate();
    assert.equal(vm.estimatedFee, 7, 'the sheet still shows it');
    assert.equal(vm.paymentSheetWalletCanPay, canPay, isEstimated ? 'a guess refuses nothing' : 'a route quote counts');
  }
});

test('Pay with: each wallet type pays through ITS OWN provider; the active wallet is never switched', async () => {
  const cases = [
    ['personal', invoicePayment(), 'ensureSparkConnected', 'payInvoice'],
    ['lnb', lnAddressPayment(), 'ensureLNBitsConnected', 'payInvoice'],
    ['ark', { type: 'arkade_address', data: 'ark1xyz', arkadeAddress: 'ark1xyz' }, 'ensureArkadeConnected', 'transferToArkadeAddress'],
  ];
  for (const [payer, payment, ensure, method] of cases) {
    const { vm, store, calls, sent } = payingHarness({ active: 'biz' });
    Object.assign(vm, { pendingPayment: payment, sendingWalletId: payer, paymentAmount: '2500', sendSheetAmountSats: 2500 });
    await quietly(() => vm.confirmPayment());
    assert.deepEqual(callsTo(calls, ensure), [[payer, ensure]], `${payer} is connected on demand`);
    assert.equal(callsTo(calls, method).length, 1);
    assert.equal(callsTo(calls, method)[0][0], payer, `${method} ran on ${payer}'s provider`);
    for (const other of ['biz', 'personal', 'alby', 'lnb', 'ark'].filter(id => id !== payer)) {
      assert.equal(calls.some(call => call[0] === other && call[1] !== 'ensureSparkConnected'), false, `${other} was not involved`);
    }
    assert.equal(store.activeWalletId, 'biz', 'still the active wallet');
    assert.equal(vm.sendingWalletId, null, 'the payment is over; the next one starts fresh');
    assert.equal(vm.pendingPayment, null);
    // The post-payment refresh targets the wallet that paid, and leaves the home screen alone.
    assert.deepEqual(callsTo(calls, 'updateWalletBalance'), [], `home refresh skipped for ${payer}`);
    assert.equal(callsTo(calls, 'reconcileSpark').length + callsTo(calls, 'refreshBalance').length, 1);
    assert.equal(sent.success.amount, payment.amount ?? 2500);
  }
});

test('Pay with: a Spark wallet\'s balance is refreshed through the Spark lifecycle, the others through the store', async () => {
  const spark = payingHarness();
  Object.assign(spark.vm, { pendingPayment: invoicePayment(), sendingWalletId: 'personal' });
  await quietly(() => spark.vm.confirmPayment());
  assert.deepEqual(callsTo(spark.calls, 'reconcileSpark'), [['*', 'reconcileSpark', ['personal'], 'user']]);
  const lnbits = payingHarness();
  Object.assign(lnbits.vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500' });
  await quietly(() => lnbits.vm.confirmPayment());
  assert.deepEqual(callsTo(lnbits.calls, 'refreshBalance'), [['lnb', 'refreshBalance']]);
});

test('Pay with: the NWC wallet that was chosen pays, over its own connection', async () => {
  // The payment was resolved for a Spark wallet (the default), then the user picked the NWC wallet.
  const { vm, store, lightning, calls } = payingHarness({ active: 'biz' });
  await vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com' });
  assert.equal(vm.pendingPayment.address, undefined, 'a Spark-shaped payload');
  vm.onSendingWalletChange('alby');
  vm.paymentAmount = '2500';
  vm.sendSheetAmountSats = 2500;
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(lightning.map(entry => entry.slice(0, 2)), [['new', 'alby'], ['send', 'alby']]);
  const [, , data, amount] = lightning[1];
  assert.equal(data.type, 'lightning_address');
  assert.equal(data.address, 'bob@example.com', 'bridged to the shape the NWC service reads');
  assert.equal(amount, 2500);
  assert.deepEqual(calls.filter(call => call[1] !== 'updateWalletBalance' && call[1] !== 'refreshBalance'), []);
  assert.equal(store.activeWalletId, 'biz');
});

test('Pay with: a payment resolved for NWC reaches the NWC service untouched', async () => {
  const { vm, lightning } = payingHarness({ active: 'alby' });
  await vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com' });
  const resolved = vm.pendingPayment;
  vm.paymentAmount = '2500';
  vm.sendSheetAmountSats = 2500;
  await quietly(() => vm.confirmPayment());
  assert.equal(lightning.find(entry => entry[0] === 'send')[2], resolved, 'same object, no bridging');
});

test('Pay with: an untouched payment goes through the active wallet exactly as before', async () => {
  const { vm, calls, store } = payingHarness({ active: 'personal' });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(callsTo(calls, 'ensureSparkConnected'), [['personal', 'ensureSparkConnected']]);
  assert.equal(callsTo(calls, 'payInvoice')[0][0], 'personal');
  assert.deepEqual(callsTo(calls, 'updateWalletBalance'), [['*', 'updateWalletBalance']], 'full home refresh for the active wallet');
  assert.equal(callsTo(calls, 'reconcileSpark').length, 0);
  assert.equal(store.activeWalletId, 'personal');
});

test('Pay with: transaction metadata is written against the wallet that paid', async () => {
  const { vm, sent } = payingHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500' });
  await quietly(() => vm.confirmPayment());
  assert.equal(sent.links.length, 1);
  assert.equal(sent.links[0].walletId, 'lnb');
  assert.equal(sent.links[0].recipientAddress, 'bob@example.com');
  // The save-contact dialog that follows queues its link on the same wallet, not whichever is active by then.
  assert.equal(vm.saveContactData.walletId, 'lnb');
  vm.addressBookStore.addEntry = async entry => ({ id: 'contact-1', ...entry });
  vm.saveContactData.name = 'Bob';
  vm.saveContactData.amountSats = 2500;
  await vm.saveRecipientAsContact();
  assert.equal(sent.links.length, 2);
  assert.equal(sent.links[1].walletId, 'lnb');
  assert.equal(sent.links[1].contactId, 'contact-1');
  // A dialog staged without a wallet falls back to the active one, as it always did.
  const legacy = payingHarness({ active: 'biz' });
  Object.assign(legacy.vm, { saveContactData: { address: 'x@y.z', addressType: 'lightning', name: 'X', notes: '', amountSats: 5, nostrIdentity: null } });
  legacy.vm.addressBookStore.addEntry = async entry => ({ id: 'c', ...entry });
  await legacy.vm.saveRecipientAsContact();
  assert.equal(legacy.sent.links[0].walletId, 'biz');
});

test('Pay again: a send records what the user chose to pay, with the ids its payment will carry', async () => {
  const { vm, sent } = payingHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendPayout: { code: 'KES', amount: 1645 } });
  await quietly(() => vm.confirmPayment());
  const { proof, ...record } = sent.links[0].payAgain;
  assert.deepEqual(record, { address: 'bob@example.com', addressType: 'lightning', amountSats: 2500, payout: { code: 'KES', amount: 1645 } });
  assert.ok(proof.includes('tx-lnb'));

  // An NWC wallet pays the sat estimate, so no amount in the recipient's currency is kept.
  const nwc = payingHarness({ active: 'alby' });
  Object.assign(nwc.vm, { pendingPayment: lnAddressPayment(), paymentAmount: '2500', sendPayout: { code: 'KES', amount: 1645 } });
  await quietly(() => nwc.vm.confirmPayment());
  assert.equal(nwc.sent.links[0].payAgain.payout, null);
});

test('Pay again: a single order or a Nostr profile is never recorded; a Bitcoin address is', () => {
  const { vm } = payingHarness();
  const record = (pendingPayment, extra = {}) => {
    vm.pendingPayment = pendingPayment;
    return vm.payAgainRecordFor({ result: { id: 'p1' }, amount: 1000, payLink: null, walletType: 'spark', isNostrSend: false, ...extra });
  };
  assert.equal(record({ sparkAddress: 'spark1shop', bip21: { address: 'bc1q' } }), null, 'a unified code names one order');
  assert.equal(record({ lightningAddress: 'till@example.com', merchant: { name: 'Till' } }), null, 'a till code');
  assert.equal(record({ lightningAddress: 'till@example.com', source: 'sa_retail' }), null, 'a till code');
  assert.equal(record({ sparkAddress: 'spark1shop', sparkInvoice: 'spark1invoice' }), null, 'a Spark invoice');
  assert.equal(record({ lightningAddress: 'bob@example.com' }, { isNostrSend: true }), null, 'a profile address can change');
  assert.equal(record({ invoice: 'lnbc1', type: 'lightning_invoice' }), null, 'an invoice');
  assert.equal(record({ bitcoinAddress: 'bc1q' }).addressType, 'bitcoin', 'an on-chain address');
  assert.equal(record({ bitcoinAddress: 'bc1q', bip21: { address: 'bc1q' } }).address, 'bc1q', 'a code that only carries the address');
  assert.equal(record({ bitcoinAddress: 'bc1q', bip21: { address: 'bc1q', amount: '0.001' } }), null, 'a code with an amount is one order');
  const brantaReceipt = vm.brantaReceipt;
  vm.brantaReceipt = () => ({ name: 'Shop' });
  assert.equal(record({ bitcoinAddress: 'bc1q' }), null, 'a verified business is a checkout');
  vm.brantaReceipt = brantaReceipt;
  assert.equal(record({ sparkAddress: 'spark1sam' }).addressType, 'spark');
  assert.equal(record({ arkadeAddress: 'ark1sam' }).addressType, 'arkade');
  assert.deepEqual(record({ lnurl: 'lnurl1x' }, { payLink: 'lnurl1kept' }).address, 'lnurl1kept', 'the reusable link that was paid');
});

test('Pay again: the hand-over carries the amounts and the slide, and an early stop goes back', async () => {
  const { vm } = payingHarness();
  const handed = [];
  let backs = 0;
  Object.assign(vm, {
    $route: { query: { action: 'pay_contact', address: 'shop@example.com', prefillAmount: '15000', prefillPayout: 'KES:1645', repeat: '1', returnTo: '/transactions' } },
    $router: { replace() {}, back: () => { backs += 1; }, options: { history: { state: { back: '/transactions' } } } },
    _walletsReady: Promise.resolve(),
    payContactDestination: (args) => { handed.push(args); return false; },
  });
  vm.handlePaymentFromQuery();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(handed[0].prefill, { amountSats: 15000, note: '', payout: { code: 'KES', amount: 1645 } });
  assert.equal(handed[0].repeat, true);
  assert.equal(backs, 1, 'nothing opened: back to History');
  assert.equal(vm.payReturnTo, null);

  // A caller that asked for no return: the hand-over is still cleared from the address.
  const replaced = [];
  Object.assign(vm, {
    $route: { query: { action: 'pay_contact', address: 'shop@example.com' } },
    $router: { replace: (value) => replaced.push(value), back: () => assert.fail('nowhere to go back to'), options: { history: { state: { back: null } } } },
  });
  vm.handlePaymentFromQuery();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(replaced, [{ query: {} }]);

  for (const prefillPayout of ['kes:1645', 'KES:-1', 'KES:0', 'KES:1e5']) {
    handed.length = 0;
    vm.$route = { query: { action: 'pay_contact', address: 'shop@example.com', prefillPayout } };
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(handed[0].prefill, undefined, prefillPayout);
    assert.equal(handed[0].repeat, undefined);
  }
});

test('a handed-over payment that leads nowhere goes back where it came from', async () => {
  const { vm, store } = payingHarness();
  const shown = [];
  let backs = 0;
  store.showPaymentError = (error) => shown.push(error.message);
  Object.assign(vm, {
    payReturnTo: '/transactions',
    $router: { replace() {}, back: () => { backs += 1; }, options: { history: { state: { back: '/transactions' } } } },
    fetchLightningAddressInfo: async () => { throw new Error('not found'); },
  });
  await quietly(() => vm.onPaymentDetected({ type: 'lightning_address', data: 'gone@example.com', paymentOnly: true }));
  assert.equal(shown.length, 1, 'the error is shown');
  assert.equal(backs, 1, 'and the user is back on History');
  assert.equal(vm.payReturnTo, null, 'no return is left for a later send');
});

test('Pay again: the sheet ends on the slide and starts in the recipient\'s currency where it can', () => {
  const { vm, options } = payingHarness({ active: 'biz' });
  vm.resolveWalletBrand = () => null;
  const currency = { code: 'KES', multiplier: 9000, decimals: 0, minSendable: 10, maxSendable: 150000 };
  vm.pendingPayment = lnAddressPayment({ repeat: true, currency, prefill: { amountSats: 15000, payout: { code: 'KES', amount: 1645 } } });
  let props = options.computed.paymentSheetProps.call(vm);
  assert.equal(props.forceSlide, true);
  assert.equal(props.amount.defaultPayout, 1645);
  assert.equal(props.amount.defaultAmount, 15000, 'sats stay as the fallback');

  vm.sendingWalletId = 'alby';
  assert.equal(options.computed.paymentSheetProps.call(vm).amount.defaultPayout, undefined, 'an NWC wallet pays the sat estimate');
  vm.sendingWalletId = null;
  vm.pendingPayment = lnAddressPayment({ repeat: true, currency: { ...currency, maxSendable: 1000 }, prefill: { amountSats: 15000, payout: { code: 'KES', amount: 1645 } } });
  assert.equal(options.computed.paymentSheetProps.call(vm).amount.defaultPayout, undefined, 'outside what the recipient takes now');
  vm.sendingWalletId = null;
  vm.pendingPayment = lnAddressPayment({ currency: { ...currency, code: 'TZS' }, prefill: { amountSats: 15000, payout: { code: 'KES', amount: 1645 } } });
  props = options.computed.paymentSheetProps.call(vm);
  assert.equal(props.amount.defaultPayout, undefined, 'another currency now');
  assert.equal(props.forceSlide, false, 'an ordinary payment keeps its usual confirm');
});

test('haptics: a failed payment is felt as an error, an unknown outcome as a warning, a redeem by its result', async () => {
  const played = [];
  const recorder = { haptics: Object.fromEntries(['tap', 'medium', 'success', 'error', 'warning'].map((kind) => [kind, () => { played.push(kind); }])) };

  // An LNbits payment that failed.
  const failed = payingHarness({ active: 'biz', deps: { '../utils/haptics.js': recorder } });
  failed.store.showPaymentError = () => {};
  failed.store.ensureLNBitsConnected = async () => ({ payLightningAddress: async () => { throw new Error('route not found'); } });
  Object.assign(failed.vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500' });
  await quietly(() => failed.vm.confirmPayment());
  assert.deepEqual(played, ['error']);

  // An NWC payment whose outcome the wallet could not confirm: it has not failed.
  played.length = 0;
  class UnconfirmedService {
    async sendPayment() { throw Object.assign(new Error('Payment not confirmed'), { code: 'NWC_PAYMENT_UNCONFIRMED' }); }
  }
  const unknown = payingHarness({ active: 'alby', deps: { '../utils/haptics.js': recorder, '../utils/lightning.js': { LightningPaymentService: UnconfirmedService } } });
  unknown.store.showPaymentError = () => {};
  Object.assign(unknown.vm, { pendingPayment: lnAddressPayment(), paymentAmount: '2500' });
  await quietly(() => unknown.vm.confirmPayment());
  assert.deepEqual(played, ['warning']);

  // A voucher or card redeem: only its outcome.
  played.length = 0;
  for (const status of ['creating', 'monitoring', 'confirmed', 'error', 'idle']) failed.options.watch.lnurlWithdrawStatus.call({}, status);
  assert.deepEqual(played, ['success', 'error']);
});

test('Pay with: the fee estimate is the paying wallet\'s', async () => {
  const { vm, calls } = payingHarness({ active: 'alby' });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'personal' });
  await vm.updateFeeEstimate();
  assert.deepEqual(callsTo(calls, 'ensureSparkConnected'), [['personal', 'ensureSparkConnected']], 'a Spark wallet estimates even though an NWC wallet is active');
  assert.equal(vm.estimatedFee, 7);
  assert.equal(vm.isEstimatingFee, false);
  // Re-run when the user changes the wallet (the sendingWalletId watcher): NWC has no estimate.
  assert.equal(vm.$options?.watch, undefined);
  vm.onSendingWalletChange('alby');
  await vm.updateFeeEstimate();
  assert.equal(vm.estimatedFee, null);
  assert.equal(vm.isEstimatingFee, false);
});

test('Pay with: the sendingWalletId watcher re-runs the fee estimate', () => {
  const { options } = payingHarness();
  assert.equal(options.watch.sendingWalletId, 'updateFeeEstimate');
  assert.equal(typeof options.methods.updateFeeEstimate, 'function');
  assert.equal(options.watch.pendingPayment.handler, 'updateFeeEstimate');
});

test('Pay with: an estimate for the previous wallet cannot land on the new one', async () => {
  const { vm, store } = payingHarness({ active: 'biz' });
  const slow = deferred();
  store.ensureSparkConnected = async id => ({ getLightningSendFeeEstimate: async () => (id === 'biz' ? slow.promise : { estimatedFeeSats: 9 }) });
  vm.pendingPayment = invoicePayment();
  vm.sendingWalletId = 'biz';
  const first = vm.updateFeeEstimate();
  assert.equal(vm.isEstimatingFee, true);
  vm.sendingWalletId = 'personal';
  const second = vm.updateFeeEstimate();
  await second;
  assert.equal(vm.estimatedFee, 9);
  slow.resolve({ estimatedFeeSats: 1 });
  await first;
  assert.equal(vm.estimatedFee, 9, 'the late answer for Business is dropped');
  assert.equal(vm.isEstimatingFee, false);
});

test('Pay with: the sheet\'s fee row follows the paying wallet', () => {
  const { vm, options } = payingHarness({ active: 'alby' });
  vm.pendingPayment = { type: 'arkade_address', data: 'ark1xyz', arkadeAddress: 'ark1xyz' };
  vm.resolveWalletBrand = () => null;
  vm.sendingWalletId = 'ark';
  assert.equal(options.computed.paymentSheetProps.call(vm).feeEstimate.label, 'Free · instant');
  vm.sendingWalletId = null;
  assert.equal(options.computed.paymentSheetProps.call(vm).feeEstimate, null, 'an NWC wallet shows no fee row');
  vm.pendingPayment = { type: 'spark_address', data: 'spark1abc', sparkAddress: 'spark1abc' };
  vm.sendingWalletId = 'personal';
  assert.equal(options.computed.paymentSheetProps.call(vm).feeEstimate.label, 'Free · instant');
});

test('Pay with: on-chain sends are the paying Spark wallet\'s, not the active one\'s', async () => {
  const { vm, store, calls, sent } = payingHarness({ active: 'alby' });
  // The active NWC wallet cannot pay on-chain, so the default pick is a Spark wallet.
  await vm.onPaymentDetected({ type: 'bitcoin_address', data: 'bc1qxyz' });
  assert.equal(vm.sendingWalletId, 'biz');
  assert.equal(vm.isSparkL1Payment, true);
  assert.equal(vm.sendingWalletBalance, 50000);
  vm.onSendingWalletChange('personal');
  assert.equal(vm.sendingWalletBalance, 40000, 'the fee panel is offered the paying wallet\'s balance');
  vm.l1Fee = { ready: true, speed: 'medium', feeQuoteId: 'q', totalFeeSats: 120, insufficient: false };
  vm.sendSheetAmountSats = 5000;
  const monitored = [];
  vm._monitorL1Withdrawal = (...args) => monitored.push(args);
  await vm.executeSparkL1Withdrawal(5000);
  assert.deepEqual(callsTo(calls, 'ensureSparkConnected'), [['personal', 'ensureSparkConnected']]);
  assert.deepEqual(callsTo(calls, 'withdrawToL1'), [['personal', 'withdrawToL1', 'bc1qxyz', 5000]]);
  assert.deepEqual(monitored, [['req-1', 'personal']], 'the paying wallet watches its own withdrawal');
  // Pay again: its own link, waiting for the withdrawal's id.
  const [link] = sent.links;
  assert.deepEqual({ ...link, payAgain: { ...link.payAgain, proof: undefined } }, {
    amountSats: 5000, transactionId: 'req-1', walletId: 'personal',
    payAgain: { address: 'bc1qxyz', addressType: 'bitcoin', amountSats: 5000, payout: null, proof: undefined },
  });
  assert.ok(link.payAgain.proof.includes('req-1'));
  assert.equal(vm.sendingWalletId, null);
  assert.equal(store.activeWalletId, 'alby');
  assert.deepEqual(callsTo(calls, 'reconcileSpark'), [['*', 'reconcileSpark', ['personal'], 'user']]);
});

test('Pay with: an on-chain withdrawal is monitored by the wallet that submitted it', async () => {
  const { vm, calls } = payingHarness({ active: 'alby' });
  const refreshed = [];
  vm.$q.notify = () => () => {};
  vm.refreshPayerBalance = async id => { refreshed.push(id); };
  await vm._monitorL1Withdrawal('req-9', 'personal');
  assert.deepEqual(callsTo(calls, 'waitForWithdrawalCompletion'), [['personal', 'waitForWithdrawalCompletion', 'req-9']]);
  assert.deepEqual(refreshed, ['personal']);
});

test('Pay with: Arkade can pay on-chain too, and the L1 panel then stays out of the way', async () => {
  const { vm } = payingHarness({ active: 'ark' });
  await vm.onPaymentDetected({ type: 'bitcoin_address', data: 'bc1qxyz' });
  assert.equal(vm.sendingWalletId, 'ark');
  assert.equal(vm.isSparkL1Payment, false);
  vm.onSendingWalletChange('biz');
  assert.equal(vm.isSparkL1Payment, true);
});

test('Pay with: a BIP21 native rail follows the wallet that pays', async () => {
  const bip21 = { address: 'bc1qxyz', amount: '0.00001', lightning: 'inv-1000', spark: 'spark1native' };
  const rails = { spark: 'spark1native', ark: null };
  const options = component({
    '../utils/payingWallets.js': payingWallets,
    '../utils/walletCapabilities.js': walletCapabilities,
    '../utils/addressUtils.js': { ...addresses, nativeRailsFromBip21: () => rails },
    '../utils/bip21.js': { bip21AmountToSats: () => 1000, parseBip21: () => null },
  });
  const vm = { ...options.methods, walletStore: { activeWalletType: 'alby' } };
  const lightning = { type: 'lightning_invoice', data: 'inv-1000', bip21 };
  assert.equal(vm.preferNativeBip21Rail(lightning, 'spark').type, 'spark_address');
  assert.equal(vm.preferNativeBip21Rail(lightning, 'spark').fixedAmountSats, 1000);
  assert.equal(vm.preferNativeBip21Rail(lightning, 'nwc'), lightning, 'an NWC payer stays on Lightning');
  assert.equal(vm.preferNativeBip21Rail(lightning, 'arkade'), lightning, 'no ark rail in this URI');
  assert.equal(vm.preferNativeBip21Rail(lightning).type, 'lightning_invoice', 'defaults to the active wallet\'s type');
  vm.walletStore.activeWalletType = 'spark';
  assert.equal(vm.preferNativeBip21Rail(lightning).type, 'spark_address');
});

test('Pay with: the entries the sheet renders are the store\'s wallets, active first', async () => {
  const { vm } = payingHarness({ active: 'lnb' });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
  const entries = vm.payingWalletEntries;
  assert.deepEqual(entries.map(w => w.id), ['lnb', 'biz', 'personal', 'alby', 'ark']);
  assert.deepEqual(entries.map(w => w.balanceSats), [20000, 50000, 40000, 30000, 10000]);
  assert.equal(entries[0].isActive, true);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['balanceSats', 'connectionFailed', 'id', 'isActive', 'name', 'reason', 'type', 'usable']);
  // Nothing pending: nothing to choose.
  vm.pendingPayment = null;
  assert.deepEqual(vm.payingWalletEntries, []);
  assert.equal(vm.paymentSheetWalletCanPay, true);
  assert.equal(vm.paymentSheetWalletHint, '');
});

test('Pay with: cancelling forgets the choice', () => {
  const { vm } = payingHarness();
  Object.assign(vm, { pendingPayment: invoicePayment(), sendingWalletId: 'alby', showSendSheet: true });
  vm.cancelBrantaLookup = () => {};
  vm.onSendSheetCancel();
  assert.equal(vm.sendingWalletId, null);
  assert.equal(vm.pendingPayment, null);
  assert.equal(vm.getSendingWallet().id, 'biz', 'falls back to the active wallet');
});

test('Pay with: a removed wallet falls back to the active one instead of paying from nowhere', () => {
  const { vm, store } = payingHarness({ active: 'lnb' });
  Object.assign(vm, { pendingPayment: invoicePayment(), sendingWalletId: 'alby' });
  assert.equal(vm.getSendingWallet().id, 'alby');
  store.wallets = store.wallets.filter(w => w.id !== 'alby');
  assert.equal(vm.getSendingWallet().id, 'lnb');
  assert.equal(vm.getSendingWalletType(), 'lnbits');
});

// ─────────────────────────────────────────────────────────────────────────
// Payment context: a caller (the contact chat) attaches an opaque string to a
// payment and gets it back, with the outcome, in the `payment:sent` event.
// ─────────────────────────────────────────────────────────────────────────

test('payment context: an invoice handed over by a caller is paid as a lightning invoice and keeps its context', () => {
  const { vm } = payingHarness();
  const dispatched = [];
  vm.onPaymentDetected = async payload => { dispatched.push(payload); };
  vm.payContactDestination({ address: 'inv-1000', addressType: 'invoice', name: 'Bob', sendingWalletId: 'lnb', context: 'chat:abc' });
  assert.deepEqual(dispatched, [{
    type: 'lightning_invoice', data: 'inv-1000', contactName: 'Bob', paymentOnly: true, sendingWalletId: 'lnb', paymentContext: 'chat:abc', firstParty: true,
  }]);
});

test('payment context: the route query hands the context over, a repeated param is ignored', async () => {
  for (const [context, expected] of [['chat:abc', 'chat:abc'], [['a', 'b'], undefined], ['', undefined], [undefined, undefined]]) {
    const { vm } = payingHarness();
    const handed = [];
    Object.assign(vm, { $route: { query: { action: 'pay_contact', address: 'inv-1000', addressType: 'invoice', context } },
      $router: { replace() {} }, _walletsReady: Promise.resolve(), payContactDestination: value => handed.push(value) });
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(handed[0].context, expected, JSON.stringify(context));
    assert.equal('context' in handed[0], expected !== undefined);
  }
});

test('payment context: a successful payment announces itself with the context, the amount and the paying wallet', async () => {
  const events = [];
  const { vm } = payingHarness({ bus: { emit: (name, data) => events.push([name, data]) } });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'lnb', paymentContext: 'chat:abc' });
  await quietly(() => vm.confirmPayment());
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'payment:sent');
  assert.deepEqual(events[0][1], {
    contactId: null, destination: 'inv-1000', amountSats: 1000, preimage: null, sendingWalletId: 'lnb', note: null, context: 'chat:abc',
    status: 'completed', paymentHash: null,
  });
});

test('payment context: a payment without a context still announces, with context null', async () => {
  const events = [];
  const { vm } = payingHarness({ bus: { emit: (name, data) => events.push([name, data]) } });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000' });
  await quietly(() => vm.confirmPayment());
  assert.equal(events.length, 1);
  assert.equal(events[0][1].context, null);
});

test('payment context: a failing listener never turns a sent payment into an error', async () => {
  const { vm, sent } = payingHarness({ bus: { emit() { throw new Error('listener bug'); } } });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', paymentContext: 'chat:abc' });
  const warn = console.warn;
  console.warn = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.warn = warn; }
  assert.equal(sent.success.amount, 1000, 'the success screen still opened');
});

test('payment context: a failed payment announces nothing', async () => {
  const events = [];
  const { vm, store } = payingHarness({ bus: { emit: (name, data) => events.push([name, data]) } });
  store.getProvider = () => { throw new Error('x'); };
  store.ensureLNBitsConnected = async () => { throw new Error('offline'); };
  let failures = 0;
  store.showPaymentError = () => { failures += 1; };
  Object.assign(vm, { pendingPayment: { ...invoicePayment(), paymentContext: 'chat:abc' }, sendingWalletId: 'lnb' });
  const error = console.error;
  console.error = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
  assert.equal(failures, 1, 'the payment really failed');
  assert.deepEqual(events, []);
});

// ─────────────────────────────────────────────────────────────────────────
// A chat request paid by invoice is linked to the contact (no address to find them by).
// ─────────────────────────────────────────────────────────────────────────

test('invoice contact: the route query hands over the contact id for an invoice only, a repeated param is ignored', async () => {
  for (const [addressType, contactId, expected] of [['invoice', 'c1', 'c1'], ['invoice', ['a', 'b'], undefined],
    ['invoice', '', undefined], ['lightning', 'c1', undefined]]) {
    const { vm } = payingHarness();
    const handed = [];
    Object.assign(vm, { $route: { query: { action: 'pay_contact', address: 'inv-1000', addressType, contactId } },
      $router: { replace() {} }, _walletsReady: Promise.resolve(), payContactDestination: value => handed.push(value) });
    vm.handlePaymentFromQuery();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(handed[0].contactId, expected, JSON.stringify([addressType, contactId]));
  }
});

test('invoice contact: only an existing contact is kept on the payment, and only for an invoice', () => {
  const { vm } = payingHarness();
  const dispatched = [];
  vm.onPaymentDetected = async payload => { dispatched.push(payload); };
  vm.payContactDestination({ address: 'inv-1000', addressType: 'invoice', sendingWalletId: 'lnb', contactId: 'c1' });
  vm.payContactDestination({ address: 'inv-1000', addressType: 'invoice', sendingWalletId: 'lnb', contactId: 'gone' });
  vm.payContactDestination({ address: 'bob@example.com', addressType: 'lightning', sendingWalletId: 'lnb', contactId: 'c1' });
  assert.equal(dispatched[0].paymentContactId, 'c1');
  assert.equal('paymentContactId' in dispatched[1], false);
  assert.equal('paymentContactId' in dispatched[2], false);
});

test('invoice contact: a paid invoice queues a contact link by amount on the paying wallet', async () => {
  const events = [];
  const { vm, sent } = payingHarness({ bus: { emit: (name, data) => events.push([name, data]) } });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'lnb', paymentContactId: 'c1' });
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(sent.links, [{ contactId: 'c1', amountSats: 1000, perPayment: true, walletId: 'lnb' }]);
  assert.equal(events[0][1].contactId, 'c1');
});

test('invoice contact: an invoice without a contact queues nothing', async () => {
  const { vm, sent } = payingHarness();
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'lnb' });
  await quietly(() => vm.confirmPayment());
  assert.equal(sent.links, undefined);
});
