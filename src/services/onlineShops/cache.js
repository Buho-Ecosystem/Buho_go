/**
 * Per-source localStorage cache for the online-shops directory. Shops are
 * stable for hours, so we cache longer than the map (which uses sessionStorage)
 * and serve stale data on a fetch error so one flaky source never blanks the
 * list or breaks offline use.
 */

const VERSION = 'v1';

// Time-to-live per source (ms).
export const SHOP_CACHE_TTL = Object.freeze({
  listings: 6 * 60 * 60 * 1000, // 6h
  btcpay: 24 * 60 * 60 * 1000, // 24h (slow-changing curated repo)
  nostr: 30 * 60 * 1000, // 30m
});

function cacheKey(source) {
  return `buhoGO_onlineshops_${source}_${VERSION}`;
}

export function readCache(source) {
  try {
    const raw = localStorage.getItem(cacheKey(source));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.data)) return null;
    return obj; // { ts, data }
  } catch {
    return null;
  }
}

export function writeCache(source, data) {
  try {
    localStorage.setItem(cacheKey(source), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Quota / unavailable — operate from memory for the session.
  }
}

/**
 * Serve fresh cache within TTL; otherwise run `fetcher`, persist on success,
 * and fall back to stale cache on failure (so the source still counts as a
 * success for the aggregator). Rethrows only when there is no cache to fall
 * back to.
 *
 * @param {keyof SHOP_CACHE_TTL} source
 * @param {() => Promise<Array>} fetcher
 * @returns {Promise<Array>}
 */
export async function cachedFetch(source, fetcher) {
  const ttl = SHOP_CACHE_TTL[source] ?? SHOP_CACHE_TTL.btcpay;
  const cached = readCache(source);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;

  try {
    const data = await fetcher();
    writeCache(source, data);
    return data;
  } catch (err) {
    if (cached) return cached.data; // stale-on-error
    throw err;
  }
}
