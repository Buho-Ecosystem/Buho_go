import { register } from 'register-service-worker'
import { PWA_UPDATE_EVENT, PWA_UPDATE_FLAG } from 'src/utils/updateEvents'

// The ready(), registered(), cached(), updatefound() and updated()
// events passes a ServiceWorkerRegistration instance in their arguments.
// ServiceWorkerRegistration: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration

register(process.env.SERVICE_WORKER_FILE, {
  // The registrationOptions object will be passed as the second argument
  // to ServiceWorkerContainer.register()
  // https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#Parameter

  // registrationOptions: { scope: './' },

  ready (/* registration */) {
    // console.log('Service worker is active.')
  },

  registered (/* registration */) {
    // console.log('Service worker has been registered.')
  },

  cached (/* registration */) {
    // console.log('Content has been cached for offline use.')
  },

  updatefound (/* registration */) {
    // console.log('New content is downloading.')
  },

  updated (/* registration */) {
    // The worker does not skipWaiting() on install, so at this point the new
    // version is parked in the waiting state and the page still runs the old
    // build undisturbed. Hand readiness to the shared in-app update
    // experience; applying it goes through reloadPwa(), which promotes the
    // waiting worker and reloads once it has taken control.
    window[PWA_UPDATE_FLAG] = true
    window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT))
  },

  offline () {
    // console.log('No internet connection found. App is running in offline mode.')
  },

  error (/* err */) {
    // console.error('Error during service worker registration:', err)
  }
})
