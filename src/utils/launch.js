import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * The launch hand-over: from what shows before the app runs to the app's
 * first screen, without a seam.
 *
 * Before the app runs, two things stand in for it: on Android the system
 * splash (MainActivity holds it until told), and in every build the launch
 * frame in index.html (the same mark on the same background, for the web).
 * Both show the mark centred, LAUNCH_MARK_SIZE wide, on the background of
 * the home screen.
 *
 * The first home screen of a session claims the launch (LaunchMark.vue):
 * it draws that identical frame, releases the stand-ins, and carries the
 * mark to its place in the toolbar. When the app starts anywhere else, the
 * launch boot releases them as soon as that screen has painted. Either way
 * they are released exactly once.
 */

/** The mark's width in the launch frame, CSS px = Android dp (drawable/launch_icon.xml). */
export const LAUNCH_MARK_SIZE = 72

const Launch = registerPlugin('Launch')
const native = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

/** How long the app waits for Android to report the splash gone (a hot start shows none). */
const SPLASH_GONE_WAIT_MS = 1000

let claimed = false
let released = null

/**
 * The first home screen of a session takes the launch over. False once the
 * launch is claimed or released, so returning to home never replays it.
 * The Playwright audit harness opts in explicitly (`__AUDIT__.launch`).
 */
export function claimLaunch() {
  if (claimed || released) return false
  if (typeof window !== 'undefined' && window.__AUDIT__ && !window.__AUDIT__.launch) return false
  claimed = true
  return true
}

export function isLaunchClaimed() {
  return claimed
}

/**
 * Remove the launch frame and let the native splash go. Idempotent.
 * Resolves once nothing covers the app any more (on Android: the splash is
 * gone), so the first screen moves nothing the splash still hides.
 */
export function releaseLaunch() {
  if (released) return released
  if (typeof document !== 'undefined') document.getElementById('launch-frame')?.remove()
  released = native()
    ? Promise.race([
        Launch.ready().catch(() => { /* the native side lets go on its own after a timeout */ }),
        new Promise((done) => setTimeout(done, SPLASH_GONE_WAIT_MS)),
      ]).then(() => {})
    : Promise.resolve()
  return released
}

/**
 * Tell Android which theme the next launch should draw its splash in. The
 * app chooses its own theme (boot/theme.js), so the system's night mode is
 * not enough: on Android 12 and later the app's own night mode decides.
 */
export function rememberLaunchTheme(isDark) {
  if (!native()) return
  Launch.setNightMode({ dark: !!isDark }).catch(() => { /* older Android: follows the system */ })
}
