/**
 * breezSdk registry — the lifecycle invariants money paths depend on.
 *
 * Runs the REAL services/breezSdk.js (loader hooks substitute only the
 * wasm SDK package and the build-time API key — see the .hooks.mjs file).
 *
 * Coverage focus:
 *   - a failed wasm init never latches: the next connect retries
 *   - concurrent acquires share one build (init mutex)
 *   - release() racing an in-flight build tears down what the build
 *     produced instead of leaving a zombie SDK with a live event stream
 *   - a forceReinit rebuild keeps the old entry's subscribers (an open
 *     receive screen must keep hearing payments) and their unsubscribers
 *
 * Run directly with Node:
 *   node src/services/__tests__/breezSdkRegistry.spec.js
 */

import { strict as assert } from 'node:assert';
import { register } from 'node:module';

register('./breezSdkRegistry.hooks.mjs', import.meta.url);

// The service touches browser storage at module scope (guarded, but the
// stubs keep the paths deterministic here).
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
globalThis.indexedDB = {
  databases: async () => [],
  deleteDatabase() {
    const req = {};
    queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
    return req;
  },
};

// Control channel the fake SDK module reads. Installed BEFORE the service
// (and with it the fake) is imported.
const built = [];
function makeFakeSdk() {
  const sdk = {
    listeners: new Map(),
    nextId: 1,
    disconnected: false,
    async addEventListener(handler) {
      const id = `l${sdk.nextId++}`;
      sdk.listeners.set(id, handler);
      return id;
    },
    async removeEventListener(id) { sdk.listeners.delete(id); },
    async disconnect() { sdk.disconnected = true; },
    emit(event) { for (const h of sdk.listeners.values()) h.onEvent(event); },
  };
  built.push(sdk);
  return sdk;
}
globalThis.__breezFakeCtl = {
  init: () => Promise.resolve(),
  build: async () => makeFakeSdk(),
};

const { ensureWasmInit, acquire, release, subscribe, peek } =
  await import('../breezSdk.js');

const OPTS = { mnemonic: 'not-a-real-seed', accountNumber: 1, network: 'MAINNET' };
const tick = () => new Promise((r) => setTimeout(r, 0));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('breezSdk registry lifecycle');

// Must run FIRST: any successful acquire resolves the wasm latch for good.
await test('a failed wasm init never latches; the next attempt retries', async () => {
  globalThis.__breezFakeCtl.init = () => Promise.reject(new Error('network down'));
  await assert.rejects(() => ensureWasmInit(), /network down/);
  globalThis.__breezFakeCtl.init = () => Promise.resolve();
  await ensureWasmInit(); // latched-rejection code would throw 'network down' again
});

await test('concurrent acquires for one wallet share a single build', async () => {
  const before = built.length;
  const [a, b] = await Promise.all([acquire('w1', OPTS), acquire('w1', OPTS)]);
  assert.equal(a, b);
  assert.equal(built.length, before + 1);
  assert.equal(peek('w1'), a);
});

await test('release racing an in-flight build leaves no zombie SDK', async () => {
  let finishBuild;
  globalThis.__breezFakeCtl.build = () =>
    new Promise((resolve) => { finishBuild = () => resolve(makeFakeSdk()); });

  try {
    const pending = acquire('w2', OPTS);
    await tick(); // the build is now in flight, blocked inside the fake
    const releasing = release('w2'); // must chain behind the build, then tear down
    finishBuild();
    await pending;
    await releasing;

    assert.equal(peek('w2'), null, 'registry still holds the instance');
    assert.equal(built.at(-1).disconnected, true, 'built SDK was never disconnected');
  } finally {
    // Restored unconditionally: a failed assert must not leave later tests
    // building against the gated builder (they would hang, not fail).
    globalThis.__breezFakeCtl.build = async () => makeFakeSdk();
  }
});

await test('forceReinit keeps subscribers hearing events on the new instance', async () => {
  await acquire('w3', OPTS);
  const events = [];
  const unsubscribe = subscribe('w3', (e) => events.push(e.type));

  await acquire('w3', { ...OPTS, forceReinit: true });
  const oldSdk = built.at(-2);
  const newSdk = built.at(-1);
  assert.equal(oldSdk.disconnected, true, 'old instance not torn down');

  newSdk.emit({ type: 'paymentSucceeded' });
  assert.deepEqual(events, ['paymentSucceeded'], 'subscriber lost across reinit');

  unsubscribe(); // the closure from BEFORE the reinit must still work
  newSdk.emit({ type: 'synced' });
  assert.deepEqual(events, ['paymentSucceeded'], 'stale unsubscribe left the handler live');
});

await test('release without a live instance is a quiet no-op', async () => {
  await release('never-acquired');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
