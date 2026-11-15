import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { reactive, watch } from 'vue';
import { createLatestTransactionPreview } from '../../services/latestTransactionPreview.js';
import { readLatestTransactionHistory } from '../../services/latestTransactionHistory.js';
import { normalizeTx } from '../../services/txNormalizer.js';

// Exercise the production page's watchers and controller wiring, rather than
// reproducing receipt handling in a test-only component.
const source = readFileSync(new URL('../Wallet.vue', import.meta.url), 'utf8');
const { code } = transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' });
const module = { exports: {} };
const deps = {
  '../services/latestTransactionPreview.js': { createLatestTransactionPreview },
  '../services/latestTransactionHistory.js': { readLatestTransactionHistory },
  '../services/txNormalizer.js': { normalizeTx },
  '../utils/txCache.js': { readCachedTransactions: () => [], mergeCachedTransactions() {} },
};
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
const component = module.exports.default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = (id, amount = 21) => ({ id, type: 'incoming', amount, status: 'completed', timestamp: Date.now() / 1000 });

function harness(t, { type = 'lnbits', owner } = {}) {
  const stops = [];
  const store = reactive({
    wallets: [{ id: 'A', type }, { id: 'B', type: 'lnbits' }], activeWalletId: 'A',
    owners: { A: owner, B: { async listPayments() { return [row('B-payment')]; } } },
    preferredFiatCurrency: 'USD', confirmedReceiveActivity: null, recent: {},
    get activeWallet() { return this.wallets.find(w => w.id === this.activeWalletId); },
    getProvider(id) { return this.owners[id]; }, walletEpoch() { return 0; },
    latestConfirmedReceive(id) { return this.recent[id] || null; },
  });
  const vm = {
    ...component.methods, walletStore: store,
    transactionMetadataStore: {
      getFiatAtSettlementForTransaction() { return null; },
      async consumePendingContactLinks() {}, async stampFreshTransactions() {},
    },
    $watch(source, callback, options) { const stop = watch(source, callback, options); stops.push(stop); return stop; },
  };
  Object.defineProperty(vm, 'activeWallet', { get: () => component.computed.activeWallet.call(vm) });
  Object.defineProperty(vm, 'lastPreviewContext', { get: () => component.computed.lastPreviewContext.call(vm) });
  vm.initializeTransactionPreview();
  t.after(() => { stops.forEach(stop => stop()); vm._transactionPreview.dispose(); });
  const receive = activity => {
    const value = { walletId: 'A', amountSats: 21, observedAt: Date.now(), sequence: 1, revision: 1, ...activity };
    store.recent[value.walletId] = value;
    store.confirmedReceiveActivity = value;
  };
  return { store, vm, receive };
}

test('Home acknowledges a confirmed receive synchronously and re-reads without the periodic timer', async t => {
  let rows = [row('old')], calls = 0, hold = null;
  const h = harness(t, { owner: { async listPayments() { calls++; return hold ? hold.promise : rows; } } });
  await flush();
  assert.equal(h.vm.lastTransaction.id, 'old');
  const before = calls;
  hold = deferred();
  h.receive({ paymentId: 'received' });
  assert.equal(h.vm.latestTransactionState.phase, 'receipt');
  assert.equal(h.vm.latestTransactionState.receipt.amountSats, 21);
  await flush();
  assert.equal(calls, before + 1);
  hold.resolve([row('received')]);
  await flush();
  assert.equal(h.vm.latestTransactionState.phase, 'ready');
  assert.equal(h.vm.lastTransaction.id, 'received');
});

test('NWC Home reads the live store connection rather than the providers map', async t => {
  let calls = 0;
  const h = harness(t, { type: 'nwc', owner: { async listTransactions() {
    calls++; return { transactions: [{ ...row('nwc-payment'), payment_hash: 'ab'.repeat(32), settled_at: Date.now() / 1000 }] };
  } } });
  await flush();
  assert.equal(calls, 1);
  assert.equal(h.vm.lastTransaction.type, 'incoming');
  assert.equal(h.vm.latestTransactionState.phase, 'ready');
});

test('wallet selection invalidates an old read synchronously and uses the new wallet immediately', async t => {
  const old = deferred();
  const h = harness(t, { owner: { listPayments: () => old.promise } });
  await flush();
  h.store.activeWalletId = 'B';
  assert.equal(h.vm.latestTransactionState.walletId, 'B');
  await flush();
  assert.equal(h.vm.lastTransaction.id, 'B-payment');
  old.resolve([row('old-A')]);
  await flush();
  assert.equal(h.vm.lastTransaction.id, 'B-payment');
  assert.equal(h.vm.latestTransactionState.walletId, 'B');
});

test('a replaced provider cannot publish its late row over the replacement', async t => {
  const old = deferred();
  const h = harness(t, { owner: { listPayments: () => old.promise } });
  await flush();
  h.store.owners.A = { async listPayments() { return [row('replacement')]; } };
  await flush();
  old.resolve([row('stale')]);
  await flush();
  assert.equal(h.vm.lastTransaction.id, 'replacement');
});
