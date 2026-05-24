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
