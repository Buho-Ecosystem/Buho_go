/**
 * Open links from the Quick Settings tiles and launcher shortcuts (#444).
 * The link is the only thing another app could forge, so what it may carry
 * is narrow: a known screen, at most one saved contact's id, nothing else.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOpenActionStale,
  isOpenActionUrl,
  OPEN_ACTION_TTL_MS,
  parseOpenAction,
  shortcutIdForAction,
} from '../openActions.js';

test('reads the links the tiles and shortcuts send', () => {
  assert.deepEqual(parseOpenAction('buhogo://open/send?src=tile'), { kind: 'send', contactId: null, source: 'tile' });
  assert.deepEqual(parseOpenAction('BUHOGO://open/Receive/'), { kind: 'receive', contactId: null, source: null });
  assert.deepEqual(parseOpenAction('buhogo://open/scan?src=shortcut'), { kind: 'scan', contactId: null, source: 'shortcut' });
  assert.deepEqual(parseOpenAction('buhogo://open/quick-access?src=tile'), { kind: 'quick-access', contactId: null, source: 'tile' });
  assert.deepEqual(
    parseOpenAction('buhogo://open/pay?contact=addr-1700000000000-k3j2&src=shortcut'),
    { kind: 'pay', contactId: 'addr-1700000000000-k3j2', source: 'shortcut' },
  );
});

test('anything else is dropped, and an unknown source is never trusted', () => {
  for (const url of [
    'buhogo://open/withdraw',
    'buhogo://open/pay',
    'buhogo://open/pay?contact=a&contact=b',
    'buhogo://open/pay?contact=../../etc',
    'buhogo://open/send/extra',
    'buhogo://evil/send',
    'lightning:maria@mybuho.de',
    null,
  ]) {
    assert.equal(parseOpenAction(url), null, String(url));
  }
  assert.equal(parseOpenAction('buhogo://open/send?src=browser').source, null);
  assert.equal(parseOpenAction('buhogo://open/send?amount=5000&to=lnbc1').contactId, null, 'no amount or destination rides along');
});

test('an unreadable open link is still ours, so it is consumed rather than called unknown', () => {
  assert.equal(isOpenActionUrl('buhogo://open/withdraw'), true);
  assert.equal(isOpenActionUrl('buhogo://open'), true);
  assert.equal(isOpenActionUrl('buhogo://opener/send'), false);
  assert.equal(isOpenActionUrl('https://go.mybuho.de/open/send'), false);
});

test('each action reports the shortcut it was published under', () => {
  assert.equal(shortcutIdForAction({ kind: 'scan' }), 'scan');
  assert.equal(shortcutIdForAction({ kind: 'pay', contactId: 'addr-1-x' }), 'pay-addr-1-x');
  assert.equal(shortcutIdForAction({ kind: 'quick-access' }), null);
});

test('an action that waited too long (behind the app lock) goes stale', () => {
  assert.equal(isOpenActionStale({ receivedAt: 1000 }, 1000 + OPEN_ACTION_TTL_MS), false);
  assert.equal(isOpenActionStale({ receivedAt: 1000 }, 1001 + OPEN_ACTION_TTL_MS), true);
  assert.equal(isOpenActionStale({}), true);
});
