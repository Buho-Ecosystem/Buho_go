/**
 * Branta merchant verification (send side).
 *
 * Branta lets a wallet show the user WHO they are about to pay. When a
 * business registers its destination with Branta (via BTCPay Server,
 * Zaprite, Take My Sats, or a custom integration), a send-side lookup
 * returns the verified platform name and logo, which we surface on the
 * confirm sheets as a tappable "verified by Branta" badge before the user
 * sends.
 *
 * Read-only. No API key, no account, one network call. It is a
 * progressive enhancement, never a gate:
 *   - A miss (the destination was never posted to Branta) is the NORMAL
 *     case for most payments. It is not an error.
 *   - On a miss OR on any thrown error we resolve to null and the caller
 *     renders nothing. The payment flow never depends on this lookup and
 *     must never fail because of it.
 *
 * Pattern: this mirrors Blitz Wallet's docs-faithful integration
 * (github.com/BlitzWallet, app/functions/branta) and the official
 * "For Wallets" guide:
 *   - Always strict privacy mode.
 *   - getPaymentsByQrCode handles both BOLT11 and ZK on-chain
 *     (branta_id / branta_secret) payloads. We hand it the raw text.
 *   - Production guardrail (BuhoGO ships and tests live).
 *
 * Privacy: strict mode. For a BOLT11 invoice the SDK derives a key from
 * the invoice itself and AES-encrypts it client-side, so the raw invoice
 * is never transmitted. On-chain only resolves when the QR already
 * carries the ZK params, so a plain address is never sent either.
 *
 * Verifiable destination types in strict mode: BOLT11 invoices, and
 * on-chain addresses whose QR includes branta_id + branta_secret. Raw
 * Lightning Address / LNURL / Spark cannot be resolved in strict mode and
 * are not attempted (the caller gates this; Blitz does the same).
 */
import { BrantaServerBaseUrl } from '@branta-ops/branta'
import { BrantaService } from '@branta-ops/branta/v2'

/**
 * Defaults to the live production guardrail. A build can be pointed at
 * Branta's fully-siloed staging guardrail for QA by setting
 * localStorage 'branta_env' to 'staging' (staging only resolves Branta's
 * staging example destinations).
 */
function resolveBaseUrl() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('branta_env') === 'staging') {
      return BrantaServerBaseUrl.Staging
    }
  } catch {
    /* localStorage unavailable; fall through to production */
  }
  return BrantaServerBaseUrl.Production
}

// Built lazily so the SDK (and its first touch of Web Crypto) is only
// pulled in the first time a lookup actually runs, never at module load.
let service = null
function getService() {
  if (!service) {
    service = new BrantaService({ baseUrl: resolveBaseUrl(), privacy: 'strict' })
  }
  return service
}

const DEBUG = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('branta_debug') === '1'
  } catch {
    return false
  }
})()

function debug(...args) {
  if (DEBUG) console.log('[Branta]', ...args)
}

const isHttps = (value) => typeof value === 'string' && value.startsWith('https://')

// Small bounded per-session cache keyed by the exact lookup text, so a
// re-render or quick re-scan never issues a duplicate request and a repeat
// of a known miss resolves instantly to null.
const CACHE_LIMIT = 100
const cache = new Map()

function cacheGet(key) {
  return cache.has(key) ? cache.get(key) : undefined
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, value)
}

/**
 * Reduce a Branta PaymentsResult to the small shape the UI needs, or null
 * when there is nothing meaningful (or safe) to show. We keep only https
 * URLs, matching Blitz Wallet.
 */
function normalize(result) {
  if (!result || !Array.isArray(result.payments) || result.payments.length === 0) {
    return null
  }
  const payment = result.payments[0]
  const name = (payment.platform || '').trim()
  // A verification with no platform name has nothing to display.
  if (!name) return null
  return {
    name,
    // Branta serves a dark-background logo (platformLogoUrl) and an
    // optional light-background variant. The UI picks per theme.
    logoUrl: isHttps(payment.platformLogoUrl) ? payment.platformLogoUrl : '',
    logoLightUrl: isHttps(payment.platformLogoLightUrl) ? payment.platformLogoLightUrl : '',
    description: (payment.description || '').trim(),
    verifyUrl: isHttps(result.verifyUrl) ? result.verifyUrl : '',
  }
}

/**
 * Verify a payment destination with Branta.
 *
 * @param {object} params
 * @param {string} params.qrText  the raw destination text to verify: a
 *                                 BOLT11 invoice (with or without a
 *                                 `lightning:` prefix) or a `bitcoin:` URI
 *                                 carrying branta_id + branta_secret.
 * @param {AbortSignal} [params.signal]  cancels the in-flight request when
 *                                        a newer payment supersedes it.
 * @returns {Promise<{name:string, logoUrl:string, logoLightUrl:string,
 *                     description:string, verifyUrl:string} | null>}
 *          The verification on a match, or null on a miss / any error.
 *          Never throws.
 */
export async function lookupBrantaVerification({ qrText, signal } = {}) {
  const value = (qrText || '').trim()
  if (!value) return null

  const cached = cacheGet(value)
  if (cached !== undefined) {
    debug('cache hit', value.slice(0, 24), '->', cached)
    return cached
  }

  try {
    const result = await getService().getPaymentsByQrCode(value, undefined, signal)
    const normalized = normalize(result)
    debug('lookup', value.slice(0, 24), '->', normalized)
    cacheSet(value, normalized)
    return normalized
  } catch (err) {
    // A miss is normal and a network/crypto/abort error must never surface
    // to the user or break the send. Swallow it and show nothing. Errors
    // are not cached so a transient failure can be retried next time.
    debug('lookup error (ignored)', err && err.message)
    return null
  }
}
