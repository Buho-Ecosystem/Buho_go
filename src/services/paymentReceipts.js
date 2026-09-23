/**
 * Which incoming payments has the user been told about?
 *
 * Detection used to be a guess from the balance: if it went up between two
 * readings, "you received the difference". That misses a receive that
 * overlaps a send (1,000 + 200 − 300 reads as 900: nothing announced), gets
 * the amount wrong whenever anything else moved, and has no memory — so a
 * payment that landed while the app was suspended was either lost or, after
 * a restart, indistinguishable from the old balance.
 *
 * This module works on payments instead. Every settled receive is keyed by
 * (wallet, payment id) and announced at most once, whichever way it is first
 * seen — a live SDK event, the history catch-up after resume/reconnect, or a
 * replay after restart. State is persisted and bounded:
 *
 *   { [walletId]: { baselineAt, lastCatchupAt, seen, seenAt, pending } }
 *
 *   baselineAt     unix seconds when this device started watching the
 *                  wallet. Anything that settled before it is history (a
 *                  restore's initial sync replays the whole past as events;
 *                  none of it is news).
 *   lastCatchupAt  unix seconds of the last completed history catch-up; the
 *                  next one starts a little before it (overlap, deduped).
 *   seen / seenAt  IDs retained throughout the timestamp overlap window.
 *   pending        IDs to recheck even after their creation time leaves it.
 *
 * Detection is kept apart from delivery: `deliver` is injected, so the same
 * reconciliation can drive local notifications today and a push transport
 * later (#276) without re-deciding what is new.
 *
 * Own transfers with a receiving invoice hash register that identity before
 * paying. Matching receives are not announced. Unidentified Spark transfers
 * are not suppressed: an amount is not a payment identity.
 */

export const PAYMENT_RECEIPTS_STORAGE_KEY = 'buhoGO_payment_receipts_v1';

/** Catch-up re-reads this far before the last pass; duplicates are dropped. */
export const CATCHUP_OVERLAP_S = 10 * 60;
/** How long an expected own-transfer receipt stays claimable. */
export const INTERNAL_EXPECTATION_MS = 3 * 60 * 1000;



/** SDK amounts are bigint; everything here is plain sats. */
function toSats(value) {
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} [opts]
 * @param {Storage-like} [opts.storage]
 * @param {() => number} [opts.now]          ms clock
 * @param {(payment) => string|null} [opts.paymentHashOf]
 * @param {(receipt) => (void|Promise)} [opts.deliver]
 *        receipt: { walletId, paymentId, amountSats, timestamp, source, context }
 */
