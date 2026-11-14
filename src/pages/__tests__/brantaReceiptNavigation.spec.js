import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../TransactionDetails.vue', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
const page = module.exports.default;

test('receipt header Back returns from verification without leaving the payment', () => {
  let leaves = 0;
  const vm = { showBrantaVerification: true, $router: { back: () => leaves++ } };
  page.methods.onReceiptBack.call(vm);
  assert.equal(vm.showBrantaVerification, false);
  assert.equal(leaves, 0);
  page.methods.onReceiptBack.call(vm);
  assert.equal(leaves, 1);
});

test('history Back closes only the open child; the next Back leaves normally', () => {
  const results = [];
  const vm = { showBrantaVerification: true, verificationPopPending: true };
  page.methods.guardBrantaNavigation.call(vm, result => results.push(result));
  assert.deepEqual(results, [false]);
  assert.equal(vm.showBrantaVerification, false);
  assert.equal(vm.verificationPopPending, false);
  page.methods.guardBrantaNavigation.call(vm, result => results.push(result));
  assert.deepEqual(results, [false, undefined]);
});

test('ordinary navigation is never cancelled by an open verification', () => {
  let result = 'not called';
  const vm = { showBrantaVerification: true, verificationPopPending: false };
  page.methods.guardBrantaNavigation.call(vm, value => { result = value; });
  assert.equal(result, undefined);
  assert.equal(vm.showBrantaVerification, false);
});

test('leaving the route and changing a receipt share the same navigation guard', () => {
  for (const name of ['beforeRouteLeave', 'beforeRouteUpdate']) {
    const next = () => {};
    let received;
    page[name].call({ guardBrantaNavigation: value => { received = value; } }, {}, {}, next);
    assert.equal(received, next);
  }
});

test('receipt identity changes close the disclosure; an unchanged receipt keeps it open', () => {
  const vm = { showBrantaVerification: true };
  page.watch.brantaReceiptContext.handler.call(vm);
  assert.equal(vm.showBrantaVerification, false);
  const receipt = { name: 'Northstar' };
  vm.showBrantaVerification = true;
  page.watch.merchantVerification.call(vm, receipt, receipt);
  assert.equal(vm.showBrantaVerification, true);
  page.watch.merchantVerification.call(vm, null, receipt);
  assert.equal(vm.showBrantaVerification, false);
});

test('opening focuses Back and returning restores the exact verification control', async () => {
  const focused = [];
  const vm = {
    $nextTick: async () => {},
    $refs: {
      receiptBack: { $el: { focus: () => focused.push('back') } },
      brantaVerificationButton: { focus: () => focused.push('verification') },
    },
  };
  await page.watch.showBrantaVerification.call(vm, true);
  await page.watch.showBrantaVerification.call(vm, false);
  assert.deepEqual(focused, ['back', 'verification']);
});

test('Escape closes verification without consuming unrelated page key events', () => {
  const calls = [];
  const event = { preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
  const vm = { showBrantaVerification: false };
  page.methods.onBrantaEscape.call(vm, event);
  assert.deepEqual(calls, []);
  vm.showBrantaVerification = true;
  page.methods.onBrantaEscape.call(vm, event);
  assert.equal(vm.showBrantaVerification, false);
  assert.deepEqual(calls, ['prevent', 'stop']);
});

test('an incoming history row cannot inherit an outgoing business sharing its id', () => {
  const history = readFileSync(new URL('../TransactionHistory.vue', import.meta.url), 'utf8');
  const method = history.match(/    getTxVerifiedBusiness\(tx\) \{[\s\S]*?\n    \},/)[0];
  const getBusiness = new Function('brantaAvatar', 'return ({' + method + '}).getTxVerifiedBusiness')(() => null);
  const reads = [];
  const vm = {
    historyWalletId: 'personal',
    metadataStore: { getMerchantVerificationForTransaction: (...args) => { reads.push(args); return { name: 'Northstar' }; } },
  };
  assert.equal(getBusiness.call(vm, { id: 'shared-id', type: 'incoming' }), null);
  assert.deepEqual(reads, []);
  assert.equal(getBusiness.call(vm, { id: 'shared-id', type: 'outgoing' }).name, 'Northstar');
  assert.deepEqual(reads, [['shared-id', 'personal']]);
});

test('historical branding requires the loaded receipt context and wallet, including shared ids', () => {
  const reads = [];
  const vm = {
    transaction: { id: 'canonical-id', type: 'outgoing' },
    metadataWalletId: 'personal', loadedReceiptWalletId: 'personal',
    $route: { fullPath: '/transaction/provider-alias?wallet=personal' },
    loadedReceiptContext: '/transaction/provider-alias?wallet=personal',
    metadataStore: { getMerchantVerificationForTransaction: (...args) => { reads.push(args); return { name: 'Northstar' }; } },
  };
  assert.equal(page.computed.merchantVerification.call(vm).name, 'Northstar', 'provider id aliases are valid in the loaded context');
  vm.$route.fullPath = '/transaction/new?wallet=reserve';
  vm.metadataWalletId = 'reserve';
  assert.equal(page.computed.merchantVerification.call(vm), null);
  vm.$route.fullPath = vm.loadedReceiptContext;
  assert.equal(page.computed.merchantVerification.call(vm), null, 'a wallet change alone cannot rebrand the old receipt');
  assert.deepEqual(reads, [['canonical-id', 'personal']]);
});

test('a delayed receipt load cannot publish a new verification context after navigation or disposal', async () => {
  for (const change of ['navigation', 'wallet', 'disposed']) {
    const vm = {
      $route: { fullPath: '/transaction/old' }, metadataWalletId: 'personal',
      loadTransactionDetails: async function () {
        if (change === 'navigation') this.$route.fullPath = '/transaction/new';
        if (change === 'wallet') this.metadataWalletId = 'reserve';
        if (change === 'disposed') this._receiptDisposed = true;
      },
      loadDeveloperModePreference: () => assert.fail('stale receipt must not continue'),
      resolveDeliveryStatus: () => assert.fail('stale receipt must not continue'),
    };
    await page.methods.initializeTransactionDetails.call(vm);
    assert.equal(vm.loadedReceiptContext, '');
    assert.equal(vm.loadedReceiptWalletId, null);
  }
});
