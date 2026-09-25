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
  const outpoint = (id, vout = 0) => `${id}:${vout || 0}`;
  const epochs = { A: 0, B: 0 };
  const connected = [];
  const wallet = { activeWalletId: 'A', wallets: [{ id: 'A' }, { id: 'B' }],
    ensureSparkConnected: async (id) => { connected.push(id); return provider; },
    walletEpoch: id => epochs[id] || 0,
    isDepositClaimed: (id, vout) => claimed.has(outpoint(id, vout)), markDepositClaimed: (id, vout) => claimed.add(outpoint(id, vout)),
    isDepositClaimInFlight: (id, vout) => inFlight.has(outpoint(id, vout)), markDepositClaimInFlight: (id, vout) => inFlight.add(outpoint(id, vout)),
    clearDepositClaimInFlight: (id, vout) => inFlight.delete(outpoint(id, vout)), signalDepositsRefresh: id => signals.push(id),
  };
  const deps = { pinia: { defineStore: (_, options) => options }, './wallet': { useWalletStore: () => wallet },
    './bitcoinPreferences': { useBitcoinPreferencesStore: () => prefs, BITCOIN_DEPOSIT_POLL_MS, CLASSIFICATION_FRESHNESS_MS: 30000, AUTO_CLAIM_THRESHOLDS }, '../utils/breezPayments.js': { classifyFromMatureQuote }, '../utils/telemetry': { track() {} } };
  const { code } = transformSync(readFileSync(new URL('../bitcoinDeposits.js', import.meta.url), 'utf8'), { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name], module, module.exports);
  const options = module.exports.useBitcoinDepositsStore;
  const store = { ...options.state(), ...options.actions };
  return { store, wallet, prefs, provider, deposit, classify, claimed, inFlight, signals, epochs, connected, outpoint, counts: () => ({ quotes, claims }),
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

test('switching the selected wallet mid-classification does not abandon the claim', async () => {
  const h = harness(), quote = deferred(), started = deferred();
  h.provider.classifyConfirmedDeposit = () => { started.resolve(); return quote.promise; };
  const pending = h.run(); await started.promise;
  h.wallet.activeWalletId = 'B';
  quote.resolve(h.classify()); await pending;
  assert.equal(h.counts().claims, 1);
  assert.deepEqual(h.signals, ['A'], 'the result is routed to the owning wallet');
  assert.deepEqual(h.connected, ['A'], 'the provider is resolved by explicit wallet id');
});

test('wallet removal, rebuild or a preference switch while classifying prevents automatic submission', async () => {
  for (const change of ['remove', 'rebuild', 'preference']) {
    const h = harness(), quote = deferred(), started = deferred();
    h.provider.classifyConfirmedDeposit = () => { started.resolve(); return quote.promise; };
    const pending = h.run(); await started.promise;
    if (change === 'remove') h.wallet.wallets = [{ id: 'B' }];
    else if (change === 'rebuild') h.epochs.A += 1;
    else h.prefs.autoAddIncomingBitcoin = false;
    quote.resolve(h.classify()); await pending;
    assert.equal(h.counts().claims, 0, change);
    assert.equal(h.inFlight.size, 0, change);
    assert.deepEqual(h.store.entries, {}, `no orphaned busy state (${change})`);
  }
});

test('an inactive wallet processes its own confirmed deposit', async () => {
  const h = harness();
  h.wallet.activeWalletId = 'A';
  await h.store.processDeposits([h.deposit], 'B');
  assert.equal(h.counts().claims, 1);
  assert.deepEqual(h.connected, ['B']);
  assert.deepEqual(h.signals, ['B']);
});

test('two outputs of one transaction, and deposits to both wallets, are each claimed once', async () => {
  const h = harness();
  const vouts = [];
  h.provider.claimDeposit = async (txId, quote, vout) => { vouts.push(vout); return { amount: quote.creditAmountSats }; };
  const a0 = { ...h.deposit, outputIndex: 0 }, a1 = { ...h.deposit, outputIndex: 1 };
  const b2 = { ...h.deposit, outputIndex: 2 };
  await Promise.all([h.store.processDeposits([a0, a1], 'A'), h.store.processDeposits([b2], 'B')]);
  assert.deepEqual(vouts.sort(), [0, 1, 2]);
  await Promise.all([h.store.processDeposits([a0, a1], 'A'), h.store.processDeposits([b2], 'B')]);
  assert.equal(vouts.length, 3, 'no output is submitted twice');
  assert.ok(h.claimed.has(h.outpoint(h.deposit.txId, 0)) && h.claimed.has(h.outpoint(h.deposit.txId, 2)));
});

test('discover resolves the wallet by id, filters claimed outputs and publishes per wallet', async () => {
  const h = harness();
  const claimedOut = { ...h.deposit, outputIndex: 0 };
  h.claimed.add(h.outpoint(h.deposit.txId, 0));
  h.provider.getPendingDeposits = async () => [claimedOut, { ...h.deposit, outputIndex: 1, confirmed: false }];
  const list = await h.store.discover('B');
  assert.deepEqual(list.map(d => d.outputIndex), [1]);
  assert.deepEqual(h.store.pendingByWallet.B.map(d => d.outputIndex), [1]);
  assert.equal(h.store.pendingByWallet.A, undefined);
  assert.deepEqual(h.connected, ['B']);
});

test('discover drops a result that lands after its wallet was rebuilt', async () => {
  const h = harness(), list = deferred();
  h.provider.getPendingDeposits = () => list.promise;
  const pending = h.store.discover('A');
  await new Promise(resolve => setImmediate(resolve));
  h.epochs.A += 1;
  list.resolve([h.deposit]);
  assert.equal(await pending, null);
  assert.equal(h.counts().claims, 0);
});

test('a late accepted claim records its original wallet without refreshing another wallet', async () => {
  const h = harness(), claim = deferred(), started = deferred();
  h.provider.claimDeposit = () => { started.resolve(); return claim.promise; };
  const pending = h.run(); await started.promise;
  h.wallet.activeWalletId = 'B'; claim.resolve({ processing: true }); await pending;
  assert.deepEqual(h.signals, ['A']);
  assert.equal(h.claimed.has(h.outpoint(h.deposit.txId, h.deposit.outputIndex)), true);
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


test('an older discovery cannot replace a newer pending list', async () => {
  const h = harness(), old = deferred();
  h.prefs.autoAddIncomingBitcoin = false;
  let n = 0;
  h.provider.getPendingDeposits = () => ++n === 1 ? old.promise : Promise.resolve([]);
  const a = h.store.discover('A');
  await new Promise(r => setImmediate(r));
  await h.store.discover('A');
  old.resolve([h.deposit]);
  await a;
  assert.deepEqual(h.store.pendingByWallet.A, []);
});

test('a submitted claim completing after removal records the outpoint but cannot revive UI state', async () => {
  const h = harness(), claim = deferred(), started = deferred();
  h.provider.claimDeposit = () => { started.resolve(); return claim.promise; };
  const pending = h.run();
  await started.promise;
  h.wallet.wallets = [];
  h.epochs.A++;
  h.store.forgetWallet('A');
  claim.resolve({ processing: true });
  await pending;
  assert.ok(h.claimed.has(h.outpoint(h.deposit.txId, 1)));
  assert.deepEqual(h.store.entries, {});
  assert.deepEqual(h.signals, []);
});
