/**
 * Spark destination decoding for the send pipeline.
 *
 * A Spark destination string is bech32m in one of two shapes:
 *   - a plain address (legacy `sp1…` or current `spark1…`) that only names
 *     a receiver, paid with a free amount via `transfer()`
 *   - an invoice (`spark1…` only) that additionally carries signed payment
 *     fields — amount, memo, expiry, optional pinned sender — and must be
 *     paid via `fulfillSparkInvoice()`; handing it to `transfer()` throws.
 *
 * The prefix alone cannot tell the two apart, so classification decodes the
 * payload with the SDK codec (synchronous, no network). Everything here is
 * pure: callers decide how to surface problems to the user.
 *
 * The SDK codec is already part of the main bundle (the wallet store
 * imports SparkWalletProvider statically), so these imports add no weight.
 */
import { decodeSparkAddress, encodeSparkAddress, getNetworkFromSparkAddress } from '@buildonspark/spark-sdk';

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

/**
 * Decode and classify a Spark destination string.
 *
 * @param {string} input  A trimmed sp1…/spark1…-family string.
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
  const network = getNetworkFromSparkAddress(address);
  const decoded = decodeSparkAddress(address, network);

  // A durable identifier for the receiver, independent of this (possibly
  // single-use) string: contacts and transaction linking store this, never
  // the invoice itself.
  const receiverAddress = encodeSparkAddress({
    identityPublicKey: decoded.identityPublicKey,
    network,
  });

  const fields = decoded.sparkInvoiceFields;
  if (!fields) {
    return {
      kind: 'address',
      invoice: null,
      network,
      identityPublicKey: decoded.identityPublicKey,
      receiverAddress,
      amountSats: null,
      memo: '',
      senderPublicKey: null,
      expiresAt: null,
      isExpired: false,
    };
  }

  const paymentType = fields.paymentType || null;
  const isTokenInvoice = paymentType?.type === 'tokens';

  // Sats amounts arrive as number | undefined; tokens as bigint. Only a
  // positive sats amount locks the confirm sheet — zero/absent means the
  // sender chooses.
  let amountSats = null;
  if (!isTokenInvoice && typeof paymentType?.amount === 'number' && paymentType.amount > 0) {
    amountSats = paymentType.amount;
  }

  const expiresAt = fields.expiryTime instanceof Date && !Number.isNaN(fields.expiryTime.getTime())
    ? fields.expiryTime.getTime()
    : null;

  return {
    kind: isTokenInvoice ? 'token_invoice' : 'sats_invoice',
    invoice: address,
    network,
    identityPublicKey: decoded.identityPublicKey,
    receiverAddress,
    amountSats,
    memo: typeof fields.memo === 'string' ? fields.memo : '',
    senderPublicKey: fields.senderPublicKey || null,
    expiresAt,
    isExpired: expiresAt !== null && expiresAt <= now,
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
