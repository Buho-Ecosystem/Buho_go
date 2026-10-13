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
 * here, dialog and all — and that the row exists in a browser too, where only
 * the wizard slide is withheld.
 *
 * Under the master switch each kind has its own answer, `paymentsEnabled`
 * and `messagesEnabled` (the contact chat): each only narrows the other two
 * (`canNotifyPayments`, `canNotifyMessages`), is saved next to them, and
 * reads as "on" in anything saved before it existed.
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

function service({ supported = true, native = true, permission = 'prompt', grant = true } = {}) {
  const state = { permission, posted: [] };
  state.requests = 0;
  return {
    state,
    isSupported: () => supported,
    isNativeApp: () => native && supported,
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

await test('a browser gets the Settings row but never the setup slide', async () => {
  const { store } = fresh(service({ native: false }));
  await store.initialize();
  assert.equal(store.supported, true, 'the plugin posts through the browser Notification API');
  assert.equal(store.canAsk, true, 'Settings may raise the prompt');
  assert.equal(store.canAskInSetup, false, 'the wizard slide stays app-only');
  assert.equal(await store.enable(), true);
  assert.equal(store.canNotify, true);
});

await test('somewhere with no notifications at all, nothing is offered', async () => {
  const { store } = fresh(service({ supported: false }));
  await store.initialize();
  assert.equal(store.supported, false);
  assert.equal(store.canAsk, false);
  assert.equal(store.canAskInSetup, false);
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

console.log('\nchat messages');

const STORED = 'buhoGO_notifications';
const message = {
  title: 'Alice',
  body: 'Lunch?',
  channelName: 'Messages',
  id: 1_713_917_725,
  group: 'chat:abc',
  route: '/address-book/abc/chat',
};

/** A store whose persisted blob was written by `blob` before the app started. */
async function storeSavedAs(blob, svc = service({ permission: 'granted' })) {
  globalThis.localStorage = new MemoryStorage();
  if (blob !== undefined) localStorage.setItem(STORED, blob);
  setActivePinia(createPinia());
  const store = loadStore(svc)();
  await store.initialize();
  return { store, svc };
}

await test('messages are on by default, but a fresh install is still quiet', async () => {
  const { store } = fresh(service());
  assert.equal(store.messagesEnabled, true, 'on before anything has been loaded, too');
  await store.initialize();
  assert.equal(store.messagesEnabled, true);
  assert.equal(store.canNotifyMessages, false, 'the master switch is still off');
});

await test('the chat switch is saved next to the others and survives a reload', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  assert.deepEqual(JSON.parse(localStorage.getItem(STORED)), { enabled: true, prompted: true, paymentsEnabled: true, messagesEnabled: true });

  store.setMessagesEnabled(false);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORED)), { enabled: true, prompted: true, paymentsEnabled: true, messagesEnabled: false });

  setActivePinia(createPinia());
  const reloaded = loadStore(svc)();
  await reloaded.initialize();
  assert.equal(reloaded.messagesEnabled, false);
  assert.equal(reloaded.enabled, true);
  assert.equal(reloaded.canNotify, true);
  assert.equal(reloaded.canNotifyMessages, false);

  reloaded.setMessagesEnabled(true);
  setActivePinia(createPinia());
  const again = loadStore(svc)();
  await again.initialize();
  assert.equal(again.messagesEnabled, true);
  assert.equal(again.canNotifyMessages, true);
});

await test('what was saved before the chat existed reads as messages on', async () => {
  const { store } = await storeSavedAs(JSON.stringify({ enabled: true, prompted: true }));
  assert.equal(store.enabled, true, 'the saved answers are kept');
  assert.equal(store.prompted, true);
  assert.equal(store.messagesEnabled, true);
  assert.equal(store.canNotifyMessages, true);
  assert.equal(store.paymentsEnabled, true, 'payments too: the switch did not exist yet');
  assert.equal(store.canNotifyPayments, true);

  // Saving again upgrades the blob without changing anyone's answer.
  store.disable();
  assert.deepEqual(JSON.parse(localStorage.getItem(STORED)), { enabled: false, prompted: true, paymentsEnabled: true, messagesEnabled: true });
});

await test('only an explicit "off" turns messages off when loading', async () => {
  const off = await storeSavedAs(JSON.stringify({ enabled: true, prompted: true, messagesEnabled: false }));
  assert.equal(off.store.messagesEnabled, false);
  assert.equal(off.store.enabled, true);

  for (const blob of [
    JSON.stringify({ enabled: true, messagesEnabled: true }),
    JSON.stringify({ enabled: true, messagesEnabled: 'false' }),
    JSON.stringify({ enabled: true, messagesEnabled: null }),
    JSON.stringify({ enabled: true, messagesEnabled: 0 }),
    JSON.stringify('not an object'),
    'null',
    undefined,
  ]) {
    const { store } = await storeSavedAs(blob);
    assert.equal(store.messagesEnabled, true, `blob ${blob}`);
  }
});

await test('an unreadable blob falls back to quiet defaults, with messages on', async () => {
  const { store } = await storeSavedAs('{not json');
  assert.equal(store.enabled, false);
  assert.equal(store.prompted, false);
  assert.equal(store.messagesEnabled, true);
  assert.equal(store.canNotifyMessages, false);
});

