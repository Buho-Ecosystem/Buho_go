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
 *
 *   'payment:sent' Wallet.vue, after a payment was sent: `status` 'completed',
 *                  or 'pending' while it is still routing (it may still fail).
 *                  Payload: { contactId, destination, amountSats, preimage,
 *                  sendingWalletId, note, context, status, paymentHash }. `context` is the
 *                  opaque string the caller attached when it handed the payment
 *                  over (usePayContact `context` option), or null. The contact
 *                  chat's always-on announcer reads it (services/dm/
 *                  paymentAnnouncer.js); every other flow can ignore the event.
 *                  Listeners must not throw and must not log the payload: it
 *                  carries the destination and the preimage.
 */
/** The 'payment:sent' event above, by name, for the emitter and its listeners. */
export const PAYMENT_SENT = 'payment:sent'

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
    // One listener failing must not keep the event from the others.
    for (const cb of [...listeners[event]]) {
      try {
        cb(data)
      } catch (error) {
        console.warn(`[EventBus] a '${event}' listener failed:`, error?.name || 'Error')
      }
    }
  }
}
