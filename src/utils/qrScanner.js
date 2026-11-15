import QrScanner from 'qr-scanner';

/**
 * Construct a camera-stream QrScanner with project-wide defaults applied.
 *
 * The only deviation from the library's defaults is enabling inversion-mode
 * `'both'`, so the scanner also recognizes inverted QR codes (white on black).
 * `qr-scanner` defaults camera streams to `'original'`, which silently fails
 * on inverted codes. Inverted codes are common on dark-mode payment terminals
 * and OLED screens (see Phoenix issue ACINQ/phoenix#784 for the same bug).
 *
 * `setInversionMode` posts a message to the worker that backs the scanner.
 * The worker promise is created in the QrScanner constructor, so calling
 * this immediately after `new QrScanner(...)` is safe — the message is
 * queued until the worker is ready, independent of `start()`.
 *
 * Always go through this factory instead of `new QrScanner(...)` directly,
 * so future tweaks to scanner defaults land in every call site at once.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {(result: import('qr-scanner').default.ScanResult | string) => void} onResult
 * @param {ConstructorParameters<typeof QrScanner>[2]} [options]
 *   Forwarded as-is to the QrScanner constructor.
 * @returns {QrScanner}
 */
export function createQrScanner(videoEl, onResult, options = {}) {
  const scanner = new QrScanner(videoEl, onResult, options);
  scanner.setInversionMode('both');
  return scanner;
}

/**
 * The camera off at once for a trip to the photo picker, the scanner kept so
 * start() can turn it back on.
 *
 * pause(true) lets go of the stream now. stop() then marks the scanner
 * inactive: a paused but active scanner starts itself again as soon as the
 * page is visible, which would light the camera behind the open picker or
 * while the photo is read. Not stop() alone: it lets go of the stream 300 ms
 * later, by when a restarted scanner on the same <video> owns it.
 *
 * stop() still leaves that 300 ms timer behind. It passes over this scanner
 * once start() runs again, but would stop a second scanner's stream on the
 * same <video>: so a screen keeps one scanner per <video> (scannerFor).
 *
 * @param {QrScanner | null | undefined} scanner
 */
export function pauseForPhoto(scanner) {
  if (!scanner) return;
  scanner.pause(true);
  scanner.stop();
}

/**
 * The scanner for a screen's <video>: the one the screen has when it is on
 * that element, otherwise a new one. One on an element since replaced (the
 * camera area was re-rendered) is destroyed first. Never two on one <video>:
 * a stopped one's late timer would take the other's stream (pauseForPhoto).
 *
 * Returned before it starts, so the screen holds it while start() runs and
 * a close meanwhile can stop it.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {QrScanner | null | undefined} current the screen's scanner, if any
 * @param {() => QrScanner} create makes one for videoEl (createQrScanner)
 * @returns {QrScanner}
 */
export function scannerFor(videoEl, current, create) {
  if (current && current.$video === videoEl) return current;
  if (current) {
    try { current.destroy(); } catch { /* already gone */ }
  }
  return create();
}

/**
 * A screen's camera around trips to the photo picker: off from the moment
 * Choose photo is tapped until the photo is read or the picker closed, then
 * on again unless the screen has moved on (took a code, lost its camera).
 * One per screen, made in created(). The screen keeps its own note.
 *
 * The screen asks `paused` before a camera start begins, and again once one
 * that was under way has started (pauseForPhoto it then). Stopping its
 * camera ends a trip for good (forget): the next opening starts afresh.
 *
 * @param {{
 *   scanner: () => QrScanner | null | undefined,
 *   canResume: () => boolean,
 *   restart: () => unknown,
 * }} screen
 *   scanner:   the screen's scanner, if it has one yet
 *   canResume: the screen still shows its camera and still wants a code
 *   restart:   the camera on again (startQrScanner, which keeps the scanner
 *              it has: scannerFor)
 */
export function createPhotoPause({ scanner, canResume, restart }) {
  let paused = false;
  return {
    /** The picker is open or its photo is being read: no camera start may begin. */
    get paused() {
      return paused;
    },
    /** Choose photo was tapped. */
    pause() {
      paused = true;
      pauseForPhoto(scanner());
    },
    /** The trip is over (a photo read or failed, or the picker closed). Once per trip. */
    resume() {
      if (!paused) return;
      paused = false;
      if (canResume()) restart();
    },
    /** The screen let go of its camera. */
    forget() {
      paused = false;
    },
  };
}
