/**
 * The Social Bucket's destination list (#392): every wallet is listed, but
 * only one that can receive Lightning can be chosen, is picked by default,
 * or lets the move start.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { parse } from '@vue/compiler-sfc';

function loadSheet() {
  const source = readFileSync(new URL('../identity/SocialBucketSheet.vue', import.meta.url), 'utf8');
  const { code } = transformSync(parse(source).descriptor.script.content, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports.default;
}

const sheet = loadSheet();

/** A sheet instance: its computed values read through, as Vue would. */
function mount(wallets, { activeWalletId = wallets[0]?.id, canSweep = true } = {}) {
  const vm = {
    walletStore: { activeWalletId, getTransferableWallets: () => wallets },
    bucket: { canSweep, isSweeping: false, sync: async () => {} },
    identity: {},
    selectedWalletId: null, showWallets: false, moveIssue: null,
    $t: (text) => text, $emit() {},
  };
  for (const [name, def] of Object.entries(sheet.computed)) {
    const get = typeof def === 'function' ? def : def.get;
    Object.defineProperty(vm, name, { get: () => get.call(vm), configurable: true });
  }
  for (const [name, fn] of Object.entries(sheet.methods)) vm[name] = fn.bind(vm);
  return vm;
}

// As store.getTransferableWallets() marks them (its own spec covers the rule).
const spark = { id: 'spark', type: 'spark', name: 'Spark', balance: 10, canReceive: true };
const sendOnly = { id: 'send-only', type: 'nwc', name: 'Hub', balance: 0, canReceive: false };
const sendOnlyToo = { id: 'send-only-2', type: 'nwc', name: 'Shop', balance: 0, canReceive: false };

test('every wallet is listed; the ones that cannot receive are marked', () => {
  const vm = mount([sendOnly, spark]);
  assert.deepEqual(vm.wallets.map((w) => w.id), ['send-only', 'spark']);
  assert.deepEqual(vm.receivingWallets.map((w) => w.id), ['spark']);
});

test('the default is the wallet in use when it can receive, else the first that can', async () => {
  const usable = mount([sendOnly, spark], { activeWalletId: 'spark' });
  await sheet.watch.modelValue.call(usable, true);
  assert.equal(usable.selectedWalletId, 'spark');

  const fallback = mount([sendOnly, spark], { activeWalletId: 'send-only' });
  await sheet.watch.modelValue.call(fallback, true);
  assert.equal(fallback.selectedWalletId, 'spark');
  assert.equal(fallback.canMove, true);
});

test('a wallet that cannot receive cannot be chosen', async () => {
  const vm = mount([sendOnly, spark], { activeWalletId: 'spark' });
  await sheet.watch.modelValue.call(vm, true);
  vm.selectWallet('send-only');
  assert.equal(vm.selectedWalletId, 'spark');
});

test('with no wallet able to receive there is nothing to move to', async () => {
  const vm = mount([sendOnly, sendOnlyToo]);
  await sheet.watch.modelValue.call(vm, true);
  assert.equal(vm.selectedWalletId, null);
  assert.equal(vm.selectedWallet, null);
  assert.equal(vm.canMove, false);
});

test('a destination that stops receiving while the sheet is open is replaced, not kept', async () => {
  const wallets = [{ ...spark }, { id: 'tips', type: 'nwc', name: 'Tips', balance: 0, canReceive: true }];
  const vm = mount(wallets, { activeWalletId: 'spark' });
  await sheet.watch.modelValue.call(vm, true);
  assert.equal(vm.selectedWalletId, 'spark');
  // A refresh reads the grants again: Spark stays, but say the chosen one lost receiving.
  wallets[0].canReceive = false;
  sheet.watch.receivingWallets.call(vm, vm.receivingWallets);
  assert.equal(vm.selectedWalletId, 'tips');
  assert.equal(vm.canMove, true);
});

test('a wallet that becomes able to receive while nothing could is taken', async () => {
  const wallets = [{ ...sendOnly }];
  const vm = mount(wallets);
  await sheet.watch.modelValue.call(vm, true);
  assert.equal(vm.selectedWalletId, null);
  wallets[0].canReceive = true; // a refresh found make_invoice
  sheet.watch.receivingWallets.call(vm, vm.receivingWallets);
  assert.equal(vm.selectedWalletId, 'send-only');
  assert.equal(vm.canMove, true);
});
