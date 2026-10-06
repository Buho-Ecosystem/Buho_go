import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { classifyFromMatureQuote } from '../../utils/breezPayments.js';
import { AUTO_CLAIM_THRESHOLDS, BITCOIN_DEPOSIT_POLL_MS } from '../bitcoinPreferences.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function harness() {
  const claimed = new Set(), inFlight = new Set(), signals = [];
  const prefs = { autoAddIncomingBitcoin: true };
  const deposit = { txId: 'deposit', outputIndex: 1, amount: 66610, confirmed: true };
  let quotes = 0, claims = 0;
  const classify = (fee = 396) => ({
    ...classifyFromMatureQuote({ depositAmountSats: deposit.amount, quote: { feeSats: fee, creditAmountSats: deposit.amount - fee }, thresholds: AUTO_CLAIM_THRESHOLDS }),
    quote: { feeSats: fee, creditAmountSats: deposit.amount - fee }, classifiedAt: Date.now(),
  });
  const provider = {
    classifyConfirmedDeposit: async () => { quotes++; return deposit.amount < 1000 ? { category: 'too_small', classifiedAt: Date.now() } : classify(); },
    claimDeposit: async (txId, quote, vout) => {
      assert.equal(txId, deposit.txId); assert.equal(vout, deposit.outputIndex);
      assert.ok(quote.feeSats <= 3000 && quote.feeSats / deposit.amount <= 0.05);
      claims++; return { amount: quote.creditAmountSats };
    },
  };
  const k = (id, vout) => `${id}:${Number(vout) || 0}`;
  const wallet = { activeWalletId: 'A', wallets: [{ id: 'A' }, { id: 'B' }], ensureSparkConnected: async () => provider,
    isDepositClaimed: (id, vout) => claimed.has(k(id, vout)), markDepositClaimed: (id, vout) => claimed.add(k(id, vout)),
    isDepositClaimInFlight: (id, vout) => inFlight.has(k(id, vout)), markDepositClaimInFlight: (id, vout) => inFlight.add(k(id, vout)),
    clearDepositClaimInFlight: (id, vout) => inFlight.delete(k(id, vout)), signalDepositsRefresh: id => signals.push(id),
  };
  const deps = { pinia: { defineStore: (_, options) => options }, './wallet': { useWalletStore: () => wallet },
    './bitcoinPreferences': { useBitcoinPreferencesStore: () => prefs, BITCOIN_DEPOSIT_POLL_MS, CLASSIFICATION_FRESHNESS_MS: 30000, AUTO_CLAIM_THRESHOLDS }, '../utils/breezPayments.js': { classifyFromMatureQuote }, '../utils/telemetry': { track() {} } };
  const { code } = transformSync(readFileSync(new URL('../bitcoinDeposits.js', import.meta.url), 'utf8'), { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name], module, module.exports);
  const options = module.exports.useBitcoinDepositsStore;
  const store = { ...options.state(), ...options.actions };
  return { store, wallet, prefs, provider, deposit, classify, claimed, inFlight, signals, counts: () => ({ quotes, claims }),
    run: () => store.processDeposits([deposit], 'A') };
}

test('manual controls stay unavailable before, during and after an eligible automatic claim', async () => {
  const h = harness(), quote = deferred(), claim = deferred(), started = deferred();
  h.provider.classifyConfirmedDeposit = () => quote.promise;
  h.provider.claimDeposit = () => { started.resolve(); return claim.promise; };
  assert.equal(h.store.needsManual(h.deposit), false);
  const pending = h.run();
  assert.equal(h.store.status(h.deposit), 'checking');
  assert.equal(h.store.needsManual(h.deposit), false);
  quote.resolve(h.classify());
  await started.promise;
  assert.equal(h.store.status(h.deposit), 'claiming');
  assert.equal(h.store.needsManual(h.deposit), false);
  claim.resolve({ processing: true });
  await pending;
  assert.equal(h.store.status(h.deposit), 'accepted');
  assert.equal(h.store.needsManual(h.deposit), false);
  assert.deepEqual(h.signals, ['A']);
  assert.equal(h.inFlight.size, 0);
});

test('only explicit auto-add exceptions expose manual controls, with inclusive fee limits', async () => {
  for (const [amount, fee, manual] of [[1000, 50, false], [60000, 3000, false], [1000, 51, true], [100000, 3001, true], [999, 1, true]]) {
    const h = harness(); h.deposit.amount = amount;
    h.provider.classifyConfirmedDeposit = async () => amount < 1000 ? { category: 'too_small' } : h.classify(fee);
    await h.run();
    assert.equal(h.store.needsManual(h.deposit), manual, `${amount}/${fee}`);
    assert.equal(h.counts().claims, manual ? 0 : 1);
  }
  const h = harness(); h.prefs.autoAddIncomingBitcoin = false;
  await h.run();
  assert.equal(h.store.needsManual(h.deposit), true);
  assert.deepEqual(h.counts(), { quotes: 0, claims: 0 });
  h.deposit.confirmed = false;
  assert.equal(h.store.needsManual(h.deposit), false);
});

