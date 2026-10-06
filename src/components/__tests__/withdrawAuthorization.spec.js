import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as Vue from 'vue';
const source = compileScript(parse(readFileSync(new URL('../WithdrawAuthorization.vue', import.meta.url), 'utf8')).descriptor, { id: 'pin-test' }).content;
const { code } = transformSync(source, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
const request = { pinLimit: 50000, minWithdrawable: 1000, maxWithdrawable: 200000 };
async function settle() { for (let i = 0; i < 12; i++) await Vue.nextTick(); }
function harness(ctx, submit = async () => {}) {
  const calls = [];
  const module = { exports: {} };
  const dependencies = {
    vue: Vue, './PinEntryDialog.vue': {},
    '../stores/wallet': { useWalletStore: () => ({ exchangeRates: {}, useBip177Format: false }) },
    '../utils/amountFormatting.js': { formatAmount: amount => amount + ' sats' },
    '../utils/fiatRates': { fiatRatesService: {} },
    '../services/lnurlWithdraw.js': { submitWithdrawCallback: (...args) => { calls.push(args); return submit(...args); } },
  };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') });
  app.config.globalProperties.$t = (key, values = {}) => key.replace('{n}', values.n);
  const exposed = app.mount({ children: [] });
  const state = app._instance.setupState;
  ctx.after(() => app.unmount());
  return { ...exposed, submit: exposed.submit, cancel: exposed.cancel, state, calls, app };
}
test('below PIN limit submits directly; at the limit waits for PIN', async ctx => {
  const h = harness(ctx);
  await h.submit(request, 'invoice', 49);
  assert.equal(h.calls[0][2], null);
  const pending = h.submit(request, 'invoice', 50);
  assert.equal(h.state.visible, true);
  assert.equal(h.state.amountDisplay, '50 sats');
  assert.equal(h.calls.length, 1);
  h.state.enterPin('1234');
  await pending;
  assert.equal(h.calls[1][2], '1234');
  assert.equal(h.state.visible, false);
});
test('invalid PIN retries use the same invoice and stop after three attempts', async ctx => {
  const h = harness(ctx, async () => { throw Object.assign(new Error('Invalid PIN'), { code: 'INVALID_PIN' }); });
  const pending = h.submit(request, 'same-invoice', 100);
  const rejected = assert.rejects(pending, /incorrect PIN/);
  for (let attempt = 1; attempt <= 3; attempt++) {
    h.state.enterPin('0000');
    await settle();
    if (attempt < 3) assert.equal(h.state.visible, true);
  }
  await rejected;
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(call => call[1] === 'same-invoice'));
});
for (const event of ['cancel', 'timeout', 'unmount', 'sale changed']) {
  test(`${event} settles a pending PIN without submitting`, async ctx => {
    const h = harness(ctx), controller = new AbortController();
    const pending = h.submit(request, 'invoice', 100, { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    if (event === 'unmount') h.app.unmount();
    else if (event === 'sale changed') controller.abort();
    else h.cancel(); // Both UI events use this handler.
    await rejected;
    assert.equal(h.calls.length, 0);
  });
}
test('network errors do not automatically retry and concurrent submit is refused', async ctx => {
  const h = harness(ctx, async () => { throw new Error('network timeout'); });
  const pending = h.submit(request, 'invoice', 100);
  const rejected = assert.rejects(pending, /network timeout/);
  await assert.rejects(h.submit(request, 'second invoice', 100), /already in progress/);
  h.state.enterPin('1234');
  await rejected;
  assert.equal(h.calls.length, 1);
});
test('invalid sale amounts cannot reach the callback', async ctx => {
  const h = harness(ctx);
  await assert.rejects(h.submit(request, 'invoice', 300), /Invalid amount/);
  assert.equal(h.calls.length, 0);
});
