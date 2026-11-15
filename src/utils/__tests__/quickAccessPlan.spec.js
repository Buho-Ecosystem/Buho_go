/**
 * What the tiles and launcher shortcuts publish (#445, #446): only with a
 * wallet and outside kiosk mode, no contact in the menu behind the app lock,
 * and a pinned contact that was removed is switched off, never deleted, while
 * one that came back under a new local id is still found.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { findShortcutContact, planQuickAccess, shortcutKeysOf } from '../quickAccessPlan.js';

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name]);
const maria = { keys: ['addr-1-m'], name: 'Maria Lopez', picture: 'https://example.com/m.png', isService: false };
const shop = { keys: ['addr-2-s'], name: 'Corner Shop', picture: 'javascript:alert(1)', isService: true };

function plan(overrides = {}) {
  return planQuickAccess({
    hasWallet: true,
    kiosk: false,
    appLock: false,
    lastPaid: maria,
    contacts: [maria, shop],
    pinned: [],
    ...overrides,
  }, t);
}

test('the menu holds Scan QR, Receive, Send and the last person paid, in that order', () => {
  const { tiles, shortcuts } = plan();
  assert.equal(tiles.available, true);
  assert.deepEqual(shortcuts.menu.map((s) => [s.id, s.rank]), [['scan', 0], ['receive', 1], ['send', 2], ['pay-addr-1-m', 3]]);
  const person = shortcuts.menu[3];
  assert.deepEqual(
    [person.shortLabel, person.longLabel, person.icon, person.avatarUrl, person.contactId],
    ['Pay Maria', 'Pay Maria Lopez', 'person', 'https://example.com/m.png', 'addr-1-m'],
  );
});

test('with the app lock on, no name appears on the Home screen', () => {
  assert.deepEqual(plan({ appLock: true }).shortcuts.menu.map((s) => s.id), ['scan', 'receive', 'send']);
});

test('only an https picture is fetched; a service gets the storefront', () => {
  const person = plan({ lastPaid: shop }).shortcuts.menu[3];
  assert.equal(person.avatarUrl, undefined);
  assert.equal(person.icon, 'service');
});

test('no wallet or kiosk mode greys the tiles and switches every pinned shortcut off', () => {
  const pinned = [{ id: 'scan', enabled: true }, { id: 'pay-addr-1-m', enabled: true }, { id: 'someone-else', enabled: true }];
  for (const [state, message] of [[{ hasWallet: false }, 'Set up a wallet in BuhoGO first'], [{ kiosk: true }, 'Not available while kiosk mode is on']]) {
    const { tiles, shortcuts } = plan({ ...state, pinned });
    assert.equal(tiles.available, false);
    assert.deepEqual(shortcuts.menu, []);
    assert.deepEqual(shortcuts.disabled, [{ ids: ['scan', 'pay-addr-1-m'], message }]);
  }
});

test('pinned shortcuts are kept up to date, and a removed contact is switched off with the reason', () => {
  const pinned = [{ id: 'scan', enabled: false }, { id: 'pay-addr-2-s', enabled: true }, { id: 'pay-addr-gone', enabled: true }];
  const { shortcuts } = plan({ pinned, appLock: true });
  assert.deepEqual(shortcuts.pinned.map((s) => s.id), ['scan', 'pay-addr-2-s'], 'a pinned contact stays: the person put it there');
  assert.deepEqual(shortcuts.disabled, [{ ids: ['pay-addr-gone'], message: 'This contact was removed' }]);
});

test('a contact rebuilt under a new local id still answers to its pinned shortcut', () => {
  const before = { id: 'addr-1-old', nostr_pubkey: 'ab'.repeat(32), name: 'Maria Lopez' };
  const after = { ...before, id: 'addr-9-new' };
  const [key] = shortcutKeysOf(before);
  assert.match(key, /^k[0-9a-f]{32}$/, 'hashed: says nothing about the contact');
  assert.equal(findShortcutContact([after], key), after);
  assert.equal(findShortcutContact([after], 'addr-1-old'), null);

  const { shortcuts } = plan({ pinned: [{ id: `pay-${key}`, enabled: true }], contacts: [{ ...maria, keys: shortcutKeysOf(after) }] });
  assert.deepEqual(shortcuts.pinned.map((s) => [s.id, s.contactId]), [[`pay-${key}`, key]], 'the pinned shortcut keeps its own id');
  assert.deepEqual(shortcuts.disabled, []);
});
