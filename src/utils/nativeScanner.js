/**
 * Native QR scanner — wrapper around @capacitor-mlkit/barcode-scanning using
 * the LIVE `startScan` API (not the `scan()` ready-to-use UI).
 *
 * Why `startScan` and not `scan()`:
 *
 *   `scan()` launches Google's GMS "code scanner" — a separate, full-screen
 *   Google-branded Activity ("Durch Google gesichert" / "scanned by Google on
 *   behalf of …"). It covers our own UI (so the Manual/Paste/Contacts tiles
 *   are unreachable mid-scan), the branding can't be removed, and it only
 *   exists on devices with Google Play services. `startScan` instead renders
 *   the camera feed BEHIND a transparent webview and fires a `barcodeScanned`
 *   event, letting us draw our own overlay on top — no Google branding, our
 *   buttons stay live, and the result is welded straight into the existing
 *   payment-parse flow. This mirrors the coinsnap implementation.
 *
 * What `startScan` actually depends on (checked against the plugin's Android
 * sources and Gradle module, v8.0.1):
 *
 *   - CameraX for the preview + frame analysis.
 *   - `com.google.mlkit:barcode-scanning` — the model BUNDLED into the APK.
 *     It decodes in-process and does not need Google Play services.
 *
 * The plugin's `isGoogleBarcodeScannerModuleAvailable()` /
 * `installGoogleBarcodeScannerModule()` talk to the Play-services
 * *code-scanner* module, which only `scan()` uses. An earlier version of this
 * file awaited them before every scan "so the camera opens afterwards"; on a
 * device without Play services (GrapheneOS without sandboxed Play, de-Googled
 * ROMs, feature phones) that probe fails or stalls, and even where it works
 * it gates the camera on a Google module we never use. It is gone. Startup is
 * now bounded by a timeout instead, and the decoder's own `scanError` events
 * are watched so a model that is missing at runtime is reported as an engine
 * failure the overlay can recover from (see `scannerEngine.js`).
 *
 * The transparency is handled by `body.barcode-scanner-active` (see app.css);
 * this module just toggles that class around the scan. The overlay UI itself
 * lives in `components/ScannerOverlay.vue`, which also owns the fallback to
 * the in-webview qr-scanner engine when this one cannot start.
 *
 * Platform behaviour:
 *   - iOS / Android: native MLKit live scanner.
 *   - Web / PWA: `isNativeScannerAvailable()` returns false; callers keep their
 *     existing qr-scanner (`<video>`) path. This wrapper never runs on web.
 */

import { Capacitor } from '@capacitor/core';
import { NATIVE_ERROR, createScanErrorGate, withTimeout } from './scannerEngine';

/**
 * Is the native scanner plugin registered on this platform? Web returns
 * false; native returns true only if the plugin is actually registered.
 *
 * Registration says nothing about whether the engine can start on this
 * device — that is decided by attempting it (`startLiveScan`) and, if that
 * fails, by `ScannerOverlay`'s fallback. Call sites use this only to choose
 * the full-screen overlay over their in-page `<video>` path.
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

function codedError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause !== undefined) err.cause = cause;
  return err;
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
    throw codedError(NATIVE_ERROR.PERMISSION_DENIED, 'Camera permission denied');
  }
}

/**
 * How long the camera gets to bind before we call the engine unusable. On a
 * healthy phone `startScan` resolves in well under a second; the budget only
 * exists so a device where CameraX or the model never comes up does not leave
 * the user staring at a blank overlay.
 */
export const NATIVE_START_TIMEOUT_MS = 6000;

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
 * plugin is unavailable, permission is denied, the camera can't open, or the
 * start does not settle within `startTimeoutMs`. The thrown error carries a
 * `code` from `NATIVE_ERROR`.
 *
 * If the decoder reports errors before it has decoded anything (MLKit's way
 * of saying the model is missing at runtime), the scan is torn down and
 * `onEngineFailure(err)` is invoked once with `code = NATIVE_DECODER_FAILED`.
 * The controller is already stopped by then; the caller decides what to show
 * or which engine to try next.
 *
 * @param {object}   opts
 * @param {(value:string)=>void} opts.onResult
 * @param {(err:Error)=>void}   [opts.onEngineFailure]
 * @param {number}              [opts.startTimeoutMs]
 * @returns {Promise<{stop:()=>Promise<void>, toggleTorch:()=>Promise<boolean>, isTorchAvailable:()=>Promise<boolean>}>}
 */
