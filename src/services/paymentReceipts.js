/**
 * Received-payment detection by payment identity (#295).
 *
 * The old signal, "the balance went up", misses a receive that overlaps a
 * send (1,000 + 200 - 300 = 900: no increase, no notice), reports the net
 * difference instead of the received amount, and cannot tell which payment
 * it saw. This ledger decides per payment instead, keyed by wallet and
 * payment id, and remembers what it has decided so SDK events, history
 * catch-up and app restarts announce every receipt at most once.
 *
 * Rules (each pinned by __tests__/paymentReceipts.spec.js):
 *  - Only a settled receive is a receipt: paymentType/type 'receive' and
 *    status 'completed'. Sends, pending and failed payments never are; a
 *    pending receive that later completes is announced on completion.
 *  - The first time a wallet is seen, its existing history is the baseline:
 *    marked seen, never announced ("you received your whole balance" on
 *    first launch would be false).
 *  - Catch-up announces only unseen receipts newer than the wallet's
 *    checkpoint (with a small clock-skew allowance); older unseen history is
 *    recorded silently.
 *  - Internal transfers between the user's own wallets are recorded but not
 *    announced: the user started them and already saw the transfer succeed.
 *  - The seen set is bounded per wallet and persisted.
 *
 * Detection only. Delivery (OS notification, in-app toast, future push) is
 * the caller's business; see `receiptDelivery()` for the policy on what a
 * receipt discovered in the foreground means.
 */

import { paymentHashOf } from '../utils/breezPayments.js';

export const RECEIPTS_STORAGE_KEY = 'buhoGO_payment_receipts_v1';
export const MAX_SEEN_PER_WALLET = 400;
export const MAX_PENDING_PER_WALLET = 100;
/** Clock skew tolerated between the device and payment timestamps. */
export const CHECKPOINT_SLACK_S = 120;

/**
 * Normalize an SDK Payment or a mapped transaction row into
 * { id, paymentHash, isReceive, status, amountSats, timestamp (unix s) }.
 */
export function receiptFromPayment(payment) {
  if (!payment || payment.id == null) return null;
  // Token transfers are not sats; announcing their units as sats would lie.
  if (payment.method === 'token' || payment.details?.type === 'token') return null;
  const kind = payment.paymentType ?? payment.type;
  const isReceive = kind === 'receive' || kind === 'incoming';
  // An SDK Payment carries the net amount; a mapped row carries gross
  // (net + fee). A receive's fee is the receiver's, so net = gross - fee.
  const raw = Number(payment.amount ?? 0);
  const fee = Number(payment.fees ?? payment.fee ?? 0);
  const isMappedRow = payment.paymentType === undefined && payment.fees === undefined;
  const amountSats = Math.max(0, Math.round(isMappedRow ? raw - fee : raw));
  // When it settled, where the row says so: a row's own timestamp can be
  // when its invoice was created, long before it was paid.
  const ts = Number(payment.settled_at ?? payment.timestamp ?? 0);
  const hash = paymentHashOf(payment) || payment.paymentHash || payment.payment_hash;
  return {
    id: String(payment.id),
    // Other ids the same payment was listed under before (an Arkade deposit
    // under its commitment transaction): seen under one, seen.
    aliases: Array.isArray(payment.aliases) ? payment.aliases.filter(Boolean).map(String) : [],
    paymentHash: hash ? String(hash).toLowerCase() : null,
    isReceive,
    status: payment.status || 'completed',
    amountSats,
    timestamp: Number.isFinite(ts) && ts > 0 ? (ts > 1e12 ? Math.floor(ts / 1000) : ts) : null,
  };
}

