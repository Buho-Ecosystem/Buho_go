const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/WelcomePage.vue') },
      { path: '/spark-setup', component: () => import('pages/SparkSetupPage.vue') },
      { path: '/spark-restore', component: () => import('pages/SparkRestorePage.vue') },
      { path: '/spark-success', component: () => import('pages/SparkSuccessWizard.vue') },
      { path: '/nwc-setup', component: () => import('pages/NWCSetupPage.vue') },
      { path: '/lnbits-setup', component: () => import('pages/LNBitsSetupPage.vue') },
      { path: '/wallet', component: () => import('pages/Wallet.vue') },
      { path: '/settings', component: () => import('pages/Settings.vue') },
      { path: '/transactions', component: () => import('pages/TransactionHistory.vue') },
      { path: '/transaction/:id', component: () => import('pages/TransactionDetails.vue') },
      { path: '/address-book', component: () => import('pages/AddressBook.vue') },
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