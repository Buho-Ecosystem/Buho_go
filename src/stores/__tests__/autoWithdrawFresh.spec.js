/**
 * Auto-withdraw moves money only on a just-verified balance, and only if the
 * rule, the wallet and its connection are unchanged once that read returns
 * (ported from the PR #296/#297 review).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function load() {
  const { code } = transformSync(readFileSync(new URL('../autoWithdraw.js', import.meta.url), 'utf8'), { format: 'cjs' });
  const deps = {
    pinia: { defineStore: (_, options) => options },
    './transactionMetadata': { useTransactionMetadataStore: () => ({ addTagToTransaction: async () => {}, setNoteForTransaction: async () => {} }) },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', ARKADE: 'arkade', NWC: 'nwc', LNBITS: 'lnbits' } },
    '../utils/lnurlHttp.js': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((n) => deps[n] || {}, module, module.exports);
  const options = module.exports.useAutoWithdrawStore;
  const store = { ...options.state(), ...options.actions };
  store.persistConfigs = async () => {};
  return store;
}

function setup() {
  const aw = load();
  const read = deferred();
  const sends = [];
  const provider = { getBalance: () => read.promise };
  const wallet = { id: 'W', type: 'spark', name: 'Business' };
  const walletStore = { wallets: [wallet], providers: { W: provider }, walletEpoch: () => 0 };
  aw.configs = { W: { enabled: true, thresholdSats: 1000, payoutType: 'lightning', lightningAddress: 'me@example.com' } };
  aw._executeSparkPayout = async (key, amount) => { sends.push(amount); return { id: 'p' }; };
  return { aw, read, sends, walletStore, provider };
}

test('a fresh-read failure skips the trigger instead of sending from a stale figure', async () => {
  const { aw, read, sends, walletStore } = setup();
  walletStore.providers.W.getBalance = async () => { throw Object.assign(new Error('Spark did not answer the sync'), { code: 'BREEZ_SYNC_UNVERIFIED' }); };
  read.resolve();
  await aw.checkAndExecute('W', 50000, walletStore);
  assert.deepEqual(sends, []);
});

test('turning the rule off while the verified read is pending prevents the send', async () => {
  const { aw, read, sends, walletStore } = setup();
  const run = aw.checkAndExecute('W', 50000, walletStore);
  aw.configs.W.enabled = false;
  read.resolve({ balance: 50000, fresh: true });
  await run;
  assert.deepEqual(sends, []);
});

test('a rebuilt connection or removed wallet during the read prevents the send', async () => {
  for (const change of ['rebuild', 'remove']) {
    const { aw, read, sends, walletStore } = setup();
    const run = aw.checkAndExecute('W', 50000, walletStore);
    if (change === 'rebuild') walletStore.providers.W = { getBalance: async () => ({ balance: 1 }) };
    else walletStore.wallets = [];
    read.resolve({ balance: 50000, fresh: true });
    await run;
    assert.deepEqual(sends, [], change);
  }
});

test('unchanged conditions send from the verified balance', async () => {
  const { aw, read, sends, walletStore } = setup();
  const run = aw.checkAndExecute('W', 999999, walletStore); // stale caller figure
  read.resolve({ balance: 20000, fresh: true });
  await run;
  assert.deepEqual(sends, [Math.floor(20000 * 0.97)], 'amount from the verified read, not the caller');
});
