/**
 * The checks behind the Spark reachability signal (#381).
 *
 * A check proves before it blames:
 *   1. Did Spark answer recently? The SDK's own traffic (utils/sparkNetwork)
 *      is enough, and costs no extra request.
 *   2. Does the internet work? Independent hosts (utils/connectivity).
 *      No internet is never Spark's fault.
 *   3. Do the Spark operators answer? Asked directly (utils/sparkOperators),
 *      so it also works when no wallet ever connected.
 * Each check records exactly one verdict (utils/sparkReachability).
 *
 * Checks never run while the app is hidden, nor in the first seconds after
 * start, resume or reconnect, when the network may not be back yet. Being
 * away for an hour or more starts a new app session, which is what the
 * long-outage rule counts.
 */
import { VERDICT, classifyCheck, sparkReachability } from '../utils/sparkReachability.js';
import { diagnoseConnection } from '../utils/connectivity.js';
import { probeSparkOperators } from '../utils/sparkOperators.js';
import { sparkNetwork } from './breezSdk.js';

export const CHECK_RULES = Object.freeze({
  intervalMs: 5 * 60 * 1000,
  warmUpMs: 15 * 1000,
  sessionBreakMs: 60 * 60 * 1000,
  connectionCacheMs: 60 * 1000,
  statusCacheMs: 10 * 60 * 1000,
  /** SDK traffic this recent counts as Spark answering. */
  recentAnswerMs: 2 * 60 * 1000,
});

function documentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

async function readSparkStatus() {
  return (await import('./breezSdk.js')).getSparkStatus();
}

/**
 * @param {object} [deps] all replaceable in tests
 */
export function createReachabilityChecker({
  store = sparkReachability(),
  diagnose = () => diagnoseConnection(),
  probeOperators = () => probeSparkOperators(),
  readStatus = readSparkStatus,
  recentAnswer = () => !!sparkNetwork()?.answeredRecently(CHECK_RULES.recentAnswerMs),
  isVisible = documentVisible,
  isEnabled = () => true,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let warmUntil = now() + CHECK_RULES.warmUpMs;
  let hiddenAt = null;
  let running = null;
  let scheduled = null;
  let connection = null;
  let status = null;

  async function connectionKind(fresh) {
    if (!fresh && connection && now() - connection.at < CHECK_RULES.connectionCacheMs) return connection.kind;
    const kind = await diagnose().catch(() => null);
    connection = kind ? { kind, at: now() } : null;
    return kind;
  }

  async function refreshStatus() {
    if (status && now() - status.at < CHECK_RULES.statusCacheMs) return;
    let value;
    try { value = await readStatus(); } catch { value = 'unavailable'; }
    status = { value, at: now() };
    store.setStatus(value);
  }

  async function run({ errored = false, force = false } = {}) {
    if (!isEnabled()) return VERDICT.UNKNOWN;
    if (!force && (!isVisible() || now() < warmUntil)) return VERDICT.UNKNOWN;
    if (!errored && recentAnswer()) {
      store.record(VERDICT.ANSWERED);
      return VERDICT.ANSWERED;
    }
    const kind = await connectionKind(force);
    const operators = kind === 'service' ? await probeOperators().catch(() => null) : null;
    const verdict = classifyCheck({ connection: kind, operators, sparkErrored: errored });
    // Hidden mid-check (app switch, screen off): the answers prove nothing.
    if (!force && !isVisible()) return VERDICT.UNKNOWN;
    if (verdict === VERDICT.SPARK_DOWN) await refreshStatus();
    store.record(verdict);
    return verdict;
  }

  function check(options) {
    if (!running) running = run(options).finally(() => { running = null; });
    return running;
  }

  /** One check once the warm-up is over; repeated requests share it. */
  function scheduleCheck(options) {
    if (scheduled) return;
    const wait = Math.max(0, warmUntil - now()) + 500;
    scheduled = setTimer(() => {
      scheduled = null;
      check(options);
    }, wait);
  }

  function warmUp() {
    warmUntil = now() + CHECK_RULES.warmUpMs;
  }

  return {
    check,
    /** "Try again": right now, warm-up and caches skipped. */
    checkNow() { return check({ force: true }); },
    /** A Spark sync got real answers. */
    reportAnswered() { store.record(VERDICT.ANSWERED); },
    /** A Spark sync got no real answer; `errored` when it got only server errors. */
    reportFailedAttempt({ errored = false } = {}) { scheduleCheck({ errored }); },
    noteHidden() { hiddenAt = now(); },
    noteVisible() {
      if (hiddenAt != null && now() - hiddenAt >= CHECK_RULES.sessionBreakMs) store.newSession();
      hiddenAt = null;
      warmUp();
      scheduleCheck();
    },
    noteOnline() {
      connection = null;
      warmUp();
      scheduleCheck();
    },
    /** The phone itself reports no network: no probe needed. */
    noteOffline() {
      connection = { kind: 'offline', at: now() };
      if (isEnabled()) store.record(VERDICT.NO_INTERNET);
    },
    stop() {
      if (scheduled) clearTimer(scheduled);
      scheduled = null;
    },
  };
}

let checker = null;
let teardown = null;

/**
 * Start the checks for this app run. Safe to call again.
 * @param {{ isEnabled?: () => boolean }} [options] only with a Spark wallet
 */
export function startReachabilityChecks({ isEnabled = () => true } = {}) {
  if (checker) return checker;
  checker = createReachabilityChecker({ isEnabled });
  if (typeof window === 'undefined') return checker;
  const onVisibility = () => (document.visibilityState === 'hidden' ? checker.noteHidden() : checker.noteVisible());
  const onOnline = () => checker.noteOnline();
  const onOffline = () => checker.noteOffline();
  const timer = setInterval(() => checker.check(), CHECK_RULES.intervalMs);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  if (navigator.onLine === false) checker.noteOffline();
  else checker.noteOnline();
  teardown = () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    checker.stop();
  };
  return checker;
}

export function stopReachabilityChecks() {
  teardown?.();
  teardown = null;
  checker = null;
}

/** "Try again" from the help sheet. */
export function checkSparkNow() {
  return (checker || startReachabilityChecks()).checkNow();
}

/**
 * The outcome of one Spark sync attempt, reported once by the provider.
 * Before the checks start, only an answer is kept: a failure alone proves
 * nothing until a check has looked at the internet and the operators.
 */
export function reportSparkAttempt({ answered = false, errored = false } = {}) {
  if (answered) {
    if (checker) checker.reportAnswered();
    else sparkReachability().record(VERDICT.ANSWERED);
    return;
  }
  checker?.reportFailedAttempt({ errored });
}
