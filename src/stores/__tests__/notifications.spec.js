/**
 * notifications store — who decides whether BuhoGO may speak.
 *
 * Two answers are kept apart on purpose and this is what guards that:
 *   - the OS owns `permission`; we only ever re-read it
 *   - the user owns `enabled` inside the app
 * so a granted permission never silently means "on", and a permission revoked
 * in system settings silences us without erasing the user's own answer.
 *
 * It also pins down that Settings is a peer of the setup wizard, not a mirror
 * of it: someone who said "Not now" there can still turn notifications on
 * here, dialog and all.
 *
 * Run directly with Node:
 *   node src/stores/__tests__/notifications.spec.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
}

globalThis.localStorage = new MemoryStorage();

const pinia = await import('pinia');
const { createPinia, setActivePinia } = pinia;

// Execute the real store with the native service stubbed — the service is the
// only thing here that needs a phone.
const source = readFileSync(new URL('../notifications.js', import.meta.url), 'utf8');
function loadStore(service) {
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'pinia') return pinia;
    if (name.endsWith('paymentNotifications.js')) return service;
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports.useNotificationsStore;
}

function service({ supported = true, permission = 'prompt', grant = true } = {}) {
  const state = { permission, posted: [] };
  state.requests = 0;
  return {
    state,
    isSupported: () => supported,
    permissionState: async () => (supported ? state.permission : 'unsupported'),
    requestPermission: async () => {
      // Counting these is how the tests tell "the OS dialog came up" from
      // "we answered from our own cached state".
      state.requests += 1;
      state.permission = grant ? 'granted' : 'denied';
      return state.permission;
    },
    notify: async (message) => { state.posted.push(message); return true; },
  };
}

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

function fresh(svc) {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return { store: loadStore(svc)(), svc };
}

console.log('notifications store');

await test('a fresh install is quiet, and asking is offered once', async () => {
  const { store } = fresh(service());
  await store.initialize();
  assert.equal(store.enabled, false);
  assert.equal(store.canNotify, false);
  assert.equal(store.canAsk, true);
});

await test('granting turns notifications on and survives a reload', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  assert.equal(await store.enable(), true);
  assert.equal(store.canNotify, true);

  setActivePinia(createPinia());
  const reloaded = loadStore(svc)();
  await reloaded.initialize();
  assert.equal(reloaded.enabled, true);
  assert.equal(reloaded.canNotify, true);
});

await test('a denial is an answer: off, and never asked again on our own', async () => {
  const { store } = fresh(service({ grant: false }));
  await store.initialize();
  assert.equal(await store.enable(), false);
  assert.equal(store.enabled, false);
  assert.equal(store.canAsk, false, 'the OS will not ask twice; neither will we');
});

await test('"not now" closes the question without touching the OS', async () => {
  const { store, svc } = fresh(service());
  await store.initialize();
  store.declineForNow();
  assert.equal(store.canAsk, false);
  assert.equal(store.enabled, false);
  assert.equal(svc.state.permission, 'prompt', 'no system dialog was raised');
});

await test('permission revoked in system settings silences us without losing the choice', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  assert.equal(store.canNotify, true);

  // Revoked outside the app: nothing may be posted...
  svc.state.permission = 'denied';
  await store.syncPermission();
  assert.equal(store.canNotify, false);
  assert.equal(await store.notifyIfEnabled({ title: 'Money arrived' }), false);
  // ...but the user never turned our switch off, so it is still their answer.
  assert.equal(store.enabled, true);

  // Re-granted in system settings: it comes back on by itself, rather than
  // showing OFF for a switch nobody touched.
  svc.state.permission = 'granted';
  await store.syncPermission();
  assert.equal(store.canNotify, true);
});

await test('declining in the wizard leaves Settings able to ask', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();

  // The wizard's "Not now": no dialog was raised, and the slide is done.
  store.declineForNow();
  assert.equal(store.canAsk, false);
  assert.equal(svc.state.requests, 0);

  // Settings is a peer, not a mirror: this is where the dialog comes up.
  assert.equal(await store.enable(), true);
  assert.equal(svc.state.requests, 1, 'the system dialog was raised from Settings');
  assert.equal(store.canNotify, true);
});

await test('turning it off in Settings and back on again never re-asks the OS', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  assert.equal(svc.state.requests, 1);

  store.disable();
  assert.equal(store.canNotify, false);
  assert.equal(svc.state.permission, 'granted', 'the OS permission is left alone');

  assert.equal(await store.enable(), true);
  assert.equal(svc.state.requests, 1, 'permission was already granted; no second dialog');
});

await test('a wizard denial leaves Settings honest instead of hopeful', async () => {
  const svc = service({ grant: false });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  assert.equal(store.permission, 'denied');

  // The row stays tappable, and says why nothing happens: Android will not
  // show the dialog twice, so the only way out is system settings.
  assert.equal(await store.enable(), false);
  assert.equal(store.canNotify, false);
});

await test('the web is not a place with notifications', async () => {
  const { store } = fresh(service({ supported: false }));
  await store.initialize();
  assert.equal(store.supported, false);
  assert.equal(store.canAsk, false);
  assert.equal(await store.enable(), false);
});

await test('nothing is posted unless the user asked for it', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();

  assert.equal(await store.notifyIfEnabled({ title: 'Money arrived', body: '+1000' }), false);
  assert.equal(svc.state.posted.length, 0);

  await store.enable();
  assert.equal(await store.notifyIfEnabled({ title: 'Money arrived', body: '+1000' }), true);
  assert.equal(svc.state.posted.length, 1);

  store.disable();
  await store.notifyIfEnabled({ title: 'Money arrived', body: '+2000' });
  assert.equal(svc.state.posted.length, 1, 'the switch is off; nothing more is posted');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
