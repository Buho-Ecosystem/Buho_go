/**
 * sparkPayment — Spark destination classification tests.
 *
 * Fixtures are built with the real SDK codec (encodeSparkAddress), so the
 * strings under test are byte-for-byte what another Spark wallet would
 * produce — no hand-rolled bech32m that could drift from the SDK.
 *
 * Coverage focus:
 *   - plain address vs sats invoice vs token invoice classification
 *   - amount / memo / expiry extraction, expired detection
 *   - sender pinning: match, mismatch, unknown-self
 *   - the durable receiverAddress derived from a single-use invoice
 *   - malformed-input fuzzing (must throw, never misclassify)
 *   - proto status normalization (numeric and string forms)
 *
 * Run directly with Node:
 *   node src/utils/__tests__/sparkPayment.spec.js
 */

import { strict as assert } from 'node:assert';
import { encodeSparkAddress } from '@buildonspark/spark-sdk';
import {
  decodeSparkDestination,
  isSparkPaymentRequest,
  sparkInvoiceProblem,
  identityPublicKeyFromSparkAddress,
  normalizeSparkInvoiceStatus,
  SPARK_INVOICE_STATUS,
} from '../sparkPayment.js';

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

// Valid compressed secp256k1 points (G and 2G) — the codec validates keys.
const RECEIVER_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const OTHER_PUBKEY = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Deterministic UUIDv4-shaped 16 bytes (version/variant bits set). */
function uuidBytes(seed) {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = (seed * 31 + i * 7) % 256;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b;
}

function makeInvoice({ amount, memo, expiryTime, senderPublicKey, tokens } = {}) {
  const paymentType = tokens
    ? { $case: 'tokensPayment', tokensPayment: tokens }
    : { $case: 'satsPayment', satsPayment: amount !== undefined ? { amount } : {} };
  return encodeSparkAddress({
    identityPublicKey: RECEIVER_PUBKEY,
    network: 'MAINNET',
    sparkInvoiceFields: {
      version: 1,
      id: uuidBytes(7),
      paymentType,
      memo,
      senderPublicKey: senderPublicKey ? hexToBytes(senderPublicKey) : undefined,
      expiryTime,
    },
  });
}

const PLAIN_ADDRESS = encodeSparkAddress({
  identityPublicKey: RECEIVER_PUBKEY,
  network: 'MAINNET',
});

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 1000);

// ─── Plain addresses ────────────────────────────────────────────────

test('plain address classifies as address, not a payment request', () => {
  assert.ok(PLAIN_ADDRESS.startsWith('spark1'));
  const dest = decodeSparkDestination(PLAIN_ADDRESS);
  assert.equal(dest.kind, 'address');
  assert.equal(dest.invoice, null);
  assert.equal(dest.network, 'MAINNET');
  assert.equal(dest.identityPublicKey, RECEIVER_PUBKEY);
  assert.equal(dest.receiverAddress, PLAIN_ADDRESS);
  assert.equal(dest.amountSats, null);
  assert.equal(dest.isExpired, false);
  assert.equal(isSparkPaymentRequest(PLAIN_ADDRESS), false);
  assert.equal(sparkInvoiceProblem(dest), null);
});

// ─── Sats invoices ──────────────────────────────────────────────────

test('sats invoice with amount, memo and future expiry', () => {
  const inv = makeInvoice({ amount: 2100, memo: 'coffee', expiryTime: FUTURE });
  const dest = decodeSparkDestination(inv);
  assert.equal(dest.kind, 'sats_invoice');
  assert.equal(dest.invoice, inv);
  assert.equal(dest.amountSats, 2100);
  assert.equal(dest.memo, 'coffee');
  assert.equal(dest.isExpired, false);
  assert.equal(Math.abs(dest.expiresAt - FUTURE.getTime()) < 1000, true);
  assert.equal(isSparkPaymentRequest(inv), true);
  assert.equal(sparkInvoiceProblem(dest, { ownIdentityPublicKey: OTHER_PUBKEY }), null);
});

test('invoice yields the durable plain receiver address, never itself', () => {
  const inv = makeInvoice({ amount: 500 });
  const dest = decodeSparkDestination(inv);
  assert.notEqual(dest.receiverAddress, inv);
  assert.equal(dest.receiverAddress, PLAIN_ADDRESS);
  // What contacts/tx-linking store must decode back to the same identity.
  assert.equal(identityPublicKeyFromSparkAddress(dest.receiverAddress), RECEIVER_PUBKEY);
});

test('amountless invoice leaves the amount free', () => {
  const dest = decodeSparkDestination(makeInvoice({ memo: 'tip jar' }));
  assert.equal(dest.kind, 'sats_invoice');
  assert.equal(dest.amountSats, null);
  assert.equal(dest.memo, 'tip jar');
});

test('zero-amount sats field is treated as free, not fixed-at-zero', () => {
  const dest = decodeSparkDestination(makeInvoice({ amount: 0 }));
  assert.equal(dest.amountSats, null);
});

