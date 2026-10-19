/**
 * Branta merchant verification (send side).
 *
 * Branta tells a wallet WHO it is about to pay. A business registers its
 * payment destinations with Branta (via BTCPay Server, Zaprite, Take My Sats
 * or a custom integration); before sending, the wallet looks the destination
 * up and gets the business's name, logo and a verification page.
 *
 * Read-only: no API key, no account, one request per payment. A miss is the
 * normal case and is never shown. The one answer that does reach the person
 * is a CHANGED code: an on-chain code whose visible address is not the one
 * the business registered (SDK `BrantaPaymentException`, reason `tampered`).
 * Branta asks wallets to treat that as a hard stop.
 *
 * Privacy is strict. The SDK hashes an invoice or Ark address and encrypts
 * it client-side, so the raw destination never leaves the phone; an
 * on-chain code is only looked up when it already carries Branta's key
 * (`branta_id` + `branta_secret`). Lightning addresses, LNURL, BOLT12, Spark
 * and plain on-chain addresses cannot be checked in strict mode and are not
 * attempted.
 *
 * Debugging: localStorage `branta_debug` = '1' logs lookups; `branta_env` =
 * 'staging' points at Branta's staging service (it only knows Branta's
 * example destinations). Both are read once, at the first lookup.
 */
import { BrantaServerBaseUrl, BrantaPaymentExceptionReason } from '@branta-ops/branta'
import { BrantaService } from '@branta-ops/branta/v2'

export const BRANTA_STATUS = Object.freeze({
  CHECKING: 'checking',
  VERIFIED: 'verified',
  TAMPERED: 'tampered',
  NONE: 'none',
})

/** How long the confirm sheet waits for an answer before it settles without one. */
export const BRANTA_HOLD_MS = 1500

/** Upper bound for a lookup. Past the hold, only a changed code still matters. */
export const BRANTA_LOOKUP_TIMEOUT_MS = 8000

/** Behind a logo made for dark backgrounds, when that is the only one. */
const DARK_PLATE = '#1A1A1C'

const BOLT11_PREFIX = /^ln(bc|tb|bcrt)/i
const ARK_PREFIX = /^ark1/i

