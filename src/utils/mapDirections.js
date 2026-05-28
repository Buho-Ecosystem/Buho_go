import { Capacitor } from '@capacitor/core'

/**
 * "Get directions" + "Share place" handoffs for the Bitcoin map.
 *
 * We never embed navigation — we hand off to the OS maps app, which is what
 * users expect and what privacy-minded Bitcoiners want (Android's geo: intent
 * surfaces the app chooser, so Organic Maps / OsmAnd users keep their choice).
 *
 * Platform matrix:
 *   - Android native: `geo:lat,lon?q=lat,lon(Label)` via App.openUrl → chooser.
 *   - iOS native:     `https://maps.apple.com/?daddr=lat,lon` via App.openUrl.
 *   - Web / PWA:      Google Maps universal directions link in a new tab.
 *
 * Coordinates are always the destination (names geocode unreliably abroad);
 * the label is only decoration on the pin.
 */

async function openExternal(url) {
  if (Capacitor.isNativePlatform()) {
    try {
      const { App } = await import('@capacitor/app')
      await App.openUrl({ url })
      return
    } catch {
      // Fall through to window.open as a last resort.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Open turn-by-turn directions to a place in the user's maps app.
 * @param {{lat:number, lon:number, label?:string}} dest
 */
export async function openDirections({ lat, lon, label = '' }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  const platform = Capacitor.getPlatform() // 'android' | 'ios' | 'web'
  let url

  if (platform === 'android') {
    const q = label
      ? `${lat},${lon}(${encodeURIComponent(label)})`
      : `${lat},${lon}`
    url = `geo:${lat},${lon}?q=${q}`
  } else if (platform === 'ios') {
    url = `https://maps.apple.com/?daddr=${lat},${lon}`
  } else {
    url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
  }

  await openExternal(url)
}

/**
 * Build a shareable deep link that reopens a specific place on the map.
 * Uses the current web origin so it's a real link on web; on native the boot
 * deep-link handler (phase 6) consumes the same `?place=` param. A production
 * universal-link domain can replace the origin later via MAP_WEB_BASE.
 */
const MAP_WEB_BASE = '' // e.g. 'https://app.buhogo.com' once a public web URL exists

export function buildPlaceShareUrl(id) {
  const base = MAP_WEB_BASE || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/#/map?place=${encodeURIComponent(id)}`
}

/**
 * Share a place. Uses the native share sheet on device, the Web Share API in
 * mobile browsers, and a clipboard copy as the universal fallback.
 *
 * @returns {Promise<'shared'|'copied'|'failed'>}
 */
export async function sharePlace({ id, name, lat, lon }) {
  const url = buildPlaceShareUrl(id)
  const title = name || 'Bitcoin merchant'
  // Include a coordinate link so the share is useful even to someone without
  // BuhoGO: the maps link opens the location anywhere.
  const mapsLink =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
      : ''
  const text = mapsLink ? `${title} accepts Bitcoin · ${mapsLink}` : `${title} accepts Bitcoin`

  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text, url, dialogTitle: title })
      return 'shared'
    } catch {
      /* fall through */
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'failed' // user dismissed
      /* fall through to clipboard */
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch {
      /* fall through */
    }
  }
  return 'failed'
}
