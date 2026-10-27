/**
 * walletWatch: keeps every wallet the Spark lifecycle does not own (LNbits,
 * NWC, Arkade) current while the app runs, all of them, whichever is on
 * screen. Two readers depend on it:
 *
 *  - Incoming payments. Each wallet's live channel (LNbits' websocket, NWC
 *    payment notifications, Arkade's contract stream) says "look now"; the
 *    watch then reads the wallet's recent history into the shared receipt
 *    ledger, which announces each settled receive once, by its id, with its
 *    own amount (paymentReceipts.catchUpReceipts). A channel's message is
 *    never proof: anyone can post into an LNbits channel, and Arkade's
 *    stream also reports change and renewals.
 *  - Auto-Transfer. A rule runs on a verified balance, so a wallet with a
 *    switched-on rule has its balance read on every round.
 *
 * Triggers: start (a cold start after the app was closed), every minute
 * while the app runs, return to the app, back online, a channel's hint, a
 * balance seen rising elsewhere (store.noticeIncomingPayment), and wallets
 * added. Per wallet, overlapping triggers coalesce into one run plus at
 * most one follow-up; a failed run retries with backoff, a few times, then
 * waits for the next round. The minute round is the safety net for a live
 * channel that died without closing: none of the three replays what it
 * missed.
 *
 * There is no background service: while Android has the app frozen,
 * nothing here runs, and the read on return catches up (delivery then posts
 * a system notification for what settled while away). Push while closed is
 * #276.
 *
 * The scheduling is createWalletWatch, pure and tested; startWalletWatch
 * wires it to the stores and the app.
 */

import { catchUpReceipts } from './paymentReceipts.js';
import { receiptLedger, deliverReceipt, trackAppVisibility } from './paymentReceiptsApp.js';
import { notifiesPayments, watchNwcPayments, listNwcPayments, findNwcPayment } from './nwcReceive.js';
import { capabilitiesOf } from '../utils/nwcWallet.js';
import { onAppVisibility } from '../utils/appVisibility.js';

export const WATCH_INTERVAL_MS = 60 * 1000;
// Coming back to the app raises several events at once (visibility, app
// state, resume) while the thawed timer fires too: one round covers them.
export const RESUME_SETTLE_MS = 5 * 1000;
/** A failed run is tried again after these waits, then left to the round. */
export const RETRY_MS = [2000, 5000, 15000, 30000];
/** History is read this many payments at a time. */
export const PAGE_SIZE = 20;
/** Payment hashes a wallet's channel named that wait for the next run. */
const MAX_HINTS = 20;

/** Triggers worth one follow-up run when they land during a run. */
const URGENT = new Set(['hint', 'resume', 'online', 'added']);
/** Triggers after which a channel may have died while the app was away. */
const RETURNED = new Set(['resume', 'online']);

const isSpark = (wallet) => (wallet?.type || 'nwc') === 'spark';

/**
 * How each wallet type is watched and read. Spark has its own lifecycle.
 *   watch(owner, onHint, wallet)    -> { stop, revive? } | null (no channel)
 *   readPage(owner, offset, limit)  -> rows newest first; throws on failure
 *   find(owner, paymentHash, wallet) -> one row | null, for a hint the pages did not reach
 * `owner` is what the store connects: the provider, or the NWC connection.
 */
export const PAYMENTS = Object.freeze({
  lnbits: {
    watch: (provider, onHint) => provider.watchPayments(onHint),
    readPage: (provider, offset, limit) => provider.listPayments({ offset, limit }),
    find: (provider, paymentHash) => provider.getPayment(paymentHash),
  },
  arkade: {
    watch: (provider, onHint) => provider.watchPayments(onHint),
    readPage: (provider, offset, limit) => provider.getTransactions({ offset, limit }),
  },
  nwc: {
    watch: (connection, onHint, wallet) => (notifiesPayments(wallet) ? watchNwcPayments(connection, onHint) : null),
    readPage: (connection, offset, limit) => listNwcPayments(connection, { offset, limit }),
    find: (connection, paymentHash, wallet) => findNwcPayment(connection, paymentHash, { methods: wallet.metadata?.methods }),
  },
});

