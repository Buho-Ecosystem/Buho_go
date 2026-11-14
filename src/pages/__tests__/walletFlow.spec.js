import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as bip21Helpers from '../../utils/bip21.js';
import * as addresses from '../../utils/addressUtils.js';
import * as metadata from '../../utils/lnurlMetadata.js';
import * as lnurlPay from '../../utils/lnurlPay.js';
import { PAY_REQUEST, failed, fakeService, invoiceFor, lnurlPayWith, ok } from '../../utils/__tests__/lnurlPayFixtures.js';
import * as lnurlWithdraw from '../../utils/lnurlWithdraw.js';
import * as payingWallets from '../../utils/payingWallets.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as errorOrigin from '../../utils/errorOrigin.js';
import * as branta from '../../utils/branta.js';
import * as payAgain from '../../utils/payAgain.js';
import * as recipientPayments from '../../services/recipientPayments.js';
import * as haptics from '../../utils/haptics.js';
import * as nwcErrors from '../../utils/nwcErrors.js';
import * as nwcAtRest from '../../utils/nwcAtRest.js';
import * as nwcWallet from '../../utils/nwcWallet.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';
import * as userErrors from '../../utils/userErrors.js';
import * as refundAddress from '../../utils/refundAddress.js';
import * as lud18 from '../../utils/lud18.js';
import * as merchantQR from '../../utils/merchantQR.js';
import * as npubCashAddress from '../../utils/npubCashAddress.js';
import { recognizePhoneNumber } from '../../services/lnAddressServices/phoneNumbers.js';

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
  '../utils/payingWallets.js': payingWallets,
  '../utils/refundAddress.js': refundAddress,
  '../utils/lud18.js': lud18,
  '../utils/merchantQR.js': merchantQR,
  '../utils/errorOrigin.js': errorOrigin,
  '../utils/npubCashAddress.js': npubCashAddress,
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
    '../utils/nwcAtRest.js': nwcAtRest,
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
      const { get } = fakeService(ok({ ...PAY_REQUEST, disposable: early }), ok({ pr: invoiceFor(10), disposable }));
      const methods = component({
        '../utils/lnurlPay.js': lnurlPayWith(get),
        '../utils/lud23.js': { assertPaymentInput() {} },
      }).methods;
      const result = await methods.fetchLNURLInvoice.call({ walletStore: {} }, 'https://coffee.example/pay', 10);
      assert.equal(!!result.payLink, disposable === false);
      assert.equal(result.pr, invoiceFor(10));
    }
  }
});

test('the real fetchers hand the payer details to the request, and report what went', async () => {
  const TILL_TERMS = { ...PAY_REQUEST, callback: 'https://cryptoqr.net/api/cb/till', payerData: { identifier: { mandatory: false } } };
  const SENT = encodeURIComponent('{"identifier":"me@hub.example"}');
  const onlyTo = merchantQR.isMerchantProviderUrl;
  const fetchers = (...answers) => {
    const service = fakeService(...answers);
    const methods = component({
      '../utils/lnurlPay.js': lnurlPayWith(service.get),
      '../utils/lud23.js': { assertPaymentInput() {} },
    }).methods;
    return { methods, asked: service.asked };
  };

  const address = fetchers(ok(TILL_TERMS), ok({ pr: invoiceFor(81) }));
  const viaAddress = await address.methods.fetchLightningAddressInvoice.call({}, 'till@cryptoqr.net', 81, '', null, { identifier: 'me@hub.example', onlyTo });
  assert.deepEqual(viaAddress.payerData, { identifier: 'me@hub.example' });
  assert.ok(address.asked[1].url.endsWith(`&payerdata=${SENT}`));

  const lnurl = fetchers(ok(TILL_TERMS), ok({ pr: invoiceFor(81) }));
  const viaLnurl = await lnurl.methods.fetchLNURLInvoice.call({ walletStore: {} }, 'https://cryptoqr.net/pay', 81, null, '', { identifier: 'me@hub.example', onlyTo });
  assert.deepEqual(viaLnurl.payerData, { identifier: 'me@hub.example' });

  // The terms moved to another host after the sheet was shown: the till's
  // address is not handed to it, and no invoice is asked for.
  const moved = fetchers(ok({ ...TILL_TERMS, callback: 'https://cryptoqr.net.evil.example/cb' }));
  await assert.rejects(
    moved.methods.fetchLightningAddressInvoice.call({}, 'till@cryptoqr.net', 81, '', null, { identifier: 'me@hub.example', onlyTo }),
    (error) => error.code === lnurlPay.PAY_REQUEST_ERROR.INVALID && !errorOrigin.isCounterpartyError(error));
  assert.equal(moved.asked.length, 1, 'only the terms were read');
});

test('reading an address notes whether its callback is the till provider\'s, and keeps what it asks of the payer', async () => {
  const read = async (terms) => {
    const { get } = fakeService(ok(terms));
    const methods = component({
      '../utils/lnurlPay.js': lnurlPayWith(get),
      '../services/lnAddressServices': { matchLnAddressService: () => null },
    }).methods;
    return methods.fetchLightningAddressInfo.call({ $t: (x) => x, parseLnurlMetadata: () => null }, 'till@cryptoqr.net');
  };
  const till = await read({ ...PAY_REQUEST, callback: 'https://cryptoqr.net/api/cb', payerData: { identifier: { mandatory: false } } });
  assert.deepEqual([till.callbackOnTillProvider, till.payerData], [true, { identifier: { mandatory: false } }]);
  assert.equal(till.callback, 'https://cryptoqr.net/api/cb', 'the checked callback is available to NWC without a second read');
  assert.equal(till.metadata, PAY_REQUEST.metadata, 'complete metadata accompanies the checked terms');
  const other = await read({ ...PAY_REQUEST, callback: 'https://cryptoqr.net.evil.example/cb' });
  assert.deepEqual([other.callbackOnTillProvider, other.payerData], [false, null]);
});

test('an LNURL server\'s refusal is marked as its own; our fallback is not', async () => {
  const fetchWith = (...answers) => {
    const { get } = fakeService(...answers);
    const methods = component({
      '../utils/lnurlPay.js': lnurlPayWith(get),
      '../utils/lud23.js': { assertPaymentInput() {} },
    }).methods;
    return methods.fetchLNURLInvoice.call({ walletStore: {} }, 'https://coffee.example/pay', 10).catch((error) => error);
  };
  const refused = await fetchWith(ok(PAY_REQUEST), ok({ status: 'ERROR', reason: 'Amount is above the maximum' }));
  assert.deepEqual([refused.message, errorOrigin.isCounterpartyError(refused)], ['Amount is above the maximum', true]);
  const closed = await fetchWith(ok({ status: 'ERROR', reason: 'This shop is closed' }));
  assert.equal(errorOrigin.isCounterpartyError(closed), true);
  // The provider sends its reason with an HTTP 500: it still reaches the person.
  const behind500 = await fetchWith(ok(PAY_REQUEST), failed(500, { status: 'ERROR', reason: 'Could not validate refund address' }));
  assert.deepEqual([behind500.message, errorOrigin.isCounterpartyError(behind500)], ['Could not validate refund address', true]);
  const garbled = await fetchWith(ok({ tag: 'withdrawRequest', reason: 'not a refusal' }));
  assert.deepEqual([garbled.code, errorOrigin.isCounterpartyError(garbled)], [lnurlPay.PAY_REQUEST_ERROR.NOT_PAY_REQUEST, false]);
});

test('an LNURL payment sends the comment the person typed and stops at an invoice for another amount', async () => {
  const { get, asked } = fakeService(ok(PAY_REQUEST), ok({ pr: invoiceFor(2500) }), ok(PAY_REQUEST), ok({ pr: invoiceFor(25000) }));
  const methods = component({
    '../utils/lnurlPay.js': lnurlPayWith(get),
    '../utils/lud23.js': { assertPaymentInput() {} },
  }).methods;
  const paid = [];
  const limits = [];
  const provider = { payInvoice: async (args) => { paid.push(args.invoice); limits.push(args.feeLimitSats); return { id: 'tx', status: 'completed' }; } };
  const vm = { ...methods, pendingPayment: { lnurl: 'https://coffee.example/pay' }, walletStore: { ensureSparkConnected: async () => provider, ensureLNBitsConnected: async () => provider } };
  const result = await vm.sendSparkPayment(2500, 'thanks', null, 'A');
  assert.equal(asked[1].url, 'https://pay.example/lnurlp/cb/alice?amount=2500000&comment=thanks');
  assert.deepEqual(paid, [invoiceFor(2500)]);
  assert.deepEqual(limits, [25], 'Spark holds the route to the limit the sheet showed: 1 % of 2,500');
  assert.equal(result.invoiceSats, 2500, 'the invoice amount reaches the success screen');
  await assert.rejects(vm.sendLNBitsPayment(2500, '', null, 'B'), (error) => error.code === lnurlPay.PAY_REQUEST_ERROR.INVOICE_MISMATCH);
  assert.deepEqual(paid, [invoiceFor(2500)], 'the oversized invoice was never paid');
});

