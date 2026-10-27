import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReceiptLedger, receiptFromPayment, receiptDelivery, catchUpReceipts, CHECKPOINT_SLACK_S } from '../paymentReceipts.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

const T0 = 1_790_000_000; // unix s
function clock(start = T0) {
  let t = start * 1000;
  return { now: () => t, advance: (s) => { t += s * 1000; }, s: () => Math.floor(t / 1000) };
}
const receive = (id, amount, ts, status = 'completed') => ({ id, paymentType: 'receive', status, amount: BigInt(amount), fees: 0n, timestamp: ts });
const send = (id, amount, ts, status = 'completed') => ({ id, paymentType: 'send', status, amount: BigInt(amount), fees: 0n, timestamp: ts });

test('a receive overlapping a send is still detected, with its own amount', () => {
  // 1,000 + 200 - 300 = 900: the balance went down, a receipt still happened.
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('A', []);
  c.advance(10);
  assert.equal(ledger.ingest('A', send('s1', 300, c.s())), null);
  const r = ledger.ingest('A', receive('r1', 200, c.s()));
  assert.equal(r.amountSats, 200);
  assert.equal(r.walletId, 'A');
});

test('each wallet is detected independently of the other and of selection', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('Business', []); ledger.prime('Personal', []);
  c.advance(5);
  assert.ok(ledger.ingest('Business', receive('p', 50, c.s())));
  // The same payment id in another wallet is another wallet's receipt.
  assert.ok(ledger.ingest('Personal', receive('p', 70, c.s())));
  assert.equal(ledger.ingest('Business', receive('p', 50, c.s())), null);
});

test('event replay, catch-up and restart announce a payment at most once', () => {
  const c = clock();
  const storage = memory();
  let ledger = createReceiptLedger({ storage, now: c.now });
  ledger.prime('A', []);
  c.advance(30);
  const p = receive('r1', 1000, c.s());
  assert.ok(ledger.ingest('A', p, { origin: 'event' }));
  assert.equal(ledger.ingest('A', p, { origin: 'event' }), null, 'replayed event');
  assert.equal(ledger.ingest('A', p, { origin: 'catchup' }), null, 'history catch-up');
  ledger = createReceiptLedger({ storage, now: c.now }); // app restart
  assert.equal(ledger.ingest('A', p, { origin: 'catchup' }), null, 'after restart');
});

test('initial history is a silent baseline, never "you received your balance"', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  const history = [receive('old1', 5000, T0 - 86400), receive('old2', 25000, T0 - 3600)];
  ledger.prime('A', history);
  for (const p of history) assert.equal(ledger.ingest('A', p, { origin: 'catchup' }), null);
  // Older history paged in later is still old.
  assert.equal(ledger.ingest('A', receive('older', 1, T0 - 7 * 86400), { origin: 'catchup' }), null);
});

test('missed events are caught up from history, including one older than a later live event', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('A', []);
  ledger.markCaughtUp('A', c.s());
  c.advance(600); // app in background, stream dead
  const missedEarly = receive('m1', 100, c.s());
  c.advance(600);
  const live = receive('m2', 200, c.s());
  assert.ok(ledger.ingest('A', live, { origin: 'event' }));
  const caught = ledger.ingest('A', missedEarly, { origin: 'catchup' });
  assert.ok(caught, 'a later live event must not hide an earlier missed payment');
  assert.equal(caught.amountSats, 100);
  assert.equal(caught.origin, 'catchup');
});

test('outgoing, failed and pending payments are never completed receipts', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('A', []);
  c.advance(1);
  assert.equal(ledger.ingest('A', send('s', 10, c.s())), null);
  assert.equal(ledger.ingest('A', receive('f', 10, c.s(), 'failed')), null);
  assert.equal(ledger.ingest('A', receive('p', 10, c.s(), 'pending')), null);
  // The pending receive completing later is announced then, once.
  assert.ok(ledger.ingest('A', receive('p', 10, c.s(), 'completed')));
  assert.equal(ledger.ingest('A', receive('p', 10, c.s(), 'completed')), null);
  assert.equal(ledger.isSeen('A', 's'), true, 'settled sends count as seen activity');
});

