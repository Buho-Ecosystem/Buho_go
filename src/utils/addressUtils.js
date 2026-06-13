/**
 * Address & payment-identifier utilities.
 *
 * Single source of truth for recognizing the destination types BuhoGO
 * supports. Duplicating these prefix lists / regexes across components has
 * burned us before (e.g. a Spark validator that only knew `sp1` while the
 * rest of the app accepted the full `spark1/sparkrt1/...` family), so every
 * call site should import from here.
 *
 * Identifier families:
 *   - Spark          — `sp1`, `tsp1`, `sprt1` (legacy) and
 *                      `spark1`, `sparkrt1`, `sparkt1`, `sparks1`, `sparkl1` (bech32m)
 *   - BOLT11 invoice — `lnbc` (mainnet), `lntb` (testnet), `lntbs` (signet),
 *                      `lnbcrt` (regtest)
 *   - LNURL          — bech32 `lnurl1…` and LUD-17 URI schemes
 *                      (`lnurlp://`, `lnurlw://`, `lnurlc://`, `keyauth://`)
 *   - Bitcoin on-chain — mainnet `bc1…` / `1…` / `3…`,
 *                        testnet  `tb1…` / `m…` / `n…` / `2…`
 *
 * Identifier casing: BOLT11, LNURL bech32, and Spark addresses are all
 * case-insensitive per their respective specs; we lowercase before matching.
 * Base58 addresses (legacy `1…` / `3…` etc.) are case-sensitive — we keep
 * them as-is, and the regex uses the `/i` flag only for the bech32 arms.
 */

import { extractLnFallbackParam } from './bip21.js';

// ----------------------------------------------------------------------------
// Constants — exported so other modules can reuse them without re-typing
// ----------------------------------------------------------------------------

/** @readonly */
export const SPARK_PREFIXES = Object.freeze([
  // New Bech32m format
  'spark1', 'sparkrt1', 'sparkt1', 'sparks1', 'sparkl1',
  // Legacy format
  'sp1', 'tsp1', 'sprt1',
]);

/** @readonly */
export const LIGHTNING_INVOICE_HRPS = Object.freeze([
  'lnbc',    // mainnet
  'lntb',    // testnet
  'lntbs',   // signet
  'lnbcrt',  // regtest
]);

/** @readonly */
export const LNURL_PREFIXES = Object.freeze([
  'lnurl1',       // bech32 LUD-01
  'lnurlp://',    // LUD-17 pay
  'lnurlw://',    // LUD-17 withdraw
  'lnurlc://',    // LUD-17 channel
  'keyauth://',   // LUD-17 auth
]);

// Bitcoin address regexes. Kept as plain RegExps (not a prefix list) because
// length + character-set validation matters: a bare "1" or "3" byte must not
// be misread as a P2PKH/P2SH address. Bech32 arms are case-insensitive; the
// base58 arms explicitly exclude `0`, `O`, `l`, `I` per spec.
const BITCOIN_BECH32_MAINNET = /^bc1[a-zA-HJ-NP-Z0-9]{39,62}$/i;
const BITCOIN_BECH32_TESTNET = /^tb1[a-zA-HJ-NP-Z0-9]{39,62}$/i;
const BITCOIN_BASE58_MAINNET = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BITCOIN_BASE58_TESTNET = /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/;

// ----------------------------------------------------------------------------
// Predicates
// ----------------------------------------------------------------------------

/**
 * Defensive normalization used by case-insensitive predicates.
 * Returns an empty string for non-string inputs so callers don't have to
 * sprinkle `typeof` guards.
 */
