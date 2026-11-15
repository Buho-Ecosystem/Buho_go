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
  assert.equal(awayForPickerTooLong(PICKER_AWAY_MS + 1), false, 'the picker never sent the app away');
  leavingForPicker(500);
  assert.equal(awayForPickerTooLong(PICKER_AWAY_MS), false, 'exactly the limit is still in time');
  assert.equal(awayForPickerTooLong(PICKER_AWAY_MS + 1), true);
  assert.equal(awayForPickerTooLong(PICKER_AWAY_MS + 1), true, 'asking again gives the same answer');
  assert.equal(backFromPickerTooLate(PICKER_AWAY_MS + 1), true, 'App.vue still gets its answer');
  assert.equal(awayForPickerTooLong(PICKER_AWAY_MS + 2), false, 'once App.vue heard it, nothing is pending');
});

test('the two minutes count from opening the picker, not from leaving', () => {
  openingSystemPicker(0);
  assert.equal(leavingForPicker(114_000), true, 'left at 1:54, still within the hold');
  assert.equal(backFromPickerTooLate(231_000), true, 'back at 3:51: the trip took longer than two minutes');
});

test('one hold covers one departure: back from the picker, leaving again is leaving', () => {
  openingSystemPicker(0);
  assert.equal(leavingForPicker(500), true);
  assert.equal(backFromPickerTooLate(20_000), false, 'back in time, the photo still on its way');
  assert.equal(leavingForPicker(21_000), false, 'the picker trip is not over yet, but this is another departure');
  assert.equal(backFromPickerTooLate(121_000), false, 'nothing held back, so nothing to report');
});

test('a picker over the app that never sent it away: back in front, leaving is leaving', () => {
  openingSystemPicker(0);
  assert.equal(backFromPickerTooLate(5_000), false, 'the picker closed; it only paused the app');
  assert.equal(leavingForPicker(6_000), false, 'the photo is still on its way, but this is a departure');
});

test('away too long: the lock engages even when the picker closed while the app was away', () => {
  const closed = openingSystemPicker(0);
  assert.equal(leavingForPicker(500), true);
  closed();
  assert.equal(backFromPickerTooLate(PICKER_AWAY_MS + 1), true);
});

test('a picker opened long ago holds nothing back, and an old close leaves a new picker open', () => {
  const first = openingSystemPicker(0);
  assert.equal(leavingForPicker(PICKER_AWAY_MS + 1), false, 'the picker was opened too long ago');
  openingSystemPicker(10_000);
  first();
  assert.equal(leavingForPicker(11_000), true, 'closing the first picker does not close the second');
});
