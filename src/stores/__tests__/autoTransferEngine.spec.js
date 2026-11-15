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
import * as paymentOutcome from '../../utils/paymentOutcome.js';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as rules from '../../utils/autoTransfer.js';
import { settleRulesForWallets } from '../../utils/autoWithdrawKeys.js';
import { PAY_REQUEST, invoiceFor, lnurlPayWith } from '../../utils/__tests__/lnurlPayFixtures.js';

const LN = 'shop@getalby.com';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

function load({ rates = { USD: 50_000 }, rateAge = 2, deps: extra = {} } = {}) {
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
    '../utils/autoWithdrawKeys.js': { migratePocketConfigKeys: (configs) => ({ configs, moved: [], dropped: [] }), settleRulesForWallets },
    '../utils/paymentOutcome.js': paymentOutcome,
    '../utils/fiatRates.js': {
      fiatRatesService: {
        getRates: async () => rates,
        areRatesAvailable: () => !!rates,
        getRateAge: () => rateAge,
      },
    },
    '../utils/autoTransfer.js': rules,
    // The address answers with a typical pay request: the engine reads its limits before a transfer.
    '../utils/lnurlPay.js': lnurlPayWith(async () => ({ ok: true, status: 200, data: PAY_REQUEST })),
    ...extra,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
  const options = module.exports.useAutoWithdrawStore;
  const store = { ...options.state(), ...options.actions };
  for (const [name, getter] of Object.entries(options.getters)) {
    Object.defineProperty(store, name, { get: () => getter(store) });
  }
  store.stamps = stamps;
  return store;
}

