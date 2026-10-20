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

// Every haptic in the app, by file (docs/HAPTICS.md). One meaning per pattern,
// only for moments that matter: a new call, or one on a routine tap, has to be
// added here on purpose.
const EXPECTED = {
  'components/BatchSendModal.vue': ['error', 'success', 'warning'], // the batch's outcome
  'components/CardPinPanel.vue': ['error'], // wrong card PIN
  'components/InternalTransferModal.vue': ['error', 'success'], // the transfer's outcome
  'components/PinEntryDialog.vue': ['error'], // wrong app PIN (the dialog is not used today)
  'components/ReceiveModal.vue': ['success'], // a payment arrived
  'components/ScannerOverlay.vue': ['tap', 'tap'], // a code recognised (one-shot; a new code when scanning several)
  'components/SlideToSend.vue': ['medium', 'medium'], // the commit: the finger at the detent, or finish() for a flick or keyboard run
  'pages/KioskDashboard.vue': ['error', 'medium', 'success', 'success'], // card failed, sale parked, sale paid, parked sale paid
  'pages/Settings.vue': ['tap'], // turning haptics on
  'pages/TransactionHistory.vue': ['tap'], // the Pay again swipe's threshold
  // Send failed (twice: a payment, an on-chain withdrawal), a card locked, a
  // redeem failed; a send and a redeem completed; a card read; an outcome unknown.
  'pages/Wallet.vue': ['error', 'error', 'error', 'error', 'success', 'success', 'tap', 'warning'],
};

test('haptics play only at the moments the map lists', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const root = new URL('../../', import.meta.url).pathname;
  const found = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path); continue; }
      if (!/\.(vue|js)$/.test(name) || path.endsWith('utils/haptics.js')) continue;
      const calls = [...readFileSync(path, 'utf8').matchAll(/\bhaptics\.(\w+)\(/g)].map((m) => m[1]);
      if (calls.length) found[relative(root, path)] = calls.sort();
    }
  };
  walk(root);
  assert.deepEqual(found, EXPECTED);
});
