import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { parsePaymentDestination } from '../providers/WalletFactory'
import { classifyIdentifier } from '../utils/nostrLookup'
import { triggerWalletStoreHydration } from '../utils/walletHydration'
import { profileLinkRoute } from '../utils/profileLink'
import { redactPaymentInput } from '../utils/logRedaction'

/**
 * Deep link handler for Android intent filters.
 *
 * Only loaded in Capacitor builds (see quasar.config.js).
 * Registers BuhoGO as a handler for lightning:, bitcoin:, lnurlp://, lnurlw://
 * URI schemes so it appears in the Android app chooser alongside other Lightning wallets,
 * and as an App Link handler for https://go.mybuho.de/p/… so a shared card opens
 * the card instead of the browser.
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

/**
 * Parse a deep link URI into the payment data shape expected by Wallet.vue's onPaymentDetected.
 * Returns null if the URI is not a recognized payment type.
 */
function parseDeepLinkURI(url) {
  if (!url || typeof url !== 'string') return null

  const input = url.trim()

  // NIP-21 identity links (nostr:npub… / nostr:nprofile…) — the identity-card
  // QR and Nostr clients hand these over. Not a payment shape, so
  // parsePaymentDestination can't classify them; Wallet.onPaymentDetected
  // resolves the profile to its Lightning target and re-dispatches.
  const nostrKind = classifyIdentifier(input)
  if (nostrKind === 'npub' || nostrKind === 'nprofile') {
    return { data: input, type: 'nostr_identifier' }
  }

  const parsed = parsePaymentDestination(input)

  const EXPLAINED_UNPAYABLE = ['bolt12_offer', 'silent_payment']
  if (!parsed || (!parsed.valid && !EXPLAINED_UNPAYABLE.includes(parsed.type)) || parsed.type === 'unknown') {
    return null
  }

  // Map to the { data, type } shape that Wallet.vue's onPaymentDetected expects
  // (same shape as SendModal's payment-detected emit)
  const data = parsed.invoice || parsed.offer || parsed.address || parsed.lnurl || input

  // Keep the BIP21 metadata: a unified QR's spark=/ark= rails and amount=
  // let onPaymentDetected route the payment over the wallet's native rail.
  return { data, type: parsed.type, ...(parsed.bip21 ? { bip21: parsed.bip21 } : {}) }
}

function handleDeepLink(url, router, walletStore) {
  if (!url || url === lastHandledUrl) return
  lastHandledUrl = url

  // Scheme + length only: deep links carry invoices, LNURLs and one-time
  // card-authentication parameters that must never reach logcat.
  console.log('[deep-links] Received:', redactPaymentInput(url))

  // Hydrate before any state-dependent check below. The kiosk guard and
  // activeWallet guard both read store state that is null until hydration runs.
  triggerWalletStoreHydration(walletStore)

  // Block deep links while kiosk mode is locked
  if (walletStore.kioskEnabled && !walletStore.kioskOwnerAccess) {
    console.log('[deep-links] Blocked - kiosk mode active')
    return
  }

  // A shared card is not a payment. It opens the same page the browser would
  // have shown, natively, where paying and saving the contact both work in
  // app. Checked before the wallet guard below on purpose: someone with no
  // wallet yet can still be handed a card and save the person.
  const profileRoute = profileLinkRoute(url)
  if (profileRoute) {
    router.push(profileRoute).catch(() => { /* navigation rejection is non-fatal */ })
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

  // An offer is recognized even though BuhoGO cannot pay it yet. Explain it
  // immediately instead of treating the Android intent as an unknown link or
  // requiring a configured wallet for a payment we will not attempt.
  if (paymentData.type === 'bolt12_offer') {
    walletStore.showUnsupportedBolt12Offer({ route: 'Android deep link' })
    return
  }
  if (paymentData.type === 'silent_payment') {
    walletStore.showUnsupportedSilentPayment({ route: 'Android deep link' })
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