function norm(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * True if the input looks like a Spark address (any supported prefix).
 * @param {unknown} address
 * @returns {boolean}
 */
export function isSparkAddress(address) {
  const lower = norm(address);
  if (!lower) return false;
  return SPARK_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * True if the input looks like a BOLT11 Lightning invoice.
 * Accepts a leading `lightning:` URI prefix since real-world inputs often
 * carry it (QR scans, deep links).
 * @param {unknown} invoice
 * @returns {boolean}
 */
export function isLightningInvoice(invoice) {
  const lower = norm(invoice).replace(/^lightning:/, '');
  if (!lower) return false;
  return LIGHTNING_INVOICE_HRPS.some(hrp => lower.startsWith(hrp));
}

/**
 * True if the input looks like an LNURL (bech32 or LUD-17 scheme).
 * A leading `lightning:` wrapper is tolerated.
 * @param {unknown} lnurl
 * @returns {boolean}
 */
export function isLnurl(lnurl) {
  const lower = norm(lnurl).replace(/^lightning:/, '');
  if (!lower) return false;
  return LNURL_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * True if the input is a syntactically valid Bitcoin on-chain address
 * (mainnet or testnet, bech32/bech32m or base58).
 *
 * NOTE: this is format validation only — it does not verify the bech32/base58
 * checksum. Use a full decoder when you need cryptographic certainty.
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isBitcoinAddress(address) {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (!trimmed) return false;
  return (
    BITCOIN_BECH32_MAINNET.test(trimmed) ||
    BITCOIN_BECH32_TESTNET.test(trimmed) ||
    BITCOIN_BASE58_MAINNET.test(trimmed) ||
    BITCOIN_BASE58_TESTNET.test(trimmed)
  );
}

/**
 * True if the input looks like a Lightning address (user@domain.tld).
 * Allows the full RFC-ish character set real wallets use in local parts.
 * @param {unknown} address
 * @returns {boolean}
 */
export function isLightningAddress(address) {
  if (typeof address !== 'string') return false;
  // Local part chars match what LUD-16 implementations use in the wild; the
  // RFC 5321 grammar is stricter but every wallet we interop with is lax.
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(address.trim());
}

// ----------------------------------------------------------------------------
// Back-compat aliases
// ----------------------------------------------------------------------------
// Pre-existing callers imported `isValidLightningAddress`, `isValidSparkAddress`,
// `isValidBitcoinAddress`. Re-export the canonical predicates under those names
// so the rename can happen opportunistically without a flag-day refactor.

export const isValidLightningAddress = isLightningAddress;
export const isValidSparkAddress = isSparkAddress;
export const isValidBitcoinAddress = isBitcoinAddress;

// ----------------------------------------------------------------------------
// URI unwrapping
// ----------------------------------------------------------------------------

/**
 * Unwrap the URI conventions wallets emit in QR codes (and the occasional
 * deep link) down to the bare payment identifier, so the predicates above can
 * classify it. Real-world QR scans rarely carry a naked address:
 *
 *   - BIP21        — `bitcoin:<address>?amount=…&label=…&lightning=…`
 *                    Returns just `<address>` (the on-chain destination).
 *                    A unified `bitcoin:?lightning=…` QR has no on-chain
 *                    address, so this returns '' and the caller falls through
 *                    to "not a saveable address".
 *   - `lightning:` — LUD-17 / BOLT11 deep-link scheme. Stripped so the LNURL /
 *                    invoice / Lightning-address predicates see the payload.
 *
 * Anything without a recognized scheme (a bare address, an `npub`, a
 * `nostr:` URI) is returned trimmed and otherwise untouched — this function
 * never tries to validate, only to unwrap.
 *
 * @param {unknown} raw
 * @returns {string} the unwrapped identifier, or '' for non-strings / empties
 */
export function normalizePaymentAddress(raw) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';

  // BIP21: the on-chain address is everything between `bitcoin:` and the
  // query string. Case-insensitive scheme; the address itself is left as-is
  // (bech32 is case-insensitive, base58 is case-sensitive — don't touch it).
  const bip21 = /^bitcoin:([^?]*)/i.exec(value);
  if (bip21) {
    let address = bip21[1].trim();
    try {
      address = decodeURIComponent(address);
    } catch {
      /* malformed %-escapes — keep the raw slice */
    }
    return address.trim();
  }

  // http(s) "fallback URL" carrying the LNURL in a `lightning=` query param
  // (LNbits / Fossa ATMs, Phoenix, WoS, …). Extract the bare LNURL/invoice so
  // the predicates can classify it; otherwise fall through to passthrough.
  const lnFallback = extractLnFallbackParam(value);
  if (lnFallback) return lnFallback;

  // `lightning:` wraps a BOLT11 invoice or an LNURL. The invoice/LNURL
  // predicates already tolerate the prefix, but stripping it here keeps the
  // returned value canonical for any downstream consumer.
  return value.replace(/^lightning:/i, '').trim();
}

// ----------------------------------------------------------------------------
// Display helpers
// ----------------------------------------------------------------------------

/**
 * Truncate an address for display.
 * Shows the first `startChars` and last `endChars` with an ellipsis in
 * between, or the original string if it is already short enough.
 *
 * @param {string} address
 * @param {number} [startChars=10]
 * @param {number} [endChars=8]
 * @returns {string}
 */
export function truncateAddress(address, startChars = 10, endChars = 8) {
  if (!address) return '';
  const minLength = startChars + endChars + 3; // +3 for "..."
  if (address.length <= minLength) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
