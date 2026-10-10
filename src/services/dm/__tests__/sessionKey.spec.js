/**
 * Session key tests.
 *
 * The session key is the one place the identity's secret key lives in memory,
 * so the cases that matter are the races: a wipe during a load, a wipe between
 * the load and the caller, a loader that returns the wrong key, and a callback
 * that tries to outlive the wipe. Timers are injected, so nothing waits.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/sessionKey.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey } from 'nostr-core';
import { DmError } from '../errors.js';
import { WIPE_REASON, createSessionKey } from '../sessionKey.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const SECRET = generateSecretKey();
const PUBKEY = getPublicKey(SECRET);
const isCode = (code) => (err) => DmError.is(err, code);

/** A loader handing out a fresh copy of the key, remembering every copy. */
function createLoader({ secret = SECRET } = {}) {
  const handed = [];
  const load = async () => {
    const copy = new Uint8Array(secret);
    handed.push(copy);
    return copy;
  };
  return { load, handed };
}

/** A loader whose result the test releases by hand. */
function createDeferredLoader() {
  const handed = [];
  const pending = [];
  const load = () => new Promise((resolve, reject) => {
    pending.push({
      resolve: (secret = SECRET) => {
        const copy = new Uint8Array(secret);
        handed.push(copy);
        resolve(copy);
      },
      reject,
    });
  });
  return { load, handed, pending };
}

function createTimers() {
  let next = 1;
  const scheduled = new Map();
  const cleared = [];
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => {
      cleared.push(id);
      scheduled.delete(id);
    },
    fire: () => {
      for (const [id, { fn }] of [...scheduled]) {
        scheduled.delete(id);
        fn();
      }
    },
    scheduled,
    cleared,
  };
}

function setup(options = {}) {
  const loader = options.loader ?? createLoader();
  const timers = createTimers();
  const wipes = [];
  const key = createSessionKey({
    load: loader.load,
    pubkey: PUBKEY,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onWipe: (reason) => wipes.push(reason),
    ...options.overrides,
  });
  return { key, loader, timers, wipes };
}

const isZero = (bytes) => bytes.every((b) => b === 0);

// ---------------------------------------------------------------------------
// WIPE_REASON
// ---------------------------------------------------------------------------

