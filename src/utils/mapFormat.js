// Locale-aware formatting helpers for the Bitcoin map: distance and freshness.
// Kept framework-free (pure functions taking an explicit locale) so they're
// trivially unit-testable and reusable across the list row and detail sheet.

// Locales that conventionally use miles. Everything else gets metric.
const IMPERIAL_LOCALES = /^(en-US|en-GB|my)\b/i

// Resolve whether to render miles. An explicit user unit ('mi' | 'km') wins;
// 'auto' (or anything else) defers to the locale convention.
function usesImperial(locale, unit) {
  if (unit === 'mi') return true
  if (unit === 'km') return false
  return IMPERIAL_LOCALES.test(locale || '')
}

/**
 * Human distance string from metres, localized.
 *
 * Metric: "<100 m" / "340 m" / "1.2 km" / "14 km"
 * Imperial: "150 ft" / "0.4 mi" / "12 mi"
 * Decimal separator follows the locale (de/es use a comma).
 *
 * @param {number|null} meters
 * @param {string} locale e.g. 'de', 'en-US'
 * @param {string} [unit] 'auto' (default, locale-based) | 'km' | 'mi'
 * @returns {string} '' when meters is not finite
 */
export function formatDistance(meters, locale = 'en-US', unit = 'auto') {
  if (!Number.isFinite(meters)) return ''
  const nf = (digits) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })

  if (usesImperial(locale, unit)) {
    const miles = meters / 1609.344
    if (miles < 0.1) {
      const feet = Math.round((meters / 0.3048) / 10) * 10
      return `${nf(0).format(feet)} ft`
    }
    if (miles < 10) return `${nf(1).format(miles)} mi`
    return `${nf(0).format(Math.round(miles))} mi`
  }

  // Metric
  if (meters < 100) return `<100 m`
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10
    return `${nf(0).format(rounded)} m`
  }
  const km = meters / 1000
  if (km < 10) return `${nf(1).format(km)} km`
  return `${nf(0).format(Math.round(km))} km`
}

const MS = { day: 86400000 }
const SIX_MONTHS = 182 * MS.day
const TWELVE_MONTHS = 365 * MS.day

/**
 * Freshness tier + localized relative label for a verification date.
 *
 * Tiers: 'fresh' (<6mo), 'aging' (6–12mo), 'stale' (>12mo), 'unknown' (no/bad
 * date). Mirrors BTC Map's ~1-year freshness convention; freshness is the #1
 * trust signal for a Bitcoin map, so this drives a visible chip.
 *
 * @param {string|null} verifiedAt ISO-ish date string
 * @param {string} locale
 * @returns {{ tier: string, relative: string }} relative is '' when unknown
 */
export function freshness(verifiedAt, locale = 'en-US') {
  if (!verifiedAt) return { tier: 'unknown', relative: '' }
  const t = Date.parse(verifiedAt)
  if (!Number.isFinite(t)) return { tier: 'unknown', relative: '' }

  const ageMs = Date.now() - t
  let tier = 'fresh'
  if (ageMs > TWELVE_MONTHS) tier = 'stale'
  else if (ageMs > SIX_MONTHS) tier = 'aging'

  return { tier, relative: relativeTime(t, locale) }
}

// Coarse, human relative time via Intl.RelativeTimeFormat (handles en/de/es).
// Picks the largest sensible unit so we say "3 months ago", not "92 days ago".
function relativeTime(timestampMs, locale) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const deltaSec = Math.round((timestampMs - Date.now()) / 1000) // negative = past
  const abs = Math.abs(deltaSec)
  const table = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, secs] of table) {
    if (abs >= secs) return rtf.format(Math.round(deltaSec / secs), unit)
  }
  return rtf.format(0, 'day') // "today"
}
