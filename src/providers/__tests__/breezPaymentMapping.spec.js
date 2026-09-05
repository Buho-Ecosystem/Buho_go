/**
 * breezPayments — Breez Payment → BuhoGO transaction-row mapping.
 *
 * Coverage focus:
 *   - the details union is FLATTENED ({type:'lightning', htlcDetails, ...});
 *     hash/preimage/bolt11 come off the matching arm only
 *   - send rows are re-grossed (amount + fee); receive rows are not
 *   - description precedence puts the LNURL sender comment before the
 *     bolt11 description (which is a LUD-06 hash on LN-address receives)
 *   - rawType satisfies BOTH transaction UIs' Bitcoin-detection substring
 *     lists (history: l1/deposit/withdrawal/coop_exit/static_deposit/
 *     coop_close/claim; details: same minus coop_close/claim)
 *   - status passes through verbatim (closed completed|pending|failed set)
 *
 * Run directly with Node:
 *   node src/providers/__tests__/breezPaymentMapping.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  mapBreezPaymentToTx,
  detailsArm,
  paymentHashOf,
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

const HASH = 'a'.repeat(64);
const PREIMAGE = 'b'.repeat(64);

function lightningPayment(over = {}) {
  return {
    id: 'pay-1',
    paymentType: 'receive',
    status: 'completed',
    amount: 2100n,
    fees: 0n,
    timestamp: 1757000000,
    method: 'lightning',
    details: {
      type: 'lightning',
      description: 'plain memo',
      invoice: 'lnbc1...',
      destinationPubkey: '02ab',
      htlcDetails: { paymentHash: HASH, preimage: PREIMAGE, expiryTime: 1757003600, status: 'preimageShared' },
    },
    ...over,
  };
}

console.log('breezPayments payment mapping');

test('lightning receive maps hash, preimage, bolt11 from the flattened union', () => {
  const row = mapBreezPaymentToTx(lightningPayment());
  assert.equal(row.paymentHash, HASH);
  assert.equal(row.preimage, PREIMAGE);
  assert.equal(row.bolt11, 'lnbc1...');
  assert.equal(row.type, 'receive');
  assert.equal(row.amount, 2100);
  assert.equal(row.fee, 0);
  assert.equal(row.status, 'completed');
  assert.equal(row.rawType, 'LIGHTNING');
  assert.equal(row.sparkTransfer, false);
  assert.equal(row.timestamp, 1757000000);
});

test('send rows are re-grossed: amount = net + fee, fee kept separately', () => {
  const row = mapBreezPaymentToTx(lightningPayment({
    paymentType: 'send',
    amount: 5000n,
    fees: 12n,
  }));
  assert.equal(row.type, 'send');
  assert.equal(row.amount, 5012);
  assert.equal(row.fee, 12);
});

test('receive rows never add the fee', () => {
  const row = mapBreezPaymentToTx(lightningPayment({ amount: 5000n, fees: 12n }));
  assert.equal(row.amount, 5000);
});

test('sender comment outranks the bolt11 description (LUD-06 hash case)', () => {
  const p = lightningPayment();
  p.details.description = '286a1a338a...lud06-hash';
  p.details.lnurlReceiveMetadata = { senderComment: 'thanks for the coffee' };
  const row = mapBreezPaymentToTx(p);
  assert.equal(row.description, 'thanks for the coffee');
});

test('bolt11 description used when no sender comment exists', () => {
  const row = mapBreezPaymentToTx(lightningPayment());
  assert.equal(row.description, 'plain memo');
});

test('spark transfer: method spark sets sparkTransfer + SPARK_TRANSFER rawType', () => {
  const row = mapBreezPaymentToTx({
    id: 'pay-2',
    paymentType: 'send',
    status: 'completed',
    amount: 700n,
    fees: 0n,
    timestamp: 1757000001,
    method: 'spark',
    details: {
      type: 'spark',
      invoiceDetails: { description: 'spark memo', invoice: 'spark1invoice' },
      htlcDetails: { paymentHash: HASH, expiryTime: 0, status: 'preimageShared' },
    },
  });
  assert.equal(row.sparkTransfer, true);
  assert.equal(row.rawType, 'SPARK_TRANSFER');
  assert.equal(row.description, 'spark memo');
  assert.equal(row.paymentHash, HASH);
});

test('deposit and withdraw carry the chain txid and no hash', () => {
  const dep = mapBreezPaymentToTx({
    id: 'pay-3', paymentType: 'receive', status: 'completed', amount: 30000n,
    fees: 90n, timestamp: 1757000002, method: 'deposit',
    details: { type: 'deposit', txId: 'f'.repeat(64), vout: 0 },
  });
  assert.equal(dep.onchainTxId, 'f'.repeat(64));
  assert.equal(dep.paymentHash, null);
  assert.equal(dep.rawType, 'STATIC_DEPOSIT');

  const wd = mapBreezPaymentToTx({
    id: 'pay-4', paymentType: 'send', status: 'pending', amount: 40000n,
    fees: 300n, timestamp: 1757000003, method: 'withdraw',
    details: { type: 'withdraw', txId: 'e'.repeat(64) },
  });
  assert.equal(wd.onchainTxId, 'e'.repeat(64));
  assert.equal(wd.rawType, 'WITHDRAWAL');
  assert.equal(wd.status, 'pending');
});

test('rawType satisfies both transaction UIs Bitcoin-detection lists', () => {
  // TransactionHistory.vue and TransactionDetails.vue both substring-test a
  // lowercased rawType against these markers to apply Bitcoin styling.
  const detailsViewMarkers = ['l1', 'deposit', 'withdrawal', 'coop_exit', 'static_deposit'];
  const matches = (rawType) =>
    detailsViewMarkers.some((m) => String(rawType).toLowerCase().includes(m));

  const depositRow = mapBreezPaymentToTx({
    id: 'x', paymentType: 'receive', status: 'completed', amount: 1n, fees: 0n,
    timestamp: 1, method: 'deposit', details: { type: 'deposit', txId: 'a', vout: 0 },
  });
  const withdrawRow = mapBreezPaymentToTx({
    id: 'y', paymentType: 'send', status: 'completed', amount: 1n, fees: 0n,
    timestamp: 1, method: 'withdraw', details: { type: 'withdraw', txId: 'b' },
  });
  const lightningRow = mapBreezPaymentToTx(lightningPayment());

  assert.equal(matches(depositRow.rawType), true, 'deposit must style as Bitcoin');
  assert.equal(matches(withdrawRow.rawType), true, 'withdraw must style as Bitcoin');
  assert.equal(matches(lightningRow.rawType), false, 'lightning must NOT style as Bitcoin');
});

test('unknown method falls back to direction rawType; missing fields tolerated', () => {
  const row = mapBreezPaymentToTx({
    id: 'z', paymentType: 'receive', status: 'pending', amount: 5n, fees: 0n,
    timestamp: 1757000004, method: 'unknown',
  });
  assert.equal(row.rawType, 'RECEIVE');
  assert.equal(row.description, '');
  assert.equal(row.paymentHash, null);
  assert.equal(row.preimage, null);
  assert.equal(row.bolt11, null);
  assert.equal(row.onchainTxId, null);
});

test('detailsArm narrows strictly by discriminant', () => {
  const p = lightningPayment();
  assert.equal(detailsArm(p, 'lightning'), p.details);
  assert.equal(detailsArm(p, 'spark'), null);
  assert.equal(detailsArm(p, 'spark', 'lightning'), p.details);
  assert.equal(detailsArm({}, 'lightning'), null);
});

test('paymentHashOf reads lightning AND spark arms (spark-rail settles)', () => {
  const sparkSettled = {
    details: { type: 'spark', htlcDetails: { paymentHash: HASH, expiryTime: 0, status: 'preimageShared' } },
  };
  assert.equal(paymentHashOf(sparkSettled), HASH);
  assert.equal(paymentHashOf(lightningPayment()), HASH);
  assert.equal(paymentHashOf({ details: { type: 'deposit', txId: 'a', vout: 0 } }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
