/**
 * One trip to the system photo picker: every way it can end reports once,
 * a late photo still arrives, and the app lock is held back only meanwhile.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/photoPick.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appResumeReturn, browserReturn, engineSendsCancel, pickPhoto, RETURN_GRACE_MS, TOUCH_SETTLE_MS } from '../photoPick.js';
import { leavingForPicker, resetAppLock } from '../appLock.js';

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

function trip(overrides = {}) {
  const input = target({ files: [], value: 'old', clicks: 0 });
  input.click = () => { input.clicks += 1; };
  const win = target();
  const doc = target({ visibilityState: 'visible' });
  const events = [];
  const lock = { held: 0, released: 0 };
  const clock = { now: 1_000_000 };
  const handle = pickPhoto(input, {
    onPicked: (file) => events.push(['picked', file.name]),
    onClosed: () => events.push(['closed']),
    watchReturn: browserReturn(win, doc),
    trustCancel: false,
    now: () => clock.now,
    holdLock: () => { lock.held += 1; return () => { lock.released += 1; }; },
    ...overrides,
  });
  const choose = (name) => { input.files = name ? [{ name }] : []; input.fire('change'); };
  return { input, win, doc, events, lock, clock, handle, choose };
}

test('the picker opens from the tap, cleared so the same photo twice is still a change', () => {
  const { input, lock } = trip();
  assert.equal(input.clicks, 1);
  assert.equal(input.value, '');
  assert.equal(lock.held, 1);
});

test('a chosen photo is delivered once; the lock is let go; nothing listens any more', () => {
  const { input, win, doc, events, lock, choose } = trip();
  choose('qr.png');
  choose('qr.png');
  assert.deepEqual(events, [['picked', 'qr.png']]);
  assert.ok(lock.released >= 1);
  assert.equal(input.count('change') + input.count('cancel') + win.count('focus'), 0);
  assert.equal(doc.count('visibilitychange'), 0);
});

test('closed without a photo, as the engine says (cancel, or a change with no file)', () => {
  const a = trip();
  a.input.fire('cancel');
  a.input.fire('cancel');
  assert.deepEqual(a.events, [['closed']]);
  assert.ok(a.lock.released >= 1);
  const b = trip();
  b.choose(null);
  assert.deepEqual(b.events, [['closed']]);
});

test('an engine that never says so: back in front with no photo within a moment is closed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, events, lock } = trip({ setTimer: setTimeout, clearTimer: clearTimeout });
  win.fire('focus');
  t.mock.timers.tick(RETURN_GRACE_MS - 1);
  assert.deepEqual(events, []);
  t.mock.timers.tick(1);
  assert.deepEqual(events, [['closed']]);
  assert.ok(lock.released >= 1);
});

test('back in front and the photo arrives within the moment: picked, never closed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { win, events, choose } = trip({ setTimer: setTimeout, clearTimer: clearTimeout });
  win.fire('focus');
  choose('late.jpg');
  t.mock.timers.tick(RETURN_GRACE_MS * 2);
  assert.deepEqual(events, [['picked', 'late.jpg']]);
});

test('a photo slower than the moment still arrives after "closed"', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, events, choose } = trip({ setTimer: setTimeout, clearTimer: clearTimeout });
  doc.fire('visibilitychange');
  t.mock.timers.tick(RETURN_GRACE_MS);
  choose('slow.jpg');
  assert.deepEqual(events, [['closed'], ['picked', 'slow.jpg']]);
});

test('the page going to the background is not a return', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, events } = trip({ setTimer: setTimeout, clearTimer: clearTimeout });
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange');
  t.mock.timers.tick(RETURN_GRACE_MS * 3);
  assert.deepEqual(events, []);
});

test('a touch on the scanner means the picker is gone; stop forgets the trip', () => {
  const a = trip();
  a.clock.now += TOUCH_SETTLE_MS;
  a.handle.back();
  a.handle.back();
  assert.deepEqual(a.events, [['closed']]);
  const b = trip();
  b.handle.stop();
  b.choose('after-close.jpg');
  b.input.fire('cancel');
  assert.deepEqual(b.events, [], 'a screen that closed hears nothing more');
  assert.ok(b.lock.released >= 1);
});

test('in the app, back means the app resumed: a focus while the picker opens is not a return', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resumed = target();
  const { win, events, choose } = trip({
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

test('the lock is held for the whole trip and let go only when it ends', () => {
  const { lock, events, clock, handle } = trip();
  assert.deepEqual(lock, { held: 1, released: 0 }, 'held from the moment the picker opens');
  clock.now += TOUCH_SETTLE_MS - 1;
  handle.back();
  assert.deepEqual(lock, { held: 1, released: 0 }, 'still held while the picker is on its way');
  assert.deepEqual(events, []);
  clock.now += 1;
  handle.back();
  assert.deepEqual(events, [['closed']]);
  assert.ok(lock.released >= 1, 'let go once the trip is over');
});

test('a touch while the picker is still opening is not the person back', () => {
  const { events, clock, handle } = trip();
  handle.back();
  clock.now += TOUCH_SETTLE_MS - 1;
  handle.back();
  assert.deepEqual(events, []);
});

test('an engine that sends cancel is taken at its word: no guessing from focus or touches', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, win, doc, events, clock, handle } = trip({
    trustCancel: true, setTimer: setTimeout, clearTimer: clearTimeout,
  });
  assert.equal(handle.guesses, false);
  assert.equal(win.count('focus') + doc.count('visibilitychange'), 0, 'nothing watches for a return');
  win.fire('focus');
  t.mock.timers.tick(RETURN_GRACE_MS * 3);
  clock.now += TOUCH_SETTLE_MS * 10;
  handle.back();
  assert.deepEqual(events, [], 'focus and touches say nothing about the picker here');
  input.fire('cancel');
  assert.deepEqual(events, [['closed']]);
});

test('which engines send cancel: from 2023 on, unknown ones count as older', () => {
  const ua = {
    androidApp: 'Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.135 Mobile Safari/537.36',
    androidAppOld: 'Mozilla/5.0 (Linux; Android 7.0; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.86 Mobile Safari/537.36',
    phone164: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    phone155: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    otherBrowserOnOldPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
    desktop163: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15',
    desktop172: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    gecko: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    chromium112: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.49 Safari/537.36',
    chromium113: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.63 Safari/537.36',
    gecko90: 'Mozilla/5.0 (X11; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0',
    gecko91: 'Mozilla/5.0 (X11; Linux x86_64; rv:91.0) Gecko/20100101 Firefox/91.0',
    unknown: 'SomeEngine/1.0',
  };
  const sends = Object.fromEntries(Object.entries(ua).map(([k, v]) => [k, engineSendsCancel(v)]));
  assert.deepEqual(sends, {
    androidApp: true,
    androidAppOld: false,
    phone164: true,
    phone155: false,
    otherBrowserOnOldPhone: false,
    desktop163: false,
    desktop172: true,
    gecko: true,
    chromium112: false,
    chromium113: true,
    gecko90: false,
    gecko91: true,
    unknown: false,
  });
});

test('no app lock is held unless the caller asks for it', () => {
  resetAppLock();
  pickPhoto(target({ files: [], value: '', click() {} }), {
    onPicked() {}, onClosed() {}, trustCancel: true,
  });
  assert.equal(leavingForPicker(), false, 'going to the background now is leaving the app');
});

/** An app plugin whose addListener resolves when the test says so. */
function appPlugin() {
  const app = { listeners: 0, removed: 0, pending: [] };
  app.addListener = (event, callback) => new Promise((resolve) => {
    app.pending.push(() => {
      app.listeners += 1;
      app.fire = callback;
      resolve({ remove() { app.removed += 1; } });
    });
  });
  app.settle = async () => { for (const add of app.pending.splice(0)) add(); await new Promise((r) => setImmediate(r)); };
  return app;
}

test('in the app, back is the app resuming, and unsubscribing removes the listener', async () => {
  const app = appPlugin();
  let backs = 0;
  const unsubscribe = appResumeReturn(app)(() => { backs += 1; });
  await new Promise((r) => setImmediate(r));
  await app.settle();
  app.fire();
  assert.equal(backs, 1);
  unsubscribe();
  assert.equal(app.removed, 1);
});

test('unsubscribed before the listener was in place: it is removed once it is', async () => {
  const app = appPlugin();
  const unsubscribe = appResumeReturn(app)(() => {});
  await new Promise((r) => setImmediate(r));
  unsubscribe();
  assert.equal(app.removed, 0, 'nothing to remove yet');
  await app.settle();
  assert.equal(app.removed, 1);
});

test('without the app plugin, watching for the return fails quietly', async () => {
  const unsubscribe = appResumeReturn({ addListener: () => Promise.reject(new Error('not implemented')) })(() => {});
  await new Promise((r) => setImmediate(r));
  unsubscribe();
});
