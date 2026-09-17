import { boot } from 'quasar/wrappers'
import { reloadForChunkError } from 'src/utils/chunkReload'

/**
 * Chunk-recovery boot — catches the dynamic imports the router does not.
 *
 * `Router.onError` in `src/router/index.js` covers lazy route components, but
 * plenty of the app is code-split below that level: modals, wallet backends,
 * the heavier libraries pulled in on demand. When one of those imports fails
 * because the deploy moved underneath an open tab, the rejection surfaces
 * either through Vue's error handler or as an unhandled rejection, never
 * through the router. Both roads lead to `reloadForChunkError`, which decides
 * whether a refresh is the right answer and is the single place holding the
 * one-attempt budget. See `src/utils/chunkReload.js` for the reasoning.
 *
 * Anything that is not a missing chunk is passed straight through untouched,
 * so this adds a recovery path without swallowing errors.
 *
 * Registered in `quasar.config.js` under `boot: [...]`. Loaded everywhere,
 * kiosk included — it no-ops on the native build.
 */
export default boot(({ app }) => {
  const previousHandler = app.config.errorHandler

  app.config.errorHandler = (error, instance, info) => {
    if (reloadForChunkError(error)) return

    if (previousHandler) {
      previousHandler(error, instance, info)
      return
    }
    console.error('Unhandled app error:', error, info)
  }

  window.addEventListener('unhandledrejection', event => {
    reloadForChunkError(event.reason)
  })
})
