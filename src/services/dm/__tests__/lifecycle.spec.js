/**
 * Chat lifecycle tests: identity switch isolation, lock, hidden / visible,
 * online, the retry throttle and the kiosk guard.
 *
 * Everything the lifecycle touches is a recording fake, and one shared event
 * log proves the ORDER of the steps that matter (the old runtime is disposed
 * before the store changes scope, the key is wiped when the lock engages).
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/lifecycle.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY_IDLE_WIPE_MS } from '../constants.js';
import { RESUME_MIN_INTERVAL_MS, startChatLifecycle } from '../lifecycle.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function setup({ pubkey = A, locked = false, hidden = false, suspended = false, startFails = false } = {}) {
  const log = [];
  const env = {
    log,
    locked,
    hidden,
    suspended,
    startFails,
    ms: 1_000_000,
    runtimes: [],
    published: [],
    scopes: [],
    deleted: [],
    flushes: 0,
  };

  const watchers = new Set();
  const lockWatchers = new Set();
  const visibilityWatchers = new Set();
  const onlineWatchers = new Set();
  const suspendWatchers = new Set();
  let unlockKnown;
  const lockKnown = new Promise((resolve) => { unlockKnown = resolve; });
  env.lockKnown = () => unlockKnown();

  env.identity = {
    bootstrapped: pubkey !== null,
    nostrPubkeyHex: pubkey,
    hydrate: async () => {},
    loadNostrIdentity: async () => {},
    /** Rotation or switch to `next`; `null` is a reset. */
    change(next, { reset = false } = {}) {
      env.identity.nostrPubkeyHex = next;
      if (reset) env.identity.bootstrapped = false;
      for (const cb of watchers) cb(next);
    },
  };

  env.messages = {
    setScope: async (next) => { log.push(`scope:${next === null ? 'none' : next[0]}`); env.scopes.push(next); },
    flush: async () => { log.push('flush'); env.flushes += 1; },
    deleteAllHistory: async () => { log.push('delete:all'); env.deleted.push('all'); },
  };

  env.createRuntime = (pk) => {
    const runtime = {
      pubkey: pk,
      calls: [],
      disposed: false,
      start: async () => {
        runtime.calls.push('start');
        log.push(`start:${pk[0]}`);
        if (env.startFails) throw new Error('relay down');
      },
      dispose: () => { runtime.disposed = true; runtime.calls.push('dispose'); log.push(`dispose:${pk[0]}`); },
      wipeKey: (reason) => { runtime.calls.push(`wipeKey:${reason}`); log.push(`wipe:${reason}`); },
      wipeKeyAfter: (ms) => { runtime.calls.push(`wipeKeyAfter:${ms}`); },
      cancelKeyWipe: () => { runtime.calls.push('cancelKeyWipe'); },
      retryOutbox: async (options) => { runtime.calls.push(`retry:${JSON.stringify(options ?? {})}`); return { attempted: 0 }; },
      resubscribe: () => { runtime.calls.push('resubscribe'); },
      stop: () => { runtime.calls.push('stop'); },
      settleClaims: async () => { runtime.calls.push('settleClaims'); return { settled: 0, pending: 0 }; },
      reconcileOwnPayments: async () => { runtime.calls.push('reconcile'); return { announced: 0, settled: 0, failed: 0 }; },
    };
    env.runtimes.push(runtime);
    return runtime;
  };

  env.lifecycle = startChatLifecycle({
    identity: env.identity,
    watchIdentity: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    messages: env.messages,
    createRuntime: env.createRuntime,
    publish: (runtime) => { env.published.push(runtime); log.push(`publish:${runtime ? runtime.pubkey[0] : 'null'}`); },
    lock: { isLocked: () => env.locked, whenKnown: () => lockKnown },
    onLockChange: (cb) => { lockWatchers.add(cb); return () => lockWatchers.delete(cb); },
    onVisibility: (cb) => { visibilityWatchers.add(cb); return () => visibilityWatchers.delete(cb); },
    onOnline: (cb) => { onlineWatchers.add(cb); return () => onlineWatchers.delete(cb); },
    isHidden: () => env.hidden,
    isSuspended: () => env.suspended,
    onSuspendChange: (cb) => { suspendWatchers.add(cb); return () => suspendWatchers.delete(cb); },
    now: () => env.ms,
  });

  env.setLocked = (value) => { env.locked = value; for (const cb of lockWatchers) cb(value); };
  env.setVisible = (visible) => { for (const cb of visibilityWatchers) cb(visible); };
  env.goOnline = () => { for (const cb of onlineWatchers) cb(); };
  env.setSuspended = (value) => { env.suspended = value; for (const cb of suspendWatchers) cb(value); };
  env.current = () => env.runtimes[env.runtimes.length - 1];
  env.callsOf = (runtime = env.current()) => runtime.calls;
  return env;
}

