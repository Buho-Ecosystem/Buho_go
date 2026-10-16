import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyCheck, createSparkReachability, VERDICT, LEVEL, RULES, STORAGE_KEY, LEGACY_KEYS,
} from '../sparkReachability.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

function setup({ storage = memory(), start = 1_000_000_000_000, session = 's1' } = {}) {
  const clock = { t: start };
  const store = createSparkReachability({ storage, now: () => clock.t, sessionId: session });
  return { clock, store, storage };
}

/** Two Spark-down verdicts a few minutes apart: what a short outage looks like. */
function downTwice(store, clock) {
  store.record(VERDICT.SPARK_DOWN);
  clock.t += 3 * MIN;
  store.record(VERDICT.SPARK_DOWN);
}

test('a check blames Spark only when the internet works and two of three operators fail', () => {
  const internet = 'service';
  assert.equal(classifyCheck({ sparkAnswered: true, connection: 'no-internet' }), VERDICT.ANSWERED, 'any answer wins');
  assert.equal(classifyCheck({ connection: 'offline', operators: { total: 3, failed: 3 } }), VERDICT.NO_INTERNET);
  assert.equal(classifyCheck({ connection: 'no-internet', operators: { total: 3, failed: 3 } }), VERDICT.NO_INTERNET, 'dead VPN tunnel');
  assert.equal(classifyCheck({ connection: internet, operators: { total: 3, failed: 3 } }), VERDICT.SPARK_DOWN);
  assert.equal(classifyCheck({ connection: internet, operators: { total: 3, failed: 2 } }), VERDICT.SPARK_DOWN);
  assert.equal(classifyCheck({ connection: internet, operators: { total: 3, failed: 1 } }), VERDICT.ANSWERED, 'one operator away is normal');
  assert.equal(classifyCheck({ connection: internet, operators: { total: 3, failed: 0 } }), VERDICT.ANSWERED);
  assert.equal(classifyCheck({ connection: internet, operators: null }), VERDICT.UNKNOWN, 'no operator evidence');
  assert.equal(classifyCheck({ connection: null, operators: { total: 3, failed: 3 } }), VERDICT.UNKNOWN, 'internet not proven');
  assert.equal(classifyCheck({ connection: internet, sparkErrored: true, operators: { total: 3, failed: 0 } }), VERDICT.SPARK_DOWN, 'only server errors');
  assert.equal(classifyCheck({ connection: 'no-internet', sparkErrored: true }), VERDICT.NO_INTERNET);
});

test('no internet shows level 1 and never starts a Spark streak', () => {
  const { store, clock } = setup();
  store.record(VERDICT.NO_INTERNET);
  clock.t += 30 * HOUR;
  store.record(VERDICT.NO_INTERNET);
  assert.equal(store.snapshot().level, LEVEL.NO_INTERNET);
  assert.equal(store.stored().firstDownAt, null);
  assert.equal(store.stored().observedMs, 0);
});

test('one Spark-down verdict shows nothing; two, minutes apart, show level 2', () => {
  const { store, clock } = setup();
  store.record(VERDICT.SPARK_DOWN);
  assert.equal(store.snapshot().level, LEVEL.NONE, 'a single check is a blip');
  clock.t += 30 * 1000;
  store.record(VERDICT.SPARK_DOWN);
  assert.equal(store.snapshot().level, LEVEL.NONE, 'verdicts closer than the minimum gap count once');
  clock.t += RULES.minGapMs;
  store.record(VERDICT.SPARK_DOWN);
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE);
});

test('any answer clears the streak at once', () => {
  const { store, clock } = setup();
  downTwice(store, clock);
  store.record(VERDICT.ANSWERED);
  assert.equal(store.snapshot().level, LEVEL.NONE);
  assert.deepEqual([store.stored().firstDownAt, store.stored().observedMs], [null, 0]);
  assert.equal(store.stored().lastAnsweredAt, clock.t);
});

test('unknown changes nothing', () => {
  const { store, clock } = setup();
  downTwice(store, clock);
  const before = store.stored();
  store.record(VERDICT.UNKNOWN);
  assert.deepEqual(store.stored(), before);
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE);
});

test('time with the app closed adds nothing: gaps are capped', () => {
  const { store, clock } = setup();
  store.record(VERDICT.SPARK_DOWN);
  clock.t += 30 * HOUR; // closed for a day and more
  store.record(VERDICT.SPARK_DOWN);
  assert.equal(store.stored().observedMs, RULES.gapCapMs);
});

test('nothing shows from saved state alone: a new session needs its own verdicts', () => {
  const storage = memory();
  const first = setup({ storage, session: 'a' });
  downTwice(first.store, first.clock);
  assert.equal(first.store.snapshot().level, LEVEL.UNREACHABLE);
  // Reopened the next day: the record is there, the level is not.
  const later = createSparkReachability({ storage, now: () => first.clock.t + 20 * HOUR, sessionId: 'b' });
  assert.ok(later.stored().firstDownAt);
  assert.equal(later.snapshot().level, LEVEL.NONE);
});