test('a pasted invoice pays with the fee the sheet quoted, a free one included', async () => {
  const methods = component().methods;
  for (const [estimatedFee, maxFee] of [[7, 7], [0, 0], [null, undefined]]) {
    const asked = [];
    const provider = { payInvoice: async (args) => { asked.push(args); return { id: 'tx', status: 'completed' }; } };
    const vm = { ...methods, estimatedFee, pendingPayment: { invoice: 'lnbc-x', amount: 1000 }, walletStore: { ensureSparkConnected: async () => provider } };
    await vm.sendSparkPayment(1000, '', null, 'A');
    assert.equal(asked[0].maxFee, maxFee, `quoted ${estimatedFee}`);
  }
});

test('a Lightning address that refuses says why, labelled as theirs; one that is not there stays "not found"', async () => {
  const infoWith = (...answers) => infoFor('alice@example.com', ...answers);
  const infoFor = (address, ...answers) => {
    const { get } = fakeService(...answers);
    const methods = component({
      '../utils/lnurlPay.js': lnurlPayWith(get),
      '../utils/errorOrigin.js': errorOrigin,
      '../services/lnAddressServices': { matchLnAddressService: () => null },
      '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    }).methods;
    return methods.fetchLightningAddressInfo.call({ ...methods, $t: t, walletStore: { useBip177Format: true } }, address);
  };
  assert.deepEqual(await infoWith(failed(500, { status: 'ERROR', reason: 'This account is suspended' })),
    { error: true, reason: 'This account is suspended', attribution: 'Reported by the recipient', serviceReason: 'This account is suspended' });
  assert.deepEqual(await infoWith(ok({ ...PAY_REQUEST, callback: 'http://pay.example/cb' })),
    { error: true, reason: "The recipient's payment details aren't valid. Ask them for another way to pay.", attribution: null, serviceReason: null });
  assert.deepEqual(await infoWith(ok({ status: 'ERROR' })),
    { error: true, reason: "The recipient's service declined. Nothing was sent.", attribution: null, serviceReason: null }, 'a refusal without words is said in ours');
  assert.deepEqual(await infoWith(failed(404)), { httpStatus: 404 }, 'not found, and how the server said so');
  assert.deepEqual(await infoWith(failed(429)), { httpStatus: 429 });
  assert.deepEqual(await infoWith(ok({ tag: 'withdrawRequest' })), {});
  const found = await infoWith(ok(PAY_REQUEST));
  assert.deepEqual([found.minSats, found.maxSats, found.commentAllowed, found.isFixedAmount], [1, 100000, 32, false]);
  for (const address of ['not an address', 'alice@evil.example/x', 'a/b@example.com']) {
    assert.deepEqual(await infoFor(address), {}, `${address} is never requested`);
  }
});

test('on the phone, no network reads as no network, never as "not found"', async () => {
  // The native HTTP stack rejects with the platform's own error code.
  const offline = [
    Object.assign(new Error('Unable to resolve host "example.com": No address associated with hostname'), { code: 'UnknownHostException' }),
    Object.assign(new Error('The Internet connection appears to be offline.'), { code: 'NSURLErrorDomain' }),
    new TypeError('Failed to fetch'),
  ];
  for (const failure of offline) {
    const { get } = fakeService(failure);
    const methods = component({
      '../utils/lnurlPay.js': lnurlPayWith(get),
      '../utils/errorOrigin.js': errorOrigin,
      '../services/lnAddressServices': { matchLnAddressService: () => null },
      '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    }).methods;
    const info = await methods.fetchLightningAddressInfo.call({ ...methods, $t: t, walletStore: {} }, 'alice@example.com');
    assert.deepEqual(info, { error: true, reason: "Couldn't reach the network. Please check your internet and try again.", attribution: null, serviceReason: null }, failure.message);
  }
});

test('a service\'s words keep their label in the Send field and in the dialog', () => {
  const methods = component({ '../utils/errorOrigin.js': errorOrigin }).methods;
  const shown = [];
  const vm = { ...methods, $t: t, sendResolveError: '', sendResolveSource: '', walletStore: { showPaymentError: (error, ctx) => shown.push([error, ctx]) } };
  vm.failSendResolution('This account is suspended', true, { attribution: 'Reported by the recipient' });
  assert.deepEqual([vm.sendResolveError, vm.sendResolveSource], ['This account is suspended', 'Reported by the recipient']);
  vm.failSendResolution("We couldn't find this Lightning address", true, { attribution: null });
  assert.equal(vm.sendResolveSource, '', 'our own words carry no label');
  vm.failSendResolution('Shop closed', false, { context: 'link', attribution: 'Reported by the server' });
  vm.failSendResolution('Our words', false, {});
  assert.deepEqual(shown.map(([error]) => [error.message, errorOrigin.isCounterpartyError(error)]), [['Shop closed', true], ['Our words', false]]);
  assert.equal(shown[0][1].context, 'link');
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
      payerRule: refundAddress.payerAddressRule(null), refundAddress: null,
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
  const details = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) }, '../utils/payAgain.js': payAgain, '../utils/nwcWallet.js': nwcWallet }).default;
  for (const status of ['pending', 'failed', 'completed']) {
    const target = details.computed.payAgainTarget.call({ transaction: { id: 'p', type: 'outgoing', status },
      metadataWalletId: 'A', metadataStore: { getMetadataForTransaction: (id, walletId) => (id === 'p' && walletId === 'A' ? { payLink: 'lnurl1service' } : null) } });
    assert.equal(target?.address ?? null, status === 'completed' ? 'lnurl1service' : null);
  }
});


