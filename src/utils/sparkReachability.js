/**
 * Is Spark reachable, and when it is not, is it really Spark (#381)?
 *
 * Home may point at the emergency exit, which is irreversible, slow and
 * paid on-chain, so this signal only moves on proof:
 *
 *  - One verdict per check: answered, no internet, Spark down, or unknown.
 *    "Spark down" needs the internet to work (independent hosts answer)
 *    AND at least two of the three Spark operators to fail. Spark signs
 *    with two of three, so one operator away is normal, not an outage.
 *  - Any answer from Spark clears everything.
 *  - Time counts only while the app is checking: each Spark-down verdict
 *    adds the gap since the previous one, capped, so hours with the app
 *    closed, hidden or offline add nothing. A long silence restarts the
 *    streak, and so does a clock that went backwards.
 *  - Nothing is ever shown from saved state alone: the level needs a
 *    verdict from this session.
 *
 * Spark reachability is the same for every wallet on the network, so there
 * is one record, not one per wallet. Pure logic plus injectable storage and
 * clock; the checks that feed it live in services/sparkReachabilityCheck.
 */

export const VERDICT = Object.freeze({
  ANSWERED: 'answered',
  NO_INTERNET: 'no-internet',
  SPARK_DOWN: 'spark-down',
  UNKNOWN: 'unknown',
});

