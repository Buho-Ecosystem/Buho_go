/**
 * sparkPayment — Spark destination classification tests.
 *
 * The fixture strings were generated with the reference Spark codec
 * (js-spark-sdk 0.9.0 encodeSparkAddress) and frozen here, so they are
 * byte-for-byte what another Spark wallet produces. They pin the in-repo
 * codec: if either the local decoder or the wire assumptions drift from
 * the reference layout, these strings stop decoding to the values below.
 *
 * Fixture inputs: receiver = secp256k1 G, pinned sender = 2G, invoice id =
 * a fixed uuid, FUTURE = 2030-01-01T00:00:00Z, PAST = 2020-01-01T00:00:00Z.
 *
 * Coverage focus:
 *   - plain address vs sats invoice vs token invoice classification
 *   - amount / memo / expiry extraction, expired detection
 *   - sender pinning: match, mismatch, unknown-self
 *   - the durable receiverAddress derived from a single-use invoice
 *   - encode round-trip against the reference-encoded plain address
 *   - malformed-input fuzzing (must throw, never misclassify)
 *   - proto status normalization (numeric and string forms)
 *
 * Run directly with Node:
 *   node src/utils/__tests__/sparkPayment.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  decodeSparkDestination,
  isSparkPaymentRequest,
  sparkInvoiceProblem,
  identityPublicKeyFromSparkAddress,
  normalizeSparkInvoiceStatus,
  encodeSparkAddress,
  getNetworkFromSparkAddress,
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

const FUTURE_MS = Date.parse('2030-01-01T00:00:00Z');
const PAST_MS = Date.parse('2020-01-01T00:00:00Z');
// Fixture expiries are fixed dates, so expiry tests pin `now` between them.
const NOW = Date.parse('2026-01-01T00:00:00Z');

// Reference-codec output, frozen (see file header).
const FIXTURES = Object.freeze({
  plainAddress: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2',
  testnetAddress: 'sparkt1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9ucr4k6m4',
  amountMemoFuture: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczg5ssqgjzrv7pelw7h7yxz53rq0jvtf58dpz5pnrdanxvet98grq3q93a7rqwgsrpz6pqp9fned',
  amount500: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgvssqgjzrv7pelw7h7yxz53rq0jvtf58dpzyqcg7spsu6khyg',
  memoOnly: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczg0ssqgjzrv7pelw7h7yxz53rq0jvtf58dpz5pm5d9czq6npwg3qq64ex7g',
  amountZero: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgvqsqgjzrv7pelw7h7yxz53rq0jvtf58dpzyqsgqqvcylnd',
  expiredPast: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgsqsqgjzrv7pelw7h7yxz53rq0jvtf58dpr5psgsrp2luq9ygpqszsgh7gx8',
  futureBare: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgsqsqgjzrv7pelw7h7yxz53rq0jvtf58dpr5psgszc7lps8ygpqszszkzf3n',
  senderPinned: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgassqgjzrv7pelw7h7yxz53rq0jvtf58dpryggzccz8l9zpa47k6vz9gphftsrumpw80rjt3nhnefat4symjhrsnmjjyqsgpgs5lc49',
  tokenInvoice: 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgassqgjzrv7pelw7h7yxz53rq0jvtf58dpp5fg2yqysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjyspq53y9ddd',
});

// ─── Codec round-trips ──────────────────────────────────────────────

test('encodeSparkAddress reproduces the reference-encoded plain address', () => {
  assert.equal(
    encodeSparkAddress({ identityPublicKey: RECEIVER_PUBKEY, network: 'MAINNET' }),
    FIXTURES.plainAddress
  );
  assert.equal(
    encodeSparkAddress({ identityPublicKey: RECEIVER_PUBKEY, network: 'TESTNET' }),
    FIXTURES.testnetAddress
  );
});

test('getNetworkFromSparkAddress resolves current and legacy prefixes', () => {
  assert.equal(getNetworkFromSparkAddress(FIXTURES.plainAddress), 'MAINNET');
  assert.equal(getNetworkFromSparkAddress(FIXTURES.testnetAddress), 'TESTNET');
  assert.equal(getNetworkFromSparkAddress('sp1anything'), 'MAINNET');
  assert.throws(() => getNetworkFromSparkAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'));
});

// ─── Plain addresses ────────────────────────────────────────────────

test('plain address classifies as address, not a payment request', () => {
  assert.ok(FIXTURES.plainAddress.startsWith('spark1'));
  const dest = decodeSparkDestination(FIXTURES.plainAddress);
  assert.equal(dest.kind, 'address');
  assert.equal(dest.invoice, null);
  assert.equal(dest.network, 'MAINNET');
  assert.equal(dest.identityPublicKey, RECEIVER_PUBKEY);
  assert.equal(dest.receiverAddress, FIXTURES.plainAddress);
  assert.equal(dest.amountSats, null);
  assert.equal(dest.isExpired, false);
  assert.equal(isSparkPaymentRequest(FIXTURES.plainAddress), false);
  assert.equal(sparkInvoiceProblem(dest), null);
});

// ─── Sats invoices ──────────────────────────────────────────────────

test('sats invoice with amount, memo and future expiry', () => {
  const dest = decodeSparkDestination(FIXTURES.amountMemoFuture, { now: NOW });
  assert.equal(dest.kind, 'sats_invoice');
  assert.equal(dest.invoice, FIXTURES.amountMemoFuture);
  assert.equal(dest.amountSats, 2100);
  assert.equal(dest.memo, 'coffee');
  assert.equal(dest.isExpired, false);
  assert.equal(dest.expiresAt, FUTURE_MS);
  assert.equal(isSparkPaymentRequest(FIXTURES.amountMemoFuture), true);
  assert.equal(
    sparkInvoiceProblem(dest, { ownIdentityPublicKey: OTHER_PUBKEY, now: NOW }),
    null
  );
});

test('invoice yields the durable plain receiver address, never itself', () => {
  const dest = decodeSparkDestination(FIXTURES.amount500);
  assert.notEqual(dest.receiverAddress, FIXTURES.amount500);
  assert.equal(dest.receiverAddress, FIXTURES.plainAddress);
  // What contacts/tx-linking store must decode back to the same identity.
  assert.equal(identityPublicKeyFromSparkAddress(dest.receiverAddress), RECEIVER_PUBKEY);
});

test('amountless invoice leaves the amount free', () => {
  const dest = decodeSparkDestination(FIXTURES.memoOnly);
  assert.equal(dest.kind, 'sats_invoice');
  assert.equal(dest.amountSats, null);
  assert.equal(dest.memo, 'tip jar');
});

test('zero-amount sats field is treated as free, not fixed-at-zero', () => {
  const dest = decodeSparkDestination(FIXTURES.amountZero);
  assert.equal(dest.amountSats, null);
});

test('expired invoice is flagged and refused', () => {
  const dest = decodeSparkDestination(FIXTURES.expiredPast, { now: NOW });
  assert.equal(dest.expiresAt, PAST_MS);
  assert.equal(dest.isExpired, true);
  assert.equal(sparkInvoiceProblem(dest, { now: NOW }), 'expired');
});

test('expiry evaluation honors the clock override', () => {
  const later = FUTURE_MS + 1;
  assert.equal(decodeSparkDestination(FIXTURES.futureBare, { now: later }).isExpired, true);
  assert.equal(
    sparkInvoiceProblem(decodeSparkDestination(FIXTURES.futureBare, { now: NOW }), { now: later }),
    'expired'
  );
});

// ─── Sender pinning ─────────────────────────────────────────────────

test('sender-pinned invoice: match passes, mismatch and unknown refuse', () => {
  const dest = decodeSparkDestination(FIXTURES.senderPinned);
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
  const dest = decodeSparkDestination(FIXTURES.tokenInvoice);
  assert.equal(dest.kind, 'token_invoice');
  assert.equal(isSparkPaymentRequest(FIXTURES.tokenInvoice), true);
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
    `${FIXTURES.plainAddress}corrupt`,
    FIXTURES.plainAddress.slice(0, -2),
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

test('a raw-payload legacy sp1 string is rejected like the reference codec rejects it', () => {
  // The reference codec resolves the sp prefix to MAINNET but refuses the
  // raw (non-protobuf) payload; behavior preserved 1:1.
  const legacy = 'sp1qfumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes92s909';
  assert.equal(getNetworkFromSparkAddress(legacy), 'MAINNET');
  assert.throws(() => decodeSparkDestination(legacy));
  assert.equal(isSparkPaymentRequest(legacy), false);
});

test('cross-network prefix still decodes via its own declared network', () => {
  const dest = decodeSparkDestination(FIXTURES.testnetAddress);
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
