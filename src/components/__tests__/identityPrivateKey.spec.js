import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { copySensitive, cancelPendingSensitiveClear } from '../../utils/sensitiveClipboard.js';

// Mount the real sheet script and shared clipboard helper. Only key access,
// authentication and browser permission enforcement are supplied by the test.
const { descriptor } = parse(readFileSync(new URL('../identity/IdentityPrivateKeySheet.vue', import.meta.url), 'utf8'));
const source = compileScript(descriptor, { id: 'private-key-test' }).content;
const { code } = transformSync(source, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText(node, text) { node.text = text; }, setText(node, text) { node.text = text; },
  parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

function harness() {
  let inClick = false;
  const h = {
    writes: [], requests: 0, accounts: [], authCalls: 0,
    available: async () => ({ available: true }),
    authenticate: async () => true,
    reveal: async () => ({ nsec: 'dummy secret' }),
    denyClipboard: false,
    acknowledge: async () => {},
  };
  const identity = Vue.reactive({ fingerprint: 'first', revealNostrSecret(account) {
    h.accounts.push(account);
    return h.reveal(account);
  } });
  const wallet = Vue.reactive({ biometricsEnabled: false });
  globalThis.ClipboardItem = class { constructor(data) { this.content = data['text/plain']; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    write([item]) {
      assert.ok(inClick, 'copy must request permission before the click returns');
      h.requests++;
      if (h.denyClipboard) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      return item.content.then(async blob => {
        h.writes.push(await blob.text());
        await h.acknowledge();
      }, () => { throw new DOMException('item rejected', 'NotAllowedError'); });
    },
    async writeText(text) { h.writes.push(text); },
  } } });
  const dependencies = {
    vue: Vue, '@iconify/vue': { Icon: {} },
    '../../stores/identity': { useIdentityStore: () => identity },
    '../../stores/wallet': { useWalletStore: () => wallet },
    '../../utils/biometric': {
      isBiometricAvailable: () => h.available(),
      authenticate: (...args) => { h.authCalls++; return h.authenticate(...args); },
    },
    '../../utils/sensitiveClipboard': { copySensitive },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  const Component = { ...module.exports.default, render: () => Vue.h('div') };
  const app = renderer.createApp(Component, { modelValue: true, account: 7, name: 'Test identity', npub: 'npub-test' });
  app.config.globalProperties.$t = key => key;
  app.mount({ children: [] });
  h.state = app._instance.setupState;
  h.props = app._instance.props;
  h.identity = identity;
  h.wallet = wallet;
  h.click = () => {
    inClick = true;
    try { return h.state.copyKey(); } finally { inClick = false; }
  };
  h.unmount = () => app.unmount();
  return h;
}

let passed = 0;
async function test(name, fn) {
  const h = harness();
  try {
    await fn(h);
    passed++;
    console.log(`  ✓ ${name}`);
  } finally {
    h.unmount();
    cancelPendingSensitiveClear();
  }
}

await test('requests clipboard access immediately, then derives the selected account', async h => {
  const key = deferred();
  h.reveal = () => key.promise;
  const copy = h.click();
  assert.equal(h.requests, 1);
  assert.deepEqual(h.writes, []);
  await settle();
  assert.deepEqual(h.accounts, [7]);
  key.resolve({ nsec: 'dummy secret' });
  await copy;
  assert.deepEqual(h.writes, ['dummy secret']);
  assert.equal(h.state.copied, true);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.error, '');
  assert.ok(!Object.values(h.state).includes('dummy secret'), 'secret must not live in component state');
});

await test('double-clicking while key access is pending starts only one copy', async h => {
  const key = deferred();
  h.reveal = () => key.promise;
  const copy = h.click();
  await h.click();
  assert.equal(h.requests, 1);
  key.resolve({ nsec: 'dummy secret' });
  await copy;
});

await test('authentication cancellation prevents key access and permits retry', async h => {
  h.wallet.biometricsEnabled = true;
  h.authenticate = async () => false;
  await h.click();
  assert.deepEqual(h.accounts, []);
  assert.deepEqual(h.writes, []);
  assert.equal(h.state.error, 'Unlock was not completed. Try again when you are ready.');
  assert.equal(h.state.busy, false);
  h.authenticate = async () => true;
  await h.click();
  assert.equal(h.authCalls, 2);
  assert.deepEqual(h.writes, ['dummy secret']);
  assert.equal(h.state.copied, true);
});

await test('key-access failure remains distinct even if the browser masks its error', async h => {
  h.reveal = async () => { throw new Error('decryption failed'); };
  await h.click();
  assert.equal(h.state.error, 'Private key could not be accessed. Please try again.');
  assert.deepEqual(h.writes, []);
  assert.equal(h.state.copied, false);
});

await test('clipboard denial is reported without secret data and allows retry', async h => {
  h.denyClipboard = true;
  await h.click();
  assert.equal(h.state.error, 'Clipboard access failed. Please try copying again.');
  assert.equal(h.state.copied, false);
  h.denyClipboard = false;
  await h.click();
  assert.equal(h.state.error, '');
  assert.equal(h.state.copied, true);
});

for (const [name, invalidate] of Object.entries({
  'selected account changes': h => { h.props.account = 8; },
  'seed identity changes': h => { h.identity.fingerprint = 'replacement'; },
  'dialog closes': h => { h.props.modelValue = false; },
  'sheet unmounts': h => h.unmount(),
})) {
  await test(`${name} during decryption prevents copying the stale key`, async h => {
    const key = deferred();
    h.reveal = () => key.promise;
    const copy = h.click();
    await settle();
    invalidate(h);
    key.resolve({ nsec: 'stale secret' });
    await copy;
    assert.deepEqual(h.writes, []);
    assert.equal(h.state.copied, false);
    assert.equal(h.state.error, '');
  });
}

await test('closing during authentication prevents subsequent key access', async h => {
  const auth = deferred();
  h.wallet.biometricsEnabled = true;
  h.authenticate = () => auth.promise;
  const copy = h.click();
  await settle();
  assert.equal(h.authCalls, 1);
  h.props.modelValue = false;
  auth.resolve(true);
  await copy;
  assert.deepEqual(h.accounts, []);
  assert.deepEqual(h.writes, []);
});

await test('closing during availability probe prevents an obsolete unlock prompt', async h => {
  const availability = deferred();
  h.wallet.biometricsEnabled = true;
  h.available = () => availability.promise;
  const copy = h.click();
  await settle();
  h.props.modelValue = false;
  availability.resolve({ available: true });
  await copy;
  assert.equal(h.authCalls, 0);
  assert.deepEqual(h.accounts, []);
});

await test('a late clipboard acknowledgment cannot mark a different account copied', async h => {
  const acknowledgment = deferred();
  h.acknowledge = () => acknowledgment.promise;
  const copy = h.click();
  await settle();
  assert.deepEqual(h.writes, ['dummy secret']);
  h.props.account = 8;
  acknowledgment.resolve();
  await copy;
  assert.equal(h.state.copied, false);
  assert.equal(h.state.error, '');
});

console.log(`\n  ${passed} private-key component tests passed`);