export async function startLiveScan({
  onResult,
  onEngineFailure,
  startTimeoutMs = NATIVE_START_TIMEOUT_MS,
}) {
  if (!isNativeScannerAvailable()) {
    throw codedError(NATIVE_ERROR.UNAVAILABLE, 'Native scanner is not available on this platform.');
  }

  let plugin;
  try {
    plugin = await loadPlugin();
  } catch (err) {
    throw codedError(NATIVE_ERROR.UNAVAILABLE, 'Native scanner plugin failed to load.', err);
  }
  const { BarcodeScanner, BarcodeFormat, LensFacing } = plugin;

  await ensureCameraPermission(BarcodeScanner);

  let stopped = false;
  let started = false;
  let torchOn = false;
  const gate = createScanErrorGate();
  const listeners = [];

  async function teardown() {
    // Drop the transparency class first so the app (or whatever sub-sheet is
    // opening) repaints immediately, rather than staying hidden through the
    // async stopScan round-trip below.
    document.body.classList.remove('barcode-scanner-active');
    for (const l of listeners.splice(0)) {
      try { await l.remove(); } catch { /* noop */ }
    }
    try { await BarcodeScanner.removeAllListeners(); } catch { /* noop */ }
    try { await BarcodeScanner.stopScan(); } catch { /* noop */ }
    try { if (torchOn) await BarcodeScanner.disableTorch(); } catch { /* noop */ }
    torchOn = false;
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    await teardown();
  }

  listeners.push(await BarcodeScanner.addListener('barcodeScanned', (event) => {
    if (stopped) return;
    const value = event?.barcode?.rawValue || event?.barcode?.displayValue;
    if (!value) return;
    gate.onDecoded();
    onResult(value);
  }));

  // The bundled model decodes in-process, so on a healthy device this never
  // fires. When it does before the first decode it is the engine telling us
  // it cannot work here (typically a Google-side module that is not
  // installed); hand that to the caller as a failure instead of scanning a
  // live preview that will never produce a result.
  listeners.push(await BarcodeScanner.addListener('scanError', (event) => {
    if (stopped) return;
    const message = event?.message || 'Scanner reported an error.';
    console.warn('[nativeScanner] scanError:', message);
    if (!gate.onError(message)) return;
    const err = codedError(NATIVE_ERROR.DECODER_FAILED, message);
    stop().finally(() => {
      // If the start call has not returned yet it will see `stopped` and
      // throw DECODER_FAILED itself; only a running scan needs the callback.
      if (!started) return;
      try { onEngineFailure?.(err); } catch (cbErr) { console.error('[nativeScanner] onEngineFailure threw:', cbErr); }
    });
  }));

  // Camera feed shows through once the body is transparent.
  document.body.classList.add('barcode-scanner-active');

  const starting = BarcodeScanner.startScan({
    formats: [BarcodeFormat.QrCode],
    lensFacing: LensFacing.Back,
  });

  try {
    await withTimeout(starting, startTimeoutMs, {
      code: NATIVE_ERROR.START_TIMEOUT,
      message: `Native scanner did not start within ${startTimeoutMs}ms`,
    });
  } catch (err) {
    // Roll back the listeners + body class so a failed start doesn't leave
    // the app stuck in the transparent state. If the start was merely slow
    // and lands later, tear that camera down too — nobody owns it anymore.
    stopped = true;
    starting.then(() => BarcodeScanner.stopScan()).catch(() => { /* noop */ });
    await teardown();
    if (err?.code === NATIVE_ERROR.START_TIMEOUT) throw err;
    throw codedError(NATIVE_ERROR.START_FAILED, err?.message || 'Native scanner failed to start.', err);
  }

  if (stopped) {
    // A decoder failure raced the start; the scan was torn down, but the
    // camera may have finished binding after that teardown — release it.
    try { await BarcodeScanner.stopScan(); } catch { /* noop */ }
    throw codedError(NATIVE_ERROR.DECODER_FAILED, 'Native scanner stopped during startup.');
  }
  started = true;

  return {
    stop,

    async isTorchAvailable() {
      try {
        const { available } = await BarcodeScanner.isTorchAvailable();
        return !!available;
      } catch {
        return false;
      }
    },

    async toggleTorch() {
      if (stopped) return false;
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
