/**
 * The Auto-Transfer engine (stores/autoWithdraw.js) with the real rules
 * (utils/autoTransfer.js) and stand-ins for wallets, providers and rates.
 *
 * Money moves only on a just-verified balance, and only if the rule, the
 * wallet and its connection are unchanged once that read returns (from the
 * PR #296/#297 review). Fiat amounts convert with a recent rate or not at
 * all. Every outcome lands in the rule's recent activity.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as rules from '../../utils/autoTransfer.js';

const LN = 'shop@getalby.com';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

function load({ rates = { USD: 50_000 }, rateAge = 2 } = {}) {
  const { code } = transformSync(readFileSync(new URL('../autoWithdraw.js', import.meta.url), 'utf8'), { format: 'cjs' });
  const stamps = [];
  const deps = {
    pinia: { defineStore: (_, options) => options },
    './transactionMetadata': {
      useTransactionMetadataStore: () => ({
        addTagToTransaction: async (...args) => stamps.push(['tag', ...args]),
        setSourceForTransaction: async (...args) => stamps.push(['source', ...args]),
        setLabelForTransaction: async (...args) => stamps.push(['label', ...args]),
      }),
    },
    '../providers/WalletFactory': { WALLET_TYPES: { SPARK: 'spark', ARKADE: 'arkade', NWC: 'nwc', LNBITS: 'lnbits' } },
    '../utils/autoWithdrawKeys.js': { migratePocketConfigKeys: (configs) => ({ configs, moved: [], dropped: [] }) },
    '../utils/nwcErrors.js': { NWC_ERROR: { UNCONFIRMED: 'NWC_PAYMENT_UNCONFIRMED' } },
    '../utils/fiatRates.js': {
      fiatRatesService: {
        getRates: async () => rates,
        areRatesAvailable: () => !!rates,
        getRateAge: () => rateAge,
      },
    },
    '../utils/autoTransfer.js': rules,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useAutoWithdrawStore;
  const store = { ...options.state(), ...options.actions };
  store.stamps = stamps;
  return store;
}

let nextId = 0;
/** One Spark wallet "Shop" with a rule, a second Spark wallet "Savings". */
function setup({ rule = {}, rates, rateAge, shopType = 'spark' } = {}) {
  const aw = load({ rates, rateAge });
  const id = `shop-${nextId++}`; // the engine's cooldowns are module-wide
  const read = deferred();
  const sent = [];
  const provider = {
    getBalance: () => read.promise,
    payLightningAddress: async (address, amount) => { sent.push(['lightning', address, amount]); return { id: 'ln-tx' }; },
    transferToSparkAddress: async (address, amount) => { sent.push(['spark', address, amount]); return { id: 'sp-tx' }; },
    getWithdrawalFeeQuote: async (amount, address) => { sent.push(['quote', address, amount]); return { medium: { feeQuoteId: 'q1', totalFee: 1_400 } }; },
    withdrawToL1: async (request) => { sent.push(['bitcoin', request]); return { requestId: 'l1-tx' }; },
  };
  const shop = { id, type: shopType, name: 'Shop' };
  const savings = { id: 'savings', type: 'spark', name: 'Savings' };
  const walletStore = {
    wallets: [shop, savings],
    providers: { [id]: provider },
    walletEpoch: () => 0,
    getProvider: (walletId) => walletStore.providers[walletId],
    transferBetweenWallets: async (from, to, amount, memo, stamp) => { sent.push(['wallet', from, to, amount, stamp]); return { transactionId: 'int-tx' }; },
  };
  aw.configs = { [id]: rules.normalizeRule({ enabled: true, threshold: { sats: 1_000 }, destination: { kind: 'lightning', address: LN }, ...rule }) };
  return { aw, id, read, sent, provider, walletStore };
}

const events = (aw, id) => aw.configs[id].events.map(({ outcome, reason, amount }) => [outcome, reason ?? amount]);

