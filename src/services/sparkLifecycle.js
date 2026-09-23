/**
 * App-wide lifecycle for every live Spark wallet.
 *
 * Before this existed, Spark synchronization belonged to whichever screen
 * was mounted and whichever wallet was selected: the home page's 30 s tick
 * (usually a cache read) stopped the moment the user opened Settings, the
 * inactive half of the pair was offline, SDK events had no global owner,
 * and nothing reconciled the wallets when the app came back from the
 * background. Payments went unnoticed and the first seconds after reopening
 * showed stale numbers.
 *
 * This coordinator is keyed by wallet id and independent of pages. For each
 * connected Spark wallet it:
 *
 *   - owns the SDK event subscription (sync, payments, deposits) and
 *     publishes what it learns into the wallet store's shared balance state;
 *   - schedules real synchronization (provider.syncNow via
 *     store.refreshWalletData), on a cadence while visible and on every
 *     resume, visibility return and network restoration;
 *   - reconciles what the event stream may have missed: settled receives
 *     (payment receipts, notified at most once) and Bitcoin deposits;
 *   - refreshes the wallet's emergency exit kit after catch-up;
 *   - recovers: retries with backoff, and rebuilds the SDK instance only
 *     after repeated failures while the phone is online (a quiet stream is
 *     not evidence of a dead one).
 *
 * Every step checks the wallet's epoch (bumped by the store on disconnect,
 * rebuild and removal) so work that outlives its wallet never lands.
 *
 * What this cannot do: run while the OS has suspended the app. It covers
 * the time the app can execute and catches up immediately afterwards;
 * delivery during suspension needs a push transport (#276).
 *
 * The store is wired in by boot/spark-lifecycle.js; until then every
 * notification from the store is recorded and replayed on attach.
 */

export const FOREGROUND_SYNC_MS = 90 * 1000;
export const BACKGROUND_SYNC_MS = 60 * 1000;
export const RETRY_BASE_MS = 5 * 1000;
export const RETRY_MAX_MS = 5 * 60 * 1000;
/** Consecutive failed passes (while online) before the SDK is rebuilt. */
export const REBUILD_AFTER_FAILURES = 3;
const DIAGNOSTICS_MAX = 100;

const shortId = (walletId) => (walletId ? `…${String(walletId).slice(-4)}` : '?');

/**
 * @param {object} deps
 * @param {() => object} deps.walletStore            the Pinia wallet store
 * @param {() => object} [deps.depositsStore]        bitcoinDeposits store
 * @param {object} [deps.receipts]                   createPaymentReceipts()
 * @param {(walletId, fn) => () => void} deps.subscribe   breezSdk.subscribe
 * @param {(walletId, opts) => any} [deps.refreshExitKit]
 * @param {() => boolean} [deps.isOnline]
 * @param {() => boolean} [deps.isForeground]
 * @param {() => boolean} [deps.backgroundSyncWanted]  e.g. notifications on
 * @param {() => number} [deps.now]
 * @param {Function} [deps.setTimer] / [deps.clearTimer]
 */
