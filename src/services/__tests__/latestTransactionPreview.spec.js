import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLatestTransactionPreview, previewMatchesReceipt } from '../latestTransactionPreview.js';

const T0 = 1_790_000_000_000;
const row = (id, at = T0, extra = {}) => ({ id, type: 'incoming', amount: 2100, status: 'completed', settled_at: at / 1000, ...extra });
const activity = (id = 'paid', extra = {}) => ({ walletId: 'A', paymentId: id, amountSats: 2100, settledAt: T0, observedAt: T0, sequence: id, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup({ initial = [row('coffee', T0 - 10000, { type: 'outgoing' })], readHistory, prepareTransactions, normalizeRow } = {}) {
  let time = T0;
  let next = 0;
  const timers = new Map();
  const reads = [];
  const writes = [];
  const changes = [];
  const context = { walletId: 'A', walletType: 'spark', wallet: {}, owner: {} };
  const controller = createLatestTransactionPreview({
    readHistory: (ctx, options) => { reads.push(ctx); return readHistory ? readHistory(ctx, options) : []; },
    ...(prepareTransactions ? { prepareTransactions } : {}),
    ...(normalizeRow ? { normalizeRow } : {}),
    readCache: () => initial,
    writeCache: (walletId, rows) => writes.push({ walletId, rows }),
    onChange: (state) => changes.push(state),
    now: () => time,
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  controller.select(context);
  return { controller, context, reads, writes, changes, timers,
    state: () => controller.getState(),
    async advance(ms) {
      const target = time + ms;
      await flush();
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await flush();
      }
      time = target;
      await flush();
    },
  };
}

test('confirmed activity acknowledges amount synchronously and reads immediately, without the periodic timer', async () => {
  const read = deferred();
  const h = setup({ readHistory: () => read.promise });
  h.controller.receive(activity());
  assert.equal(h.state().phase, 'receipt');
  assert.equal(h.state().receipt.amountSats, 2100);
  assert.equal(h.state().busy, true);
  await flush();
  assert.equal(h.reads.length, 1);
  read.resolve([row('paid')]);
  await flush();
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'paid');
  assert.equal(h.state().busy, false);
  assert.equal(h.timers.size, 0);
});

test('a recent activity restored into a fresh Home does not replay its arrival', async () => {
  const h = setup({ readHistory: () => new Promise(() => {}) });
  h.controller.receive(activity(), { replayArrival: false });
  assert.equal(h.state().phase, 'receipt');
  assert.equal(h.state().arrivalKey, 0);
  await h.advance(15000);
  assert.equal(h.state().phase, 'unavailable');
});

test('a send after observation is provably newer even when receipt settlement time is unknown', async () => {
  const h = setup({ readHistory: async () => [row('new-send', T0 + 1000, { type: 'outgoing' })] });
  h.controller.receive(activity('paid', { settledAt: null }));
  await flush();
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'new-send');
  assert.equal(h.state().transaction.settled_at, (T0 + 1000) / 1000);
});

test('initial loading, successful empty history and a failed history read stay distinct', async () => {
  const empty = setup({ initial: [] });
  assert.equal(empty.state().phase, 'initial');
  await empty.controller.refresh();
  assert.equal(empty.state().phase, 'empty');
  const failed = setup({ readHistory: async () => { throw new Error('offline'); } });
  await failed.controller.refresh();
  assert.equal(failed.state().transaction.id, 'coffee');
  assert.equal(failed.state().phase, 'ready');
  assert.equal(failed.state().error, 'failed');
  assert.equal(failed.writes.length, 0);
});

test('a missing receipt is retried until its exact row appears and metadata is ready', async () => {
  let count = 0;
  let prepared = false;
  const h = setup({
    readHistory: async () => ++count < 3 ? [row('coffee', T0 - 10000, { type: 'outgoing' })] : [row('paid')],
    prepareTransactions: async () => { prepared = true; },
    normalizeRow: raw => ({ ...raw, description: prepared ? 'Alice' : '' }),
  });
  h.controller.receive(activity());
  await flush();
  assert.equal(h.state().phase, 'receipt');
  await h.advance(1000);
  assert.equal(count, 3);
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.description, 'Alice');
});

test('a missing or failed detail read stops motion at the deadline, then retry can recover', async () => {
  let recovered = false;
  const h = setup({ readHistory: async () => { if (!recovered) throw new Error('offline'); return [row('paid')]; } });
  h.controller.receive(activity());
  await h.advance(15000);
  assert.equal(h.state().phase, 'unavailable');
  assert.equal(h.state().busy, false);
  assert.equal(h.state().receipt.amountSats, 2100);
  const arrival = h.state().arrivalKey;
  recovered = true;
  await h.controller.retry();
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().arrivalKey, arrival, 'retry does not replay success arrival');
});

test('unsupported history stops immediately and preserves the verified receipt', async () => {
  const h = setup({ readHistory: async () => ({ unsupported: true }) });
  h.controller.receive(activity());
  await flush();
  assert.equal(h.state().phase, 'unavailable');
  assert.equal(h.state().error, 'unsupported');
  assert.equal(h.state().receipt.amountSats, 2100);
  assert.equal(h.timers.size, 0);
});

