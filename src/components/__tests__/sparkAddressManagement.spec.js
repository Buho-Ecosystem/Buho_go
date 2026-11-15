import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse, compileTemplate } from '@vue/compiler-sfc';

const { descriptor } = parse(readFileSync(new URL('../SparkLightningAddressSheet.vue', import.meta.url), 'utf8'));
assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'SparkLightningAddressSheet.vue', id: 'test' }).errors, []);
let store;
const module = { exports: {} };
const { code } = transformSync(descriptor.script.content, { format: 'cjs' });
new Function('require', 'module', 'exports', code)(name => ({
  '@iconify/vue': { Icon: {} },
  '../stores/wallet': { useWalletStore: () => store },
  '../config/breez': { BREEZ_LNURL_DOMAIN: 'btc.example.com' },
})[name], module, module.exports);
const component = module.exports.default;
function instance() {
  store.wallets ||= [{ id: 'main', metadata: {} }];
  if (!Object.hasOwn(store, 'currentAddress')) store.currentAddress = 'old@btc.example.com';
  store.lightningAddressOf ||= () => store.currentAddress;
  const emitted = [];
  const vm = { ...component.data(), addressWallet: store.wallets.find(wallet => wallet.id === 'main'), walletId: 'main', modelValue: true, $t: key => key,
    $nextTick: fn => fn(), $refs: {}, $emit: (...args) => emitted.push(args), $q: { notify() {} } };
  for (const [name, fn] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: () => fn.call(vm) });
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm);
  return { vm, emitted };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('a failed authoritative lookup shows recovery, never a first claim', async () => {
  store = { refreshSparkLightningAddress: async () => { throw new Error('offline'); } };
  const { vm } = instance();
  await vm.onOpen();
  assert.equal(vm.phase, 'error');
  assert.equal(vm.address, null);
  assert.match(vm.error, /Could not verify/);
});

test('invalid or cleared input invalidates an already running availability response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const edited of ['', 'a', 'invalid!']) {
    const answer = deferred();
    store = { providers: { main: { checkLightningAddressAvailable: () => answer.promise } } };
    const { vm } = instance();
    vm.username = 'available';
    vm.scheduleAvailabilityCheck();
    t.mock.timers.tick(400);
    vm.username = edited;
    vm.scheduleAvailabilityCheck();
    const expected = vm.availability;
    answer.resolve(true);
    await flush();
    assert.equal(vm.availability, expected);
    assert.notEqual(vm.availability, 'available');
  }
});

test('closing the sheet invalidates outstanding availability and loading responses', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answer = deferred();
  store = { refreshSparkLightningAddress: () => answer.promise };
  const { vm } = instance();
  const opening = vm.onOpen();
  component.watch.modelValue.call(vm, false);
  answer.resolve({ lightningAddress: 'old@btc.example.com' });
  await opening;
  assert.equal(vm.address, null);
});

test('review is separate from submission and a double submit cannot register twice', async () => {
  const answer = deferred();
  const calls = [];
  store = { renameSparkLightningAddress: (...args) => { calls.push(args); return answer.promise; } };
  const { vm, emitted } = instance();
  vm.address = 'old@btc.example.com'; vm.username = 'newname'; vm.availability = 'available'; vm.phase = 'change';
  vm.reviewUsername();
  assert.equal(vm.phase, 'review');
  assert.equal(calls.length, 0);
  const submitting = vm.submitUsername();
  await vm.submitUsername();
  vm.close(false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['main', 'newname', { expectedAddress: 'old@btc.example.com' }]);
  assert.equal(emitted.length, 0, 'dismissal is held while a mutation runs');
  store.currentAddress = 'newname@btc.example.com';
  answer.resolve({ lightningAddress: 'newname@btc.example.com' });
  await submitting;
  assert.equal(vm.phase, 'view');
  assert.equal(vm.updated, true);
  assert.deepEqual(emitted, [['changed', 'newname@btc.example.com']]);
});

test('an unknown result removes copyable data, explains recovery, and preserves the draft', async () => {
  store = {
    renameSparkLightningAddress: async () => { throw Object.assign(new Error('reply lost'), { code: 'LN_ADDRESS_UNCONFIRMED' }); },
    refreshSparkLightningAddress: async () => ({ lightningAddress: 'old@btc.example.com' }),
    providers: { main: { checkLightningAddressAvailable: async () => true } },
  };
  const { vm } = instance();
  vm.phase = 'review'; vm.address = 'old@btc.example.com'; vm.username = 'newname';
  await vm.submitUsername();
  assert.equal(vm.phase, 'error');
  assert.equal(vm.address, null);
  assert.match(vm.error, /Check the current address/);
  await vm.loadAddress();
  assert.equal(vm.username, 'newname');
  assert.equal(vm.phase, 'change');
  component.beforeUnmount.call(vm);
});

test('a store event invalidates the displayed address and keeps the draft for another review', () => {
  store = {};
  const { vm } = instance();
  vm.phase = 'review'; vm.address = store.currentAddress; vm.username = 'newname';
  store.currentAddress = 'elsewhere@btc.example.com';
  component.watch.currentAssignment.call(vm, vm.currentAssignment);
  assert.equal(vm.phase, 'error');
  assert.equal(vm.address, null);
  assert.equal(vm.username, 'newname');
  assert.match(vm.error, /current address changed/);
});

test('copy checks live ownership even before the store watcher runs', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => copied.push(value) } } });
  try {
    for (const change of ['rename', 'pending', 'removed', 'replaced']) {
      store = {};
      const { vm } = instance();
      vm.phase = 'view'; vm.address = store.currentAddress;
      if (change === 'rename') store.currentAddress = 'elsewhere@btc.example.com';
      if (change === 'pending') store.wallets[0].metadata.lightningAddressPending = true;
      if (change === 'removed') store.wallets = [];
      if (change === 'replaced') store.wallets = [{ id: 'main', metadata: {} }];
      await vm.copyAddress();
      assert.equal(vm.phase, 'error', change);
      assert.equal(vm.address, null, change);
    }
    assert.deepEqual(copied, []);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('wallet removal during submission invalidates the late successful reply', async () => {
  const answer = deferred();
  store = { renameSparkLightningAddress: () => answer.promise };
  const { vm, emitted } = instance();
  vm.phase = 'review'; vm.address = store.currentAddress; vm.username = 'newname';
  const submitting = vm.submitUsername();
  store.wallets = [];
  component.watch.currentAssignment.call(vm, vm.currentAssignment);
  answer.resolve({ lightningAddress: 'newname@btc.example.com' });
  await submitting;
  assert.equal(vm.phase, 'error');
  assert.equal(vm.address, null);
  assert.equal(vm.busy, false);
  assert.deepEqual(emitted, []);
});

test('an ownership change arriving before a lookup reply cannot restore a stale copyable address', async () => {
  const answer = deferred();
  store = { refreshSparkLightningAddress: () => answer.promise };
  const { vm } = instance();
  const opening = vm.onOpen();
  store.currentAddress = 'elsewhere@btc.example.com';
  answer.resolve({ lightningAddress: 'old@btc.example.com' });
  await opening;
  assert.equal(vm.phase, 'error');
  assert.equal(vm.address, null);
});
