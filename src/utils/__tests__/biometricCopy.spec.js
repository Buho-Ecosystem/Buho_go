/**
 * The app-lock sheet's words and pictures.
 *
 * Each way the phone can check it's you gets its name as the title, one
 * line on when BuhoGO asks, and an illustration that shows that method.
 * Every string must exist in every language, and every picture must be a
 * file the app actually ships.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { Capacitor } from '@capacitor/core';

import { getBiometricMethodCopy } from '../biometricCopy.js';
import en from '../../i18n/en-US/index.js';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';

const TYPES = ['fingerprint', 'face', 'iris', 'multiple', 'device-pin', 'none'];
const PUBLIC = new URL('../../../public', import.meta.url).pathname;
const identity = (key) => key;

function onPlatform(platform, fn) {
  const real = Capacitor.getPlatform;
  Capacitor.getPlatform = () => platform;
  try {
    return fn();
  } finally {
    Capacitor.getPlatform = real;
  }
}

await test('every lock type has a title, one line and a picture', () => {
  for (const type of TYPES) {
    const copy = getBiometricMethodCopy(type, identity);
    assert.ok(copy.title, `${type}: title`);
    assert.match(copy.line, /whenever we need to be sure it's you\.$/, `${type}: line`);
    assert.ok(existsSync(`${PUBLIC}${copy.illustration}`), `${type}: ${copy.illustration} is shipped`);
  }
});

await test('the picture shows the method the phone will ask for', () => {
  const picture = (type) => getBiometricMethodCopy(type, identity).illustration;
  assert.match(picture('fingerprint'), /fingerprint/);
  for (const type of ['face', 'iris', 'multiple']) assert.match(picture(type), /face-scan/, type);
  for (const type of ['device-pin', 'none']) assert.match(picture(type), /secure-login/, type);
});

await test('the titles follow the platform names', () => {
  const titles = (platform) => onPlatform(platform, () => ({
    fingerprint: getBiometricMethodCopy('fingerprint', identity).title,
    face: getBiometricMethodCopy('face', identity).title,
  }));
  assert.deepEqual(titles('android'), { fingerprint: 'Fingerprint', face: 'Face recognition' });
  assert.deepEqual(titles('ios'), { fingerprint: 'Touch ID', face: 'Face ID' });
});

await test('every string is translated in every language', () => {
  for (const [lang, messages] of Object.entries({ en, de, es })) {
    for (const platform of ['android', 'ios']) {
      for (const type of TYPES) {
        onPlatform(platform, () => getBiometricMethodCopy(type, (key) => {
          assert.ok(messages[key], `${lang}: missing "${key}"`);
          return messages[key];
        }));
      }
    }
  }
});

console.log('\n4 passed, 0 failed');
