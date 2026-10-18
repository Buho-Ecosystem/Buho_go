/**
 * Keeps the balance of every wallet with an Auto-Transfer rule current, so
 * the rule gets its chance to run.
 *
 * A rule runs on a network-verified balance (wallet store, applyBalance).
 * Spark wallets get those from the Spark lifecycle, all of them, all the
 * time. Other wallets are read only when a screen asks: Home refreshes the
 * active wallet while it is open, nothing refreshes the others, and the
 * kiosk does not open Home. Without this watch, a rule on any of those would
 * never run.
 *
 * Every minute while the app runs, and once on return to the app, each
 * wallet with a switched-on rule that the Spark lifecycle does not cover
 * has its balance read. There is no background service: while Android has
 * the app frozen, nothing here runs, and the read on return catches up.
 */

export const WATCH_INTERVAL_MS = 60 * 1000;
// Coming back to the app raises several events at once (visibility, app
// state, resume) while the thawed timer fires too: one read covers them.
export const RESUME_SETTLE_MS = 5 * 1000;

/**
 * @param {object} deps
 * @param {() => Array<{ id: string, type?: string }>} deps.wallets
 * @param {(walletId: string) => object|null} deps.ruleFor
 * @param {(walletId: string) => Promise<unknown>} deps.refresh
 * @param {(fn: () => void, ms: number) => unknown} [deps.setTimer]
 * @param {(handle: unknown) => void} [deps.clearTimer]
 * @param {() => number} [deps.now]
 */
export function createAutoTransferWatch({ wallets, ruleFor, refresh, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  let timer = null;
  let running = false;
  let inflight = null;
  let lastCheckAt = -Infinity;

  /** Wallets whose rule is on and whose balance nothing else keeps fresh. */
  function watched() {
    return wallets().filter((w) => (w.type || 'nwc') !== 'spark' && ruleFor(w.id)?.enabled);
  }

  /** One round at a time: a call while one runs shares it. */
  function check() {
    if (inflight) return inflight;
    lastCheckAt = now();
    inflight = Promise.allSettled(watched().map((w) => refresh(w.id))).finally(() => { inflight = null; });
    return inflight;
  }

  function schedule() {
    if (!running) return;
    timer = setTimer(() => {
      timer = null;
      check().finally(schedule);
    }, WATCH_INTERVAL_MS);
  }

  return {
    watched,
    check,
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimer(timer);
      timer = null;
    },
    /** Back in front of the person: read now instead of at the next tick. */
    resume() {
      if (!running) return Promise.resolve();
      if (inflight || now() - lastCheckAt < RESUME_SETTLE_MS) return inflight || Promise.resolve();
      if (timer) clearTimer(timer);
      timer = null;
      return check().finally(schedule);
    },
  };
}

let instance = null;

/**
 * The app's watch, wired to the stores and to app visibility. Started once
 * the saved wallets and rules are loaded (stores/wallet.js initialize).
 */
export async function startAutoTransferWatch(walletStore, autoTransferStore) {
  if (instance || typeof window === 'undefined') return instance;
  instance = createAutoTransferWatch({
    wallets: () => walletStore.wallets,
    ruleFor: (walletId) => autoTransferStore.getConfig(walletId),
    refresh: (walletId) => walletStore.refreshBalance(walletId),
  });
  instance.start();
  const { onAppVisibility } = await import('../utils/appVisibility.js');
  onAppVisibility((visible) => { if (visible) instance.resume(); });
  return instance;
}