export function createPaymentReceipts({
  storage = globalThis.localStorage,
  key = PAYMENT_RECEIPTS_STORAGE_KEY,
  now = () => Date.now(),
  paymentHashOf = () => null,
  deliver = () => {},
} = {}) {
  let state = read();
  /** walletId -> [{ paymentHash, expiresAt }] — memory only. */
  const expected = new Map();

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
    const e = state[walletId];
    if (!e || !Array.isArray(e.seen)) return null;
    // Upgrade v1 in place. Old IDs stay through one overlap window.
    e.seenAt ||= Object.fromEntries(e.seen.map(id => [id, nowS()]));
    e.pending ||= [];
    return e;
  }

  const floorOf = e => Math.max(e.baselineAt, (e.lastCatchupAt || e.baselineAt) - CATCHUP_OVERLAP_S);

  function markSeen(e, paymentId, timestamp) {
    e.seen.push(paymentId);
    e.seenAt[paymentId] = timestamp || nowS();
  }

  function takeInternal(walletId, payment) {
    const list = expected.get(walletId);
    if (!list?.length) return false;
    const t = now();
    const live = list.filter(x => x.expiresAt > t);
    const hash = paymentHashOf(payment);
    const index = hash ? live.findIndex(x => x.paymentHash && x.paymentHash === hash) : -1;
    if (index !== -1) live.splice(index, 1);
    if (live.length) expected.set(walletId, live); else expected.delete(walletId);
    return index !== -1;
  }

  return {
    /**
     * Start watching a wallet. Idempotent: the first call fixes the
     * baseline, so everything that settled before it stays history.
     * @returns {boolean} true when the wallet was new to this device
     */
    ensureBaseline(walletId) {
      if (!walletId || entry(walletId)) return false;
      state[walletId] = { baselineAt: nowS(), lastCatchupAt: null, seen: [], seenAt: {}, pending: [] };
      write();
      return true;
    },

    /** Where the next history catch-up should start (unix seconds). */
    catchUpFrom(walletId) {
      const e = entry(walletId);
      if (!e) return nowS();
      const from = e.lastCatchupAt ? e.lastCatchupAt - CATCHUP_OVERLAP_S : e.baselineAt;
      return Math.max(e.baselineAt, from);
    },

    /** Record a completed catch-up pass that started at `startedAtS`. */
    markCaughtUp(walletId, startedAtS = nowS()) {
      const e = entry(walletId);
      if (!e) return;
      e.lastCatchupAt = Math.max(e.lastCatchupAt || 0, startedAtS);
      // Never evict IDs still inside the query's overlap window. A fixed
      // 300-ID FIFO re-announced a busy wallet's payments on every pass.
      const floor = floorOf(e);
      e.seen = e.seen.filter(id => {
        if (e.seenAt[id] >= floor) return true;
        delete e.seenAt[id];
        return false;
      });
      write();
    },

    /**
     * An own transfer is about to land in `walletId`. Match it by invoice
     * hash when there is one. An amount alone cannot identify a transfer
     * and would hide unrelated payments of the same amount.
     */
    expectInternal(walletId, { paymentHash = null } = {}) {
      if (!walletId || !paymentHash) return;
      const list = expected.get(walletId) || [];
      list.push({ paymentHash, expiresAt: now() + INTERNAL_EXPECTATION_MS });
      expected.set(walletId, list);
    },

    /**
     * Decide about one payment and deliver it if it is news.
     * @returns {Promise<'delivered'|'ignored'|'duplicate'|'historical'|'internal'|'untracked'>}
     */
    async observe(walletId, payment, { source = 'event', context = null } = {}) {
      if (!walletId || !payment?.id) return 'ignored';
      if (payment.paymentType !== 'receive' || payment.method === 'token' || payment.details?.type === 'token') return 'ignored';
      const e = entry(walletId);
      if (!e) return 'untracked';
      if (e.seen.includes(payment.id)) return 'duplicate';
      const wasPending = e.pending.includes(payment.id);
      if (payment.status === 'pending') {
        if (!wasPending) { e.pending.push(payment.id); write(); }
        return 'ignored';
      }
      if (payment.status !== 'completed') {
        e.pending = e.pending.filter(id => id !== payment.id);
        write();
        return 'ignored';
      }
      const timestamp = Number(payment.timestamp) || 0;
      e.pending = e.pending.filter(id => id !== payment.id);
      if (!wasPending && timestamp && timestamp < floorOf(e)) {
        write();
        return 'historical';
      }
      markSeen(e, payment.id, wasPending ? nowS() : timestamp);
      write();

      const amountSats = toSats(payment.amount);
      if (takeInternal(walletId, payment)) return 'internal';

      try {
        await deliver({ walletId, paymentId: payment.id, amountSats, timestamp, source, context });
      } catch (err) {
        console.warn('[receipts] delivery failed:', err?.message || err);
      }
      return 'delivered';
    },

    pendingIds(walletId) {
      return [...(entry(walletId)?.pending || [])];
    },

    forget(walletId) {
      delete state[walletId];
      expected.delete(walletId);
      write();
    },

    clear() {
      state = {};
      expected.clear();
      write();
    },

    /** Test/diagnostic view. */
    snapshot(walletId) {
      const e = entry(walletId);
      return e ? { ...e, seen: [...e.seen] } : null;
    },
  };
}