export function createReceiptLedger({
  storage = globalThis.localStorage,
  key = RECEIPTS_STORAGE_KEY,
  now = () => Date.now(),
  maxSeen = MAX_SEEN_PER_WALLET,
} = {}) {
  /** walletId -> { primedAt (s), checkpoint (s), seen: string[] } */
  let state = read();

  function read() {
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function write() {
    try { storage?.setItem?.(key, JSON.stringify(state)); } catch { /* memory only */ }
  }

  const nowS = () => Math.floor(now() / 1000);

  /**
   * The ledger's key for a decided payment. A send is kept apart from a
   * receive of the same id: a wallet paying its own invoice lists both
   * under one payment hash (LNbits), and the send must not hide the
   * receipt. A receive keeps its plain id, the one callers look up.
   */
  const keyOf = (r) => (r.isReceive ? r.id : `send:${r.id}`);

  /** Decided already, under its key or (a receive) under an earlier id. */
  function seenUnder(e, r) {
    if (e.seen.includes(keyOf(r))) return true;
    if (!r.isReceive && e.seen.includes(r.id)) return true; // a send saved before it had its own key
    return r.isReceive && r.aliases.some((id) => e.seen.includes(id));
  }

  function entry(walletId) {
    return state[walletId] || null;
  }

  function remember(e, id) {
    if (e.seen.includes(id)) return false;
    e.seen.push(id);
    if (e.seen.length > maxSeen) e.seen.splice(0, e.seen.length - maxSeen);
    return true;
  }

  return {
    isPrimed(walletId) {
      return !!entry(walletId);
    },

    /**
     * Seed a wallet's baseline from its current history without announcing
     * anything. Safe to call again: an already-primed wallet is untouched.
     */
    prime(walletId, payments = []) {
      if (entry(walletId)) return false;
      const t = nowS();
      const e = { primedAt: t, checkpoint: t, seen: [], pending: [] };
      for (const p of payments) {
        const r = receiptFromPayment(p);
        if (!r) continue;
        // A receive still pending at baseline is announced when it settles.
        if (r.status === 'pending' && r.isReceive) e.pending.push(r.id);
        else remember(e, keyOf(r));
      }
      state[walletId] = e;
      write();
      return true;
    },

    /**
     * Decide one payment. Returns the receipt to announce, or null.
     * @param {string} walletId
     * @param {object} payment  SDK Payment or mapped transaction row
     * @param {{ origin?: 'event'|'catchup', internal?: boolean }} [opts]
     */
    ingest(walletId, payment, { origin = 'event', internal = false } = {}) {
      const r = receiptFromPayment(payment);
      if (!r) return null;
      let e = entry(walletId);
      if (!e) {
        // A live event can arrive before the first catch-up primed the
        // wallet. It is new by definition; history read later is older.
        const t = nowS();
        e = state[walletId] = { primedAt: t, checkpoint: t, seen: [], pending: [] };
      }
      e.pending ||= [];
      // Not settled yet: neither announce nor mark seen, so the completion
      // event (or a later catch-up) can still decide it. Remembered as
      // pending, persisted: a receive created before the checkpoint that
      // settles much later (or after a restart) is still news then.
      if (r.status === 'pending') {
        if (r.isReceive && !e.pending.includes(r.id)) {
          e.pending.push(r.id);
          if (e.pending.length > MAX_PENDING_PER_WALLET) e.pending.splice(0, e.pending.length - MAX_PENDING_PER_WALLET);
          write();
        }
        return null;
      }
      if (seenUnder(e, r)) {
        // Known under an earlier id: the same payment, decided under this one too.
        if (remember(e, keyOf(r))) write();
        return null;
      }
      const wasPending = r.isReceive && e.pending.includes(r.id);
      if (wasPending) e.pending = e.pending.filter((id) => id !== r.id);
      // Settled sends and failed payments are remembered as decided (so a
      // catch-up can tell new activity from old) but never announced.
      if (!r.isReceive || r.status !== 'completed') {
        remember(e, keyOf(r));
        write();
        return null;
      }

      remember(e, r.id);
      // Only a completed catch-up pass moves the checkpoint (markCaughtUp):
      // a live event for a later payment must not hide an earlier one that
      // was missed while the app was away.
      const fromHistory = origin === 'catchup';
      const tooOld = fromHistory && !wasPending && r.timestamp != null && r.timestamp < e.checkpoint - CHECKPOINT_SLACK_S;
      write();

      if (tooOld || internal) return null;
      return { walletId, ...r, origin };
    },

    /**
     * Advance the checkpoint after a complete catch-up pass. Pass the time
     * the pass STARTED listing, so a payment landing mid-pass stays newer.
     */
    markCaughtUp(walletId, at = nowS()) {
      const e = entry(walletId);
      if (!e) return;
      if (at > e.checkpoint) e.checkpoint = at;
      write();
    },

    pendingIds(walletId) {
      return [...(entry(walletId)?.pending || [])];
    },

    /**
     * A receive another screen already announced (the Receive sheet's
     * own confirmation): decided now, so no later read announces it again.
     */
    markSeen(walletId, paymentId) {
      if (!walletId || !paymentId) return;
      const t = nowS();
      const e = (state[walletId] ||= { primedAt: t, checkpoint: t, seen: [], pending: [] });
      e.pending = (e.pending || []).filter((id) => id !== String(paymentId));
      if (remember(e, String(paymentId))) write();
    },

    /** True when the receive with this id has been decided. */
    isSeen(walletId, paymentId) {
      return !!entry(walletId)?.seen.includes(String(paymentId));
    },

    /** True when this payment, either direction, has been decided. */
    isDecided(walletId, payment) {
      const r = receiptFromPayment(payment);
      const e = r && entry(walletId);
      return !!e && seenUnder(e, r);
    },

    /**
     * True when ingesting this payment now could announce it: a settled
     * receive not decided yet. Asking "is it the user's own transfer?"
     * only then keeps a transfer's note from being used up by the pending
     * invoice it settles later.
     */
    couldAnnounce(walletId, payment) {
      const r = receiptFromPayment(payment);
      if (!r || !r.isReceive || r.status !== 'completed') return false;
      const e = entry(walletId);
      return !e || !seenUnder(e, r);
    },

    checkpoint(walletId) {
      return entry(walletId)?.checkpoint ?? null;
    },

    forget(walletId) {
      delete state[walletId];
      write();
    },

    clear() {
      state = {};
      write();
    },
  };
}

/** History is read this many payments at a time... */
export const HISTORY_PAGE_SIZE = 50;
/** ...and at most this many pages back, however long the wallet was away. */
export const HISTORY_MAX_PAGES = 10;

/** When the oldest payment of a page was made, by the order the wallet lists them in. */
function oldestListed(page) {
  const oldest = page[page.length - 1];
  return Number(oldest?.created_at ?? oldest?.timestamp ?? oldest?.settled_at ?? 0);
}

/**
 * Catch up one wallet: read its history newest first, a page at a time,
 * until the ledger's checkpoint is covered (bounded by `maxPages`), and
 * decide every payment through the ledger. The first read of a wallet
 * only primes its baseline. Shared by every wallet type: the Spark
 * lifecycle and services/walletWatch.
 *
 * @param {object} p
 * @param {ReturnType<typeof createReceiptLedger>} p.ledger
 * @param {string} p.walletId
 * @param {(offset: number, limit: number) => Promise<object[]>} p.readPage  newest first
 * @param {() => boolean} [p.isCurrent]  false once the wallet was removed or
 *   replaced mid-read: the pass stops and decides nothing
 * @param {(payment: object) => boolean} [p.isInternal]  the user's own transfer
 * @param {(receipt: object) => void} [p.deliver]
 * @returns {Promise<{ primed: boolean, announced: number, unseen: number } | null>}
 *   null when the wallet stopped being current; `unseen` counts settled
 *   payments the ledger had not decided before (activity it missed)
 */
export async function catchUpReceipts({
  ledger,
  walletId,
  readPage,
  isCurrent = () => true,
  isInternal = () => false,
  deliver = () => {},
  pageSize = HISTORY_PAGE_SIZE,
  maxPages = HISTORY_MAX_PAGES,
  now = () => Date.now(),
}) {
  const startedAt = Math.floor(now() / 1000);
  const primed = ledger.isPrimed(walletId);
  // Page back until the checkpoint is covered: a long absence on a busy
  // wallet can hold more than one page of payments.
  const floor = (ledger.checkpoint(walletId) ?? startedAt) - CHECKPOINT_SLACK_S;
  const history = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = (await readPage(page * pageSize, pageSize)) || [];
    if (!isCurrent()) return null;
    history.push(...batch);
    // A baseline needs only what is newest.
    if (!primed) break;
    const oldest = oldestListed(batch);
    if (batch.length < pageSize || !oldest || oldest < floor) break;
  }
  if (!primed) {
    ledger.prime(walletId, history);
    return { primed: true, announced: 0, unseen: 0 };
  }
  let announced = 0;
  let unseen = 0;
  for (const payment of history) {
    if (payment?.status !== 'pending' && !ledger.isDecided(walletId, payment)) unseen += 1;
    const internal = ledger.couldAnnounce(walletId, payment) && !!isInternal(payment);
    const receipt = ledger.ingest(walletId, payment, { origin: 'catchup', internal });
    if (receipt) {
      announced += 1;
      deliver(receipt);
    }
  }
  ledger.markCaughtUp(walletId, startedAt);
  return { primed: false, announced, unseen };
}

/**
 * Delivery policy for a detected receipt, kept apart from detection so local
 * events and a future push transport share one decision.
 *
 *  - Settled while the app was out of sight (it falls inside a recorded
 *    hidden interval, or the app is hidden right now): post a system
 *    notification even if the user has since returned. Without this a
 *    payment caught up after reopening the app was silently dropped.
 *  - Settled while the user was looking at the app: no system
 *    notification; the screen already shows it.
 *
 * @param {{ timestamp:number|null }} receipt
 * @param {{ hiddenNow:boolean, hiddenIntervals:Array<[number, number|null]> }} visibility
 *   intervals in unix seconds; an open interval has end null.
 * @returns {{ system: boolean }}
 */
export function receiptDelivery(receipt, { hiddenNow = false, hiddenIntervals = [] } = {}) {
  if (hiddenNow) return { system: true };
  const ts = receipt?.timestamp;
  if (ts == null) return { system: false };
  const missed = hiddenIntervals.some(([start, end]) => ts >= start - 5 && (end == null || ts <= end + 5));
  return { system: missed };
}
