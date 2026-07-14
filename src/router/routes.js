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
      // Settings / Identity / Spend hub - three sibling tabs, each its own
      // route. Entry points target the tab they mean: the wallet toolbar's
      // profile icon opens `/identity`, Map's back-fallback opens `/spend`.
      // Nothing lands on the hub without naming a tab, so the Settings route
      // needs no default-tab redirect - it always shows the Settings tab,
      // with or without a query (`?section=backup`, `?section=wallets`,
      // `?getApp=learn` all still land here as before).
      { path: '/settings', component: () => import('pages/Settings.vue') },
      { path: '/spend', component: () => import('pages/SpendPage.vue') },
      { path: '/identity', component: () => import('pages/ProfilePage.vue') },
      // Legacy alias - anything that still links to /profile (e.g. an
      // older deep link) lands on the same page under its new tab name.
      // Query params are preserved (a redirect string alone would drop
      // them) since IdentityAuthDialog's LUD-04 sign-in flow can land
      // here with its own query.
      { path: '/profile', redirect: (to) => ({ path: '/identity', query: to.query }) },
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