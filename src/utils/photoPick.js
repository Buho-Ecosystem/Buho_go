/**
 * One trip to the system photo picker, from a hidden `<input type="file">`.
 *
 * Choosing a photo is easy to see (`change`), closing the picker without one
 * is not: only newer web engines send the `cancel` event, and the app
 * supports phones with older ones. So a trip also counts as over
 * when the person is back (`watchReturn`) and no photo arrived within a
 * while, or when the caller sees the person touch its screen again (`back`).
 * A photo that arrives after that is still delivered: the caller can be told
 * "closed" first and "picked" a moment later, never "picked" twice.
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
 *   graceMs?: number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 *   holdLock?: () => () => void,
 * }} handlers
 * @returns {{ back: () => void, stop: () => void }}
 *   back: the person touched the caller's screen, so the picker is gone.
 *   stop: forget the trip (the caller's screen closed).
 */
export function pickPhoto(input, {
  onPicked,
  onClosed,
  watchReturn = browserReturn(),
  graceMs = RETURN_GRACE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  holdLock = openingSystemPicker,
}) {
  let closed = false;
  let picked = false;
  let timer = null;
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
  unwatchReturn = watchReturn(onReturn);
  // The same photo chosen twice in a row must still be a change.
  input.value = '';
  input.click();

  return {
    back() {
      if (!closed && !picked) close();
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
