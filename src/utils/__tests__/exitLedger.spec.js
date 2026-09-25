import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newExit, withQuote, withFunding, withBuild, withChain, withError, withoutError, canCancel, isActive, arrivedSat } from '../exitLedger.js';

const quote = { recoverableValueSat: 89700, totalFeeSat: 8800, fanoutFeeSat: 300, singleUtxoFundingSat: 8500, feeRateSatPerVbyte: 4, destination: 'bc1qdest', leaves: [{ leafId: 'a', value: 50000 }, { leafId: 'b', value: 39700 }] };
const base = () => newExit({ walletId: 'w1', walletName: 'Personal', network: 'mainnet', destination: { address: 'bc1qdest' }, funding: { address: 'bc1qfee', publicKeyHex: '02ab', path: "m/84'/0'/0'/0/1" }, quote, balanceSat: 99600, now: 1000 });

test('a new exit waits for fee money and carries the honest triage', () => {
  const exit = base();
  assert.equal(exit.stage, 'fund');
  assert.equal(exit.funding.requiredSat, 8500);
  assert.deepEqual(exit.quote.leafIds, ['a', 'b']);
  assert.equal(exit.triage.notWorthSat, 9900);
  assert.equal(exit.triage.arrivesSat, 89400);
  assert.equal(canCancel(exit), true);
  assert.equal(isActive(exit), true);
});

test('funding settles the stage from confirmed value only', () => {
  let exit = withFunding(base(), [{ txid: 't', vout: 0, value: 9000, confirmed: false }], 2000);
  assert.equal(exit.stage, 'fund');
  assert.equal(exit.funding.shortfallSat, 8500);
  exit = withFunding(exit, [{ txid: 't', vout: 0, value: 9000, confirmed: true }], 3000);
  assert.equal(exit.stage, 'ready');
  assert.equal(exit.funding.confirmedAt, 3000);
  const repriced = withQuote(exit, { ...quote, singleUtxoFundingSat: 9500 }, 99600, 4000);
  assert.equal(repriced.stage, 'fund');
  assert.equal(repriced.funding.shortfallSat, 500);
});

test('signing freezes the record and chain facts drive it to done', () => {
  const funded = withFunding(base(), [{ txid: 't', vout: 0, value: 9000, confirmed: true }], 2000);
  const built = withBuild(funded, { recoverableValueSat: 89700, totalFeeSat: 8800, leaves: quote.leaves, transactions: [
    { kind: 'fanOut', txid: 'F', txHex: 'f', dependsOn: [], status: 'unconfirmed' },
    { kind: 'node', txid: 'N', txHex: 'n', cpfpTxHex: 'nc', dependsOn: ['F'], status: 'unconfirmed' },
    { kind: 'refund', txid: 'R', txHex: 'r', cpfpTxHex: 'rc', csvTimelockBlocks: 10, dependsOn: ['N'], status: 'unconfirmed' },
    { kind: 'sweep', txid: 'S', txHex: 's', dependsOn: ['R'], status: 'unconfirmed' },
  ] }, 5000);
  assert.equal(built.stage, 'send');
  assert.equal(canCancel(built), false);
  assert.throws(() => withQuote(built, quote), /cannot change/);
  let exit = withChain(built, { statuses: {}, tipHeight: 100, now: 6000 });
  assert.deepEqual(exit.broadcastable, ['F']);
  exit = withChain(exit, { statuses: { F: { known: true, confirmed: true, blockHeight: 101 }, N: { known: true, confirmed: true, blockHeight: 102 } }, tipHeight: 103, now: 7000 });
  assert.equal(exit.stage, 'unlock');
  assert.equal(exit.unlock.height, 112);
  assert.equal(exit.unlock.blocksLeft, 8);
  assert.equal(exit.unlock.estimatedAt, 7000 + 8 * 600000);
  assert.equal(exit.sentAt, 7000);
  exit = withChain(exit, { statuses: { R: { known: true, confirmed: true, blockHeight: 112 } }, tipHeight: 112, now: 8000 });
  assert.equal(exit.stage, 'sweep');
  exit = withChain(exit, { statuses: { S: { known: true, confirmed: true, blockHeight: 113 } }, tipHeight: 113, now: 9000 });
  assert.equal(exit.stage, 'done');
  assert.equal(exit.doneAt, 9000);
  assert.equal(isActive(exit), false);
  assert.equal(arrivedSat(exit), 89400);
});

test('errors are counted and cleared without touching the stage', () => {
  const exit = withError(base(), new Error('tip unavailable'), 10);
  assert.equal(exit.lastError, 'tip unavailable');
  assert.equal(exit.attempts, 1);
  assert.equal(exit.stage, 'fund');
  assert.equal(withoutError(exit, 20).lastError, null);
});

test('a finished exit stays as a receipt until acknowledged, and fee money inputs are the fewest that cover the need', async () => {
  const { needsAttention, acknowledge, selectFundingInputs, sweepFeeSat } = await import('../exitLedger.js');
  const done = { ...base(), stage: 'done', quote: { totalFeeSat: 8800, singleUtxoFundingSat: 8500 } };
  assert.equal(needsAttention(done), true);
  const seen = acknowledge(done, 99);
  assert.equal(seen.acknowledgedAt, 99);
  assert.equal(needsAttention(seen), false);
  assert.equal(acknowledge(base(), 5).acknowledgedAt, undefined, 'only a finished exit can be acknowledged');
  assert.equal(sweepFeeSat(done), 300);
  const utxos = [{ txid: 'a', vout: 0, value: 3000, confirmed: true }, { txid: 'b', vout: 0, value: 9000, confirmed: true }, { txid: 'c', vout: 0, value: 50000, confirmed: false }];
  assert.deepEqual(selectFundingInputs(utxos, 8500), { inputs: [utxos[1]], totalSat: 9000, excessSat: 500, enough: true });
  assert.deepEqual(selectFundingInputs(utxos, 11000).inputs.map(u => u.txid), ['b', 'a']);
  assert.equal(selectFundingInputs(utxos, 20000).enough, false);
});

test('errors keep their code so the page can explain them', () => {
  const exit = withError(base(), Object.assign(new Error('boom'), { code: 'UNREACHABLE' }), 10);
  assert.equal(exit.lastErrorCode, 'UNREACHABLE');
  assert.equal(withoutError(exit, 20).lastErrorCode, null);
});
