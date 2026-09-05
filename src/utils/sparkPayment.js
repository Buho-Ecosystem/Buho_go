/**
 * Spark destination decoding for the send pipeline.
 *
 * A Spark destination string is bech32m carrying a protobuf payload in one
 * of two shapes:
 *   - a plain address that only names a receiver (its identity public key),
 *     paid with a free amount
 *   - an invoice that additionally carries signed payment fields — amount,
 *     memo, expiry, optional pinned sender — and must be paid as an invoice
 *
 * The prefix alone cannot tell the two apart, so classification decodes the
 * payload. The codec lives right here: bech32m via the app's existing
 * `bech32` dependency plus a minimal reader for the fixed SparkAddress
 * message. The wire layout is pinned by fixtures generated with the
 * reference Spark codec (see sparkPayment.spec.js), so a drift in either
 * direction fails the suite:
 *
 *   SparkAddress
 *     1  identity_public_key  bytes (33, compressed secp256k1)
 *     2  spark_invoice_fields SparkInvoiceFields
 *   SparkInvoiceFields
 *     1  version              varint
 *     2  id                   bytes (16, uuid)
 *     3  tokens_payment       { 1 token_identifier bytes, 2 amount bytes }
 *     4  sats_payment         { 1 amount varint }        (empty = amountless)
 *     5  memo                 string
 *     6  sender_public_key    bytes (33)
 *     7  expiry_time          { 1 seconds varint, 2 nanos varint }
 *
 * Everything here is pure and synchronous: callers decide how to surface
 * problems to the user.
 */
import { bech32m } from 'bech32';
import { secp256k1 } from '@noble/curves/secp256k1.js';

/** hrp → network, current family first, then the legacy short prefixes. */
const NETWORK_BY_HRP = Object.freeze({
  spark: 'MAINNET',
  sparkt: 'TESTNET',
  sparks: 'SIGNET',
  sparkrt: 'REGTEST',
  sparkl: 'LOCAL',
  sp: 'MAINNET',
  spt: 'TESTNET',
  sps: 'SIGNET',
  sprt: 'REGTEST',
  spl: 'LOCAL',
});

const HRP_BY_NETWORK = Object.freeze({
  MAINNET: 'spark',
  TESTNET: 'sparkt',
  SIGNET: 'sparks',
  REGTEST: 'sparkrt',
  LOCAL: 'sparkl',
});

const BECH32_LIMIT = 1024;

/**
 * Canonical invoice status names, normalized from the proto enum. The SDK
 * may surface the numeric proto value or the name depending on transport,
 * so both are mapped.
 */
export const SPARK_INVOICE_STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  PENDING: 'PENDING',
  FINALIZED: 'FINALIZED',
  RETURNED: 'RETURNED',
  MISMATCHED_INVOICE_FINALIZED: 'MISMATCHED_INVOICE_FINALIZED',
  MISMATCHED_INVOICE_PENDING: 'MISMATCHED_INVOICE_PENDING',
  MISMATCHED_INVOICE_RETURNED: 'MISMATCHED_INVOICE_RETURNED',
  UNRECOGNIZED: 'UNRECOGNIZED',
});

const INVOICE_STATUS_BY_NUMBER = Object.freeze({
  0: SPARK_INVOICE_STATUS.NOT_FOUND,
  1: SPARK_INVOICE_STATUS.PENDING,
  2: SPARK_INVOICE_STATUS.FINALIZED,
  4: SPARK_INVOICE_STATUS.RETURNED,
  5: SPARK_INVOICE_STATUS.MISMATCHED_INVOICE_FINALIZED,
  6: SPARK_INVOICE_STATUS.MISMATCHED_INVOICE_PENDING,
  7: SPARK_INVOICE_STATUS.MISMATCHED_INVOICE_RETURNED,
  [-1]: SPARK_INVOICE_STATUS.UNRECOGNIZED,
});

/** @returns {string} A SPARK_INVOICE_STATUS value; unknown input maps to UNRECOGNIZED. */
export function normalizeSparkInvoiceStatus(status) {
  if (typeof status === 'number') {
    return INVOICE_STATUS_BY_NUMBER[status] || SPARK_INVOICE_STATUS.UNRECOGNIZED;
  }
  if (typeof status === 'string' && SPARK_INVOICE_STATUS[status]) {
    return SPARK_INVOICE_STATUS[status];
  }
  return SPARK_INVOICE_STATUS.UNRECOGNIZED;
}

// ─── Minimal protobuf reading ────────────────────────────────────────

