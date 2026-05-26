import { registerPlugin, Capacitor } from '@capacitor/core'

/**
 * Screen-privacy utility — wraps the custom SecureScreenPlugin Capacitor
 * bridge. Toggles Android's FLAG_SECURE on the activity window to block
 * screenshots, screen recordings, and the app-switcher thumbnail.
 *
 * Source of truth:
 *
 *   The native plugin owns the persisted preference (its own
 *   SharedPreferences file, read by MainActivity on cold start before
 *   the WebView loads). This module is the typed JS facade over that
 *   plugin — it does not write to localStorage directly. The Pinia
 *   wallet store mirrors the value for reactive UI, but the canonical
 *   read/write path is through here.
 *
 * Platform behaviour:
 *
 *   - Native (Capacitor Android): full FLAG_SECURE control.
 *   - Web / PWA: every method is a no-op that echoes the requested
 *     state back. The toggle is hidden from the Settings UI on web
 *     anyway, so this is just defence-in-depth against accidental
 *     calls from shared code paths.
 *
 * Failure semantics:
 *
 *   Calls reject on a true native exception. Catching at this layer
 *   would mask bugs from the Pinia store; we let errors propagate.
 *   Callers in the boot file wrap their calls in try/catch and
 *   fail-secure on rejection (state stays at last successful value).
 */

// Plugin name must match @CapacitorPlugin(name = "SecureScreen") in Java.
const SecureScreenPlugin = registerPlugin('SecureScreen')

/**
 * Persist the user's preference and apply FLAG_SECURE accordingly.
 * Use this for the Settings toggle — the value sticks across restarts
 * and is read by MainActivity on the next cold start.
 *
 * @param {boolean} enabled
 * @returns {Promise<{enabled: boolean}>}
 */
export async function setScreenPrivacyEnabled (enabled) {
  if (!Capacitor.isNativePlatform()) {
    return { enabled: Boolean(enabled) }
  }
  return SecureScreenPlugin.setEnabled({ enabled: Boolean(enabled) })
}

/**
 * Apply FLAG_SECURE WITHOUT touching the persisted preference. Reserved
 * for the router-meta forceSecure override on sensitive routes —
 * visiting the route temporarily enables secure mode regardless of the
 * user's toggle, and leaving the route restores the user's actual
 * preference without ever mutating it.
 *
 * Currently unused at call sites; the infrastructure is in place so
 * sensitive surfaces can opt in later with one line of router meta.
 *
 * @param {boolean} enabled
 * @returns {Promise<{enabled: boolean}>}
 */
export async function applyScreenPrivacyTransient (enabled) {
  if (!Capacitor.isNativePlatform()) {
    return { enabled: Boolean(enabled) }
  }
  return SecureScreenPlugin.applyTransient({ enabled: Boolean(enabled) })
}

/**
 * Read the persisted preference. On native this returns whatever
 * MainActivity already applied on cold start; on web it returns true
 * (default) so the UI doesn't render a misleading "off" state during
 * a desktop preview.
 *
 * @returns {Promise<boolean>}
 */
export async function isScreenPrivacyEnabled () {
  if (!Capacitor.isNativePlatform()) {
    return true
  }
  const result = await SecureScreenPlugin.isEnabled()
  return Boolean(result?.enabled)
}

/**
 * True when the platform can actually enforce screen-capture blocking.
 * Settings.vue uses this to hide the toggle on web/PWA where the
 * underlying primitive doesn't exist.
 *
 * @returns {boolean}
 */
export function isScreenPrivacySupported () {
  return Capacitor.isNativePlatform()
}
