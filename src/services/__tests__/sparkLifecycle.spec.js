import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSparkLifecycle, HEALTH, REBUILD_AFTER_FAILURES, REBUILD_MIN_INTERVAL_MS } from '../sparkLifecycle.js';
import { createReceiptLedger } from '../paymentReceipts.js';

const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function memory() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; }

/** Fake timers: nothing fires unless the test runs it. */
function timers() {
  const pending = new Map(); let id = 0; let clock = 1_790_000_000_000;
  return {
    now: () => clock,
    advance: (ms) => { clock += ms; },
    setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clearTimer: (t) => pending.delete(t),
    pending,
    runAll() { const list = [...pending.values()]; pending.clear(); list.forEach((p) => p.fn()); },
  };
}

/** A two-wallet store and providers whose reads the test controls. */
function harness({ wallets = ['Business', 'Personal'], active = 'Personal', syncedEventVerified } = {}) {
  const t = timers();
  const subscribers = new Map(); // walletId -> Set
  const entries = new Map(wallets.map((id) => [id, { id, gen: 0 }]));
  const providers = {};
  const calls = { balance: {}, connect: [], rebuild: [], history: {}, deposits: {} };
  const behaviour = {};
  const makeProvider = (id) => ({
    isConnected: true,
    async getBalance() {
      calls.balance[id] = (calls.balance[id] || 0) + 1;
      const b = behaviour[id]?.balance;
      if (typeof b === 'function') return b();
      return { balance: 1000, fresh: true, syncedAt: t.now() };
    },
    async getCachedBalance() { return { balance: behaviour[id]?.cached ?? 1000, fresh: false }; },
    async getTransactions(offset = 0, limit = 50) {
      calls.history[id] = (calls.history[id] || 0) + 1;
      const h = behaviour[id]?.history;
      if (typeof h === 'function') return h(offset, limit);
      return (h || []).slice(offset, offset + limit);
    },
    async getPendingDeposits() { calls.deposits[id] = (calls.deposits[id] || 0) + 1; return behaviour[id]?.deposits || []; },
  });
  const applied = [];
  const store = {
    activeWalletId: active,
    sparkWallets: wallets.map((id) => ({ id })),
    providers,
    connectionStates: {},
    balanceStates: {},
    async connectSparkWallet(id, { forceReinit = false } = {}) {
      if (forceReinit) { calls.rebuild.push(id); entries.set(id, { id, gen: (entries.get(id)?.gen || 0) + 1 }); }
      else calls.connect.push(id);
      providers[id] = makeProvider(id);
      store.connectionStates[id] = { connected: true };
    },
    applyBalance(id, value, opts) { applied.push({ id, value, ...opts }); store.balanceStates[id] = { value }; return true; },
    markBalanceRefresh() {}, markBalanceError() {}, setSparkHealthState() {}, noteSparkNetworkSync() {},
    isDepositClaimed: () => false, setPendingDeposits() {}, signalDepositsRefresh() {},
  };
  const receipts = [];
  const processed = [];
  const ledger = createReceiptLedger({ storage: memory(), now: t.now });
  const lifecycle = createSparkLifecycle({
    store,
    subscribe: (id, fn) => { const set = subscribers.get(id) || new Set(); set.add(fn); subscribers.set(id, set); return () => set.delete(fn); },
    peekEntry: (id) => entries.get(id) || null,
    ledger,
    deliverReceipt: (r) => receipts.push(r),
    processDeposits: async (deposits, walletId) => { processed.push({ walletId, n: deposits.length }); },
    now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer,
    ...(syncedEventVerified ? { syncedEventVerified } : {}),
  });
  const emit = (id, event) => [...(subscribers.get(id) || [])].forEach((fn) => fn(event));
  return { t, store, providers, calls, behaviour, applied, lifecycle, receipts, processed, ledger, emit, subscribers, entries };
}

