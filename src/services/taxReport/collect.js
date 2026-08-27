/**
 * Gathering the transactions a report is built from.
 *
 * A report can span several wallets, and each wallet is a different backend
 * behind the same `getTransactions({ limit, offset })` contract. This module
 * pages each one to exhaustion, tags every row with the wallet it came from,
 * and hands back a single list in time order.
 *
 * Three rules it holds to:
 *
 *   - PARTIAL IS SAID, NOT HIDDEN. If a wallet cannot be read, or a wallet
 *     has more history than the page budget allows, the result says so. A
 *     report that quietly omits a wallet is worse than one that admits it,
 *     because only the second can be corrected.
 *   - NOTHING IS INVENTED. Rows come back exactly as `normalizeTx` produces
 *     them; this module adds provenance and nothing else.
 *   - IT CAN BE STOPPED. Reading a long history is the slowest thing in the
 *     feature, so every loop honours an AbortSignal and reports progress.
 *
 * Pure of stores: providers and the normaliser are passed in, so the paging
 * logic is testable with fakes.
 */

import { txTimeMs } from './time.js';

/** Rows per request. Large enough to keep the round trips down, small enough
 *  that a provider with a cap still answers. */
const PAGE_SIZE = 100;

/** Ceiling per wallet. At 100 a page this is 20 requests and 2000 rows — more
 *  history than a tax year for any realistic user, and a firm stop for a
 *  provider whose paging never reports the end. */
const MAX_PAGES = 20;

/**
 * Read every transaction one wallet will give us.
 *
 * @param {object} input
 * @param {object} input.wallet   { id, name, type }
 * @param {object} input.provider must implement getTransactions({ limit, offset })
 * @param {(raw: object, ctx: object) => object} input.normalize
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ rows: object[], truncated: boolean }>}
 */
async function collectWallet({ wallet, provider, normalize, signal }) {
  const rows = [];
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (signal?.aborted) break;

    const result = await provider.getTransactions({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    const raw = Array.isArray(result) ? result : (result?.transactions || []);
    if (!raw.length) return { rows, truncated: false };

    for (const item of raw) {
      const tx = normalize ? normalize(item, { walletType: wallet.type }) : item;
      rows.push({ ...tx, walletId: wallet.id, walletName: wallet.name || '' });
    }

    // A short page is the end of the history; a full one might not be.
    if (raw.length < PAGE_SIZE) return { rows, truncated: false };
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { rows, truncated };
}

/**
 * Read the selected wallets and merge them into one list, newest first.
 *
 * One wallet failing never stops the others: the user asked for a report
 * across several, and a report covering three of four with that stated is
 * more useful than no report at all.
 *
 * @param {object} input
 * @param {object[]} input.wallets   the wallets the user picked
 * @param {Record<string, object>} input.providers  by wallet id
 * @param {(raw: object, ctx: object) => object} input.normalize
 * @param {(progress: {done: number, total: number, wallet: string}) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{
 *   rows: object[],
 *   readWallets: string[],
 *   failedWallets: string[],
 *   truncatedWallets: string[],
 * }>}
 */
export async function collectTransactions({
  wallets = [],
  providers = {},
  normalize,
  onProgress,
  signal,
} = {}) {
  const rows = [];
  const readWallets = [];
  const failedWallets = [];
  const truncatedWallets = [];

  let done = 0;
  for (const wallet of wallets) {
    if (signal?.aborted) break;
    const name = wallet?.name || wallet?.id || '';
    onProgress?.({ done, total: wallets.length, wallet: name });

    const provider = providers[wallet?.id];
    if (!provider || typeof provider.getTransactions !== 'function') {
      failedWallets.push(name);
      done += 1;
      continue;
    }

    try {
      const out = await collectWallet({ wallet, provider, normalize, signal });
      rows.push(...out.rows);
      readWallets.push(name);
      if (out.truncated) truncatedWallets.push(name);
    } catch {
      // Offline, a locked wallet, a provider that threw: named, not silent.
      failedWallets.push(name);
    }
    done += 1;
    onProgress?.({ done, total: wallets.length, wallet: name });
  }

  rows.sort((a, b) => (txTimeMs(b) || 0) - (txTimeMs(a) || 0));
  return { rows, readWallets, failedWallets, truncatedWallets };
}

/**
 * Keep the transactions that belong in the report.
 *
 * Only completed transactions: a pending payment has not moved money yet and
 * an expired one never will, and either in a tax record is a figure that has
 * to be taken back out again.
 *
 * @param {object[]} rows
 * @param {{ fromMs?: number|null, toMs?: number|null }} period inclusive bounds
 */
export function filterForReport(rows, { fromMs = null, toMs = null } = {}) {
  return (rows || []).filter((tx) => {
    if ((tx?.status || 'completed') !== 'completed') return false;
    const ms = txTimeMs(tx);
    if (ms === null) return false;
    if (fromMs !== null && ms < fromMs) return false;
    if (toMs !== null && ms > toMs) return false;
    return true;
  });
}

/**
 * The periods the report offers, resolved against a clock that is passed in
 * so the choices are testable and never depend on when a test runs.
 *
 * Tax years differ by country, so these are plain calendar years plus a
 * custom range — naming a specific jurisdiction's year here would be wrong
 * for most users of an app that ships in three languages.
 *
 * @param {Date} [now]
 * @returns {Array<{ id, labelKey, fromMs, toMs }>}
 */
export function standardPeriods(now = new Date()) {
  const year = now.getFullYear();
  const startOf = (y) => new Date(y, 0, 1, 0, 0, 0, 0).getTime();
  const endOf = (y) => new Date(y, 11, 31, 23, 59, 59, 999).getTime();

  return [
    { id: 'thisYear', labelKey: 'This year', fromMs: startOf(year), toMs: now.getTime() },
    { id: 'lastYear', labelKey: 'Last year', fromMs: startOf(year - 1), toMs: endOf(year - 1) },
    { id: 'all', labelKey: 'Everything', fromMs: null, toMs: null },
  ];
}