export function createSparkLifecycle(deps = {}) {
  const {
    subscribe,
    depositsStore = () => null,
    receipts = null,
    refreshExitKit = () => {},
    isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
    isForeground = () => typeof document === 'undefined' || !document.hidden,
    backgroundSyncWanted = () => false,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    operationTimeoutMs = 30000,
  } = deps;
  let walletStore = deps.walletStore || null;

  /** walletId -> { unsub, epoch, failures, running, rerun, retryTimer, lastRebuildAt } */
  const tracked = new Map();
  /** Store notifications received before attach(). */
  const pending = new Set();
  const diagnostics = [];
  let cadenceTimer = null;
  let stopped = false;
  const suspended = new Set();

  function log(entry) {
    // SDK errors can include payment requests and addresses. Diagnostics
    // expose stages/timings, never arbitrary provider error payloads.
    const { error, ...safe } = entry;
    diagnostics.push({ at: now(), ...safe, ...(error ? { failed: true } : {}) });
    while (diagnostics.length > DIAGNOSTICS_MAX) diagnostics.shift();
  }

  async function bounded(work, step) {
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimer(() => reject(new Error(`Spark ${step} timeout`)), operationTimeoutMs);
      })]);
    } finally {
      clearTimer(timer);
    }
  }

  const store = () => walletStore;
  const epochOf = (walletId) => store()?.walletEpoch?.(walletId) ?? 0;
  const exists = (walletId) => !!store()?.wallets?.some(w => w.id === walletId);

  function publishPhase(walletId, patch) {
    const s = store();
    if (!s || !exists(walletId)) return;
    const prev = s.sparkSync?.[walletId] || { phase: 'disconnected', lastSyncAt: null, lastError: null, failures: 0 };
    s.sparkSync[walletId] = { ...prev, ...patch };
  }

  /** Publish the provider's local balance after the SDK itself synced or a payment settled. */
  async function publishLocal(walletId, { verified, source, current }) {
    const s = store();
    const provider = s?.providers?.[walletId];
    if (!provider?.isConnected || typeof provider.getCachedBalance !== 'function') return;
    const read = s.beginBalanceRead(walletId);
    try {
      const result = await provider.getCachedBalance();
      if (!current()) return;
      s.acceptBalance(walletId, result.balance, { read, source, verified });
    } catch (err) {
      log({ walletId: shortId(walletId), step: 'publish', error: String(err?.message || err) });
    }
  }

  async function handleEvent(walletId, owner, event) {
    const current = () => !stopped && tracked.get(walletId) === owner
      && owner.epoch === epochOf(walletId) && exists(walletId) && !suspended.has(walletId);
    if (!current() || !event?.type) return;
    const type = event.type;
    log({ walletId: shortId(walletId), event: type });
    switch (type) {
      case 'synced':
        // Breez 0.25 also emits this for partial syncs. It is a reason to
        // reread the cache, not proof that a failed balance sync recovered.
        await publishLocal(walletId, { verified: false, source: 'event', current });
        break;
      case 'paymentSucceeded':
        if (receipts && event.payment) {
          await receipts.observe(walletId, event.payment, { source: 'event' });
        }
        if (current()) await publishLocal(walletId, { verified: false, source: 'event', current });
        break;
      case 'paymentPending':
      case 'paymentFailed':
        await publishLocal(walletId, { verified: false, source: 'event', current });
        break;
      case 'newDeposits':
      case 'unclaimedDeposits':
        await bounded(Promise.resolve(depositsStore()?.discover?.(walletId)), 'deposits').catch(() => {});
        break;
      case 'claimedDeposits':
        store()?.signalDepositsRefresh?.(walletId);
        await publishLocal(walletId, { verified: false, source: 'event', current });
        break;
      default:
        break;
    }
  }

  function attachWallet(walletId) {
    const s = store();
    if (stopped || !s || !exists(walletId)) return;
    suspended.delete(walletId);
    const epoch = epochOf(walletId);
    const existing = tracked.get(walletId);
    if (existing && existing.epoch === epoch && existing.unsub) return;
    if (existing && existing.epoch !== epoch) detachWallet(walletId);

    // Fix the receipt baseline BEFORE events can flow: everything the SDK
    // replays from before this moment (a restore's initial sync) is history.
    receipts?.ensureBaseline(walletId);

    const t = tracked.get(walletId) || { failures: 0, running: null, rerun: false, retryTimer: null, lastRebuildAt: existing?.lastRebuildAt || 0 };
    t.epoch = epoch;
    t.unsub = subscribe(walletId, (event) => {
      handleEvent(walletId, t, event).catch((err) =>
        log({ walletId: shortId(walletId), event: event?.type, error: String(err?.message || err) }));
    });
    tracked.set(walletId, t);
    log({ walletId: shortId(walletId), step: 'attach' });
    // Catch up as soon as the provider is available. Its initial balance
    // read shares syncNow with this pass; address setup must not delay events.
    reconcile(walletId, 'connect');
  }

  function detachWallet(walletId, { keepState = false } = {}) {
    const t = tracked.get(walletId);
    if (!t) return;
    t.rerun = false;
    try { t.unsub?.(); } catch { /* already gone */ }
    t.unsub = null;
    if (t.retryTimer) { clearTimer(t.retryTimer); t.retryTimer = null; }
    if (!keepState) tracked.delete(walletId);
  }

  function scheduleRetry(walletId, failures) {
    const t = tracked.get(walletId);
    if (!t) return;
    if (t.retryTimer) clearTimer(t.retryTimer);
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
    t.retryTimer = setTimer(() => {
      t.retryTimer = null;
      reconcile(walletId, 'retry');
    }, delay);
  }

  /**
   * One reconciliation pass for one wallet: sync, publish, catch up on
   * receipts and deposits, refresh the exit kit. Coalesced: a trigger that
   * arrives mid-pass runs one more pass afterwards, never a parallel one.
   */
  function reconcile(walletId, reason = 'manual') {
    const s = store();
    if (stopped || suspended.has(walletId) || !s || !exists(walletId)) return Promise.resolve();
    let t = tracked.get(walletId);
    if (!t) {
      t = { epoch: epochOf(walletId), unsub: null, failures: 0, running: null, rerun: false, retryTimer: null, lastRebuildAt: 0 };
      tracked.set(walletId, t);
    }
    if (t.running) {
      t.rerun = true;
      return t.running;
    }
    t.running = (async () => {
      try {
        do {
          t.rerun = false;
          await pass(walletId, t, reason);
        } while (t.rerun && !stopped && tracked.get(walletId) === t && !suspended.has(walletId) && exists(walletId));
      } finally {
        t.running = null;
      }
    })();
    return t.running;
  }

  async function pass(walletId, t, reason) {
    const s = store();
    const started = now();
    const epoch = epochOf(walletId);
    const stillCurrent = () => !stopped && tracked.get(walletId) === t
      && !suspended.has(walletId) && exists(walletId) && epochOf(walletId) === epoch;
    let provider = s.providers?.[walletId];

    try {
      if (!provider?.isConnected || !s.connectionStates?.[walletId]?.connected) {
        publishPhase(walletId, { phase: 'connecting' });
        await bounded(s.connectSparkWallet(walletId), 'connect');
        provider = s.providers?.[walletId];
        if (!stillCurrent()) return;
      } else {
        publishPhase(walletId, { phase: 'syncing' });
        await bounded(s.refreshWalletData(walletId), 'refresh');
        if (!stillCurrent()) return;
        if (!s.connectionStates?.[walletId]?.connected || s.balanceMeta?.[walletId]?.error) {
          throw new Error('Spark balance refresh failed');
        }
      }

      const syncFailed = !!provider?.lastSyncError || !provider?.lastSyncedAt;
      if (syncFailed) throw provider?.lastSyncError || new Error('Spark did not confirm a sync');

      // Receipts the live stream may have missed while the app was away.
      if (receipts && typeof provider?.listReceivesForCatchup === 'function') {
        const passStartS = Math.floor(started / 1000);
        const from = receipts.catchUpFrom(walletId);
        const payments = await bounded(provider.listReceivesForCatchup(from, { pendingIds: receipts.pendingIds(walletId) }), 'receipts');
        if (!stillCurrent()) return;
        // Oldest first, so notifications arrive in the order money did.
        for (const payment of [...payments].reverse()) {
          if (!stillCurrent()) return;
          await receipts.observe(walletId, payment, { source: 'catchup' });
        }
        if (!stillCurrent()) return;
        receipts.markCaughtUp(walletId, passStartS);
      }

      await bounded(Promise.resolve(depositsStore()?.discover?.(walletId)), 'deposits').catch(() => {});
      if (!stillCurrent()) return;

      if (reason !== 'tick') {
        try { await bounded(Promise.resolve(refreshExitKit(walletId, { reason: 'catchup' })), 'exit kit'); } catch { /* the kit retries on its own */ }
      }

      if (!stillCurrent()) return;
      if (t.retryTimer) { clearTimer(t.retryTimer); t.retryTimer = null; }
      t.failures = 0;
      publishPhase(walletId, { phase: 'healthy', lastSyncAt: provider?.lastSyncedAt || now(), lastError: null, failures: 0 });
      log({ walletId: shortId(walletId), step: 'reconciled', reason, ms: now() - started });
    } catch (err) {
      if (!stillCurrent()) return;
      const online = isOnline();
      // An offline phone says nothing about Spark or the SDK instance.
      if (online) t.failures += 1;
      const message = String(err?.message || err);
      publishPhase(walletId, { phase: 'degraded', lastError: message, failures: t.failures });
      log({ walletId: shortId(walletId), step: 'failed', reason, ms: now() - started, error: message, online });

      if (online && t.failures >= REBUILD_AFTER_FAILURES && now() - t.lastRebuildAt > RETRY_MAX_MS) {
        t.lastRebuildAt = now();
        log({ walletId: shortId(walletId), step: 'rebuild' });
        try {
          await bounded(s.connectSparkWallet(walletId, { forceReinit: true }), 'rebuild');
        } catch (rebuildErr) {
          log({ walletId: shortId(walletId), step: 'rebuild-failed', error: String(rebuildErr?.message || rebuildErr) });
        }
      }
      if (online && stillCurrent()) scheduleRetry(walletId, t.failures);
    }
  }

  /** Accounts reconcile independently; per-wallet calls coalesce above. */
  function reconcileAll(reason = 'manual') {
    const s = store();
    if (stopped || !s) return Promise.resolve();
    const ids = (s.sparkWallets || []).map(w => w.id);
    log({ step: 'reconcile-all', reason, wallets: ids.length });
    return Promise.all(ids.map(id => reconcile(id, reason)));
  }

  function scheduleCadence() {
    if (stopped) return;
    if (cadenceTimer) clearTimer(cadenceTimer);
    const foreground = isForeground();
    // Hidden: only worth waking up if a notification can come of it; the OS
    // throttles or freezes these timers anyway.
    if (!foreground && !backgroundSyncWanted()) { cadenceTimer = null; return; }
    cadenceTimer = setTimer(() => {
      cadenceTimer = null;
      reconcileAll(isForeground() ? 'tick' : 'background').catch(() => {});
      scheduleCadence();
    }, foreground ? FOREGROUND_SYNC_MS : BACKGROUND_SYNC_MS);
  }

  return {
    /** Wire the store in and replay what happened before. */
    attach(walletStoreInstance) {
      walletStore = walletStoreInstance;
      for (const id of pending) attachWallet(id);
      pending.clear();
      // Wallets that connected before the lifecycle existed.
      for (const w of walletStore.sparkWallets || []) {
        if (walletStore.connectionStates?.[w.id]?.connected) attachWallet(w.id);
      }
      scheduleCadence();
    },

    onSparkConnecting(walletId) {
      if (stopped || !walletStore || !exists(walletId)) return;
      receipts?.ensureBaseline(walletId);
    },

    onSparkConnected(walletId) {
      if (stopped) return;
      suspended.delete(walletId);
      if (!walletStore) { pending.add(walletId); return; }
      publishPhase(walletId, { phase: 'syncing' });
      attachWallet(walletId);
    },

    onSparkDisconnected(walletId) {
      suspended.add(walletId);
      pending.delete(walletId);
      detachWallet(walletId);
      publishPhase(walletId, { phase: 'disconnected' });
    },

    onSparkRemoved(walletId) {
      suspended.add(walletId);
      pending.delete(walletId);
      detachWallet(walletId);
      if (walletStore?.sparkSync) delete walletStore.sparkSync[walletId];
      receipts?.forget(walletId);
      depositsStore()?.forgetWallet?.(walletId);
    },

    /** Resume, visibility return, network back: reconcile both wallets now. */
    onWake(reason) {
      if (!walletStore) return Promise.resolve();
      log({ step: 'wake', reason });
      scheduleCadence();
      return reconcileAll(reason);
    },

    /** Background/foreground changed: re-pick the cadence. */
    onVisibilityChanged() {
      scheduleCadence();
    },

    /**
     * An own transfer is about to land in `walletId`; its receipt must not
     * be announced (see paymentReceipts.expectInternal).
     */
    expectInternalReceipt(walletId, expectation) {
      receipts?.expectInternal(walletId, expectation);
    },

    reconcile,
    reconcileAll,
    /** Redacted recent lifecycle history, for support and delay analysis. */
    diagnostics: () => diagnostics.map(d => ({ ...d })),
    stop() {
      stopped = true;
      if (cadenceTimer) clearTimer(cadenceTimer);
      cadenceTimer = null;
      for (const id of [...tracked.keys()]) detachWallet(id);
    },
    /** Test hook. */
    _tracked: tracked,
  };
}

let shared = null;
/**
 * The app's lifecycle instance. The store calls into it on connect and
 * disconnect; boot/spark-lifecycle.js supplies the dependencies (see
 * configureSparkLifecycle) and attaches the store.
 */
export function sparkLifecycle() {
  if (!shared) shared = createSparkLifecycle({ subscribe: () => () => {} });
  return shared;
}

/**
 * Install the real dependencies (boot only). Wallets that connected before
 * this are picked up by attach(), which scans the store's connection state.
 */
export function configureSparkLifecycle(deps) {
  shared?.stop();
  shared = createSparkLifecycle(deps);
  return shared;
}