let nextId = 0;
/** One Spark wallet "Shop" with a rule, a second Spark wallet "Savings". */
function setup({ rule = {}, rates, rateAge, shopType = 'spark', deps } = {}) {
  const aw = load({ rates, rateAge, deps });
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
  for (const [code, retriesAfter16s] of [['NWC_PAYMENT_UNCONFIRMED', false], ['PAYMENT_UNCONFIRMED', false], ['PAYMENT_FAILED', true]]) {
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

test('from LNbits or NWC, a Lightning address is paid only with an invoice for the rule\'s amount', async () => {
  // The service answers the pay request, then an invoice: for the amount
  // asked, for more, or with a refusal sent as an HTTP 500.
  for (const shopType of ['lnbits', 'nwc']) {
    for (const [answer, outcome] of [['honest', 'sent'], ['greedy', 'failed'], ['refusal', 'failed']]) {
      const asked = [];
      const get = async (url) => {
        asked.push(url);
        // The pay request is read for its limits, and again by the payment itself.
        if (!new URL(url).searchParams.has('amount')) return { ok: true, status: 200, data: PAY_REQUEST };
        if (answer === 'refusal') return { ok: false, status: 500, data: { status: 'ERROR', reason: 'Wallet frozen' } };
        const sats = Number(new URL(url).searchParams.get('amount')) / 1000;
        return { ok: true, status: 200, data: { pr: invoiceFor(answer === 'greedy' ? sats * 10 : sats) } };
      };
      const paid = [];
      const { aw, id, provider, walletStore } = setup({ shopType, deps: {
        '../utils/lnurlPay.js': lnurlPayWith(get),
        '../services/nwcPayment.js': { payWithNwc: async (nwc, invoice) => { paid.push(invoice); return { payment_hash: 'h' }; } },
      } });
      provider.getBalance = async () => ({ balance: 50_000 });
      // An LNbits server from before the fee reserve could be asked for.
      walletStore.ensureLNBitsConnected = async () => ({ getFeeReserveSats: async () => null, payInvoice: async ({ invoice }) => { paid.push(invoice); return { payment_hash: 'h' }; } });
      walletStore.nwcConnection = async () => ({});
      walletStore.nwcPayOptions = () => ({ limit: null });
      await aw.checkAndExecute(id, 50_000, walletStore);
      const [event] = aw.configs[id].events;
      assert.equal(event.outcome, outcome, `${shopType} ${answer}`);
      assert.equal(asked[0], 'https://getalby.com/.well-known/lnurlp/shop');
      if (answer === 'honest') {
        assert.deepEqual(paid, [invoiceFor(event.amount)], 'the invoice for exactly the amount moved');
      } else {
        assert.deepEqual(paid, [], `${shopType} ${answer}: nothing was paid`);
        assert.equal(event.reason, answer === 'refusal' ? 'refused' : 'other');
      }
    }
  }
});

test('from LNbits, a transfer leaves the fee reserve the server states, so what the rule keeps stays (#511)', async () => {
  // LNbits wants its own reserve in the wallet beyond the invoice and may
  // charge up to it. Balance 100,000, keep 5,000: 95,000 may leave in all.
  // The rule's own reserve (1%) leaves 94,050 to send.
  for (const [serverReserve, moved] of [
    [(sats) => Math.ceil(sats * 0.01), 94_050], // the server's default: it fits, one invoice
    [(sats) => Math.ceil(sats * 0.03), 92_178], // an operator's 3%: 94,050 + 2,822 is too much, so 95,000 - 2,822
    [() => 94_995, null], // a reserve that leaves under 10: the rule waits
  ]) {
    const amountOf = new Map();
    const get = async (url) => {
      const sats = Number(new URL(url).searchParams.get('amount')) / 1000;
      if (!sats) return { ok: true, status: 200, data: PAY_REQUEST };
      amountOf.set(invoiceFor(sats), sats);
      return { ok: true, status: 200, data: { pr: invoiceFor(sats) } };
    };
    const paid = [];
    const { aw, id, walletStore } = setup({ shopType: 'lnbits', rule: { keep: { sats: 5_000 } }, deps: { '../utils/lnurlPay.js': lnurlPayWith(get) } });
    walletStore.ensureLNBitsConnected = async () => ({
      getFeeReserveSats: async (invoice) => serverReserve(amountOf.get(invoice)),
      payInvoice: async ({ invoice }) => { paid.push(amountOf.get(invoice)); return { payment_hash: 'h' }; },
    });
    await aw.checkAndExecute(id, 100_000, walletStore);
    assert.deepEqual(paid, moved ? [moved] : [], 'only the invoice that fits is paid');
    assert.deepEqual(events(aw, id), [moved ? ['sent', moved] : ['skipped', 'below_minimum']]);
    if (moved) assert.ok(moved + serverReserve(moved) <= 95_000, 'the amount and the most it can cost leave the 5,000');
    assert.equal(aw.configs[id].failureStreak, 0);
  }

  // A wait for the server's reserve leaves no cooldown behind: nothing was
  // tried, so the next balance that is enough moves at once.
  let reserve = () => 94_995;
  const amountOf = new Map();
  const get = async (url) => {
    const sats = Number(new URL(url).searchParams.get('amount')) / 1000;
    if (!sats) return { ok: true, status: 200, data: PAY_REQUEST };
    amountOf.set(invoiceFor(sats), sats);
    return { ok: true, status: 200, data: { pr: invoiceFor(sats) } };
  };
  const paid = [];
  const { aw, id, walletStore } = setup({ shopType: 'lnbits', rule: { keep: { sats: 5_000 } }, deps: { '../utils/lnurlPay.js': lnurlPayWith(get) } });
  walletStore.ensureLNBitsConnected = async () => ({
    getFeeReserveSats: async (invoice) => reserve(amountOf.get(invoice)),
    payInvoice: async ({ invoice }) => { paid.push(amountOf.get(invoice)); return { payment_hash: 'h' }; },
  });
  await aw.checkAndExecute(id, 100_000, walletStore);
  reserve = (sats) => Math.ceil(sats * 0.01);
  await aw.checkAndExecute(id, 100_000, walletStore);
  assert.deepEqual(paid, [94_050], 'sent on the very next run');
});

test('rules left behind by removed wallets are settled when the rules load', async () => {
  const saved = {
    shop: { enabled: true, threshold: { sats: 5 }, destination: { kind: 'wallet', walletId: 'old-savings' } },
    'old-savings': { enabled: true, threshold: { sats: 5 }, destination: { kind: 'lightning', address: LN } },
    'set-aside': { enabled: true, threshold: { sats: 5 }, destination: { kind: 'lightning', address: LN } },
  };
  storage.set('buhoGO_auto_withdraw', JSON.stringify({ configs: saved }));
  const aw = load();
  await aw.initialize({ wallets: [{ id: 'shop' }], heldWalletIds: new Set(['shop', 'set-aside']) });
  assert.deepEqual(Object.keys(aw.configs).sort(), ['set-aside', 'shop'], 'a wallet that may come back keeps its rule');
  assert.deepEqual([aw.configs.shop.enabled, aw.configs.shop.pausedReason], [false, 'destination_removed']);
  assert.deepEqual(Object.keys(JSON.parse(storage.get('buhoGO_auto_withdraw')).configs).sort(), ['set-aside', 'shop'], 'saved back without the dropped rule');

  // Without the held wallets (the wallet list could not be read), nothing goes.
  storage.set('buhoGO_auto_withdraw', JSON.stringify({ configs: saved }));
  const unsure = load();
  await unsure.initialize({ wallets: [] });
  assert.equal(Object.keys(unsure.configs).length, 3);
});

test('Settings, the page and Home count only the rules of wallets on screen', () => {
  const { aw, id } = setup();
  aw.configs.ghost = rules.normalizeRule({ enabled: true, threshold: { sats: 5 }, destination: { kind: 'lightning', address: LN } });
  const listed = aw.rulesOf([{ id, name: 'Shop' }, { id: 'savings', name: 'Savings' }]);
  assert.deepEqual(listed.map((entry) => entry.walletId), [id]);
  assert.equal(listed[0].status.kind, rules.ruleStatus(aw.configs[id]).kind);
  assert.deepEqual(aw.rulesOf(), []);
});

test('an amount outside what the address takes: below its minimum the rule waits, above its maximum it fails and names the limit (#512)', async () => {
  // The address takes 1,000 to 50,000. Threshold 5,500, keep 5,000.
  for (const shopType of ['spark', 'nwc', 'lnbits']) {
    const asked = [];
    const get = async (url) => {
      asked.push(url);
      const sats = Number(new URL(url).searchParams.get('amount')) / 1000;
      return { ok: true, status: 200, data: sats ? { pr: invoiceFor(sats) } : { ...PAY_REQUEST, minSendable: 1_000_000, maxSendable: 50_000_000 } };
    };
    const paid = [];
    const { aw, id, sent, provider, walletStore } = setup({ shopType, rule: { threshold: { sats: 5_500 }, keep: { sats: 5_000 } }, deps: {
      '../utils/lnurlPay.js': lnurlPayWith(get),
      '../services/nwcPayment.js': { payWithNwc: async (nwc, invoice) => { paid.push(invoice); return { payment_hash: 'h' }; } },
    } });
    let balance = 6_000;
    provider.getBalance = async () => ({ balance });
    walletStore.ensureLNBitsConnected = async () => ({ getFeeReserveSats: async () => null, payInvoice: async ({ invoice }) => { paid.push(invoice); return { payment_hash: 'h' }; } });
    walletStore.nwcConnection = async () => ({});
    walletStore.nwcPayOptions = () => ({ limit: null });
    const moved = () => (shopType === 'spark' ? sent.map(([, , amount]) => amount) : paid);

    // 1,000 above the keep, 990 after the fee reserve: less than the address takes.
    await aw.checkAndExecute(id, balance, walletStore);
    await aw.checkAndExecute(id, balance, walletStore);
    assert.deepEqual(events(aw, id), [['skipped', 'below_minimum']], `${shopType}: it waits, on one line`);
    assert.equal(aw.configs[id].failureStreak, 0, 'a wait is no failure');
    assert.deepEqual(moved(), []);
    assert.equal(asked.length, 1, 'the limits were read once, and no invoice was asked for');

    // Enough has come in: the next balance moves it, with no cooldown in the way.
    balance = 6_100;
    await aw.checkAndExecute(id, balance, walletStore);
    assert.deepEqual(events(aw, id)[0], ['sent', 1_089], shopType);
    assert.deepEqual(moved(), shopType === 'spark' ? [1_089] : [invoiceFor(1_089)]);

    // More than it takes at a time: nothing is sent, in whole or in part.
    const before = moved().length;
    balance = 80_000;
    await aw.tryNow(id, { ...walletStore, getDisplayBalance: () => ({ balance }) });
    const [failed] = aw.configs[id].events;
    assert.deepEqual([failed.outcome, failed.reason, failed.detail, failed.amount], ['failed', 'above_maximum', 50_000, 74_250], shopType);
    assert.equal(aw.configs[id].failureStreak, 1);
    assert.equal(moved().length, before);
  }
});
