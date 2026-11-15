/**
 * Cookies inside the shop's frame, on Android.
 *
 * Bitrefill's widget keeps its checkout session in a cookie. It runs in a
 * frame, so to the app's WebView that is a third-party cookie, which Android
 * WebViews refuse by default. The app keeps that default everywhere and
 * lifts it only while the shop is open: the shop page turns it on when it
 * mounts and off when it leaves, so no other remote content the app shows
 * (avatars, logos, map tiles) can ever set or read one.
 *
 * Web and iOS have no such switch: the browser or the system decides there,
 * and this is a no-op (see docs/BITREFILL.md, "Cookies").
 */
import { registerPlugin, Capacitor } from '@capacitor/core'

// Plugin name must match @CapacitorPlugin(name = "FrameCookies") in Java.
const FrameCookies = registerPlugin('FrameCookies')

/**
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true when the WebView took the setting
 */
export async function setFrameCookies(enabled) {
  if (Capacitor.getPlatform() !== 'android') return false
  try {
    await FrameCookies.setEnabled({ enabled: Boolean(enabled) })
    return true
  } catch {
    // An app shell without the plugin: the shop still opens, as on the web.
    return false
  }
}
