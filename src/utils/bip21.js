/**
 * BIP21 URI parsing.
 *
 * Handles the `bitcoin:` URI scheme (BIP21) with the de-facto `lightning=`
 * fallback parameter used by modern wallets for unified on-chain + LN QRs.
 *
 * Spec references:
 *   - BIP21: https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
 *   - Unified QR (lightning= param) is not in the BIP but is implemented by
 *     Phoenix, Breez, Zeus, Mutiny, BTCPay, Blink, Alby, and most modern
 *     wallets. BOLT-12 offers are sometimes carried in `lno=`.
 *
 * Param names are case-insensitive (per BIP21 ABNF) — we lowercase keys.
 * Values are URL-decoded; `+` is treated as a space for form-encoded labels.
 */

import { isValidBolt12Offer } from './bolt12.js';

const SCHEME = 'bitcoin:';

/**
 * Cheap predicate — does this look like a BIP21 URI?
 * Case-insensitive on the scheme prefix.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isBip21(input) {
  return typeof input === 'string' && input.trim().toLowerCase().startsWith(SCHEME);
}

/**
 * Parse a BIP21 URI into its components.
 *
 * The on-chain `address` may be an empty string for LN-only URIs such as
 * `bitcoin:?lightning=lnbc...` (seen in some BTCPay / Phoenix flows).
 *
 * @param {string} input
 * @returns {({
 *   address: string,
 *   amount: string | null,
 *   label: string | null,
 *   message: string | null,
 *   lightning: string | null,
 *   lno: string | null,
 *   params: Record<string, string>,
 * }) | null}
 */
export function parseBip21(input) {
  if (!isBip21(input)) return null;

  // Strip scheme plus any leading slashes — some non-spec wallets emit
  // `bitcoin://bc1q…` instead of the canonical `bitcoin:bc1q…`.
  const body = input.trim().slice(SCHEME.length).replace(/^\/+/, '');
  const queryIndex = body.indexOf('?');
  const address = (queryIndex === -1 ? body : body.slice(0, queryIndex)).trim();

  const params = {};
  if (queryIndex !== -1) {
    const query = body.slice(queryIndex + 1);
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const eqIndex = pair.indexOf('=');
      const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
      const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
      const key = rawKey.toLowerCase();
      // Form-encoded `+` → space is the convention for label/message fields.
      const normalizedValue = rawValue.replace(/\+/g, ' ');
      let value;
      try {
        value = decodeURIComponent(normalizedValue);
      } catch {
        value = normalizedValue;
      }
      params[key] = value;
    }
  }

  return {
    address,
    amount: params.amount || null,
    label: params.label || null,
    message: params.message || null,
    lightning: params.lightning ? params.lightning.trim() : null,
    lno: params.lno ? params.lno.trim() : null,
    params,
  };
}

/**
 * Choose which destination from a parsed BIP21 URI to act on.
 *
 * Policy: prefer the embedded Lightning invoice when present.
 *   - The BOLT11 invoice carries its own amount, avoiding silent 0-sat sends
 *     when the BIP21 `amount` param is absent.
 *   - LN settles instantly and is free of on-chain fees.
 *   - NWC wallets cannot pay on-chain at all; routing them to LN always works.
 *
 * Falls back to a BOLT12 offer when no BOLT11 `lightning=` invoice is present,
 * then to the on-chain address. The offer is deliberately returned as its own
 * kind so callers can explain that BuhoGO does not pay offers yet; routing to
 * the on-chain fallback would risk sending to the wrong destination.
 * Returns `null` if the URI carries no usable destination.
 *
 * @param {ReturnType<typeof parseBip21>} parsed
 * @returns {({ kind: 'lightning_invoice', value: string, bip21: object })
 *         | ({ kind: 'bolt12_offer',      value: string, bip21: object })
 *         | ({ kind: 'bitcoin_address',   value: string, bip21: object })
 *         | null}
 */
export function selectBip21Destination(parsed) {
  if (!parsed) return null;
  if (parsed.lightning && looksLikeBolt11(parsed.lightning)) {
    return { kind: 'lightning_invoice', value: parsed.lightning, bip21: parsed };
  }
  if (parsed.lno && isValidBolt12Offer(parsed.lno)) {
    return { kind: 'bolt12_offer', value: parsed.lno, bip21: parsed };
  }
  if (parsed.address) {
    return { kind: 'bitcoin_address', value: parsed.address, bip21: parsed };
  }
  return null;
}

