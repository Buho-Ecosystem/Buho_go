/**
 * The web scanner's camera around photo trips, and one scanner per <video>.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/qrScanner.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhotoPause, pauseForPhoto, scannerFor } from '../qrScanner.js';

function fakeScanner(video = {}) {
  const calls = [];
  return {
    $video: video,
    calls,
    pause(stopStreamImmediately) { calls.push(['pause', stopStreamImmediately]); },
    stop() { calls.push(['stop']); },
    destroy() { calls.push(['destroy']); },
  };
}

test('pauseForPhoto lets go of the stream at once, then marks the scanner inactive', () => {
  const scanner = fakeScanner();
  pauseForPhoto(scanner);
  assert.deepEqual(scanner.calls, [['pause', true], ['stop']]);
  pauseForPhoto(null);
});

test('scannerFor keeps the scanner a <video> has', () => {
  const video = {};
  const current = fakeScanner(video);
  const made = scannerFor(video, current, () => assert.fail('no second scanner'));
  assert.equal(made, current);
  assert.deepEqual(current.calls, []);
});

test('scannerFor replaces one on a <video> since replaced, and makes one when there is none', () => {
  const old = fakeScanner({});
  const fresh = fakeScanner({});
  assert.equal(scannerFor({}, old, () => fresh), fresh);
  assert.deepEqual(old.calls, [['destroy']]);
  assert.equal(scannerFor({}, null, () => fresh), fresh);
});

test('scannerFor still makes a new one when the old one is already gone', () => {
  const old = { $video: {}, destroy() { throw new Error('destroyed'); } };
  const fresh = fakeScanner();
  assert.equal(scannerFor({}, old, () => fresh), fresh);
});

function screen({ scanner = fakeScanner(), canResume = true } = {}) {
  const state = { scanner, canResume, restarts: 0 };
  const pause = createPhotoPause({
    scanner: () => state.scanner,
    canResume: () => state.canResume,
    restart: () => { state.restarts += 1; },
  });
  return { state, pause };
}

test('a trip turns the camera off, and on again once when it is over', () => {
  const { state, pause } = screen();
  assert.equal(pause.paused, false);
  pause.pause();
  assert.equal(pause.paused, true);
  assert.deepEqual(state.scanner.calls, [['pause', true], ['stop']]);
  pause.resume();
  assert.equal(pause.paused, false);
  assert.equal(state.restarts, 1);
  pause.resume();
  assert.equal(state.restarts, 1, 'closed after a failed read: still one restart');
});

test('no camera back when the screen moved on, and the trip still ends', () => {
  const { state, pause } = screen();
  pause.pause();
  state.canResume = false;
  pause.resume();
  assert.equal(state.restarts, 0);
  assert.equal(pause.paused, false, 'a later camera start is not held back');
});

test('a screen that stopped its camera mid-trip starts afresh', () => {
  const { state, pause } = screen();
  pause.pause();
  pause.forget();
  assert.equal(pause.paused, false);
  pause.resume();
  assert.equal(state.restarts, 0, 'the picker closing later does not start a camera');
});

test('a trip before the camera exists only holds its start back', () => {
  const { state, pause } = screen({ scanner: null });
  pause.pause();
  assert.equal(pause.paused, true);
  pause.resume();
  assert.equal(state.restarts, 1, 'the screen starts its camera now');
});

test('resume without a trip does nothing', () => {
  const { state, pause } = screen();
  pause.resume();
  assert.equal(state.restarts, 0);
});