test('both accounts reconcile without any page and regardless of selection', async () => {
  const h = harness({ active: 'lnbits-wallet' }); // a non-Spark wallet is selected
  h.lifecycle.start();
  await tick(); await tick();
  assert.deepEqual(h.calls.connect.sort(), ['Business', 'Personal']);
  assert.ok(h.calls.balance.Business >= 1 && h.calls.balance.Personal >= 1);
  assert.equal(h.lifecycle.status('Business').health, HEALTH.HEALTHY);
  assert.equal(h.lifecycle.status('Personal').health, HEALTH.HEALTHY);
  assert.ok(h.applied.some((a) => a.id === 'Business' && a.fresh === true));
  h.lifecycle.stop();
});

test('overlapping triggers coalesce into one run plus one follow-up', async () => {
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start');
  const gate = deferred();
  h.behaviour.Business = { balance: () => gate.promise };
  const runs = [h.lifecycle.reconcile('Business', 'resume'), h.lifecycle.reconcile('Business', 'visible'), h.lifecycle.reconcile('Business', 'online'), h.lifecycle.reconcile('Business', 'timer')];
  await tick();
  assert.equal(h.calls.balance.Business, 2, 'one in-flight sync for four triggers');
  h.behaviour.Business = {};
  gate.resolve({ balance: 5, fresh: true });
  await Promise.all(runs);
  await tick(); await tick();
  assert.equal(h.calls.balance.Business, 3, 'exactly one follow-up for urgent triggers that arrived mid-run');
});

test('SDK events refresh shared state and announce receipts once, per wallet', async () => {
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start'); // primes the ledger, subscribes
  await h.lifecycle.reconcile('Personal', 'start');
  h.t.advance(5000);
  const p = { id: 'pay-1', paymentType: 'receive', status: 'completed', amount: 2n, fees: 0n, timestamp: Math.floor(h.t.now() / 1000) };
  h.behaviour.Business = { cached: 1002 };
  h.emit('Business', { type: 'paymentSucceeded', payment: p });
  h.emit('Business', { type: 'paymentSucceeded', payment: p }); // replay
  await tick();
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].walletId, 'Business');
  assert.ok(h.applied.some((a) => a.id === 'Business' && a.value === 1002 && a.source === 'event'));
  // Personal saw nothing.
  assert.ok(!h.receipts.some((r) => r.walletId === 'Personal'));
});

test('a missed payment is caught up on resume and the exit kit is told', async () => {
  const activity = [];
  const h = harness();
  await h.lifecycle.reconcile('Personal', 'start');
  h.t.advance(60_000);
  h.behaviour.Personal = { history: [{ id: 'missed', type: 'receive', status: 'completed', amount: 300, fee: 0, timestamp: Math.floor(h.t.now() / 1000) }] };
  // re-create with an activity probe
  const lifecycle = createSparkLifecycle({ store: h.store, subscribe: () => () => {}, peekEntry: () => ({}), ledger: h.ledger,
    deliverReceipt: (r) => h.receipts.push(r), onActivity: (id, why) => activity.push([id, why]), now: h.t.now, setTimer: h.t.setTimer, clearTimer: h.t.clearTimer });
  await lifecycle.reconcile('Personal', 'resume');
  assert.equal(h.receipts.length, 1);
  assert.equal(h.receipts[0].amountSats, 300);
  assert.deepEqual(activity, [['Personal', 'catchup']]);
  // Nothing new next time: no receipt, no kit refresh.
  await lifecycle.reconcile('Personal', 'timer');
  assert.equal(h.receipts.length, 1);
  assert.equal(activity.length, 1);
});