test('an NWC receipt opened from History loads from the wallet store\'s wallet, also a few pages down', async () => {
  const details = evaluate('../TransactionDetails.vue', { pinia: { mapState: () => ({}) }, '../utils/payAgain.js': payAgain, '../utils/nwcWallet.js': nwcWallet }).default;
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

  // A wallet that claims another hash: found by the one its invoice names,
  // the id every notification and History use.
  const invoice = profileInvoiceFixture(21, 1_800_000_000_000);
  const named = nwcWallet.nwcPaymentHash({ invoice });
  listed.unshift({ invoice, payment_hash: 'ef'.repeat(32), type: 'incoming', amount: 21, settled_at: 1791300001 });
  await vm.fetchNWCTransaction(named, wallet);
  assert.equal(vm.transaction.id, named);
  listed.shift();

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
      payerRule: refundAddress.payerAddressRule(null), refundSheet: null,
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
  { id: 'hub', name: 'Home Hub', type: 'nwc', nwcUrl: 'nostr+walletconnect://hub' },
  { id: 'lnb', name: 'My LNbits', type: 'lnbits' },
  { id: 'ark', name: 'Arkade', type: 'arkade' },
];
const PAY_FUNDS = { biz: 50000, personal: 40000, hub: 30000, lnb: 20000, ark: 10000 };
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
    nwcPayOptions: () => ({ limit: null }),
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
    '../utils/merchantQR.js': merchantQR,
    // Only the pure address check: a request from here would be a real one.
    '../utils/lnurlPay.js': { lightningAddressUrl: lnurlPay.lightningAddressUrl },
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

// ── Till codes (utils/merchantQR.js) ───────────────────────────────────
const PROVIDER_TEST_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
/** A till code as the Send field hands it over. */
const scannedTill = (code = PROVIDER_TEST_CODE) => {
  const till = merchantQR.convertToLightningAddress(code);
  return { type: 'lightning_address', data: till.lightningAddress, source: merchantQR.SA_RETAIL_SOURCE, merchant: till.merchant, randAmount: till.randAmount };
};
/** Set up a till payment from the Send field with what the provider answered. */
async function setUpTill(info, payment = scannedTill()) {
  const harness = payingHarness({ active: 'biz' });
  const { vm } = harness;
  Object.assign(vm, { showSendModal: true, $t: t });
  harness.store.lightningAddressOf = (wallet) => (wallet.id === 'biz' ? 'me@spark.example' : null);
  vm.fetchLightningAddressInfo = async () => info;
  vm.resolveNostrTarget = async () => assert.fail('a till code is never looked up as a Nostr name');
  vm.resolveWalletBrand = () => null;
  Object.defineProperty(vm, 'ratesStale', { get: () => false, configurable: true });
  await quietly(() => vm.onPaymentDetected(payment));
  return harness;
}
const PROVIDER_ANSWER = { minSendable: 81000, maxSendable: 81000, minSats: 81, maxSats: 81, isFixedAmount: true, fixedAmountSats: 81,
  commentAllowed: 0, description: 'Pick n Pay', payerData: { identifier: { mandatory: false } }, callbackOnTillProvider: true };

test('till code: the provider\'s refusal is said in plain words in the Send field, never a sheet', async () => {
  for (const [serviceReason, said] of [
    ['[GET /scan][400] getQrInfoBadRequest {"code":"UNKNOWN_CODE"}', "This code can't be paid. Ask the cashier for a new one."],
    ['[GET /scan][400] getQrInfoBadRequest {"code":"NEW_CODE"}', "This code can't be paid. Ask the cashier for a new one."],
    ['UNSUPPORTED_QR_CODE: SnapScan not supported yet.', "This store's code isn't supported yet. Pay another way."],
    ['SMART_SHOPPER_SCANNED', "That's a rewards code. Ask the cashier for the payment QR code."],
    ['AMOUNT_TOO_HIGH', 'This amount is over the limit. Pay another way.'],
  ]) {
    const { vm } = await setUpTill({ error: true, reason: serviceReason, attribution: 'Reported by the recipient', serviceReason });
    assert.equal(vm.sendResolveError, said, serviceReason);
    assert.equal(vm.sendResolveSource, '', 'our plain words, not labelled as theirs');
    assert.equal(vm.showSendSheet, false);
    assert.equal(vm.pendingPayment, null);
  }
});

test('till code: words the app has nothing plainer for stay the provider\'s, labelled; silence is told by what it means', async () => {
  const theirs = await setUpTill({ error: true, reason: 'Store is offline', attribution: 'Reported by the recipient', serviceReason: 'Store is offline' });
  assert.deepEqual([theirs.vm.sendResolveError, theirs.vm.sendResolveSource], ['Store is offline', 'Reported by the recipient']);
  const offline = await setUpTill({ error: true, reason: 'No internet connection', attribution: null, serviceReason: null });
  assert.equal(offline.vm.sendResolveError, 'No internet connection');
  const unknown = await setUpTill({ httpStatus: 404 });
  assert.equal(unknown.vm.sendResolveError, "This code can't be paid. Ask the cashier for a new one.");
  assert.equal(unknown.vm.showSendSheet, false);
  for (const busy of [{ httpStatus: 429 }, { httpStatus: 503 }, {}]) {
    const { vm } = await setUpTill(busy);
    assert.equal(vm.sendResolveError, "The store's payment service isn't answering. Try again in a moment.", JSON.stringify(busy));
    assert.equal(vm.sendResolveSource, '');
  }
});

test('till code: the store as the provider names it, its logo, and the rand amount from the code', async () => {
  const { vm } = await setUpTill(PROVIDER_ANSWER);
  assert.equal(vm.showSendSheet, true);
  assert.deepEqual(vm.pendingPayment.merchant, { id: 'picknpay', displayName: 'Pick n Pay', logo: '/sa_retailers/picknpay.png' });
  assert.equal(vm.pendingPayment.description, 'Pick n Pay');
  assert.equal(vm.pendingPayment.zarAmount, '1.00');
  assert.equal(vm.pendingPayment.lightningAddress, scannedTill().data, 'the code as scanned, never lowered');
  const props = vm.paymentSheetProps;
  assert.deepEqual([props.recipient.name, props.recipient.logoUrl, props.zarAmount], ['Pick n Pay', '/sa_retailers/picknpay.png', '1.00']);
  assert.equal(props.recipient.service, true, 'the storefront mark if the logo fails, never a coloured letter');
});

test('till code: a brand name on another network gets no logo', async () => {
  const { vm } = await setUpTill({ ...PROVIDER_ANSWER, description: 'Woolworths Food Court' }, scannedTill('https://pos.snapscan.io/qr/ABC123'));
  assert.deepEqual(vm.pendingPayment.merchant, { id: 'snapscan', displayName: 'Woolworths Food Court', logo: null });
  assert.deepEqual([vm.paymentSheetProps.recipient.logoUrl, vm.paymentSheetProps.recipient.service], [null, true]);
});

test('till code: the sheet opens with the amount only for a narrow range; an amount printed in the code never picks one', async () => {
  const open = { ...PROVIDER_ANSWER, isFixedAmount: false, fixedAmountSats: 0 };
  const narrow = await setUpTill({ ...open, minSendable: 80000, maxSendable: 81000, minSats: 80, maxSats: 81 });
  assert.deepEqual(narrow.vm.paymentSheetProps.amount, { mode: 'range', minSats: 80, maxSats: 81, defaultAmount: 81 });
  const wide = await setUpTill({ ...open, minSendable: 1000, maxSendable: 1000000000, minSats: 1, maxSats: 1000000 });
  assert.equal(wide.vm.pendingPayment.zarAmount, '1.00', 'the code prints R1.00');
  assert.deepEqual(wide.vm.paymentSheetProps.amount, { mode: 'range', minSats: 1, maxSats: 1000000 }, 'never the top of a range the code does not fix');
  assert.equal(wide.vm.showSendSheet, true, 'the person enters the amount');
});

test('till code: an amount left from an earlier payment never decides whether it can be paid', async () => {
  const open = { ...PROVIDER_ANSWER, isFixedAmount: false, fixedAmountSats: 0, minSendable: 1000, maxSendable: 1000000000, minSats: 1, maxSats: 1000000 };
  const harness = payingHarness({ active: 'biz' });
  const { vm } = harness;
  Object.assign(vm, { showSendModal: true, $t: t, paymentAmount: '900000000' });
  vm.fetchLightningAddressInfo = async () => open;
  vm.resolveWalletBrand = () => null;
  Object.defineProperty(vm, 'ratesStale', { get: () => false, configurable: true });
  await quietly(() => vm.onPaymentDetected(scannedTill()));
  assert.equal(vm.showSendSheet, true, 'no "Insufficient balance" for an amount nobody entered for it');
});

test('till code: a code whose address cannot be asked for says it is not supported, never "try again"', async () => {
  for (const code of ['http://2.zap.pe?t=6\ni=1:2:7', 'https://pay.zapper.com/?i=a\\b']) {
    const till = merchantQR.convertToLightningAddress(code);
    assert.ok(till, code);
    const { vm } = await setUpTill({}, { type: 'lightning_address', data: till.lightningAddress, source: merchantQR.SA_RETAIL_SOURCE, merchant: till.merchant, randAmount: null });
    assert.equal(vm.sendResolveError, "This store's code isn't supported yet. Pay another way.", code);
  }
  const busy = await setUpTill({});
  assert.equal(busy.vm.sendResolveError, "The store's payment service isn't answering. Try again in a moment.", 'a code that was asked for and got no answer');
});

test('till code: an address on the provider\'s domain, pasted or linked, is one', async () => {
  const { vm } = await setUpTill(PROVIDER_ANSWER, { type: 'lightning_address', data: 'TSHP6SJNKTR3IY%2Fconfirm@cryptoqr.net' });
  assert.equal(vm.pendingPayment.source, merchantQR.SA_RETAIL_SOURCE);
  assert.deepEqual(vm.pendingPayment.merchant, { id: 'provider', displayName: 'Pick n Pay', logo: null });
  assert.equal(vm.pendingPayment.lightningAddress, 'TSHP6SJNKTR3IY%2Fconfirm@cryptoqr.net');
  const missing = await setUpTill({ httpStatus: 404 }, { type: 'lightning_address', data: 'GONE@cryptoqr.net' });
  assert.equal(missing.vm.sendResolveError, "This code can't be paid. Ask the cashier for a new one.", 'and never a Nostr name');
});

test('till code: another store\'s name gets no logo; a store with no name is "Store"; a forged amount is ignored', async () => {
  const cafe = await setUpTill({ ...PROVIDER_ANSWER, description: 'Kaffeehaus am Markt' }, scannedTill('00020126230019za.co.electrum.TEST6304ABCD'));
  assert.deepEqual(cafe.vm.pendingPayment.merchant, { id: 'electrum', displayName: 'Kaffeehaus am Markt', logo: null });
  assert.equal(cafe.vm.pendingPayment.zarAmount, null, 'that code prints no amount');
  const unnamed = await setUpTill({ ...PROVIDER_ANSWER, description: null }, scannedTill('https://www.zapper.com/url/TEST'));
  assert.equal(unnamed.vm.pendingPayment.merchant.displayName, 'Store');
  const forged = await setUpTill(PROVIDER_ANSWER, { ...scannedTill(), randAmount: '1,000,000' });
  assert.equal(forged.vm.pendingPayment.zarAmount, null);
});

test('any other address that does not resolve still says so, in its own words', async () => {
  const { vm } = payingHarness({ active: 'biz' });
  Object.assign(vm, { showSendModal: true, $t: t });
  vm.fetchLightningAddressInfo = async () => ({});
  vm.resolveNostrTarget = async () => null;
  await quietly(() => vm.onPaymentDetected({ type: 'lightning_address', data: 'nobody@example.com' }));
  assert.equal(vm.sendResolveError, "We couldn't find this Lightning address");
});

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
  for (const active of ['biz', 'personal', 'hub', 'lnb']) {
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
  const sparkFromNwc = payingHarness({ active: 'hub' });
  assert.equal(sparkFromNwc.vm.chooseSendingWalletId('spark_address'), 'biz');
  const arkadeAddress = payingHarness({ active: 'biz' });
  assert.equal(arkadeAddress.vm.chooseSendingWalletId('arkade_address'), 'ark');
  const onChain = payingHarness({ active: 'lnb' });
  assert.equal(onChain.vm.chooseSendingWalletId('bitcoin_address'), 'biz');
  // Nobody can: the active wallet stays chosen so the sheet can say why.
  const nobody = payingHarness({ wallets: PAY_WALLETS.filter(w => w.type !== 'spark' && w.type !== 'arkade'), active: 'hub' });
  assert.equal(nobody.vm.chooseSendingWalletId('bitcoin_address'), 'hub');
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
  await picked.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'hub' });
  assert.equal(picked.vm.sendingWalletId, 'hub');
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
  vm.sendingWalletId = 'hub';
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
  const nwcActive = payingHarness({ active: 'hub' });
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
    [{ action: 'pay_contact', address: 'bob@example.com', addressType: 'lightning', walletId: 'hub' }, 'hub'],
    [{ action: 'pay_contact', address: 'bob@example.com', walletId: ['hub', 'lnb'] }, null],
    [{ action: 'pay_contact', address: 'bob@example.com' }, null],
    [{ action: 'bitcoin_withdrawal', address: 'bc1qxyz', walletId: 'hub' }, null],
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

