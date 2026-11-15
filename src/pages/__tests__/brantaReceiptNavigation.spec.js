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

test('the saved check is a sheet over the receipt: the page keeps no back handling of its own', () => {
  // The dialog owns Back, Escape and focus return, like every other sheet here.
  for (const name of ['onReceiptBack', 'onBrantaEscape', 'guardBrantaNavigation']) assert.equal(page.methods[name], undefined, name);
  for (const hook of ['beforeRouteLeave', 'beforeRouteUpdate', 'mounted']) assert.equal(page[hook], undefined, hook);
  assert.equal(page.watch.showBrantaVerification, undefined);
  assert.equal('verificationPopPending' in page.data.call({ $route: { params: {}, query: {} } }), false);
  const template = source.match(/<template>([\s\S]*)<\/template>/)[1];
  assert.match(template, /<q-dialog v-model="showBrantaVerification" position="bottom">[\s\S]*?form-sheet-grabber[\s\S]*?<BrantaVerificationDetails[\s\S]*?context="historical"/);
  assert.doesNotMatch(template, /v-show="!showBrantaVerification"|@keydown\.esc/);
  assert.match(template, /@click="\$router\.back\(\)"/, 'Back always leaves the receipt');
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
