import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { addNfcListener, addNfcErrorListener, isNfcAvailable } from '../utils/nfc'
import { parsePaymentDestination } from '../providers/WalletFactory'

/**
 * NFC boot plugin for Android.
 *
 * Only loaded in Capacitor builds (see quasar.config.js).
 *
 * Listens for NFC tag scans via the custom NfcPlugin Capacitor bridge.
 * Parsed payment data is buffered on walletStore.pendingDeepLink — the same
 * channel deep-links.js writes to — so Wallet.vue's watcher picks it up
 * without any additional wiring and without timing races.
 *
 * Supported tag formats:
 *   - Bolt Card  → lnurlw:// URL (LNURL-withdraw with HMAC)
 *   - LNURL-pay tag → lnurlp:// URL or LNURL1... bech32
 *   - LNURL via HTTPS → https://domain.tld/.well-known/lnurlp/...
 *   - Static Lightning invoice → BOLT-11
 *   - Lightning address → user@domain.com
 */

export default boot(async ({ router }) => {
  if (!Capacitor.isNativePlatform()) return

  const { useWalletStore } = await import('../stores/wallet')
  const walletStore = useWalletStore()

  // NFC error listener — tag found but unreadable
  addNfcErrorListener((message) => {
    console.warn('[nfc] Tag error:', message)
    Notify.create({
      type: 'warning',
      icon: 'nfc',
      message: 'NFC tag not readable',
      caption: message,
      timeout: 3000
    })
  })

  // Main NFC tag listener
  addNfcListener(async (raw) => {
    console.log('[nfc] Tag scanned:', raw)

    // Block while kiosk mode is locked
    if (walletStore.kioskEnabled && !walletStore.kioskOwnerAccess) {
      console.log('[nfc] Blocked — kiosk mode active')
      return
    }

    // Parse the raw tag content using the same logic as QR scanner & deep links
    const parsed = parsePaymentDestination(raw)

    // Bolt Cards often encode a plain https:// URL that resolves to a
    // LNURL-withdraw response. parsePaymentDestination() can't know this
    // without a network round-trip, so we forward https:// NFC tags as
    // type 'lnurl' — Wallet.vue's fetchLNURLInfo() will fetch and verify.
    if ((!parsed || !parsed.valid || parsed.type === 'unknown')
        && /^https?:\/\//i.test(raw)) {
      parsed = { type: 'lnurl', lnurl: raw, valid: true }
    }

    if (!parsed || !parsed.valid || parsed.type === 'unknown') {
      Notify.create({
        type: 'warning',
        icon: 'nfc',
        message: 'NFC tag not recognized',
        caption: 'Tag does not contain a Lightning payment',
        timeout: 3000
      })
      return
    }

    // Guard: no wallet configured
    if (!walletStore.activeWallet) {
      Notify.create({
        type: 'warning',
        icon: 'nfc',
        message: 'No wallet set up',
        caption: 'Please configure a wallet first',
        timeout: 5000
      })
      return
    }

    // Map to { data, type } shape that Wallet.vue's onPaymentDetected expects
    const paymentData = {
      data: parsed.invoice || parsed.address || parsed.lnurl || raw,
      type: parsed.type
    }

    // Buffer on the store; Wallet.vue's watcher consumes it. Same channel as
    // deep-links.js, so the rest of the flow is shared.
    walletStore.pendingDeepLink = paymentData

    if (router.currentRoute.value?.path !== '/wallet') {
      router.push('/wallet').catch(() => { /* navigation rejection is non-fatal */ })
    }
  })

  // Inform user if NFC is disabled on device
  const available = await isNfcAvailable()
  if (!available) {
    console.log('[nfc] NFC not available or disabled on this device')
  }
})
