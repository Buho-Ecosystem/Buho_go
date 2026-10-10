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
 *
 * The contact chat reuses all of this (docs/CONTACT_CHAT.md, section 9). It
 * adds a second Android channel (`messages`), an optional stable id so a newer
 * message from the same chat replaces the older notification, an optional
 * group key, and an in-app route stored in the notification so a tap can open
 * the right screen (`onNotificationTap`). The same rules hold: silent while
 * the app is on screen unless forced, no strings owned here, nothing thrown.
 */

import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Android notification channels — each created once, on first use. `payments`
 * is the original and stays exactly as it was. `messages` carries the contact
 * chat. Both are heads-up (importance 4: worth a glance) and private on the
 * lock screen (visibility 0: it shows the channel, not the content). A
 * channel's display name is a string, so the caller passes it in translated.
 */
const CHANNEL_PAYMENTS = { id: 'payments', importance: 4, visibility: 0 }
const CHANNEL_MESSAGES = { id: 'messages', importance: 4, visibility: 0 }

/**
 * Notification ids are 32-bit ints (Android: -2,147,483,648 … 2,147,483,647).
 * These ranges are in use; keep them apart when adding another:
 *
 *   41,000 – 41,999                  payments: a rolling window, one new id per
 *                                    post (ID_BASE, ID_WINDOW)
 *   74,000 – 173,999                 emergency-exit unlock reminders
 *                                    (services/exitNotifications.js)
 *   1,000,000,000 – 1,999,999,999    stable ids (stableNotificationId): the same
 *                                    key always maps to the same id, so a newer
 *                                    notification replaces the older one
 *                                    (STABLE_ID_BASE, STABLE_ID_WINDOW)
 */
const ID_BASE = 41000
const ID_WINDOW = 1000
const STABLE_ID_BASE = 1_000_000_000
const STABLE_ID_WINDOW = 1_000_000_000
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

let _pluginPromise = null
/** channel id -> creation in flight or done; dropped again if it failed. */
const _channelJobs = new Map()
let _nextId = 0