test('a fresh-read failure skips the transfer instead of sending from a stale figure', async () => {
  const { aw, id, sent, walletStore } = setup();
  walletStore.providers[id].getBalance = async () => { throw Object.assign(new Error('Spark did not answer'), { code: 'BREEZ_SYNC_UNVERIFIED' }); };
  await aw.checkAndExecute(id, 50_000, walletStore);
  assert.deepEqual(sent, []);
  assert.deepEqual(events(aw, id), [['skipped', 'balance_unverified']]);
});

test('a sync that just finished confirms the balance: no second sync right behind it (#430)', async () => {
  const { aw, id, sent, provider, walletStore } = setup();
  let freshSyncs = 0;
  provider.lastSyncedAt = () => Date.now() - 5_000; // the lifecycle's sync that triggered this run
  provider.getCachedBalance = async () => ({ balance: 15_962 });
  provider.getBalance = async () => { freshSyncs += 1; throw Object.assign(new Error('rate limited'), { code: 'BREEZ_SYNC_UNVERIFIED' }); };
  await aw.checkAndExecute(id, 15_962, walletStore);
  assert.equal(freshSyncs, 0, 'the recent sync is enough');
  assert.equal(sent.length, 1, 'the transfer runs');
  assert.deepEqual(events(aw, id)[0][0], 'sent');
});

test('an older sync is not enough: the balance is synced fresh first', async () => {
  const { aw, id, read, sent, provider, walletStore } = setup();
  let cachedReads = 0;
  provider.lastSyncedAt = () => Date.now() - 5 * 60_000;
  provider.getCachedBalance = async () => { cachedReads += 1; return { balance: 99_999 }; };
  const run = aw.checkAndExecute(id, 20_000, walletStore);
  read.resolve({ balance: 20_000 });
  await run;
  assert.equal(cachedReads, 0);
  assert.deepEqual(sent, [['lightning', LN, 19_800]]);
});

test('a failed check keeps its cause, and repeats stay one line that remembers when they began (#430)', async () => {
  const { aw, id, walletStore } = setup();
  walletStore.providers[id].getBalance = async () => { throw Object.assign(new Error('breez sync timeout'), { code: 'BREEZ_SYNC_TIMEOUT' }); };
  await aw.checkAndExecute(id, 50_000, walletStore);
  const first = aw.configs[id].events[0];
  assert.equal(first.detail, 'BREEZ_SYNC_TIMEOUT');
  walletStore.providers[id].getBalance = async () => { throw new Error('Spark wallet is not connected'); };
  await aw.tryNow(id, { ...walletStore, getDisplayBalance: () => ({ balance: 50_000 }) });
  const [row, ...rest] = aw.configs[id].events;
  assert.equal(rest.length, 0, 'one line');
  assert.equal(row.detail, 'Spark wallet is not connected', 'a message without a code is kept as text');
  assert.equal(row.since, first.at);
});

test('turning the rule off, rebuilding the connection or removing the wallet during the read prevents the send', async () => {
  for (const change of ['off', 'rebuild', 'remove']) {
    const { aw, id, read, sent, walletStore } = setup();
    const run = aw.checkAndExecute(id, 50_000, walletStore);
    await new Promise((r) => setImmediate(r));
    if (change === 'off') await aw.setEnabled(id, false);
    if (change === 'rebuild') walletStore.providers[id] = { getBalance: async () => ({ balance: 1 }) };
    if (change === 'remove') walletStore.wallets = walletStore.wallets.slice(1);
    read.resolve({ balance: 50_000 });
    await run;
    assert.deepEqual(sent, [], change);
  }
});

