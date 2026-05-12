import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { addNfcListener, addNfcErrorListener, isNfcAvailable } from '../utils/nfc'
import { parsePaymentDestination } from '../providers/WalletFactory'
import { EventBus } from '../utils/eventBus'

/**
 * NFC boot plugin for Android.
 *
 * Only loaded in Capacitor builds (see quasar.config.js).
 *
 * Listens for NFC tag scans via the custom NfcPlugin Capacitor bridge.
 * Parsed payment data is emitted on EventBus as 'deep-link' —
 * the same event that deep-links.js uses — so Wallet.vue picks it up
 * via onPaymentDetected() without any additional wiring.
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

    // Reuse the deep-link event → Wallet.vue handles it automatically
    const currentPath = router.currentRoute.value?.path
    if (currentPath === '/wallet') {
      EventBus.emit('deep-link', paymentData)
    } else {
      router.push('/wallet').then(() => {
        setTimeout(() => {
          EventBus.emit('deep-link', paymentData)
        }, 300)
      })
    }
  })

  // Inform user if NFC is disabled on device
  const available = await isNfcAvailable()
  if (!available) {
    console.log('[nfc] NFC not available or disabled on this device')
  }
})
