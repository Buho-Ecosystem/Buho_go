import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { parsePaymentDestination } from '../providers/WalletFactory'
import { EventBus } from '../utils/eventBus'

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
 *   4. We emit a 'deep-link' event on the EventBus
 *   5. Wallet.vue picks it up and feeds it into onPaymentDetected()
 */

// Track last handled URL to prevent duplicate processing on Activity resume
let lastHandledUrl = null

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

  // Ensure we're on the wallet page before emitting
  const currentPath = router.currentRoute.value?.path
  if (currentPath === '/wallet') {
    EventBus.emit('deep-link', paymentData)
  } else {
    // Navigate to wallet first, then emit after navigation completes
    router.push('/wallet').then(() => {
      // Small delay to let Wallet.vue mount and register its listener
      setTimeout(() => {
        EventBus.emit('deep-link', paymentData)
      }, 300)
    })
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