test('the amount comes from the verified read, less the Lightning reserve, and is recorded', async () => {
  const { aw, id, read, sent, walletStore } = setup();
  const run = aw.checkAndExecute(id, 999_999, walletStore); // the caller's figure may be stale
  read.resolve({ balance: 20_000 });
  await run;
  assert.deepEqual(sent, [['lightning', LN, 19_800]], '1% held back for the routing fee');
  assert.deepEqual(events(aw, id), [['sent', 19_800]]);
  assert.deepEqual(aw.lastResult, { walletId: id, amount: 19_800, destinationName: LN });
  assert.deepEqual(aw.stamps.map(([kind, , , value]) => [kind, value]), [['tag', 'auto-withdraw'], ['source', 'auto-transfer'], ['label', LN]]);
  assert.ok(storage.get('buhoGO_auto_withdraw').includes('"outcome":"sent"'), 'activity is saved');
});

test('"Keep some" leaves an amount behind, and a fiat amount converts at the current rate', async () => {
  const { aw, id, read, sent, walletStore } = setup({ rule: { threshold: { fiat: 10, currency: 'USD' }, keep: { fiat: 5, currency: 'USD' } } });
  const run = aw.checkAndExecute(id, 25_000, walletStore);
  read.resolve({ balance: 25_000 });
  await run;
  // $10 = 20,000 sats at $50,000; keep $5 = 10,000; 15,000 available, 1% reserve.
  assert.deepEqual(sent, [['lightning', LN, 14_850]]);
});

test('a fiat rule never converts with a missing or old rate: it waits and says so', async () => {
  for (const [rates, rateAge] of [[null, 2], [{ USD: 50_000 }, 120]]) {
    const { aw, id, read, sent, walletStore } = setup({ rates, rateAge, rule: { threshold: { fiat: 10, currency: 'USD' } } });
    read.resolve({ balance: 99_000 });
    await aw.checkAndExecute(id, 99_000, walletStore);
    assert.deepEqual(sent, []);
    assert.deepEqual(events(aw, id), [['skipped', 'no_rate']]);
  }
});

test('a fiat rule just below its threshold runs on the next balance that passes it, without a cooldown', async () => {
  const { aw, id, read, sent, walletStore } = setup({ rule: { threshold: { fiat: 10, currency: 'USD' } } });
  await aw.checkAndExecute(id, 19_000, walletStore); // $9.50: not yet
  const run = aw.checkAndExecute(id, 21_000, walletStore);
  read.resolve({ balance: 21_000 });
  await run;
  assert.equal(sent.length, 1);
});

test('to another wallet on this phone: free between Spark wallets, stamped as an Auto-Transfer', async () => {
  const { aw, id, read, sent, walletStore } = setup({ rule: { destination: { kind: 'wallet', walletId: 'savings' } } });
  const run = aw.checkAndExecute(id, 50_000, walletStore);
  read.resolve({ balance: 50_000 });
  await run;
  assert.deepEqual(sent, [['wallet', id, 'savings', 50_000, { source: 'auto-transfer', label: 'Savings' }]]);
  assert.equal(aw.lastResult.destinationName, 'Savings');
});

test('on-chain: the fee is quoted, then the withdrawal includes it', async () => {
  const { aw, id, read, sent, walletStore } = setup({ rule: { destination: { kind: 'bitcoin', address: BTC } } });
  const run = aw.checkAndExecute(id, 100_000, walletStore);
  read.resolve({ balance: 100_000 });
  await run;
  assert.deepEqual(sent[0], ['quote', BTC, 50_000], 'half is quoted: the whole balance leaves nothing for the fee');
  assert.deepEqual(sent[1], ['bitcoin', {
    amountSats: 100_000, destinationAddress: BTC, speed: 'medium', feeQuoteId: 'q1', feeAmountSats: 1_400, deductFeeFromWithdrawalAmount: true,
  }]);
  assert.deepEqual(events(aw, id), [['sent', 98_600]], 'what arrives');
});

