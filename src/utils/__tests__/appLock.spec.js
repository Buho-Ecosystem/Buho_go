/**
 * The readable app-lock state.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/appLock.spec.js
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  isAppLocked,
  isAppLockKnown,
  resetAppLock,
  setAppLocked,
  whenAppLockKnown,
} from '../appLock.js';

beforeEach(() => resetAppLock());

test('before App.vue reports, the state is unknown and reads as unlocked', () => {
  assert.equal(isAppLockKnown(), false);
  assert.equal(isAppLocked(), false);
});

test('the reported value is readable and changes follow', () => {
  setAppLocked(true);
  assert.equal(isAppLockKnown(), true);
  assert.equal(isAppLocked(), true);
  setAppLocked(false);
  assert.equal(isAppLocked(), false);
  setAppLocked('yes');
  assert.equal(isAppLocked(), false, 'only a real true locks');
});

test('whenAppLockKnown waits for the first report and then resolves at once', async () => {
  let resolved = 0;
  const first = whenAppLockKnown().then(() => { resolved += 1; });
  const second = whenAppLockKnown().then(() => { resolved += 1; });
  await Promise.resolve();
  assert.equal(resolved, 0);
  setAppLocked(true);
  await Promise.all([first, second]);
  assert.equal(resolved, 2);
  await whenAppLockKnown();
});
