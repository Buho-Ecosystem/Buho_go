/**
 * What one bitcoin was worth at the moment a transaction happened.
 *
 * Deliberately separate from `utils/fiatRates.js`, which answers a different
 * question. That one says "what is my balance worth now" and is allowed to be
 * approximate; this one says "what was this payment worth when it happened",
 * and that answer must never change once recorded, never be today's price
 * wearing an old date, and never be invented.
 *
 * Two sources, in order of authority:
 *
 *   1. The snapshot the app recorded at settlement (transactionMetadata's
 *      `fiatAtSettlement`). Captured within minutes of the payment, so it is
 *      the closest thing to the real number that exists.
 *   2. A Mempool server's historical-price endpoint: the same servers the
 *      app already asks for live rates (the chosen one, then the fallback),
 *      so no new dependency enters the app for this.
 *
 * A Mempool server can stop answering without failing: the connection just
 * hangs (mempool.space did, see #426). So every request has a time limit,
 * and a server that misses it is not asked again for the rest of the report.
 *
 * Two properties of that endpoint shape everything below, both verified
 * against the live API rather than taken from documentation:
 *
 *   - It answers with the NEAREST price point it holds, not the second you
 *     asked for. So the point's own timestamp is recorded next to the
 *     transaction's. A record that silently pretends those are the same is a
 *     record that cannot be audited.
 *   - Coverage is partial. USD, EUR, GBP, CAD, CHF, AUD and JPY are served.
 *     For PLN, CZK and the rest it returns HTTP 200 with an EMPTY BODY — not
 *     an error, not JSON without the key. So "no rate available" is an
 *     ordinary outcome here, and the only honest return is null.
 */

import { MEMPOOL_DEFAULT_URL, MEMPOOL_FALLBACK_URL, mempoolServerLabel } from '../../utils/mempoolServer.js';

/** The servers the live rates use when nobody says otherwise. */
const DEFAULT_SERVERS = [MEMPOOL_DEFAULT_URL, MEMPOOL_FALLBACK_URL];

/** How long one server may take to answer one request. */
export const REQUEST_TIMEOUT_MS = 10000;

/**
 * Named so a figure in the report can be traced back to who said it:
 * "mempool.space/historical-price", or the server that answered instead.
 */
export function rateSource(server) {
  return `${mempoolServerLabel(server)}/historical-price`;
}

/** Recorded at settlement by the app itself — the most accurate source. */
export const SETTLEMENT_SOURCE = 'recorded at settlement';

/**
 * The currencies the endpoint actually answers for. Everything else gets an
 * empty body, so asking is pointless and pretending is worse.
 */
export const SUPPORTED_CURRENCIES = Object.freeze([
  'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY',
]);

/** Whether a report in this currency can carry values at all. */
export function supportsCurrency(currency) {
  return SUPPORTED_CURRENCIES.includes(String(currency || '').toUpperCase());
}

/** One request per currency per day, however many transactions fall in it. */
function dayKey(currency, ms) {
  return `${currency}:${new Date(ms).toISOString().slice(0, 10)}`;
}

/** fetch() has no timeout of its own; a hung server would hold the report forever. */
async function fetchWithTimeout(doFetch, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A rate lookup with a cache and a hard request budget.
 *
 * The budget matters: a year of a busy wallet is hundreds of distinct days,
 * and a report that fires hundreds of requests at a public API is both slow
 * and rude. When it runs out, later rows simply have no rate — which the
 * report then states, rather than filling the gap with something plausible.
 *
 * Servers are asked in order. One that does not answer, or answers with an
 * error, is dropped for the rest of this lookup's life: a year of rates
 * through a dead first server would otherwise wait out its time limit once
 * per day. With every server dropped, the remaining rows have no rate.
 */
export function createRateLookup({
  currency,
  maxRequests = 400,
  fetchImpl,
  servers = DEFAULT_SERVERS,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const cur = String(currency || '').toUpperCase();
  const supported = supportsCurrency(cur);
  const cache = new Map();
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const answering = [...new Set(servers)];
  let spent = 0;

  /**
   * `{ server, point }` from the first server that answers for
   * `timestampSec`; `point` is null when it holds none. Throws only when no
   * server answered.
   */
  async function pricePoint(timestampSec) {
    while (answering.length) {
      const server = answering[0];
      try {
        const res = await fetchWithTimeout(
          doFetch,
          `${server}/historical-price?currency=${cur}&timestamp=${timestampSec}`,
          timeoutMs,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // An empty body is the documented shape of "we do not cover this
        // currency", so parse defensively rather than letting it throw.
        const text = await res.text();
        return { server, point: text ? JSON.parse(text)?.prices?.[0] ?? null : null };
      } catch {
        // Hung, offline, refused, or not a price answer: the next server.
        answering.shift();
      }
    }
    throw new Error('No Mempool server answered');
  }

  /**
   * @param {number} ms epoch milliseconds of the transaction
   * @returns {Promise<{currency, rate, source, at}|null>} null when unknown
   */
  async function at(ms) {
    if (!supported) return null;
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return null;

    const key = dayKey(cur, t);
    if (cache.has(key)) return cache.get(key);
    if (spent >= maxRequests || !answering.length) return null;

    spent += 1;
    let result = null;
    try {
      const { server, point } = await pricePoint(Math.floor(t / 1000));
      const price = Number(point?.[cur]);
      if (Number.isFinite(price) && price > 0) {
        result = {
          currency: cur,
          rate: price,
          source: rateSource(server),
          // The point's OWN time, not the one we asked for.
          at: Number(point.time) * 1000,
        };
      }
    } catch {
      // No server answered: no rate is a true statement.
    }

    cache.set(key, result);
    return result;
  }

  return {
    at,
    supported,
    get requestsSpent() { return spent; },
    get daysCached() { return cache.size; },
  };
}

/**
 * Turn a stored settlement snapshot into a rate, when it is in the currency
 * the report is being produced in.
 *
 * A snapshot in another currency is not converted: converting it would need
 * a second historical rate for the pair, and the compounded guess is exactly
 * the sort of number that looks precise and is not.
 *
 * @param {object|null} snapshot from transactionMetadata's fiatAtSettlement
 * @param {string} currency the report's currency
 */
export function rateFromSnapshot(snapshot, currency) {
  if (!snapshot) return null;
  const cur = String(currency || '').toUpperCase();
  if (String(snapshot.currency || '').toUpperCase() !== cur) return null;
  const rate = Number(snapshot.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    currency: cur,
    rate,
    source: SETTLEMENT_SOURCE,
    at: Number(snapshot.capturedAt) || null,
  };
}
