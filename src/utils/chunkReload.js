import { Capacitor } from '@capacitor/core'

/**
 * Recovery for a tab that outlived the build it was loaded from.
 *
 * Every deploy hashes the JS chunks into fresh filenames, and hosting is
 * atomic: the previous build's files stop existing the moment the new one goes
 * live. So a tab that has been open across a deploy — or a service worker
 * still serving the index.html it precached earlier — keeps asking for chunk
 * names that are gone. The first lazy import after the deploy 404s, the route
 * never renders, and the user is left looking at a blank screen with no way to
 * know a refresh is all it needs.
 *
 * A reload fetches the new index.html and the matching chunks, so do that
 * reload on the user's behalf. It is deliberately guarded: one attempt, then
 * the error is allowed through. A reload loop is worse than a blank page, and
 * a chunk that stays missing after a refresh is a real failure the user (and
 * the console) should see rather than a skew we can paper over.
 *
 * Wired in two places, both of which see failures the other does not:
 *   - `src/router/index.js` via `Router.onError`, for lazy route components
 *   - `src/boot/chunk-recovery.js`, for dynamic imports outside the router
 * A third, cruder copy of the same guard sits inline in `index.html` for the
 * case where the entry bundle itself 404s and none of this code is running.
 * Its storage key is the one below — keep them identical so the layers share a
 * single reload budget instead of each spending their own.
 */

const RELOAD_MARK = 'buhogo:chunk-reload-at'
const RELOAD_COOLDOWN_MS = 30000

// A missing chunk reads differently in every engine, and none of them set a
// useful `name`, so matching the message is the only portable signal.
const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
  'unable to preload css', // Vite's preload helper, same cause
  'loading chunk' // ChunkLoadError's own wording
]

export function isChunkLoadError (error) {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  const message = String(error.message || error).toLowerCase()
  return CHUNK_ERROR_PATTERNS.some(pattern => message.includes(pattern))
}

function alreadyReloaded () {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_MARK))
    return at > 0 && Date.now() - at < RELOAD_COOLDOWN_MS
  } catch (e) {
    // Storage can throw in locked-down browser modes. Without a memory of the
    // attempt there is no way to promise we would stop after one, so treat the
    // budget as already spent.
    return true
  }
}

/**
 * Reload once if `error` is a missing-chunk error. Returns true when the
 * reload was triggered, so callers know the error has been handled and does
 * not need reporting on top.
 */
export function reloadForChunkError (error) {
  if (!isChunkLoadError(error)) return false

  // The packaged Android build serves its chunks from inside the app, so they
  // can never be out of step with the document that asked for them. A chunk
  // error there means something else entirely and a reload would only hide it.
  if (Capacitor.isNativePlatform()) return false

  // Offline, the chunk is missing because the network is, not because the
  // build moved. Reloading would trade a half-working app shell for nothing.
  if (navigator.onLine === false) return false

  if (alreadyReloaded()) return false

  try {
    window.sessionStorage.setItem(RELOAD_MARK, String(Date.now()))
  } catch (e) {
    return false
  }

  window.location.reload()
  return true
}