test('WIPE_REASON is a frozen enum of the five reasons', () => {
  assert.deepEqual(
    { ...WIPE_REASON },
    { LOCK: 'lock', IDLE: 'idle', IDENTITY_CHANGE: 'identity-change', RESET: 'reset', DISPOSE: 'dispose' },
  );
  assert.ok(Object.isFrozen(WIPE_REASON));
  assert.throws(() => { WIPE_REASON.LOCK = 'x'; }, TypeError);
  assert.throws(() => { WIPE_REASON.NEW = 'new'; }, TypeError);
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const BAD_OPTIONS = [
  ['no options', undefined],
  ['no load', { pubkey: PUBKEY }],
  ['a non-function load', { load: 'key', pubkey: PUBKEY }],
  ['no pubkey', { load: async () => SECRET }],
  ['an uppercase pubkey', { load: async () => SECRET, pubkey: PUBKEY.toUpperCase() }],
  ['a short pubkey', { load: async () => SECRET, pubkey: PUBKEY.slice(2) }],
  ['a non-string pubkey', { load: async () => SECRET, pubkey: 7 }],
];

for (const [name, options] of BAD_OPTIONS) {
  test(`createSessionKey rejects ${name}`, () => {
    assert.throws(() => createSessionKey(options), isCode('INVALID_ARGUMENT'));
  });
}

test('createSessionKey does not load anything by itself', () => {
  const { key, loader } = setup();
  assert.equal(loader.handed.length, 0);
  assert.equal(key.isLoaded(), false);
});

// ---------------------------------------------------------------------------
// use()
// ---------------------------------------------------------------------------

test('use hands the 32-byte key to the callback and returns its result', async () => {
  const { key } = setup();
  const seen = [];
  const result = await key.use((bytes) => {
    seen.push(bytes);
    return { derived: getPublicKey(bytes) };
  });
  assert.deepEqual(result, { derived: PUBKEY });
  assert.ok(seen[0] instanceof Uint8Array);
  assert.equal(seen[0].length, 32);
  assert.equal(key.isLoaded(), true);
});

test('use loads once and reuses the bytes', async () => {
  const { key, loader } = setup();
  await key.use(() => {});
  await key.use(() => {});
  await key.use(() => {});
  assert.equal(loader.handed.length, 1);
});

test('concurrent first uses share one load', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const results = [key.use(() => 1), key.use(() => 2), key.use(() => 3)];
  await flush();
  assert.equal(deferred.pending.length, 1);
  deferred.pending[0].resolve();
  assert.deepEqual(await Promise.all(results), [1, 2, 3]);
});

test('use returns whatever the callback returns, including non-promises and falsy values', async () => {
  const { key } = setup();
  for (const value of [undefined, null, 0, '', false, 'sig', { a: 1 }]) {
    assert.deepEqual(await key.use(() => value), value);
  }
});

test('use rejects a non-function callback with a TypeError', async () => {
  const { key } = setup();
  for (const bad of [undefined, null, 'fn', {}, 42]) {
    await assert.rejects(key.use(bad), TypeError);
  }
});

test('the callback\'s own errors propagate unchanged', async () => {
  const { key } = setup();
  const boom = new RangeError('callback failed');
  await assert.rejects(key.use(() => { throw boom; }), (err) => err === boom);
  const dm = new DmError('TIMEOUT', 'mine');
  await assert.rejects(key.use(() => { throw dm; }), (err) => err === dm);
  assert.equal(key.isLoaded(), true);
});

test('an async callback is refused and its rejection stays handled', async () => {
  const { key } = setup();
  await assert.rejects(
    key.use(async () => 'later'),
    (err) => err instanceof TypeError && err.message === 'use() callbacks must be synchronous',
  );
  await assert.rejects(
    key.use(() => ({ then() {} })),
    (err) => err instanceof TypeError && /synchronous/.test(err.message),
  );
  // A rejected async callback must not surface as an unhandled rejection.
  await assert.rejects(key.use(async () => { throw new Error('inner'); }), TypeError);
  await flush();
});

// ---------------------------------------------------------------------------
// Load failures and validation
// ---------------------------------------------------------------------------

test('a load failure becomes NO_IDENTITY with the original as cause', async () => {
  const cause = Object.assign(new Error('No identity seed'), { code: 'IDENTITY_NOT_BOOTSTRAPPED' });
  const { key } = setup({ overrides: { load: async () => { throw cause; } } });
  await assert.rejects(key.use(() => {}), (err) => DmError.is(err, 'NO_IDENTITY') && err.cause === cause);
  assert.equal(key.isLoaded(), false);
});

test('a synchronously throwing loader also becomes NO_IDENTITY', async () => {
  const { key } = setup({ overrides: { load: () => { throw new Error('sync'); } } });
  await assert.rejects(key.use(() => {}), isCode('NO_IDENTITY'));
});

test('a DmError from the loader is passed through as is', async () => {
  const original = new DmError('KEY_WIPED', 'from loader');
  const { key } = setup({ overrides: { load: async () => { throw original; } } });
  await assert.rejects(key.use(() => {}), (err) => err === original);
});

test('a failed load is not remembered: the next use loads again', async () => {
  let calls = 0;
  const { key } = setup({
    overrides: {
      load: async () => {
        calls += 1;
        if (calls === 1) throw new Error('flaky');
        return new Uint8Array(SECRET);
      },
    },
  });
  await assert.rejects(key.use(() => {}), isCode('NO_IDENTITY'));
  assert.equal(await key.use(() => 'ok'), 'ok');
  assert.equal(calls, 2);
});

test('concurrent callers of a failing load all get the error', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const a = key.use(() => {});
  const b = key.use(() => {});
  await flush();
  deferred.pending[0].reject(new Error('nope'));
  await assert.rejects(a, isCode('NO_IDENTITY'));
  await assert.rejects(b, isCode('NO_IDENTITY'));
});

