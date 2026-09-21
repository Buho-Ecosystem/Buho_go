/**
 * Local notifications for money that arrives while BuhoGO is out of sight.
 *
 * Scope, stated honestly because the UI promises exactly this and no more:
 * these fire for payment events the RUNNING app sees while it sits in the
 * background. Android keeps the process around for a while, iOS suspends it
 * within seconds — so this covers minutes, not hours, and nothing at all once
 * the app is closed. Real push (a server that knows a payment is coming) is a
 * separate transport and a separate product decision.
 *
 * This works in the browser too, not only in the app: the plugin ships a real
 * web implementation over the Notification API, and `App.getState()` reports
 * `document.hidden`, so "posted only while out of sight" means the same thing
 * for a backgrounded PWA or an unfocused tab. Only Android channels are
 * native-only, and creating one is skipped elsewhere.
 *
 * The plugin is loaded lazily and defensively, the same way the native scanner
 * is: a missing plugin, an unsupported browser, or a blocked permission all
 * degrade to "no notifications" rather than breaking whatever called us.
 * Nothing here ever throws at a caller — a notification is never worth failing
 * a payment path over.
 */

import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/** Android notification channel — created once, on first use. */
const CHANNEL_ID = 'payments'
/** Notification ids must be 32-bit ints; roll through a small window. */
const ID_BASE = 41000
const ID_WINDOW = 1000

let _pluginPromise = null
let _channelReady = false
let _nextId = 0

function loadPlugin() {
  if (!isSupported()) return Promise.resolve(null)
  if (!_pluginPromise) {
    _pluginPromise = import('@capacitor/local-notifications')
      .then((mod) => mod.LocalNotifications || null)
      .catch((err) => {
        console.warn('[notifications] plugin unavailable:', err?.message || err)
        return null
      })
  }
  return _pluginPromise
}

/**
 * Is there anything here that can show a notification? The app always can; a
 * browser can when it implements the Notification API (every current one does,
 * except in some embedded webviews and insecure contexts).
 */
export function isSupported() {
  if (Capacitor.isNativePlatform()) return true
  return typeof window !== 'undefined'
    && 'Notification' in window
    && typeof window.Notification?.requestPermission === 'function'
}

/**
 * Specifically the installed app. Only the setup wizard asks this: its slide
 * is native-only by product decision, while the Settings row is the way in
 * everywhere (see the notifications store's `canAskInSetup`).
 */
export function isNativeApp() {
  return Capacitor.isNativePlatform()
}

/**
 * What the OS currently thinks, normalized:
 *   'granted' | 'denied' | 'prompt' | 'unsupported'
 * 'prompt' means the system dialog has not been answered yet.
 */
export async function permissionState() {
  const plugin = await loadPlugin()
  if (!plugin) return 'unsupported'
  try {
    const { display } = await plugin.checkPermissions()
    if (display === 'granted') return 'granted'
    if (display === 'denied') return 'denied'
    return 'prompt'
  } catch (err) {
    console.warn('[notifications] permission check failed:', err?.message || err)
    return 'unsupported'
  }
}

/**
 * Raise the system dialog. Only ever called from an explicit tap — our own
 * explanation comes first, the OS dialog second, and the answer is final
 * (Android only asks once; after a denial the user has to go to Settings).
 */
export async function requestPermission() {
  const plugin = await loadPlugin()
  if (!plugin) return 'unsupported'
  try {
    const { display } = await plugin.requestPermissions()
    return display === 'granted' ? 'granted' : 'denied'
  } catch (err) {
    console.warn('[notifications] permission request failed:', err?.message || err)
    return 'denied'
  }
}

/** Android needs a channel before anything can be posted to it. */
async function ensureChannel(plugin, title) {
  if (_channelReady || Capacitor.getPlatform() !== 'android') return
  try {
    await plugin.createChannel({
      id: CHANNEL_ID,
      name: title,
      importance: 4, // heads-up: money arriving is worth a glance
      visibility: 0, // lock screen shows the channel, not the amount
    })
    _channelReady = true
  } catch (err) {
    // A failed channel is not fatal on every OEM build; try posting anyway.
    console.warn('[notifications] channel setup failed:', err?.message || err)
  }
}

/**
 * Is the app out of sight right now?
 *
 * The whole point of this module: while the user is looking at BuhoGO, the
 * screen already tells them the money arrived, and a notification on top of
 * that is noise. On the web the plugin answers this from `document.hidden`,
 * which is the same question asked of a tab.
 */
export async function isInBackground() {
  try {
    const { isActive } = await App.getState()
    return isActive === false
  } catch {
    // Unknown state: assume the user can see the app and stay quiet.
    return false
  }
}

/**
 * Post "money arrived" — but only when the app is in the background.
 *
 * @param {{ title: string, body: string, force?: boolean }} message
 *   Copy is passed in already translated; this module owns no strings.
 *   `force` skips the background check (used by the Settings test tap).
 * @returns {Promise<boolean>} whether a notification was actually posted
 */
export async function notify({ title, body, force = false }) {
  const plugin = await loadPlugin()
  if (!plugin || !title) return false
  if (!force && !(await isInBackground())) return false

  await ensureChannel(plugin, title)
  _nextId = (_nextId + 1) % ID_WINDOW
  try {
    await plugin.schedule({
      notifications: [{
        id: ID_BASE + _nextId,
        title,
        body: body || '',
        channelId: CHANNEL_ID,
        // No schedule block: post it now.
        smallIcon: 'ic_stat_icon_config_sample',
      }],
    })
    return true
  } catch (err) {
    console.warn('[notifications] could not post:', err?.message || err)
    return false
  }
}