/**
 * @param {object} deps
 * @param {() => Array<{ id: string, type?: string }>} deps.wallets
 * @param {(walletId: string) => Promise<object>} deps.connect  the wallet's live owner (provider or NWC connection)
 * @param {(wallet: object) => object|null} [deps.paymentsOf]  default: PAYMENTS by type
 * @param {(wallet: object) => boolean} deps.canReadHistory  false: only the balance can tell
 * @param {(walletId: string) => object|null} deps.ruleFor  the wallet's Auto-Transfer rule
 * @param {(walletId: string) => Promise<unknown>} deps.refreshBalance
 * @param {object} deps.ledger  paymentReceipts.createReceiptLedger()
 * @param {(receipt: object) => void} deps.deliver
 * @param {(walletId: string, payment: object) => boolean} [deps.isInternal]
 */
export function createWalletWatch({
  wallets,
  connect,
  paymentsOf = (wallet) => PAYMENTS[wallet?.type || 'nwc'] || null,
  canReadHistory,
  ruleFor,
  refreshBalance,
  ledger,
  deliver,
  isInternal = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  log = () => {},
}) {
  /** walletId -> per-wallet record */
  const records = new Map();
  // Unique across records: a wallet removed and added again never takes a
  // late hint or result from its first record.
  let generations = 0;
  let started = false;
  let timer = null;
  let round = null;
  let lastRoundAt = -Infinity;

  const walletOf = (walletId) => wallets().find((w) => w.id === walletId) || null;
  /** Every wallet the watch keeps current. */
  const watched = () => wallets().filter((w) => !isSpark(w));
  const isCurrent = (r, gen) => r.generation === gen && records.get(r.walletId) === r && !!walletOf(r.walletId);
  const diag = (walletId, event, extra = {}) => log({ t: now(), w: String(walletId || '').slice(-6), event, ...extra });

  function record(walletId) {
    let r = records.get(walletId);
    if (!r) {
      r = { walletId, generation: ++generations, inflight: null, rerun: null, retryTimer: null, failures: 0, channel: null, channelOwner: null, hints: new Set() };
      records.set(walletId, r);
    }
    return r;
  }

  // ---- Live channel ------------------------------------------------------

  function stopChannel(r) {
    const channel = r.channel;
    r.channel = null;
    r.channelOwner = null;
    try { channel?.stop?.(); } catch { /* already gone */ }
  }

  function onHint(walletId, gen, hint) {
    const r = records.get(walletId);
    if (!started || !r || r.generation !== gen) return;
    const hash = String(hint?.paymentHash || '').toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hash) && r.hints.size < MAX_HINTS) r.hints.add(hash);
    check(walletId, 'hint');
  }

  /**
   * The channel belongs to the owner it was opened on: a reconnect makes a
   * new owner, and the channel moves with it. A channel that could not be
   * opened is tried again when the owner changes or the app comes back.
   */
  async function armChannel(r, gen, wallet, owner, payments, reason) {
    const returned = RETURNED.has(reason);
    if (r.channelOwner === owner && (r.channel || !returned)) {
      try { r.channel?.revive?.({ returned }); } catch { /* the next run tries again */ }
      return;
    }
    stopChannel(r);
    r.channelOwner = owner;
    if (!payments?.watch) return;
    let channel = null;
    try {
      channel = await payments.watch(owner, (hint) => onHint(r.walletId, gen, hint), wallet);
    } catch (error) {
      diag(r.walletId, 'channel-failed', { error: errClass(error) });
      return;
    }
    if (!isCurrent(r, gen) || r.channelOwner !== owner) {
      try { channel?.stop?.(); } catch { /* gone */ }
      return;
    }
    r.channel = channel || null;
    if (channel) diag(r.walletId, 'channel');
  }

  // ---- One run -----------------------------------------------------------

  /** Payments a channel named that the history pages did not reach. */
  async function findHinted(r, gen, wallet, owner, payments) {
    const hashes = [...r.hints];
    r.hints.clear();
    if (!payments.find) return false;
    let found = false;
    for (const hash of hashes) {
      if (ledger.isSeen(r.walletId, hash)) continue;
      let row = null;
      try {
        row = await payments.find(owner, hash, wallet);
      } catch (error) {
        diag(r.walletId, 'find-failed', { error: errClass(error) });
        continue;
      }
      if (!isCurrent(r, gen)) return found;
      if (!row) continue;
      const receipt = ledger.ingest(r.walletId, row, { origin: 'catchup', internal: !!isInternal(r.walletId, row) });
      if (receipt) deliver(receipt);
      if (row.status !== 'pending') found = true;
    }
    return found;
  }

  async function runOnce(r, reason) {
    const gen = r.generation;
    const wallet = walletOf(r.walletId);
    if (!wallet || isSpark(wallet)) return;
    try {
      const owner = await connect(wallet.id);
      if (!isCurrent(r, gen)) return;
      if (!owner) throw Object.assign(new Error('not connected'), { code: 'NOT_CONNECTED' });
      const payments = paymentsOf(wallet);
      await armChannel(r, gen, wallet, owner, payments, reason);
      if (!isCurrent(r, gen)) return;

      const readsHistory = !!payments?.readPage && canReadHistory(wallet);
      let activity = false;
      if (readsHistory) {
        const result = await catchUpReceipts({
          ledger,
          walletId: wallet.id,
          readPage: (offset, limit) => payments.readPage(owner, offset, limit, wallet),
          isCurrent: () => isCurrent(r, gen),
          isInternal: (payment) => isInternal(wallet.id, payment),
          deliver,
          pageSize: PAGE_SIZE,
          now,
        });
        if (result === null) return;
        activity = result.unseen > 0;
        if (await findHinted(r, gen, wallet, owner, payments)) activity = true;
        if (!isCurrent(r, gen)) return;
        if (result.announced) diag(wallet.id, 'receipts', { n: result.announced });
      }
      // The balance follows what arrived or left; a wallet whose history
      // cannot be read has only its balance to tell; a rule needs a
      // verified figure on every round.
      if (activity || !readsHistory || ruleFor(wallet.id)?.enabled) await refreshBalance(wallet.id);
      r.failures = 0;
      clearRetry(r);
    } catch (error) {
      if (!isCurrent(r, gen)) return;
      r.failures += 1;
      diag(r.walletId, 'failed', { reason, failures: r.failures, error: errClass(error) });
      scheduleRetry(r);
    }
  }

  function clearRetry(r) {
    if (r.retryTimer) { clearTimer(r.retryTimer); r.retryTimer = null; }
  }

  function scheduleRetry(r) {
    clearRetry(r);
    if (!started || r.failures > RETRY_MS.length) return;
    r.retryTimer = setTimer(() => { r.retryTimer = null; check(r.walletId, 'retry'); }, RETRY_MS[r.failures - 1]);
  }

  /**
   * Check one wallet now. Concurrent calls share the run in flight; an
   * urgent trigger arriving mid-run schedules exactly one follow-up.
   */
  function check(walletId, reason = 'manual') {
    const wallet = walletOf(walletId);
    if (!started || !wallet || isSpark(wallet)) return Promise.resolve();
    const r = record(walletId);
    if (r.inflight) {
      if (URGENT.has(reason)) r.rerun = reason;
      return r.inflight;
    }
    const run = runOnce(r, reason).finally(() => {
      r.inflight = null;
      const again = r.rerun;
      r.rerun = null;
      if (again && records.get(walletId) === r) check(walletId, again);
    });
    r.inflight = run;
    return run;
  }

  // ---- Rounds and lifetime ------------------------------------------------

  /** Wallets that left the list: their channel and pending work go. */
  function dropRemoved() {
    const ids = new Set(watched().map((w) => w.id));
    for (const walletId of [...records.keys()]) if (!ids.has(walletId)) forget(walletId);
  }

  /** One round at a time: a call while one runs shares it. */
  function runRound(reason) {
    if (round) return round;
    lastRoundAt = now();
    dropRemoved();
    round = Promise.allSettled(watched().map((w) => check(w.id, reason))).finally(() => { round = null; });
    return round;
  }

  function schedule() {
    if (!started) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      runRound('timer').finally(schedule);
    }, WATCH_INTERVAL_MS);
  }

  function forget(walletId) {
    const r = records.get(walletId);
    if (!r) return;
    r.generation = ++generations;
    clearRetry(r);
    stopChannel(r);
    r.hints.clear();
    records.delete(walletId);
  }

  return {
    watched,
    check,
    /** Reads at once: a payment may have arrived while the app was closed. */
    start() {
      if (started) return Promise.resolve();
      started = true;
      return runRound('start').finally(schedule);
    },
    stop() {
      started = false;
      if (timer) clearTimer(timer);
      timer = null;
      for (const walletId of [...records.keys()]) forget(walletId);
    },
    /** Back in front of the person, or back online: read now instead of at the next tick. */
    resume(reason = 'resume') {
      if (!started) return Promise.resolve();
      if (round || now() - lastRoundAt < RESUME_SETTLE_MS) return round || Promise.resolve();
      if (timer) clearTimer(timer);
      timer = null;
      return runRound(reason).finally(schedule);
    },
    /**
     * Something outside the watch saw this wallet's balance rise. True when
     * the watch reads the wallet and will say what arrived; false leaves it
     * to the caller.
     */
    hint(walletId) {
      const wallet = walletOf(walletId);
      if (!started || !wallet || isSpark(wallet)) return false;
      check(walletId, 'balance');
      return true;
    },
    /** Wallets were added or removed: watch the new ones, drop the gone. */
    sync() {
      if (!started) return;
      dropRemoved();
      for (const wallet of watched()) if (!records.has(wallet.id)) check(wallet.id, 'added');
    },
    forget,
    get started() { return started; },
  };
}