/**
 * Read one varint. Values stay JS-safe: anything beyond 2^53 throws, which
 * for this schema (versions, sat amounts, unix seconds) only ever means a
 * corrupt payload.
 */
function readVarint(bytes, pos) {
  let value = 0;
  let shift = 0;
  while (true) {
    if (pos >= bytes.length) throw new Error('premature EOF');
    const byte = bytes[pos++];
    if (shift >= 49 && byte > 1) throw new Error('varint out of range');
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, pos };
    shift += 7;
  }
}

/**
 * Split a message into { fieldNumber: value } with last-one-wins semantics.
 * Length-delimited fields (wire type 2) yield subarrays; varints numbers.
 * Unknown fields are skipped, unknown wire types reject the payload.
 */
function readMessage(bytes) {
  const fields = {};
  let pos = 0;
  while (pos < bytes.length) {
    const tag = readVarint(bytes, pos);
    pos = tag.pos;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (fieldNumber === 0) throw new Error('invalid field');
    if (wireType === 0) {
      const v = readVarint(bytes, pos);
      pos = v.pos;
      fields[fieldNumber] = v.value;
    } else if (wireType === 2) {
      const len = readVarint(bytes, pos);
      pos = len.pos;
      if (pos + len.value > bytes.length) throw new Error('premature EOF');
      fields[fieldNumber] = bytes.subarray(pos, pos + len.value);
      pos += len.value;
    } else {
      throw new Error(`unsupported wire type ${wireType}`);
    }
  }
  return fields;
}

// ─── Codec ───────────────────────────────────────────────────────────

function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function assertIdentityKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 33) {
    throw new Error('invalid identity public key');
  }
  // Full point validation via the app's existing curve dependency, matching
  // the reference codec's strictness (a 33-byte blob is not enough).
  secp256k1.Point.fromHex(bytesToHex(bytes));
  return bytesToHex(bytes);
}

/** The network a Spark string declares through its prefix. */
export function getNetworkFromSparkAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  const sep = value.lastIndexOf('1');
  const network = sep > 0 ? NETWORK_BY_HRP[value.slice(0, sep)] : undefined;
  if (!network) throw new Error('not a Spark address prefix');
  return network;
}

/** Encode an identity public key (hex) as a plain Spark address. */
export function encodeSparkAddress({ identityPublicKey, network }) {
  const hrp = HRP_BY_NETWORK[network];
  if (!hrp) throw new Error(`unknown Spark network: ${network}`);
  const keyHex = String(identityPublicKey || '');
  if (!/^[0-9a-f]{66}$/i.test(keyHex)) throw new Error('invalid identity public key');
  // SparkAddress with only field 1: tag 0x0a, length 33, key bytes.
  const payload = new Uint8Array(2 + 33);
  payload[0] = 0x0a;
  payload[1] = 33;
  for (let i = 0; i < 33; i++) {
    payload[2 + i] = parseInt(keyHex.substr(i * 2, 2), 16);
  }
  return bech32m.encode(hrp, bech32m.toWords(payload), BECH32_LIMIT);
}

/**
 * Decode a Spark string into its identity key and, for invoices, the
 * embedded payment fields. Throws on anything that is not a well-formed
 * Spark payload.
 */
function decodeSparkPayload(input) {
  const value = String(input || '').trim();
  const network = getNetworkFromSparkAddress(value);
  const decoded = bech32m.decode(value.toLowerCase(), BECH32_LIMIT);
  const payload = new Uint8Array(bech32m.fromWords(decoded.words));

  const address = readMessage(payload);
  const identityPublicKey = assertIdentityKey(address[1]);

  let invoiceFields = null;
  if (address[2] instanceof Uint8Array) {
    const fields = readMessage(address[2]);
    const timestamp = fields[7] instanceof Uint8Array ? readMessage(fields[7]) : null;
    const sats = fields[4] instanceof Uint8Array ? readMessage(fields[4]) : null;
    invoiceFields = {
      isTokenInvoice: fields[3] instanceof Uint8Array,
      satsAmount: sats && typeof sats[1] === 'number' ? sats[1] : null,
      memo: fields[5] instanceof Uint8Array ? new TextDecoder().decode(fields[5]) : '',
      senderPublicKey: fields[6] instanceof Uint8Array ? assertIdentityKey(fields[6]) : null,
      expiresAt: timestamp && typeof timestamp[1] === 'number'
        ? timestamp[1] * 1000 + Math.floor((timestamp[2] || 0) / 1e6)
        : null,
    };
  }

  return { network, identityPublicKey, invoiceFields };
}

