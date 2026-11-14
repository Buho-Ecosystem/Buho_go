/** Public, read-only merchant checks. No destination/proof is logged or exported. */
import { BrantaService } from '@branta-ops/branta'

export const BRANTA_STATUS = Object.freeze({ CHECKING: 'checking', VERIFIED: 'verified', TAMPERED: 'tampered', NONE: 'none' })
export const BRANTA_HOLD_MS = 2000
export const BRANTA_LOOKUP_TIMEOUT_MS = 10000
export const BRANTA_MAX_AGE_MS = 60000
export const BRANTA_SDK_VERSION = '4.3.0'
export const BRANTA_ORIGINS = Object.freeze({ Production: 'https://guardrail.branta.pro', Staging: 'https://staging.guardrail.branta.pro' })
export function resolveBrantaEnvironment(env = {}) {
  return env.DEV === true && env.VITE_BRANTA_ENVIRONMENT === 'Staging' ? 'Staging' : 'Production'
}
export const BRANTA_ENVIRONMENT = resolveBrantaEnvironment({ DEV: import.meta.env?.DEV, VITE_BRANTA_ENVIRONMENT: import.meta.env?.VITE_BRANTA_ENVIRONMENT })
const PROOF = new Set(['branta_id', 'branta_secret'])
const cleanText = value => typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 400) : ''

function uriParams(raw) {
  if (typeof raw !== 'string' || !/^(bitcoin|lightning|ark):/i.test(raw)) return null
  const question = raw.indexOf('?')
  return question < 0 ? new URLSearchParams() : new URLSearchParams(raw.slice(question + 1))
}
export function hasBrantaParams(raw) {
  const params = uriParams(raw)
  if (!params) return false
  const keys = new Set([...params.keys()].map(key => key.toLowerCase()))
  return [...PROOF].every(key => keys.has(key))
}
/** Keep encoded proof keys and case-sensitive proof values intact for the SDK. */
export function invalidBrantaInput(raw) {
  if (typeof raw !== 'string' || raw.length > 16384 || /[\u0000-\u001f\u007f]/.test(raw)) return true
  const params = uriParams(raw)
  if (!params || ![...params.keys()].some(key => PROOF.has(key.toLowerCase()))) return false
  const seen = new Set()
  for (const key of params.keys()) {
    const lower = key.toLowerCase()
    if (seen.has(lower) && (PROOF.has(lower) || ['amount', 'lightning', 'spark', 'ark', 'address'].includes(lower))) return true
    seen.add(lower)
  }
  return false
}
export function brantaLookupText(payment) {
  if (!payment) return null
  const raw = typeof payment.rawInput === 'string' ? payment.rawInput.trim() : ''
  if (hasBrantaParams(raw)) return raw
  const invoice = String(payment.invoice || (payment.type === 'lightning_invoice' ? payment.data : '') || '').replace(/^lightning:/i, '').trim()
  if (/^ln(bc|tb|bcrt)/i.test(invoice)) return invoice
  const ark = String(payment.arkadeAddress || (payment.type === 'arkade_address' ? payment.data : '') || '').trim()
  return /^ark1/i.test(ark) ? ark : null
}

/** HTTPS, exact configured Branta origin, credentials forbidden. Fragments stay device-local. */
export function safeBrantaUrl(value, environment = BRANTA_ENVIRONMENT, { record = false } = {}) {
  if (typeof value !== 'string' || value.length > 8192) return ''
  try {
    const url = new URL(value)
    if (url.origin !== BRANTA_ORIGINS[environment] || url.username || url.password) return ''
    if (record && !/^\/v\d+\/verify\/[^/]+\/?$/.test(url.pathname)) return ''
    return url.href
  } catch { return '' }
}
export function brantaAvatar(verification) {
  const environment = verification?.environment || 'Production'
  const light = safeBrantaUrl(verification?.logoLightUrl, environment)
  const dark = safeBrantaUrl(verification?.logoUrl, environment)
  return light ? { url: light, background: '' } : dark ? { url: dark, background: '#1A1A1C' } : null
}
export function sameBrantaDestination(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  // Bech32 and BOLT11 may be case folded; base58 and proof-bearing requests may not.
  return /^(?:bc1|tb1|bcrt1|lnbc|lntb|lnbcrt|ark1|spark1|sparkt1)/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b
}
export function matchesBrantaDestination(destination, target) {
  if (!target || destination?.isEncrypted !== false || !sameBrantaDestination(destination.value, target.value)) return false
  const types = { bitcoin: 'bitcoin_address', lightning: 'bolt11', arkade: 'ark_address', sparkAddress: 'spark_address', sparkInvoice: 'spark_invoice' }
  return !!types[target.kind] && destination.type === types[target.kind]
}
function recordExpiry(payment) {
  // Missing TTL and explicit zero mean no expiry. The SDK coerces raw API
  // values with Number(), so a provided NaN/negative value is not absence.
  if (payment.ttl === undefined || payment.ttl === 0) return null
  if (typeof payment.ttl !== 'number' || !Number.isFinite(payment.ttl) || payment.ttl < 0) return undefined
  const date = payment.createdDate
  const parts = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(date)
  if (!parts) return undefined
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] = parts.slice(1).map(value => Number(value ?? 0))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) return undefined
  const createdAt = Date.parse(date)
  const expiry = createdAt + payment.ttl * 1000
  return Number.isFinite(createdAt) && Number.isSafeInteger(expiry) && Math.abs(expiry) <= 8640000000000000 ? expiry : undefined
}