const BAD_LOADED = [
  ['undefined', () => undefined],
  ['null', () => null],
  ['a string', () => 'ab'.repeat(32)],
  ['a plain array', () => Array.from(SECRET)],
  ['31 bytes', () => new Uint8Array(31).fill(7)],
  ['33 bytes', () => new Uint8Array(33).fill(7)],
  ['an empty array', () => new Uint8Array(0)],
  ['an all-zero key', () => new Uint8Array(32)],
];

for (const [name, make] of BAD_LOADED) {
  test(`a loader returning ${name} is rejected as NO_IDENTITY`, async () => {
    const { key } = setup({ overrides: { load: async () => make() } });
    await assert.rejects(key.use(() => 'never'), isCode('NO_IDENTITY'));
    assert.equal(key.isLoaded(), false);
  });
}

test('a malformed key from the loader is zeroed', async () => {
  const bad = new Uint8Array(31).fill(9);
  const { key } = setup({ overrides: { load: async () => bad } });
  await assert.rejects(key.use(() => {}), isCode('NO_IDENTITY'));
  assert.ok(isZero(bad));
});

test('a key of another identity is rejected as KEY_WIPED and zeroed', async () => {
  const handed = [];
  const { key } = setup({
    overrides: {
      load: async () => {
        const other = generateSecretKey();
        handed.push(other);
        return other;
      },
    },
  });
  let called = false;
  await assert.rejects(key.use(() => { called = true; }), isCode('KEY_WIPED'));
  assert.equal(called, false);
  assert.ok(isZero(handed[0]));
  assert.equal(key.isLoaded(), false);
});

// ---------------------------------------------------------------------------
// wipe()
// ---------------------------------------------------------------------------

test('wipe zeroes the bytes the callback was given', async () => {
  const { key, loader } = setup();
  let held;
  await key.use((bytes) => { held = bytes; });
  assert.ok(!isZero(held));
  key.wipe(WIPE_REASON.LOCK);
  assert.ok(isZero(held));
  assert.ok(isZero(loader.handed[0]));
  assert.equal(key.isLoaded(), false);
});

test('after a wipe the next use loads a fresh key', async () => {
  const { key, loader } = setup();
  await key.use(() => {});
  key.wipe(WIPE_REASON.LOCK);
  const derived = await key.use((bytes) => getPublicKey(bytes));
  assert.equal(derived, PUBKEY);
  assert.equal(loader.handed.length, 2);
});

test('wipe reports each wipe of loaded bytes with its reason', async () => {
  const { key, wipes } = setup();
  key.wipe(WIPE_REASON.LOCK);
  assert.deepEqual(wipes, []);
  await key.use(() => {});
  key.wipe(WIPE_REASON.IDENTITY_CHANGE);
  await key.use(() => {});
  key.wipe(WIPE_REASON.RESET);
  assert.deepEqual(wipes, ['identity-change', 'reset']);
});

test('wipe without anything loaded, repeated, or without a reason is harmless', async () => {
  const { key } = setup();
  key.wipe();
  key.wipe(WIPE_REASON.LOCK);
  key.wipe('made-up');
  assert.equal(await key.use(() => 'ok'), 'ok');
  key.wipe();
  key.wipe();
  assert.equal(key.isLoaded(), false);
});

test('wipe never throws, even when onWipe or clearTimer do', async () => {
  const timers = createTimers();
  const key = createSessionKey({
    load: createLoader().load,
    pubkey: PUBKEY,
    setTimer: timers.setTimer,
    clearTimer: () => { throw new Error('clearTimer failed'); },
    onWipe: () => { throw new Error('listener failed'); },
  });
  await key.use(() => {});
  key.wipeAfter(1_000);
  assert.doesNotThrow(() => key.wipe(WIPE_REASON.LOCK));
  assert.equal(key.isLoaded(), false);
});

