import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSparkLifecycle, REBUILD_AFTER_FAILURES } from '../sparkLifecycle.js';
import { createPaymentReceipts } from '../paymentReceipts.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

/** A wallet store shaped like the real one, with providers the test controls. */
function harness({ online = true } = {}) {
  let now = 1_700_000_000_000;
  const epochs = {};
  const subscribers = {};
  const calls = [];
  const discovered = [];
  const exitRefreshes = [];
  const delivered = [];
  const timers = [];

  const provider = (id) => ({
    isConnected: true,
    lastSyncedAt: null,
    lastSyncError: null,
    local: 1000,
    receives: [],
    async getCachedBalance() { return { balance: this.local, fresh: false }; },
    async listSettledReceivesSince() { return this.receives; },
  });

  const store = {
    wallets: [{ id: 'A', type: 'spark' }, { id: 'B', type: 'spark' }],
    get sparkWallets() { return this.wallets.filter(w => w.type === 'spark'); },
    activeWalletId: 'A',
    providers: { A: provider('A'), B: provider('B') },
    connectionStates: { A: { connected: true }, B: { connected: true } },
    sparkSync: {},
    balances: {},
    accepted: [],
    walletEpoch: id => epochs[id] || 0,
    beginBalanceRead: id => ({ walletId: id, epoch: epochs[id] || 0 }),
    acceptBalance(id, value, opts) {
      if (opts.read && opts.read.epoch !== (epochs[id] || 0)) return false;
      this.balances[id] = value;
      this.accepted.push({ id, value, source: opts.source, verified: opts.verified });
      return true;
    },
    refreshGate: null,
    async refreshWalletData(id) {
      calls.push(['refresh', id]);
      if (this.refreshGate) await this.refreshGate;
      const p = this.providers[id];
      if (p.failSync) { p.lastSyncError = new Error('breez sync timeout'); return; }
      p.lastSyncError = null;
      p.lastSyncedAt = now;
    },
    async connectSparkWallet(id, opts = {}) {
      calls.push(['connect', id, !!opts.forceReinit]);
      if (opts.forceReinit) epochs[id] = (epochs[id] || 0) + 1;
      this.connectionStates[id] = { connected: true };
      this.providers[id].isConnected = true;
      this.providers[id].lastSyncedAt = now;
      this.providers[id].lastSyncError = this.providers[id].failSync ? new Error('breez sync timeout') : null;
    },
    signalDepositsRefresh(id) { calls.push(['signal', id]); },
  };

  const receipts = createPaymentReceipts({
    storage: null, now: () => now, deliver: r => delivered.push(r),
  });

  const lifecycle = createSparkLifecycle({
    walletStore: store,
    receipts,
    depositsStore: () => ({ discover: async (id) => { discovered.push(id); return []; }, forgetWallet() {} }),
    subscribe: (id, fn) => {
      (subscribers[id] ||= new Set()).add(fn);
      return () => subscribers[id].delete(fn);
    },
    refreshExitKit: (id) => exitRefreshes.push(id),
    isOnline: () => online,
    isForeground: () => true,
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); },
  });

  const emit = (id, event) => { for (const fn of subscribers[id] || []) fn(event); };
  return { store, lifecycle, receipts, calls, discovered, exitRefreshes, delivered, timers, epochs, subscribers, emit,
    advance: ms => { now += ms; }, nowS: () => Math.floor(now / 1000) };
}

test('both accounts reconcile on wake regardless of the selected wallet', async () => {
  const h = harness();
  h.store.activeWalletId = 'LNBITS';
  await h.lifecycle.onWake('resume');
  assert.deepEqual(h.calls.filter(c => c[0] === 'refresh').map(c => c[1]).sort(), ['A', 'B']);
  assert.deepEqual(h.discovered.sort(), ['A', 'B']);
  assert.deepEqual(h.exitRefreshes.sort(), ['A', 'B'], 'both exit kits refresh after catch-up');
  assert.equal(h.store.sparkSync.A.phase, 'healthy');
  assert.equal(h.store.sparkSync.B.phase, 'healthy');
});

test('overlapping triggers coalesce into one pass plus one follow-up, never parallel passes', async () => {
  const h = harness();
  const gate = deferred();
  h.store.refreshGate = gate.promise;
  const first = h.lifecycle.reconcile('A', 'resume');
  h.lifecycle.reconcile('A', 'online');
  h.lifecycle.reconcile('A', 'visible');
  await tick();
  assert.equal(h.calls.filter(c => c[0] === 'refresh').length, 1);
  gate.resolve();
  h.store.refreshGate = null;
  await first;
  assert.equal(h.calls.filter(c => c[0] === 'refresh').length, 2, 'triggers during a pass produce exactly one more');
});

