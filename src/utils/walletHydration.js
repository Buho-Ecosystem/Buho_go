/**
 * Loading the wallet store's saved state.
 *
 * The store saves by replacing everything on disk with what it holds in
 * memory, so the saved state must be in memory before anything reads or
 * saves it. The 'wallet-store' boot file loads it at start on every
 * platform, before the route guards, the boot tasks after it and the first
 * screen (loadSavedWalletsAtStart). Until it is loaded the store refuses to
 * save, and wallet adds wait for it.
 *
 * initialize() is async: besides the storage read, the load runs the
 * one-time wallet-model upgrade, which decrypts the saved phrases. Code that
 * needs the saved state awaits walletStore.whenHydrated().
 * readPersistedWalletState() serves guards that must answer synchronously,
 * and triggerWalletStoreHydration() starts a load without waiting for it.
 *
 * Idempotent: the store dedupes via isInitialized / _initializePromise, so
 * every caller is safe alongside the others.
 */

/**
 * How long the start waits for the saved wallets. Loading is local and
 * normally takes milliseconds; the bound only keeps a stuck load from
 * leaving a blank screen. Saves stay refused, and adds wait, until the load
 * lands.
 */
const START_LOAD_WAIT_MS = 3000

/**
 * Load the saved wallets and settings at start (the 'wallet-store' boot).
 * Never rejects: Quasar does not mount the app when a boot file throws.
 * Warns when loading failed, or is still running after `waitMs`.
 */
export async function loadSavedWalletsAtStart(walletStore, { waitMs = START_LOAD_WAIT_MS } = {}) {
  let timer
  try {
    await Promise.race([
      walletStore.whenHydrated(),
      new Promise((resolve) => { timer = setTimeout(resolve, waitMs) }),
    ])
  } catch (err) {
    console.warn('[wallet-hydration] Loading the saved wallets failed:', err?.message || err)
  } finally {
    clearTimeout(timer)
  }
  if (!walletStore.hydrated) {
    console.warn(`[wallet-hydration] Saved wallets still loading after ${waitMs} ms`)
  } else if (!walletStore.savedStateLoaded) {
    console.warn('[wallet-hydration] The saved wallets could not be loaded; nothing will be saved over them')
  }
}

/**
 * Raw persisted wallet-store snapshot, or null when absent/unreadable.
 * The single place that knows the storage key and shape outside the store
 * itself — boot guards that must answer before hydration read through
 * this instead of hand-parsing localStorage.
 */
export function readPersistedWalletState() {
  try {
    const saved = localStorage.getItem('buhoGO_wallet_store')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

function hasPersistedWalletConfig() {
  const parsed = readPersistedWalletState()
  return Array.isArray(parsed?.wallets) && parsed.wallets.length > 0
}

export function triggerWalletStoreHydration(walletStore) {
  if (walletStore.isInitialized) return
  if (!hasPersistedWalletConfig()) return

  walletStore.initialize().catch((err) => {
    console.warn('[wallet-hydration] Wallet store init failed:', err?.message || err)
  })
}
