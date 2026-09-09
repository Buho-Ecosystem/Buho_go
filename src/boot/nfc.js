import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { addNfcListener, addNfcErrorListener, isNfcAvailable, consumePendingNfcScan } from '../utils/nfc'
import { parsePaymentDestination } from '../providers/WalletFactory'
import { triggerWalletStoreHydration } from '../utils/walletHydration'
import { redactPaymentInput } from '../utils/logRedaction'

/**
 * NFC boot plugin for Android.
 *
 * Only loaded in Capacitor builds (see quasar.config.js).
 *
 * Two delivery paths converge here, both ending in processNfcPayload():
 *
 *  - Foreground (push): MainActivity's reader mode emits "nfcTag" events
 *    through the NfcPlugin bridge while the app is visible.
 *  - Cold / backgrounded start (pull): a tag tapped while the app was closed
 *    reaches NfcDispatchActivity via Android's NDEF dispatch and is buffered
 *    natively. We drain that at-most-once buffer at boot for cold starts and
 *    on every app resume for taps that arrived while backgrounded.
 *
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
 *   - BIP21 → bitcoin:...?lightning=... (unified)
 *   - LUD-04 login → keyauth://
 */

export default boot(async ({ router }) => {
  if (!Capacitor.isNativePlatform()) return

  const { useWalletStore } = await import('../stores/wallet')
  const walletStore = useWalletStore()

  /**
   * Single processing pipeline for every NFC payload, regardless of how it
   * reached the app. `source` is 'reader' (foreground reader mode) or
   * 'system_dispatch' (cold/backgrounded start via NfcDispatchActivity).
   */
  const processNfcPayload = (raw, source) => {
    // Scheme + length only: raw payloads carry one-time card-authentication
    // parameters and must never reach logcat.
    console.log(`[nfc] Tag scanned (${source}):`, redactPaymentInput(raw))

    // The guards below read persisted state (kiosk mode, activeWallet). On a
    // cold start this runs before Wallet.vue has mounted and initialized the
    // store, so hydrate first — idempotent, synchronous prefix is enough.
    triggerWalletStoreHydration(walletStore)

    // Block while kiosk mode is locked
    if (walletStore.kioskEnabled && !walletStore.kioskOwnerAccess) {
      console.log('[nfc] Blocked — kiosk mode active')
      return
    }

    // Parse the raw tag content using the same logic as QR scanner & deep links
    let parsed = parsePaymentDestination(raw)

    // Bolt Cards often encode a plain https:// URL that resolves to a
    // LNURL-withdraw response. parsePaymentDestination() can't know this
    // without a network round-trip, so we forward https:// NFC tags as
    // type 'lnurl' — Wallet.vue's fetchLNURLInfo() will fetch and verify.
    if ((!parsed || !parsed.valid || parsed.type === 'unknown')
        && /^https?:\/\//i.test(raw)) {
      parsed = { type: 'lnurl', lnurl: raw, valid: true }
    }

    const EXPLAINED_UNPAYABLE = ['bolt12_offer', 'silent_payment']
    if (!parsed || (!parsed.valid && !EXPLAINED_UNPAYABLE.includes(parsed.type)) || parsed.type === 'unknown') {
      Notify.create({
        type: 'warning',
        icon: 'nfc',
        message: 'NFC tag not recognized',
        caption: 'Tag does not contain a Lightning payment',
        timeout: 3000
      })
      return
    }

    // A BOLT12 offer is a valid payment request that BuhoGO cannot pay yet.
    // Surface the same global explanation as QR/paste instead of calling it
    // an unreadable NFC tag or asking the user to configure a wallet.
    if (parsed.type === 'bolt12_offer') {
      walletStore.showUnsupportedBolt12Offer({ route: 'NFC tag' })
      return
    }
    if (parsed.type === 'silent_payment') {
      walletStore.showUnsupportedSilentPayment({ route: 'NFC tag' })
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
      data: parsed.invoice || parsed.offer || parsed.address || parsed.lnurl || raw,
      type: parsed.type,
      // BIP21 metadata rides along so a unified QR written to a tag can take
      // the native-rail shortcut in onPaymentDetected, same as a scan.
      ...(parsed.bip21 ? { bip21: parsed.bip21 } : {})
    }

    // Buffer on the store; Wallet.vue's watcher consumes it. Same channel as
    // deep-links.js, so the rest of the flow is shared.
    walletStore.pendingDeepLink = paymentData

    if (router.currentRoute.value?.path !== '/wallet') {
      router.push('/wallet').catch(() => { /* navigation rejection is non-fatal */ })
    }
  }

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

  // Foreground path: reader-mode taps while the app is visible
  addNfcListener((raw) => processNfcPayload(raw, 'reader'))

  // Cold/backgrounded path: drain the native one-shot buffer. Registering the
  // resume listener before the initial drain closes the gap where a scan
  // could arrive between the two.
  const drainPendingScan = async () => {
    const pending = await consumePendingNfcScan()
    if (pending?.raw) {
      processNfcPayload(pending.raw, pending.source)
    }
  }
  App.addListener('resume', drainPendingScan)
  await drainPendingScan()

  // Inform user if NFC is disabled on device
  const available = await isNfcAvailable()
  if (!available) {
    console.log('[nfc] NFC not available or disabled on this device')
  }
})
