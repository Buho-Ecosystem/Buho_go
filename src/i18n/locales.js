/**
 * Central registry for supported UI locales.
 *
 * Any surface that exposes a language picker (Welcome onboarding, Settings,
 * future surfaces) imports from here so we never drift between locations.
 *
 * Adding a locale: drop a sibling folder under `src/i18n/<code>/` with an
 * `index.js` that exports the same keys, register it in `src/i18n/index.js`,
 * then add the entry to `SUPPORTED_LOCALES`. No other call sites change.
 */

export const LOCALE_STORAGE_KEY = 'buhoGO_language'

export const DEFAULT_LOCALE = 'en-US'

export const SUPPORTED_LOCALES = Object.freeze([
  { value: 'en-US', label: 'English' },
  { value: 'de',    label: 'Deutsch' },
  { value: 'es',    label: 'Español' },
])

function isSupported(code) {
  return SUPPORTED_LOCALES.some(l => l.value === code)
}

/**
 * Returns a persisted locale code, or null when nothing valid is stored.
 * Safe to call in non-browser contexts (e.g. SSR boot).
 */
export function getSavedLocale() {
  if (typeof localStorage === 'undefined') return null
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isSupported(saved) ? saved : null
  } catch {
    return null
  }
}

/**
 * Persists the user's locale choice. No-op when the code is not supported.
 */
export function persistLocale(code) {
  if (!isSupported(code)) return false
  if (typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code)
    return true
  } catch {
    return false
  }
}

/**
 * Applies a locale to a vue-i18n instance *and* persists the choice.
 * Accepts the composition-API root (`i18n.global`) or the options-API
 * `$i18n` — either exposes a writable `locale` property.
 */
export function applyLocale(i18n, code) {
  if (!isSupported(code)) return false
  i18n.locale = code
  persistLocale(code)
  return true
}

export function getLocaleLabel(code) {
  return SUPPORTED_LOCALES.find(l => l.value === code)?.label ?? code
}
