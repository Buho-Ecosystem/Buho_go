/**
 * Application-owned Spark lifecycle, one coordinator per wallet id (#292).
 *
 * Synchronization used to belong to whichever page was mounted (the home
 * screen's 30 s tick, the Receive sheet's invoice watcher) and to whichever
 * wallet was selected. A wallet on another page, the unselected half of the
 * Business/Personal pair, or any wallet after a background/network blip
 * waited for a page timer — and a provider could stay "connected" while its
 * stream was dead. This coordinator owns, per Spark wallet:
 *
 *  - connection and SDK event subscription health (re-attached when the
 *    registry rebuilds an instance),
 *  - fresh synchronization (provider.getBalance → syncWallet, #291), with
 *    the result written through the store's canonical balance state (#293),
 *  - catch-up of missed payment history into the receipt ledger (#295),
 *  - deposit discovery and processing for that wallet (#294),
 *  - the wallet's exit kit refresh after activity.
 *
 * Triggers: start, native resume, browser visibility, network restoration,
 * a foreground timer, SDK events, and explicit requests (wallet switch,
 * user refresh). Overlapping triggers per wallet coalesce into one run plus
 * at most one follow-up. Failures retry with backoff; a rebuild
 * (forceReinit) happens only after repeated failures and at most once per
 * REBUILD_MIN_INTERVAL_MS. Every run is bound to a wallet generation, so a
 * removed or replaced wallet's late result is dropped.
 *
 * What this cannot do: run while the OS has suspended or killed the app.
 * Delivery in that state is #276 (push/wake), not this module.
 *
 * Everything external is injected, so the scheduling logic is testable in
 * plain Node (see __tests__/sparkLifecycle.spec.js).
 */

export const HEALTH = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
});

export const FOREGROUND_INTERVAL_MS = 60 * 1000;
export const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000];
export const REBUILD_AFTER_FAILURES = 3;
export const REBUILD_MIN_INTERVAL_MS = 5 * 60 * 1000;
const DIAGNOSTICS_MAX = 120;

/** Triggers worth a follow-up run when they land during an in-flight run. */
const URGENT = new Set(['resume', 'online', 'visible', 'user', 'switch', 'event']);

