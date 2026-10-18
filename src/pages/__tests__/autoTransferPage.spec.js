import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';

const script = readFileSync(new URL('../AutoTransferPage.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const { code } = transformSync(script, { format: 'cjs' });
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
});
const wait = ms => new Promise(done => setTimeout(done, ms));

/**
 * Mount the page on `/auto-transfer?new=<walletId>`, the way a wallet's
 * details "Set Up" opens it. The router finishes a navigation a moment
 * later, and an open dialog closes when the route changes (QDialog without
 * no-route-dismiss), so the sheet must open only after the query is cleared.
 */
function mountAt(query) {
  const route = Vue.reactive({ query });
  const router = {
    replace(to) {
      return wait(5).then(() => { route.query = to.query; });
    },
    push() {},
  };
  const stub = { name: 'Stub', render: () => null };
  const dependencies = {
    '@iconify/vue': { Icon: stub },
    '../components/identity/IdentityNav.vue': stub,
    '../components/identity/IdentityGroup.vue': stub,
    '../components/identity/IdentityRow.vue': stub,
    '../components/settings/SettingsHubNav.vue': stub,
    '../components/WalletBrandMark.vue': stub,
    '../components/autoTransfer/AutoTransferSheet.vue': stub,
    '../stores/wallet': { useWalletStore: () => ({ wallets: [{ id: 'shop', name: 'Shop', type: 'spark' }], useBip177Format: true }) },
    '../stores/autoWithdraw': { useAutoWithdrawStore: () => ({ getConfig: () => null }) },
    '../utils/autoTransferCopy.js': { destinationLabel: () => '', statusText: () => ({ text: '', tone: '' }) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') });
  Object.assign(app.config.globalProperties, { $t: key => key, $i18n: { locale: 'en-US' }, $q: { dark: { isActive: false } }, $route: route, $router: router });
  const vm = app.mount({ children: [] });
  // The sheet's dialog: open when the route changes means dismissed.
  Vue.watch(() => route.query, () => { vm.sheetOpen = false; });
  return { app, vm, route };
}

test('Set Up from a wallet\'s details opens the New Rule sheet for that wallet', async (ctx) => {
  const { app, vm, route } = mountAt({ new: 'shop' });
  ctx.after(() => app.unmount());
  await wait(30);
  assert.deepEqual(route.query, {}, 'the query is cleared, so a reload does not open it again');
  assert.equal(vm.sheetOpen, true, 'the sheet stays open after the route settles');
  assert.equal(vm.newFor, 'shop');
});

test('the rules page on its own opens no sheet', async (ctx) => {
  const { app, vm } = mountAt({});
  ctx.after(() => app.unmount());
  await wait(30);
  assert.equal(vm.sheetOpen, false);
});
