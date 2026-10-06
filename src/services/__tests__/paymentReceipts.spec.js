import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReceiptLedger, receiptFromPayment, receiptDelivery, CHECKPOINT_SLACK_S } from '../paymentReceipts.js';

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