export function createSparkLifecycle({
  store,
  subscribe = () => () => {},
  peekEntry = () => null,
  ledger = null,
  deliverReceipt = () => {},
  processDeposits = async () => {},
  onActivity = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  log = () => {},
  syncTimeoutMs = 20000,
  /** Did Spark answer recently? Gate for the SDK's unconditional `synced`. */
  syncedEventVerified = () => true,
  historyLimit = 50,
} = {}) {
  /** walletId -> per-wallet record */
  const wallets = new Map();
  const diagnostics = [];
  let foregroundTimer = null;
  let started = false;

  function record(walletId) {
    let r = wallets.get(walletId);
    if (!r) {
      r = {
        walletId,
        generation: 0,
        health: HEALTH.DISCONNECTED,
        failures: 0,
        lastSyncAt: null,
        lastError: null,
        inflight: null,
        rerun: null,
        retryTimer: null,
        lastRebuildAt: 0,
        subscribedEntry: null,
        unsubscribe: null,
      };
      wallets.set(walletId, r);
    }
    return r;
  }

  function diag(walletId, event, extra = {}) {
    // Redacted: wallet ids are shortened; no balances, addresses or payment
    // ids leave this buffer.
    const entry = { t: now(), w: String(walletId || '').slice(-6), event, ...extra };
    diagnostics.push(entry);
    if (diagnostics.length > DIAGNOSTICS_MAX) diagnostics.shift();
    log(entry);
  }

  const sparkIds = () => (store.sparkWallets || []).map((w) => w.id);
  const exists = (walletId) => sparkIds().includes(walletId);
  const isCurrent = (r, gen) => r.generation === gen && exists(r.walletId);

  function setHealth(r, health, error = null) {
    r.health = health;
    r.lastError = error;
    store.setSparkHealthState?.(r.walletId, { health, lastSyncAt: r.lastSyncAt, error, failures: r.failures });
  }

  // ---- SDK events -------------------------------------------------------

  function ensureSubscribed(r) {
    const entry = peekEntry(r.walletId);
    if (!entry) return false;
    if (r.subscribedEntry === entry && r.unsubscribe) return true;
    try { r.unsubscribe?.(); } catch { /* old instance gone */ }
    const gen = r.generation;
    r.unsubscribe = subscribe(r.walletId, (event) => onSdkEvent(r, gen, event));
    r.subscribedEntry = entry;
    diag(r.walletId, 'subscribed');
    return true;
  }

  function onSdkEvent(r, gen, event) {
    if (!isCurrent(r, gen) || !event?.type) return;
    switch (event.type) {
      case 'synced':
        // The SDK's background loop finished a sync pass. Breez emits this
        // even when its requests failed, so it counts only when Spark
        // demonstrably answered; otherwise it is ignored here and the next
        // reconcile measures for itself.
        if (!syncedEventVerified()) break;
        r.lastSyncAt = now();
        r.failures = 0;
        store.noteSparkNetworkSync?.(r.walletId, r.lastSyncAt);
        setHealth(r, HEALTH.HEALTHY);
        publishCachedBalance(r, gen, 'event');
        break;
      case 'paymentSucceeded':
      case 'paymentFailed':
      case 'paymentPending': {
        if (ledger && event.payment) {
          const receipt = ledger.ingest(r.walletId, event.payment, {
            origin: 'event',
            internal: !!store.isInternalTransferReceipt?.(r.walletId, event.payment),
          });
          if (receipt) deliverReceipt(receipt);
        }
        publishCachedBalance(r, gen, 'event');
        onActivity(r.walletId, event.type);
        break;
      }
      case 'claimedDeposits':
        publishCachedBalance(r, gen, 'event');
        store.signalDepositsRefresh?.(r.walletId);
        onActivity(r.walletId, event.type);
        break;
      case 'newDeposits':
      case 'unclaimedDeposits':
        trigger('event', [r.walletId]);
        break;
      default:
        break;
    }
  }

  /** After an SDK event the local cache reflects the network; publish it. */
  async function publishCachedBalance(r, gen, source) {
    const provider = store.providers?.[r.walletId];
    if (!provider?.isConnected || typeof provider.getCachedBalance !== 'function') return;
    try {
      const result = await provider.getCachedBalance();
      if (!isCurrent(r, gen)) return;
      store.applyBalance?.(r.walletId, result.balance, { source, fresh: true });
    } catch { /* the next reconcile reads again */ }
  }

  // ---- Reconcile --------------------------------------------------------

  async function catchUpHistory(r, gen, provider) {
    if (!ledger || typeof provider.getTransactions !== 'function') return;
    const startedAt = Math.floor(now() / 1000);
    const history = await provider.getTransactions(0, historyLimit);
    if (!isCurrent(r, gen)) return;
    if (!ledger.isPrimed(r.walletId)) {
      ledger.prime(r.walletId, history);
      diag(r.walletId, 'receipts-primed', { n: history.length });
      return;
    }
    let announced = 0;
    let unseen = 0;
    for (const payment of history) {
      if (payment?.status !== 'pending' && ledger.isSeen && !ledger.isSeen(r.walletId, payment?.id)) unseen += 1;
      const receipt = ledger.ingest(r.walletId, payment, {
        origin: 'catchup',
        internal: !!store.isInternalTransferReceipt?.(r.walletId, payment),
      });
      if (receipt) { announced += 1; deliverReceipt(receipt); }
    }
    ledger.markCaughtUp(r.walletId, startedAt);
    if (announced) diag(r.walletId, 'receipts-caught-up', { n: announced });
    return unseen;
  }

  async function discoverDeposits(r, gen, provider) {
    if (typeof provider.getPendingDeposits !== 'function') return;
    const pending = await provider.getPendingDeposits();
    if (!isCurrent(r, gen)) return;
    const unclaimed = (pending || []).filter((d) => !store.isDepositClaimed?.(d.txId, d.outputIndex));
    store.setPendingDeposits?.(r.walletId, unclaimed);
    if (unclaimed.length) await processDeposits(unclaimed, r.walletId);
  }

  async function runOnce(r, reason) {
    const gen = r.generation;
    const t0 = now();
    diag(r.walletId, 'run', { reason });
    try {
      // 1. Connection.
      let provider = store.providers?.[r.walletId];
      if (!provider?.isConnected || !store.connectionStates?.[r.walletId]?.connected) {
        setHealth(r, HEALTH.CONNECTING);
        store.markBalanceRefresh?.(r.walletId, true);
        await store.connectSparkWallet(r.walletId);
        if (!isCurrent(r, gen)) return;
        provider = store.providers?.[r.walletId];
        if (!provider) throw new Error('Spark wallet did not connect');
      }
      const subscribed = ensureSubscribed(r);

      // 2. Fresh synchronization, published through canonical state.
      setHealth(r, HEALTH.SYNCING);
      store.markBalanceRefresh?.(r.walletId, true);
      const before = store.balanceStates?.[r.walletId]?.value ?? null;
      const result = await provider.getBalance({ timeoutMs: syncTimeoutMs });
      if (!isCurrent(r, gen)) return;
      store.applyBalance?.(r.walletId, result.balance, {
        source: result.fresh === false ? 'cache' : 'sync',
        fresh: result.fresh !== false,
        error: result.syncError || null,
      });
      if (result.fresh === false) throw Object.assign(new Error(result.syncError || 'sync failed'), { code: 'SPARK_STALE' });

      r.lastSyncAt = result.syncedAt || now();
      r.failures = 0;
      clearRetry(r);
      setHealth(r, subscribed ? HEALTH.HEALTHY : HEALTH.DEGRADED, subscribed ? null : 'no event stream');

      // 3. Missed history and deposits, then the exit kit — refreshed only
      // when this pass found activity the event stream did not deliver
      // (a kit export is several MB; every minute would be wasteful).
      const missed = await catchUpHistory(r, gen, provider).catch((e) => { diag(r.walletId, 'catchup-failed', { error: errClass(e) }); return 0; });
      if (!isCurrent(r, gen)) return;
      await discoverDeposits(r, gen, provider).catch((e) => diag(r.walletId, 'deposits-failed', { error: errClass(e) }));
      if (!isCurrent(r, gen)) return;
      if (missed > 0 || (before !== null && before !== result.balance)) onActivity(r.walletId, 'catchup');
      diag(r.walletId, 'ok', { reason, ms: now() - t0 });
    } catch (error) {
      if (!isCurrent(r, gen)) return;
      r.failures += 1;
      setHealth(r, HEALTH.DEGRADED, error?.message || String(error));
      store.markBalanceError?.(r.walletId, error?.message || String(error));
      diag(r.walletId, 'failed', { reason, ms: now() - t0, failures: r.failures, error: errClass(error) });
      await maybeRebuild(r, gen);
      scheduleRetry(r);
    } finally {
      store.markBalanceRefresh?.(r.walletId, false);
    }
  }

  async function maybeRebuild(r, gen) {
    if (r.failures < REBUILD_AFTER_FAILURES) return;
    if (now() - r.lastRebuildAt < REBUILD_MIN_INTERVAL_MS) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // offline: nothing to fix
    r.lastRebuildAt = now();
    diag(r.walletId, 'rebuild');
    try {
      await store.connectSparkWallet(r.walletId, { forceReinit: true });
      if (!isCurrent(r, gen)) return;
      r.subscribedEntry = null; // re-attach to the rebuilt instance
      ensureSubscribed(r);
    } catch (e) {
      diag(r.walletId, 'rebuild-failed', { error: errClass(e) });
    }
  }

  function clearRetry(r) {
    if (r.retryTimer) { clearTimer(r.retryTimer); r.retryTimer = null; }
  }

  function scheduleRetry(r) {
    clearRetry(r);
    if (!started) return;
    const delay = BACKOFF_MS[Math.min(r.failures - 1, BACKOFF_MS.length - 1)];
    r.retryTimer = setTimer(() => { r.retryTimer = null; reconcile(r.walletId, 'retry'); }, delay);
  }

  /**
   * Reconcile one wallet now. Concurrent calls share the in-flight run; an
   * urgent trigger arriving mid-run schedules exactly one follow-up.
   */
  function reconcile(walletId, reason = 'manual') {
    if (!exists(walletId)) return Promise.resolve();
    const r = record(walletId);
    if (r.inflight) {
      if (URGENT.has(reason)) r.rerun = reason;
      return r.inflight;
    }
    const run = runOnce(r, reason).finally(() => {
      r.inflight = null;
      const again = r.rerun;
      r.rerun = null;
      if (again && exists(walletId)) reconcile(walletId, `${again}+`);
    });
    r.inflight = run;
    return run;
  }

  function trigger(reason, walletIds = sparkIds()) {
    return Promise.allSettled(walletIds.filter(exists).map((id) => reconcile(id, reason)));
  }

  // ---- Lifetime ---------------------------------------------------------

  function scheduleForeground() {
    if (foregroundTimer) clearTimer(foregroundTimer);
    if (!started) return;
    foregroundTimer = setTimer(() => {
      foregroundTimer = null;
      trigger('timer').finally(scheduleForeground);
    }, FOREGROUND_INTERVAL_MS);
  }

  function start() {
    if (started) return;
    started = true;
    diag('', 'start');
    trigger('start');
    scheduleForeground();
  }

  function stop() {
    started = false;
    if (foregroundTimer) { clearTimer(foregroundTimer); foregroundTimer = null; }
    for (const r of wallets.values()) clearRetry(r);
  }

  /** A wallet was removed, reset or replaced: drop its work and listeners. */
  function forget(walletId) {
    const r = wallets.get(walletId);
    if (!r) return;
    r.generation += 1;
    clearRetry(r);
    try { r.unsubscribe?.(); } catch { /* gone */ }
    wallets.delete(walletId);
    ledger?.forget?.(walletId);
    diag(walletId, 'forgotten');
  }

  function status(walletId) {
    const r = wallets.get(walletId);
    if (!r) return { health: HEALTH.DISCONNECTED, lastSyncAt: null, failures: 0, error: null };
    return { health: r.health, lastSyncAt: r.lastSyncAt, failures: r.failures, error: r.lastError, syncing: !!r.inflight };
  }

  return {
    start,
    stop,
    trigger,
    reconcile,
    forget,
    status,
    diagnostics: () => diagnostics.slice(),
    get started() { return started; },
  };
}

function errClass(error) {
  return error?.code || (error?.message ? String(error.message).slice(0, 60) : 'error');
}
