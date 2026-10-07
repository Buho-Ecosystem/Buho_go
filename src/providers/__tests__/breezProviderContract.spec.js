/**
 * breezPayments — contract behaviors behind the Spark wallet provider.
 *
 * Coverage focus:
 *   - bolt11 route choice (embedded-spark rail vs Lightning) mirrors the
 *     cheapest-or-preferred rule the send path enforces the fee cap against
 *   - claim-error triage: an already-claimed claim is a race treated as
 *     success+processing; a claim lock held elsewhere is NOT (retry) (the claimed-registry must still
 *     record the txid); too-small comes from the "not enough to cover"
 *     wording, never from a raw `fee` match
 *   - deposit classification reproduces the app's claim thresholds
 *     (MAX_FEE_SATS 3000, MAX_FEE_RATIO 0.05) and category names verbatim
 *   - withdrawal status synthesis: only three SDK statuses exist;
 *     'broadcasting' = pending + txid and is terminal-for-UX
 *   - claim outcome (SDK 0.26): settled/submitted are claims; deferred and
 *     unrecognised answers never are, so nothing marks them claimed
 *   - SDK deposit records: merged with the explorer list, and the only
 *     proof that lets a wrong claimed mark be released
 *   - the wait leg of a claim quote keeps its estimate flag
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezProviderContract.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  pickBolt11Route,
  claimErrorKind,
  classifyFromMatureQuote,
  withdrawalStatusFromPayment,
  claimDepositOutcome,
  deferredClaimError,
  sdkDepositClaimed,
  mergePendingDeposits,
  sdkProvesUnclaimed,
  waitQuoteFromMature,
} from '../../utils/breezPayments.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

// Mirrors src/stores/bitcoinPreferences.js AUTO_CLAIM_THRESHOLDS (the
// provider passes the real object; the numbers are pinned product rules).
const THRESHOLDS = { MAX_FEE_SATS: 3000, MAX_FEE_RATIO: 0.05, MIN_DEPOSIT_SATS: 1000 };

console.log('breezPayments provider-contract behaviors');

// --- bolt11 route choice -------------------------------------------------

test('spark rail wins when cheaper or equal', () => {
  assert.deepEqual(
    pickBolt11Route({ sparkTransferFeeSats: 0, lightningFeeSats: 4 }),
    { useSpark: true, routeFee: 0 }
  );
  assert.deepEqual(
    pickBolt11Route({ sparkTransferFeeSats: 4, lightningFeeSats: 4 }),
    { useSpark: true, routeFee: 4 }
  );
});

test('lightning wins when spark is dearer and not preferred', () => {
  assert.deepEqual(
    pickBolt11Route({ sparkTransferFeeSats: 9, lightningFeeSats: 4 }),
    { useSpark: false, routeFee: 4 }
  );
});

test('preferSpark forces the spark rail when it exists at all', () => {
  assert.deepEqual(
    pickBolt11Route({ sparkTransferFeeSats: 9, lightningFeeSats: 4, preferSpark: true }),
    { useSpark: true, routeFee: 9 }
  );
});

test('no embedded spark rail: lightning regardless of preference', () => {
  assert.deepEqual(
    pickBolt11Route({ sparkTransferFeeSats: undefined, lightningFeeSats: 7, preferSpark: true }),
    { useSpark: false, routeFee: 7 }
  );
});

// --- claim-error triage --------------------------------------------------

test('already-running/claimed variants are a race, not a failure', () => {
  // The SDK's own (0-sat capped) sync attempt holds this lock and fails:
  // never a success, or the deposit is hidden while still unclaimed.
  assert.equal(claimErrorKind('Deposit claim already in progress: abc'), 'in_progress');
  assert.equal(claimErrorKind('Static deposit has already been claimed'), 'processing');
  assert.equal(claimErrorKind('utxo already claimed'), 'processing');
  assert.equal(claimErrorKind('TRANSFER_LOCKED by concurrent stream'), 'processing');
  assert.equal(claimErrorKind('leaf is locked'), 'processing');
});

test('too-small comes from the not-enough-to-cover wording, before fee', () => {
  // Breez's claim-side message contains the word "fee" too; the too-small
  // triage must win or the user sees "fee changed" for a dust deposit.
  assert.equal(claimErrorKind('1200 sats is not enough to cover fee of 1500'), 'too_small');
  assert.equal(claimErrorKind('output is dust'), 'too_small');
});

test('confirmations and fee-changed keep their triage', () => {
  assert.equal(claimErrorKind('needs more confirmations'), 'confirmations');
  assert.equal(claimErrorKind('Max deposit claim fee exceeded for utxo: x'), 'fee_changed');
});

test('unknown errors triage to null (rethrow path)', () => {
  assert.equal(claimErrorKind('some transport failure'), null);
  assert.equal(claimErrorKind(undefined), null);
});

// --- deposit classification ---------------------------------------------

test('cheap claim on a healthy deposit is eligible', () => {
  const c = classifyFromMatureQuote({
    depositAmountSats: 50000,
    quote: { creditAmountSats: 49910, feeSats: 90 },
    thresholds: THRESHOLDS,
  });
  assert.equal(c.category, 'eligible');
  assert.equal(c.feeSats, 90);
});

test('fee over the absolute cap needs approval', () => {
  const c = classifyFromMatureQuote({
    depositAmountSats: 500000,
    quote: { creditAmountSats: 496500, feeSats: 3500 },
    thresholds: THRESHOLDS,
  });
  assert.equal(c.category, 'needs_approval');
});

test('fee over the 5% ratio needs approval even under the absolute cap', () => {
  const c = classifyFromMatureQuote({
    depositAmountSats: 10000,
    quote: { creditAmountSats: 9200, feeSats: 800 },
    thresholds: THRESHOLDS,
  });
  assert.equal(c.category, 'needs_approval');
  assert.ok(c.feeRatio > 0.05);
});

test('fee at or above the deposit amount needs approval (never a silent too_small)', () => {
  // 'too_small' is reserved for deposits under the MIN_DEPOSIT_SATS floor
  // (decided before quoting); a fee-eats-the-deposit quote goes to the
  // approval sheet where the numbers are disclosed.
  const c = classifyFromMatureQuote({
    depositAmountSats: 1200,
    quote: { creditAmountSats: 0, feeSats: 1500 },
    thresholds: THRESHOLDS,
  });
  assert.equal(c.category, 'needs_approval');
  assert.ok(c.feeRatio > 1);
});

test('fee derived from credit delta when the quote omits feeSats', () => {
  const c = classifyFromMatureQuote({
    depositAmountSats: 20000,
    quote: { creditAmountSats: 19940 },
    thresholds: THRESHOLDS,
  });
  assert.equal(c.feeSats, 60);
  assert.equal(c.category, 'eligible');
});

// --- withdrawal status ---------------------------------------------------

test('completed payment is complete', () => {
  const s = withdrawalStatusFromPayment(
    { id: 'w1', status: 'completed', details: { type: 'withdraw', txId: 'tx1' } },
    'w1'
  );
  assert.equal(s.status, 'completed');
  assert.equal(s.isComplete, true);
  assert.equal(s.isFailed, false);
  assert.equal(s.txId, 'tx1');
});

test('pending with a broadcast txid synthesizes broadcasting and is terminal-for-UX', () => {
  const s = withdrawalStatusFromPayment(
    { id: 'w2', status: 'pending', details: { type: 'withdraw', txId: 'tx2' } },
    'w2'
  );
  assert.equal(s.status, 'broadcasting');
  assert.equal(s.isComplete, true);
  assert.equal(s.rawStatus, 'pending');
});

test('pending without a txid stays pending', () => {
  const s = withdrawalStatusFromPayment({ id: 'w3', status: 'pending' }, 'w3');
  assert.equal(s.status, 'pending');
  assert.equal(s.isComplete, false);
});

test('failed maps to failed; unknown payment reads as pending', () => {
  const s = withdrawalStatusFromPayment({ id: 'w4', status: 'failed' }, 'w4');
  assert.equal(s.isFailed, true);

  const missing = withdrawalStatusFromPayment(null, 'w5');
  assert.deepEqual(missing, {
    id: 'w5', status: 'pending', rawStatus: null, txId: null,
    isComplete: false, isFailed: false,
  });
});

// --- early (0-conf) claim outcome ----------------------------------------

test('settled and submitted outcomes are claims', () => {
  const payment = { id: 'pay_1', status: 'completed' };
  assert.deepEqual(claimDepositOutcome({ outcome: { type: 'settled', payment } }),
    { status: 'settled', payment, claimId: 'pay_1', reason: null });
  assert.deepEqual(claimDepositOutcome({ outcome: { type: 'submitted' } }),
    { status: 'submitted', payment: null, claimId: null, reason: null });
});

test('a deferred or unrecognised outcome is never a claim', () => {
  const reason = { type: 'maxFeeExceeded', requiredFeeSats: 900, maxFeeSats: 500 };
  assert.equal(claimDepositOutcome({ outcome: { type: 'deferred', reason } }).status, 'deferred');
  assert.equal(claimDepositOutcome({ outcome: { type: 'deferred', reason } }).reason, reason);
  // The pre-0.26 shape and empty answers do not authorize a claimed mark.
  assert.equal(claimDepositOutcome({}).status, 'deferred');
  assert.equal(claimDepositOutcome(undefined).status, 'deferred');
  const err = deferredClaimError(reason);
  assert.equal(err.code, 'DEPOSIT_CLAIM_DEFERRED');
  assert.match(err.message, /900 sats exceeds 500 sats/);
});

// --- SDK deposit records ---------------------------------------------------

const row = (over = {}) => ({ txid: 'tx1', vout: 0, amountSats: 132516, isMature: true, ...over });
const failedClaim = { claimError: { type: 'maxDepositClaimFeeExceeded', tx: 'tx1', vout: 0, requiredFeeSats: 200, requiredFeeRateSatPerVbyte: 2 } };

test('an early claim in flight or reported claimed counts as claimed', () => {
  assert.equal(sdkDepositClaimed(row({ instantClaimStatus: { type: 'submitted', claimId: 'c' } })), true);
  assert.equal(sdkDepositClaimed(row({ instantClaimStatus: { type: 'claimed' } })), true);
  assert.equal(sdkDepositClaimed(row({ instantClaimStatus: { type: 'declined' } })), false);
  assert.equal(sdkDepositClaimed(row()), false);
});

test('merge annotates explorer deposits with the SDK record', () => {
  const chain = [{ txId: 'tx1', outputIndex: 0, amount: 132516, confirmations: 900, confirmed: true }];
  const [d] = mergePendingDeposits({ chain, sdkRows: [row(failedClaim)], requiredConfirmations: 3 });
  assert.equal(d.confirmations, 900);
  assert.deepEqual(d.sdk, { isMature: true, claimed: false, claimError: 'maxDepositClaimFeeExceeded', refunding: false });
});

test('merge adds deposits only the SDK knows (an older deposit address)', () => {
  const merged = mergePendingDeposits({ chain: [], sdkRows: [row(failedClaim), row({ txid: 'tx2', isMature: false })], requiredConfirmations: 3 });
  assert.deepEqual(merged.map(d => [d.txId, d.amount, d.confirmed, d.confirmations]),
    [['tx1', 132516, true, 3], ['tx2', 132516, false, 0]]);
});

test('merge leaves out SDK-only deposits a claim or refund already has', () => {
  const merged = mergePendingDeposits({
    chain: null,
    sdkRows: [row({ instantClaimStatus: { type: 'submitted', claimId: 'c' } }), row({ txid: 'tx3', refundTxId: 'r' })],
    requiredConfirmations: 3,
  });
  assert.deepEqual(merged, []);
});

test('merge keeps the explorer list as-is when the SDK cannot be read', () => {
  const chain = [{ txId: 'tx1', outputIndex: 0, amount: 1, confirmations: 0, confirmed: false }];
  assert.deepEqual(mergePendingDeposits({ chain, sdkRows: null, requiredConfirmations: 3 }), chain);
});

test('only a mature, failed, unclaimed SDK record proves a claimed mark wrong', () => {
  const merged = (r) => mergePendingDeposits({ chain: [], sdkRows: [r], requiredConfirmations: 3 })[0]
    || mergePendingDeposits({ chain: [{ txId: r.txid, outputIndex: 0 }], sdkRows: [r], requiredConfirmations: 3 })[0];
  assert.equal(sdkProvesUnclaimed(merged(row(failedClaim))), true);
  assert.equal(sdkProvesUnclaimed(merged(row())), false, 'no failed attempt recorded');
  assert.equal(sdkProvesUnclaimed(merged(row({ ...failedClaim, isMature: false }))), false, 'immature');
  assert.equal(sdkProvesUnclaimed(merged(row({ ...failedClaim, instantClaimStatus: { type: 'claimed' } }))), false, 'claimed');
  assert.equal(sdkProvesUnclaimed(merged(row({ ...failedClaim, refundTxId: 'r' }))), false, 'refunding');
  assert.equal(sdkProvesUnclaimed({ txId: 'tx1', confirmed: true }), false, 'explorer only');
});

// --- wait leg of a claim quote -------------------------------------------

test('wait quote keeps credit, fee and the estimate flag', () => {
  assert.deepEqual(
    waitQuoteFromMature({ creditAmountSats: 66490, feeSats: 120, isEstimate: true, confirmationsRequired: 3, feeRateSatPerVbyte: 2 }),
    { creditAmountSats: 66490, feeSats: 120, isEstimate: true, confirmationsRequired: 3 }
  );
  assert.equal(waitQuoteFromMature({ creditAmountSats: 1, feeSats: 1 }).isEstimate, false);
});

test('missing mature leg yields null', () => {
  assert.equal(waitQuoteFromMature(undefined), null);
  assert.equal(waitQuoteFromMature(null), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