/** What Home says. Higher levels need everything the lower ones need. */
export const LEVEL = Object.freeze({
  NONE: 0,
  NO_INTERNET: 1,
  UNREACHABLE: 2,
  LONG_OUTAGE: 3,
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const RULES = Object.freeze({
  /** Spark-down verdicts closer together than this count once. */
  minGapMs: 2 * MINUTE,
  /** The most a single gap between verdicts adds to the observed time. */
  gapCapMs: 10 * MINUTE,
  /** A silence this long between verdicts starts a new streak. */
  streakResetMs: 48 * HOUR,
  /** Level 3: first and latest verdict at least this far apart... */
  longOutageSpanMs: 24 * HOUR,
  /** ...with at least this much time actually observed... */
  longOutageObservedMs: 30 * MINUTE,
  /** ...across at least this many separate app sessions... */
  longOutageSessions: 3,
  /** ...and the latest verdict no older than this. */
  freshVerdictMs: 10 * MINUTE,
  /** Spark signs with two of three operators: two failing is an outage. */
  operatorsDown: 2,
});

/**
 * Spark's own status (Breez `getSparkStatus`). 'unavailable' means the
 * status could not be read; null means it was not asked yet.
 */
export const SPARK_STATUS_OK = 'operational';

export const STORAGE_KEY = 'buhoGO_spark_reachability_v1';

/**
 * The earlier per-wallet outage record and the banner's dismissal. Their
 * streaks were built on the rules this module replaces, so they are
 * deleted, never migrated.
 */
export const LEGACY_KEYS = Object.freeze(['buhoGO_spark_health_v1', 'buhoGO_exit_banner_dismissed_until']);

/**
 * One check, one verdict.
 *
 * @param {object} evidence
 * @param {boolean} [evidence.sparkAnswered]  Spark answered during this attempt
 * @param {boolean} [evidence.sparkErrored]   Spark answered only with server errors (5xx, 429, 401)
 * @param {'offline'|'no-internet'|'service'|null} [evidence.connection]  utils/connectivity diagnosis
 * @param {{ total:number, failed:number }|null} [evidence.operators]  direct operator probe
 * @returns {string} a VERDICT
 */
export function classifyCheck({ sparkAnswered = false, sparkErrored = false, connection = null, operators = null } = {}) {
  if (sparkAnswered) return VERDICT.ANSWERED;
  if (connection === 'offline' || connection === 'no-internet') return VERDICT.NO_INTERNET;
  if (connection !== 'service') return VERDICT.UNKNOWN;
  if (sparkErrored) return VERDICT.SPARK_DOWN;
  if (!operators || !(operators.total > 0)) return VERDICT.UNKNOWN;
  return operators.failed >= RULES.operatorsDown ? VERDICT.SPARK_DOWN : VERDICT.ANSWERED;
}

function emptyRecord() {
  return { firstDownAt: null, lastDownAt: null, observedMs: 0, sessions: [], lastAnsweredAt: null };
}

function newSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSparkReachability({
  storage = globalThis.localStorage,
  key = STORAGE_KEY,
  now = () => Date.now(),
  sessionId = newSessionId(),
} = {}) {
  // Session memory: what this run of the app has seen itself.
  let session = { id: sessionId, verdict: null, downCount: 0 };
  let status = null;
  let memory = emptyRecord();
  const listeners = new Set();

  for (const legacy of LEGACY_KEYS) {
    try { storage?.removeItem?.(legacy); } catch { /* nothing to clean */ }
  }

  // Read before every change so another tab's newer record is never overwritten.
  function read() {
    try {
      const raw = storage?.getItem?.(key);
      if (raw == null) return { ...memory };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyRecord();
      return {
        ...emptyRecord(),
        ...parsed,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.slice(-10) : [],
      };
    } catch {
      return { ...memory };
    }
  }

  function write(record) {
    memory = record;
    try { storage?.setItem?.(key, JSON.stringify(record)); } catch { /* memory only */ }
  }

  function notify() {
    const snap = snapshot();
    for (const fn of listeners) {
      try { fn(snap); } catch { /* a broken listener must not stop the others */ }
    }
  }

  function clearedStreak(record, answeredAt) {
    return { ...emptyRecord(), lastAnsweredAt: answeredAt ?? record.lastAnsweredAt };
  }

  function recordDown(record, t) {
    let next = record;
    // A clock that went backwards or a long silence: the old streak proves nothing now.
    if (next.lastDownAt && (t < next.lastDownAt || t - next.lastDownAt > RULES.streakResetMs)) {
      next = clearedStreak(next);
    }
    if (next.lastDownAt && t - next.lastDownAt < RULES.minGapMs) return { record: next, counted: false };
    const gap = next.lastDownAt ? Math.min(t - next.lastDownAt, RULES.gapCapMs) : 0;
    const sessions = next.sessions.includes(session.id) ? next.sessions : [...next.sessions, session.id].slice(-10);
    return {
      record: {
        ...next,
        firstDownAt: next.firstDownAt || t,
        lastDownAt: t,
        observedMs: (next.observedMs || 0) + gap,
        sessions,
      },
      counted: true,
    };
  }

  function levelOf(record, t) {
    if (session.verdict === VERDICT.NO_INTERNET) return LEVEL.NO_INTERNET;
    if (session.verdict !== VERDICT.SPARK_DOWN || session.downCount < 2) return LEVEL.NONE;
    const long = !!record.firstDownAt
      && record.sessions.length >= RULES.longOutageSessions
      && record.lastDownAt - record.firstDownAt >= RULES.longOutageSpanMs
      && record.observedMs >= RULES.longOutageObservedMs
      && t - record.lastDownAt <= RULES.freshVerdictMs
      // Spark's own status must not say all is well. It never triggers,
      // it only holds the line back from pointing at the exit.
      && status != null && status !== SPARK_STATUS_OK;
    return long ? LEVEL.LONG_OUTAGE : LEVEL.UNREACHABLE;
  }

  function snapshot() {
    const record = read();
    const t = now();
    return {
      level: levelOf(record, t),
      verdict: session.verdict,
      since: record.firstDownAt,
      lastAnsweredAt: record.lastAnsweredAt,
      status,
      /** Spark says it is fine, yet this phone cannot reach it: likely this network. */
      blockedHere: status === SPARK_STATUS_OK,
    };
  }

  return {
    /** Apply one verdict. UNKNOWN changes nothing. */
    record(verdict) {
      const t = now();
      if (verdict === VERDICT.ANSWERED) {
        session = { ...session, verdict, downCount: 0 };
        write(clearedStreak(read(), t));
      } else if (verdict === VERDICT.NO_INTERNET) {
        session = { ...session, verdict, downCount: 0 };
      } else if (verdict === VERDICT.SPARK_DOWN) {
        const { record, counted } = recordDown(read(), t);
        session = { ...session, verdict, downCount: session.downCount + (counted ? 1 : 0) };
        write(record);
      } else {
        return snapshot();
      }
      notify();
      return snapshot();
    },
    /** Spark's own status, as last read. */
    setStatus(value) {
      if (value === status) return;
      status = value ?? null;
      notify();
    },
    /** A new app session (cold start, or back after a long time away). */
    newSession(id = newSessionId()) {
      session = { id, verdict: null, downCount: 0 };
      notify();
    },
    snapshot,
    /** The stored streak, for tests and diagnostics. */
    stored() { return read(); },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Another tab changed the record. */
    refresh() { notify(); },
    clear() {
      session = { ...session, verdict: null, downCount: 0 };
      status = null;
      write(emptyRecord());
      notify();
    },
  };
}

let shared = null;
export function sparkReachability() {
  if (!shared) {
    shared = createSparkReachability();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) shared.refresh();
      });
    }
  }
  return shared;
}
