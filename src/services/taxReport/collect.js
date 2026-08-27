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
 * ONE WALLET IS LIVE AT A TIME. The app connects the active wallet and no
 * others (`stores/wallet.js` auto-connects the active wallet at boot, and
 * `connectAllSparkWallets` tears down every non-active Spark provider to keep
 * a single Spark session). So a report over several wallets cannot simply read
 * a map of providers: all but one would be missing. The caller passes a
 * `connect` function, this module calls it for each wallet in turn, and
 * because the loop is sequential a caller can safely connect wallets that
 * cannot coexist.
 *
 * Pure of stores: providers, the connector and the normaliser are passed in,
 * so the paging logic is testable with fakes.
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
  const seen = new Set();
  let truncated = false;

  /**
   * Providers disagree about paging, so identity is what makes a page safe to
   * append rather than the page number.
   *
   * Arkade's `getTransactions()` takes no arguments and returns the whole
   * history every call; LNbits' offsets shift under us if a payment settles
   * mid-read. Both put the same transaction in the list twice, which in a tax
   * document is a duplicated amount.
   */
  const keyOf = (tx) => tx?.id || tx?.paymentHash || tx?.payment_hash
    || `${tx?.settled_at || tx?.created_at || ''}:${tx?.amount ?? ''}:${tx?.description || ''}`;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (signal?.aborted) break;

    const result = await provider.getTransactions({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    const raw = Array.isArray(result) ? result : (result?.transactions || []);
    if (!raw.length) return { rows, truncated: false };

    let fresh = 0;
    for (const item of raw) {
      const tx = normalize ? normalize(item, { walletType: wallet.type }) : item;
      const key = keyOf(tx);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh += 1;
      rows.push({ ...tx, walletId: wallet.id, walletName: wallet.name || '' });
    }

    // More than we asked for means the provider ignored the limit, so what it
    // handed back is the entire history and there is no second page to get.
    if (raw.length > PAGE_SIZE) return { rows, truncated: false };
    // A short page is the end of the history; a full one might not be.
    if (raw.length < PAGE_SIZE) return { rows, truncated: false };
    // A full page we had already seen means paging is not advancing. Asking
    // nineteen more times would return the same rows.
    if (fresh === 0) return { rows, truncated: false };
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { rows, truncated };
}

/**
 * Get a usable provider for one wallet, connecting it if it is not live.
 *
 * A wallet already connected costs nothing; every other one costs a handshake.
 * Returns null rather than throwing so one unreachable wallet is a named
 * omission in the report instead of the end of it.
 */
async function providerFor({ wallet, providers, connect }) {
  const live = providers?.[wallet?.id];
  if (typeof live?.getTransactions === 'function') return live;
  if (typeof connect !== 'function') return null;
  const opened = await connect(wallet);
  return typeof opened?.getTransactions === 'function' ? opened : null;
}

/**
 * Read the selected wallets and merge them into one list, newest first.
 *
 * One wallet failing never stops the others: the user asked for a report
 * across several, and a report covering three of four with that stated is
 * more useful than no report at all.
 *
 * Wallets are read STRICTLY IN SEQUENCE. Two reasons, and both are load
 * bearing: a Spark wallet cannot be live at the same time as another one, and
 * connecting fifteen wallets at once would open fifteen handshakes against
 * fifteen servers on a phone.
 *
 * @param {object} input
 * @param {object[]} input.wallets   the wallets the user picked
 * @param {Record<string, object>} [input.providers]  already-live, by wallet id
 * @param {(wallet: object) => Promise<object|null>} [input.connect]
 *   opens a wallet that is not live. Called once per wallet, in order.
 * @param {(raw: object, ctx: object) => object} input.normalize
 * @param {(progress: {done: number, total: number, wallet: string}) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{
 *   rows: object[],
 *   readWallets: string[],
 *   failedWallets: string[],
 *   truncatedWallets: string[],
 *   walletResults: Array<{id, name, status: 'read'|'failed'|'skipped', count: number, truncated: boolean}>,
 * }>}
 */
export async function collectTransactions({
  wallets = [],
  providers = {},
  connect,
  normalize,
  onProgress,
  signal,
} = {}) {
  const rows = [];
  const readWallets = [];
  const failedWallets = [];
  const truncatedWallets = [];
  const walletResults = [];

  let done = 0;
  for (const wallet of wallets) {
    const name = wallet?.name || wallet?.id || '';

    // A cancelled report stops asking, and says which wallets it never
    // reached rather than presenting a short list as a complete one.
    if (signal?.aborted) {
      walletResults.push({ id: wallet?.id, name, status: 'skipped', count: 0, truncated: false });
      continue;
    }

    onProgress?.({ done, total: wallets.length, wallet: name });

    try {
      const provider = await providerFor({ wallet, providers, connect });
      if (!provider) throw new Error('no provider');

      const out = await collectWallet({ wallet, provider, normalize, signal });
      rows.push(...out.rows);
      readWallets.push(name);
      if (out.truncated) truncatedWallets.push(name);
      walletResults.push({
        id: wallet?.id, name, status: 'read', count: out.rows.length, truncated: out.truncated,
      });
    } catch {
      // Unreachable, locked, credentials changed, or a provider that threw:
      // named, not silent.
      failedWallets.push(name);
      walletResults.push({ id: wallet?.id, name, status: 'failed', count: 0, truncated: false });
    }

    done += 1;
    onProgress?.({ done, total: wallets.length, wallet: name });
  }

  rows.sort((a, b) => (txTimeMs(b) || 0) - (txTimeMs(a) || 0));
  return { rows, readWallets, failedWallets, truncatedWallets, walletResults };
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
