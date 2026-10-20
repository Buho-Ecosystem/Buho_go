/**
 * haptics - the user's choice and where feedback may play.
 *
 * Coverage focus:
 *   - on by default, also when storage cannot be read
 *   - the switch in Settings is kept across starts
 *   - on the web every feedback resolves without playing
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};

const fresh = () => import(`../haptics.js?${Math.random()}`);

test('on by default; the switch is kept for the next start', async () => {
  const first = await fresh();
  assert.equal(first.hapticsEnabled(), true);
  first.setHapticsEnabled(false);
  assert.equal(first.hapticsEnabled(), false);
  const next = await fresh();
  assert.equal(next.hapticsEnabled(), false, 'read again on the next start');
  next.setHapticsEnabled(true);
  assert.equal((await fresh()).hapticsEnabled(), true);
});

test('storage that cannot be read leaves haptics on', async () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const module = await fresh();
  assert.equal(module.hapticsEnabled(), true);
  module.setHapticsEnabled(false);
  assert.equal(module.hapticsEnabled(), false, 'kept for this session');
  globalThis.localStorage = saved;
});

test('on the web nothing plays, and nothing throws', async () => {
  const { haptics, hapticsSupported } = await fresh();
  assert.equal(hapticsSupported(), false);
  for (const play of Object.values(haptics)) assert.equal(await play(), undefined);
});