test('expired invoice is flagged and refused', () => {
  const dest = decodeSparkDestination(makeInvoice({ amount: 10, expiryTime: PAST }));
  assert.equal(dest.isExpired, true);
  assert.equal(sparkInvoiceProblem(dest), 'expired');
});

test('expiry evaluation honors the clock override', () => {
  const inv = makeInvoice({ amount: 10, expiryTime: FUTURE });
  const later = FUTURE.getTime() + 1;
  assert.equal(decodeSparkDestination(inv, { now: later }).isExpired, true);
  assert.equal(sparkInvoiceProblem(decodeSparkDestination(inv), { now: later }), 'expired');
});

// ─── Sender pinning ─────────────────────────────────────────────────

test('sender-pinned invoice: match passes, mismatch and unknown refuse', () => {
  const dest = decodeSparkDestination(makeInvoice({ amount: 10, senderPublicKey: OTHER_PUBKEY }));
  assert.equal(dest.senderPublicKey, OTHER_PUBKEY);
  assert.equal(sparkInvoiceProblem(dest, { ownIdentityPublicKey: OTHER_PUBKEY }), null);
  assert.equal(
    sparkInvoiceProblem(dest, { ownIdentityPublicKey: OTHER_PUBKEY.toUpperCase() }),
    null,
    'pubkey comparison must be case-insensitive'
  );
  assert.equal(
    sparkInvoiceProblem(dest, { ownIdentityPublicKey: RECEIVER_PUBKEY }),
    'sender_mismatch'
  );
  assert.equal(sparkInvoiceProblem(dest, {}), 'sender_unknown');
});

// ─── Token invoices ─────────────────────────────────────────────────

test('token invoice classifies as token_invoice and is refused', () => {
  // Proto shape: identifier is 32 bytes, amount is big-endian bytes.
  const tokenIdentifier = new Uint8Array(32).fill(9);
  const inv = makeInvoice({ tokens: { tokenIdentifier, amount: new Uint8Array([5]) } });
  const dest = decodeSparkDestination(inv);
  assert.equal(dest.kind, 'token_invoice');
  assert.equal(isSparkPaymentRequest(inv), true);
  assert.equal(sparkInvoiceProblem(dest), 'token_invoice');
});

// ─── Malformed input fuzzing ────────────────────────────────────────

test('malformed inputs throw from decode and never classify as requests', () => {
  const garbage = [
    '',
    '   ',
    null,
    undefined,
    'spark1',
    'spark1qqqq',
    'sp1notbech32!!!',
    'ark1qw508d6qejxtdg4y5r3zarvary0c5xw7k8f3t4',
    'lnbc1500n1pn0vvvvpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq',
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    `${PLAIN_ADDRESS}corrupt`,
    PLAIN_ADDRESS.slice(0, -2),
  ];
  for (const input of garbage) {
    assert.throws(
      () => decodeSparkDestination(input),
      `should throw for: ${String(input).slice(0, 40)}`
    );
    assert.equal(isSparkPaymentRequest(input), false);
    assert.equal(identityPublicKeyFromSparkAddress(input), null);
  }
});

test('cross-network prefix still decodes via its own declared network', () => {
  const testnetAddress = encodeSparkAddress({
    identityPublicKey: RECEIVER_PUBKEY,
    network: 'TESTNET',
  });
  const dest = decodeSparkDestination(testnetAddress);
  assert.equal(dest.network, 'TESTNET');
  assert.equal(dest.kind, 'address');
});

// ─── Status normalization ───────────────────────────────────────────

test('normalizeSparkInvoiceStatus maps proto numbers and names', () => {
  assert.equal(normalizeSparkInvoiceStatus(2), SPARK_INVOICE_STATUS.FINALIZED);
  assert.equal(normalizeSparkInvoiceStatus(1), SPARK_INVOICE_STATUS.PENDING);
  assert.equal(normalizeSparkInvoiceStatus(0), SPARK_INVOICE_STATUS.NOT_FOUND);
  assert.equal(normalizeSparkInvoiceStatus(4), SPARK_INVOICE_STATUS.RETURNED);
  assert.equal(normalizeSparkInvoiceStatus(5), SPARK_INVOICE_STATUS.MISMATCHED_INVOICE_FINALIZED);
  assert.equal(normalizeSparkInvoiceStatus('FINALIZED'), SPARK_INVOICE_STATUS.FINALIZED);
  assert.equal(normalizeSparkInvoiceStatus('PENDING'), SPARK_INVOICE_STATUS.PENDING);
  assert.equal(normalizeSparkInvoiceStatus(99), SPARK_INVOICE_STATUS.UNRECOGNIZED);
  assert.equal(normalizeSparkInvoiceStatus('bogus'), SPARK_INVOICE_STATUS.UNRECOGNIZED);
  assert.equal(normalizeSparkInvoiceStatus(undefined), SPARK_INVOICE_STATUS.UNRECOGNIZED);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
