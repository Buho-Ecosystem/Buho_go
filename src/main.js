import { createApp } from 'vue'
import { Quasar, Notify, Dialog } from 'quasar'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import messages from './i18n'
import { AppErrorHandler } from './utils/errorHandler'

// Import icon libraries
import '@quasar/extras/material-icons/material-icons.css'
import '@quasar/extras/line-awesome/line-awesome.css'

// Import Quasar css
import 'quasar/src/css/index.sass'

// Import app components
import App from './App.vue'
import router from './router'

// Create the app instance
const myApp = createApp(App)

// Install error handler
AppErrorHandler.install(myApp)

// Create Pinia store
const pinia = createPinia()

// Create i18n instance with fallback handling
const i18n = createI18n({
  locale: 'en-US',
  fallbackLocale: 'en-US',
  globalInjection: true,
  legacy: false,
  silentTranslationWarn: true,
  messages
})

// Configure Quasar
myApp.use(Quasar, {
  plugins: {
    Notify,
    Dialog
  },
  config: {
    dark: true
  }
})

// Use plugins
myApp.use(pinia)
myApp.use(router)
myApp.use(i18n)

// Mount the app with error handling
try {
  myApp.mount('#app')
} catch (error) {
  console.error('Failed to mount app:', error)
  // Fallback: show a basic error message
  document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h2>App Loading Error</h2><p>Please refresh the page to try again.</p></div>'
}