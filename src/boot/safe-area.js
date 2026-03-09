import { boot } from 'quasar/wrappers'

/**
 * Android safe-area fallback.
 *
 * env(safe-area-inset-top) returns 0 on many Android browsers/WebViews
 * even when there is a display cutout (notch, punch-hole camera).
 * This boot file detects the actual cutout height at runtime and
 * patches the --safe-top CSS variable so pages render below the status bar.
 */
export default boot(() => {
  if (typeof window === 'undefined') return

  const isAndroid = /android/i.test(navigator.userAgent)
  if (!isAndroid) return

  const apply = () => {
    // 1. Try the Display Cutout API (Chrome 105+, most modern Android browsers)
    if (window.visualViewport) {
      const offsetTop = window.visualViewport.offsetTop
      if (offsetTop > 0) {
        document.documentElement.style.setProperty('--safe-top', offsetTop + 'px')
        return
      }
    }

    // 2. Check if env(safe-area-inset-top) actually resolved to something > 0
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;'
    document.body.appendChild(probe)
    const resolved = parseInt(getComputedStyle(probe).paddingTop, 10) || 0
    document.body.removeChild(probe)

    if (resolved > 0) {
      // env() works — use it directly (CSS already handles this)
      document.documentElement.style.setProperty('--safe-top', resolved + 'px')
    }
    // else: keep the 24px CSS fallback from body.platform-android
  }

  // Run after layout is stable
  if (document.readyState === 'complete') {
    requestAnimationFrame(apply)
  } else {
    window.addEventListener('load', () => requestAnimationFrame(apply), { once: true })
  }
})
