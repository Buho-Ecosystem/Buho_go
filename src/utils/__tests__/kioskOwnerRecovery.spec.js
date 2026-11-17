import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { verifyKioskOwner } from '../kioskOwnerRecovery.js';

test('browser and unavailable device authentication cannot recover owner access', async () => {
  assert.equal(await verifyKioskOwner(), false);
  assert.equal(await verifyKioskOwner({ availability: async () => ({ available: false }), verify: () => assert.fail('must not prompt') }), false);
});
test('recovery requires explicit successful native verification, cancellation and errors fail closed', async () => {
  for (const answer of [false, undefined, 'true']) {
    assert.equal(await verifyKioskOwner({ availability: async () => ({ available: true }), verify: async () => answer }), false);
  }
  assert.equal(await verifyKioskOwner({ availability: async () => { throw new Error('unavailable'); } }), false);
  assert.equal(await verifyKioskOwner({ availability: async () => ({ available: true }), verify: async () => { throw new Error('cancelled'); } }), false);
  assert.equal(await verifyKioskOwner({ availability: async () => ({ available: true }), verify: async args => { assert.equal(args.useFallback, true); return true; } }), true);
});

// Load only the real action bodies; the rest of the wallet store needs native services.
function ownerActions(verify) {
  const source = readFileSync(new URL('../../stores/wallet.js', import.meta.url), 'utf8');
  const start = source.indexOf('    async recoverKioskOwnerAccess()');
  const end = source.indexOf('    async changeKioskPin(', start);
  assert.ok(start > 0 && end > start);
  const { code } = transformSync(`module.exports = {${source.slice(start, end)}}`, { format: 'cjs' });
  const module = { exports: {} };
  new Function('module', 'verifyKioskOwner', code)(module, verify);
  return module.exports;
}
test('a delayed recovery result cannot unlock a different register session', async () => {
  let finish;
  const actions = ownerActions(() => new Promise(resolve => { finish = resolve; }));
  for (const changed of ['kioskPinHash', 'kioskWalletId', 'kioskEnabled']) {
    const store = { ...actions, kioskEnabled: true, kioskPinHash: 'original', kioskWalletId: 'wallet', kioskOwnerAccess: false };
    const task = store.recoverKioskOwnerAccess();
    store[changed] = changed === 'kioskEnabled' ? false : 'changed';
    finish(true);
    assert.equal(await task, false);
    assert.equal(store.kioskOwnerAccess, false);
  }
});
test('verified recovery grants volatile access and clears kiosk payment input', async () => {
  const store = { ...ownerActions(async () => true), kioskEnabled: true, kioskPinHash: 'original', kioskWalletId: 'wallet', kioskOwnerAccess: false, pendingDeepLink: { target: 'kiosk', data: 'secret' } };
  assert.equal(await store.recoverKioskOwnerAccess(), true);
  assert.equal(store.kioskOwnerAccess, true);
  assert.equal(store.pendingDeepLink, null);
  assert.equal('forceUnlockKiosk' in store, false);
});

test('relocking the register invalidates an earlier system prompt', async () => {
  let finish;
  const store = { ...ownerActions(() => new Promise(resolve => { finish = resolve; })), kioskEnabled: true, kioskPinHash: 'original', kioskWalletId: 'wallet', kioskOwnerAccess: false };
  const pending = store.recoverKioskOwnerAccess();
  store.lockToKioskMode();
  finish(true);
  assert.equal(await pending, false);
  assert.equal(store.kioskOwnerAccess, false);
});
