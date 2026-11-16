import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './sparkWalletHarness.js';
import { reactive, toRaw } from 'vue';
import { kioskPinMatches } from '../../utils/kioskPin.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function register() { const h = createHarness(); h.store.savedStateLoaded = true; return h; }
function failWrites(h) { h.local.setItem = () => { throw new Error('quota'); }; }

// The real canonical persistence method logs its expected error. Keep failure tests readable.
async function withoutExpectedLog(task) { const saved = console.error; console.error = () => {}; try { return await task(); } finally { console.error = saved; } }

test('a failed first setup rejects and restores enabled, receiving wallet and PIN without granting owner access', async () => {
  const h = register();
  failWrites(h);
  await withoutExpectedLog(() => assert.rejects(h.store.enableKiosk('1234', 'wallet'), /quota/));
  assert.equal(h.store.kioskEnabled, false);
  assert.equal(h.store.kioskPinHash, '');
  assert.equal(h.store.kioskWalletId, null);
  assert.equal(h.store.kioskOwnerAccess, false);
  assert.equal(h.saved(), null);
});
test('successful setup saves the PIN hash and wallet before returning verified owner access', async () => {
  const h = register();
  await h.store.enableKiosk('1234', 'wallet');
  assert.equal(h.saved().kioskEnabled, true);
  assert.equal(h.saved().kioskWalletId, 'wallet');
  assert.equal(kioskPinMatches('1234', h.saved().kioskPinHash), true);
  assert.equal(h.saved().kioskPin, undefined);
  assert.equal(h.store.kioskOwnerAccess, true);
  assert.equal(h.saved().kioskOwnerAccess, undefined, 'owner access remains volatile');
});
test('failed disable preserves the durable PIN and an already verified owner session', async () => {
  const h = register();
  await h.store.enableKiosk('1234', 'wallet');
  const hash = h.store.kioskPinHash;
  const input = h.store.pendingDeepLink = { target: 'kiosk', data: 'one-time-input' };
  failWrites(h);
  await withoutExpectedLog(() => assert.rejects(h.store.disableKiosk(), /quota/));
  assert.equal(h.store.kioskEnabled, true);
  assert.equal(h.store.kioskPinHash, hash);
  assert.equal(h.saved().kioskPinHash, hash);
  assert.equal(h.store.kioskOwnerAccess, true);
  assert.equal(h.store.pendingDeepLink, input);
});
test('failed PIN, wallet, tip, rounding and display changes roll back their own preferences', async () => {
  const h = register();
  await h.store.enableKiosk('1234', 'wallet');
  const original = h.saved();
  failWrites(h);
  for (const [action, argument, field] of [
    ['changeKioskPin', '9876', 'kioskPinHash'], ['setKioskWallet', 'other', 'kioskWalletId'],
    ['setKioskTipEnabled', true, 'kioskTipEnabled'], ['setKioskTipValues', [1, 2, 3], 'kioskTipValues'],
    ['setKioskRoundUpEnabled', true, 'kioskRoundUpEnabled'], ['setKioskDisplayCurrency', 'fiat', 'kioskDisplayCurrency'],
  ]) {
    await withoutExpectedLog(() => assert.rejects(h.store[action](argument), /quota/));
    assert.deepEqual(h.store[field], original[field], `${action} must not appear saved`);
    assert.deepEqual(h.saved()[field], original[field]);
    assert.equal(h.store.kioskOwnerAccess, true);
  }
});
test('failed activation does not revoke owner access or clear payment input; successful activation locks only after saving', async () => {
  const h = register();
  await h.store.enableKiosk('1234', 'wallet');
  const input = h.store.pendingDeepLink = { target: 'kiosk', data: 'one-time-input' };
  const savedWrite = h.local.setItem;
  failWrites(h);
  await withoutExpectedLog(() => assert.rejects(h.store.activateKioskMode(), /quota/));
  assert.equal(h.store.kioskOwnerAccess, true);
  assert.equal(h.store.pendingDeepLink, input);
  h.local.setItem = savedWrite;
  await h.store.activateKioskMode();
  assert.equal(h.store.kioskOwnerAccess, false);
  assert.equal(h.store.pendingDeepLink, null);
});
test('serialized kiosk changes cannot race a failed rollback against a later accepted preference', async () => {
  const h = register(), firstWrite = deferred();
  const writes = [];
  h.store.persistState = async options => { writes.push([options, h.store.kioskTipEnabled]); if (writes.length === 1) await firstWrite.promise; };
  const failed = h.store.setKioskTipEnabled(true);
  const rejection = assert.rejects(failed, /quota/);
  const accepted = h.store.setKioskTipEnabled(true);
  await flush();
  assert.equal(writes.length, 1);
  firstWrite.reject(new Error('quota'));
  await rejection;
  await accepted;
  assert.equal(writes.length, 2);
  assert.ok(writes.every(([options]) => options.requireDurable === true));
  assert.equal(h.store.kioskTipEnabled, true);
});
test('an explicit relock while setup is saving takes precedence over its eventual owner grant', async () => {
  const h = register(), write = deferred();
  h.store.persistState = async () => write.promise;
  const setup = h.store.enableKiosk('1234', 'wallet');
  await flush();
  h.store.lockToKioskMode();
  write.resolve();
  await setup;
  assert.equal(h.store.kioskOwnerAccess, false);
});

test('fresh action proxies share the durable save queue through the same raw Pinia state', async () => {
  const h = createHarness({ deps: { vue: { toRaw } } }), firstWrite = deferred();
  const state = reactive({});
  Object.defineProperty(h.store, '$state', { get: () => state });
  const firstProxy = new Proxy(h.store, {}), secondProxy = new Proxy(h.store, {});
  assert.notEqual(firstProxy, secondProxy);
  assert.equal(toRaw(firstProxy.$state), toRaw(secondProxy.$state));
  const writes = [];
  h.store.persistState = async options => { writes.push([options, h.store.kioskTipEnabled]); if (writes.length === 1) await firstWrite.promise; };
  const failed = h.actions._saveKioskPreferences.call(firstProxy, { kioskTipEnabled: true });
  const rejection = assert.rejects(failed, /quota/);
  const accepted = h.actions._saveKioskPreferences.call(secondProxy, { kioskTipEnabled: true });
  await flush();
  assert.equal(writes.length, 1, 'a second action proxy must wait for the first commit or rollback');
  firstWrite.reject(new Error('quota'));
  await rejection;
  await accepted;
  assert.equal(writes.length, 2);
  assert.equal(h.store.kioskTipEnabled, true);
});
