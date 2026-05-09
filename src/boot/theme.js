import { boot } from 'quasar/wrappers'
import { Dark } from 'quasar'

/**
 * Theme boot — single source of truth for light/dark mode persistence.
 *
 * Resolution order on startup:
 *   1. Stored user choice in localStorage (set the last time the user toggled)
 *   2. Operating-system preference via `prefers-color-scheme`
 *   3. Dark, as the ultimate fallback
 *
 * The Quasar `Dark` plugin holds the runtime flag; every component reads it via
 * `$q.dark.isActive`. This file is the only place that writes to it on startup.
 * Runtime toggles go through `persistTheme()` below (wired into
 * `src/utils/themeTransition.js`) so the choice survives reloads on both web
 * and the Capacitor Android build.
 *
 * Registered in `quasar.config.js` under `boot: ['theme', ...]`. It runs before
 * the app mounts, so components see the resolved theme from their first render.
 *
 * The audit boot file (`src/boot/audit.js`) takes precedence when the Playwright
 * harness sets `window.__AUDIT__`; we deliberately no-op in that case to keep
 * visual-regression tests deterministic.
 */

export const THEME_STORAGE_KEY = 'buho.theme'

const THEME_DARK = 'dark'
const THEME_LIGHT = 'light'

/**
 * Read the user's stored theme choice, if any.
 * @returns {boolean|null} true=dark, false=light, null if nothing stored or storage unavailable
 */
function readStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (value === THEME_DARK) return true
    if (value === THEME_LIGHT) return false
  } catch {
    // localStorage may be unavailable (private mode, sandboxed iframe, etc.)
  }
  return null
}

/**
 * Check the OS-level colour-scheme preference.
 * Defaults to dark if the media query isn't available (very old browsers).
 * @returns {boolean} true if the system prefers dark
 */
function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/**
 * Persist the user's theme choice so it survives reload / app restart.
 * Called by the runtime toggle (see themeTransition.js) after the toggle
 * has updated `Dark.isActive`.
 *
 * @param {boolean} isDark - current dark-mode state to persist
 */
export function persistTheme(isDark) {
  try {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      isDark ? THEME_DARK : THEME_LIGHT
    )
  } catch {
    // Storage failures are non-fatal: the in-memory state still reflects the
    // user's choice for the current session.
  }
}

export default boot(() => {
  if (typeof window === 'undefined') return

  // The Playwright audit harness sets the theme itself and must not be overridden.
  if (window.__AUDIT__) return

  const stored = readStoredTheme()
  const resolved = stored !== null ? stored : systemPrefersDark()
  Dark.set(resolved)
})
