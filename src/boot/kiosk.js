import { boot } from 'quasar/wrappers'
import { useWalletStore } from 'stores/wallet'

/**
 * Kiosk Mode navigation guard.
 *
 * When kiosk is enabled and not unlocked, ALL routes redirect to /kiosk.
 * Checks both the reactive store AND localStorage to cover the cold-start
 * race condition (guard fires before store.initialize() loads persisted state).
 */
export default boot(({ router }) => {
  router.beforeEach((to) => {
    const store = useWalletStore()

    if (to.path === '/kiosk') return true

    // Check reactive store first
    let kioskLocked = store.kioskEnabled && !store.kioskOwnerAccess

    // Cold-start fallback: store not yet initialized, check localStorage directly
    if (!store.kioskEnabled) {
      try {
        const saved = localStorage.getItem('buhoGO_wallet_store')
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.kioskEnabled) kioskLocked = true
        }
      } catch (e) { /* ignore */ }
    }

    if (!kioskLocked) return true

    // Kiosk is locked — only allow setup routes
    const setupRoutes = ['/spark-setup', '/spark-restore', '/spark-success',
      '/nwc-setup', '/lnbits-setup']
    if (setupRoutes.includes(to.path)) return true

    return { path: '/kiosk' }
  })
})