test('SDK events publish shared state and receipts without a mounted page', async () => {
  const h = harness();
  h.lifecycle.onSparkConnected('B');
  await tick();
  h.advance(1000);
  h.store.providers.B.local = 1500;
  h.emit('B', { type: 'paymentSucceeded', payment: { id: 'p1', paymentType: 'receive', status: 'completed', amount: 500n, timestamp: h.nowS() } });
  await tick(); await tick();
  assert.equal(h.store.balances.B, 1500);
  assert.equal(h.store.accepted.at(-1).source, 'event');
  assert.deepEqual(h.delivered.map(d => [d.walletId, d.amountSats]), [['B', 500]]);
  // Replay of the same event: nothing new.
  h.emit('B', { type: 'paymentSucceeded', payment: { id: 'p1', paymentType: 'receive', status: 'completed', amount: 500n, timestamp: h.nowS() } });
  await tick(); await tick();
  assert.equal(h.delivered.length, 1);
  h.emit('B', { type: 'newDeposits', newDeposits: [] });
  await tick();
  assert.ok(h.discovered.includes('B'));
});

test('catch-up finds a receive missed during suspension, once, for the right wallet', async () => {
  const h = harness();
  h.lifecycle.onSparkConnected('A');
  h.lifecycle.onSparkConnected('B');
  await h.lifecycle.reconcileAll('connect');
  h.advance(3600 * 1000);
  h.store.providers.B.receives = [{ id: 'm1', paymentType: 'receive', status: 'completed', amount: 700n, timestamp: h.nowS() - 120 }];
  await h.lifecycle.onWake('resume');
  await h.lifecycle.onWake('resume');
  assert.deepEqual(h.delivered.map(d => [d.walletId, d.paymentId, d.source]), [['B', 'm1', 'catchup']]);
});

test('events for a disconnected or rebuilt wallet are dropped', async () => {
  const h = harness();
  h.lifecycle.onSparkConnected('A');
  await tick();
  const staleHandlers = [...h.subscribers.A];
  h.epochs.A = 1; // store bumped the epoch (disconnect / rebuild)
  h.lifecycle.onSparkDisconnected('A');
  assert.equal(h.subscribers.A.size, 0, 'the subscription is released');
  h.advance(1000);
  for (const fn of staleHandlers) fn({ type: 'paymentSucceeded', payment: { id: 'late', paymentType: 'receive', status: 'completed', amount: 1n, timestamp: h.nowS() } });
  await tick(); await tick();
  assert.equal(h.delivered.length, 0);
  assert.equal(h.store.sparkSync.A.phase, 'disconnected');
});

test('a wallet removed mid-pass leaves no state and applies nothing', async () => {
  const h = harness();
  const gate = deferred();
  h.store.refreshGate = gate.promise;
  const pending = h.lifecycle.reconcile('B', 'resume');
  await tick();
  h.store.wallets = h.store.wallets.filter(w => w.id !== 'B');
  h.lifecycle.onSparkRemoved('B');
  gate.resolve();
  await pending;
  assert.equal(h.discovered.includes('B'), false);
  assert.equal(h.store.sparkSync.B, undefined);
});

test('failed syncs retry with backoff and rebuild only after repeated online failures', async () => {
  const h = harness();
  h.store.providers.A.failSync = true;
  for (let i = 1; i <= REBUILD_AFTER_FAILURES; i++) {
    await h.lifecycle.reconcile('A', 'retry');
    assert.equal(h.store.sparkSync.A.phase, 'degraded');
    assert.equal(h.store.sparkSync.A.failures, i);
  }
  const rebuilds = h.calls.filter(c => c[0] === 'connect' && c[2]);
  assert.equal(rebuilds.length, 1, 'exactly one rebuild, not one per pass');
  const retries = h.timers.map(t => t.ms);
  assert.ok(retries.length >= 1 && retries.every(ms => ms > 0));
  await h.lifecycle.reconcile('A', 'retry');
  assert.equal(h.calls.filter(c => c[0] === 'connect' && c[2]).length, 1, 'no endless rebuilds');
  h.store.providers.A.failSync = false;
  await h.lifecycle.reconcile('A', 'retry');
  assert.equal(h.store.sparkSync.A.phase, 'healthy');
  assert.equal(h.store.sparkSync.A.failures, 0);
});

test('an offline phone neither counts failures nor rebuilds', async () => {
  const h = harness({ online: false });
  h.store.providers.A.failSync = true;
  for (let i = 0; i < REBUILD_AFTER_FAILURES + 1; i++) await h.lifecycle.reconcile('A', 'retry');
  assert.equal(h.store.sparkSync.A.failures, 0);
  assert.equal(h.calls.filter(c => c[0] === 'connect').length, 0);
});

test('a disconnected wallet is reconnected by the pass instead of reporting stale data', async () => {
  const h = harness();
  h.store.connectionStates.B = { connected: false };
  h.store.providers.B.isConnected = false;
  await h.lifecycle.reconcile('B', 'resume');
  assert.deepEqual(h.calls.find(c => c[1] === 'B'), ['connect', 'B', false]);
  assert.equal(h.store.sparkSync.B.phase, 'healthy');
});

test('diagnostics are redacted to short wallet ids', async () => {
  const h = harness();
  await h.lifecycle.onWake('resume');
  const entries = h.lifecycle.diagnostics();
  assert.ok(entries.some(e => e.step === 'reconciled' && Number.isFinite(e.ms)));
  assert.ok(entries.every(e => !e.walletId || e.walletId.startsWith('…')));
});
