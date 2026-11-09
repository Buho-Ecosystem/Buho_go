/**
 * One trip to the system photo picker: every way it can end reports once,
 * a late photo still arrives, and the app lock is held back only meanwhile.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/photoPick.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserReturn, pickPhoto, RETURN_GRACE_MS } from '../photoPick.js';

/** Minimal event target. */
function target(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    fire(type) { for (const fn of listeners.get(type) || []) fn(); },
    count(type) { return (listeners.get(type) || []).length; },
  };
}

function trip(t, overrides = {}) {
  const input = target({ files: [], value: 'old', clicks: 0 });
  input.click = () => { input.clicks += 1; };
  const win = target();
  const doc = target({ visibilityState: 'visible' });
  const events = [];
  const lock = { held: 0, released: 0 };
  const handle = pickPhoto(input, {
    onPicked: (file) => events.push(['picked', file.name]),
    onClosed: () => events.push(['closed']),
    watchReturn: browserReturn(win, doc),
    holdLock: () => { lock.held += 1; return () => { lock.released += 1; }; },
    ...overrides,
  });
  const choose = (name) => { input.files = name ? [{ name }] : []; input.fire('change'); };
  return { input, win, doc, events, lock, handle, choose };
}

test('the picker opens from the tap, cleared so the same photo twice is still a change', (t) => {
  const { input, lock } = trip(t);
  assert.equal(input.clicks, 1);
  assert.equal(input.value, '');
  assert.equal(lock.held, 1);
});

test('a chosen photo is delivered once; the lock is let go; nothing listens any more', (t) => {
  const { input, win, doc, events, lock, choose } = trip(t);
  choose('qr.png');
  choose('qr.png');
  assert.deepEqual(events, [['picked', 'qr.png']]);
  assert.ok(lock.released >= 1);
  assert.equal(input.count('change') + input.count('cancel') + win.count('focus'), 0);
  assert.equal(doc.count('visibilitychange'), 0);
});

test('closed without a photo, as the engine says (cancel, or a change with no file)', (t) => {
  const a = trip(t);
  a.input.fire('cancel');
  a.input.fire('cancel');
  assert.deepEqual(a.events, [['closed']]);
  assert.ok(a.lock.released >= 1);
  const b = trip(t);
  b.choose(null);
  assert.deepEqual(b.events, [['closed']]);
});

test('an engine that never says so: back in front with no photo within a moment is closed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, events, lock } = trip(t, { setTimer: setTimeout, clearTimer: clearTimeout });
  win.fire('focus');
  t.mock.timers.tick(RETURN_GRACE_MS - 1);
  assert.deepEqual(events, []);
  t.mock.timers.tick(1);
  assert.deepEqual(events, [['closed']]);
  assert.ok(lock.released >= 1);
});

test('back in front and the photo arrives within the moment: picked, never closed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, events, choose } = trip(t, { setTimer: setTimeout, clearTimer: clearTimeout });
  win.fire('focus');
  choose('late.jpg');
  t.mock.timers.tick(RETURN_GRACE_MS * 2);
  assert.deepEqual(events, [['picked', 'late.jpg']]);
});

test('a photo slower than the moment still arrives after "closed"', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, events, choose } = trip(t, { setTimer: setTimeout, clearTimer: clearTimeout });
  doc.fire('visibilitychange');
  t.mock.timers.tick(RETURN_GRACE_MS);
  choose('slow.jpg');
  assert.deepEqual(events, [['closed'], ['picked', 'slow.jpg']]);
});

test('the page going to the background is not a return', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, events } = trip(t, { setTimer: setTimeout, clearTimer: clearTimeout });
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange');
  t.mock.timers.tick(RETURN_GRACE_MS * 3);
  assert.deepEqual(events, []);
});

test('a touch on the scanner means the picker is gone; stop forgets the trip', (t) => {
  const a = trip(t);
  a.handle.back();
  a.handle.back();
  assert.deepEqual(a.events, [['closed']]);
  const b = trip(t);
  b.handle.stop();
  b.choose('after-close.jpg');
  b.input.fire('cancel');
  assert.deepEqual(b.events, [], 'a screen that closed hears nothing more');
  assert.ok(b.lock.released >= 1);
});

test('in the app, back means the app resumed: a focus while the picker opens is not a return', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resumed = target();
  const { win, events, choose } = trip(t, {
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    watchReturn: (callback) => {
      resumed.addEventListener('resume', callback);
      return () => resumed.removeEventListener('resume', callback);
    },
  });
  win.fire('focus');
  t.mock.timers.tick(RETURN_GRACE_MS * 3);
  assert.deepEqual(events, [], 'the window had focus for a moment; the picker is still open');
  resumed.fire('resume');
  t.mock.timers.tick(2300);
  choose('measured.jpg');
  assert.deepEqual(events, [['picked', 'measured.jpg']], 'a photo 2.3 s after resuming is picked, not closed first');
  assert.equal(resumed.count('resume'), 0, 'nothing listens once the trip is over');
});
