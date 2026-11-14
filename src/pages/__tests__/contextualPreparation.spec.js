import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the production dispatcher with controlled metadata promises. No wallet
// connection or payment service is allowed during recipient preparation.
const source = readFileSync(new URL('../Wallet.vue', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
const module = { exports: {} };
const dependencies = {
  '../utils/merchantQR.js': { SA_RETAIL_SOURCE: 'sa-retail', isTillAddress: () => false },
  '../utils/lud4.js': { looksLikeLud04: input => input.startsWith('keyauth:') },
  '../utils/lightningInvoice.js': { parseLightningInvoice: () => ({ amount: 1000, description: 'Invoice' }) },
  '../utils/sparkPayment.js': {
    decodeSparkDestination: () => ({ kind: 'invoice', invoice: 'spark-invoice', receiverAddress: 'spark-recipient', amountSats: 1000 }),
    identityPublicKeyFromSparkAddress: () => 'preferred-identity',
    sparkInvoiceProblem: () => 'sender_mismatch',
  },
};
new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports);
const methods = module.exports.default.methods;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const terms = { lnurlType: 'payRequest', minSendable: 1000, maxSendable: 1000000, callback: 'https://recipient.example/cb', metadata: '[["text/plain","For Alice"]]' };
function harness() {
  const settled = [];
  const vm = {
    ...methods,
    paymentOnly: true, _preparationAttempt: 1, sendResolveError: '', pendingPayment: null,
    $t: key => key,
    isContextualAttemptCurrent(token) { return token === this._preparationAttempt; },
    finishContextualPreparation(...args) { settled.push(args); },
    failSendResolution(message, fromField) { assert.equal(fromField, true); this.sendResolveError = message; },
    chooseSendingWalletId(_type, requested) { return requested || 'missing-preferred'; },
    walletTypeOf: () => null,
    preferNativeBip21Rail: payment => payment,
    getPaymentAmountForFee: () => 0,
    fetchLightningAddressInfo: async () => terms,
    fetchLNURLInfo: async () => terms,
    resolveNostrTarget: async () => null,
    runBrantaVerification() {}, runNostrRecipientEnrichment() {},
    returnAfterPayment() { assert.fail('preparation stays over the original screen'); },
    getNwcUrl() { assert.fail('reading a recipient must not require a connection'); },
    openIdentityAuthFromLnurl() { assert.fail('contact payment must not open authentication'); },
    resetWithdrawState() { assert.fail('contact payment must not open withdrawal'); },
    walletStore: { showPaymentError() { assert.fail('preparation failures are inline'); } },
  };
  return { vm, settled };
}

test('a missing preferred wallet does not block resolving checked terms or silently select another', async () => {
  const { vm, settled } = harness();
  await vm.onPaymentDetected({ type: 'lightning_address', data: 'alice@example.com', sendingWalletId: 'missing-preferred' });
  assert.equal(vm.pendingPayment.callback, terms.callback);
  assert.equal(vm.pendingPayment.metadata, terms.metadata);
  assert.equal(vm.sendingWalletId, 'missing-preferred');
  assert.equal(vm.showSendSheet, true);
  assert.deepEqual(settled, [[true, '']]);
});

test('cancelled address and LNURL lookups never replace a newer payment or settle its state', async () => {
  for (const type of ['lightning_address', 'lnurl']) {
    const { vm, settled } = harness();
    const lookup = deferred();
    vm[type === 'lnurl' ? 'fetchLNURLInfo' : 'fetchLightningAddressInfo'] = () => lookup.promise;
    const run = vm.onPaymentDetected({ type, data: 'recipient' });
    vm._preparationAttempt += 1;
    const newer = vm.pendingPayment = { data: 'new recipient' };
    vm.sendResolving = true;
    lookup.resolve(terms);
    await run;
    assert.equal(vm.pendingPayment, newer, type);
    assert.equal(vm.sendResolving, true, 'old finally cannot clear a new attempt');
    assert.equal(vm.showSendSheet, undefined);
    assert.deepEqual(settled, []);
  }
});

test('a cancelled Nostr lookup or NIP-05 rescue cannot redispatch or overwrite a new payment', async () => {
  for (const type of ['nostr_identifier', 'lightning_address']) {
    const { vm, settled } = harness();
    const lookup = deferred();
    vm.fetchLightningAddressInfo = async () => ({});
    vm.resolveNostrTarget = () => lookup.promise;
    const run = vm.onPaymentDetected({ type, data: 'alice@example.com' });
    await Promise.resolve();
    vm._preparationAttempt += 1;
    lookup.resolve({ address: 'other@example.com', kind: 'lightning_address' });
    await run;
    assert.equal(vm.pendingPayment, null);
    assert.deepEqual(settled, []);
  }
});

test('a late rejected lookup cannot show an error on the next payment', async () => {
  const { vm, settled } = harness();
  const lookup = deferred();
  vm.fetchLightningAddressInfo = () => lookup.promise;
  const run = vm.onPaymentDetected({ type: 'lightning_address', data: 'alice@example.com' });
  vm._preparationAttempt += 1;
  vm.sendResolveError = 'new state';
  lookup.reject(new Error('old network failure'));
  await run;
  assert.equal(vm.sendResolveError, 'new state');
  assert.deepEqual(settled, []);
});

test('authentication, withdraw and unsupported links fail in the same payment sheet', async () => {
  for (const payment of [
    { type: 'lnurl', data: 'keyauth://recipient.example' },
    { type: 'lnurl', data: 'lnurl-withdraw', withdraw: true },
    { type: 'silent_payment', data: 'sp1unsupported' },
    { type: 'bolt12_offer', data: 'lno1unsupported' },
  ]) {
    const { vm, settled } = harness();
    if (payment.withdraw) vm.fetchLNURLInfo = async () => ({ lnurlType: 'withdrawRequest' });
    await vm.onPaymentDetected(payment);
    assert.equal(vm.pendingPayment, null);
    assert.equal(vm.showWithdrawSheet, undefined);
    assert.equal(settled.length, 1);
    assert.equal(settled[0][0], false);
    assert.match(settled[0][1], /cannot be used for a payment/);
  }
});

test('a sender-pinned Spark invoice reaches wallet choice even if the preferred identity differs', async () => {
  const { vm, settled } = harness();
  vm.walletStore.getSparkAddress = () => 'different-sender';
  vm.walletBalanceOf = () => 0;
  await vm.onPaymentDetected({ type: 'spark_address', data: 'spark-invoice' });
  assert.equal(vm.pendingPayment.sparkInvoice, 'spark-invoice');
  assert.equal(vm.pendingPayment.fixedAmountSats, 1000);
  assert.equal(vm.sendingWalletId, 'missing-preferred');
  assert.deepEqual(settled, [[true, '']]);
});
