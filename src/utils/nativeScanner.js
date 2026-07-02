/**
 * Native scanner availability gate.
 *
 * NOTE (restored): the original `nativeScanner.js` from the "Native Scanner
 * Added" work (PR #186) is imported across the app but was never actually
 * committed to the repository, so a fresh checkout fails to build. This restores
 * the module from its usage contract and the project's own platform-detection
 * convention (see secureScreen.js / biometric.js). If the original differs,
 * replace this file with that version.
 *
 * The native MLKit scanner (@capacitor-mlkit/barcode-scanning) renders a live
 * camera feed behind a transparent webview and only works on a native Capacitor
 * platform. On the web we fall back to the qr-scanner video path, so callers use
 * this gate to decide which scanner UI to mount.
 */
import { Capacitor } from '@capacitor/core'

/**
 * True when the native MLKit barcode scanner can be used (iOS / Android),
 * false on the web where the qr-scanner fallback is used instead.
 * @returns {boolean}
 */
export function isNativeScannerAvailable() {
  return Capacitor.isNativePlatform()
}
