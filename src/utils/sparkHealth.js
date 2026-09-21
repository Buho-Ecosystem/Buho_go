/**
 * How long Spark has been unreachable, per wallet. The home screen shows
 * the emergency exit door only after a sustained outage, never on a blip,
 * so the first failure time must survive restarts. Injectable storage keeps
 * it testable; a broken storage degrades to memory, never to an error.
 */

export const SPARK_HEALTH_STORAGE_KEY = 'buhoGO_spark_health_v1';
export const SUSTAINED_OUTAGE_MS = 6 * 60 * 60 * 1000;

export function createSparkHealth({ storage = globalThis.localStorage, key = SPARK_HEALTH_STORAGE_KEY, now = () => Date.now() } = {}) {
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

  function entry(walletId) {
    return state[walletId] || (state[walletId] = { lastSuccessAt: null, firstFailureAt: null, failures: 0 });
  }

  return {
    recordSuccess(walletId) {
      const e = entry(walletId);
      e.lastSuccessAt = now();
      e.firstFailureAt = null;
      e.failures = 0;
      write();
    },
    recordFailure(walletId) {
      const e = entry(walletId);
      e.firstFailureAt = e.firstFailureAt || now();
      e.failures += 1;
      write();
    },
    /** Milliseconds since the first failure of the current streak, 0 when reachable. */
    unreachableFor(walletId) {
      const e = state[walletId];
      return e?.firstFailureAt ? Math.max(0, now() - e.firstFailureAt) : 0;
    },
    lastSuccessAt(walletId) {
      return state[walletId]?.lastSuccessAt || null;
    },
    /** Sustained: unreachable for the outage window and more than a single miss. */
    isSustainedOutage(walletId, { windowMs = SUSTAINED_OUTAGE_MS } = {}) {
      const e = state[walletId];
      return !!e?.firstFailureAt && e.failures >= 3 && now() - e.firstFailureAt >= windowMs;
    },
    forget(walletId) { delete state[walletId]; write(); },
  };
}

let shared = null;
export function sparkHealth() {
  return (shared ||= createSparkHealth());
}