test('hung metadata cannot withhold an available completed row', async () => {
  const h = setup({ readHistory: async () => [row('paid')], prepareTransactions: () => new Promise(() => {}) });
  h.controller.receive(activity());
  await h.advance(749);
  assert.equal(h.state().phase, 'receipt');
  await h.advance(1);
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'paid');
});

test('a hung history call times out; its eventual result cannot overwrite a later result', async () => {
  const stuck = deferred();
  let count = 0;
  const h = setup({ readHistory: () => ++count === 1 ? stuck.promise : [row('paid')] });
  h.controller.receive(activity());
  await h.advance(4250);
  assert.equal(h.state().phase, 'ready');
  stuck.resolve([row('old', T0 - 20000)]);
  await flush();
  assert.equal(h.state().transaction.id, 'paid');
});

test('wallet switches, including A -> B -> A, invalidate reads and cache writes', async () => {
  const old = deferred();
  let count = 0;
  const h = setup({ readHistory: () => ++count === 1 ? old.promise : [row('fresh')] });
  h.controller.refresh();
  await flush();
  h.controller.select({ walletId: 'B', owner: {}, wallet: {}, walletType: 'nwc' });
  h.controller.select(h.context);
  await h.controller.refresh();
  old.resolve([row('old')]);
  await flush();
  assert.equal(h.state().transaction.id, 'fresh');
  assert.equal(h.writes.length, 1);
});

test('live ownership invalidation blocks a response before the host selection watcher runs', async () => {
  const read = deferred();
  let live = true;
  const h = setup({ readHistory: () => read.promise });
  h.controller.select({ ...h.context, isCurrent: () => live });
  h.controller.refresh();
  await flush();
  live = false;
  read.resolve([row('wrong')]);
  await flush();
  assert.equal(h.state().transaction.id, 'coffee');
  assert.equal(h.writes.length, 0);
});

test('a receipt during an older read causes exactly one fresh follow-up, without stale publication', async () => {
  const first = deferred();
  let count = 0;
  const h = setup({ readHistory: () => ++count === 1 ? first.promise : [row('paid')] });
  h.controller.refresh();
  await flush();
  h.controller.receive(activity());
  h.controller.refresh();
  h.controller.refresh();
  first.resolve([row('coffee', T0 - 10000, { type: 'outgoing' })]);
  await flush();
  assert.equal(count, 2);
  assert.equal(h.state().transaction.id, 'paid');
  assert.equal(h.writes.length, 1);
});

test('duplicates never replay arrival or restart the budget; bursts keep the newer payment', async () => {
  const read = deferred();
  const h = setup({ readHistory: () => read.promise });
  const first = activity('first');
  h.controller.receive(first);
  const arrival = h.state().arrivalKey;
  h.controller.receive({ ...first, revision: 2 });
  assert.equal(h.state().arrivalKey, arrival);
  await flush();
  assert.equal(h.reads.length, 1);
  h.controller.receive(activity('second', { settledAt: T0 + 2000, observedAt: T0 + 2000, amountSats: 900 }));
  h.controller.receive(first);
  assert.equal(h.state().receipt.paymentId, 'second');
  assert.equal(h.state().receipt.amountSats, 900);
  read.resolve([row('first'), row('second', T0 + 2000, { amount: 900 })]);
  await flush();
  assert.equal(h.state().transaction.id, 'second');
});

test('a newer send stays latest even when a confirmed receive is reconciled afterward', async () => {
  const h = setup({ readHistory: async () => [row('paid'), row('new-send', T0 + 1000, { type: 'outgoing', amount: 500 })] });
  h.controller.receive(activity());
  await flush();
  assert.equal(h.state().transaction.id, 'new-send');
  assert.equal(h.state().transaction.type, 'outgoing');
  assert.equal(h.state().phase, 'ready');
});

test('a receipt older than the current send does not replace it with an interim receive', async () => {
  const h = setup({ initial: [row('send', T0 + 1000, { type: 'outgoing' })], readHistory: async () => [] });
  h.controller.receive(activity());
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'send');
});

test('receipt aliases and hashes match incoming rows only; amounts alone never match', () => {
  assert.equal(previewMatchesReceipt(row('new'), activity('old', { aliases: ['new'] })), true);
  assert.equal(previewMatchesReceipt(row('send', T0, { type: 'outgoing', paymentHash: 'abcd' }), activity('other', { paymentHash: 'abcd' })), false);
  assert.equal(previewMatchesReceipt(row('different'), activity('paid')), false);
});

test('pending invoices cannot become the preview or complete a confirmed receipt', async () => {
  const h = setup({ initial: [], readHistory: async () => [row('invoice', T0 + 1000, { status: 'pending' })] });
  await h.controller.refresh();
  assert.equal(h.state().phase, 'empty');
  assert.equal(h.writes[0].rows[0].id, 'invoice', 'History cache retains invoices excluded from the preview');
  h.controller.receive(activity('invoice'));
  await flush();
  assert.equal(h.state().phase, 'receipt');
  await h.advance(15000);
  assert.equal(h.state().phase, 'unavailable');
});

