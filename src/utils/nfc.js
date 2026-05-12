import { registerPlugin, Capacitor } from '@capacitor/core'

/**
 * NFC utility — wraps the custom NfcPlugin Capacitor bridge.
 *
 * Only active on Android (Capacitor native).
 * On web/PWA this module is a no-op.
 *
 * Events:
 *   - 'nfcTag'   { raw: string }      — NDEF text/URI from scanned tag
 *   - 'nfcError' { message: string }  — tag found but unreadable
 */

// Register the custom plugin (matches @CapacitorPlugin(name = "Nfc") in Java)
const NfcPlugin = registerPlugin('Nfc')

/**
 * Returns true if NFC is supported and enabled on this device.
 * Always returns false on web/PWA.
 */
export async function isNfcAvailable() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await NfcPlugin.isAvailable()
    return result.available && result.enabled
  } catch {
    return false
  }
}

/**
 * Opens Android NFC settings so the user can enable NFC.
 */
export async function openNfcSettings() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await NfcPlugin.showSettings()
  } catch (e) {
    console.warn('[nfc] Could not open NFC settings:', e)
  }
}

/**
 * Register a listener for NFC tag scans.
 *
 * The callback receives { raw: string } — the raw text or URI from the tag.
 * Returns an unsubscribe function.
 *
 * Recognized Lightning formats in `raw`:
 *   - LNURL bech32          → "LNURL1..."
 *   - lnurlw:// URL         → Bolt Card / LNURL-withdraw
 *   - lnurlp:// URL         → LNURL-pay
 *   - https:// URL          → may be an LNURL (check with parseLnurl)
 *   - lightning:...         → BOLT-11 invoice or Lightning address
 *   - user@domain.com       → Lightning address
 */
export function addNfcListener(callback) {
  if (!Capacitor.isNativePlatform()) return () => {}

  const handle = NfcPlugin.addListener('nfcTag', (data) => {
    if (data && data.raw) {
      callback(data.raw.trim())
    }
  })

  return () => {
    handle.remove()
  }
}

/**
 * Register a listener for NFC errors (tag found but unreadable/unsupported).
 * Returns an unsubscribe function.
 */
export function addNfcErrorListener(callback) {
  if (!Capacitor.isNativePlatform()) return () => {}

  const handle = NfcPlugin.addListener('nfcError', (data) => {
    callback(data?.message ?? 'Unknown NFC error')
  })

  return () => {
    handle.remove()
  }
}
