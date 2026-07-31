/**
 * BOLT12 offer recognition.
 *
 * Offers are Bech32m strings with the `lno` human-readable part. We only
 * need structural validation here: BuhoGO does not pay offers yet, but must
 * distinguish a genuine offer from an incomplete or mistyped `lno1...` value.
 */

import { bech32m } from 'bech32';

export const BOLT12_OFFER_HRP = 'lno';
const BOLT12_MAX_LENGTH = 4096;

/**
 * Returns true when a bare value has a valid Bech32m checksum and the BOLT12
 * offer HRP. Semantic offer parsing belongs to a BOLT12-capable payer, which
 * BuhoGO intentionally does not implement yet.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidBolt12Offer(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate) return false;

  try {
    return bech32m.decode(candidate, BOLT12_MAX_LENGTH).prefix === BOLT12_OFFER_HRP;
  } catch {
    return false;
  }
}