await test('the chat switch touches neither the master switch nor the OS', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  const requests = svc.state.requests;

  store.setMessagesEnabled(false);
  assert.equal(store.messagesEnabled, false);
  assert.equal(store.enabled, true);
  assert.equal(store.permission, 'granted');
  store.setMessagesEnabled(true);
  assert.equal(store.messagesEnabled, true);
  assert.equal(svc.state.requests, requests, 'no system dialog');
});

await test('a message needs notifications on, the permission, and the chat switch', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  assert.equal(store.canNotifyMessages, false, 'master switch off');

  await store.enable();
  assert.equal(store.canNotifyMessages, true);

  store.setMessagesEnabled(false);
  assert.equal(store.canNotifyMessages, false, 'chat switch off');
  assert.equal(store.canNotify, true, 'payments are not affected');

  store.setMessagesEnabled(true);
  store.disable();
  assert.equal(store.canNotifyMessages, false, 'the chat switch cannot override the master switch');

  await store.enable();
  svc.state.permission = 'denied';
  await store.syncPermission();
  assert.equal(store.canNotifyMessages, false, 'permission revoked in system settings');
  assert.equal(store.messagesEnabled, true, 'the choice itself is kept');
});

await test('a payment needs notifications on, the permission, and the payments switch', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  assert.equal(store.paymentsEnabled, true, 'on by default');
  assert.equal(store.canNotifyPayments, false, 'master switch off');

  await store.enable();
  assert.equal(store.canNotifyPayments, true);
  const requests = svc.state.requests;

  store.setPaymentsEnabled(false);
  assert.equal(store.canNotifyPayments, false, 'payments switch off');
  assert.equal(store.canNotifyMessages, true, 'messages are not affected');
  assert.equal(store.enabled, true, 'the master switch is left alone');
  assert.equal(svc.state.requests, requests, 'no system dialog');
  assert.equal(await store.notifyIfEnabled({ title: 'Payment received', body: '+1000' }), false);
  assert.equal(await store.notifyMessageIfEnabled(message), true, 'messages still come');
  assert.equal(svc.state.posted.length, 1);

  setActivePinia(createPinia());
  const reloaded = loadStore(svc)();
  await reloaded.initialize();
  assert.equal(reloaded.paymentsEnabled, false, 'the choice survives a reload');

  reloaded.setPaymentsEnabled(true);
  reloaded.disable();
  assert.equal(reloaded.canNotifyPayments, false, 'the payments switch cannot override the master switch');
});

await test('a chat notification respects both switches and always uses the messages channel', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();

  assert.equal(await store.notifyMessageIfEnabled(message), false, 'notifications are off');
  assert.equal(svc.state.posted.length, 0);

  await store.enable();
  assert.equal(await store.notifyMessageIfEnabled(message), true);
  assert.deepEqual(svc.state.posted, [{ ...message, channel: 'messages' }]);

  // The channel is not the caller's to choose here.
  await store.notifyMessageIfEnabled({ ...message, channel: 'payments' });
  assert.equal(svc.state.posted[1].channel, 'messages');
  assert.equal(svc.state.posted.length, 2);

  store.setMessagesEnabled(false);
  assert.equal(await store.notifyMessageIfEnabled(message), false, 'the chat switch is off');
  assert.equal(svc.state.posted.length, 2);
  assert.equal(await store.notifyIfEnabled({ title: 'Payment received', body: '+1000' }), true, 'payments still come');
  assert.equal(svc.state.posted.length, 3);

  store.setMessagesEnabled(true);
  svc.state.permission = 'denied';
  await store.syncPermission();
  assert.equal(await store.notifyMessageIfEnabled(message), false, 'the OS says no');
  assert.equal(svc.state.posted.length, 3);

  svc.state.permission = 'granted';
  await store.syncPermission();
  store.disable();
  assert.equal(await store.notifyMessageIfEnabled(message), false, 'the master switch is off');
  assert.equal(svc.state.posted.length, 3);
});

await test('a call without a message does not throw in the store', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();
  // The real service refuses a notification without a title; the store only
  // has to hand over what it was given and not fall over on the way.
  await store.notifyMessageIfEnabled(undefined);
  await store.notifyIfEnabled(undefined);
  assert.deepEqual(svc.state.posted, [{ channel: 'messages' }, undefined]);
});

await test('notifyIfEnabled hands every option to the service as it was given', async () => {
  const svc = service({ grant: true });
  const { store } = fresh(svc);
  await store.initialize();
  await store.enable();

  const full = { ...message, force: true, channel: 'messages' };
  assert.equal(await store.notifyIfEnabled(full), true);
  assert.deepEqual(svc.state.posted[0], full);

  // A payment caller, as before: nothing is added on the way.
  assert.equal(await store.notifyIfEnabled({ title: 'Payment received', body: '+1000' }), true);
  assert.deepEqual(svc.state.posted[1], { title: 'Payment received', body: '+1000' });
  assert.equal(await store.notifyIfEnabled({ title: 'Payment received', body: '+1000', force: true }), true);
  assert.deepEqual(svc.state.posted[2], { title: 'Payment received', body: '+1000', force: true });
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
