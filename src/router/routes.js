const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/WelcomePage.vue') },
      { path: '/spark-setup', component: () => import('pages/SparkSetupPage.vue') },
      { path: '/spark-restore', component: () => import('pages/SparkRestorePage.vue') },
      { path: '/nwc-setup', component: () => import('pages/IndexPage.vue') },
      { path: '/wallet', component: () => import('pages/Wallet.vue') },
      { path: '/settings', component: () => import('pages/Settings.vue') },
      { path: '/transactions', component: () => import('pages/TransactionHistory.vue') },
      { path: '/transaction/:id', component: () => import('pages/TransactionDetails.vue') },
      { path: '/address-book', component: () => import('pages/AddressBook.vue') }
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