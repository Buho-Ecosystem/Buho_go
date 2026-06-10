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
      { path: '/kiosk', name: 'kiosk', component: () => import('pages/KioskDashboard.vue') },
      { path: '/learn', component: () => import('pages/EarnMap.vue') },
      { path: '/learn/summary', component: () => import('pages/EarnSummary.vue') },
      { path: '/learn/:sectionId', component: () => import('pages/EarnSection.vue') },
      { path: '/learn/:sectionId/:questionId(.*)', component: () => import('pages/EarnQuiz.vue') }
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