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
 * Falls back to the on-chain address if no `lightning=` is provided.
 * Returns `null` if the URI carries no usable destination.
 *
 * @param {ReturnType<typeof parseBip21>} parsed
 * @returns {({ kind: 'lightning_invoice', value: string, bip21: object })
 *         | ({ kind: 'bitcoin_address',   value: string, bip21: object })
 *         | null}
 */
export function selectBip21Destination(parsed) {
  if (!parsed) return null;
  if (parsed.lightning && looksLikeBolt11(parsed.lightning)) {
    return { kind: 'lightning_invoice', value: parsed.lightning, bip21: parsed };
  }
  if (parsed.address) {
    return { kind: 'bitcoin_address', value: parsed.address, bip21: parsed };
  }
  return null;
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
