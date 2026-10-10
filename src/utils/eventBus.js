/**
 * Minimal event bus for cross-component communication.
 * Used for deep link events that need to reach Wallet.vue from a boot file.
 *
 * Events in use:
 *
 *   'app:locked'   No payload. App.vue emits it every time the biometric lock
 *                  engages (its `locked` ref turns true), including when the
 *                  app goes to the background with the lock on. Whatever holds
 *                  a secret only in memory drops it on this event; the contact
 *                  chat wipes its cached identity key (docs/CONTACT_CHAT.md,
 *                  section 5).
 *   'app:unlocked' No payload. The lock released (`locked` turned false).
 *                  The contact chat picks up what waited for its key.
 *
 *                  Both report a change, not a state: they are not repeated
 *                  while the app stays locked, and a lock that was already on
 *                  at launch is not announced. The current state is
 *                  `isAppLocked()` in utils/appLock.js, which App.vue updates
 *                  just before it emits.
 */
const listeners = {}

export const EventBus = {
  on(event, callback) {
    if (!listeners[event]) listeners[event] = []
    listeners[event].push(callback)
  },

  off(event, callback) {
    if (!listeners[event]) return
    listeners[event] = listeners[event].filter(cb => cb !== callback)
  },

  emit(event, data) {
    if (!listeners[event]) return
    listeners[event].forEach(cb => cb(data))
  }
}
