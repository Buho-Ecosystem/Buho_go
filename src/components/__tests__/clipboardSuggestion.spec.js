import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as helpers from '../../utils/clipboardSuggestion.js';
import { createClipboardOfferSession } from '../../utils/clipboardOfferSession.js';

// Execute the actual SFC script with native bridges stubbed. Vue's renderer
// supplies real mounting, injected-ref unwrapping, watchers and nextTick.
const source = parse(readFileSync(new URL('../ClipboardSuggestion.vue', import.meta.url), 'utf8')).descriptor.script.content;
function loadModule(source, dependencies) {
  const { code } = transformSync(source, {
    format: 'cjs', supported: { 'dynamic-import': false },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }),
  createText: (text) => ({ text }),
  createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter((child) => child !== node); },
  setElementText(node, text) { node.text = text; },
  setText(node, text) { node.text = text; },
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  patchProp() {},
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function settle() {
  for (let i = 0; i < 12; i += 1) await Vue.nextTick();
}

function harness({ platform = 'android', storageFails = false } = {}) {
  const state = {
    text: 'alice@example.com', reads: 0, now: 10000,
    focused: true, dialog: false, listener: null, listeners: 0,
    wait: async () => {}, read: async () => state.text,
  };
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem(key, value) {
      if (storageFails) throw new Error('quota');
      store.set(key, value);
    },
  };
  const memory = helpers.createClipboardOfferMemory(storage);
  const locked = Vue.ref(false);
  const observers = new Set();
  globalThis.document = {
    hasFocus: () => state.focused,
    body: { classList: { contains: () => state.dialog } },
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  };
  const Component = loadModule(source, {
    vue: Vue,
    '@capacitor/core': { Capacitor: { getPlatform: () => platform } },
    '@capacitor/app': { App: { addListener: async (_, callback) => {
      state.listener = callback;
      state.listeners += 1;
      return { remove() {} };
    } } },
    '../stores/wallet': { useWalletStore: () => ({ activeWalletType: 'spark' }) },
    '../utils/shopClipboard.js': { readClipboardForSuggestion: () => {
      state.reads += 1;
      return state.read();
    } },
    '../utils/clipboardSuggestion.js': { ...helpers, createClipboardOfferMemory: () => memory },
    '../utils/clipboardOfferSession.js': { createClipboardOfferSession: (options) => createClipboardOfferSession({
      ...options, wait: (ms) => state.wait(ms), now: () => state.now,
    }) },
  }).default;
  const apps = new Set();
  function mount() {
    const app = renderer.createApp({ ...Component, render() { return Vue.h('div', this.offered); } });
    app.provide('appLocked', locked);
    const vm = app.mount({ children: [] });
    apps.add(app);
    return { vm, unmount() { app.unmount(); apps.delete(app); } };
  }
  async function resume(text = state.text) {
    state.listener({ isActive: false });
    state.now += 2000;
    state.text = text;
    state.listener({ isActive: true });
    await settle();
  }
  return {
    state, memory, locked, mount, resume,
    async dialog(open) {
      state.dialog = open;
      for (const callback of observers) callback();
      await settle();
    },
    close() { for (const app of apps) app.unmount(); },
  };
}

async function test(name, run) {
  await run();
  console.log(`  ✓ ${name}`);
}

await test('same clipboard stays quiet across routes and resume, even without storage', async () => {
  for (const storageFails of [false, true]) {
    const h = harness({ storageFails });
    const first = h.mount();
    await settle();
    assert.equal(first.vm.offered, 'alice@example.com');
    first.unmount();
    const second = h.mount();
    await settle();
    assert.equal(second.vm.offered, null);
    assert.equal(h.state.reads, 1);
    assert.equal(h.state.listeners, 1);
    await h.resume();
    assert.equal(second.vm.offered, null);
    h.close();
  }
});

await test('unmount before focus delay does not read or consume the offer', async () => {
  const h = harness();
  const delay = deferred();
  h.state.wait = () => delay.promise;
  h.mount().unmount();
  delay.resolve();
  await settle();
  assert.equal(h.state.reads, 0);
  assert.equal(h.memory.hasBeenOffered(h.state.text), false);
  const home = h.mount();
  await settle();
  assert.equal(home.vm.offered, h.state.text);
  h.close();
});

await test('a completed read waits for the next Home without remembering an unseen offer', async () => {
  const h = harness();
  const reading = deferred();
  h.state.read = () => reading.promise;
  const first = h.mount();
  await settle();
  first.unmount();
  reading.resolve(h.state.text);
  await settle();
  assert.equal(h.memory.hasBeenOffered(h.state.text), false);
  const second = h.mount();
  await settle();
  assert.equal(second.vm.offered, h.state.text);
  assert.equal(h.state.reads, 1);
  h.close();
});

await test('navigation during Vue rendering does not mark an unseen offer as consumed', async () => {
  const h = harness();
  const first = h.mount();
  Vue.watch(() => first.vm.offered, (text) => { if (text) first.unmount(); }, { flush: 'sync' });
  await settle();
  assert.equal(h.memory.hasBeenOffered(h.state.text), false);
  const next = h.mount();
  await settle();
  assert.equal(next.vm.offered, h.state.text);
  assert.equal(h.state.reads, 1);
  h.close();
});