test('Pay with: checked metadata is reused for every paying wallet without a second read', async () => {
  // Paid by an NWC wallet: resolved for NWC, and reading the address needs no connection.
  const nwc = payingHarness({ active: 'biz' });
  await nwc.vm.onPaymentDetected({ type: 'lightning_address', data: 'bob@example.com', sendingWalletId: 'hub' });
  assert.deepEqual(nwc.lightning, [], 'recipient preparation never connects a wallet or fetches metadata twice');
  assert.equal(nwc.vm.pendingPayment.address, 'bob@example.com');
  assert.equal(nwc.vm.sendingWalletId, 'hub');

  // Paid by a Spark wallet while an NWC wallet is active: no NWC service is touched.
  const spark = payingHarness({ active: 'hub' });
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
  assert.deepEqual(vm.payingWalletEntries.map(w => w.id), ['biz', 'personal', 'hub', 'lnb', 'ark']);
  assert.deepEqual(vm.payingWalletEntries.map(w => w.reason), [null, 'insufficient-balance', null, null, 'unsupported-destination']);

  // Unusable rows are refused: the selection does not move.
  vm.onSendingWalletChange('personal');
  vm.onSendingWalletChange('ark');
  vm.onSendingWalletChange('gone');
  assert.equal(vm.sendingWalletId, 'biz');

  vm.l1Fee = { ready: true };
  vm.onSendingWalletChange('hub');
  assert.equal(vm.sendingWalletId, 'hub');
  assert.equal(vm.l1Fee, null, 'a quote priced for another wallet is dropped');
  assert.equal(vm.canConfirmPayment, true);
  assert.equal(store.activeWalletId, 'biz', 'the active wallet is untouched');
  assert.equal(vm.sendingWalletBalance, 30000, 'the sheet shows the paying wallet\'s balance');
  assert.equal(vm.payerWalletId, 'hub');

  // A larger amount outgrows the selected wallet: the gate closes, the hint names it.
  vm.sendSheetAmountSats = 45000;
  assert.equal(vm.paymentSheetWalletCanPay, false);
  assert.equal(vm.paymentSheetWalletHint, 'Not enough balance in Home Hub. Choose another wallet or send less.');
  assert.equal(vm.canConfirmPayment, false);

  // Mid-send the choice is frozen.
  vm.sendSheetAmountSats = 5000;
  vm.isSendingPayment = true;
  vm.onSendingWalletChange('lnb');
  assert.equal(vm.sendingWalletId, 'hub');
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
  const down = payingHarness({ connectionStates: { hub: { connected: false, error: 'relay unreachable' } } });
  await down.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'hub' });
  assert.equal(down.vm.paymentSheetWalletCanPay, true);
  assert.equal(down.vm.paymentSheetWalletHint, '');
});

