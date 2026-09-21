import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressRequestState, createAddressRequestSession } from '../addressRequestSession.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(options = {}) {
  const state = addressRequestState();
  const calls = [];
  const identity = { identity: 'npubAlice', address: 'alice@example.com' };
  let allowed = true;
  const session = createAddressRequestSession({ state,
    resolve: async () => ({ callback: 'https://site.example/share', k1: 'a'.repeat(64) }),
    submit: async (request, address) => { calls.push({ request, address }); return 'confirmed'; },
    prepare: async () => {}, snapshot: () => ({ ...identity }), allowed: () => allowed,
    ...options,
  });
  return { state, session, calls, identity, block: () => { allowed = false; } };
}

test('request waits for availability; resolution never submits', async () => {
  const h = harness();
  assert.equal(h.session.open('request'), 'opened');
  await h.session.resume(); assert.equal(h.state.stage, 'waiting');
  h.state.available = true; await h.session.resume();
  assert.equal(h.state.stage, 'review'); assert.equal(h.calls.length, 0);
  await h.session.approve(); assert.equal(h.state.stage, 'confirmed'); assert.equal(h.calls.length, 1);
});

test('kiosk rejects intake and blocks approval independently of UI', async () => {
  const h = harness(); h.block();
  assert.equal(h.session.open('request'), 'blocked'); assert.equal(h.state.stage, 'idle');
  const second = harness(); second.state.available = true;
  second.session.open('request'); await second.session.resume(); second.block();
  await second.session.approve(); assert.equal(second.calls.length, 0);
});

test('duplicate intake and overlapping requests do not replace consent', async () => {
  const h = harness(); h.session.open('first');
  assert.equal(h.session.open('first'), 'duplicate');
  assert.equal(h.session.open('second'), 'busy');
  h.session.close(); assert.equal(h.session.open('second'), 'opened');
});

test('decline invalidates late resolution and aborts metadata work', async () => {
  const wait = deferred(); let signal;
  const h = harness({ resolve: async (_, opts) => { signal = opts.signal; return wait.promise; } });
  h.state.available = true; h.session.open('request'); const pending = h.session.resume();
  await Promise.resolve(); h.session.close();
  assert.equal(signal.aborted, true);
  wait.resolve({ callback: 'https://a.example/', k1: 'a'.repeat(64) }); await pending;
  assert.equal(h.state.stage, 'idle'); assert.equal(h.calls.length, 0);
});

test('identity changes during resolution require review', async () => {
  const wait = deferred(); const h = harness({ resolve: async () => wait.promise });
  h.state.available = true; h.session.open('request'); const pending = h.session.resume();
  await Promise.resolve(); h.identity.identity = 'npubBob';
  wait.resolve({ callback: 'https://a.example/', k1: 'a'.repeat(64) }); await pending;
  assert.equal(h.state.stage, 'changed'); await h.session.approve(); assert.equal(h.calls.length, 0);
});

test('approval rechecks address even if a watcher has not run', async () => {
  const h = harness(); h.state.available = true; h.session.open('request'); await h.session.resume();
  h.identity.address = 'bob@example.com'; await h.session.approve();
  assert.equal(h.state.stage, 'changed'); assert.equal(h.calls.length, 0);
  await h.session.review(); await h.session.approve(); assert.equal(h.calls[0].address, 'bob@example.com');
});

test('lock or background prevents submission', async () => {
  const h = harness(); h.state.available = true; h.session.open('request'); await h.session.resume();
  h.state.available = false; await h.session.approve(); assert.equal(h.calls.length, 0);
});

test('double tap and reopening a consumed request cannot submit twice', async () => {
  const wait = deferred(); let calls = 0;
  const h = harness({ submit: async () => { calls++; return wait.promise; } });
  h.state.available = true; h.session.open('request'); await h.session.resume();
  const first = h.session.approve(); await h.session.approve(); assert.equal(calls, 1);
  wait.resolve('unknown'); await first; assert.equal(h.state.stage, 'unknown');
  h.session.close(); h.session.open('same challenge in another carrier'); await h.session.resume();
  assert.equal(h.state.error, 'ADDRESS_REQUEST_ALREADY_SUBMITTED'); await h.session.approve(); assert.equal(calls, 1);
});

test('late submission cannot overwrite a new request after closing', async () => {
  const wait = deferred(); const h = harness({ submit: async () => wait.promise });
  h.state.available = true; h.session.open('request'); await h.session.resume(); const pending = h.session.approve();
  h.session.close(); h.session.open('new request'); wait.resolve('confirmed'); await pending;
  assert.equal(h.state.stage, 'waiting');
});

test('missing or invalid address needs setup, never silent replacement', async () => {
  for (const address of ['', 'not-an-address']) {
    const h = harness(); h.identity.address = address; h.state.available = true;
    h.session.open('request'); await h.session.resume(); assert.equal(h.state.stage, 'needsAddress');
    h.session.setup(); await h.session.resume(); assert.equal(h.state.stage, 'setup');
    h.identity.address = 'new@example.com'; await h.session.resume({ fromSetup: true });
    assert.equal(h.state.stage, 'review'); assert.equal(h.calls.length, 0);
  }
});

test('submission exceptions preserve uncertainty', async () => {
  const h = harness({ submit: async () => { throw new Error('network'); } }); h.state.available = true;
  h.session.open('request'); await h.session.resume(); await h.session.approve(); assert.equal(h.state.stage, 'unknown');
});

test('only an unreachable metadata request can be retried', async () => {
  let attempts = 0;
  const h = harness({ resolve: async () => {
    if (++attempts === 1) throw Object.assign(new Error('offline'), { code: 'ADDRESS_REQUEST_UNREACHABLE' });
    return { callback: 'https://site.example/share', k1: 'a'.repeat(64) };
  } });
  h.state.available = true; h.session.open('request'); await h.session.resume();
  assert.equal(h.state.stage, 'error');
  await h.session.retry(); assert.equal(h.state.stage, 'review'); assert.equal(attempts, 2);
  assert.equal(h.calls.length, 0);
  await h.session.approve(); await h.session.retry();
  assert.equal(h.state.stage, 'confirmed'); assert.equal(h.calls.length, 1); assert.equal(attempts, 2);
});

test('spent challenges remain consumed across callback paths and hex casing', async () => {
  let count = 0;
  const h = harness({ resolve: async () => ({
    callback: `https://site.example/${++count}`, k1: (count === 1 ? 'a' : 'A').repeat(64),
  }) });
  h.state.available = true; h.session.open('first'); await h.session.resume(); await h.session.approve();
  h.session.close(); h.session.open('second'); await h.session.resume();
  assert.equal(h.state.error, 'ADDRESS_REQUEST_ALREADY_SUBMITTED');
  await h.session.approve(); assert.equal(h.calls.length, 1);
});

test('switching identity hides an in-flight outcome without reviving stale consent', async () => {
  const wait = deferred(); const h = harness({ submit: async () => wait.promise });
  h.state.available = true; h.session.open('request'); await h.session.resume();
  const pending = h.session.approve(); h.identity.identity = 'npubBob'; h.session.identityChanged();
  assert.equal(h.state.stage, 'idle');
  wait.resolve('confirmed'); await pending; assert.equal(h.state.stage, 'idle');
});
