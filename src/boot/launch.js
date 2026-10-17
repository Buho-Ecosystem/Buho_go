import { boot } from 'quasar/wrappers'
import { isLaunchClaimed, releaseLaunch } from '../utils/launch.js'

/**
 * Releases the launch frame (and Android's splash) when the app opens on a
 * screen other than home: once the router has settled and that screen has
 * painted. Home releases it itself, from LaunchMark.vue, at the moment it
 * draws the identical frame. See utils/launch.js.
 */
export default boot(({ router }) => {
  if (typeof window === 'undefined') return
  const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn))
  router.isReady()
    .then(() => afterPaint(() => { if (!isLaunchClaimed()) releaseLaunch() }))
    .catch(() => releaseLaunch())
})
