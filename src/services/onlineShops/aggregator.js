/**
 * Online-shops aggregator. Two surfaces:
 *   - fetchDirectoryShops: the core "Shops" list = BitcoinListings + BTCPay,
 *     fetched in parallel, cached, merged + deduped + sorted. One source failing
 *     never blanks the list (Promise.allSettled + stale-on-error cache).
 *   - fetchMarketShops: the opt-in Nostr "markets" facet, kept separate so it
 *     never touches first paint and a weak relay result can't degrade the core.
 */

import { cachedFetch } from './cache.js';
import { fetchListingsShops } from './listings.js';
import { fetchBtcPayShops } from './btcpayShops.js';
import { fetchNostrShops } from './nostrShops.js';
import { mergeShops, sortShops } from './shop.js';

/**
 * @param {{ signal?: AbortSignal, locale?: string }} [opts]
 * @returns {Promise<{ shops: import('./shop.js').Shop[], errors: Record<string,string> }>}
 */
export async function fetchDirectoryShops({ signal, locale } = {}) {
  const tasks = [
    { name: 'listings', run: () => cachedFetch('listings', () => fetchListingsShops({ signal })) },
    { name: 'btcpay', run: () => cachedFetch('btcpay', () => fetchBtcPayShops({ signal })) },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const lists = [];
  const errors = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push(r.value || []);
    else errors[tasks[i].name] = r.reason?.message || 'failed';
  });

  return { shops: sortShops(mergeShops(...lists), locale), errors };
}

/**
 * @param {{ signal?: AbortSignal, locale?: string }} [opts]
 * @returns {Promise<{ shops: import('./shop.js').Shop[], errors: Record<string,string> }>}
 */
export async function fetchMarketShops({ signal, locale } = {}) {
  try {
    const shops = await cachedFetch('nostr', () => fetchNostrShops({ signal }));
    return { shops: sortShops(shops, locale), errors: {} };
  } catch (err) {
    return { shops: [], errors: { nostr: err?.message || 'failed' } };
  }
}