/**
 * Decode and classify a Spark destination string.
 *
 * @param {string} input  A trimmed spark1…-family string.
 * @param {object} [opts]
 * @param {number} [opts.now]  Clock override for expiry evaluation (tests).
 * @returns {{
 *   kind: 'address' | 'sats_invoice' | 'token_invoice',
 *   invoice: string | null,          // the raw string when it is an invoice
 *   network: string,                 // 'MAINNET' | 'TESTNET' | …
 *   identityPublicKey: string,       // receiver identity key (hex)
 *   receiverAddress: string,         // durable plain spark1… address for the receiver
 *   amountSats: number | null,       // sats amount when encoded, else null
 *   memo: string,
 *   senderPublicKey: string | null,  // pinned sender identity key (hex), when present
 *   expiresAt: number | null,        // epoch ms, when the invoice carries an expiry
 *   isExpired: boolean,
 * }}
 * @throws {Error} When the input is not a decodable Spark string for its own
 *                 declared network. Callers map this to user-facing copy.
 */
export function decodeSparkDestination(input, { now = Date.now() } = {}) {
  const address = String(input || '').trim();
  const { network, identityPublicKey, invoiceFields } = decodeSparkPayload(address);

  // A durable identifier for the receiver, independent of this (possibly
  // single-use) string: contacts and transaction linking store this, never
  // the invoice itself.
  const receiverAddress = encodeSparkAddress({ identityPublicKey, network });

  if (!invoiceFields) {
    return {
      kind: 'address',
      invoice: null,
      network,
      identityPublicKey,
      receiverAddress,
      amountSats: null,
      memo: '',
      senderPublicKey: null,
      expiresAt: null,
      isExpired: false,
    };
  }

  // Only a positive sats amount locks the confirm sheet — zero/absent means
  // the sender chooses.
  const amountSats = !invoiceFields.isTokenInvoice && invoiceFields.satsAmount > 0
    ? invoiceFields.satsAmount
    : null;

  return {
    kind: invoiceFields.isTokenInvoice ? 'token_invoice' : 'sats_invoice',
    invoice: address,
    network,
    identityPublicKey,
    receiverAddress,
    amountSats,
    memo: invoiceFields.memo,
    senderPublicKey: invoiceFields.senderPublicKey,
    expiresAt: invoiceFields.expiresAt,
    isExpired: invoiceFields.expiresAt !== null && invoiceFields.expiresAt <= now,
  };
}

/**
 * True when the string is a Spark invoice (a one-time payment request),
 * as opposed to a durable plain address. Undecodable input returns false —
 * this is a classifier for already-plausible spark strings, not a
 * validator.
 */
export function isSparkPaymentRequest(input) {
  try {
    return decodeSparkDestination(input).kind !== 'address';
  } catch {
    return false;
  }
}

/**
 * Evaluate whether this wallet may pay a decoded invoice, without touching
 * the network. Returns null when payable, else a machine problem code the
 * caller maps to copy:
 *   'expired'          — the invoice's expiry has passed
 *   'token_invoice'    — a Spark token payment, which BuhoGO does not support
 *   'sender_mismatch'  — pinned to a different sender identity
 *   'sender_unknown'   — pinned, but our own identity key is unavailable
 *                        (e.g. locked wallet with no cached address)
 *
 * @param {ReturnType<typeof decodeSparkDestination>} dest
 * @param {object} [opts]
 * @param {string|null} [opts.ownIdentityPublicKey]  Our wallet's identity key (hex).
 * @param {number} [opts.now]
 */
export function sparkInvoiceProblem(dest, { ownIdentityPublicKey = null, now = Date.now() } = {}) {
  if (!dest || dest.kind === 'address') return null;
  if (dest.kind === 'token_invoice') return 'token_invoice';
  if (dest.expiresAt !== null && dest.expiresAt <= now) return 'expired';
  if (dest.senderPublicKey) {
    if (!ownIdentityPublicKey) return 'sender_unknown';
    if (dest.senderPublicKey.toLowerCase() !== ownIdentityPublicKey.toLowerCase()) {
      return 'sender_mismatch';
    }
  }
  return null;
}

/**
 * The identity public key (hex) behind any Spark address string, or null
 * when the input does not decode. Used to compare a pinned invoice sender
 * against our own wallet's address.
 */
export function identityPublicKeyFromSparkAddress(address) {
  try {
    return decodeSparkDestination(address).identityPublicKey || null;
  } catch {
    return null;
  }
}
