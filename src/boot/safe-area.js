import { boot } from 'quasar/wrappers'

/**
 * Android safe-area fallback.
 *
 * env(safe-area-inset-*) returns 0 on most Android Capacitor WebViews
 * even when there is a display cutout (notch, punch-hole) and a system
 * navigation bar at the bottom — Android exposes those via WindowInsets,
 * which the WebView does not surface to CSS without a native bridge.
 *
 * This boot file detects the actual inset heights at runtime and
 * patches the --safe-top / --safe-bottom CSS variables so headers
 * sit below the status bar and bottom buttons clear the nav bar.
 *
 * Detection strategy, in order of precedence:
 *
 *   1. window.visualViewport.offsetTop — the modern Display Cutout
 *      signal for the top inset. Available on Chrome 105+ WebViews.
 *
 *   2. env(safe-area-inset-*) — probed via a hidden element. Captures
 *      devices where the WebView happens to publish insets to CSS.
 *
 *   3. screen.height - window.innerHeight — Android-only fallback. On
 *      edge-to-edge devices the WebView fills the screen and this is
 *      0, but on devices where Android keeps the system bars outside
 *      the WebView (older Android, some OEM skins) this is the total
 *      system-bar height. We split it: known top inset goes to top,
 *      remainder goes to bottom. Better than leaving --safe-bottom
 *      at the CSS floor on a phone with a 48dp 3-button nav bar.
 *
 * The CSS floor in app.css (28px top, 24px bottom) remains the lower
 * bound — we only overwrite when JS detects a larger value.
 */
export default boot(() => {
  if (typeof window === 'undefined') return

  const isAndroid = /android/i.test(navigator.userAgent)
  if (!isAndroid) return

  const probeInset = (side) => {
    const prop = side === 'top' ? 'paddingTop' : 'paddingBottom'
    const env = `env(safe-area-inset-${side}, 0px)`
    const probe = document.createElement('div')
    probe.style.cssText = `position:fixed;${side}:0;${prop === 'paddingTop' ? 'padding-top' : 'padding-bottom'}:${env};visibility:hidden;pointer-events:none;`
    document.body.appendChild(probe)
    const resolved = parseInt(getComputedStyle(probe)[prop], 10) || 0
    document.body.removeChild(probe)
    return resolved
  }

  const setIfLarger = (varName, candidate) => {
    if (!Number.isFinite(candidate) || candidate <= 0) return
    const current = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(varName),
      10,
    ) || 0
    if (candidate > current) {
      document.documentElement.style.setProperty(varName, candidate + 'px')
    }
  }

  const apply = () => {
    let topResolved = 0
    if (window.visualViewport) {
      topResolved = window.visualViewport.offsetTop || 0
    }
    if (topResolved === 0) {
      topResolved = probeInset('top')
    }

    let bottomResolved = probeInset('bottom')

    // Screen-vs-viewport delta catches devices where the WebView is
    // laid out outside the system bars (the env() probe returns 0
    // because there's nothing for CSS to inset against, but innerHeight
    // is smaller than screen.height by exactly the bar heights). If
    // we already have a top value, the remainder is the bottom inset.
    const screenDelta = Math.max(0, (screen.height || 0) - window.innerHeight)
    if (screenDelta > 0) {
      if (topResolved === 0) {
        // Assume standard 24dp status bar — leaves the rest for bottom.
        topResolved = Math.min(screenDelta, 28)
      }
      const inferredBottom = Math.max(0, screenDelta - topResolved)
      if (inferredBottom > bottomResolved) bottomResolved = inferredBottom
    }

    setIfLarger('--safe-top', topResolved)
    setIfLarger('--safe-bottom', bottomResolved)
  }

  if (document.readyState === 'complete') {
    requestAnimationFrame(apply)
  } else {
    window.addEventListener('load', () => requestAnimationFrame(apply), { once: true })
  }
})
