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
 *   { [walletId]: { baselineAt, lastCatchupAt, seen: [paymentId, …] } }
 *
 *   baselineAt     unix seconds when this device started watching the
 *                  wallet. Anything that settled before it is history (a
 *                  restore's initial sync replays the whole past as events;
 *                  none of it is news).
 *   lastCatchupAt  unix seconds of the last completed history catch-up; the
 *                  next one starts a little before it (overlap, deduped).
 *   seen           FIFO of announced/decided payment ids.
 *
 * Detection is kept apart from delivery: `deliver` is injected, so the same
 * reconciliation can drive local notifications today and a push transport
 * later (#276) without re-deciding what is new.
 *
 * Own transfers: a transfer between the user's own wallets is not "money
 * received" — they just did it, and the transfer screen confirms it. The
 * transfer registers the receipt it expects (expectInternal) before paying;
 * the matching receive is recorded as seen and not delivered.
 */

export const PAYMENT_RECEIPTS_STORAGE_KEY = 'buhoGO_payment_receipts_v1';

/** Catch-up re-reads this far before the last pass; duplicates are dropped. */
export const CATCHUP_OVERLAP_S = 10 * 60;
/** How long an expected own-transfer receipt stays claimable. */
export const INTERNAL_EXPECTATION_MS = 3 * 60 * 1000;

const DEFAULT_MAX_SEEN = 300;

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
  maxSeen = DEFAULT_MAX_SEEN,
} = {}) {
  let state = read();
  /** walletId -> [{ paymentHash, amountSats, expiresAt }] — memory only. */
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
    return e;
  }

  function markSeen(e, paymentId) {
    e.seen.push(paymentId);
    while (e.seen.length > maxSeen) e.seen.shift();
  }

  function takeInternal(walletId, payment, amountSats) {
    const list = expected.get(walletId);
    if (!list?.length) return false;
    const t = now();
    const live = list.filter(x => x.expiresAt > t);
    const hash = paymentHashOf(payment);
    let index = hash ? live.findIndex(x => x.paymentHash && x.paymentHash === hash) : -1;
    if (index === -1) index = live.findIndex(x => !x.paymentHash && x.amountSats === amountSats);
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
      state[walletId] = { baselineAt: nowS(), lastCatchupAt: null, seen: [] };
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
      write();
    },

    /**
     * An own transfer is about to land in `walletId`. Match it by invoice
     * hash when there is one, otherwise by exact amount within a short
     * window (Spark-address transfers carry no hash).
     */
    expectInternal(walletId, { paymentHash = null, amountSats = null } = {}) {
      if (!walletId || (!paymentHash && !Number.isFinite(amountSats))) return;
      const list = expected.get(walletId) || [];
      list.push({ paymentHash, amountSats: Number.isFinite(amountSats) ? amountSats : null, expiresAt: now() + INTERNAL_EXPECTATION_MS });
      expected.set(walletId, list);
    },

    /**
     * Decide about one payment and deliver it if it is news.
     * @returns {Promise<'delivered'|'ignored'|'duplicate'|'historical'|'internal'|'untracked'>}
     */
    async observe(walletId, payment, { source = 'event', context = null } = {}) {
      if (!walletId || !payment?.id) return 'ignored';
      // Only a settled receive is money received. Pending ones may still
      // settle and will be seen again then; they are not marked.
      if (payment.paymentType !== 'receive' || payment.status !== 'completed') return 'ignored';
      const e = entry(walletId);
      if (!e) return 'untracked';
      if (e.seen.includes(payment.id)) return 'duplicate';

      const timestamp = Number(payment.timestamp) || 0;
      markSeen(e, payment.id);
      write();

      if (timestamp && timestamp < e.baselineAt) return 'historical';

      const amountSats = toSats(payment.amount);
      if (takeInternal(walletId, payment, amountSats)) return 'internal';

      try {
        await deliver({ walletId, paymentId: payment.id, amountSats, timestamp, source, context });
      } catch (err) {
        console.warn('[receipts] delivery failed:', err?.message || err);
      }
      return 'delivered';
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