test('a callback holding the bytes sees zeros after the wipe, not a key', async () => {
  const { key } = setup();
  let held;
  await key.use((bytes) => { held = bytes; });
  key.wipe();
  assert.equal(held.length, 32);
  assert.ok(isZero(held));
});

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

test('a wipe during the load zeroes the loaded bytes and rejects with KEY_WIPED', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  let called = false;
  const pending = key.use(() => { called = true; });
  await flush();
  key.wipe(WIPE_REASON.LOCK);
  deferred.pending[0].resolve();
  await assert.rejects(pending, isCode('KEY_WIPED'));
  assert.equal(called, false);
  assert.ok(isZero(deferred.handed[0]));
  assert.equal(key.isLoaded(), false);
});

test('a wipe during the load rejects every waiting caller', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const a = key.use(() => {});
  const b = key.use(() => {});
  await flush();
  key.wipe();
  deferred.pending[0].resolve();
  await assert.rejects(a, isCode('KEY_WIPED'));
  await assert.rejects(b, isCode('KEY_WIPED'));
});

test('a use after a mid-load wipe starts its own load and succeeds', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const stale = key.use(() => 'stale');
  await flush();
  key.wipe();
  const fresh = key.use((bytes) => getPublicKey(bytes));
  await flush();
  assert.equal(deferred.pending.length, 2);
  deferred.pending[1].resolve();
  deferred.pending[0].resolve();
  await assert.rejects(stale, isCode('KEY_WIPED'));
  assert.equal(await fresh, PUBKEY);
  assert.equal(key.isLoaded(), true);
});

test('the stale load\'s bytes are zeroed while the fresh load stays intact', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const stale = key.use(() => {});
  await flush();
  key.wipe();
  const fresh = key.use(() => {});
  await flush();
  deferred.pending[0].resolve(); // handed[0], stale
  deferred.pending[1].resolve(); // handed[1], fresh
  await assert.rejects(stale, isCode('KEY_WIPED'));
  await fresh;
  assert.ok(isZero(deferred.handed[0]));
});

test('a wipe after the load finished but before a waiting caller resumes rejects that caller', async () => {
  const { key, loader } = setup();
  let secondCalled = false;
  // Both callers wait on the same load. The first one's callback wipes the key, so by
  // the time the second resumes the bytes are zeroed: it must not receive them.
  const first = key.use(() => { key.wipe(WIPE_REASON.LOCK); return 'first'; });
  const second = key.use(() => { secondCalled = true; });
  assert.equal(await first, 'first');
  await assert.rejects(second, isCode('KEY_WIPED'));
  assert.equal(secondCalled, false);
  assert.ok(isZero(loader.handed[0]));
});

test('a wipe in the same turn as the load resolving discards the key', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const pending = key.use(() => 'x');
  await flush();
  deferred.pending[0].resolve();
  key.wipe(WIPE_REASON.LOCK);
  await assert.rejects(pending, isCode('KEY_WIPED'));
  assert.ok(isZero(deferred.handed[0]));
  assert.equal(key.isLoaded(), false);
});

// ---------------------------------------------------------------------------
// wipeAfter / cancelWipe
// ---------------------------------------------------------------------------

test('wipeAfter schedules a wipe with the given delay and fires it as idle', async () => {
  const { key, timers, wipes } = setup();
  await key.use(() => {});
  key.wipeAfter(600_000);
  assert.equal(timers.scheduled.size, 1);
  assert.equal([...timers.scheduled.values()][0].ms, 600_000);
  assert.equal(key.isLoaded(), true);
  timers.fire();
  assert.equal(key.isLoaded(), false);
  assert.deepEqual(wipes, ['idle']);
});

test('the idle wipe zeroes the bytes', async () => {
  const { key, timers } = setup();
  let held;
  await key.use((bytes) => { held = bytes; });
  key.wipeAfter(10);
  timers.fire();
  assert.ok(isZero(held));
});

