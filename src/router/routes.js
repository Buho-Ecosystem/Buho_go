import { Capacitor } from '@capacitor/core'

/**
 * Guard for the Learn & Earn (`/learn*`) routes. The feature pays out real
 * sats, and the web build has no way to stop a user from creating throwaway
 * wallets to farm rewards, so the whole flow is native-only. On web we bounce
 * any direct navigation (typed URL, external deep link, in-app push) to
 * Settings flagged to open the shared Get-the-App dialog. On the native build
 * it is a no-op. Mirrors the biometrics / screen-privacy gating.
 */
const earnNativeOnly = (to, from, next) => {
  if (Capacitor.isNativePlatform()) {
    next()
    return
  }
  next({ path: '/settings', query: { getApp: 'learn' } })
}

const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/WelcomePage.vue') },
      { path: '/spark-setup', component: () => import('pages/SparkSetupPage.vue') },
      { path: '/arkade-setup', component: () => import('pages/ArkadeSetupPage.vue') },
      // Unified, wallet-type-aware restore. `/restore` lets the user pick;
      // `/spark-restore` (Settings, kiosk) and `/arkade-restore` pin the type.
      { path: '/restore', component: () => import('pages/RestorePage.vue') },
      { path: '/spark-restore', component: () => import('pages/RestorePage.vue') },
      { path: '/arkade-restore', component: () => import('pages/RestorePage.vue') },
      { path: '/spark-success', component: () => import('pages/SparkSuccessWizard.vue') },
      { path: '/nwc-setup', component: () => import('pages/NWCSetupPage.vue') },
      { path: '/lnbits-setup', component: () => import('pages/LNBitsSetupPage.vue') },
      { path: '/wallet', component: () => import('pages/Wallet.vue') },
      { path: '/settings', component: () => import('pages/Settings.vue') },
      { path: '/profile', component: () => import('pages/ProfilePage.vue') },
      { path: '/transactions', component: () => import('pages/TransactionHistory.vue') },
      { path: '/transaction/:id', component: () => import('pages/TransactionDetails.vue') },
      { path: '/address-book', component: () => import('pages/AddressBook.vue') },
      // Bitcoin merchant map. Lazy-loaded so maplibre-gl (~200KB gzipped)
      // never lands in the initial bundle. `?place=<id>` deep-links a pin.
      { path: '/map', component: () => import('pages/MapPage.vue') },
      // eSIM + VPN shop (nadanada). Lazy-loaded so the catalog + QR code only
      // enter the bundle when the user opens the store. Same pattern as /map.
      { path: '/shop', component: () => import('pages/ShopPage.vue') },
      // Online shops directory (BitcoinListings + BTCPay + Nostr). Lazy-loaded
      // so the adapters + Nostr code never land in the initial bundle.
      { path: '/online-shops', component: () => import('pages/OnlineShopsPage.vue') },
      { path: '/kiosk', name: 'kiosk', component: () => import('pages/KioskDashboard.vue') },
      { path: '/learn', component: () => import('pages/EarnMap.vue'), beforeEnter: earnNativeOnly },
      { path: '/learn/summary', component: () => import('pages/EarnSummary.vue'), beforeEnter: earnNativeOnly },
      { path: '/learn/:sectionId', component: () => import('pages/EarnSection.vue'), beforeEnter: earnNativeOnly },
      { path: '/learn/:sectionId/:questionId(.*)', component: () => import('pages/EarnQuiz.vue'), beforeEnter: earnNativeOnly }
    ]
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue')
  }
]

export default routes