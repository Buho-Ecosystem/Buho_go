import { onUnmounted, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useAddressBookStore } from '../stores/addressBook.js'
import { useIdentityStore } from '../stores/identity.js'
import { useWalletStore } from '../stores/wallet.js'

/**
 * App-level driver for the shared-contacts sync. Lives here — not on
 * the Address Book page — because contacts are mutated from several
 * surfaces (Profile scan sheet, send-flow save, the page itself) and
 * a page-bound driver only publishes while its page is mounted, which
 * strands everything added elsewhere.
 *
 * What it does:
 *   - dirty flag flips → debounced silent publish
 *   - app backgrounds  → flush immediately (the webview may be
 *     suspended before a debounce timer ever fires)
 *   - identity appears → publish contacts added before it existed
 *   - back online / app start / resume → catch up, plus a throttled
 *     pull so edits made in the user's other apps land here without
 *     the user doing anything
 *
 * Failures stay silent by design: syncDirty persists, every trigger
 * retries, and the Address Book page is where a deliberate action
 * gets a deliberate error toast.
 *
 * Kiosk boot is excluded: a locked kiosk device must not spin up
 * relay traffic for the owner's contacts. The flag is checked per
 * trigger (not once at setup) because the wallet store hydrates
 * asynchronously.
 */

// Collapse a burst of edits (add three contacts in a row) into one
// publish, while keeping the backup feeling immediate.
const AUTO_SYNC_DEBOUNCE_MS = 1500

// The pull side exists for cross-app edits, which are rare compared
// to app switches — one pull per window is plenty.
const PULL_THROTTLE_MS = 5 * 60 * 1000

export function useAddressBookSync() {
  const addressBook = useAddressBookStore()
  const identityStore = useIdentityStore()
  const walletStore = useWalletStore()

  let debounceTimer = null
  let stateListener = null
  let lastPullAt = 0

  const blocked = () => walletStore.kioskEnabled

  async function syncNow() {
    if (blocked() || !identityStore.bootstrapped) return
    try {
      await addressBook.syncToNostr({ identityStore })
    } catch (err) {
      console.warn('[addressBookSync] background sync failed:', err)
    }
  }

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      syncNow()
    }, AUTO_SYNC_DEBOUNCE_MS)
  }

  /** Publish pending changes right now — used when the app may die. */
  function flush() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (addressBook.syncDirty) syncNow()
  }

  /** Throttled pull; a sync is pull and push in one, so dirty state rides along. */
  function pull() {
    const now = Date.now()
    if (now - lastPullAt < PULL_THROTTLE_MS) return
    lastPullAt = now
    syncNow()
  }

  watch(() => addressBook.syncDirty, (isDirty) => {
    if (isDirty) schedule()
  })

  // Contacts can be added before an identity exists (it is created
  // lazily). The persisted dirty flag plus this watcher is what stops
  // them from stranding until the next app restart.
  watch(() => identityStore.bootstrapped, (ready) => {
    if (ready && addressBook.syncDirty) schedule()
  })

  const onOnline = () => {
    if (addressBook.syncDirty) schedule()
  }

  async function start() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
    }

    if (Capacitor.isNativePlatform()) {
      // Dynamic import — @capacitor/app is only available in Capacitor
      // builds (same pattern as App.vue's biometric listener).
      const { App: CapApp } = await import('@capacitor/app')
      stateListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) pull()
        else flush()
      })
    }

    await addressBook.initialize()
    await identityStore.hydrate()
    if (addressBook.syncDirty) schedule()
    pull()
  }

  // Fire-and-forget: App.vue's setup must not await relay work.
  start().catch((err) => {
    console.warn('[addressBookSync] driver start failed:', err)
  })

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (stateListener) stateListener.remove()
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
    }
  })
}
