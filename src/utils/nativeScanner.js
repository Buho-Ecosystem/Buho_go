/**
 * Native QR scanner — wrapper around @capacitor-mlkit/barcode-scanning using
 * the LIVE `startScan` API (not the `scan()` ready-to-use UI).
 *
 * Why `startScan` and not `scan()`:
 *
 *   `scan()` launches Google's GMS "code scanner" — a separate, full-screen
 *   Google-branded Activity ("Durch Google gesichert" / "scanned by Google on
 *   behalf of …"). It covers our own UI (so the Manual/Paste/Contacts tiles
 *   are unreachable mid-scan) and the branding can't be removed. `startScan`
 *   instead renders the camera feed BEHIND a transparent webview and fires a
 *   `barcodeScanned` event, letting us draw our own overlay on top — no Google
 *   branding, our buttons stay live, and the result is welded straight into the
 *   existing payment-parse flow. This mirrors the coinsnap implementation.
 *
 * The transparency is handled by `body.barcode-scanner-active` (see app.css);
 * this module just toggles that class around the scan. The overlay UI itself
 * lives in `components/ScannerOverlay.vue`.
 *
 * Platform behaviour:
 *   - iOS / Android: native MLKit live scanner.
 *   - Web / PWA: `isNativeScannerAvailable()` returns false; callers keep their
 *     existing qr-scanner (`<video>`) path. This wrapper never runs on web.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Is the native scanner plugin available on this platform? Web returns false;
 * native returns true only if the plugin is actually registered.
 */
export function isNativeScannerAvailable() {
  if (!Capacitor.isNativePlatform()) return false;
  return Capacitor.isPluginAvailable?.('BarcodeScanner') ?? false;
}

let _pluginPromise = null;
function loadPlugin() {
  // Lazy import — keeps the web bundle from pulling MLKit code paths it can
  // never run, and lets the plugin be absent during dev without crashing the
  // import graph.
  if (!_pluginPromise) {
    _pluginPromise = import('@capacitor-mlkit/barcode-scanning').catch((err) => {
      _pluginPromise = null;
      throw err;
    });
  }
  return _pluginPromise;
}

/**
 * On Android the MLKit scanner module is downloaded on demand. Block on the
 * install the first time so the camera opens afterwards. Best-effort: a failure
 * here doesn't stop the scan attempt.
 */
async function ensureModuleInstalled(BarcodeScanner) {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule();
  } catch (err) {
    console.warn('[nativeScanner] module install probe failed:', err);
  }
}

/**
 * Make sure camera permission is granted. Throws an Error with
 * `code = 'PERMISSION_DENIED'` if the user said no.
 */
async function ensureCameraPermission(BarcodeScanner) {
  const current = await BarcodeScanner.checkPermissions();
  let status = current.camera;
  if (status === 'prompt' || status === 'prompt-with-rationale') {
    status = (await BarcodeScanner.requestPermissions()).camera;
  }
  if (status !== 'granted' && status !== 'limited') {
    const err = new Error('Camera permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
}

/**
 * Start a live native scan.
 *
 * Adds `body.barcode-scanner-active` (camera renders behind the webview) and
 * invokes `onResult(value)` for each decoded QR string. Returns a controller:
 *
 *   - `stop()`            — stop scanning, drop torch, remove the body class.
 *   - `toggleTorch()`     — flip the torch, resolves to the new on/off state.
 *   - `isTorchAvailable()`— whether the device exposes a torch.
 *
 * Throws before starting (so the caller can fall back / show an error) if the
 * plugin is unavailable, permission is denied, or the camera can't open.
 *
 * @param {object}   opts
 * @param {(value:string)=>void} opts.onResult
 * @returns {Promise<{stop:()=>Promise<void>, toggleTorch:()=>Promise<boolean>, isTorchAvailable:()=>Promise<boolean>}>}
 */
export async function startLiveScan({ onResult }) {
  if (!isNativeScannerAvailable()) {
    throw new Error('Native scanner is not available on this platform.');
  }

  const { BarcodeScanner, BarcodeFormat, LensFacing } = await loadPlugin();

  await ensureCameraPermission(BarcodeScanner);
  await ensureModuleInstalled(BarcodeScanner);

  let stopped = false;
  let torchOn = false;

  const listener = await BarcodeScanner.addListener('barcodeScanned', (event) => {
    if (stopped) return;
    const value = event?.barcode?.rawValue || event?.barcode?.displayValue;
    if (value) onResult(value);
  });

  // Camera feed shows through once the body is transparent.
  document.body.classList.add('barcode-scanner-active');

  try {
    await BarcodeScanner.startScan({
      formats: [BarcodeFormat.QrCode],
      lensFacing: LensFacing.Back,
    });
  } catch (err) {
    // Roll back the listener + body class so a failed start doesn't leave the
    // app stuck in the transparent state.
    try { await listener.remove(); } catch { /* noop */ }
    document.body.classList.remove('barcode-scanner-active');
    throw err;
  }

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      // Drop the transparency class first so the app (or whatever sub-sheet is
      // opening) repaints immediately, rather than staying hidden through the
      // async stopScan round-trip below.
      document.body.classList.remove('barcode-scanner-active');
      try { await listener.remove(); } catch { /* noop */ }
      try { await BarcodeScanner.removeAllListeners(); } catch { /* noop */ }
      try { await BarcodeScanner.stopScan(); } catch { /* noop */ }
      try { if (torchOn) await BarcodeScanner.disableTorch(); } catch { /* noop */ }
      torchOn = false;
    },

    async isTorchAvailable() {
      try {
        const { available } = await BarcodeScanner.isTorchAvailable();
        return !!available;
      } catch {
        return false;
      }
    },

    async toggleTorch() {
      try {
        if (torchOn) await BarcodeScanner.disableTorch();
        else await BarcodeScanner.enableTorch();
        torchOn = !torchOn;
      } catch (err) {
        console.warn('[nativeScanner] torch toggle failed:', err);
      }
      return torchOn;
    },
  };
}
