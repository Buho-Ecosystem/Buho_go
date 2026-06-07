/**
 * Spark-SDK fetch bypass for Capacitor.
 *
 * `CapacitorHttp.enabled: true` patches `window.fetch` on native so that every
 * request goes through the Android/iOS native HTTP stack. That gives us CORS
 * bypass for the long tail of LNURL / LNbits / fiat-rate endpoints, which is
 * why we keep it on. But the native bridge breaks the Spark SDK in two ways:
 *
 *   1. Binary gRPC (the Spark operators): the bridge round-trips response
 *      bodies as strings (`dataType: 'text'`), corrupting every byte ≥ 0x80.
 *      A uint64 varint in the `get_challenge` response then parses as a number
 *      larger than `Number.MAX_SAFE_INTEGER` and the SDK throws.
 *   2. The Lightspark SSP GraphQL API (`api.lightspark.com`): its auth
 *      handshake (`VerifyChallenge`, a JSON POST) fails through the bridge, so
 *      transaction history / transfers can't load even though the balance —
 *      fetched from the operators over gRPC — does. This is the long-standing
 *      "active wallet shows not connected / couldn't load history" bug, and it
 *      only happens on native: the web build talks to these hosts with the
 *      plain browser fetch and works.
 *
 * Capacitor stashes the un-patched fetch at `window.CapacitorWebFetch` (see
 * @capacitor/android `native-bridge.js`). We wrap `window.fetch` once at boot
 * so that ALL Spark-SDK traffic — by gRPC content-type OR by Spark/Lightspark
 * host — goes through that un-patched fetch (a real browser fetch that returns
 * an intact Response and behaves like the working web build). Those hosts serve
 * CORS headers (the gRPC operator calls already rely on this and work), so the
 * un-patched fetch succeeds. Every other request still benefits from
 * `CapacitorHttp`'s CORS bypass.
 *
 * Web (Quasar SPA / dev server) has no `window.CapacitorWebFetch`, so this is a
 * no-op there.
 */
import { boot } from 'quasar/wrappers'

const GRPC_CONTENT_TYPE_RE = /^application\/grpc(\+|-web)/i

// Spark SDK backends that must bypass the native bridge: the Lightspark SSP
// (api.lightspark.com) and the signing operators (*.spark.lightspark.com,
// *.flashnet.xyz, spark-operator.breez.technology). Matched on the registrable
// domain so future operator subdomains are covered automatically.
const SPARK_HOST_RE = /(^|\.)(lightspark\.com|flashnet\.xyz)$/i
const SPARK_EXTRA_HOSTS = new Set(['spark-operator.breez.technology'])

function requestHostname(resource) {
  try {
    const url =
      typeof resource === 'string' ? resource
      : resource instanceof Request ? resource.url
      : resource instanceof URL ? resource.href
      : ''
    if (!url) return ''
    return new URL(url, window.location.href).hostname
  } catch {
    return ''
  }
}

export default boot(() => {
  if (typeof window === 'undefined') return

  const nativeFetch = window.CapacitorWebFetch
  const patchedFetch = window.fetch
  if (typeof nativeFetch !== 'function' || nativeFetch === patchedFetch) return

  window.fetch = function sparkAwareFetch(resource, options) {
    // gRPC by content-type — binary the native bridge would corrupt.
    const headers = new Headers(options?.headers || (resource instanceof Request ? resource.headers : undefined))
    const contentType = headers.get('content-type') || ''
    if (GRPC_CONTENT_TYPE_RE.test(contentType)) {
      return nativeFetch.call(this, resource, options)
    }

    // All Spark / Lightspark hosts (SSP GraphQL auth + operators). The bridge
    // breaks the SSP auth handshake; route these like the web build does.
    const host = requestHostname(resource)
    if (host && (SPARK_HOST_RE.test(host) || SPARK_EXTRA_HOSTS.has(host))) {
      return nativeFetch.call(this, resource, options)
    }

    // Everything else keeps CapacitorHttp's CORS bypass (LNURL / LNbits / fiat).
    return patchedFetch.call(this, resource, options)
  }
})