/** Launch: the lock state is known (App.vue reported) and everything settled. */
async function launched(options) {
  const env = setup(options);
  env.lockKnown();
  await env.lifecycle.whenSettled();
  await flush();
  return env;
}

const retries = (runtime) => runtime.calls.filter((c) => c.startsWith('retry:'));

// ---------------------------------------------------------------------------

test('at launch the scope is set, the runtime is published and started', async () => {
  const env = await launched();
  assert.deepEqual(env.scopes, [A]);
  assert.equal(env.runtimes.length, 1);
  assert.equal(env.published[0], env.current());
  assert.deepEqual(env.callsOf(), ['start']);
  assert.deepEqual(env.log, ['scope:a', 'publish:a', 'start:a']);
});

test('without an identity nothing is created and the store scope is cleared', async () => {
  const env = await launched({ pubkey: null });
  assert.deepEqual(env.scopes, [null]);
  assert.equal(env.runtimes.length, 0);
});

test('an identity that appears later (onboarding) gets its runtime', async () => {
  const env = await launched({ pubkey: null });
  env.identity.change(A);
  await env.lifecycle.whenSettled();
  assert.deepEqual(env.scopes, [null, A]);
  assert.equal(env.current().pubkey, A);
  assert.deepEqual(env.callsOf(), ['start']);
});

test('launched while locked: the runtime exists for the UI but does not start until the app unlocks', async () => {
  const env = await launched({ locked: true });
  assert.equal(env.published[0], env.current());
  assert.deepEqual(env.callsOf(), [], 'no key, no connection while locked');

  env.setLocked(false);
  await flush();
  assert.deepEqual(env.callsOf(), ['start', 'settleClaims', 'reconcile']);
});

test('nothing starts before App.vue reports the lock state', async () => {
  const env = setup();
  await flush();
  assert.equal(env.runtimes.length, 1, 'created');
  assert.deepEqual(env.callsOf(), [], 'but not started');
  env.lockKnown();
  await env.lifecycle.whenSettled();
  assert.deepEqual(env.callsOf(), ['start']);
});

test('identity switch: the old runtime is disposed before the store changes scope, the new one starts clean', async () => {
  const env = await launched();
  const first = env.current();
  env.log.length = 0;
  env.identity.change(B);
  await env.lifecycle.whenSettled();

  assert.deepEqual(env.log, ['dispose:a', 'publish:null', 'scope:b', 'publish:b', 'start:b']);
  assert.equal(first.disposed, true);
  assert.equal(env.current().pubkey, B);
  assert.deepEqual(env.deleted, [], 'a switch keeps the old identity\'s history');
});

test('rapid switches: only the last identity ends up with a runtime', async () => {
  const env = await launched();
  env.identity.change(B);
  env.identity.change(A);
  env.identity.change(B);
  await env.lifecycle.whenSettled();
  const alive = env.runtimes.filter((r) => !r.disposed);
  assert.equal(alive.length, 1);
  assert.equal(alive[0].pubkey, B);
  assert.equal(env.published[env.published.length - 1], alive[0]);
  assert.equal(env.scopes[env.scopes.length - 1], B);
});

test('the same identity reported twice does not rebuild the runtime', async () => {
  const env = await launched();
  env.identity.change(A);
  await env.lifecycle.whenSettled();
  assert.equal(env.runtimes.length, 1);
});

test('identity reset: runtime disposed, every chat history deleted, no runtime until a new identity exists', async () => {
  const env = await launched();
  env.log.length = 0;
  env.identity.change(null, { reset: true });
  await env.lifecycle.whenSettled();
  assert.deepEqual(env.log, ['dispose:a', 'publish:null', 'delete:all', 'scope:none']);
  assert.equal(env.runtimes.length, 1);
  assert.equal(env.published[env.published.length - 1], null);
});

test('losing the pubkey without a reset keeps the history', async () => {
  const env = await launched();
  env.identity.change(null);
  await env.lifecycle.whenSettled();
  assert.deepEqual(env.deleted, []);
});

test('lock: the key is wiped and the store flushed, in that order', async () => {
  const env = await launched();
  env.log.length = 0;
  env.setLocked(true);
  await flush();
  assert.deepEqual(env.log, ['wipe:lock', 'flush']);
});

