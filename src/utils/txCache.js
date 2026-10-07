/**
 * Last known transactions per wallet, for an instant first paint.
 *
 * The home card and the history list used to wait for the provider (a
 * Spark connect, an LNbits or NWC round-trip) before showing anything, and
 * blanked on every wallet switch. They now paint what was there last time
 * and replace it when the fresh read lands. Display only: nothing that
 * moves money reads from here.
 *
 * Stored in localStorage next to the wallet state the app already keeps
 * there. Bounded per wallet; BigInt values (Breez amounts) are stored as
 * numbers. Every call degrades to a no-op when storage is unavailable.
 */

export const TX_CACHE_KEY = 'buhoGO_tx_cache_v1';
export const TX_CACHE_LIMIT = 50;

function storage(store) {
  if (store) return store;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(store) {
  try {
    const raw = storage(store)?.getItem(TX_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Cached transactions for a wallet, newest first ([] when none). */
export function readCachedTransactions(walletId, { store } = {}) {
  if (!walletId) return [];
  const list = readAll(store)[walletId];
  return Array.isArray(list) ? list : [];
}

/** Replace a wallet's cached transactions with the newest `limit` of `txs`. */
export function writeCachedTransactions(walletId, txs, { store, limit = TX_CACHE_LIMIT } = {}) {
  const s = storage(store);
  if (!walletId || !s || !Array.isArray(txs)) return false;
  try {
    const all = readAll(s);
    all[walletId] = JSON.parse(JSON.stringify(txs.slice(0, limit), (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
    s.setItem(TX_CACHE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the newest `txs` (a fresh first page, newest first) in front of the
 * cached list, keeping cached older rows the page did not cover. A short
 * read (the home card's 10) then never truncates the history list's cache.
 */
export function mergeCachedTransactions(walletId, txs, { store, limit = TX_CACHE_LIMIT } = {}) {
  if (!walletId || !Array.isArray(txs)) return false;
  // An empty first page is an empty wallet.
  if (!txs.length) return writeCachedTransactions(walletId, [], { store, limit });
  const key = (tx) => tx?.id ?? tx?.paymentHash ?? tx?.payment_hash ?? null;
  const fresh = new Set(txs.map(key).filter(Boolean));
  const oldest = Number(txs[txs.length - 1]?.settled_at);
  const older = readCachedTransactions(walletId, { store }).filter((tx) => {
    const id = key(tx);
    if (id && fresh.has(id)) return false;
    // Only rows older than the fresh page: anything inside its time range
    // that the provider no longer returns is gone (failed, removed).
    const at = Number(tx?.settled_at);
    return !Number.isFinite(oldest) || !Number.isFinite(at) || at < oldest;
  });
  return writeCachedTransactions(walletId, [...txs, ...older], { store, limit });
}

/** Forget a wallet's cached transactions (wallet removed). */
export function clearCachedTransactions(walletId, { store } = {}) {
  const s = storage(store);
  if (!walletId || !s) return;
  try {
    const all = readAll(s);
    if (!(walletId in all)) return;
    delete all[walletId];
    s.setItem(TX_CACHE_KEY, JSON.stringify(all));
  } catch { /* nothing to clear */ }
}
