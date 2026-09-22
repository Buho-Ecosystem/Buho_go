/**
 * Scanner engine selection — the platform-free half of the QR scanner.
 *
 * BuhoGO has two scanning engines on a native build:
 *
 *   native  @capacitor-mlkit/barcode-scanning `startScan`: CameraX preview
 *           behind a transparent WebView, decoded by the MLKit model that is
 *           BUNDLED into the APK (`com.google.mlkit:barcode-scanning`). Fast,
 *           and it does not talk to Google Play services.
 *   web     qr-scanner on a `<video>` fed by `getUserMedia` inside the
 *           WebView. Slower, but it needs nothing beyond a camera and the
 *           CAMERA permission, so it runs on GrapheneOS without Play
 *           services, on de-Googled ROMs and on Android feature phones.
 *
 * The native engine is preferred. Whether it *works* on a given device cannot
 * be read off the OS name or a Play-services flag: what matters is whether
 * the camera binds and the first frames decode. So selection is capability-
 * based — try native, watch the startup, and if it fails in a way that is
 * not a permission problem, switch to web and remember that on this device.
 *
 * Everything in this file is pure (storage and clock are injected) so the
 * policy is unit-testable with Node alone. The Capacitor-facing wrapper lives
 * in `nativeScanner.js`; the UI that drives both engines is
 * `components/ScannerOverlay.vue`.
 */

/** Error codes set on `err.code` by the native wrapper. */
export const NATIVE_ERROR = Object.freeze({
  /** User (or the OS) refused the camera. Same answer for both engines: do not fall back. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** Plugin not registered on this build/platform. */
  UNAVAILABLE: 'NATIVE_UNAVAILABLE',
  /** `startScan` rejected (camera bind failed, CameraX init error, …). */
  START_FAILED: 'NATIVE_START_FAILED',
  /** `startScan` neither resolved nor rejected within the budget. */
  START_TIMEOUT: 'NATIVE_START_TIMEOUT',
  /** The decoder reported errors before it decoded anything. */
  DECODER_FAILED: 'NATIVE_DECODER_FAILED',
});

/**
 * Should a native startup failure make the overlay fall back to the web
 * engine? Permission refusals are the one case where it must not: the web
 * engine asks the same OS permission and would only re-prompt or fail the
 * same way, so the user needs the permission message instead.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function shouldFallBackToWeb(err) {
  return err?.code !== NATIVE_ERROR.PERMISSION_DENIED;
}

/**
 * MLKit surfaces "the model is not here" as a `scanError` event while the
 * camera preview is already running, not as a `startScan` rejection. The
 * messages that mean the engine cannot work on this device all point at the
 * Google-side machinery: the dynamically downloaded module, the Dynamite
 * loader, Play services itself.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isFatalScanErrorMessage(message) {
  if (typeof message !== 'string' || !message) return false;
  return /module|dynamite|download|unavailable|not available|play services|gms|failed to init/i.test(message);
}

/**
 * Decides when a run of `scanError` events means "this engine is unusable
 * here" as opposed to one bad frame. A fatal-looking message is enough on
 * its own; otherwise it takes `threshold` consecutive errors before the
 * first successful decode. Once a code has been decoded the engine has
 * proven itself and later errors are ignored.
 *
 * @param {{ threshold?: number }} [opts]
 */
export function createScanErrorGate({ threshold = 3 } = {}) {
  let errors = 0;
  let decoded = false;
  let tripped = false;
  return {
    /** Call on every successful decode. */
    onDecoded() {
      decoded = true;
    },
    /**
     * Call on every `scanError`. Returns true exactly once, when the gate
     * decides the engine is unusable.
     * @param {string} message
     */
    onError(message) {
      if (decoded || tripped) return false;
      errors += 1;
      if (isFatalScanErrorMessage(message) || errors >= threshold) {
        tripped = true;
        return true;
      }
      return false;
    },
    get tripped() {
      return tripped;
    },
  };
}

/**
 * Race a promise against a deadline. Rejects with an Error carrying `code`
 * when the deadline passes first; the original promise keeps running, so
 * callers that own a resource should attach their own cleanup to it.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {{ code?: string, message?: string, setTimeoutFn?: typeof setTimeout, clearTimeoutFn?: typeof clearTimeout }} [opts]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, {
  code = NATIVE_ERROR.START_TIMEOUT,
  message = `Timed out after ${ms}ms`,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeoutFn(() => {
      const err = new Error(message);
      err.code = code;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeoutFn(timer));
}

export const ENGINE_MEMORY_KEY = 'buho.scanner.nativeUnusable';
/** Re-probe native at least this often even without an app update. */
export const ENGINE_MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Remembers "native failed here" so later scans skip straight to the web
 * engine instead of paying the failed attempt (and its timeout) every time.
 *
 * The memory expires on its own: after an app update (the bundled model or
 * the plugin may have changed) and, as a backstop, after `ttlMs`. A native
 * start that succeeds clears it immediately, so a one-off failure such as a
 * camera held by another app costs at most one demoted session — the next
 * probe restores the fast path.
 *
 * @param {{
 *   storage?: Pick<Storage, 'getItem'|'setItem'|'removeItem'> | null,
 *   now?: () => number,
 *   appVersion?: string,
 *   ttlMs?: number,
 * }} [opts]
 */
export function createEngineMemory({
  storage = defaultStorage(),
  now = () => Date.now(),
  appVersion = '',
  ttlMs = ENGINE_MEMORY_TTL_MS,
} = {}) {
  function read() {
    try {
      const raw = storage?.getItem(ENGINE_MEMORY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    /** True while the last remembered native failure is still considered current. */
    isNativeDemoted() {
      const rec = read();
      if (!rec || typeof rec.at !== 'number') return false;
      if (appVersion && rec.version && rec.version !== appVersion) return false;
      if (now() - rec.at > ttlMs) return false;
      return true;
    },

    /** Record why native is unusable on this device. */
    demoteNative(reason = 'unknown') {
      try {
        storage?.setItem(ENGINE_MEMORY_KEY, JSON.stringify({
          at: now(),
          version: appVersion || undefined,
          reason: String(reason),
        }));
      } catch { /* storage unavailable — session-only fallback still applies */ }
    },

    /** Native worked: forget any earlier failure. */
    restoreNative() {
      try { storage?.removeItem(ENGINE_MEMORY_KEY); } catch { /* noop */ }
    },

    /** Diagnostic: the stored record, if any. */
    peek: read,
  };
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

let _memory = null;
/**
 * App-wide engine memory. Keyed by the build version so every update gets a
 * fresh native probe; falls back to the TTL when no version is injected.
 */
export function getEngineMemory() {
  if (!_memory) {
    let appVersion = '';
    try { appVersion = process.env.APP_VERSION || ''; } catch { /* not defined outside the bundler */ }
    _memory = createEngineMemory({ appVersion });
  }
  return _memory;
}