test('a destination the wallet can no longer pay is reported, not attempted', async () => {
  const { aw, id, sent, walletStore } = setup({ shopType: 'arkade' });
  walletStore.ensureArkadeConnected = async () => { throw new Error('must not connect'); };
  await aw.checkAndExecute(id, 50_000, walletStore);
  assert.deepEqual(sent, []);
  assert.deepEqual(events(aw, id), [['skipped', 'cannot_pay']]);
  assert.equal(rules.ruleStatus(aw.configs[id]).kind, 'attention');
});

test('a payment with an unknown outcome waits 10 minutes, a failed one retries after 15 s, five in a row pause the rule', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  for (const [code, retriesAfter16s] of [['NWC_PAYMENT_UNCONFIRMED', false], ['PAYMENT_FAILED', true]]) {
    const { aw, id, provider, walletStore } = setup();
    provider.getBalance = async () => ({ balance: 50_000 });
    let attempts = 0;
    provider.payLightningAddress = async () => { attempts += 1; throw Object.assign(new Error('x'), { code }); };
    await aw.checkAndExecute(id, 50_000, walletStore);
    t.mock.timers.tick(16_000);
    await aw.checkAndExecute(id, 50_000, walletStore);
    assert.equal(attempts, retriesAfter16s ? 2 : 1, code);
    if (!retriesAfter16s) {
      t.mock.timers.tick(10 * 60_000);
      await aw.checkAndExecute(id, 50_000, walletStore);
      assert.equal(attempts, 2, 'tried again once the hold is over');
      continue;
    }
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(16_000); await aw.checkAndExecute(id, 50_000, walletStore); }
    assert.equal(attempts, 5, 'paused after the fifth failure in a row');
    assert.equal(aw.configs[id].enabled, false);
    assert.equal(aw.configs[id].pausedReason, 'failures');

    provider.payLightningAddress = async () => ({ id: 'ok' });
    walletStore.getDisplayBalance = () => ({ balance: 50_000 });
    await aw.tryNow(id, walletStore);
    assert.equal(aw.configs[id].enabled, true, 'Try Again switches it back on');
    assert.equal(aw.configs[id].failureStreak, 0);
    assert.equal(rules.ruleStatus(aw.configs[id]).kind, 'sent');
  }
});

test('a wallet that leaves this phone takes its rule along and pauses the rules that sent to it', async () => {
  const { aw, id } = setup();
  aw.configs.savings = rules.normalizeRule({ enabled: true, threshold: { sats: 5 }, destination: { kind: 'wallet', walletId: id } });
  await aw.forgetWallet(id);
  assert.equal(aw.configs[id], undefined);
  assert.equal(aw.configs.savings.enabled, false);
  assert.equal(aw.configs.savings.pausedReason, 'destination_removed');
});

test('saving a rule switches it on and lifts a pause; old saved rules load in today\'s shape', async () => {
  const { aw, id } = setup();
  aw.configs[id] = { ...aw.configs[id], enabled: false, pausedReason: 'failures', failureStreak: 5, events: [{ at: 1, outcome: 'failed', reason: 'offline' }] };
  await aw.saveRule(id, { threshold: { fiat: 200, currency: 'eur' }, keep: null, destination: { kind: 'wallet', walletId: 'savings' } });
  assert.deepEqual(
    [aw.configs[id].enabled, aw.configs[id].pausedReason, aw.configs[id].failureStreak, aw.configs[id].threshold, aw.configs[id].events.length],
    [true, null, 0, { fiat: 200, currency: 'EUR' }, 1],
  );

  storage.set('buhoGO_auto_withdraw', JSON.stringify({ configs: { old: { enabled: true, thresholdSats: 100000, payoutType: 'lightning', lightningAddress: LN } } }));
  const fresh = load();
  await fresh.initialize({ wallets: [] });
  assert.deepEqual(fresh.configs.old.threshold, { sats: 100000 });
  assert.deepEqual(fresh.configs.old.destination, { kind: 'lightning', address: LN });
  assert.ok(storage.get('buhoGO_auto_withdraw').includes('"destination"'), 'saved back in the new shape');
});