/**
 * Diagnostics keep a failure class only: a provider's error text can carry
 * an address or a key, so it never enters the log.
 */
function errClass(error) {
  if (error?.code) return String(error.code).slice(0, 40);
  if (error?.status) return `http-${error.status}`;
  if (/timeout/i.test(String(error?.message || ''))) return 'timeout';
  return 'error';
}

let instance = null;

/** The app's watch, once started; null before (tests, the audit harness). */
export function walletWatch() {
  return instance;
}

/**
 * Start the app's watch, wired to the stores and to app visibility. Called
 * once the saved wallets and rules are loaded (stores/wallet.js initialize).
 */
export function startWalletWatch(walletStore, autoTransferStore) {
  if (instance || typeof window === 'undefined') return instance;
  trackAppVisibility();
  instance = createWalletWatch({
    wallets: () => walletStore.wallets,
    connect: (walletId) => walletStore.ensureWalletConnectedForTransfer(walletId),
    canReadHistory: (wallet) => capabilitiesOf(wallet).history,
    ruleFor: (walletId) => autoTransferStore.getConfig(walletId),
    refreshBalance: (walletId) => walletStore.refreshBalance(walletId),
    ledger: receiptLedger(),
    deliver: deliverReceipt,
    isInternal: (walletId, payment) => !!walletStore.isInternalTransferReceipt?.(walletId, payment),
    log: (entry) => { if (import.meta.env?.DEV) console.debug('[wallet-watch]', entry); },
  });
  instance.start();
  onAppVisibility((visible) => { if (visible) instance.resume('resume'); });
  window.addEventListener('online', () => instance.resume('online'));
  return instance;
}
