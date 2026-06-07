import { Capacitor } from '@capacitor/core'

/**
 * Geolocation wrapper for the Bitcoin map.
 *
 * One API over two very different runtimes:
 *   - Capacitor native (Android): @capacitor/geolocation, which owns the
 *     runtime permission prompt and talks to the OS location service.
 *   - Web / PWA: the browser's navigator.geolocation (permission handled by
 *     the browser; requires a secure context).
 *
 * Everything resolves to the same shape `{ lat, lon, accuracy }` or rejects
 * with an Error whose `.code` is one of GEO_ERROR so the UI can branch
 * (permission-denied → "Enable location" CTA; unavailable → default center).
 */

export const GEO_ERROR = {
  UNSUPPORTED: 'unsupported',     // no geolocation API on this platform
  PERMISSION_DENIED: 'denied',    // user said no
  POSITION_UNAVAILABLE: 'unavailable', // hardware/OS couldn't get a fix
  TIMEOUT: 'timeout',
}

function geoError(code, message) {
  const e = new Error(message || code)
  e.code = code
  return e
}

const DEFAULT_OPTS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }

/**
 * Lazily import the Capacitor plugin only on native, so the web bundle never
 * pulls it in. Returns the Geolocation plugin or null.
 */
async function nativePlugin() {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const mod = await import('@capacitor/geolocation')
    return mod.Geolocation
  } catch {
    return null
  }
}

/**
 * Check current permission state without prompting. Returns one of
 * 'granted' | 'denied' | 'prompt' | 'unsupported'. Lets the UI decide whether
 * to show a soft pre-prompt before triggering the OS dialog.
 */
export async function checkLocationPermission() {
  const plugin = await nativePlugin()
  if (plugin) {
    try {
      const status = await plugin.checkPermissions()
      return status.location || status.coarseLocation || 'prompt'
    } catch {
      return 'unsupported'
    }
  }
  // Web: the Permissions API is best-effort and not everywhere.
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const res = await navigator.permissions.query({ name: 'geolocation' })
      return res.state // 'granted' | 'denied' | 'prompt'
    } catch {
      /* fall through */
    }
  }
  return typeof navigator !== 'undefined' && navigator.geolocation ? 'prompt' : 'unsupported'
}

/**
 * Resolve the user's current position. Triggers the permission prompt on
 * first call (native + web both prompt as a side effect of requesting).
 *
 * @returns {Promise<{lat:number, lon:number, accuracy:number|null}>}
 */
export async function getCurrentPosition(opts = {}) {
  const options = { ...DEFAULT_OPTS, ...opts }
  const plugin = await nativePlugin()

  if (plugin) {
    // Native: explicitly request first so the prompt fires predictably.
    try {
      const perm = await plugin.requestPermissions()
      const state = perm.location || perm.coarseLocation
      if (state === 'denied') throw geoError(GEO_ERROR.PERMISSION_DENIED)
    } catch (e) {
      if (e.code === GEO_ERROR.PERMISSION_DENIED) throw e
      // requestPermissions can throw on some OEMs even when usable; fall
      // through to getCurrentPosition and let that surface the real error.
    }
    try {
      const pos = await plugin.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      })
      return {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      }
    } catch (e) {
      throw mapNativeError(e)
    }
  }

  // Web path.
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw geoError(GEO_ERROR.UNSUPPORTED)
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      (err) => reject(mapWebError(err)),
      options,
    )
  })
}

function mapWebError(err) {
  // GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  switch (err?.code) {
    case 1:
      return geoError(GEO_ERROR.PERMISSION_DENIED, err.message)
    case 2:
      return geoError(GEO_ERROR.POSITION_UNAVAILABLE, err.message)
    case 3:
      return geoError(GEO_ERROR.TIMEOUT, err.message)
    default:
      return geoError(GEO_ERROR.POSITION_UNAVAILABLE, err?.message)
  }
}

function mapNativeError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  if (msg.includes('denied') || msg.includes('permission')) {
    return geoError(GEO_ERROR.PERMISSION_DENIED, err?.message)
  }
  if (msg.includes('timeout')) return geoError(GEO_ERROR.TIMEOUT, err?.message)
  return geoError(GEO_ERROR.POSITION_UNAVAILABLE, err?.message)
}
