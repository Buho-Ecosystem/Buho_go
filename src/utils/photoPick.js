/**
 * One trip to the system photo picker, from a hidden `<input type="file">`.
 *
 * Choosing a photo is easy to see (`change`), closing the picker without one
 * is not: only newer web engines send the `cancel` event, and the app
 * supports phones with older ones. An engine that sends it is taken at its
 * word (`engineSendsCancel`). On an older one a trip also counts as over
 * when the person is back (`watchReturn`) and no photo arrived within a
 * while, or when the caller sees the person touch its screen again (`back`).
 * Those are guesses, so a newer engine never uses them: focus comes back for
 * a moment while some pickers are still opening, and a touch can land while
 * the picker is still on its way. A photo that arrives after a guess is
 * still delivered: the caller can be told "closed" first and "picked" a
 * moment later, never "picked" twice.
 *
 * What "back" means is the caller's: in a browser the page's window has focus
 * again or the page is visible again (`browserReturn`). Not in the app: on
 * Android the window gets focus back for a moment while the picker is still
 * opening, and the page never turns hidden; there the app resuming is the
 * return.
 *
 * The app lock is held back for the trip (appLock.openingSystemPicker), since
 * on some phones the picker sends the app to the background.
 *
 * Browser objects are injected, so the rules are testable with Node alone.
 */
import { openingSystemPicker } from './appLock.js';

/**
 * After the person is back, how long a photo still has to arrive before the
 * trip counts as closed. On Android the chosen photo arrives up to 2.3 s
 * after the app resumed (measured). Only engines without `cancel` ever wait
 * this long, and a touch ends the wait at once.
 */
export const RETURN_GRACE_MS = 4000;

/** A touch this soon after opening is the picker still on its way, not the person back. */
export const TOUCH_SETTLE_MS = 700;

/**
 * Does this web engine send `cancel` when its file picker closes without a
 * file? Engines from 2023 on do; for older ones the trip has to guess.
 * Unknown engines count as older.
 *
 * @param {string} [ua] the user agent
 * @returns {boolean}
 */
export function engineSendsCancel(ua = globalThis.navigator?.userAgent || '') {
  const atLeast = (major, minor, wantMajor, wantMinor) =>
    major > wantMajor || (major === wantMajor && minor >= wantMinor);
  // Where the user agent names the OS version ('OS 16_4'), every browser
  // runs the system engine, so that version decides.
  const touchOs = /(?:iPhone|iPad|iPod)[^)]*? OS (\d+)_(\d+)/.exec(ua);
  if (touchOs) return atLeast(Number(touchOs[1]), Number(touchOs[2]), 16, 4);
  const chromium = /(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(ua);
  if (chromium) return Number(chromium[1]) >= 113;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return Number(firefox[1]) >= 91;
  const versioned = /Version\/(\d+)\.(\d+)(?:\.\d+)? Safari\//.exec(ua);
  if (versioned) return atLeast(Number(versioned[1]), Number(versioned[2]), 16, 4);
  return false;
}

/**
 * "Back" in a browser: the window has focus again, or the page is visible
 * again. As `watchReturn` for pickPhoto: subscribe(callback) => unsubscribe.
 *
 * @param {Pick<Window, 'addEventListener'|'removeEventListener'>} [win]
 * @param {Pick<Document, 'addEventListener'|'removeEventListener'|'visibilityState'>} [doc]
 * @returns {(callback: () => void) => () => void}
 */
export function browserReturn(win = globalThis.window, doc = globalThis.document) {
  return (callback) => {
    const onVisibility = () => { if (doc?.visibilityState !== 'hidden') callback(); };
    win?.addEventListener('focus', callback);
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      win?.removeEventListener('focus', callback);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  };
}

/**
 * Open the picker and report how the trip ends.
 *
 * Must be called from the person's tap: browsers open a picker only from one.
 *
 * @param {HTMLInputElement} input a hidden file input, accept="image/*"
 * @param {{
 *   onPicked: (file: File) => void,
 *   onClosed: () => void,
 *   watchReturn?: (callback: () => void) => () => void,
 *   trustCancel?: boolean,
 *   graceMs?: number,
 *   now?: () => number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 *   holdLock?: () => () => void,
 * }} handlers
 * @returns {{ back: () => void, stop: () => void, guesses: boolean }}
 *   back: the person touched the caller's screen, so the picker is gone
 *         (only on engines that guess, and not while it is still opening).
 *   stop: forget the trip (the caller's screen closed).
 *   guesses: whether this engine needs the guesses; a caller that watches
 *         touches only needs to when it does.
 */
export function pickPhoto(input, {
  onPicked,
  onClosed,
  watchReturn = browserReturn(),
  trustCancel = engineSendsCancel(),
  graceMs = RETURN_GRACE_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  holdLock = openingSystemPicker,
}) {
  let closed = false;
  let picked = false;
  let timer = null;
  const openedAt = now();
  const releaseLock = holdLock();

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimer(timer);
    releaseLock();
    onClosed();
  };
  const onChange = () => {
    const file = input.files?.[0];
    if (!file) { close(); return; }
    if (picked) return;
    picked = true;
    clearTimer(timer);
    releaseLock();
    stopListening();
    onPicked(file);
  };
  const onCancel = () => close();
  const onReturn = () => {
    if (closed || picked) return;
    clearTimer(timer);
    timer = setTimer(close, graceMs);
  };

  let unwatchReturn = () => {};
  function stopListening() {
    input.removeEventListener('change', onChange);
    input.removeEventListener('cancel', onCancel);
    unwatchReturn();
  }

  input.addEventListener('change', onChange);
  input.addEventListener('cancel', onCancel);
  if (!trustCancel) unwatchReturn = watchReturn(onReturn);
  // The same photo chosen twice in a row must still be a change.
  input.value = '';
  input.click();

  return {
    guesses: !trustCancel,
    back() {
      if (trustCancel || closed || picked) return;
      if (now() - openedAt < TOUCH_SETTLE_MS) return;
      close();
    },
    stop() {
      closed = true;
      picked = true;
      clearTimer(timer);
      releaseLock();
      stopListening();
    },
  };
}
