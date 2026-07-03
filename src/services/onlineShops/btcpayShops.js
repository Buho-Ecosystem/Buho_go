/**
 * BTCPay Server Directory adapter — secondary source, the only MIT-licensed
 * (redistribution-safe) feed in the set. Keyless GitHub-raw JSON, curated.
 *
 *   GET raw.githubusercontent.com/btcpayserver/directory.btcpayserver.org/<branch>/src/data/merchants.json
 *   -> [ { name, url, description, type, subType, country? } ]
 *
 * `country` is an ISO-3166 alpha-2 code or the sentinel "GLOBAL" (optional per
 * record). Unlike the map's btcpay.js we do NOT drop country-less records —
 * online shops don't need a location.
 */

import { fetchJson } from './http.js';
import { normalizeHost, mapCategory, codeToFlag } from './shop.js';

// Dual branch fallback (master then main), mirroring src/services/map/btcpay.js.
const URLS = [
  'https://raw.githubusercontent.com/btcpayserver/directory.btcpayserver.org/master/src/data/merchants.json',
  'https://raw.githubusercontent.com/btcpayserver/directory.btcpayserver.org/main/src/data/merchants.json',
];

// Only entries that represent something a user can actually shop at.
const USABLE_TYPES = new Set(['merchants', 'storefronts', 'apps', 'non-profits', 'hosted-btcpay']);

let regionNames = null;
function countryName(code) {
  try {
    if (!regionNames && typeof Intl !== 'undefined' && Intl.DisplayNames) {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    }
    return (regionNames && regionNames.of(code)) || code;
  } catch {
    return code;
  }
}

/** @returns {import('./shop.js').Shop|null} */
function normalize(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (rec.type && !USABLE_TYPES.has(rec.type)) return null;
  const host = normalizeHost(rec.url);
  if (!host) return null;

  const cc = String(rec.country || '').toUpperCase();
  let country = null;
  if (cc === 'GLOBAL' || cc === 'WW') country = { code: 'WW', name: 'Worldwide', flag: '🌍' };
  else if (/^[A-Z]{2}$/.test(cc)) country = { code: cc, name: countryName(cc), flag: codeToFlag(cc) };

  return {
    id: `btcpay:${host}`,
    name: String(rec.name || '').trim() || host,
    description: String(rec.description || '').trim(),
    website: rec.url.startsWith('http') ? rec.url : `https://${rec.url}`,
    host,
    category: mapCategory('btcpay', rec.subType || rec.type),
    country,
    payments: { lightning: null, onchain: true },
    source: 'btcpay',
    sources: ['btcpay'],
    lnAddress: null,
    logoUrl: null,
    verified: false,
    raw: rec,
  };
}

/**
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('./shop.js').Shop[]>}
 */
export async function fetchBtcPayShops({ signal } = {}) {
  let lastErr;
  for (const url of URLS) {
    try {
      const arr = await fetchJson(url, { signal });
      if (Array.isArray(arr)) return arr.map(normalize).filter(Boolean);
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') throw err;
    }
  }
  throw lastErr || new Error('btcpay: no merchants feed reachable');
}