test('a long silence or a clock that went back restarts the streak', () => {
  const { store, clock } = setup();
  store.record(VERDICT.SPARK_DOWN);
  const first = store.stored().firstDownAt;
  clock.t += RULES.streakResetMs + MIN;
  store.record(VERDICT.SPARK_DOWN);
  assert.notEqual(store.stored().firstDownAt, first);
  assert.equal(store.stored().observedMs, 0);
  const restartAt = clock.t;
  clock.t -= 2 * HOUR;
  store.record(VERDICT.SPARK_DOWN);
  assert.equal(store.stored().firstDownAt, clock.t, 'the clock went backwards');
  assert.ok(store.stored().firstDownAt < restartAt);
});

/** A real long outage: checks every 5 minutes for half an hour, in three sessions spread over a day. */
function longOutage(storage, clock) {
  let store;
  for (const [i, offset] of [0, 12 * HOUR, 25 * HOUR].entries()) {
    clock.t = 1_000_000_000_000 + offset;
    store = createSparkReachability({ storage, now: () => clock.t, sessionId: `s${i}` });
    for (let n = 0; n < 4; n += 1) {
      store.record(VERDICT.SPARK_DOWN);
      clock.t += 5 * MIN;
    }
  }
  clock.t -= 5 * MIN;
  return store;
}

test('level 3 needs three sessions over a day, real observed time and a fresh verdict', () => {
  const storage = memory();
  const clock = { t: 0 };
  const store = longOutage(storage, clock);
  store.setStatus('major');
  const record = store.stored();
  assert.equal(record.sessions.length, 3);
  assert.ok(record.observedMs >= RULES.longOutageObservedMs, `observed ${record.observedMs}`);
  assert.equal(store.snapshot().level, LEVEL.LONG_OUTAGE);
  assert.equal(store.snapshot().since, 1_000_000_000_000);
  clock.t += RULES.freshVerdictMs + MIN;
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE, 'an old verdict cannot hold level 3');
});

test('level 3 waits for Spark status, and "operational" holds it at level 2', () => {
  const storage = memory();
  const clock = { t: 0 };
  const store = longOutage(storage, clock);
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE, 'status not read yet');
  store.setStatus('operational');
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE);
  assert.equal(store.snapshot().blockedHere, true);
  store.setStatus('unavailable');
  assert.equal(store.snapshot().level, LEVEL.LONG_OUTAGE, 'a status page that is gone allows it');
});

test('two sessions are not enough for level 3', () => {
  const storage = memory();
  const clock = { t: 1_000_000_000_000 };
  for (const [i, offset] of [0, 25 * HOUR].entries()) {
    clock.t = 1_000_000_000_000 + offset;
    const s = createSparkReachability({ storage, now: () => clock.t, sessionId: `x${i}` });
    for (let n = 0; n < 8; n += 1) { s.record(VERDICT.SPARK_DOWN); clock.t += 5 * MIN; }
  }
  const store = createSparkReachability({ storage, now: () => clock.t, sessionId: 'x1' });
  store.record(VERDICT.SPARK_DOWN);
  clock.t += 3 * MIN;
  store.record(VERDICT.SPARK_DOWN);
  store.setStatus('major');
  assert.equal(store.snapshot().level, LEVEL.UNREACHABLE);
});

test('the old outage record and banner dismissal are deleted on upgrade', () => {
  const storage = memory({
    buhoGO_spark_health_v1: JSON.stringify({ w1: { firstFailureAt: 1, failures: 9 } }),
    buhoGO_exit_banner_dismissed_until: '123',
  });
  createSparkReachability({ storage });
  for (const key of LEGACY_KEYS) assert.equal(storage.getItem(key), null, key);
});

test('another tab writing a newer answer is never overwritten with a stale streak', () => {
  const storage = memory();
  const clock = { t: 1_000_000_000_000 };
  const tabA = createSparkReachability({ storage, now: () => clock.t, sessionId: 'a' });
  const tabB = createSparkReachability({ storage, now: () => clock.t, sessionId: 'b' });
  tabA.record(VERDICT.SPARK_DOWN);
  clock.t += 3 * MIN;
  tabB.record(VERDICT.ANSWERED);
  clock.t += 3 * MIN;
  tabA.record(VERDICT.SPARK_DOWN);
  const record = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(record.firstDownAt, clock.t, 'tab A started over after tab B saw an answer');
  assert.equal(record.observedMs, 0);
});

test('listeners hear every change; broken storage degrades to memory', () => {
  const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); }, removeItem() { throw new Error('nope'); } };
  const { store, clock } = setup({ storage: broken });
  const heard = [];
  const off = store.subscribe((snap) => heard.push(snap.level));
  downTwice(store, clock);
  assert.deepEqual(heard, [LEVEL.NONE, LEVEL.UNREACHABLE]);
  off();
  store.record(VERDICT.ANSWERED);
  assert.equal(heard.length, 2);
  assert.equal(store.snapshot().level, LEVEL.NONE);
});

test('clear forgets everything', () => {
  const { store, clock } = setup();
  downTwice(store, clock);
  store.setStatus('major');
  store.clear();
  assert.equal(store.snapshot().level, LEVEL.NONE);
  assert.equal(store.snapshot().status, null);
  assert.equal(store.stored().firstDownAt, null);
});