test('unlock after a lock: the outbox is retried (backoff respected) and payment claims checked, no restart', async () => {
  const env = await launched();
  env.setLocked(true);
  env.setLocked(false);
  await flush();
  assert.deepEqual(env.callsOf(), ['start', 'wipeKey:lock', 'resubscribe', 'retry:{}', 'settleClaims', 'reconcile']);
});

test('hidden: the key wipe is scheduled and the store flushed; visible cancels it', async () => {
  const env = await launched();
  env.setVisible(false);
  await flush();
  assert.ok(env.callsOf().includes(`wipeKeyAfter:${KEY_IDLE_WIPE_MS}`));
  assert.equal(env.flushes, 1);

  env.ms += RESUME_MIN_INTERVAL_MS + 1;
  env.setVisible(true);
  await flush();
  assert.ok(env.callsOf().includes('cancelKeyWipe'));
  assert.ok(env.callsOf().includes('resubscribe'), 'relays given up on in the background are read again');
  assert.deepEqual(retries(env.current()), ['retry:{"ignoreBackoff":true}']);
  assert.ok(env.callsOf().includes('settleClaims'));
});

test('repeated visibility reports of the same state are ignored', async () => {
  const env = await launched();
  env.setVisible(false);
  env.setVisible(false);
  await flush();
  assert.equal(env.callsOf().filter((c) => c.startsWith('wipeKeyAfter')).length, 1);
  assert.equal(env.flushes, 1);
});

test('a runtime created while the app is in the background gets the idle wipe at once', async () => {
  const env = await launched({ hidden: true });
  assert.ok(env.callsOf().includes(`wipeKeyAfter:${KEY_IDLE_WIPE_MS}`));
});

test('visible and online resumes are throttled to one retry per window', async () => {
  const env = await launched();
  const runtime = env.current();
  env.ms += RESUME_MIN_INTERVAL_MS;

  env.setVisible(false);
  env.setVisible(true);
  await flush();
  env.goOnline();
  await flush();
  assert.equal(retries(runtime).length, 1, 'visible and online together cost one attempt');

  env.ms += RESUME_MIN_INTERVAL_MS - 1;
  env.goOnline();
  await flush();
  assert.equal(retries(runtime).length, 1, 'still inside the window');

  env.ms += 1;
  env.goOnline();
  await flush();
  assert.equal(retries(runtime).length, 2, 'a full window later it runs again');
  assert.ok(retries(runtime).every((c) => c === 'retry:{"ignoreBackoff":true}'));
});

test('a resume right after start does not retry again (start already did)', async () => {
  const env = await launched();
  env.goOnline();
  await flush();
  assert.equal(retries(env.current()).length, 0);
});

test('nothing resumes while locked', async () => {
  const env = await launched({ locked: true });
  env.ms += 10 * RESUME_MIN_INTERVAL_MS;
  env.goOnline();
  env.setVisible(false);
  env.setVisible(true);
  await flush();
  assert.deepEqual(env.callsOf().filter((c) => c === 'start' || c.startsWith('retry')), []);
});

test('a start that failed is tried again on the next trigger', async () => {
  const env = await launched({ startFails: true });
  assert.deepEqual(env.callsOf(), ['start']);
  env.startFails = false;
  env.goOnline();
  await flush();
  assert.deepEqual(env.callsOf(), ['start', 'start']);
});

test('a suspended device (kiosk) never starts the chat', async () => {
  const env = await launched({ suspended: true });
  env.goOnline();
  env.setLocked(true);
  env.setLocked(false);
  await flush();
  assert.equal(env.callsOf().includes('start'), false);
  env.suspended = false;
  env.goOnline();
  await flush();
  assert.equal(env.callsOf().includes('start'), true);
});

test('kiosk mode turned on while running stops the chat; turned off starts it again', async () => {
  const env = await launched();
  assert.ok(env.callsOf().includes('start'));
  env.setSuspended(true);
  await flush();
  assert.ok(env.callsOf().includes('stop'), 'no subscription and no notifications on a till');
  assert.equal(env.flushes, 1);
  env.setSuspended(false);
  await flush();
  assert.equal(env.callsOf().filter((c) => c === 'start').length, 2);
});

test('stop disposes the runtime, unpublishes it and stops reacting', async () => {
  const env = await launched();
  const runtime = env.current();
  env.lifecycle.stop();
  assert.equal(runtime.disposed, true);
  assert.equal(env.published[env.published.length - 1], null);
  const before = runtime.calls.length;
  env.setLocked(true);
  env.identity.change(B);
  await flush();
  assert.equal(runtime.calls.length, before);
  assert.equal(env.runtimes.length, 1);
});
