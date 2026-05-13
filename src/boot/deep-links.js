import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { parsePaymentDestination } from '../providers/WalletFactory'

/**
 * Deep link handler for Android intent filters.
 *
 * Only loaded in Capacitor builds (see quasar.config.js).
 * Registers BuhoGO as a handler for lightning:, bitcoin:, lnurlp://, lnurlw://
 * URI schemes so it appears in the Android app chooser alongside other Lightning wallets.
 *
 * The flow:
 *   1. Android receives an intent matching our URI schemes (AndroidManifest.xml)
 *   2. Capacitor's AppPlugin fires 'appUrlOpen' with the full URI
 *   3. We parse it via WalletFactory.parsePaymentDestination (same logic as QR scanner)
 *   4. We write the parsed payload to walletStore.pendingDeepLink
 *   5. Wallet.vue's watcher (immediate: true) drains it on mount and feeds
 *      onPaymentDetected(). This survives the cold-start race where the
 *      intent arrives before Wallet.vue has registered its handler.
 */

// Track last handled URL to prevent duplicate processing on Activity resume
let lastHandledUrl = null

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

/**
 * Trigger wallet-store hydration synchronously.
 *
 * walletStore.initialize() is an async function, but its synchronous prefix
 * (localStorage read + migration + $patch) runs to completion before the
 * first `await`. That prefix is all we need to read activeWallet and
 * kiosk state correctly; the connect/network tail continues in the
 * background and cannot starve us here.
 *
 * Idempotent: dedupes via the store's isInitialized / _initializePromise
 * guards, so this is safe alongside Wallet.vue's own initialize() call.
 */
function triggerStoreHydration(walletStore) {
  if (walletStore.isInitialized) return
  if (!hasPersistedWalletConfig()) return

  walletStore.initialize().catch((err) => {
    console.warn('[deep-links] Wallet store init failed:', err?.message || err)
  })
}

/**
 * Parse a deep link URI into the payment data shape expected by Wallet.vue's onPaymentDetected.
 * Returns null if the URI is not a recognized payment type.
 */
function parseDeepLinkURI(url) {
  if (!url || typeof url !== 'string') return null

  const input = url.trim()
  const parsed = parsePaymentDestination(input)

  if (!parsed || !parsed.valid || parsed.type === 'unknown') {
    return null
  }

  // Map to the { data, type } shape that Wallet.vue's onPaymentDetected expects
  // (same shape as SendModal's payment-detected emit)
  const data = parsed.invoice || parsed.address || parsed.lnurl || input

  return { data, type: parsed.type }
}

function handleDeepLink(url, router, walletStore) {
  if (!url || url === lastHandledUrl) return
  lastHandledUrl = url

  console.log('[deep-links] Received:', url)

  // Hydrate before any state-dependent check below. The kiosk guard and
  // activeWallet guard both read store state that is null until hydration runs.
  triggerStoreHydration(walletStore)

  // Block deep links while kiosk mode is locked
  if (walletStore.kioskEnabled && !walletStore.kioskOwnerAccess) {
    console.log('[deep-links] Blocked - kiosk mode active')
    return
  }

  const paymentData = parseDeepLinkURI(url)
  if (!paymentData) {
    Notify.create({
      type: 'warning',
      message: 'Unsupported link format',
      timeout: 3000
    })
    return
  }

  // Guard: don't proceed if no wallet is configured
  if (!walletStore.activeWallet) {
    Notify.create({
      type: 'warning',
      message: 'Please set up a wallet first',
      caption: 'A wallet is needed to process payment links',
      timeout: 5000
    })
    return
  }

  // Buffer the payload on the store. Wallet.vue's watcher consumes it
  // on mount (immediate: true) so the intent survives the race where
  // the listener has not yet registered.
  walletStore.pendingDeepLink = paymentData

  // Ensure Wallet.vue actually gets mounted to drain the buffer
  if (router.currentRoute.value?.path !== '/wallet') {
    router.push('/wallet').catch(() => { /* navigation rejection is non-fatal */ })
  }
}

export default boot(async ({ router }) => {
  if (!Capacitor.isNativePlatform()) return

  const { useWalletStore } = await import('../stores/wallet')
  const walletStore = useWalletStore()

  // Listen for deep links while app is running (warm start)
  App.addListener('appUrlOpen', ({ url }) => {
    handleDeepLink(url, router, walletStore)
  })

  // Handle cold start — app was launched via a deep link
  App.getLaunchUrl().then((result) => {
    if (result?.url) {
      handleDeepLink(result.url, router, walletStore)
    }
  })
})
