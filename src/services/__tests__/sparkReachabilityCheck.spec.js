import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

const { createReachabilityChecker, CHECK_RULES } = await import('../sparkReachabilityCheck.js');
const { createSparkReachability, VERDICT, LEVEL } = await import('../../utils/sparkReachability.js');

const MIN = 60 * 1000;

function harness(overrides = {}) {
  const clock = { t: 1_000_000_000_000 };
  const calls = { diagnose: 0, operators: 0, status: 0 };
  const timers = [];
  const env = {
    connection: 'service',
    operators: { total: 3, failed: 3 },
    status: 'major',
    visible: true,
    recent: false,
    enabled: true,
  };
  const store = createSparkReachability({ storage: { getItem: () => null, setItem() {}, removeItem() {} }, now: () => clock.t, sessionId: 's' });
  const checker = createReachabilityChecker({
    store,
    diagnose: async () => { calls.diagnose += 1; return env.connection; },
    probeOperators: async () => { calls.operators += 1; return env.operators; },
    readStatus: async () => { calls.status += 1; if (env.status instanceof Error) throw env.status; return env.status; },
    recentAnswer: () => env.recent,
    isVisible: () => env.visible,
    isEnabled: () => env.enabled,
    now: () => clock.t,
    setTimer: (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; },
    clearTimer: () => {},
    ...overrides,
  });
  const runTimers = async () => {
    while (timers.length) {
      const { fn, at } = timers.shift();
      clock.t = Math.max(clock.t, at);
      fn();
      await new Promise((r) => setImmediate(r));
    }
  };
  // Past the start-up warm-up.
  clock.t += CHECK_RULES.warmUpMs + 1;
  return { clock, calls, env, store, checker, timers, runTimers };
}

test('a dead VPN reads as no internet and never touches Spark operators', async () => {
  const h = harness();
  h.env.connection = 'no-internet';
  assert.equal(await h.checker.check(), VERDICT.NO_INTERNET);
  assert.equal(h.calls.operators, 0);
  assert.equal(h.store.snapshot().level, LEVEL.NO_INTERNET);
  assert.equal(h.store.stored().firstDownAt, null);
});

test('internet up and operators down: Spark down, and Spark status is read once', async () => {
  const h = harness();
  assert.equal(await h.checker.check(), VERDICT.SPARK_DOWN);
  h.clock.t += 3 * MIN;
  assert.equal(await h.checker.check(), VERDICT.SPARK_DOWN);
  assert.equal(h.store.snapshot().level, LEVEL.UNREACHABLE);
  assert.equal(h.calls.status, 1, 'status is cached');
  assert.equal(h.store.snapshot().status, 'major');
});

test('one operator away is no outage', async () => {
  const h = harness();
  h.env.operators = { total: 3, failed: 1 };
  assert.equal(await h.checker.check(), VERDICT.ANSWERED);
});

test('recent Spark traffic answers without any probe', async () => {
  const h = harness();
  h.env.recent = true;
  assert.equal(await h.checker.check(), VERDICT.ANSWERED);
  assert.deepEqual([h.calls.diagnose, h.calls.operators], [0, 0]);
});

test('no checks while hidden, during warm-up, or without a Spark wallet', async () => {
  const h = harness();
  h.env.visible = false;
  assert.equal(await h.checker.check(), VERDICT.UNKNOWN);
  h.env.visible = true;
  h.checker.noteOnline();
  assert.equal(await h.checker.check(), VERDICT.UNKNOWN, 'right after reconnecting');
  h.clock.t += CHECK_RULES.warmUpMs + 1;
  h.env.enabled = false;
  assert.equal(await h.checker.check(), VERDICT.UNKNOWN);
  assert.equal(h.calls.diagnose, 0);
});

test('hidden while the check ran: the answers prove nothing', async () => {
  const h = harness({});
  h.env.operators = { total: 3, failed: 3 };
  const pending = h.checker.check();
  h.env.visible = false;
  assert.equal(await pending, VERDICT.UNKNOWN);
  assert.equal(h.store.stored().firstDownAt, null);
});

test('Try again skips the warm-up and the cached connection', async () => {
  const h = harness();
  h.env.connection = 'no-internet';
  await h.checker.check();
  h.checker.noteOnline();
  h.env.connection = 'service';
  h.env.operators = { total: 3, failed: 0 };
  assert.equal(await h.checker.checkNow(), VERDICT.ANSWERED);
  assert.equal(h.store.snapshot().level, LEVEL.NONE);
});

test('failed sync attempts ask for one check after the warm-up, never record by themselves', async () => {
  const h = harness();
  h.checker.noteVisible();
  h.checker.reportFailedAttempt();
  h.checker.reportFailedAttempt();
  h.checker.reportFailedAttempt();
  assert.equal(h.store.stored().firstDownAt, null, 'nothing recorded yet');
  assert.equal(h.timers.length, 1, 'one check for the burst');
  assert.ok(h.timers[0].at >= h.clock.t + CHECK_RULES.warmUpMs);
  await h.runTimers();
  assert.equal(h.calls.operators, 1);
  assert.ok(h.store.stored().firstDownAt);
});

test('server errors only, internet up: Spark down even when operators answer', async () => {
  const h = harness();
  h.env.operators = { total: 3, failed: 0 };
  h.checker.reportFailedAttempt({ errored: true });
  await h.runTimers();
  assert.equal(h.store.stored().firstDownAt != null, true);
});

test('an hour away starts a new session; a short switch does not', async () => {
  const h = harness();
  let sessions = 0;
  const original = h.store.newSession;
  h.store.newSession = (...args) => { sessions += 1; return original(...args); };
  h.checker.noteHidden();
  h.clock.t += 10 * MIN;
  h.checker.noteVisible();
  assert.equal(sessions, 0);
  h.checker.noteHidden();
  h.clock.t += CHECK_RULES.sessionBreakMs;
  h.checker.noteVisible();
  assert.equal(sessions, 1);
});

test('the phone going offline shows no internet at once', () => {
  const h = harness();
  h.checker.noteOffline();
  assert.equal(h.store.snapshot().level, LEVEL.NO_INTERNET);
});

test('a status page that cannot be read counts as unavailable', async () => {
  const h = harness();
  h.env.status = new Error('down');
  await h.checker.check();
  assert.equal(h.store.snapshot().status, 'unavailable');
});

test('concurrent checks share one run', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.checker.check(), h.checker.check()]);
  assert.equal(a, b);
  assert.equal(h.calls.operators, 1);
});