test('Pay with: a single wallet that holds too little says so before the slide, like several do', async () => {
  const lone = payingHarness({ wallets: [PAY_WALLETS[2]], active: 'hub', funds: { hub: 3 } });
  await lone.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-big' });
  assert.equal(lone.vm.sendingWalletId, 'hub');
  assert.equal(lone.vm.payingWalletEntries.length, 1);
  assert.equal(lone.vm.paymentSheetWalletCanPay, false);
  assert.equal(lone.vm.canConfirmPayment, false);
  assert.equal(lone.vm.paymentSheetWalletHint, 'Not enough balance in Home Hub.', 'no other wallet to suggest');
  await quietly(() => lone.vm.confirmPayment());
  assert.deepEqual(lone.lightning.filter(([step]) => step === 'send'), [], 'nothing was sent');

  // A saved or older figure may be behind money that arrived meanwhile: it is
  // re-read when the payment opens and refuses nothing until then.
  const behind = payingHarness({ wallets: [PAY_WALLETS[2]], active: 'hub', funds: { hub: 3 }, cached: ['hub'] });
  await behind.vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-big' });
  assert.equal(behind.vm.paymentSheetWalletCanPay, true);
  assert.equal(behind.vm.paymentSheetWalletHint, '');
  // ...which the opening payment starts, for a single wallet too.
  behind.options.watch['payingWalletEntries.length'].call(behind.vm, 1, 0);
  assert.deepEqual(behind.calls.filter(([, step]) => step === 'refreshBalance'), [['hub', 'refreshBalance']]);

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
    for (const other of ['biz', 'personal', 'hub', 'lnb', 'ark'].filter(id => id !== payer)) {
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

test('a Lightning address on Spark shows the most its route may cost; other wallets and no amount show none', () => {
  const { vm, options } = payingHarness({ active: 'biz' });
  vm.resolveWalletBrand = () => null;
  const feeRow = () => options.computed.paymentSheetProps.call(vm).feeEstimate;
  Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'personal', sendSheetAmountSats: 2500 });
  assert.deepEqual(feeRow(), { sats: 25, isEstimating: false, isLimit: true }, '1 % of the amount');
  vm.sendSheetAmountSats = 300;
  assert.deepEqual(feeRow(), { sats: 10, isEstimating: false, isLimit: true }, 'never under 10 sats');
  vm.pendingPayment = { type: 'lnurl', data: 'lnurl1xyz', lnurl: 'lnurl1xyz', minSendable: 1000, maxSendable: 1e9 };
  assert.equal(feeRow().isLimit, true, 'a payment link the same');
  vm.sendSheetAmountSats = 0;
  vm.pendingPayment = lnAddressPayment();
  assert.equal(feeRow(), null, 'no amount yet, no limit to show');
  Object.assign(vm, { sendSheetAmountSats: 2500, sendingWalletId: 'hub' });
  assert.equal(feeRow(), null, 'an NWC wallet sets its own fees');
});

test('the success screen and History records carry what the invoice charged, in the recipient\'s currency too', async () => {
  for (const [invoiceSats, shown] of [[2060, 2060], [2500, 2500], [undefined, 2500], [2059.4, 2060]]) {
    const { vm, sent } = payingHarness({ active: 'biz' });
    vm.fetchLightningAddressInvoice = async () => ({ pr: 'lnbc-resolved', invoiceSats, successAction: null, verify: null });
    Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
    await quietly(() => vm.confirmPayment());
    assert.equal(sent.success.amount, shown, `invoice for ${invoiceSats}`);
    assert.deepEqual(sent.links.map(link => link.amountSats), [shown], 'the record that finds the payment in History');
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
  vm.onSendingWalletChange('hub');
  vm.paymentAmount = '2500';
  vm.sendSheetAmountSats = 2500;
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(lightning.map(entry => entry.slice(0, 2)), [['new', 'hub'], ['send', 'hub']]);
  const [, , data, amount] = lightning[1];
  assert.equal(data.type, 'lightning_address');
  assert.equal(data.address, 'bob@example.com', 'bridged to the shape the NWC service reads');
  assert.equal(amount, 2500);
  assert.deepEqual(calls.filter(call => call[1] !== 'updateWalletBalance' && call[1] !== 'refreshBalance'), []);
  assert.equal(store.activeWalletId, 'biz');
});

test('Pay with: a payment resolved for NWC reaches the NWC service untouched', async () => {
  const { vm, lightning } = payingHarness({ active: 'hub' });
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
  const nwc = payingHarness({ active: 'hub' });
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

  vm.sendingWalletId = 'hub';
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
  const unknown = payingHarness({ active: 'hub', deps: { '../utils/haptics.js': recorder, '../utils/lightning.js': { LightningPaymentService: UnconfirmedService } } });
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
  const { vm, calls } = payingHarness({ active: 'hub' });
  await vm.onPaymentDetected({ type: 'lightning_invoice', data: 'inv-1000', sendingWalletId: 'personal' });
  await vm.updateFeeEstimate();
  assert.deepEqual(callsTo(calls, 'ensureSparkConnected'), [['personal', 'ensureSparkConnected']], 'a Spark wallet estimates even though an NWC wallet is active');
  assert.equal(vm.estimatedFee, 7);
  assert.equal(vm.isEstimatingFee, false);
  // Re-run when the user changes the wallet (the sendingWalletId watcher): NWC has no estimate.
  assert.equal(vm.$options?.watch, undefined);
  vm.onSendingWalletChange('hub');
  await vm.updateFeeEstimate();
  assert.equal(vm.estimatedFee, null);
  assert.equal(vm.isEstimatingFee, false);
});

test('Pay with: the sendingWalletId watcher re-runs the fee estimate', () => {
  const { options } = payingHarness();
  assert.equal(options.watch.sendingWalletId, 'updateFeeEstimate');
  assert.equal(typeof options.methods.updateFeeEstimate, 'function');
  assert.ok([].concat(options.watch.pendingPayment).some((w) => w?.handler === 'updateFeeEstimate' && w.deep === true && w.immediate === true));
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
  const { vm, options } = payingHarness({ active: 'hub' });
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
  const { vm, store, calls, sent } = payingHarness({ active: 'hub' });
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
  assert.equal(store.activeWalletId, 'hub');
  assert.deepEqual(callsTo(calls, 'reconcileSpark'), [['*', 'reconcileSpark', ['personal'], 'user']]);
});

test('Pay with: an on-chain withdrawal is monitored by the wallet that submitted it', async () => {
  const { vm, calls } = payingHarness({ active: 'hub' });
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

test('a Bitcoin request is paid with the amount it asks for, as an invoice is', async () => {
  const { vm } = payingHarness({ deps: { '../utils/bip21.js': bip21Helpers } });
  await vm.onPaymentDetected({ type: 'bitcoin_address', data: 'bc1qxyz', bip21: { address: 'bc1qxyz', amount: '0.0004' } });
  assert.equal(vm.pendingPayment.fixedAmountSats, 40_000, 'bitcoin:…?amount=0.0004');
  assert.equal(vm.pendingPayment.bitcoinAddress, 'bc1qxyz');
  assert.equal(vm.showSendSheet, true);
  assert.equal(vm.getPaymentAmountForFee(), 40_000, 'the fee is quoted for the amount asked');
  assert.deepEqual(vm.paymentSheetProps.amount, { mode: 'fixed', fixedSats: 40_000 }, 'locked, so "Use all" stays away');

  const plain = payingHarness({ deps: { '../utils/bip21.js': bip21Helpers } });
  await plain.vm.onPaymentDetected({ type: 'bitcoin_address', data: 'bc1qxyz', bip21: { address: 'bc1qxyz' } });
  assert.equal(plain.vm.pendingPayment.fixedAmountSats, undefined, 'no amount asked: the person types it');
});

test('every payer pick for a Bitcoin request picks for the amount it asks for', async () => {
  const { vm } = payingHarness({ deps: { '../utils/bip21.js': bip21Helpers } });
  const picks = [];
  const choose = vm.chooseSendingWalletId;
  vm.chooseSendingWalletId = function (type, requested, amountSats) {
    picks.push(amountSats);
    return choose.call(this, type, requested, amountSats);
  };
  await vm.onPaymentDetected({ type: 'bitcoin_address', data: 'bc1qxyz', bip21: { address: 'bc1qxyz', amount: '0.0004' } });
  assert.ok(picks.length > 0);
  assert.ok(picks.every((amount) => amount === 40_000), `picked for ${picks.join(', ')}`);
  assert.equal(vm.requestAmountSats({ type: 'spark_address', fixedAmountSats: 1234 }), 1234, 'a fixed amount it already carries');
  assert.equal(vm.requestAmountSats({ type: 'bitcoin_address', data: 'bc1qxyz' }), 0, 'none asked');
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
  const vm = { ...options.methods, walletStore: { activeWalletType: 'hub' } };
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
  assert.deepEqual(entries.map(w => w.id), ['lnb', 'biz', 'personal', 'hub', 'ark']);
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
  Object.assign(vm, { pendingPayment: invoicePayment(), sendingWalletId: 'hub', showSendSheet: true });
  vm.cancelBrantaLookup = () => {};
  vm.onSendSheetCancel();
  assert.equal(vm.sendingWalletId, null);
  assert.equal(vm.pendingPayment, null);
  assert.equal(vm.getSendingWallet().id, 'biz', 'falls back to the active wallet');
});

test('Pay with: a removed wallet falls back to the active one instead of paying from nowhere', () => {
  const { vm, store } = payingHarness({ active: 'lnb' });
  Object.assign(vm, { pendingPayment: invoicePayment(), sendingWalletId: 'hub' });
  assert.equal(vm.getSendingWallet().id, 'hub');
  store.wallets = store.wallets.filter(w => w.id !== 'hub');
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

// ─────────────────────────────────────────────────────────────────────────
// "Refunds to" (LUD-18): the address that goes with a payment when the
// service asks for one. A till payment shows it by default and may decline
// it; anything else shows it only when the payment cannot go ahead without
// it. The address on the row is the one that goes, through every wallet
// type, and a refusal is said on the row with the sheet still open.
// ─────────────────────────────────────────────────────────────────────────

const TILL = '0002010122TSHP6SJNKTR3IY%2Fconfirm6304821D@cryptoqr.net';
const OWN_ADDRESSES = { biz: 'biz@spark.example', personal: 'me@spark.example', hub: 'me@hub.example', lnb: 'shop@lnbits.example' };
const tillPayment = (extra = {}) => lnAddressPayment({
  data: TILL, lightningAddress: TILL, source: 'sa_retail', callbackOnTillProvider: true,
  payerData: { identifier: { mandatory: false } }, ...extra,
});

/** What a wallet path was handed, without the host test (`guarded` says whether it had one). */
const shared = (payerData) => (payerData ? { identifier: payerData.identifier } : null);

/** An identity whose key is on this phone, so its Social Bucket can be emptied here. */
const BUCKET_NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';
const BUCKET_ADDRESS = `${BUCKET_NPUB}@npub.cash`;
const identityHere = (extra = {}) => ({ bootstrapped: true, nostrNpub: BUCKET_NPUB, identityCapabilities: { rawKey: true }, ...extra });

/** A paying harness whose every wallet path reports the payer details it was handed. */
function refundHarness(options = {}) {
  const handed = []; // [walletId, { identifier } | null]
  const guards = []; // the `onlyTo` test each path was handed, or null
  class CapturingLightningService {
    constructor(nwc = null) { this.wallet = nwc?.walletId ?? null; }
    async processPaymentInput() { throw new Error('not used'); }
    async sendPayment(data, amount, comment, opts = {}) {
      handed.push([this.wallet, shared(opts.payerData)]);
      guards.push(opts.payerData?.onlyTo ?? null);
      return { preimage: 'ff', status: 'completed', payerData: opts.payerData ?? null };
    }
  }
  const played = [];
  const recorder = { haptics: Object.fromEntries(['tap', 'medium', 'success', 'error', 'warning'].map((kind) => [kind, () => { played.push(kind); }])) };
  const harness = payingHarness({ ...options, deps: { '../utils/lightning.js': { LightningPaymentService: CapturingLightningService }, '../utils/haptics.js': recorder, ...options.deps } });
  const { vm, store, providerFor } = harness;
  store.lightningAddressOf = (wallet) => OWN_ADDRESSES[wallet?.id] || null;
  const sparkConnect = store.ensureSparkConnected;
  store.ensureSparkConnected = async (id = null) => {
    const provider = await sparkConnect(id);
    return { ...provider, payLightningAddress: async (address, amount, comment, payout, opts = {}) => {
      handed.push([id, shared(opts.payerData)]);
      guards.push(opts.payerData?.onlyTo ?? null);
      return { id: `tx-${id}`, status: 'completed', payerData: opts.payerData ?? null };
    } };
  };
  vm.fetchLightningAddressInvoice = async (address, sats, comment, payout, payerData = null) => {
    handed.push([vm.getSendingWallet()?.id, shared(payerData)]);
    guards.push(payerData?.onlyTo ?? null);
    return { pr: 'lnbc-resolved', invoiceSats: sats, successAction: null, verify: null, payerData: shared(payerData) };
  };
  vm.resolveWalletBrand = () => null;
  vm.showSendSheet = true; // every payment here is on an open sheet
  return { ...harness, handed, guards, played, providerFor };
}

test('Refunds to: a till code that asks shows the row, and the paying wallet\'s address goes through every wallet type', async () => {
  for (const payer of ['biz', 'lnb', 'hub']) {
    const { vm, handed, guards, sent } = refundHarness({ active: 'biz' });
    Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: payer, paymentAmount: '2500', sendSheetAmountSats: 2500 });
    const row = vm.paymentSheetProps.refund;
    const expected = OWN_ADDRESSES[payer];
    assert.equal(row.purpose, 'refund', payer);
    assert.equal(row.selected, expected, payer);
    assert.equal(row.canDecline, true);
    assert.equal(row.holder, 'MoneyBadger');
    await quietly(() => vm.confirmPayment());
    assert.deepEqual(handed, [[payer, { identifier: expected }]], `${payer}: the address on the row is the one that went`);
    assert.equal(guards[0], merchantQR.isMerchantProviderUrl, `${payer}: only to the till's own service`);
    assert.equal(sent.links?.[0]?.refundAddress, expected, `${payer}: kept with the payment`);
  }
});

test('Refunds to: a wallet without an address of its own offers the next one', () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'ark', paymentAmount: '2500' });
  assert.equal(vm.refundAddress, OWN_ADDRESSES.biz, 'Arkade has none: the oldest wallet\'s');
});

test('Refunds to: declining sends nothing and keeps nothing', async () => {
  const { vm, handed, sent } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.onRefundPick({ declined: true });
  assert.equal(vm.paymentSheetProps.refund.selected, null);
  assert.equal(vm.paymentSheetProps.refund.declined, true);
  assert.equal(vm.canConfirmPayment, true, 'an optional address may be left out');
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed, [['lnb', null]]);
  assert.equal(sent.links?.[0]?.refundAddress ?? null, null);
});

