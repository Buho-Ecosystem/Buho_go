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
  const wallet = { activeWalletId: 'A', ensureSparkConnected: async () => provider,
    isDepositClaimed: id => claimed.has(id), markDepositClaimed: id => claimed.add(id),
    isDepositClaimInFlight: id => inFlight.has(id), markDepositClaimInFlight: id => inFlight.add(id),
    clearDepositClaimInFlight: id => inFlight.delete(id), signalDepositsRefresh: id => signals.push(id),
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

test('a wallet or preference switch while classifying prevents automatic submission', async () => {
  for (const switchWallet of [true, false]) {
    const h = harness(), quote = deferred(), started = deferred();
    h.provider.classifyConfirmedDeposit = () => { started.resolve(); return quote.promise; };
    const pending = h.run(); await started.promise;
    if (switchWallet) h.wallet.activeWalletId = 'B'; else h.prefs.autoAddIncomingBitcoin = false;
    quote.resolve(h.classify()); await pending;
    assert.equal(h.counts().claims, 0);
    assert.equal(h.inFlight.size, 0);
    assert.deepEqual(h.store.entries, {}, 'no orphaned busy state');
  }
});

test('a late accepted claim records its original wallet without refreshing another wallet', async () => {
  const h = harness(), claim = deferred(), started = deferred();
  h.provider.claimDeposit = () => { started.resolve(); return claim.promise; };
  const pending = h.run(); await started.promise;
  h.wallet.activeWalletId = 'B'; claim.resolve({ processing: true }); await pending;
  assert.deepEqual(h.signals, ['A']);
  assert.equal(h.claimed.has(h.deposit.txId), true);
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