function loadPluginModule() {
  if (!isSupported()) return Promise.resolve(null)
  if (!_pluginPromise) {
    // Keep the module as the resolved value. Capacitor's plugin proxy
    // exposes a synthetic `then` method and cannot itself resolve a promise.
    _pluginPromise = import('@capacitor/local-notifications')
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
  const plugin = (await loadPluginModule())?.LocalNotifications
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
  const plugin = (await loadPluginModule())?.LocalNotifications
  if (!plugin) return 'unsupported'
  try {
    const { display } = await plugin.requestPermissions()
    return display === 'granted' ? 'granted' : 'denied'
  } catch (err) {
    console.warn('[notifications] permission request failed:', err?.message || err)
    return 'denied'
  }
}

/**
 * Android needs a channel before anything can be posted to it. One creation
 * per channel id: a post that arrives while the first one is still in flight
 * waits for it instead of creating the channel a second time. Never rejects.
 */
function ensureChannel(plugin, channel, name) {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve()
  if (!_channelJobs.has(channel.id)) {
    const job = Promise.resolve()
      .then(() => plugin.createChannel({
        id: channel.id,
        name,
        importance: channel.importance,
        visibility: channel.visibility,
      }))
      .catch((err) => {
        // A failed channel is not fatal on every OEM build; try posting
        // anyway, and try the channel again on the next post.
        _channelJobs.delete(channel.id)
        console.warn('[notifications] channel setup failed:', err?.message || err)
      })
    _channelJobs.set(channel.id, job)
  }
  return _channelJobs.get(channel.id)
}

/**
 * A stable notification id for `key` — e.g. `chat:<pubkey>` — so that posting
 * again for the same key replaces the notification still in the shade instead
 * of stacking a second one. Deterministic across restarts and platforms (a
 * 32-bit FNV-1a hash of the key, folded into the reserved window documented
 * at the top: 1,000,000,000 – 1,999,999,999). Two different keys can in theory
 * share an id (1 in a billion per pair); the cost would be one notification
 * replacing another, nothing worse.
 *
 * @param {string} key
 * @returns {number} an integer in [1_000_000_000, 1_999_999_999]
 */
export function stableNotificationId(key) {
  const text = String(key)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return STABLE_ID_BASE + ((hash >>> 0) % STABLE_ID_WINDOW)
}

/**
 * Is this a path inside the app — something safe to hand to the router?
 * A leading `/` and nothing that could turn it into another origin: not `//…`
 * (protocol-relative), not `/\…` (browsers read the backslash as a slash), and
 * no control characters (URL parsing drops tabs and newlines, so `/<tab>/host`
 * would become `//host`). Anything that is not a string is rejected.
 *
 * A route that comes back out of a notification is data, not a destination
 * the app trusts: check it with this before following it.
 *
 * @param {unknown} route
 * @returns {boolean}
 */
export function isInternalRoute(route) {
  if (typeof route !== 'string' || route[0] !== '/') return false
  if (route[1] === '/' || route[1] === '\\') return false
  for (let i = 0; i < route.length; i++) {
    const code = route.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
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
 * Post a notification — but only when the app is in the background.
 *
 * Payments call it with `{ title, body, force }` and get the `payments`
 * channel and a rolling id, exactly as before. The remaining options are for
 * the contact chat and are all optional; a value of the wrong type is ignored
 * rather than failing the post.
 *
 * @param {object} message
 *   Copy is passed in already translated; this module owns no strings.
 * @param {string} message.title
 * @param {string} [message.body]
 * @param {boolean} [message.force=false]
 *   Skip the background check (the Settings test tap, and a payment that
 *   settled while the app was hidden and is only announced once it is back).
 * @param {'payments'|'messages'} [message.channel='payments']
 *   Android channel. Anything but `'messages'` means `payments`.
 * @param {string} [message.channelName]
 *   Display name of the channel, translated, used when the channel is first
 *   created. Without it `payments` is named after the title (as it always
 *   was) and `messages` after its id — never after a contact.
 * @param {number} [message.id]
 *   A 32-bit integer, normally from `stableNotificationId`. A newer
 *   notification with the same id replaces the older one instead of stacking.
 *   Without it each post takes the next id of the rolling payments window.
 * @param {string} [message.group]
 *   Android group key, e.g. `chat:<pubkey>`. No summary notification is posted
 *   (yet), so one entry per chat comes from the stable `id`, not from the group.
 * @param {string} [message.route]
 *   In-app path to open on a tap, e.g. `/address-book/<id>/chat`. Stored as
 *   `extra.route` and handed back by `onNotificationTap`.
 * @returns {Promise<boolean>} whether a notification was actually posted
 */
export async function notify({ title, body, force = false, channel, channelName, id, group, route } = {}) {
  const plugin = (await loadPluginModule())?.LocalNotifications
  if (!plugin || !title) return false
  if (!force && !(await isInBackground())) return false

  const target = channel === CHANNEL_MESSAGES.id ? CHANNEL_MESSAGES : CHANNEL_PAYMENTS
  const fallbackName = target === CHANNEL_PAYMENTS ? title : target.id
  await ensureChannel(plugin, target, typeof channelName === 'string' && channelName ? channelName : fallbackName)

  let notificationId = id
  if (!Number.isInteger(notificationId) || notificationId < INT32_MIN || notificationId > INT32_MAX) {
    _nextId = (_nextId + 1) % ID_WINDOW
    notificationId = ID_BASE + _nextId
  }
  const notification = {
    id: notificationId,
    title,
    body: body || '',
    channelId: target.id,
    // No schedule block: post it now.
    // A monochrome status-bar mark (res/drawable/ic_stat_notification);
    // Android tints it, so it must be white on transparent.
    smallIcon: 'ic_stat_notification',
  }
  if (typeof group === 'string' && group) notification.group = group
  if (typeof route === 'string' && route) notification.extra = { route }

  try {
    await plugin.schedule({ notifications: [notification] })
    return true
  } catch (err) {
    console.warn('[notifications] could not post:', err?.message || err)
    return false
  }
}

/** Tell one tap listener about a tap. Never throws, whatever the handler does. */
function deliverTap(handler, event) {
  try {
    // Only a tap on the notification itself. No action buttons are registered
    // and no platform reports a dismissal of these notifications today; this
    // keeps a future one from opening a screen.
    if (event?.actionId === 'dismiss') return
    const stored = event?.notification?.extra
    const extra = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
    const result = handler({
      route: typeof extra.route === 'string' ? extra.route : null,
      extra,
    })
    // An async handler that rejects must not become an unhandled rejection.
    if (result && typeof result.catch === 'function') {
      result.catch((err) => console.warn('[notifications] tap handler failed:', err?.message || err))
    }
  } catch (err) {
    console.warn('[notifications] tap handler failed:', err?.message || err)
  }
}

/**
 * Be told when the user taps a notification this module posted.
 *
 * `handler({ route, extra })` runs for each tap. `extra` is the notification's
 * extra data (always an object, `{}` when it had none — payment notifications
 * carry none) and `route` is `extra.route` when that is a string, else `null`.
 * The route is untrusted data: follow it only after `isInternalRoute(route)`.
 *
 * The plugin listener is attached lazily, and only where notifications exist
 * at all. Register early (App.vue does, on mount): on Android and iOS the
 * plugin holds a tap that arrives before any listener exists and hands it to
 * the first one, while on the web — where the plugin turns a click on a
 * notification into the same event — nothing is held, so a listener that comes
 * late misses the clicks before it.
 *
 * @param {(tap: { route: string|null, extra: object }) => unknown} handler
 * @returns {() => void} unsubscribe; safe to call more than once, and safe to
 *   call before the listener has finished registering
 */
export function onNotificationTap(handler) {
  if (typeof handler !== 'function') return () => {}

  let active = true
  let handle = null

  const release = (listener) => {
    try {
      Promise.resolve(listener?.remove?.()).catch(() => {})
    } catch {
      // Nothing left to release.
    }
  }

  loadPluginModule()
    .then(async (pluginModule) => {
      const plugin = pluginModule?.LocalNotifications
      if (!plugin || !active) return
      const registered = await plugin.addListener('localNotificationActionPerformed', (event) => {
        if (active) deliverTap(handler, event)
      })
      if (active) handle = registered
      else release(registered) // unsubscribed while registering
    })
    .catch((err) => console.warn('[notifications] tap listener unavailable:', err?.message || err))

  return () => {
    active = false
    release(handle)
    handle = null
  }
}
