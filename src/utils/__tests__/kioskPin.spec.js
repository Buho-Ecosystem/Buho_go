import test from 'node:test';
import assert from 'node:assert/strict';
import { hashKioskPin, kioskPinMatches, savedKioskPinHash } from '../kioskPin.js';

test('the saved PIN never contains the PIN, and only the right PIN matches', () => {
  const stored = hashKioskPin('2468');
  assert.ok(!stored.includes('2468'));
  assert.equal(kioskPinMatches('2468', stored), true);
  for (const wrong of ['2469', '', undefined, '24680']) assert.equal(kioskPinMatches(wrong, stored), false);
  assert.equal(kioskPinMatches('2468', ''), false, 'no PIN set: nothing matches');
  assert.notEqual(hashKioskPin('2468'), stored, 'a fresh salt each time');
});

test('a PIN saved in plain text by an earlier version is read as a hash', () => {
  const migrated = savedKioskPinHash({ kioskPin: '1357' });
  assert.ok(!migrated.includes('1357'));
  assert.equal(kioskPinMatches('1357', migrated), true);
  const stored = hashKioskPin('1357');
  assert.equal(savedKioskPinHash({ kioskPinHash: stored, kioskPin: '9999' }), stored, 'a hash wins');
  assert.equal(savedKioskPinHash({}), '');
});
