/**
 * Home's latest-payment preview. Detection and notification delivery stay with
 * their existing owners; this controller only reconciles verified activity
 * with history. Every read belongs to one wallet selection and owner, and all
 * waiting (including metadata) is bounded. The UI expresses `receipt` with
 * motion and `unavailable` as a static confirmed receipt, never an unpaid invoice.
 */
import { normalizeTx } from './txNormalizer.js';
import { paymentTimeMs } from './recipientPayments.js';
import { readCachedTransactions, mergeCachedTransactions } from '../utils/txCache.js';

export const PREVIEW_READ_TIMEOUT_MS = 4000;
export const PREVIEW_METADATA_TIMEOUT_MS = 750;
export const PREVIEW_RECONCILE_MS = 15000;
export const PREVIEW_RETRY_MS = [250, 750, 1500, 3000];

const unavailable = (error) => ['RESTRICTED', 'NOT_IMPLEMENTED', 'UNAUTHORIZED'].includes(error?.code);
const completed = (row) => row?.status === 'completed';
// Observation is only an upper bound on when receipt settlement happened.
// It can prove a later send is newer, but must never become a row timestamp.
const receiptUpperBound = (value) => value?.settledAt || value?.observedAt || null;
const canonicalId = (id) => /^[a-f\d]{64}$/i.test(String(id)) ? String(id).toLowerCase() : String(id);

/** Payment identity only: equal amounts or timestamps never identify a payment. */
export function previewPaymentKeys(value) {
  if (!value) return [];
  return [...new Set([
    value.paymentId ?? value.id,
    value.paymentHash ?? value.payment_hash,
    ...(Array.isArray(value.aliases) ? value.aliases : []),
  ].filter((id) => id != null && id !== '').map(canonicalId))];
}

export function previewMatchesReceipt(row, receipt) {
  if (row?.type !== 'incoming' || !completed(row)) return false;
  const keys = new Set(previewPaymentKeys(receipt));
  return keys.size > 0 && previewPaymentKeys(row).some((key) => keys.has(key));
}

function samePayment(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const keys = new Set(previewPaymentKeys(a));
  return previewPaymentKeys(b).some((key) => keys.has(key));
}

function eligible(row) {
  if (!row || ['failed', 'expired'].includes(row.status)) return false;
  // An invoice listed as pending proves only that a request exists. Only an
  // explicit provider funds signal could make a pending receive a preview.
  return row.type !== 'incoming' || row.status !== 'pending' || row.fundsPending === true;
}