test('deposits are discovered and processed for the wallet that owns them', async () => {
  const h = harness({ active: 'Personal' });
  h.behaviour.Business = { deposits: [{ txId: 't', outputIndex: 0, amount: 5000, confirmed: true }] };
  await h.lifecycle.reconcile('Business', 'timer');
  assert.deepEqual(h.processed, [{ walletId: 'Business', n: 1 }]);
  h.emit('Business', { type: 'newDeposits', newDeposits: [] });
  await tick(); await tick();
  assert.equal(h.calls.deposits.Business, 2, 'a deposit event triggers discovery');
});

test('a failed sync is degraded, retried with backoff, and rebuilt only after repeated failures', async () => {
  const h = harness();
  h.lifecycle.start(); await tick(); await tick();
  h.t.pending.clear();
  h.behaviour.Business = { balance: async () => ({ balance: 1000, fresh: false, syncError: 'breez sync timeout' }) };
  for (let i = 1; i <= REBUILD_AFTER_FAILURES; i++) {
    await h.lifecycle.reconcile('Business', 'timer');
    assert.equal(h.lifecycle.status('Business').health, HEALTH.DEGRADED);
    assert.equal(h.lifecycle.status('Business').failures, i);
    assert.ok([...h.t.pending.values()].some((p) => p.ms > 0), 'a retry is scheduled');
  }
  assert.deepEqual(h.calls.rebuild, ['Business'], 'one rebuild after the threshold');
  // Further failures inside the window do not rebuild again.
  await h.lifecycle.reconcile('Business', 'timer');
  await h.lifecycle.reconcile('Business', 'timer');
  assert.equal(h.calls.rebuild.length, 1, 'no endless rebuilds');
  h.t.advance(REBUILD_MIN_INTERVAL_MS + 1);
  await h.lifecycle.reconcile('Business', 'timer');
  assert.equal(h.calls.rebuild.length, 2);
  // A stale value was still published, labelled as not fresh.
  assert.ok(h.applied.some((a) => a.id === 'Business' && a.fresh === false && a.source === 'cache'));
  // Recovery clears the streak.
  h.behaviour.Business = {};
  await h.lifecycle.reconcile('Business', 'retry');
  assert.equal(h.lifecycle.status('Business').health, HEALTH.HEALTHY);
  assert.equal(h.lifecycle.status('Business').failures, 0);
  h.lifecycle.stop();
});

test('a rebuilt instance gets the event subscription re-attached', async () => {
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start');
  assert.equal(h.subscribers.get('Business').size, 1);
  h.entries.set('Business', { id: 'Business', gen: 99 }); // registry rebuilt it
  await h.lifecycle.reconcile('Business', 'timer');
  assert.equal(h.subscribers.get('Business').size, 1, 'old listener removed, new one attached');
});

test('removal mid-run drops the late result and all listeners', async () => {
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start');
  const gate = deferred();
  h.behaviour.Business = { balance: () => gate.promise };
  const run = h.lifecycle.reconcile('Business', 'timer');
  await tick();
  const before = h.applied.length;
  h.store.sparkWallets = h.store.sparkWallets.filter((w) => w.id !== 'Business');
  h.lifecycle.forget('Business');
  gate.resolve({ balance: 99999, fresh: true });
  await run;
  assert.equal(h.applied.length, before, 'no stale write after removal');
  assert.equal(h.subscribers.get('Business').size, 0);
  h.emit('Business', { type: 'paymentSucceeded', payment: { id: 'x', paymentType: 'receive', status: 'completed', amount: 1n } });
  assert.equal(h.receipts.length, 0);
  await h.lifecycle.reconcile('Business', 'timer');
  assert.equal(h.calls.balance.Business, 2, 'a removed wallet is not reconciled again');
});

test('the foreground timer keeps both wallets reconciling while the app runs', async () => {
  const h = harness();
  h.lifecycle.start(); await tick(); await tick();
  const first = { ...h.calls.balance };
  h.t.runAll(); await tick(); await tick();
  assert.ok(h.calls.balance.Business > first.Business);
  assert.ok(h.calls.balance.Personal > first.Personal);
  h.lifecycle.stop();
  assert.equal(h.t.pending.size, 0, 'stop clears every timer');
});

