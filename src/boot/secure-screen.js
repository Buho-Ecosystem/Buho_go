import { boot } from 'quasar/wrappers'
import { watch } from 'vue'
import { useWalletStore } from 'stores/wallet'
import {
  applyScreenPrivacyTransient,
  isScreenPrivacySupported,
} from '../utils/secureScreen'

/**
 * Screen-privacy boot file.
 *
 * Coordinates three sources of intent for the Android FLAG_SECURE flag:
 *
 *   1. MainActivity.onCreate — applied the flag synchronously from
 *      SharedPreferences before the WebView loaded. Establishes the
 *      baseline.
 *   2. User toggle in Settings — flows through the Pinia store via
 *      wallet.updatePrivacyScreenEnabled, which writes to SharedPrefs
 *      AND applies the flag. This boot file *watches* the store to
 *      catch any non-action mutation (defence-in-depth) but doesn't
 *      drive that path itself.
 *   3. Router-meta forceSecure — visiting a route with
 *      `meta: { forceSecure: true }` temporarily turns the flag on
 *      regardless of the user's preference. Leaving the route
 *      restores the user's preference. No persisted writes — pure
 *      transient overlay.
 *
 * The boot file owns concern (3) and is the single place reconciling
 * the Pinia store with the native source of truth on first load.
 *
 * Lifecycle:
 *
 *   - On boot (router available): reconcile Pinia store with native
 *     state, then install a router guard for forceSecure overrides.
 *   - On store change (watch): the wallet action already calls the
 *     plugin directly; the watcher is a safety net that re-applies
 *     the flag in case the value diverged from native state through
 *     some path other than the action (Pinia devtools, persistence
 *     hydration, etc.).
 *
 * Web/PWA behaviour: every native call no-ops in the util layer, the
 * router guard is harmless, and the watcher just mirrors state without
 * side effects. Safe to keep this boot file unconditional in the
 * Quasar config.
 */
export default boot(async ({ router }) => {
  const walletStore = useWalletStore()

  // ── Reconcile Pinia ↔ native at boot ──────────────────────────────
  //
  // Pinia hydrated from localStorage synchronously before this runs.
  // The native plugin owns the canonical persisted value (read by
  // MainActivity on cold start). On platforms where the two layers
  // can disagree (post-migration, dev-tools clear, manifest reset),
  // this re-aligns the Pinia store to the native truth so the UI and
  // the actual window flag never show different things.
  await walletStore.syncPrivacyScreenFromNative()

  // ── forceSecure router-meta override ──────────────────────────────
  //
  // The convention: any route declaring `meta: { forceSecure: true }`
  // gets FLAG_SECURE applied on enter regardless of the user's
  // toggle, and the user's preference is restored on leave. Persists
  // nothing — purely a transient overlay scoped to the route's
  // lifetime. No routes use it yet; the infrastructure is ready for
  // sensitive surfaces to opt in with one line.
  //
  // afterEach (not beforeEach) is intentional: we react after the
  // destination is committed, which avoids racing the route render
  // against a still-pending flag mutation. The brief window between
  // route mount and flag application is invisible — the destination
  // can't have rendered sensitive content yet.
  if (!isScreenPrivacySupported()) {
    // Nothing to do on web — both the toggle and the router-meta
    // override would be no-ops. Skip the guard install so we don't
    // attach a useless hook to every navigation.
    return
  }

  router.afterEach(async (to) => {
    const routeForcesSecure = to.matched.some(
      (record) => record.meta && record.meta.forceSecure
    )

    try {
      if (routeForcesSecure) {
        await applyScreenPrivacyTransient(true)
      } else {
        // Restore the user's persisted preference. Reading from the
        // store (already reconciled at boot, kept in sync by the
        // toggle action) avoids a second native round-trip per nav.
        await applyScreenPrivacyTransient(walletStore.privacyScreenEnabled)
      }
    } catch (error) {
      // Fail-secure: if the native call rejects on a route-leave,
      // log and leave the flag at whatever the previous successful
      // call left it. Worst case the user sees secure mode where
      // they wouldn't have — a minor inconvenience, not a leak.
      console.warn('[secure-screen] route-meta override failed:', error)
    }
  })

  // ── Defence-in-depth watcher ──────────────────────────────────────
  //
  // The Settings toggle action is the documented mutation path and
  // it writes both to native and Pinia atomically. This watch exists
  // for any code path that mutates the Pinia value WITHOUT going
  // through the action (devtools, accidental direct assignment).
  // We re-apply via the transient call so the watcher doesn't
  // double-persist (the action already persisted, or this is a stray
  // write we shouldn't promote to a persisted change).
  watch(
    () => walletStore.privacyScreenEnabled,
    async (value) => {
      try {
        await applyScreenPrivacyTransient(value)
      } catch (error) {
        console.warn('[secure-screen] watcher re-apply failed:', error)
      }
    }
  )
})
