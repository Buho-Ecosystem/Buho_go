/**
 * gRPC-web fetch bypass for Capacitor.
 *
 * `CapacitorHttp.enabled: true` patches `window.fetch` on native so that
 * every request goes through the Android/iOS native HTTP stack. That
 * gives us CORS bypass for the long tail of LNURL / LNbits / fiat-rate
 * endpoints, which is why we keep it on.
 *
 * The patch has one fatal flaw for binary protocols: the native bridge
 * round-trips response bodies as strings (see `dataType: 'text'` in the
 * device logs). For `application/grpc-web+proto` that corrupts every
 * byte ≥ 0x80, so a uint64 varint in the Spark `get_challenge` response
 * parses as a number larger than `Number.MAX_SAFE_INTEGER` and the SDK
 * throws `SparkAuthenticationError`.
 *
 * Capacitor stashes the un-patched fetch at `window.CapacitorWebFetch`
 * (see @capacitor/android `native-bridge.js`). We wrap `window.fetch`
 * once at boot so that anything carrying a gRPC content-type goes
 * through that un-patched fetch — yielding a real binary `Response`
 * the SDK can parse — while every other call still benefits from
 * `CapacitorHttp`'s CORS bypass.
 *
 * Web (Quasar SPA / dev server) hits the else branch and is a no-op.
 */
import { boot } from 'quasar/wrappers'

const GRPC_CONTENT_TYPE_RE = /^application\/grpc(\+|-web)/i

export default boot(() => {
  if (typeof window === 'undefined') return

  const nativeFetch = window.CapacitorWebFetch
  const patchedFetch = window.fetch
  if (typeof nativeFetch !== 'function' || nativeFetch === patchedFetch) return

  window.fetch = function fetchWithGrpcBypass(resource, options) {
    const headers = new Headers(options?.headers || (resource instanceof Request ? resource.headers : undefined))
    const contentType = headers.get('content-type') || ''
    if (GRPC_CONTENT_TYPE_RE.test(contentType)) {
      return nativeFetch.call(this, resource, options)
    }
    return patchedFetch.call(this, resource, options)
  }
})