test('diagnostics are redacted', async () => {
  const h = harness({ wallets: ['wallet-1790000000000-secretsuffix'] });
  await h.lifecycle.reconcile('wallet-1790000000000-secretsuffix', 'start');
  const d = h.lifecycle.diagnostics();
  assert.ok(d.length > 0);
  for (const e of d) {
    assert.ok(!JSON.stringify(e).includes('wallet-1790000000000'), 'wallet ids are shortened');
    assert.ok(!('balance' in e));
  }
});

test('an SDK "synced" event counts only when Spark demonstrably answered', async () => {
  let answered = false;
  const h = harness({ syncedEventVerified: () => answered });
  h.behaviour.Business = { balance: async () => ({ balance: 5, fresh: false, syncError: 'Spark did not answer the sync' }) };
  await h.lifecycle.reconcile('Business', 'timer');
  assert.equal(h.lifecycle.status('Business').health, HEALTH.DEGRADED);
  h.emit('Business', { type: 'synced' }); // Breez emits this even offline
  assert.equal(h.lifecycle.status('Business').health, HEALTH.DEGRADED, 'an unverified synced event proves nothing');
  answered = true;
  h.emit('Business', { type: 'synced' });
  assert.equal(h.lifecycle.status('Business').health, HEALTH.HEALTHY);
  h.lifecycle.stop();
});

test('event cache reads publish as verified only with network evidence (#297 review)', async () => {
  let answered = false;
  const h = harness({ syncedEventVerified: () => answered });
  await h.lifecycle.reconcile('Business', 'start');
  h.applied.length = 0;
  h.behaviour.Business = { cached: 0 };
  h.emit('Business', { type: 'paymentSucceeded', payment: { id: 'x', paymentType: 'send', status: 'completed', amount: 1n } });
  await tick();
  assert.deepEqual(h.applied.map((a) => [a.source, a.fresh]), [['cache', false]], 'partial-sync events are cache readings');
  answered = true;
  h.emit('Business', { type: 'paymentSucceeded', payment: { id: 'y', paymentType: 'send', status: 'completed', amount: 1n } });
  await tick();
  assert.deepEqual(h.applied.at(-1).fresh, true);
});

test('catch-up pages past the first page until the checkpoint is covered', async () => {
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start'); // primes
  const nowS = Math.floor(h.t.now() / 1000);
  h.t.advance(10 * 60 * 1000);
  // 120 new receipts since the checkpoint, newest first.
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, type: 'receive', status: 'completed', amount: 1, fee: 0, timestamp: nowS + 590 - i }));
  h.behaviour.Business = { history: rows };
  await h.lifecycle.reconcile('Business', 'resume');
  assert.equal(h.receipts.length, 120, 'nothing beyond the first page is lost');
  assert.ok(h.calls.history.Business >= 4);
});

test('a hung history read cannot stall the wallet', async () => {
  const t0 = Date.now();
  const h = harness();
  await h.lifecycle.reconcile('Business', 'start');
  h.behaviour.Business = { history: () => new Promise(() => {}) };
  const run = h.lifecycle.reconcile('Business', 'timer');
  await tick();
  h.t.runAll(); // the deadline fires
  await run;
  assert.equal(h.lifecycle.status('Business').health, HEALTH.HEALTHY, 'sync result stands; history retries next pass');
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(h.lifecycle.diagnostics().some((d) => d.event === 'catchup-failed' && d.error === 'DEADLINE'));
});

test('diagnostics never keep SDK error text', async () => {
  const h = harness();
  h.behaviour.Business = { balance: async () => { throw new Error('send to bc1qsecretaddress failed'); } };
  await h.lifecycle.reconcile('Business', 'timer');
  assert.ok(!JSON.stringify(h.lifecycle.diagnostics()).includes('bc1q'));
  h.lifecycle.stop();
});
