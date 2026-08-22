/* eslint-env serviceworker */

/**
 * BuhoGO service worker.
 *
 * Hand-authored (workboxMode 'InjectManifest') so the two decisions that used
 * to be implicit generated config are explicit, reviewable source:
 *
 * 1. Navigations go network-first. Deploys are atomic and chunk filenames are
 *    content-hashed, so HTML served from a cache can reference files the
 *    server no longer has: the page goes blank on a chunk 404. Fetching the
 *    document fresh whenever the network allows means the HTML and its chunks
 *    always describe the same build. The precached copy is only the offline
 *    fallback.
 *
 * 2. A new worker waits for consent instead of calling skipWaiting() on
 *    install. Immediate takeover deletes the previous build's caches while
 *    open tabs still run its code, which breaks their next lazy import. The
 *    waiting worker is announced through the in-app update experience
 *    (src-pwa/register-service-worker.js -> stores/update.js) and promoted by
 *    reloadPwa() via the SKIP_WAITING message when the user applies the
 *    update, or naturally once every tab of the old build has closed.
 *
 * What gets precached is decided in quasar.config.js
 * (pwa.extendInjectManifestOptions): the app shell only, not the media
 * library. Images cache at runtime instead, as they are viewed.
 *
 * The cache prefix must stay 'buho-app': it is what the previously shipped
 * generated worker used, so the precache diff (and the removal of entries
 * this worker no longer wants) happens inside the same cache instead of
 * stranding ~44 MB per device in an orphaned one.
 */

import { clientsClaim, setCacheNameDetails } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

setCacheNameDetails({ prefix: 'buho-app' })

// Promotion signal sent by reloadPwa() when the user applies an update.
// This is the only path to skipWaiting().
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Once the new worker is allowed to activate, it takes over every open tab at
// the same moment, so a single confirmed reload moves the whole app forward
// and `controllerchange` fires for the page that asked.
clientsClaim()

// --- Navigations: network-first, precached shell as the offline fallback ---

// Registered BEFORE precacheAndRoute on purpose: Workbox matches routes in
// registration order, and the precache route also answers navigations to "/"
// (its directoryIndex maps "/" to the precached index.html). If it were
// registered first, documents would come from the cache again and the whole
// point of network-first navigation would be silently lost.

// Never answer a navigation to the worker's own script with HTML.
const NAVIGATION_DENYLIST = [new RegExp(process.env.PWA_SERVICE_WORKER_REGEX)]

const navigationStrategy = new NetworkFirst({
  cacheName: 'app-shell',
  // On a connection that stalls rather than fails, give the network this long
  // before serving the last good document. Long enough for slow mobile, short
  // enough that a dead network does not feel like a hang.
  networkTimeoutSeconds: 5,
  plugins: [new CacheableResponsePlugin({ statuses: [200] })],
})

registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate'
    && !NAVIGATION_DENYLIST.some(pattern => pattern.test(url.pathname)),
  async params => {
    try {
      return await navigationStrategy.handle(params)
    } catch (error) {
      // Offline with nothing in the runtime cache (first offline visit to a
      // path such as /p/<slug>): serve the precached shell. The router runs
      // on the hash, so the shell can render any in-app route.
      const shell = await matchPrecache(process.env.PWA_FALLBACK_HTML)
      if (shell) return shell
      throw error
    }
  },
)

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// --- Images: cached as browsed, not precached ---

// The media library (screenshots, onboarding art, partner logos) is far
// bigger than the app and mostly never viewed, so it stays out of the
// precache. Whatever a person actually sees is kept for repeat visits and
// offline. These files are unhashed and effectively immutable; the expiry
// bounds how long a replaced image could linger.
registerRoute(
  ({ request, url }) =>
    request.destination === 'image'
    && url.origin === self.location.origin,
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)