test('internal transfers between own wallets are recorded, not announced', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('B', []);
  c.advance(1);
  assert.equal(ledger.ingest('B', receive('t', 500, c.s()), { internal: true }), null);
  assert.equal(ledger.ingest('B', receive('t', 500, c.s())), null, 'and not re-announced later');
});

test('catch-up tolerates small clock skew but not old history', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('A', []);
  ledger.markCaughtUp('A', c.s());
  assert.ok(ledger.ingest('A', receive('skew', 1, c.s() - CHECKPOINT_SLACK_S + 5), { origin: 'catchup' }));
  assert.equal(ledger.ingest('A', receive('old', 1, c.s() - CHECKPOINT_SLACK_S - 60), { origin: 'catchup' }), null);
});

test('the seen set is bounded per wallet', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now, maxSeen: 5 });
  ledger.prime('A', []);
  for (let i = 0; i < 20; i++) ledger.ingest('A', receive(`r${i}`, 1, c.s()));
  assert.equal(ledger.isSeen('A', 'r19'), true);
  assert.equal(ledger.isSeen('A', 'r0'), false);
});

test('mapped history rows normalize to the received (net) amount', () => {
  const row = { id: 'x', type: 'receive', amount: 1005, fee: 5, status: 'completed', timestamp: T0 };
  assert.equal(receiptFromPayment(row).amountSats, 1000);
  assert.equal(receiptFromPayment(receive('y', 42, T0)).amountSats, 42);
});

test('delivery: settled while hidden is posted even after returning; on screen is not', () => {
  const receipt = { timestamp: T0 + 100 };
  assert.deepEqual(receiptDelivery(receipt, { hiddenNow: true }), { system: true });
  assert.deepEqual(receiptDelivery(receipt, { hiddenNow: false, hiddenIntervals: [[T0, T0 + 200]] }), { system: true });
  assert.deepEqual(receiptDelivery(receipt, { hiddenNow: false, hiddenIntervals: [[T0 + 300, null]] }), { system: false });
  assert.deepEqual(receiptDelivery(receipt, { hiddenNow: false, hiddenIntervals: [] }), { system: false });
});

test('token transfers are never announced as sats (#297 review)', () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('A', []);
  c.advance(1);
  assert.equal(ledger.ingest('A', { ...receive('tok', 5_000_000, c.s()), method: 'token' }), null);
  assert.equal(ledger.ingest('A', { ...receive('tok2', 5, c.s()), details: { type: 'token' } }), null);
});

test('a receive pending at baseline or before a restart is announced when it settles', () => {
  const c = clock();
  const storage = memory();
  let ledger = createReceiptLedger({ storage, now: c.now });
  const created = c.s();
  ledger.prime('A', [receive('slow', 700, created, 'pending')]);
  ledger.markCaughtUp('A', c.s());
  c.advance(3600); // settles an hour later, after a restart
  ledger = createReceiptLedger({ storage, now: c.now });
  assert.deepEqual(ledger.pendingIds('A'), ['slow']);
  ledger.markCaughtUp('A', c.s());
  const r = ledger.ingest('A', receive('slow', 700, created), { origin: 'catchup' });
  assert.ok(r, 'old creation time, but it was pending: still news');
  assert.equal(r.amountSats, 700);
  assert.deepEqual(ledger.pendingIds('A'), []);
});

// ---- catchUpReceipts: the one catch-up every wallet type uses ----------

/** A wallet's mapped history rows (LNbits, NWC, Arkade shape), newest first. */
const row = (id, sats, ts, extra = {}) => ({ id, type: 'receive', status: 'completed', amount: sats, fee: 0, timestamp: ts, ...extra });
const pager = (rows) => { const reads = []; return { reads, readPage: async (offset, limit) => { reads.push([offset, limit]); return rows.slice(offset, offset + limit); } }; };

