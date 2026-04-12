import { boot } from 'quasar/wrappers'
import { useWalletStore } from 'stores/wallet'

/**
 * Kiosk Mode navigation guard.
 *
 * When kiosk mode is enabled and the merchant has not unlocked (kioskOwnerAccess = false),
 * all navigation is redirected to /kiosk except setup/onboarding routes.
 */
export default boot(({ router }) => {
  router.beforeEach((to) => {
    const store = useWalletStore()

    // Always allow these routes
    const allowed = ['/', '/spark-setup', '/spark-restore', '/spark-success',
      '/nwc-setup', '/lnbits-setup', '/kiosk']
    if (allowed.includes(to.path)) return true

    // If kiosk is locked, redirect to kiosk dashboard
    if (store.kioskEnabled && !store.kioskOwnerAccess) {
      return { path: '/kiosk' }
    }

    return true
  })
})
