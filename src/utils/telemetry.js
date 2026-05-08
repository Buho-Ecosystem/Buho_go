/**
 * Lightweight, pluggable telemetry surface.
 *
 * Design goals:
 *   - Zero external dependencies. Doesn't ship an analytics SDK on its own;
 *     a real provider (PostHog, Mixpanel, internal endpoint, etc.) gets
 *     wired in via `subscribe()` later.
 *   - Safe to call from anywhere — never throws, never blocks, never
 *     surfaces a network error to the caller.
 *   - In-memory ring buffer so devs can inspect recent events from the
 *     console (`window.__buhoTelemetry?.()`) without a backend.
 *   - Works exactly the same in tests: subscribe, assert events, done.
 *
 * Event-naming convention: `domain.subject.action`, all lower_snake.
 * Properties are flat scalars — no nested objects, no PII. Amounts are
 * sats (numbers), durations are milliseconds, ratios are 0..1 floats.
 */

const RING_BUFFER_MAX = 200

const subscribers = new Set()
const recentEvents = []

let isDebug = false
try {
  // Vite/Quasar set this; fall back gracefully outside that runtime.
  isDebug = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
} catch {
  isDebug = false
}

/**
 * Emit a telemetry event. Never throws.
 *
 * @param {string} name - Event name in `domain.subject.action` form
 * @param {Object} [properties] - Flat scalar properties
 */
export function track(name, properties = {}) {
  if (typeof name !== 'string' || !name) return

  const event = {
    name,
    properties: { ...properties },
    timestamp: Date.now()
  }

  // Push to ring buffer (drop oldest first when full).
  recentEvents.push(event)
  if (recentEvents.length > RING_BUFFER_MAX) {
    recentEvents.shift()
  }

  // Fan out to subscribers; one bad subscriber must not break the rest
  // and must not leak back to the caller.
  for (const handler of subscribers) {
    try {
      handler(event)
    } catch (error) {
      console.warn('Telemetry subscriber threw, ignoring:', error?.message || error)
    }
  }

  if (isDebug) {
    console.debug('[telemetry]', name, properties)
  }
}

/**
 * Register a handler invoked for every subsequent event. Returns an
 * unsubscribe function. Adapter implementations (PostHog/Mixpanel/etc.)
 * subscribe once at app boot and translate events to their wire format.
 *
 * @param {Function} handler - (event: { name, properties, timestamp }) => void
 * @returns {Function} Unsubscribe
 */
export function subscribe(handler) {
  if (typeof handler !== 'function') return () => {}
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

/**
 * Return a shallow copy of the recent-events ring buffer. Intended for
 * dev consoles and incident triage — not for production logic.
 */
export function getRecentEvents() {
  return recentEvents.slice()
}

// Expose on `window` in dev so a developer can grab the buffer from
// the DevTools console without importing anything. Guarded so it
// stays out of production globals.
if (typeof window !== 'undefined' && isDebug) {
  window.__buhoTelemetry = getRecentEvents
}