test('wipeAfter replaces a previous schedule', async () => {
  const { key, timers } = setup();
  await key.use(() => {});
  key.wipeAfter(1_000);
  key.wipeAfter(2_000);
  assert.equal(timers.scheduled.size, 1);
  assert.equal([...timers.scheduled.values()][0].ms, 2_000);
  assert.equal(timers.cleared.length, 1);
});

test('cancelWipe cancels the schedule and the key stays loaded', async () => {
  const { key, timers } = setup();
  await key.use(() => {});
  key.wipeAfter(1_000);
  key.cancelWipe();
  assert.equal(timers.scheduled.size, 0);
  timers.fire();
  assert.equal(key.isLoaded(), true);
});

test('cancelWipe without a schedule is harmless', () => {
  const { key, timers } = setup();
  key.cancelWipe();
  assert.equal(timers.cleared.length, 0);
});

test('an explicit wipe cancels a scheduled one', async () => {
  const { key, timers } = setup();
  await key.use(() => {});
  key.wipeAfter(1_000);
  key.wipe(WIPE_REASON.LOCK);
  assert.equal(timers.scheduled.size, 0);
});

test('a scheduled wipe also abandons a load that is in flight', async () => {
  const deferred = createDeferredLoader();
  const { key, timers } = setup({ loader: deferred });
  const pending = key.use(() => {});
  await flush();
  key.wipeAfter(10);
  timers.fire();
  deferred.pending[0].resolve();
  await assert.rejects(pending, isCode('KEY_WIPED'));
  assert.ok(isZero(deferred.handed[0]));
});

for (const bad of [-1, NaN, Infinity, '1000', null, undefined, {}]) {
  test(`wipeAfter ignores the invalid delay ${String(bad)}`, async () => {
    const { key, timers } = setup();
    await key.use(() => {});
    key.wipeAfter(1_000);
    key.wipeAfter(bad);
    assert.equal(timers.scheduled.size, 1);
    assert.equal([...timers.scheduled.values()][0].ms, 1_000);
  });
}

test('wipeAfter(0) schedules an immediate wipe', async () => {
  const { key, timers } = setup();
  await key.use(() => {});
  key.wipeAfter(0);
  timers.fire();
  assert.equal(key.isLoaded(), false);
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

test('dispose wipes the key and refuses further use with KEY_WIPED', async () => {
  const { key, loader, wipes } = setup();
  let held;
  await key.use((bytes) => { held = bytes; });
  key.dispose();
  assert.ok(isZero(held));
  assert.equal(key.isLoaded(), false);
  assert.deepEqual(wipes, ['dispose']);
  let called = false;
  await assert.rejects(key.use(() => { called = true; }), isCode('KEY_WIPED'));
  assert.equal(called, false);
  assert.equal(loader.handed.length, 1);
});

test('dispose before any use never loads the key', async () => {
  const { key, loader } = setup();
  key.dispose();
  await assert.rejects(key.use(() => {}), isCode('KEY_WIPED'));
  assert.equal(loader.handed.length, 0);
});

test('dispose during a load discards the loaded bytes', async () => {
  const deferred = createDeferredLoader();
  const { key } = setup({ loader: deferred });
  const pending = key.use(() => {});
  await flush();
  key.dispose();
  deferred.pending[0].resolve();
  await assert.rejects(pending, isCode('KEY_WIPED'));
  assert.ok(isZero(deferred.handed[0]));
  assert.equal(key.isLoaded(), false);
});

test('dispose cancels a scheduled wipe, is idempotent, and wipeAfter becomes a no-op', async () => {
  const { key, timers } = setup();
  await key.use(() => {});
  key.wipeAfter(1_000);
  key.dispose();
  key.dispose();
  assert.equal(timers.scheduled.size, 0);
  key.wipeAfter(1_000);
  assert.equal(timers.scheduled.size, 0);
  key.wipe();
  assert.equal(key.isLoaded(), false);
});
