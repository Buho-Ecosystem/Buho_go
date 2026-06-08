/**
 * BitcoinListings.org adapter — the primary source. Keyless, CORS-open JSON of
 * online businesses that accept Bitcoin (the same feed Blitz Wallet uses).
 *
 *   GET https://bitcoinlistings.org/.well-known/business
 *   -> { statistics{categories[]}, businesses{ <id>: {...} } }
 */

import { fetchJson } from './http.js';
import { normalizeHost, mapCategory, codeToFlag } from './shop.js';

const ENDPOINT = 'https://bitcoinlistings.org/.well-known/business';

/** @returns {import('./shop.js').Shop|null} */
function normalize(m) {
  if (!m || typeof m !== 'object') return null;
  // Only approved listings, and only ones with a real website (it is the
  // "Visit shop" target + the dedupe key).
  if (m.verification_status && m.verification_status !== 'approved') return null;
  const host = normalizeHost(m.website);
  if (!host) return null;

  const c = m.country || {};
  const worldwide = c.code === 'WW' || !c.code;
  const country = worldwide
    ? { code: 'WW', name: 'Worldwide', flag: '🌍' }
    : { code: c.code, name: c.name || c.code, flag: codeToFlag(c.code) };

  const id = m.listing_metadata?.id || host;
  return {
    id: `listings:${id}`,
    name: String(m.name || '').trim() || host,
    description: String(m.description || '').trim(),
    website: m.website.startsWith('http') ? m.website : `https://${m.website}`,
    host,
    category: mapCategory('listings', m.category),
    country,
    payments: {
      lightning: !!m.payment_methods?.lightning,
      onchain: !!m.payment_methods?.bitcoin_onchain,
    },
    source: 'listings',
    sources: ['listings'],
    lnAddress: null,
    logoUrl: null,
    verified: m.verification_status === 'approved',
    raw: m,
  };
}

/**
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('./shop.js').Shop[]>}
 */
export async function fetchListingsShops({ signal } = {}) {
  const res = await fetchJson(ENDPOINT, { signal });
  const data = res?.data ?? res ?? {};
  const businesses = data.businesses && typeof data.businesses === 'object'
    ? Object.values(data.businesses)
    : [];
  return businesses.map(normalize).filter(Boolean);
}
