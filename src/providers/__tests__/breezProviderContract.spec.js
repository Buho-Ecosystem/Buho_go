/**
 * breezPayments — contract behaviors behind the Breez engine's provider.
 *
 * Coverage focus:
 *   - bolt11 route choice (embedded-spark rail vs Lightning) mirrors the
 *     cheapest-or-preferred rule the send path enforces the fee cap against
 *   - claim-error triage: an already-running/already-claimed claim is a
 *     race treated as success+processing (the claimed-registry must still
 *     record the txid); too-small comes from the "not enough to cover"
 *     wording, never from a raw `fee` match
 *   - deposit classification reproduces the direct engine's thresholds
 *     (MAX_FEE_SATS 3000, MAX_FEE_RATIO 0.05) and category names verbatim
 *   - withdrawal status synthesis: only three SDK statuses exist;
 *     'broadcasting' = pending + txid and is terminal-for-UX
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
  assert.equal(claimErrorKind('Deposit claim already in progress: abc'), 'processing');
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
  // The direct engine reserves 'too_small' for deposits under the
  // MIN_DEPOSIT_SATS floor (decided before quoting); a fee-eats-the-deposit
  // quote goes to the approval sheet where the numbers are disclosed.
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
