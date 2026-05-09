/**
 * Biometric authentication utility
 * Wraps @capgo/capacitor-native-biometric for Android/iOS
 * Gracefully degrades on web (always returns unavailable)
 *
 * Supports three authentication methods:
 *   - Fingerprint / Touch ID
 *   - Face ID / Face Authentication
 *   - Device PIN / Pattern / Password (fallback when no biometrics enrolled)
 */
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric'
import { Capacitor } from '@capacitor/core'

/**
 * Check if device authentication is available.
 * Passes useFallback: true so devices with only PIN/pattern (no biometrics)
 * still report as available.
 * @returns {{ available: boolean, biometryType: string, deviceIsSecure: boolean }}
 */
export async function isBiometricAvailable () {
  if (!Capacitor.isNativePlatform()) {
    return { available: false, biometryType: 'none', deviceIsSecure: false }
  }
  try {
    const result = await NativeBiometric.isAvailable({ useFallback: true })
    return {
      available: result.isAvailable === true,
      biometryType: mapBiometryType(result.biometryType),
      deviceIsSecure: result.deviceIsSecure === true
    }
  } catch (err) {
    console.warn('[biometric] availability check failed:', err)
    return { available: false, biometryType: 'none', deviceIsSecure: false }
  }
}

/**
 * Prompt the user to authenticate with biometrics
 * @returns {boolean} true if authenticated, false if cancelled/failed
 */
export async function authenticate ({
  reason = 'Verify your identity',
  title = 'BuhoGO',
  subtitle = '',
  description = '',
  useFallback = true
} = {}) {
  if (!Capacitor.isNativePlatform()) {
    return false
  }
  try {
    await NativeBiometric.verifyIdentity({
      reason,
      title,
      subtitle,
      description,
      useFallback
    })
    return true
  } catch (err) {
    console.warn('[biometric] auth failed:', err)
    return false
  }
}

/**
 * Register a listener for biometry availability changes on app resume.
 */
export function addBiometryChangeListener (callback) {
  return NativeBiometric.addListener('biometryChange', callback)
}

function mapBiometryType (type) {
  switch (type) {
    case BiometryType.TOUCH_ID:
    case BiometryType.FINGERPRINT:
      return 'fingerprint'
    case BiometryType.FACE_ID:
    case BiometryType.FACE_AUTHENTICATION:
      return 'face'
    case BiometryType.IRIS_AUTHENTICATION:
      return 'iris'
    case BiometryType.MULTIPLE:
      return 'multiple'
    case BiometryType.DEVICE_CREDENTIAL:
      return 'device-pin'
    default:
      return 'none'
  }
}