/** Identity is owned by the payment containing the exact decrypted matched destination. */
export function normalizeBrantaResult(result, target, { environment = BRANTA_ENVIRONMENT, now = Date.now(), checkedAt = now } = {}) {
  if (result?.status !== 'match') return null
  const matched = (Array.isArray(result.matchedDestinations) ? result.matchedDestinations : []).filter(destination => matchesBrantaDestination(destination, target))
  if (!matched.length) return null
  const owners = (Array.isArray(result.payments) ? result.payments : []).filter(payment => Array.isArray(payment?.destinations) && payment.destinations.some(destination =>
    destination.isEncrypted === false && matched.some(bound => destination.type === bound.type && sameBrantaDestination(destination.value, bound.value))))
  const candidates = owners.map(payment => {
    const child = cleanText(payment.childPlatform?.name)
    const name = child || cleanText(payment.platform)
    const logo = child ? payment.childPlatform : { logoUrl: payment.platformLogoUrl, logoLightUrl: payment.platformLogoLightUrl }
    const expiresAt = recordExpiry(payment)
    if (expiresAt === undefined) return null
    return { name, logoUrl: safeBrantaUrl(logo?.logoUrl, environment), logoLightUrl: safeBrantaUrl(logo?.logoLightUrl, environment), description: cleanText(payment.description), expiresAt }
  })
  if (candidates.some(candidate => candidate === null)) return null
  const live = candidates.filter(candidate => candidate.name && (candidate.expiresAt === null || candidate.expiresAt > now))
  if (!live.length || new Set(live.map(candidate => JSON.stringify(candidate))).size !== 1) return null
  return Object.freeze({
    ...live[0], version: 1, checkedAt, environment, sdkVersion: BRANTA_SDK_VERSION,
    verifyUrl: safeBrantaUrl(result.verifyUrl, environment, { record: true }),
    destination: Object.freeze({ kind: target.kind, value: target.value }), matchedType: matched[0].type,
  })
}
export function brantaIdentityKey(verification) {
  return verification ? JSON.stringify([verification.name, verification.logoUrl, verification.logoLightUrl, verification.destination?.kind, verification.destination?.value]) : ''
}
export function freezeBrantaReceipt(verification) {
  return verification ? Object.freeze({ ...verification, destination: Object.freeze({ ...verification.destination }) }) : null
}

const services = new Map()
const cache = new Map()
/** SDK4.3 returns match/unknown/tampered/incomplete; transport errors are ordinary unavailable checks. */
export async function checkWithBranta({ qrText, signal, service: injected, environment = BRANTA_ENVIRONMENT, now = Date.now, fresh = false } = {}) {
  const value = typeof qrText === 'string' ? qrText.trim() : ''
  if (!value) return { status: 'unknown' }
  if (invalidBrantaInput(value)) return { status: 'tampered' }
  if (signal?.aborted) return { status: 'unknown' }
  const key = `${environment}:${value}`
  const cached = cache.get(key)
  if (!fresh && cached && now() - cached.at < BRANTA_MAX_AGE_MS) return cached.result
  try {
    if (!injected && !services.has(environment)) services.set(environment, new BrantaService({ environment }))
    const client = injected || services.get(environment)
    const result = await client.verify(value, undefined, signal)
    if (signal?.aborted) return { status: 'unknown' }
    if (!['match', 'unknown', 'tampered', 'incomplete'].includes(result?.status)) return { status: 'unknown' }
    if (result.status === 'match' || result.status === 'unknown') {
      if (cache.size >= 100) cache.delete(cache.keys().next().value)
      const checkedAt = now()
      const checked = { ...result, checkedAt }
      cache.set(key, { result: checked, at: checkedAt })
      return checked
    }
    return result
  } catch { return { status: 'unknown' } }
}
export function clearBrantaCache() { cache.clear(); services.clear() }