test('returning to a wallet restores its unresolved receipt without replay or a new deadline', async () => {
  const h = setup({ readHistory: async () => [] });
  const signal = activity();
  h.controller.receive(signal);
  await h.advance(1000);
  assert.ok(h.state().arrivalKey > 0);
  h.controller.select({ walletId: 'B', owner: {}, wallet: {} });
  await h.advance(15000);
  h.controller.select(h.context);
  h.controller.receive(signal);
  assert.equal(h.state().phase, 'unavailable');
  assert.equal(h.state().arrivalKey, 0, 'a newly mounted wallet card must not animate a restored arrival');
  assert.equal(h.state().receipt.paymentId, 'paid');
});

test('identity enrichment resolves an anonymous receipt without a second arrival', async () => {
  const h = setup({ readHistory: async () => [row('paid')] });
  h.controller.receive(activity(null, { sequence: 1, settledAt: null }));
  await flush();
  const key = h.state().arrivalKey;
  assert.equal(h.state().phase, 'receipt');
  h.controller.receive(activity('paid', { sequence: 1 }));
  await flush();
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().arrivalKey, key);
});

test('row aliases survive injected normalization and match a renamed receipt', async () => {
  const h = setup({ readHistory: async () => [row('new', T0, { aliases: ['old'] })],
    normalizeRow: raw => ({ id: raw.id, type: raw.type, amount: raw.amount, status: raw.status, settled_at: raw.settled_at }),
  });
  h.controller.receive(activity('old'));
  await flush();
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'new');
});

test('stale seeded activity remains static and can reconcile without replaying arrival', async () => {
  const h = setup({ readHistory: async () => [row('paid')] });
  h.controller.receive(activity('paid', { observedAt: T0 - 60000 }));
  assert.equal(h.state().phase, 'unavailable');
  assert.equal(h.state().busy, false);
  assert.equal(h.state().arrivalKey, 0);
  await flush();
  assert.equal(h.state().phase, 'ready');
});

test('a verified receive with unknown amount acknowledges without fabricating zero, then uses the row amount', async () => {
  const h = setup({ readHistory: async () => [row('paid', T0, { amount: 731 })] });
  h.controller.receive(activity('paid', { amountSats: null }));
  assert.equal(h.state().phase, 'receipt');
  assert.equal(h.state().receipt.amountSats, null);
  await flush();
  assert.equal(h.state().transaction.amount, 731);
  assert.equal(h.state().phase, 'ready');
});

test('a duplicate seed after switching cannot displace a newer cached send', async () => {
  const h = setup({ initial: [row('send', T0 + 1000, { type: 'outgoing' })], readHistory: async () => [] });
  const signal = activity();
  h.controller.receive(signal);
  h.controller.select({ walletId: 'B', owner: {}, wallet: {} });
  h.controller.select(h.context);
  h.controller.receive(signal);
  assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().transaction.id, 'send');
  assert.equal(h.state().receipt, null);
});

test('a stale snapshot missing the reconciled receipt cannot roll back to a same-second previous send', async () => {
  let snapshot = [row('paid'), row('previous-send', T0, { type: 'outgoing' })];
  const h = setup({ readHistory: async () => snapshot });
  h.controller.receive(activity());
  await flush();
  assert.equal(h.state().transaction.id, 'paid');
  snapshot = [row('previous-send', T0, { type: 'outgoing' })];
  await h.controller.refresh();
  assert.equal(h.state().transaction.id, 'paid');
  assert.equal(h.writes.length, 1, 'a stale snapshot cannot remove the receipt from shared cache');
  snapshot = [row('newer-send', T0 + 1000, { type: 'outgoing' })];
  await h.controller.refresh();
  assert.equal(h.state().transaction.id, 'newer-send', 'a provably newer transaction still wins');
});

test('same-second burst ordering can advance when the current transaction remains in the snapshot', async () => {
  let snapshot = [row('first')];
  const h = setup({ readHistory: async () => snapshot });
  h.controller.receive(activity('first'));
  await flush();
  snapshot = [row('second'), row('first')];
  h.controller.receive(activity('second'));
  await flush();
  assert.equal(h.state().transaction.id, 'second');
});

test('history gets detached receipt identity and real lookup settlement is never replaced by invoice creation time', async () => {
  let seen;
  const signal = activity('paid', { aliases: ['previous'], settledAt: T0 - 60000 });
  const h = setup({ initial: [], readHistory: async (_, options) => {
    seen = options.receipt;
    seen.aliases.push('private-mutation');
    return [row('paid', T0)];
  } });
  h.controller.receive(signal);
  await flush();
  assert.equal(seen._entry, undefined);
  assert.deepEqual(signal.aliases, ['previous']);
  assert.equal(h.state().transaction.settled_at, T0 / 1000);
});

test('dispose clears timers and prevents late reads from publishing or writing cache', async () => {
  const read = deferred();
  const h = setup({ readHistory: () => read.promise });
  h.controller.receive(activity());
  await flush();
  const count = h.changes.length;
  h.controller.dispose();
  read.resolve([row('paid')]);
  await flush();
  assert.equal(h.changes.length, count);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
});
