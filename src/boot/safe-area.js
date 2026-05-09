import { boot } from 'quasar/wrappers'

/**
 * Android safe-area fallback.
 *
 * env(safe-area-inset-*) returns 0 on many Android browsers/WebViews
 * even when there is a display cutout (notch, punch-hole camera) or
 * a gesture navigation bar at the bottom.
 * This boot file detects the actual inset heights at runtime and
 * patches the --safe-top / --safe-bottom CSS variables so content
 * never underlaps the system UI.
 */
export default boot(() => {
  if (typeof window === 'undefined') return

  const isAndroid = /android/i.test(navigator.userAgent)
  if (!isAndroid) return

  /**
   * Probe a single env(safe-area-inset-*) value.
   * Returns the resolved px value or 0 if the browser doesn't support it.
   */
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

  const apply = () => {
    // --- Top inset ---
    // 1. Try the Display Cutout API (Chrome 105+, most modern Android browsers)
    let topResolved = 0
    if (window.visualViewport) {
      topResolved = window.visualViewport.offsetTop
    }
    // 2. Fall back to probing env(safe-area-inset-top)
    if (topResolved === 0) {
      topResolved = probeInset('top')
    }
    if (topResolved > 0) {
      document.documentElement.style.setProperty('--safe-top', topResolved + 'px')
    }
    // else: keep the 24px CSS fallback from body.platform-android

    // --- Bottom inset ---
    // Detect gesture navigation bar / software nav bar height.
    // Unlike top (which has visualViewport.offsetTop), there is no reliable
    // Display Cutout API for the bottom inset. We use the same env() probe
    // technique — if env() resolves to 0 on this device, the CSS 16px
    // fallback from body.platform-android stays in effect.
    const bottomResolved = probeInset('bottom')
    if (bottomResolved > 0) {
      document.documentElement.style.setProperty('--safe-bottom', bottomResolved + 'px')
    }
    // else: keep the 16px CSS fallback from body.platform-android
  }

  // Run after layout is stable
  if (document.readyState === 'complete') {
    requestAnimationFrame(apply)
  } else {
    window.addEventListener('load', () => requestAnimationFrame(apply), { once: true })
  }
})