function readLocalFlag(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

let service = null
let debugEnabled = null

// Built on first use, so the SDK and its first touch of Web Crypto stay out
// of app start.
function defaultService() {
  if (!service) {
    const baseUrl = readLocalFlag('branta_env') === 'staging'
      ? BrantaServerBaseUrl.Staging
      : BrantaServerBaseUrl.Production
    service = new BrantaService({ baseUrl, privacy: 'strict' })
  }
  return service
}

function debug(...args) {
  if (debugEnabled === null) debugEnabled = readLocalFlag('branta_debug') === '1'
  if (debugEnabled) console.log('[Branta]', ...args)
}

const isHttps = (value) => typeof value === 'string' && value.startsWith('https://')

/** Query parameters of a `bitcoin:` / `lightning:` URI, keys lowercased; null when it is no URI. */
function uriParams(raw) {
  if (typeof raw !== 'string' || !raw.includes(':')) return null
  try {
    const params = new URL(raw.trim()).searchParams
    const out = new Map()
    for (const [key, value] of params) {
      const lower = key.toLowerCase()
      if (!out.has(lower)) out.set(lower, value)
    }
    return out
  } catch {
    return null
  }
}

/**
 * True when a code carries both of Branta's key parameters, the only way an
 * on-chain destination can be checked. Keys match case-insensitively, as the
 * SDK's own parser lowercases them.
 */
export function hasBrantaParams(raw) {
  const params = uriParams(raw)
  return !!params && params.has('branta_id') && params.has('branta_secret')
}

/**
 * What to hand Branta for a payment, or null when nothing in it can be
 * checked.
 *
 *   - A code with Branta's key: the whole code. The SDK then checks every
 *     part of it and notices when the visible address was changed.
 *   - Otherwise the destination BuhoGO pays, when it is an invoice or an
 *     Ark address. Never another part of a unified code: without Branta's
 *     key nothing ties the parts together, so a verified invoice says
 *     nothing about the Ark or Spark address paid instead.
 *
 * @param {object} payment  the pending payment (type, invoice, data, rawInput, arkadeAddress)
 * @returns {string|null}
 */
export function brantaLookupText(payment) {
  if (!payment) return null
  const raw = typeof payment.rawInput === 'string' ? payment.rawInput.trim() : ''
  if (hasBrantaParams(raw)) return raw

  if (payment.type === 'lightning_invoice') {
    const invoice = String(payment.invoice || payment.data || '').replace(/^lightning:/i, '').trim()
    if (BOLT11_PREFIX.test(invoice)) return invoice
  }
  if (payment.type === 'arkade_address') {
    const address = String(payment.arkadeAddress || payment.data || '').trim()
    if (ARK_PREFIX.test(address)) return address
  }
  return null
}

/**
 * The avatar for a verified business: Branta's logo for light backgrounds
 * on BuhoGO's white plate, or its dark-background logo on a dark plate when
 * that is the only one. Null without a logo.
 *
 * @param {{logoUrl?:string, logoLightUrl?:string}} verification
 * @returns {{url:string, background:string}|null}
 */
export function brantaAvatar(verification) {
  if (verification?.logoLightUrl) return { url: verification.logoLightUrl, background: '' }
  if (verification?.logoUrl) return { url: verification.logoUrl, background: DARK_PLATE }
  return null
}

/**
 * Reduce Branta's answer to what BuhoGO shows and keeps, or null when there
 * is no payment in it. Only https links survive.
 */
export function normalizeBrantaResult(result) {
  const payment = Array.isArray(result?.payments) ? result.payments[0] : null
  if (!payment) return null
  const verification = {
    name: String(payment.platform || '').trim(),
    // Branta's platformLogoUrl is drawn for dark backgrounds, the light
    // variant for light ones; brantaAvatar picks.
    logoUrl: isHttps(payment.platformLogoUrl) ? payment.platformLogoUrl : '',
    logoLightUrl: isHttps(payment.platformLogoLightUrl) ? payment.platformLogoLightUrl : '',
    description: String(payment.description || '').trim(),
    verifyUrl: isHttps(result.verifyUrl) ? result.verifyUrl : '',
  }
  // A payment without a name, a logo or a page gives nothing to show.
  if (!verification.name && !verification.logoUrl && !verification.logoLightUrl && !verification.verifyUrl) {
    return null
  }
  return verification
}

// Per-session answers by lookup text, so a re-scan costs nothing. A changed
// code and an error are never cached: the next look asks again.
const CACHE_LIMIT = 100
const cache = new Map()

function remember(key, answer) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
  cache.set(key, answer)
}

/**
 * Ask Branta about a payment destination. Never throws.
 *
 * @param {object} params
 * @param {string} params.qrText  what brantaLookupText returned
 * @param {AbortSignal} [params.signal]
 * @param {object} [params.service]  a BrantaService; tests pass a stand-in
 * @returns {Promise<{status:'verified', verification:object}|{status:'tampered'}|{status:'none'}>}
 */
export async function checkWithBranta({ qrText, signal, service: injected } = {}) {
  const value = (qrText || '').trim()
  if (!value) return { status: BRANTA_STATUS.NONE }

  const cached = cache.get(value)
  if (cached) return cached

  try {
    const result = await (injected || defaultService()).getPaymentsByQrCode(value, undefined, signal)
    const verification = normalizeBrantaResult(result)
    const answer = verification
      ? { status: BRANTA_STATUS.VERIFIED, verification }
      : { status: BRANTA_STATUS.NONE }
    debug('lookup', value.slice(0, 24), '->', answer.status)
    remember(value, answer)
    return answer
  } catch (error) {
    if (error?.reason === BrantaPaymentExceptionReason.Tampered) {
      debug('changed code', value.slice(0, 24))
      return { status: BRANTA_STATUS.TAMPERED }
    }
    // Offline, aborted, no Web Crypto: as good as no answer.
    debug('lookup failed (ignored)', error?.message)
    return { status: BRANTA_STATUS.NONE }
  }
}

/** Forget cached answers (tests). */
export function clearBrantaCache() {
  cache.clear()
}
