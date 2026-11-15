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
  const emitted = [];
  const vm = { ...component.data(), walletId: 'main', modelValue: true, $t: key => key,
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
