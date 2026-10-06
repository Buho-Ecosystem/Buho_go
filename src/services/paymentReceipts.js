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

export const RECEIPTS_STORAGE_KEY = 'buhoGO_payment_receipts_v1';
export const MAX_SEEN_PER_WALLET = 400;
/** Clock skew tolerated between the device and payment timestamps. */
export const CHECKPOINT_SLACK_S = 120;

/**
 * Normalize an SDK Payment or a mapped transaction row into
 * { id, isReceive, status, amountSats, timestamp (unix s) }.
 */
export function receiptFromPayment(payment) {
  if (!payment || payment.id == null) return null;
  const kind = payment.paymentType ?? payment.type;
  const isReceive = kind === 'receive' || kind === 'incoming';
  // An SDK Payment carries the net amount; a mapped row carries gross
  // (net + fee). A receive's fee is the receiver's, so net = gross - fee.
  const raw = Number(payment.amount ?? 0);
  const fee = Number(payment.fees ?? payment.fee ?? 0);
  const isMappedRow = payment.paymentType === undefined && payment.fees === undefined;
  const amountSats = Math.max(0, Math.round(isMappedRow ? raw - fee : raw));
  const ts = Number(payment.timestamp ?? payment.settled_at ?? 0);
  return {
    id: String(payment.id),
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
      const e = { primedAt: t, checkpoint: t, seen: [] };
      for (const p of payments) {
        const r = receiptFromPayment(p);
        if (r) remember(e, r.id);
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
        e = state[walletId] = { primedAt: t, checkpoint: t, seen: [] };
      }
      // Not settled yet: neither announce nor remember, so the completion
      // event (or the next catch-up) can still decide it.
      if (r.status === 'pending') return null;
      if (e.seen.includes(r.id)) return null;
      // Settled sends and failed payments are remembered as decided (so a
      // catch-up can tell new activity from old) but never announced.
      if (!r.isReceive || r.status !== 'completed') {
        remember(e, r.id);
        write();
        return null;
      }

      remember(e, r.id);
      // Only a completed catch-up pass moves the checkpoint (markCaughtUp):
      // a live event for a later payment must not hide an earlier one that
      // was missed while the app was away.
      const fromHistory = origin === 'catchup';
      const tooOld = fromHistory && r.timestamp != null && r.timestamp < e.checkpoint - CHECKPOINT_SLACK_S;
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

    isSeen(walletId, paymentId) {
      return !!entry(walletId)?.seen.includes(String(paymentId));
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
