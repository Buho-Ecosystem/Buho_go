/**
 * breezPayments — on-chain withdrawal fee-quote tier mapping.
 *
 * Coverage focus:
 *   - the Breez SendOnchainFeeQuote (speedSlow/Medium/Fast with userFeeSat +
 *     l1BroadcastFeeSat) maps onto BuhoGO's tier shape exactly:
 *     serviceFee = userFeeSat, networkFee = l1BroadcastFeeSat,
 *     totalFee = sum, feeQuoteId = quote id, plus the time-estimate strings
 *     OnchainFeePanel renders
 *   - missing speed legs degrade to zeros instead of NaN
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezFeeQuote.spec.js
 */

import { strict as assert } from 'node:assert';
import { mapWithdrawFeeQuoteToTiers } from '../../utils/breezPayments.js';

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

console.log('breezPayments withdrawal fee-quote mapping');

const QUOTE = {
  id: 'quote-123',
  expiresAt: 1757001000,
  speedFast: { userFeeSat: 210, l1BroadcastFeeSat: 900 },
  speedMedium: { userFeeSat: 150, l1BroadcastFeeSat: 450 },
  speedSlow: { userFeeSat: 100, l1BroadcastFeeSat: 200 },
};

test('all three speeds translate service/network/total fees', () => {
  const tiers = mapWithdrawFeeQuoteToTiers(QUOTE);

  assert.deepEqual(tiers.fast, {
    serviceFee: 210, networkFee: 900, totalFee: 1110,
    feeQuoteId: 'quote-123', timeEstimate: 'Next block',
  });
  assert.deepEqual(tiers.medium, {
    serviceFee: 150, networkFee: 450, totalFee: 600,
    feeQuoteId: 'quote-123', timeEstimate: '~30 min',
  });
  assert.deepEqual(tiers.slow, {
    serviceFee: 100, networkFee: 200, totalFee: 300,
    feeQuoteId: 'quote-123', timeEstimate: '~1 hour',
  });
});

test('expiresAt passes through as a number', () => {
  const tiers = mapWithdrawFeeQuoteToTiers(QUOTE);
  assert.equal(tiers.expiresAt, 1757001000);
});

test('every tier carries the same quote id (the send must reuse it)', () => {
  const tiers = mapWithdrawFeeQuoteToTiers(QUOTE);
  assert.equal(tiers.slow.feeQuoteId, tiers.fast.feeQuoteId);
  assert.equal(tiers.medium.feeQuoteId, 'quote-123');
});

test('missing speed legs degrade to zero fees, never NaN', () => {
  const tiers = mapWithdrawFeeQuoteToTiers({ id: 'q2', expiresAt: 0 });
  assert.deepEqual(tiers.medium, {
    serviceFee: 0, networkFee: 0, totalFee: 0,
    feeQuoteId: 'q2', timeEstimate: '~30 min',
  });
  assert.equal(Number.isNaN(tiers.fast.totalFee), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