test('Refunds to: a till that insists has no way to decline', () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment({ payerData: { identifier: { mandatory: true } } }), sendingWalletId: 'biz', paymentAmount: '2500' });
  vm.onRefundPick({ declined: true });
  assert.equal(vm.refundAddress, 'biz@spark.example');
  assert.equal(vm.paymentSheetProps.refund.canDecline, false);
  assert.equal(vm.paymentSheetProps.refund.required, true);
});

test('Refunds to: what is recorded is what the request path says went, never only what was on the row', async () => {
  const { vm, sent } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  // The service no longer asked when the invoice was requested.
  vm.fetchLightningAddressInvoice = async () => ({ pr: 'lnbc-resolved', invoiceSats: 2500, successAction: null, verify: null, payerData: null });
  await quietly(() => vm.confirmPayment());
  assert.equal(sent.links?.[0]?.refundAddress ?? null, null);
});

test('Refunds to: Pay with moves the default with the wallet that pays, a pick stays', () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  assert.equal(vm.refundAddress, 'biz@spark.example');
  vm.sendingWalletId = 'lnb';
  assert.equal(vm.refundAddress, 'shop@lnbits.example');
  assert.deepEqual(vm.refundOptions.map((o) => o.address), ['shop@lnbits.example', 'biz@spark.example', 'me@spark.example', 'me@hub.example']);
  vm.onRefundPick({ address: 'me@hub.example' });
  vm.sendingWalletId = 'personal';
  assert.equal(vm.refundAddress, 'me@hub.example', 'the person chose it');
});

test('Refunds to: a typed address is checked, used once, and listed last', () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  vm.onRefundPick({ address: 'not an address', entered: true });
  assert.equal(vm.refundAddress, 'biz@spark.example', 'refused before it reaches the row');
  vm.onRefundPick({ address: ' Maria@Else.Example ', entered: true });
  assert.equal(vm.refundAddress, 'Maria@Else.Example');
  assert.deepEqual(vm.refundOptions.at(-1), { address: 'Maria@Else.Example', source: 'entered' });
});

test('Refunds to: the row belongs to one payment; opening or closing the sheet forgets it', () => {
  const { vm, options } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  vm.onRefundPick({ address: 'maria@else.example', entered: true });
  vm.noteRefundRefusal(Object.assign(new Error('x'), { code: 'LNURL_PAYER_DATA_REQUIRED' }), { shown: true, sent: null });
  vm.stopMerchantCountdown = () => {};
  options.watch.showSendSheet.call(vm, false);
  assert.deepEqual([vm.refundPick, vm.refundEntered, vm.refundProblem, vm.refundRefusedAddress, vm.refundRequiredByService, vm.refundAwaitingPick],
    [null, null, null, null, false, false]);
  assert.equal(vm.refundAddress, 'biz@spark.example');
});

test('Refunds to: nothing changes mid-send', () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500', isSendingPayment: true });
  vm.onRefundPick({ address: 'maria@else.example' });
  vm.onRefundPick({ declined: true });
  assert.equal(vm.refundAddress, 'biz@spark.example');
});

test('Refunds to: an address the store turns down is said on the row, the sheet stays open, and nothing is retried', async () => {
  const { vm, handed, played } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.fetchLightningAddressInvoice = async (address, sats, comment, payout, payerData) => {
    handed.push(['lnb', shared(payerData)]);
    throw errorOrigin.counterpartyError('Could not validate refund address', '');
  };
  await quietly(() => vm.confirmPayment());
  assert.equal(handed.length, 1, 'never tried again by itself');
  assert.deepEqual(played, ['warning']);
  assert.ok(vm.pendingPayment, 'the sheet stays');
  assert.equal(vm.isSendingPayment, false);
  assert.equal(vm.paymentSheetProps.refund.problem, 'refused');
  assert.equal(vm.paymentSheetProps.refund.refusedAddress, 'shop@lnbits.example');
  assert.equal(vm.canConfirmPayment, false, 'the slide waits for another address');

  vm.onRefundPick({ address: 'biz@spark.example' });
  assert.equal(vm.paymentSheetProps.refund.problem, null);
  assert.equal(vm.canConfirmPayment, true);
  vm.fetchLightningAddressInvoice = async (address, sats, comment, payout, payerData) => {
    handed.push(['lnb', shared(payerData)]);
    return { pr: 'lnbc-resolved', invoiceSats: sats, successAction: null, verify: null, payerData: shared(payerData) };
  };
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed.at(-1), ['lnb', { identifier: 'biz@spark.example' }]);
});

