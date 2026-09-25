import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageFor, matureHeight, planStatus, estimateDate, triageFromQuote } from '../exitPlan.js';

const tx = (kind, txid, dependsOn = [], extra = {}) => ({ kind, txid, txHex: `${txid}-hex`, dependsOn, status: 'unconfirmed', ...extra });
const chain = [
  tx('fanOut', 'F'),
  tx('node', 'N1', ['F'], { cpfpTxHex: 'N1-child' }),
  tx('node', 'N2', ['N1'], { cpfpTxHex: 'N2-child' }),
  tx('refund', 'R', ['N2'], { cpfpTxHex: 'R-child', csvTimelockBlocks: 100 }),
  tx('sweep', 'S', ['R']),
];
const confirmed = blockHeight => ({ known: true, confirmed: true, blockHeight });
const pending = { known: true, confirmed: false };

test('packages pair a tree tx with its fee child; fan-out and sweep go alone', () => {
  assert.deepEqual(packageFor(chain[0]), ['F-hex']);
  assert.deepEqual(packageFor(chain[1]), ['N1-hex', 'N1-child']);
  assert.deepEqual(packageFor(chain[4]), ['S-hex']);
});

test('only the root is broadcastable until its dependency confirms', () => {
  const start = planStatus({ transactions: chain, statuses: {}, tipHeight: 1000 });
  assert.deepEqual(start.broadcastable, ['F']);
  assert.equal(start.phase, 'send');
  const rootPending = planStatus({ transactions: chain, statuses: { F: pending }, tipHeight: 1000 });
  assert.deepEqual(rootPending.broadcastable, []);
  assert.deepEqual(rootPending.pending, ['F']);
  const rootConfirmed = planStatus({ transactions: chain, statuses: { F: confirmed(1000) }, tipHeight: 1000 });
  assert.deepEqual(rootConfirmed.broadcastable, ['N1']);
  assert.equal(rootConfirmed.confirmed, 1);
});

test('the refund waits out its relative timelock and the unlock height is reported', () => {
  const statuses = { F: confirmed(1000), N1: confirmed(1001), N2: confirmed(1002) };
  assert.equal(matureHeight(chain[3], statuses), 1102);
  const waiting = planStatus({ transactions: chain, statuses, tipHeight: 1050 });
  assert.equal(waiting.phase, 'unlock');
  assert.deepEqual(waiting.unlock, { height: 1102, blocksLeft: 51 });
  assert.deepEqual(waiting.broadcastable, []);
  const oneEarly = planStatus({ transactions: chain, statuses, tipHeight: 1100 });
  assert.deepEqual(oneEarly.broadcastable, []);
  assert.equal(oneEarly.phase, 'unlock');
  const mature = planStatus({ transactions: chain, statuses, tipHeight: 1101 });
  assert.deepEqual(mature.broadcastable, ['R']);
  assert.equal(mature.phase, 'sweep');
});

test('the sweep follows the refund and finishes the exit', () => {
  const statuses = { F: confirmed(1000), N1: confirmed(1001), N2: confirmed(1002), R: confirmed(1102) };
  const sweeping = planStatus({ transactions: chain, statuses, tipHeight: 1102 });
  assert.equal(sweeping.phase, 'sweep');
  assert.deepEqual(sweeping.broadcastable, ['S']);
  const done = planStatus({ transactions: chain, statuses: { ...statuses, S: confirmed(1103) }, tipHeight: 1103 });
  assert.equal(done.phase, 'done');
  assert.equal(done.confirmed, 5);
  assert.equal(done.unlock, null);
});

test('dates and triage are derived, never invented', () => {
  const now = Date.UTC(2026, 8, 21);
  assert.equal(estimateDate(144, now).getTime(), now + 24 * 60 * 60 * 1000);
  assert.equal(estimateDate(-5, now).getTime(), now);
  const triage = triageFromQuote({ recoverableValueSat: 89700, totalFeeSat: 8800, singleUtxoFundingSat: 8500, leaves: [{}, {}, {}, {}] }, 99600);
  assert.deepEqual(triage, { recoverableSat: 89700, feeSat: 8800, fundingSat: 8500, notWorthSat: 9900, arrivesSat: 89400, leafCount: 4 });
  assert.equal(triageFromQuote(null).recoverableSat, 0);
});
