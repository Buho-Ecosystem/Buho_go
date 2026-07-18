/**
 * Early-boot wallet store hydration.
 *
 * Intent entry points (deep links, NFC scans) can fire before Wallet.vue has
 * mounted and run walletStore.initialize(). Their guards read persisted state
 * (kiosk mode, activeWallet) that is null until hydration runs, which would
 * misreport "no wallet set up" on a cold start.
 *
 * walletStore.initialize() is async, but its synchronous prefix (localStorage
 * read + migration + $patch) runs to completion before the first `await`.
 * That prefix is all the guards need; the connect/network tail continues in
 * the background and cannot starve the caller.
 *
 * Idempotent: dedupes via the store's isInitialized / _initializePromise
 * guards, so it is safe alongside Wallet.vue's own initialize() call.
 */

function hasPersistedWalletConfig() {
  try {
    const saved = localStorage.getItem('buhoGO_wallet_store')
    if (!saved) return false

    const parsed = JSON.parse(saved)
    return Array.isArray(parsed.wallets) && parsed.wallets.length > 0
  } catch {
    return false
  }
}

export function triggerWalletStoreHydration(walletStore) {
  if (walletStore.isInitialized) return
  if (!hasPersistedWalletConfig()) return

  walletStore.initialize().catch((err) => {
    console.warn('[wallet-hydration] Wallet store init failed:', err?.message || err)
  })
}
