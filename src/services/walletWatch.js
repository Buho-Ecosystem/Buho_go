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
 * It follows the rules of the Spark lifecycle (sparkLifecycle.js:
 * generation-bound runs, one follow-up, backoff, catch-up through the same
 * ledger) without its Spark-only work (sync, deposits, rebuilds, exit
 * kits), which is why the two stay separate. A change to how runs are
 * scheduled belongs in both.
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
const MAX_HINTS = 5;
/** How long one step of a run may take (connect, a read, a lookup). */
export const STEP_DEADLINE_MS = 30 * 1000;
/** A live channel that failed to open is tried again after this long. */
export const CHANNEL_RETRY_MS = 5 * 60 * 1000;
/** Runs a live channel asks for are this far apart at least (anyone who
 * knows an LNbits channel's key can post into it). */
export const HINT_SPACING_MS = 3000;
/** History reads that fail in a row, online, before the balance takes over. */
export const HISTORY_GIVE_UP = 3;

/** Triggers worth one follow-up run when they land during a run. */
const URGENT = new Set(['hint', 'resume', 'online', 'added']);
/** Triggers after which a channel may have died while the app was away. */
const RETURNED = new Set(['resume', 'online']);
/** A wallet's answers that its history will not be read, now or later. */
const REFUSED = new Set(['RESTRICTED', 'NOT_IMPLEMENTED', 'UNAUTHORIZED']);

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
  deadlineMs = STEP_DEADLINE_MS,
  online = () => typeof navigator === 'undefined' || navigator.onLine !== false,
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

  /**
   * A step that does not answer in time fails its run (which is retried),
   * so one silent server can never hold up the other wallets or the next
   * round. The request itself runs on; its late answer is ignored.
   */
  function within(promise, label) {
    let timer = null;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'DEADLINE' })), deadlineMs);
    });
    return Promise.race([Promise.resolve(promise), late]).finally(() => clearTimeout(timer));
  }

  function record(walletId) {
    let r = records.get(walletId);
    if (!r) {
      r = {
        walletId, generation: ++generations, inflight: null, rerun: null, retryTimer: null, failures: 0,
        channel: null, channelOwner: null, channelFailedAt: 0, hints: new Set(),
        historyFailures: 0, historyRefused: false, lastHintRunAt: 0, hintTimer: null,
      };
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
    runForHint(r);
  }

  /**
   * A hinted run now, or once HINT_SPACING_MS has passed since the last
   * hinted one: the first message after a quiet spell is read at once, a
   * flood of them at most every few seconds.
   */
  function runForHint(r) {
    if (r.hintTimer || !started) return; // one waiting already covers it
    const wait = Math.max(0, r.lastHintRunAt + HINT_SPACING_MS - now());
    if (!wait) { check(r.walletId, 'hint'); return; }
    r.hintTimer = setTimer(() => { r.hintTimer = null; check(r.walletId, 'hint'); }, wait);
  }

  /**
   * The channel belongs to the owner it was opened on: a reconnect makes a
   * new owner, and the channel moves with it. A channel that could not be
   * opened is tried again when the owner changes, the app comes back, or
   * a while later (CHANNEL_RETRY_MS).
   */
  async function armChannel(r, gen, wallet, owner, payments, reason) {
    const returned = RETURNED.has(reason);
    const retryFailed = !r.channel && r.channelFailedAt > 0 && now() - r.channelFailedAt >= CHANNEL_RETRY_MS;
    if (r.channelOwner === owner && (r.channel || (!returned && !retryFailed))) {
      try { r.channel?.revive?.({ returned }); } catch { /* the next run tries again */ }
      return;
    }
    stopChannel(r);
    r.channelOwner = owner;
    if (!payments?.watch) return;
    let channel = null;
    const opening = Promise.resolve().then(() => payments.watch(owner, (hint) => onHint(r.walletId, gen, hint), wallet));
    try {
      channel = await within(opening, 'channel');
    } catch (error) {
      // One that opens after all is closed again, never left running.
      opening.then((late) => { try { late?.stop?.(); } catch { /* gone */ } }, () => {});
      r.channelFailedAt = now();
      diag(r.walletId, 'channel-failed', { error: errClass(error) });
      return;
    }
    if (!isCurrent(r, gen) || r.channelOwner !== owner) {
      try { channel?.stop?.(); } catch { /* gone */ }
      return;
    }
    r.channel = channel || null;
    r.channelFailedAt = 0;
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
      // Rows of the wallets that name payments by hash (LNbits, NWC) carry
      // the hash as their id, so a decided receipt is found under it.
      if (ledger.isSeen(r.walletId, hash)) continue;
      let row = null;
      try {
        row = await within(payments.find(owner, hash, wallet), 'find');
      } catch (error) {
        diag(r.walletId, 'find-failed', { error: errClass(error) });
        continue;
      }
      if (!isCurrent(r, gen)) return found;
      if (!row) continue;
      const internal = ledger.couldAnnounce(r.walletId, row) && !!isInternal(r.walletId, row);
      const receipt = ledger.ingest(r.walletId, row, { origin: 'catchup', internal });
      if (receipt) deliver(receipt);
      if (row.status !== 'pending') found = true;
    }
    return found;
  }

  /** True when the watch announces this wallet's payments from its history. */
  function readsHistoryOf(wallet, r = records.get(wallet.id)) {
    return !!paymentsOf(wallet)?.readPage && canReadHistory(wallet) && !r?.historyRefused;
  }

  async function runOnce(r, reason) {
    const gen = r.generation;
    const wallet = walletOf(r.walletId);
    if (!wallet || isSpark(wallet)) return;
    let failure = null;
    try {
      const owner = await within(connect(wallet.id), 'connect');
      if (!isCurrent(r, gen)) return;
      if (!owner) throw Object.assign(new Error('not connected'), { code: 'NOT_CONNECTED' });
      const payments = paymentsOf(wallet);
      await armChannel(r, gen, wallet, owner, payments, reason);
      if (!isCurrent(r, gen)) return;

      let activity = false;
      if (readsHistoryOf(wallet, r)) {
        // A failed history read is retried, but holds up neither the
        // balance below nor a rule waiting for it (as in the Spark lifecycle).
        try {
          const result = await catchUpReceipts({
            ledger,
            walletId: wallet.id,
            readPage: (offset, limit) => within(payments.readPage(owner, offset, limit, wallet), 'history'),
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
          r.historyFailures = 0;
        } catch (error) {
          if (!isCurrent(r, gen)) return;
          failure = error;
          r.historyFailures += 1;
          diag(wallet.id, 'catchup-failed', { error: errClass(error) });
          // A wallet that says no to its history (not granted, not built),
          // or whose history never answers while the network does, is left
          // to its balance for this session. Its ledger goes: a later
          // return to its history starts from a new baseline instead of
          // announcing again what the balance announced.
          if (REFUSED.has(error?.code) || (online() && r.historyFailures >= HISTORY_GIVE_UP)) {
            r.historyRefused = true;
            ledger.forget(wallet.id);
            failure = null; // nothing left to retry: the balance tells from here
            diag(wallet.id, 'history-given-up');
          }
        }
      }
      // The balance follows what arrived or left; a wallet whose history
      // cannot be read has only its balance to tell; a rule needs a
      // verified figure on every round.
      if (activity || !readsHistoryOf(wallet, r) || ruleFor(wallet.id)?.enabled) await within(refreshBalance(wallet.id), 'balance');
      if (!isCurrent(r, gen)) return;
    } catch (error) {
      if (!isCurrent(r, gen)) return;
      failure = error;
    }
    if (!failure) {
      r.failures = 0;
      clearRetry(r);
      return;
    }
    r.failures += 1;
    diag(r.walletId, 'failed', { reason, failures: r.failures, error: errClass(failure) });
    scheduleRetry(r);
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
    if (reason === 'hint') r.lastHintRunAt = now();
    const run = runOnce(r, reason).finally(() => {
      r.inflight = null;
      const again = r.rerun;
      r.rerun = null;
      if (!again || records.get(walletId) !== r) return;
      if (again === 'hint') runForHint(r);
      else check(walletId, again);
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
    if (r.hintTimer) { clearTimer(r.hintTimer); r.hintTimer = null; }
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
     * the watch reads the wallet's history and will say what arrived; false
     * leaves it to the caller (not started, Spark, or a wallet whose history
     * cannot be read).
     */
    hint(walletId) {
      const wallet = walletOf(walletId);
      if (!started || !wallet || isSpark(wallet) || !readsHistoryOf(wallet)) return false;
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
    // A wallet on its way off the phone is not watched (nor reconnected).
    wallets: () => walletStore.wallets.filter((w) => !walletStore.isRemovingWallet?.(w.id)),
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
