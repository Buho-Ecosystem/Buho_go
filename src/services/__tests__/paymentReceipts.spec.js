import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPaymentReceipts, CATCHUP_OVERLAP_S } from '../paymentReceipts.js';

function memoryStorage() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

function harness({ storage = memoryStorage(), start = 1_700_000_000_000 } = {}) {
  let now = start;
  const delivered = [];
  const receipts = createPaymentReceipts({
    storage,
    now: () => now,
    paymentHashOf: p => p.hash || null,
    deliver: r => { delivered.push(r); },
  });
  return { receipts, delivered, storage, advance: ms => { now += ms; }, nowS: () => Math.floor(now / 1000) };
}

const receive = (id, amount, timestamp, extra = {}) => ({ id, paymentType: 'receive', status: 'completed', amount: BigInt(amount), timestamp, ...extra });

test('a receive is detected even when a simultaneous send lowers the net balance', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  h.advance(1000);
  // 1,000 + 200 − 300 = 900: the balance heuristic saw nothing. By id, the 200 is news.
  assert.equal(await h.receipts.observe('A', { id: 's1', paymentType: 'send', status: 'completed', amount: 300n, timestamp: h.nowS() }), 'ignored');
  assert.equal(await h.receipts.observe('A', receive('r1', 200, h.nowS())), 'delivered');
  assert.deepEqual(h.delivered.map(d => [d.walletId, d.amountSats]), [['A', 200]]);
});

test('each payment is announced at most once across event, catch-up and restart', async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  first.receipts.ensureBaseline('A');
  first.advance(5000);
  const p = receive('r1', 500, first.nowS());
  assert.equal(await first.receipts.observe('A', p, { source: 'event' }), 'delivered');
  assert.equal(await first.receipts.observe('A', p, { source: 'catchup' }), 'duplicate');
  const restarted = harness({ storage, start: 1_700_000_100_000 });
  assert.equal(restarted.receipts.ensureBaseline('A'), false, 'the baseline survives a restart');
  assert.equal(await restarted.receipts.observe('A', p, { source: 'event' }), 'duplicate');
  assert.equal(first.delivered.length + restarted.delivered.length, 1);
});

test('initial history (restore replay) is never announced', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  const old = receive('old', 25000, h.nowS() - 86400);
  assert.equal(await h.receipts.observe('A', old, { source: 'event' }), 'historical');
  assert.equal(h.delivered.length, 0);
});

test('a payment missed while the app was suspended is found by catch-up once', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  const baseline = h.nowS();
  assert.equal(h.receipts.catchUpFrom('A'), baseline, 'the first catch-up starts at the baseline, never before');
  h.advance(2 * 3600 * 1000);
  h.receipts.markCaughtUp('A', h.nowS());
  h.advance(3600 * 1000);
  const from = h.receipts.catchUpFrom('A');
  assert.equal(from, h.nowS() - 3600 - CATCHUP_OVERLAP_S, 'later passes overlap the previous one');
  const missed = receive('missed', 800, h.nowS() - 60);
  assert.equal(await h.receipts.observe('A', missed, { source: 'catchup' }), 'delivered');
  assert.equal(h.delivered[0].source, 'catchup');
});

test('pending and failed receives are not completed receipts, and are not burned', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  h.advance(1000);
  const pending = { ...receive('r', 100, h.nowS()), status: 'pending' };
  assert.equal(await h.receipts.observe('A', pending), 'ignored');
  assert.equal(await h.receipts.observe('A', { ...pending, status: 'failed' }), 'ignored');
  assert.equal(await h.receipts.observe('A', { ...pending, status: 'completed' }), 'delivered');
});

test('two wallets are tracked independently', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  h.receipts.ensureBaseline('B');
  h.advance(1000);
  const same = receive('shared-id', 100, h.nowS());
  assert.equal(await h.receipts.observe('A', same), 'delivered');
  assert.equal(await h.receipts.observe('B', same), 'delivered');
  assert.equal(await h.receipts.observe('C', same), 'untracked');
  assert.deepEqual(h.delivered.map(d => d.walletId), ['A', 'B']);
});

test('own transfers are recorded but not announced, matched by hash or by amount once', async () => {
  const h = harness();
  h.receipts.ensureBaseline('B');
  h.advance(1000);
  h.receipts.expectInternal('B', { paymentHash: 'h1', amountSats: 100 });
  h.receipts.expectInternal('B', { amountSats: 300 });
  assert.equal(await h.receipts.observe('B', receive('x', 100, h.nowS(), { hash: 'h1' })), 'internal');
  assert.equal(await h.receipts.observe('B', receive('y', 300, h.nowS())), 'internal');
  assert.equal(await h.receipts.observe('B', receive('z', 300, h.nowS())), 'delivered', 'an expectation is consumed once');
  h.receipts.expectInternal('B', { amountSats: 50 });
  h.advance(10 * 60 * 1000);
  assert.equal(await h.receipts.observe('B', receive('w', 50, h.nowS())), 'delivered', 'expectations expire');
});

test('seen history is bounded and a broken storage degrades to memory', async () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  let now = 1_700_000_000_000;
  const receipts = createPaymentReceipts({ storage: broken, now: () => now, maxSeen: 3, deliver() {} });
  receipts.ensureBaseline('A');
  now += 1000;
  for (let i = 0; i < 5; i++) await receipts.observe('A', receive(`r${i}`, 1, Math.floor(now / 1000)));
  assert.deepEqual(receipts.snapshot('A').seen, ['r2', 'r3', 'r4']);
});

test('forgetting a removed wallet drops its state', async () => {
  const h = harness();
  h.receipts.ensureBaseline('A');
  h.receipts.forget('A');
  assert.equal(h.receipts.snapshot('A'), null);
  assert.equal(await h.receipts.observe('A', receive('r', 1, h.nowS())), 'untracked');
});