function ordered(rows) {
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => paymentTimeMs(b.row) - paymentTimeMs(a.row) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * readHistory(context, { receipt }) must throw on failure: [] means successfully
 * empty. Receipt is a detached identity snapshot for exact lookup when list
 * timestamps describe invoice creation rather than settlement.
 * `owner`, `wallet`, and optional `epoch` identify the selected lifetime.
 * `isCurrent` covers replacement before the host's reactive watcher runs.
 * prepareTransactions may enrich metadata; normalizeRow reads the resulting
 * metadata. Neither callback may publish preview state itself.
 */
export function createLatestTransactionPreview({
  readHistory,
  prepareTransactions = async () => {},
  normalizeRow = (raw, context) => normalizeTx(raw, { walletType: context.walletType }),
  readCache = readCachedTransactions,
  writeCache = mergeCachedTransactions,
  onChange = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  readTimeoutMs = PREVIEW_READ_TIMEOUT_MS,
  metadataTimeoutMs = PREVIEW_METADATA_TIMEOUT_MS,
  reconcileMs = PREVIEW_RECONCILE_MS,
  retryMs = PREVIEW_RETRY_MS,
} = {}) {
  let context = null;
  let generation = 0;
  let activityVersion = 0;
  let arrival = 0;
  let disposed = false;
  let running = null;
  let followUp = false;
  let retryTimer = null;
  let deadlineTimer = null;
  let receipt = null;
  let receiptResolved = false;
  let receiptDeadline = 0;
  let retryIndex = 0;
  const waits = new Set();
  // Runtime only, bounded: a repeated source signal cannot replay arrival.
  const seen = [];
  let state = { walletId: null, phase: 'empty', transaction: null, receipt: null, arrivalKey: 0, busy: false, error: null };

  const current = (gen = generation) => !disposed && gen === generation && context?.isCurrent?.() !== false;
  const publish = (patch) => {
    if (!current()) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const stopRetry = () => { if (retryTimer != null) clearTimer(retryTimer); retryTimer = null; };
  const stopDeadline = () => { if (deadlineTimer != null) clearTimer(deadlineTimer); deadlineTimer = null; };
  const cancelWaits = () => { for (const cancel of [...waits]) cancel(); };

  function bounded(work, ms) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;
      const finish = (fn, result) => {
        if (finished) return;
        finished = true;
        if (timer != null) clearTimer(timer);
        waits.delete(cancel);
        fn(result);
      };
      const cancel = () => finish(reject, Object.assign(new Error('Preview read superseded'), { code: 'SUPERSEDED' }));
      waits.add(cancel);
      timer = setTimer(() => finish(reject, Object.assign(new Error('Preview read timed out'), { code: 'TIMEOUT' })), Math.max(0, ms));
      Promise.resolve().then(work).then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  }

  function settleUnavailable(error = 'unavailable') {
    stopRetry();
    stopDeadline();
    if (receipt && !receiptResolved) publish({ phase: 'unavailable', receipt, busy: false, error });
    else publish({ phase: state.transaction ? 'ready' : 'empty', busy: false, error });
  }

  function startDeadline(until = now() + reconcileMs) {
    stopDeadline();
    receiptDeadline = until;
    if (receipt?._entry) receipt._entry.deadline = until;
    if (until <= now()) return settleUnavailable('timeout');
    deadlineTimer = setTimer(() => {
      deadlineTimer = null;
      settleUnavailable('timeout');
    }, until - now());
  }

  function scheduleRetry() {
    if (!receipt || receiptResolved || state.phase === 'unavailable' || !current()) return;
    const remaining = receiptDeadline - now();
    if (remaining <= 0) return settleUnavailable('timeout');
    stopRetry();
    const delay = retryMs[Math.min(retryIndex++, retryMs.length - 1)] ?? 1000;
    retryTimer = setTimer(() => { retryTimer = null; refresh(); }, Math.min(delay, remaining));
  }

  function normalizeRows(rawRows, selected) {
    return ordered(rawRows.map((raw) => {
      // Settlement proof may be newer than the invoice-created list time.
      // Enrich only its exact row, never an amount-based guess.
      const normalized = { ...normalizeRow(raw, selected),
        ...(Array.isArray(raw?.aliases) ? { aliases: raw.aliases } : {}),
        ...(raw?.fundsPending === true ? { fundsPending: true } : {}),
      };
      if (receipt?.settledAt && previewMatchesReceipt(normalized, receipt)) {
        // An exact provider lookup can carry the real settlement time while
        // the activity's timestamp was only its invoice-created list time.
        return { ...normalized, settled_at: Math.max(paymentTimeMs(normalized), receipt.settledAt) / 1000 };
      }
      return normalized;
    }));
  }

  async function run(token) {
    const selected = context;
    const version = activityVersion;
    const { _entry, ...receiptSnapshot } = receipt || {};
    if (Array.isArray(receiptSnapshot.aliases)) receiptSnapshot.aliases = [...receiptSnapshot.aliases];
    const owns = () => current(token.generation) && running === token;
    try {
      // Exact lookup is for unresolved activity only. LNbits updated_at can
      // move on metadata edits after settlement; polling that old receipt
      // forever would incorrectly promote it above a later send.
      const result = await bounded(() => readHistory(selected, { receipt: receipt && !receiptResolved ? receiptSnapshot : null }), readTimeoutMs);
      if (!owns() || version !== activityVersion) return;
      if (result?.unsupported) return settleUnavailable('unsupported');
      const rawRows = Array.isArray(result) ? result : result?.rows;
      if (!Array.isArray(rawRows)) throw new Error('Invalid preview history response');
      // Metadata is useful presentation, not a reason to withhold a real row.
      try { await bounded(() => prepareTransactions(rawRows, selected, owns), metadataTimeoutMs); } catch { /* use available metadata */ }
      if (!owns() || version !== activityVersion) return;
      const allRows = normalizeRows(rawRows, selected);
      const rows = allRows.filter(eligible);
      const latest = rows[0] || null;
      const match = receipt && rows.find((row) => previewMatchesReceipt(row, receipt));
      // Unidentified receipts cannot be attached to a history row by amount.
      // Keep their known summary until a matching identity is available.
      const bound = receiptUpperBound(receipt);
      const newer = bound && latest && paymentTimeMs(latest) > bound;
      // An older LNbits server may not expose settlement time even on the
      // exact lookup. Its invoice-created time cannot decide whether a send
      // really happened afterward. Keep the verified receipt summary rather
      // than silently resolving it to an ambiguously ordered previous send.
      if (receipt && !receiptResolved && result?.receiptOrderingUnknown && match && latest !== match && !newer) {
        scheduleRetry();
        return;
      }
      if (receipt && !receiptResolved && !match && !newer) {
        scheduleRetry();
        return;
      }
      if (receipt && (match || newer)) {
        receiptResolved = true;
        stopRetry();
        stopDeadline();
      }
      // A provider still serving a pre-receipt snapshot cannot erase the
      // completed row already reconciled for that confirmed payment.
      const currentStillListed = rows.some((row) => samePayment(row, state.transaction));
      if (receiptResolved && state.transaction && (!latest
        || paymentTimeMs(latest) < paymentTimeMs(state.transaction)
        || (!currentStillListed && paymentTimeMs(latest) === paymentTimeMs(state.transaction)))) {
        publish({ phase: 'ready', receipt: null, busy: false, error: null });
        return;
      }
      // History shares this cache and still needs unpaid/expired invoices.
      // Filtering them belongs to the preview, never the persisted list.
      try { writeCache(selected.walletId, allRows); } catch { /* display still succeeds when storage cannot */ }
      publish({ phase: latest ? 'ready' : 'empty', transaction: latest, receipt: null, busy: false, error: null });
    } catch (error) {
      if (!owns() || error?.code === 'SUPERSEDED' || version !== activityVersion) return;
      if (unavailable(error)) settleUnavailable('unsupported');
      else if (receipt && !receiptResolved && state.phase !== 'unavailable') scheduleRetry();
      else settleUnavailable(error?.code === 'TIMEOUT' ? 'timeout' : 'failed');
    } finally {
      if (running === token) {
        running = null;
        if (followUp && current(token.generation)) { followUp = false; refresh(); }
      }
    }
  }

  function refresh() {
    if (!context?.walletId || !current()) return Promise.resolve();
    stopRetry();
    if (running) { followUp = true; return running.promise; }
    const token = { generation };
    running = token;
    token.promise = run(token);
    return token.promise;
  }

  function select(next) {
    if (disposed) return;
    if (context?.walletId === next?.walletId && context?.wallet === next?.wallet && context?.owner === next?.owner && context?.epoch === next?.epoch) {
      context = next;
      return;
    }
    generation++;
    stopRetry();
    stopDeadline();
    cancelWaits();
    running = null;
    followUp = false;
    receipt = null;
    receiptResolved = false;
    context = next?.walletId ? next : null;
    let cached = [];
    try { cached = context ? ordered(readCache(context.walletId) || []).filter(eligible) : []; } catch { /* unavailable cache */ }
    state = { walletId: context?.walletId || null, phase: context ? (cached[0] ? 'ready' : 'initial') : 'empty', transaction: cached[0] || null, receipt: null, arrivalKey: 0, busy: false, error: null };
    onChange(state);
  }

  function receive(activity, { replayArrival = true } = {}) {
    if (!current() || !activity || activity.walletId !== context?.walletId) return false;
    if (activity.amountSats != null && (!Number.isSafeInteger(activity.amountSats) || activity.amountSats <= 0)) return false;
    const keys = previewPaymentKeys(activity);
    const duplicate = seen.find((entry) => entry.walletId === activity.walletId && (
      keys.some((key) => entry.keys.includes(key)) || (activity.sequence != null && entry.sequence === activity.sequence)
    ));
    if (duplicate) {
      const enriched = keys.some((key) => !duplicate.keys.includes(key))
        || (receipt?._entry === duplicate && (activity.amountSats !== receipt.amountSats
          || (activity.settledAt && activity.settledAt !== receipt.settledAt)));
      duplicate.keys = [...new Set([...duplicate.keys, ...keys])];
      // An enriched repeat can supply the missing exact identity, but never
      // resets arrival or extends the reconciliation deadline.
      if (receipt && duplicate === receipt._entry && enriched) {
        receipt = { ...receipt, ...activity, aliases: [...new Set([...(receipt.aliases || []), ...(activity.aliases || []), ...duplicate.keys])], _entry: duplicate };
        activityVersion++;
        if (!receiptResolved) { publish({ receipt }); refresh(); }
      } else if (!receipt && !previewMatchesReceipt(state.transaction, activity)
        && !(receiptUpperBound(activity) && state.transaction && paymentTimeMs(state.transaction) > receiptUpperBound(activity))) {
        // A switch back can restore unresolved activity without replaying its
        // arrival. Its original deadline still applies while another wallet
        // was selected; a stale seed never starts a fresh success animation.
        receipt = { ...activity, _entry: duplicate };
        receiptResolved = false;
        activityVersion++;
        const until = duplicate.deadline || (activity.observedAt || now()) + reconcileMs;
        if (until > now()) {
          publish({ phase: 'receipt', receipt, busy: true, error: null });
          startDeadline(until);
        } else settleUnavailable('timeout');
        refresh();
      }
      return false;
    }
    const observedAt = Number(activity.observedAt);
    const entry = { walletId: activity.walletId, keys, sequence: activity.sequence,
      deadline: Number.isFinite(observedAt) && observedAt > 0 ? Math.min(now(), observedAt) + reconcileMs : now() + reconcileMs };
    seen.push(entry);
    if (seen.length > 100) seen.shift();
    if (receipt?.settledAt && activity.settledAt && activity.settledAt < receipt.settledAt) { refresh(); return true; }
    receipt = { ...activity, _entry: entry };
    receiptResolved = previewMatchesReceipt(state.transaction, receipt)
      || !!(receiptUpperBound(receipt) && state.transaction && paymentTimeMs(state.transaction) > receiptUpperBound(receipt));
    activityVersion++;
    retryIndex = 0;
    if (!receiptResolved) {
      if (entry.deadline > now()) {
        if (replayArrival) arrival++;
        publish({ phase: 'receipt', receipt, arrivalKey: replayArrival ? arrival : 0, busy: true, error: null });
        startDeadline(entry.deadline);
      } else settleUnavailable('timeout');
    } else {
      stopDeadline();
      publish({ phase: state.transaction ? 'ready' : 'empty', receipt: null, busy: false, error: null });
    }
    refresh();
    return true;
  }

  function retry() {
    if (!current()) return Promise.resolve();
    if (receipt && !receiptResolved) {
      retryIndex = 0;
      startDeadline();
      publish({ phase: 'receipt', receipt, busy: true, error: null });
    }
    return refresh();
  }

  function dispose() {
    disposed = true;
    generation++;
    stopRetry();
    stopDeadline();
    cancelWaits();
    running = null;
    followUp = false;
    seen.length = 0;
  }

  return { select, receive, refresh, retry, dispose, getState: () => state };
}