test('till code: paid, it offers no contact, keeps the store\'s name and never the code', async () => {
  const { vm, sent } = refundHarness({ active: 'biz' });
  const merchant = { id: 'picknpay', displayName: 'Pick n Pay', logo: '/sa_retailers/picknpay.png' };
  Object.assign(vm, { pendingPayment: tillPayment({ merchant }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  await quietly(() => vm.confirmPayment());
  assert.equal(sent.success.recipient, 'Pick n Pay', 'the success screen names the store');
  assert.equal(sent.success.showSaveContact, false);
  const link = sent.links?.[0];
  assert.equal(link.recipientAddress ?? null, null, 'the one-time code is not kept as an address');
  assert.equal(link.label, 'Pick n Pay');
  assert.equal(link.payAgain ?? null, null);
  assert.equal(link.refundAddress, 'shop@lnbits.example', 'the refund address still goes with it');
});

test('till code: the provider\'s refusal at payment time is said in plain words; other words stay theirs', async () => {
  for (const [message, reason] of [
    ['[GET /scan][400] getQrInfoBadRequest {"code":"UNKNOWN_CODE"}', "This code can't be paid. Ask the cashier for a new one."],
    ['[GET /scan][500] {"code":"NEW_CODE"}', "This code can't be paid. Ask the cashier for a new one."],
    ['AMOUNT_TOO_HIGH', 'This amount is over the limit. Pay another way.'],
    ['invalid scan request', undefined],
  ]) {
    const { vm, store } = refundHarness({ active: 'biz' });
    const shown = [];
    store.showPaymentError = (error, ctx) => { shown.push([error.message, ctx.reason]); };
    Object.assign(vm, { pendingPayment: tillPayment({ payerData: null }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
    vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError(message, ''); };
    const error = console.error;
    console.error = () => {};
    try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
    assert.deepEqual(shown, [[message, reason]], message);
  }
  // The same words from any other service are left as they are.
  const { vm, store } = refundHarness({ active: 'biz' });
  const shown = [];
  store.showPaymentError = (error, ctx) => { shown.push(ctx.reason); };
  Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError('UNKNOWN_CODE', ''); };
  const error = console.error;
  console.error = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
  assert.deepEqual(shown, [undefined]);
});

test('Refunds to: the warning stays with the refused address; Pay with another wallet clears it', async () => {
  const { vm } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError('Could not validate refund address', ''); };
  await quietly(() => vm.confirmPayment());
  assert.equal(vm.canConfirmPayment, false);
  vm.sendingWalletId = 'biz';
  assert.equal(vm.paymentSheetProps.refund.selected, 'biz@spark.example');
  assert.equal(vm.canConfirmPayment, true, 'this address was never turned down');
  vm.onRefundPick({ address: 'SHOP@LNBITS.EXAMPLE', entered: true });
  assert.equal(vm.canConfirmPayment, false, 'the refused one, typed in another case, is still the refused one');
});

test('Refunds to: a store that wants an address after a decline asks the person to pick one, never picks for them', async () => {
  const { vm, handed } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.onRefundPick({ declined: true });
  vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError('REFUND_ADDRESS_REQUIRED', ''); };
  await quietly(() => vm.confirmPayment());
  const row = vm.paymentSheetProps.refund;
  assert.deepEqual([row.problem, row.required, row.canDecline, row.declined, row.selected], ['required', true, false, false, null]);
  assert.equal(vm.canConfirmPayment, false, 'one more slide does not send the address just declined');
  vm.onRefundPick({ declined: true });
  assert.equal(vm.canConfirmPayment, false, 'declining is no longer possible');
  vm.onRefundPick({ address: 'shop@lnbits.example' });
  assert.equal(vm.canConfirmPayment, true);
  vm.fetchLightningAddressInvoice = async (address, sats, comment, payout, payerData) => {
    handed.push(['lnb', shared(payerData)]);
    return { pr: 'lnbc-resolved', invoiceSats: sats, successAction: null, verify: null, payerData: shared(payerData) };
  };
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed.at(-1), ['lnb', { identifier: 'shop@lnbits.example' }]);
});

test('Refunds to: "required" although an address went is the service\'s own words, in the usual dialog', async () => {
  const { vm, store } = refundHarness({ active: 'biz' });
  const said = [];
  store.showPaymentError = (error) => { said.push(error.message); };
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError('REFUND_ADDRESS_REQUIRED', ''); };
  const error = console.error;
  console.error = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
  assert.deepEqual(said, ['REFUND_ADDRESS_REQUIRED']);
  assert.equal(vm.paymentSheetProps.refund.problem, null);
});

