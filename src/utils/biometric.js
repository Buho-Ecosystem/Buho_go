/**
 * Device authentication utility for the app lock and sensitive reveals.
 * Gracefully degrades on web (always returns unavailable).
 *
 * Supports three authentication methods, preferred in this order:
 *   - Face recognition / Face ID
 *   - Fingerprint / Touch ID
 *   - Device PIN / Pattern / Password (fallback when no biometrics enrolled)
 *
 * Android goes through the in-repo AppLock plugin: the third-party
 * biometric plugin's Android prompt only accepts class-3 (strong)
 * biometrics and cannot fall back to the device credential, so PIN-only
 * devices and weak-biometric devices (common budget-phone face unlock)
 * would pass the availability probe and then fail every verification.
 * AppLock drives the system sheet with weak-biometric + device-credential
 * authenticators, which natively yields the preference order above.
 *
 * iOS keeps the third-party plugin: its passcode fallback works there.
 */
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric'
import { Capacitor, registerPlugin } from '@capacitor/core'

const AppLock = registerPlugin('AppLock')

function isAndroid () {
  return Capacitor.getPlatform() === 'android'
}

/**
 * Check if device authentication is available.
 * Devices with only PIN/pattern/password (no biometrics) still report
 * as available; biometryType is 'device-pin' in that case.
 * @returns {{ available: boolean, biometryType: string, deviceIsSecure: boolean }}
 */
export async function isBiometricAvailable () {
  if (!Capacitor.isNativePlatform()) {
    return { available: false, biometryType: 'none', deviceIsSecure: false }
  }
  try {
    if (isAndroid()) {
      const result = await AppLock.isAvailable()
      return {
        available: result.available === true,
        biometryType: result.biometryType || 'none',
        deviceIsSecure: result.deviceIsSecure === true
      }
    }
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
 * Prompt the user to authenticate with the strongest available method.
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
    if (isAndroid()) {
      // Device-credential fallback is always on; the system sheet owns
      // retry handling and lockout.
      await AppLock.verify({ title, subtitle, description })
      return true
    }
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