/**
 * Compose a unified BIP21 receive URI: the on-chain address as the base,
 * the BOLT11 invoice as `lightning=` (the industry convention), the Spark
 * address as `spark=` and the Ark address as `ark=`.
 *
 * BIP21 requires wallets to ignore query params they do not understand
 * (only `req-` prefixed params may invalidate a URI), so the extra rails
 * are safe everywhere and readable back via `parseBip21().params`. BIP321,
 * the draft successor, standardizes exactly this shape: a payment
 * instruction's bech32 HRP becomes its parameter key — `ark=` is the Ark
 * ecosystem's key (used by bark), `spark=` mirrors it for Spark.
 *
 * The amount rides twice on purpose: `amount=` in BTC for on-chain payers,
 * and inside the embedded invoice for Lightning/Spark payers. Rails are
 * only emitted when they have a value, so the URI degrades gracefully —
 * with nothing but an address it is a plain `bitcoin:` URI, and with no
 * address at all it is nothing (never fabricate a destination).
 *
 * @param {{
 *   address: string,
 *   lightning?: string,
 *   spark?: string,
 *   ark?: string,
 *   amountSats?: number|null,
 * }} parts
 * @returns {string} The URI, or '' without an address.
 */
export function composeUnifiedBip21({ address, lightning = '', spark = '', ark = '', amountSats = null }) {
  if (!address) return '';
  const params = [];
  const sats = Number(amountSats);
  if (Number.isFinite(sats) && sats > 0) {
    params.push('amount=' + (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));
  }
  if (lightning) params.push('lightning=' + lightning);
  if (spark) params.push('spark=' + spark);
  if (ark) params.push('ark=' + ark);
  return 'bitcoin:' + address + (params.length ? '?' + params.join('&') : '');
}

/**
 * Convert a BIP21 `amount=` value (BTC, decimal string) to integer sats.
 *
 * Parsed digit-by-digit rather than via float multiplication so
 * `0.00016667` can never come back as `16666.999…`. Returns null for
 * anything that is not a positive, sat-precise BTC amount — including
 * sub-sat precision, which no rail here can pay.
 *
 * @param {string|number} amount
 * @returns {number|null} integer sats, or null when unusable
 */
export function bip21AmountToSats(amount) {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const [whole, frac = ''] = str.split('.');
  if (frac.length > 8) return null;
  const sats = Number(whole) * 1e8 + Number((frac + '00000000').slice(0, 8));
  return Number.isSafeInteger(sats) && sats > 0 ? sats : null;
}

/**
 * Cheap shape check for the `lightning=` BIP21 param. We intentionally do
 * not fully decode BOLT11 here — a prefix check is enough to avoid routing
 * obviously-corrupt values as the preferred destination (which would drop
 * the perfectly good on-chain address fallback).
 */
function looksLikeBolt11(value) {
  const lower = String(value).toLowerCase();
  return lower.startsWith('lnbc') || lower.startsWith('lntb') ||
         lower.startsWith('lntbs') || lower.startsWith('lnbcrt');
}

/** Cheap shape check for a bech32 LNURL (`lnurl1…`). */
function looksLikeLnurl(value) {
  return String(value).toLowerCase().startsWith('lnurl1');
}

/**
 * Extract a Lightning destination from an http(s) "fallback URL".
 *
 * LNbits / Fossa ATMs (and other LNURL deployments) don't encode a bare LNURL
 * or a `lightning:` URI in their QR — they encode a regular web page URL with
 * the LNURL carried in a `lightning` query parameter, e.g.
 *
 *   https://21mio.space/fossa/atm?lightning=LNURL1DP68GURN8...
 *
 * A phone camera opens the web page; wallets are expected to pull the
 * `lightning` param and act on it. This is the standard LNURL "fallback URL"
 * convention, supported by Phoenix, Breez, Wallet of Satoshi, etc.
 *
 * We only return the param when it looks like a usable Lightning destination
 * (bech32 LNURL or a BOLT11 invoice) so a stray `?lightning=` on an unrelated
 * web URL can't hijack the input. Param key and value matching are both
 * case-insensitive — ATMs emit uppercase LNURL and the key casing varies.
 *
 * @param {unknown} input
 * @returns {string|null} the bare LNURL / invoice, or null if none present
 */
export function extractLnFallbackParam(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Param keys are case-insensitive per the convention; URLSearchParams keys
  // are case-sensitive, so scan for any `lightning` key ourselves.
  let value = null;
  for (const [key, val] of url.searchParams) {
    if (key.toLowerCase() === 'lightning' && val) {
      value = val.trim();
      break;
    }
  }
  if (!value) return null;

  // Tolerate a nested `lightning:` wrapper inside the param value.
  value = value.replace(/^lightning:/i, '').trim();

  return looksLikeBolt11(value) || looksLikeLnurl(value) ? value : null;
}