test('catch-up: the first read only sets the baseline, later ones announce what is new', async () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  const delivered = [];
  const history = [row('old-1', 10, c.s() - 100), row('old-2', 20, c.s() - 200)];
  const { readPage } = pager(history);
  const first = await catchUpReceipts({ ledger, walletId: 'W', readPage, deliver: (r) => delivered.push(r), now: c.now });
  assert.deepEqual(first, { primed: true, announced: 0, unseen: 0 });
  assert.equal(delivered.length, 0, 'what was there before is not news');
  c.advance(30);
  history.unshift(row('new', 500, c.s()));
  const second = await catchUpReceipts({ ledger, walletId: 'W', readPage, deliver: (r) => delivered.push(r), now: c.now });
  assert.deepEqual([second.announced, second.unseen], [1, 1]);
  assert.equal(delivered[0].id, 'new');
  assert.equal(delivered[0].amountSats, 500);
  const third = await catchUpReceipts({ ledger, walletId: 'W', readPage, deliver: (r) => delivered.push(r), now: c.now });
  assert.equal(third.announced, 0, 'read again: nothing twice');
});

test('catch-up: pages back with offset and limit until the checkpoint is covered, bounded', async () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('W', []);
  c.advance(3600);
  const rows = Array.from({ length: 120 }, (_, i) => row(`p${i}`, 1, c.s() - i));
  const { readPage, reads } = pager(rows);
  const delivered = [];
  await catchUpReceipts({ ledger, walletId: 'W', readPage, deliver: (r) => delivered.push(r), now: c.now });
  assert.deepEqual(reads, [[0, 50], [50, 50], [100, 50]]);
  assert.equal(delivered.length, 120, 'nothing beyond the first page is lost');
  const capped = pager(Array.from({ length: 900 }, (_, i) => row(`q${i}`, 1, c.s())));
  await catchUpReceipts({ ledger, walletId: 'W2', readPage: capped.readPage, now: c.now }); // primes
  await catchUpReceipts({ ledger, walletId: 'W2', readPage: capped.readPage, maxPages: 3, now: c.now });
  assert.equal(capped.reads.length, 1 + 3, 'a baseline reads one page, a catch-up at most maxPages');
});

test('catch-up: a wallet removed mid-read decides nothing', async () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('W', []);
  c.advance(10);
  let current = true;
  const result = await catchUpReceipts({
    ledger, walletId: 'W', now: c.now,
    readPage: async () => { current = false; return [row('x', 1, c.s())]; },
    isCurrent: () => current,
    deliver: () => assert.fail('a removed wallet announces nothing'),
  });
  assert.equal(result, null);
  assert.equal(ledger.isSeen('W', 'x'), false);
});

test('catch-up: the user\'s own transfer is recorded, never announced', async () => {
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('W', []);
  c.advance(10);
  const result = await catchUpReceipts({
    ledger, walletId: 'W', now: c.now,
    readPage: async () => [row('mine', 300, c.s(), { paymentHash: 'h1' })],
    isInternal: (p) => p.paymentHash === 'h1',
    deliver: () => assert.fail('an internal transfer is not money arriving'),
  });
  assert.equal(result.announced, 0);
  assert.equal(ledger.isSeen('W', 'mine'), true);
});

test('an invoice created long ago and paid now counts from when it was paid', async () => {
  // LNbits lists a payment by when its invoice was made; settled_at says when money arrived.
  const c = clock();
  const ledger = createReceiptLedger({ storage: memory(), now: c.now });
  ledger.prime('W', []);
  c.advance(7200);
  ledger.markCaughtUp('W', c.s() - 60); // the app read this wallet a minute ago
  const late = row('late', 40, c.s() - 7000, { settled_at: c.s() });
  assert.ok(ledger.ingest('W', late, { origin: 'catchup' }), 'paid just now: news');
  const replay = row('replay', 40, c.s() - 7000, { settled_at: c.s() - 7000 });
  assert.equal(ledger.ingest('W', replay, { origin: 'catchup' }), null, 'paid long before the checkpoint: history, not news');
});
