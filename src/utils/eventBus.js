/**
 * Minimal event bus for cross-component communication.
 * Used for deep link events that need to reach Wallet.vue from a boot file.
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
