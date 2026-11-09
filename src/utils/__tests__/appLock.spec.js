/**
 * The readable app-lock state.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/appLock.spec.js
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  PICKER_AWAY_MS,
  awayForPickerTooLong,
  backFromPickerTooLate,
  isAppLocked,
  leavingForPicker,
  openingSystemPicker,
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

test('the photo picker the app opened is not leaving it, for one trip there', () => {
  assert.equal(leavingForPicker(1000), false, 'no picker: going to the background is leaving');
  const closed = openingSystemPicker(1000);
  assert.equal(leavingForPicker(2000), true);
  assert.equal(backFromPickerTooLate(2000 + 30_000), false, 'back with a photo in time');
  closed();
  assert.equal(leavingForPicker(40_000), false, 'once it closed, leaving is leaving again');
});

test('away in the picker longer than choosing a photo takes, the lock engages on return', () => {
  openingSystemPicker(0);
  assert.equal(leavingForPicker(500), true);
  assert.equal(backFromPickerTooLate(500 + PICKER_AWAY_MS + 1), true);
  assert.equal(backFromPickerTooLate(500 + PICKER_AWAY_MS + 2), false, 'asked once per return');
});

test('the screen waiting for the photo can ask, without using up the answer, whether the lock is coming', () => {
  openingSystemPicker(0);
  assert.equal(awayForPickerTooLong(500 + PICKER_AWAY_MS), false, 'the picker never sent the app away');
  leavingForPicker(500);
  assert.equal(awayForPickerTooLong(500 + PICKER_AWAY_MS), false, 'exactly the limit is still in time');
  assert.equal(awayForPickerTooLong(500 + PICKER_AWAY_MS + 1), true);
  assert.equal(awayForPickerTooLong(500 + PICKER_AWAY_MS + 1), true, 'asking again gives the same answer');
  assert.equal(backFromPickerTooLate(500 + PICKER_AWAY_MS + 1), true, 'App.vue still gets its answer');
  assert.equal(awayForPickerTooLong(500 + PICKER_AWAY_MS + 2), false, 'once App.vue heard it, nothing is pending');
});

test('a picker opened long ago holds nothing back, and an old close leaves a new picker open', () => {
  const first = openingSystemPicker(0);
  assert.equal(leavingForPicker(PICKER_AWAY_MS + 1), false, 'the picker was opened too long ago');
  openingSystemPicker(10_000);
  first();
  assert.equal(leavingForPicker(11_000), true, 'closing the first picker does not close the second');
});
