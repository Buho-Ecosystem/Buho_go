/**
 * One balance state per wallet (#293).
 *
 * A wallet's balance has a value AND a provenance. Treating "no value yet"
 * as 0, or a cached value as verified, is how a funded wallet ended up
 * showing 0 in Manage Wallets or a total while the home screen showed
 * funds. Every surface reads a state built here:
 *
 *   { value: number|null, source, verifiedAt: ms|null, updatedAt: ms|null,
 *     refreshing: boolean, error: string|null }
 *
 * source: 'persisted' (saved last-known value from a previous session),
 *         'cache'     (local SDK read, not network-verified),
 *         'sync'|'event'|'connect' (network-verified).
 *
 * Pure functions, no Vue/Pinia, so the rules are unit-tested directly.
 */

/** A verified value older than this is shown as stale. */
export const FRESH_FOR_MS = 3 * 60 * 1000;

const VERIFIED_SOURCES = new Set(['sync', 'event', 'connect']);

export const BALANCE_STATUS = Object.freeze({
  UNKNOWN: 'unknown',   // no value at all, nothing in flight
  LOADING: 'loading',   // no value yet, a read is in flight
  FRESH: 'fresh',       // verified recently
  STALE: 'stale',       // a value exists but is cached/persisted/old
  ERROR: 'error',       // no value, the last attempt failed
});

export function emptyBalanceState() {
  return { value: null, source: null, verifiedAt: null, updatedAt: null, refreshing: false, error: null };
}

/** Saved last-known value from wallet metadata, always stale on load. */
export function hydrateBalanceState(wallet, legacyState = null) {
  let cached = wallet?.metadata?.cachedBalance;
  const valid = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0;
  // Old Home snapshots have no trustworthy balance timestamp. On migration
  // we can reuse an unambiguous value, but cannot rank conflicting caches.
  // Never choose the higher/lower figure or present either as verified.
  if (legacyState) {
    const wallets = Array.isArray(legacyState.connectedWallets) ? legacyState.connectedWallets : [];
    const candidates = [cached, wallets.find(w => w?.id === wallet.id)?.balance];
    if (legacyState.activeWalletId === wallet.id) candidates.push(legacyState.balance);
    const values = [...new Set(candidates.filter(valid).map(Number))];
    if (values.length > 1) return emptyBalanceState();
    if (values.length === 1) cached = values[0];
  }
  if (!valid(cached)) return emptyBalanceState();
  const at = Number(wallet.metadata?.balanceUpdatedAt) || null;
  return { value: Number(cached), source: 'persisted', verifiedAt: at, updatedAt: at, refreshing: false, error: null };
}

/**
 * Accept a reading. A non-fresh reading never replaces a verified value that
 * is newer than it, and an invalid number is ignored (keeping the last
 * value) instead of becoming 0.
 */
export function nextBalanceState(prev, { value, source = 'sync', fresh = VERIFIED_SOURCES.has(source), at = Date.now(), error = null } = {}) {
  const base = prev || emptyBalanceState();
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n < 0) {
    return { ...base, error: error || base.error };
  }
  // Out of order: a reading taken before the value we already verified
  // (a slow read finishing late) cannot overwrite it.
  if (base.verifiedAt && base.source && VERIFIED_SOURCES.has(base.source) && base.verifiedAt > at) {
    return fresh ? base : { ...base, error: error || base.error };
  }
  if (fresh) {
    return {
      value: n,
      source: VERIFIED_SOURCES.has(source) ? source : 'sync',
      verifiedAt: at,
      updatedAt: at,
      refreshing: base.refreshing,
      error: null,
    };
  }
  // An unverified (local cache) reading. After a failed sync, or over a
  // saved last-known value, the SDK cache may be partial or empty: it must
  // not replace known funds, turn unknown into a zero, or clear the error.
  // Only a verified reading does those things.
  const known = base.value !== null && base.value !== undefined;
  const failing = !!(error || base.error);
  if (known && (failing || base.source === 'persisted')) return { ...base, error: error || base.error };
  if (!known && failing) return { ...base, error: error || base.error };
  return {
    value: n,
    source: source === 'persisted' ? 'persisted' : 'cache',
    // A changed value inherits no verification time from the old one.
    verifiedAt: n === base.value ? base.verifiedAt : null,
    updatedAt: at,
    refreshing: base.refreshing,
    error: base.error,
  };
}

/** Derive what a surface should communicate about one wallet's balance. */
export function describeBalance(state, { now = Date.now(), freshForMs = FRESH_FOR_MS } = {}) {
  const s = state || emptyBalanceState();
  const known = s.value !== null && s.value !== undefined;
  let status;
  if (!known) status = s.refreshing ? BALANCE_STATUS.LOADING : (s.error ? BALANCE_STATUS.ERROR : BALANCE_STATUS.UNKNOWN);
  else if (VERIFIED_SOURCES.has(s.source) && s.verifiedAt && now - s.verifiedAt <= freshForMs && !s.error) status = BALANCE_STATUS.FRESH;
  else status = BALANCE_STATUS.STALE;
  return {
    known,
    value: known ? s.value : null,
    status,
    stale: status === BALANCE_STATUS.STALE,
    refreshing: !!s.refreshing,
    source: s.source,
    verifiedAt: s.verifiedAt,
    error: s.error,
  };
}

/**
 * Total across every configured wallet. Unknown wallets contribute nothing
 * but make the total incomplete; stale inputs make it stale. A verified
 * zero is a complete zero; an unknown is never presented as one.
 */
export function summarizeTotal(walletIds, states, { now = Date.now(), freshForMs = FRESH_FOR_MS } = {}) {
  let total = 0;
  const unknownIds = [];
  const staleIds = [];
  for (const id of walletIds) {
    const d = describeBalance(states?.[id], { now, freshForMs });
    if (!d.known) { unknownIds.push(id); continue; }
    total += d.value;
    if (d.status !== BALANCE_STATUS.FRESH) staleIds.push(id);
  }
  return {
    total,
    complete: unknownIds.length === 0,
    stale: staleIds.length > 0,
    unknownIds,
    staleIds,
  };
}
