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
  '../stores/paymentPreferences': { settledWalletIds: store => store.hydrated ? store.wallets.map(wallet => wallet.id) : null },
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
  const stages = [];
  const vm = {
    ...methods,
    paymentOnly: true, _preparationAttempt: 1, sendResolveError: '', pendingPayment: null,
    preparationState: 'preparing', preparationError: '', preparationRetryable: true,
    paymentIntent: { id: 7 },
    paymentFlow: { setStage: (id, stage) => { stages.push([id, stage]); return true; } },
    $t: key => key,
    isContextualAttemptCurrent(token = this._preparationAttempt) { return token === this._preparationAttempt; },
    // The production methods run: only their calls are recorded.
    finishContextualPreparation(...args) { settled.push(args); return methods.finishContextualPreparation.apply(this, args); },
    failSendResolution(message, fromField, options) { assert.equal(fromField, true); return methods.failSendResolution.call(this, message, fromField, options); },
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
  return { vm, settled, stages };
}

test('a missing preferred wallet does not block resolving checked terms or silently select another', async () => {
  const { vm, settled } = harness();
  await vm.onPaymentDetected({ type: 'lightning_address', data: 'alice@example.com', sendingWalletId: 'missing-preferred' });
  assert.equal(vm.pendingPayment.callback, terms.callback);
  assert.equal(vm.pendingPayment.metadata, terms.metadata);
  assert.equal(vm.sendingWalletId, 'missing-preferred');
  assert.equal(vm.showSendSheet, true);
  assert.deepEqual(settled, [[true, null]]);
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
    // What the person reads is the reason itself, and no second try is
    // offered for a destination that can never become a payment.
    assert.equal(vm.preparationState, 'error');
    assert.match(vm.preparationError, /cannot be used for a payment/);
    assert.equal(vm.preparationRetryable, false);
  }
});

test('a lookup that failed for now keeps its own words and offers another try', async () => {
  const { vm, stages } = harness();
  vm.fetchLightningAddressInfo = async () => ({ error: 'The service is busy', attribution: 'recipient' });
  await vm.onPaymentDetected({ type: 'lightning_address', data: 'alice@example.com' });
  assert.equal(vm.preparationState, 'error');
  assert.notEqual(vm.preparationError, 'Please try again in a moment.');
  assert.ok(vm.preparationError.length > 0);
  assert.equal(vm.preparationRetryable, true);
  assert.deepEqual(stages.at(-1), [7, 'error']);
});

function preparing(intent) {
  const { vm, stages } = harness();
  const forgotten = [];
  Object.assign(vm, {
    isSendingPayment: false, _walletsReady: Promise.resolve(), paymentIntent: { id: 7, ...intent },
    paymentPreferences: { forgetMissing(ids) { forgotten.push(ids); } }, walletStore: { hydrated: true, wallets: [{ id: 'main' }] },
    onPaymentDetected() { assert.fail('a failed lookup never reaches the payment pipeline'); },
  });
  return { vm, stages, forgotten };
}

test('a handed-over lookup that fails says its own reason and whether another try can help', async () => {
  for (const [failure, expected] of [
    [{ message: 'This request can no longer be paid.', retryable: false }, { text: 'This request can no longer be paid.', retryable: false }],
    [{ message: "Their Lightning address didn't answer. Try again in a moment.", retryable: true }, { text: "Their Lightning address didn't answer. Try again in a moment.", retryable: true }],
    // A surface without words of its own, or with broken ones, gets the general line and a retry.
    [null, { text: 'Please try again in a moment.', retryable: true }],
    [{ message: '' }, { text: 'Please try again in a moment.', retryable: true }],
  ]) {
    const cause = new Error('lookup failed');
    const seen = [];
    const { vm, stages } = preparing({
      resolve: async () => { throw cause; },
      describeError: (error) => { seen.push(error); return failure; },
    });
    await vm.prepareContextualPayment();
    clearTimeout(vm._preparationSlowTimer);
    assert.deepEqual(seen, [cause]);
    assert.equal(vm.preparationState, 'error');
    assert.equal(vm.preparationError, expected.text);
    assert.equal(vm.preparationRetryable, expected.retryable);
    assert.deepEqual(stages.at(-1), [7, 'error']);
  }
});

test('a describer that throws, or none at all, still ends in the general retry line', async () => {
  for (const intent of [
    { resolve: async () => { throw new Error('x'); }, describeError: () => { throw new Error('broken'); } },
    { resolve: async () => { throw new Error('x'); } },
  ]) {
    const { vm } = preparing(intent);
    await vm.prepareContextualPayment();
    clearTimeout(vm._preparationSlowTimer);
    assert.equal(vm.preparationError, 'Please try again in a moment.');
    assert.equal(vm.preparationRetryable, true);
  }
});

test('a retry clears the last reason before it asks again, and passes the cancel signal on', async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const { vm, forgotten } = preparing({ signal, address: 'alice@example.com', resolve: async (options) => { calls.push(options); return { address: 'alice@example.com' }; } });
  vm.onPaymentDetected = async () => {};
  vm.preparationError = 'old reason'; vm.preparationRetryable = false; vm.preparationState = 'error';
  const run = vm.prepareContextualPayment();
  assert.equal(vm.preparationError, '');
  assert.equal(vm.preparationRetryable, true);
  assert.equal(vm.preparationState, 'preparing');
  await run;
  clearTimeout(vm._preparationSlowTimer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal, signal);
  // A default wallet that left this phone is cleared before the paying wallet is picked.
  assert.deepEqual(forgotten, [['main']]);
});

test('a sender-pinned Spark invoice reaches wallet choice even if the preferred identity differs', async () => {
  const { vm, settled } = harness();
  vm.walletStore.getSparkAddress = () => 'different-sender';
  vm.walletBalanceOf = () => 0;
  await vm.onPaymentDetected({ type: 'spark_address', data: 'spark-invoice' });
  assert.equal(vm.pendingPayment.sparkInvoice, 'spark-invoice');
  assert.equal(vm.pendingPayment.fixedAmountSats, 1000);
  assert.equal(vm.sendingWalletId, 'missing-preferred');
  assert.deepEqual(settled, [[true, null]]);
});