test('Refunds to: a refusal that arrives after its payment left the sheet is said in the dialog, never on the next one', async () => {
  const { vm, store, played } = refundHarness({ active: 'biz' });
  const said = [];
  store.showPaymentError = (error) => { said.push(error.message); };
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  const next = lnAddressPayment({ payerData: { identifier: { mandatory: false } } });
  vm.fetchLightningAddressInvoice = async () => {
    vm.pendingPayment = next; // the sheet closed and another payment opened meanwhile
    throw errorOrigin.counterpartyError('REFUND_ADDRESS_REQUIRED', '');
  };
  const error = console.error;
  console.error = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
  assert.deepEqual(played, ['error']);
  assert.equal(said.length, 1, 'the failed till payment is said');
  assert.equal(vm.paymentSheetProps.refund, null, 'the next payment has no row');
  assert.equal(vm.refundRequiredByService, false);

  const closed = refundHarness({ active: 'biz' });
  closed.store.showPaymentError = () => {};
  Object.assign(closed.vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  closed.vm.fetchLightningAddressInvoice = async () => {
    closed.vm.showSendSheet = false; // closed, the payment still set
    throw errorOrigin.counterpartyError('Could not validate refund address', '');
  };
  console.error = () => {};
  try { await quietly(() => closed.vm.confirmPayment()); } finally { console.error = error; }
  assert.equal(closed.vm.refundRefusedAddress, null, 'nothing is written onto a closed sheet');
});

test('Refunds to: another payment on the sheet starts its row from nothing', () => {
  const { options } = refundHarness({ active: 'biz' });
  const watchers = [].concat(options.watch.pendingPayment);
  // A plain string: not deep, so an edit to the same payment keeps the pick.
  assert.ok(watchers.includes('resetRefundAddress'), 'a new payment resets the row');
});

test('Refunds to: an address that only said who paid is not kept as a refund address', async () => {
  const { vm, sent, guards } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: lnAddressPayment({ payerData: { identifier: { mandatory: true } } }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  assert.equal(vm.paymentSheetProps.refund.purpose, 'identify');
  await quietly(() => vm.confirmPayment());
  assert.equal(guards[0], null, 'no till: no host test');
  assert.equal(sent.links?.[0]?.refundAddress ?? null, null);
});

test('Refunds to: a till code\'s countdown waits for a payment already on its way', () => {
  const { vm } = refundHarness({ active: 'biz' });
  let tick;
  const setIntervalSaved = globalThis.setInterval;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  try {
    Object.assign(vm, { pendingPayment: tillPayment(), showSendSheet: true, isSendingPayment: true });
    vm.startMerchantCountdown();
    vm.merchantCountdown = 1;
    tick();
    assert.ok(vm.pendingPayment, 'still on the sheet while sending');
    assert.equal(vm.showSendSheet, true);
  } finally {
    globalThis.setInterval = setIntervalSaved;
    vm.stopMerchantCountdown();
  }
});

test('Refunds to: any other service that turns out to need your address gets a row, never quietly', async () => {
  const { vm, handed } = refundHarness({ active: 'biz' });
  Object.assign(vm, { pendingPayment: lnAddressPayment({ payerData: { identifier: { mandatory: false } } }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  assert.equal(vm.paymentSheetProps.refund, null, 'an optional address elsewhere: no row, nothing shared');
  vm.fetchLightningAddressInvoice = async (address, sats, comment, payout, payerData) => {
    handed.push(['lnb', shared(payerData)]);
    throw Object.assign(new Error('x'), { code: 'LNURL_PAYER_DATA_REQUIRED' });
  };
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed, [['lnb', null]], 'the first try shared nothing');
  const row = vm.paymentSheetProps.refund;
  assert.deepEqual([row.purpose, row.required, row.canDecline, row.holder, row.selected], ['identify', true, false, 'example.com', null]);
  assert.equal(vm.canConfirmPayment, false, 'the person chooses which address goes');
});

test('Refunds to: an ordinary refusal that mentions refunds is the usual error', async () => {
  const { vm, store } = refundHarness({ active: 'biz' });
  let shown = 0;
  store.showPaymentError = () => { shown += 1; };
  Object.assign(vm, { pendingPayment: lnAddressPayment(), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  vm.fetchLightningAddressInvoice = async () => { throw errorOrigin.counterpartyError('Could not validate refund address', ''); };
  const error = console.error;
  console.error = () => {};
  try { await quietly(() => vm.confirmPayment()); } finally { console.error = error; }
  assert.equal(shown, 1);
  assert.equal(vm.paymentSheetProps.refund, null);
});

test('Refunds to: a code that only looks like a till code never shares the address unasked', () => {
  const { vm } = refundHarness({ active: 'biz' });
  vm.identityStore = identityHere(); // the Social Bucket always at hand
  for (const extra of [
    { callbackOnTillProvider: false },
    { callbackOnTillProvider: false, callback: 'https://cryptoqr.net.evil.example/cb' },
    { callbackOnTillProvider: false, callback: 'http://cryptoqr.net/cb' },
    { callbackOnTillProvider: 'yes' },
    { source: 'scan', callbackOnTillProvider: true },
  ]) {
    Object.assign(vm, { pendingPayment: tillPayment(extra), sendingWalletId: 'biz', paymentAmount: '2500' });
    assert.equal(vm.paymentSheetProps.refund, null, JSON.stringify(extra));
    assert.equal(vm.refundAddress, null);
  }
  Object.assign(vm, { pendingPayment: tillPayment({ callbackOnTillProvider: undefined, callback: 'https://pay.cryptoqr.net/cb' }) });
  assert.equal(vm.paymentSheetProps.refund.purpose, 'refund', 'an NWC-read till keeps its callback, which is on the provider');
});

test('Refunds to: a withdrawal, an invoice or a Spark transfer never has the row', () => {
  const { vm } = refundHarness({ active: 'biz' });
  vm.identityStore = identityHere();
  for (const pendingPayment of [
    { ...tillPayment(), type: 'lnurl_withdraw' },
    { ...invoicePayment(), payerData: { identifier: { mandatory: true } } },
    { type: 'spark_address', data: 'spark1x', sparkAddress: 'spark1x', payerData: { identifier: { mandatory: true } } },
  ]) {
    Object.assign(vm, { pendingPayment, sendingWalletId: 'biz' });
    assert.equal(vm.payerRule.show, false, pendingPayment.type);
    assert.equal(vm.payerRule.blocked, false);
    assert.equal(vm.refundAddress, null);
  }
});

test('Refunds to: a service that requires details BuhoGO never shares cannot be paid', async () => {
  const { vm, handed } = refundHarness({ active: 'biz' });
  vm.identityStore = identityHere();
  Object.assign(vm, { pendingPayment: lnAddressPayment({ payerData: { identifier: { mandatory: true }, email: { mandatory: true } } }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  assert.equal(vm.paymentSheetProps.payerBlocked, true);
  assert.equal(vm.paymentSheetProps.refund, null);
  assert.equal(vm.canConfirmPayment, false);
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed, [], 'nothing was asked of the service');
});

test('Refunds to: with no address on any wallet or the profile, the Social Bucket takes the refund', async () => {
  const { vm, store, handed, sent } = refundHarness({ active: 'biz' });
  store.lightningAddressOf = () => null;
  vm.identityStore = identityHere();
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  assert.deepEqual(vm.refundOptions, [{ address: BUCKET_ADDRESS, source: 'bucket' }]);
  assert.equal(vm.paymentSheetProps.refund.selected, BUCKET_ADDRESS, 'the row shows it before the slide');
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed, [['biz', { identifier: BUCKET_ADDRESS }]]);
  assert.equal(sent.links?.[0]?.refundAddress, BUCKET_ADDRESS);
});

test('Refunds to: the Social Bucket is listed last, and a wallet\'s address stays the default', () => {
  const { vm } = refundHarness({ active: 'biz' });
  vm.identityStore = identityHere();
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'lnb', paymentAmount: '2500' });
  assert.equal(vm.refundAddress, OWN_ADDRESSES.lnb);
  assert.deepEqual(vm.refundOptions.at(-1), { address: BUCKET_ADDRESS, source: 'bucket' }, 'one tap away');
});

test('Refunds to: no Social Bucket where this phone cannot empty it', () => {
  const { vm, store } = refundHarness({ active: 'biz' });
  store.lightningAddressOf = () => null;
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  for (const [label, identityStore] of [
    ['a signer app holds the key', identityHere({ identityCapabilities: { rawKey: false } })],
    ['capabilities unknown', identityHere({ identityCapabilities: undefined })],
    ['no identity yet', identityHere({ bootstrapped: false })],
    ['no public code', identityHere({ nostrNpub: null })],
    ['not an npub', identityHere({ nostrNpub: 'nsec1secret' })],
    ['no identity store', undefined],
  ]) {
    vm.identityStore = identityStore;
    assert.equal(vm.socialBucketAddress, null, label);
    assert.equal(vm.refundAddress, null, label);
  }
});

test('Refunds to: a bucket a signer app holds is the profile\'s address, never called the Social Bucket', () => {
  const { vm, store } = refundHarness({ active: 'biz' });
  store.lightningAddressOf = () => null;
  vm.identityStore = identityHere({ identityCapabilities: { rawKey: false } });
  vm.profileStore = { hydrated: true, hydratedProfileKey: 'a', _profileStorageKey: () => 'a', lud16: BUCKET_ADDRESS };
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  assert.deepEqual(vm.refundOptions, [{ address: BUCKET_ADDRESS, source: 'profile' }]);
  vm.identityStore = identityHere();
  assert.deepEqual(vm.refundOptions, [{ address: BUCKET_ADDRESS, source: 'bucket' }], 'with the key here it is the bucket, listed once');
});

test('Refunds to: a service that only wants to know who paid never gets the Social Bucket unasked', async () => {
  const { vm, store, handed } = refundHarness({ active: 'biz' });
  store.lightningAddressOf = () => null;
  vm.identityStore = identityHere();
  Object.assign(vm, { pendingPayment: lnAddressPayment({ payerData: { identifier: { mandatory: true } } }), sendingWalletId: 'lnb', paymentAmount: '2500', sendSheetAmountSats: 2500 });
  assert.equal(vm.payerRule.purpose, 'identify');
  assert.deepEqual(vm.refundOptions, [], 'the bucket is for refunds only');
  assert.equal(vm.refundAddress, null);
  assert.equal(vm.canConfirmPayment, false, 'the person adds the address that goes');
  await quietly(() => vm.confirmPayment());
  assert.deepEqual(handed, []);
});

test('Refunds to: the profile\'s address counts only once the active identity\'s profile is read', () => {
  const { vm, store } = refundHarness({ active: 'biz' });
  store.lightningAddressOf = () => null;
  Object.assign(vm, { pendingPayment: tillPayment(), sendingWalletId: 'biz', paymentAmount: '2500' });
  vm.profileStore = { hydrated: true, hydratedProfileKey: 'b', _profileStorageKey: () => 'a', lud16: 'npub1abc@npub.cash' };
  assert.equal(vm.refundAddress, null, 'another identity\'s profile');
  vm.profileStore = { hydrated: true, hydratedProfileKey: 'a', _profileStorageKey: () => 'a', lud16: 'npub1abc@npub.cash' };
  assert.deepEqual(vm.refundOptions, [{ address: 'npub1abc@npub.cash', source: 'profile' }]);
  assert.equal(vm.canConfirmPayment, true);
});

test('the Home strip waits while a destination the Send sheet started still resolves', async () => {
  const { methods } = component({ '../services/addressRequestIntake.js': { offerAddressRequest: () => false } });
  const looked = [];
  const vm = {
    ...methods,
    clipboardPaymentPayload: (text) => ({ data: text, type: 'lightning_address', rawInput: text }),
    $t: (key) => key,
    $nextTick: (next) => next(),
    $refs: {},
    walletStore: { activeWalletType: 'spark' },
    clipboardResolving: false,
    sendResolving: true, // the person closed the sheet mid-lookup (it carries on)
    sendResolveError: '',
    showSendModal: false,
    onPaymentDetected: async (payload) => { looked.push(payload.data); },
  };
  await vm.useClipboardDestination('bob@example.org');
  assert.deepEqual(looked, [], 'no second lookup, whose confirm sheet could take the first one\'s place');
  assert.equal(vm.showSendModal, false, 'nor the sheet opened over it');
  vm.sendResolving = false;
  await vm.useClipboardDestination('bob@example.org');
  assert.deepEqual(looked, ['bob@example.org'], 'once it has landed, the strip goes on');
});

test('the Home strip pays a copied phone number it can place, and hands one valid in more than one country to the sheet', () => {
  const { methods } = component({ '../services/lnAddressServices': { matchLnAddressService: () => null, recognizePhoneNumber } });
  const payload = (text) => methods.clipboardPaymentPayload.call({ walletStore: { activeWalletType: 'spark' } }, text);
  for (const text of ['0712345678', '+254712345678', 'tel:+254712345678', 'tel:0712345678;phone-context=+254']) {
    assert.deepEqual(payload(text), { data: '254712345678@bitcoin.co.ke', type: 'lightning_address', rawInput: text }, text);
  }
  // Valid in Kenya, Zambia and Tanzania: no country is picked here. The sheet
  // takes the text (useDestination) and asks which.
  for (const text of ['0751234567', '075 123 4567']) {
    assert.equal(payload(text), null, text);
  }
  assert.deepEqual(payload('tel:0751234567;phone-context=+260')?.data, '260751234567@bitzed.xyz', 'the link names the country');
});
