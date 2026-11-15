/**
 * unseenReceipts: what each wallet received since the user last looked at
 * it. Pure rules over one small map; stores/unseenReceipts.js keeps it.
 *
 * A receipt is news the user has not looked at when it went to a wallet
 * other than the active one and no screen of theirs confirmed it (the
 * Receive sheet confirms its own invoices). The active wallet never has
 * unseen receipts: its balance is on Home. Looking at a wallet means
 * switching to it, or opening one of its payments from the toast.
 *
 * Shape, keyed by wallet id: { sats, count, since }. `sats` is the sum of
 * what arrived, `count` how many payments, `since` when the first did.
 */

export const UNSEEN_RECEIPTS_KEY = 'buhoGO_unseen_receipts_v1';

/** An entry older than this is history by then, not news. */
export const UNSEEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * True when the user has not looked at this receipt.
 * @param {{ walletId: string, amountSats: number }} receipt
 * @param {{ activeWalletId: string|null, confirmedOnScreen?: boolean }} context
 */
export function isUnseenReceipt(receipt, { activeWalletId, confirmedOnScreen = false }) {
  if (!receipt?.walletId || !(receipt.amountSats > 0)) return false;
  return receipt.walletId !== activeWalletId && !confirmedOnScreen;
}

/** The map with this receipt added to its wallet's entry. */
export function addUnseenReceipt(entries, receipt, now = Date.now()) {
  const previous = entries[receipt.walletId];
  return {
    ...entries,
    [receipt.walletId]: {
      sats: (previous?.sats || 0) + receipt.amountSats,
      count: (previous?.count || 0) + 1,
      since: previous?.since || receipt.at || now,
    },
  };
}

/** The map without this wallet's entry; the same map when there is none. */
export function clearUnseenReceipts(entries, walletId) {
  if (!entries[walletId]) return entries;
  const next = { ...entries };
  delete next[walletId];
  return next;
}

/**
 * The map without entries that are too old or belong to a wallet that is
 * no longer on this phone (`walletIds`, when given). The same map when
 * nothing is dropped.
 */
export function pruneUnseenReceipts(entries, { now = Date.now(), walletIds = null, maxAgeMs = UNSEEN_MAX_AGE_MS } = {}) {
  const keep = Object.entries(entries).filter(([walletId, entry]) =>
    now - entry.since <= maxAgeMs && (!walletIds || walletIds.includes(walletId)));
  return keep.length === Object.keys(entries).length ? entries : Object.fromEntries(keep);
}

/** The saved map, or an empty one when nothing usable is saved. */
export function readUnseenReceipts(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem(UNSEEN_RECEIPTS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return {};
    const entries = {};
    for (const [walletId, entry] of Object.entries(parsed)) {
      if (!(entry?.sats > 0) || !(entry.count > 0) || !(entry.since > 0)) continue;
      entries[walletId] = { sats: Number(entry.sats), count: Number(entry.count), since: Number(entry.since) };
    }
    return pruneUnseenReceipts(entries, { now });
  } catch {
    return {};
  }
}

/** Saves the map; an empty one removes the key. Storage failures are not worth failing over. */
export function writeUnseenReceipts(entries, storage = globalThis.localStorage) {
  try {
    if (Object.keys(entries).length) storage?.setItem(UNSEEN_RECEIPTS_KEY, JSON.stringify(entries));
    else storage?.removeItem(UNSEEN_RECEIPTS_KEY);
  } catch {
    // Private mode or a full disk: the sheet simply forgets after a restart.
  }
}