test('temporary quote errors remain automatic and retry after the polling backoff', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (const failure of ['throw', 'quote_failed']) {
    const h = harness(); let calls = 0;
    h.provider.classifyConfirmedDeposit = async () => {
      calls++;
      if (calls === 1) { if (failure === 'throw') throw Error('offline'); return { category: 'quote_failed' }; }
      return h.classify();
    };
    await h.run();
    assert.equal(h.store.status(h.deposit), 'retrying');
    assert.equal(h.store.needsManual(h.deposit), false);
    await h.run(); assert.equal(calls, 1, 'avoid retry storms from multiple views');
    now += BITCOIN_DEPOSIT_POLL_MS;
    await h.run();
    assert.equal(h.store.status(h.deposit), 'accepted');
    assert.equal(calls, 2);
  }
});

test('a rejected claim is reclassified on retry; only a proven higher fee asks for action', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const h = harness();
  h.provider.claimDeposit = async () => { throw Error('fee changed'); };
  await h.run();
  assert.equal(h.store.needsManual(h.deposit), false);
  assert.equal(h.inFlight.size, 0);
  assert.equal(h.claimed.size, 0);
  now += BITCOIN_DEPOSIT_POLL_MS;
  h.provider.classifyConfirmedDeposit = async () => h.classify(4000);
  await h.run();
  assert.equal(h.store.needsManual(h.deposit), true);
});

test('a refreshed quote cannot retain an expired eligibility decision', async () => {
  const h = harness(); let calls = 0;
  h.provider.classifyConfirmedDeposit = async () => ++calls === 1
    ? { ...h.classify(), classifiedAt: Date.now() - 31000 } : h.classify(4000);
  await h.run();
  assert.equal(calls, 2);
  assert.equal(h.store.needsManual(h.deposit), true);
  assert.equal(h.counts().claims, 0);
});

test('simultaneous home, receive and history checks submit only one claim', async () => {
  const h = harness(), quote = deferred(); let calls = 0;
  h.provider.classifyConfirmedDeposit = () => { calls++; return quote.promise; };
  const first = h.run();
  await Promise.all([h.run(), h.run()]);
  assert.equal(calls, 1);
  quote.resolve(h.classify()); await first;
  await h.run();
  assert.equal(h.counts().claims, 1);
});

test('a selection change while classifying keeps valid work; removal or auto-add off cancels it', async () => {
  for (const change of ['select-other', 'remove', 'auto-add-off']) {
    const h = harness(), quote = deferred(), started = deferred();
    h.provider.classifyConfirmedDeposit = () => { started.resolve(); return quote.promise; };
    const pending = h.run(); await started.promise;
    if (change === 'select-other') h.wallet.activeWalletId = 'B';
    if (change === 'remove') h.wallet.wallets = h.wallet.wallets.filter(w => w.id !== 'A');
    if (change === 'auto-add-off') h.prefs.autoAddIncomingBitcoin = false;
    quote.resolve(h.classify()); await pending;
    assert.equal(h.counts().claims, change === 'select-other' ? 1 : 0, change);
    assert.equal(h.inFlight.size, 0);
    if (change !== 'select-other') assert.deepEqual(h.store.entries, {}, 'no orphaned busy state');
  }
});

test('an unselected wallet processes its own deposit through its own provider', async () => {
  const h = harness();
  h.wallet.activeWalletId = 'B';
  const asked = [];
  h.wallet.ensureSparkConnected = async id => { asked.push(id); return h.provider; };
  await h.run();
  assert.deepEqual(asked, ['A'], 'provider resolved with the explicit wallet id');
  assert.equal(h.counts().claims, 1);
  assert.deepEqual(h.signals, ['A']);
});

test('several outputs of one transaction, and one per account, are each claimed once', async () => {
  const h = harness();
  const vouts = [];
  h.provider.claimDeposit = async (txId, quote, vout) => { vouts.push(vout); return { amount: quote.creditAmountSats }; };
  const out0 = { ...h.deposit, outputIndex: 0 }, out1 = { ...h.deposit, outputIndex: 1 };
  await h.store.processDeposits([out0, out1], 'A');
  // The same transaction also paid the other account.
  await h.store.processDeposits([{ ...h.deposit, outputIndex: 2 }], 'B');
  assert.deepEqual(vouts.sort(), [0, 1, 2]);
  // Replays (events, polls, manual sheet) submit nothing more.
  await h.store.processDeposits([out0, out1], 'A');
  await h.store.processDeposits([{ ...h.deposit, outputIndex: 2 }], 'B');
  assert.equal(vouts.length, 3);
});

test('a late accepted claim records its original wallet without refreshing another wallet', async () => {
  const h = harness(), claim = deferred(), started = deferred();
  h.provider.claimDeposit = () => { started.resolve(); return claim.promise; };
  const pending = h.run(); await started.promise;
  h.wallet.activeWalletId = 'B'; claim.resolve({ processing: true }); await pending;
  assert.deepEqual(h.signals, ['A']);
  assert.equal(h.claimed.has(`${h.deposit.txId}:${h.deposit.outputIndex}`), true);
});


test('a manual review returns to automatic handling when its fresh fee falls inside the limits', async () => {
  const h = harness();
  h.provider.classifyConfirmedDeposit = async () => h.classify(4000);
  await h.run();
  assert.equal(h.store.needsManual(h.deposit), true);
  h.provider.classifyConfirmedDeposit = async () => h.classify(396);
  h.store.reconsiderQuote(h.deposit, h.classify(396).quote);
  assert.equal(h.store.needsManual(h.deposit), false, 'hide the action before awaiting the next classification');
  // Allow the controlled provider microtasks to complete.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.counts().claims, 1);
});