await test('ordinary text and a confirmed empty clipboard re-arm the same address', async () => {
  for (const changed of ['ordinary text', '']) {
    const h = harness();
    const home = h.mount();
    await settle();
    home.vm.dismiss();
    await h.resume(changed);
    assert.equal(home.vm.offered, null);
    await h.resume('alice@example.com');
    assert.equal(home.vm.offered, 'alice@example.com');
    h.close();
  }
});

await test('failed reads preserve memory and do not revive a dismissed banner', async () => {
  const h = harness();
  const home = h.mount();
  await settle();
  home.vm.dismiss();
  h.state.read = async () => { throw new Error('denied'); };
  await h.resume();
  h.state.read = async () => h.state.text;
  await h.resume();
  assert.equal(home.vm.offered, null);
  h.close();
});

await test('an injected lock and an open dialog defer reads until Home is usable', async () => {
  const h = harness();
  h.locked.value = true;
  const home = h.mount();
  await settle();
  assert.equal(h.state.reads, 0);
  await h.dialog(true);
  h.locked.value = false;
  await settle();
  assert.equal(h.state.reads, 0);
  await h.dialog(false);
  assert.equal(home.vm.offered, h.state.text);
  h.close();
});

await test('a dialog opening during a read defers display and persistence', async () => {
  const h = harness();
  const reading = deferred();
  h.state.read = () => reading.promise;
  const home = h.mount();
  await settle();
  await h.dialog(true);
  reading.resolve(h.state.text);
  await settle();
  assert.equal(home.vm.offered, null);
  assert.equal(h.memory.hasBeenOffered(h.state.text), false);
  await h.dialog(false);
  assert.equal(home.vm.offered, h.state.text);
  assert.equal(h.state.reads, 1);
  h.close();
});

await test('backgrounding invalidates an in-flight read and offers the new clipboard on return', async () => {
  const h = harness();
  const reading = deferred();
  h.state.read = () => reading.promise;
  const home = h.mount();
  await settle();
  h.state.listener({ isActive: false });
  reading.resolve('old@example.com');
  await settle();
  assert.equal(home.vm.offered, null);
  assert.equal(h.memory.hasBeenOffered('old@example.com'), false);
  h.state.now += 2000;
  h.state.read = async () => 'new@example.com';
  h.state.listener({ isActive: true });
  await settle();
  assert.equal(home.vm.offered, 'new@example.com');
  h.close();
});

await test('a return on another route is checked on the next Home mount', async () => {
  const h = harness();
  const first = h.mount();
  await settle();
  first.unmount();
  await h.resume('bob@example.com');
  assert.equal(h.state.reads, 1);
  const next = h.mount();
  await settle();
  assert.equal(next.vm.offered, 'bob@example.com');
  h.close();
});

await test('short system interruptions and duplicate resume events do not reread', async () => {
  const h = harness();
  h.mount();
  await settle();
  h.state.listener({ isActive: false });
  h.state.now += 1000;
  h.state.listener({ isActive: true });
  h.state.listener({ isActive: true });
  await settle();
  assert.equal(h.state.reads, 1);
  await h.resume('bob@example.com');
  h.state.listener({ isActive: true });
  await settle();
  assert.equal(h.state.reads, 2);
  h.close();
});

await test('a remount while the bridge is pending shares the existing read', async () => {
  const h = harness();
  const reading = deferred();
  h.state.read = () => reading.promise;
  const first = h.mount();
  await settle();
  first.unmount();
  const next = h.mount();
  await settle();
  assert.equal(h.state.reads, 1);
  reading.resolve(h.state.text);
  await settle();
  assert.equal(next.vm.offered, h.state.text);
  assert.equal(h.state.reads, 1);
  h.close();
});

await test('iOS and web never register an automatic clipboard reader', async () => {
  for (const platform of ['ios', 'web']) {
    const h = harness({ platform });
    h.mount();
    await settle();
    assert.equal(h.state.reads, 0);
    assert.equal(h.state.listeners, 0);
    h.close();
  }
});

await test('the passive bridge distinguishes empty clipboard from unavailable access', async () => {
  const bridgeSource = readFileSync(new URL('../../utils/shopClipboard.js', import.meta.url), 'utf8');
  let platform = 'android';
  let read = async () => ({ value: '  alice@example.com  ' });
  const bridge = loadModule(bridgeSource, {
    '@capacitor/core': { Capacitor: { getPlatform: () => platform } },
    '@capacitor/clipboard': { Clipboard: { read: () => read() } },
  });
  assert.equal(await bridge.readClipboardForSuggestion(), 'alice@example.com');
  read = async () => { throw new Error('There is no data on the clipboard'); };
  assert.equal(await bridge.readClipboardForSuggestion(), '');
  read = async () => { throw new Error('denied'); };
  assert.equal(await bridge.readClipboardForSuggestion(), null);
  platform = 'ios';
  read = () => assert.fail('iOS must not read automatically');
  assert.equal(await bridge.readClipboardForSuggestion(), null);
});

console.log('ClipboardSuggestion lifecycle: all assertions passed');
