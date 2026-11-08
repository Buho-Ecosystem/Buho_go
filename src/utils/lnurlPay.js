/**
 * LNURL-pay (LUD-06, LUD-16): the one request path every send uses.
 *
 * Two steps, the same everywhere:
 *   1. fetchPayRequest    asks the service for its pay request (limits,
 *                         callback, metadata) and checks it.
 *   2. requestPayInvoice  asks the callback for an invoice and checks that
 *                         it is for the amount asked.
 *
 * Every send (the Send sheet on each wallet type, batch send, Auto-Transfer)
 * goes through here, so a rule fixed once holds on every path:
 *   - A service's own refusal (`status: "ERROR"`) wins over the HTTP status.
 *     Some services send their reason with a 500, and it is the only text
 *     that says what went wrong.
 *   - The callback is https (or http to a .onion host), carries no
 *     credentials or fragment, and does not already set what the wallet adds.
 *   - The invoice must be for the amount the person confirmed (LUD-06), so a
 *     service cannot charge more than was shown. In the recipient's currency
 *     (LUD-21) the service adds its fee to the estimate the person saw, so
 *     the invoice may be above it, but only by PAYOUT_FEE_ALLOWANCE_PERCENT.
 *   - The invoice must be for this pay request: one whose description hash
 *     names other metadata is refused (LUD-06), as it was made for another
 *     payment. One with a plain description instead is accepted; payout
 *     services send those, and nothing in it can be checked.
 *   - An invoice that had long expired when it arrived is refused.
 *   - The callback is asked without following redirects off its host, so the
 *     amount and the note reach the host that was checked, and no other. A
 *     redirect that stays on that host (a moved path) is followed, twice at
 *     most, where the phone can see where it points.
 *
 * Errors carry a `code` from PAY_REQUEST_ERROR, except a refusal with the
 * service's own reason: that one is marked as the service's words
 * (utils/errorOrigin.js) and keeps them as its message.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { lnurlGetJson } from './lnurlHttp.js'
import { ONION_HOST_RE } from './addressUtils.js'
import { counterpartyError } from './errorOrigin.js'
import { parseLightningInvoice } from './lightningInvoice.js'
import { parseSuccessAction } from './successAction.js'
import { validateVerifyUrl } from './lnurlVerify.js'

/** Why a pay request could not be used: the `code` on the thrown Error. */
export const PAY_REQUEST_ERROR = Object.freeze({
  /** The service answered with an HTTP error and no reason of its own. */
  HTTP: 'LNURL_HTTP_ERROR',
  /** The callback redirected off its host, or where it pointed cannot be seen. */
  REDIRECTED: 'LNURL_REDIRECTED',
  /** The service declined (`status: "ERROR"`) without saying why. */
  REFUSED: 'LNURL_REFUSED',
  /** The link answered, but not with a pay request. */
  NOT_PAY_REQUEST: 'LNURL_NOT_PAY_REQUEST',
  /** The pay request cannot be used: its callback or its limits. */
  INVALID: 'LNURL_PAY_REQUEST_INVALID',
  /** The amount is outside what the service accepts. */
  AMOUNT_OUT_OF_RANGE: 'LNURL_AMOUNT_OUT_OF_RANGE',
  /** A payout in a currency the service does not offer (any more). */
  CURRENCY_UNAVAILABLE: 'LNURL_CURRENCY_UNAVAILABLE',
  /** No invoice came back, or one that cannot be read or has no amount. */
  INVOICE_MISSING: 'LNURL_INVOICE_MISSING',
  /** The invoice is for another amount than the one asked for. */
  INVOICE_MISMATCH: 'LNURL_INVOICE_MISMATCH',
  /** The invoice's description hash names another pay request's metadata. */
  INVOICE_NOT_FOR_REQUEST: 'LNURL_INVOICE_NOT_FOR_REQUEST',
  /** The invoice had expired long before it arrived. */
  INVOICE_EXPIRED: 'LNURL_INVOICE_EXPIRED',
})

// Limits a service leaves out (or sends as 0), as every path has always assumed.
const DEFAULT_MIN_MSAT = 1000
const DEFAULT_MAX_MSAT = 100000000000

/**
 * How far above the confirmed estimate an invoice in the recipient's currency
 * may go: the service's fee, and any change in its rate since the estimate.
 * The payout services seen so far add about 2 to 3 per cent. A few sats more
 * cover rounding and a minimum fee on small amounts. Anything beyond is not
 * what the person agreed to, and nothing is paid.
 */
export const PAYOUT_FEE_ALLOWANCE_PERCENT = 10
const PAYOUT_ROUNDING_SATS = 10

/**
 * How long past its expiry a fresh invoice is still handed to the wallet.
 * Expiry is judged by the service's own clock (its Date header) when the
 * phone can read it, and by the phone's clock otherwise. Some services make
 * invoices that live a minute, and a phone's clock can be off by more than
 * that: refusing on it alone would stop payments that go through. The wallet
 * still refuses an invoice that has truly expired. One older than this is
 * stale, not a clock that is a little off.
 */
const EXPIRY_CLOCK_GRACE_SECONDS = 600

// Redirects the callback may make on its own host before it is refused.
const MAX_SAME_HOST_REDIRECTS = 2

// Query parameters the wallet adds to the callback (LUD-06, LUD-12, LUD-18,
// LUD-21). One already in the callback, in any case, would give the service
// two values.
const WALLET_PARAMS = ['amount', 'comment', 'currency', 'payerdata']

// A Lightning address name as it may appear in a URL path: unreserved
// characters, a few sub-delimiters, and percent-escapes. `/ ? # @ :` and
// spaces are not allowed, so a name can never reach another path or host.
// Percent-escapes stay as given: a till code arrives encoded once and must
// not be encoded again. Decoded, the name may hold a `/` (till codes do), but
// no `.` or `..` segment, backslash or control character, in case the
// service decodes it before routing.
const ADDRESS_NAME = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=]|%[0-9A-Fa-f]{2})+$/
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/
// Names that only mean something inside a home or office network, never a
// public service (RFC 6761, RFC 6762, ICANN's .internal).
const LOCAL_TLDS = new Set(['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'arpa', 'invalid'])

// What a service may offer as its currency (LUD-21): a short code, and the
// decimals a display can show.
const CURRENCY_CODE = /^[A-Za-z0-9]{1,12}$/
const MAX_CURRENCY_DECIMALS = 8

function payRequestError(code, message, details = {}) {
  return Object.assign(new Error(message), { code }, details)
}

/** The service's refusal: its own reason when it gave one, else ours. */
function refusal(reason) {
  const error = counterpartyError(reason, 'The service declined without giving a reason')
  if (!error.origin) error.code = PAY_REQUEST_ERROR.REFUSED
  return error
}

/**
 * The service's JSON answer. A LUD-06 refusal is read before the HTTP status,
 * because it carries the reason. Transport failures (offline, timeout) are
 * the transport's own errors and pass through untouched.
 */
function serviceAnswer(response) {
  const data = response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null
  if (data?.status === 'ERROR') throw refusal(data.reason)
  if (!response?.ok) {
    const status = Number(response?.status) || 0
    throw payRequestError(PAY_REQUEST_ERROR.HTTP, `Server returned ${status}`, { status })
  }
  return data
}

/**
 * The text of `comment` that fits `allowed` (LUD-12), cut between characters
 * so an emoji is never split: half of one cannot be put in a URL. Fits both
 * ways a service may count, by character or by UTF-16 unit. A stray half of
 * an emoji already in the text (pasted, or from a request's note) is left out
 * for the same reason.
 */
export function fitComment(comment, allowed) {
  const limit = Number.isSafeInteger(allowed) && allowed > 0 ? allowed : 0
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (!limit || !text) return ''
  let fitted = ''
  for (const character of text) {
    const point = character.codePointAt(0)
    if (point >= 0xd800 && point <= 0xdfff) continue
    if (fitted.length + character.length > limit) break
    fitted += character
  }
  return fitted.trim()
}

/**
 * Build an LNURL-pay callback URL for requesting the invoice.
 *
 * Supports both amount forms:
 *   - Option B (default): amount in millisats (standard LNURL-pay).
 *   - Option A (LUD-21 currency extension #207): when `payout` is given, the
 *     amount is requested in the recipient's own currency so they receive
 *     exactly that (provider fee added on top).
 *
 * The parameters are appended to the callback as given. requestPayInvoice
 * gives the callback as parsed when it was checked, so the URL requested is
 * the URL checked; its query keeps the service's own encoding. Checks belong
 * to requestPayInvoice, which is the only caller that should send it.
 *
 * @param {object} args
 * @param {string} args.callback      the LNURL-pay callback URL
 * @param {number} [args.amountSats]  amount in sats (Option B)
 * @param {{code:string, amount:number}|null} [args.payout]  local-currency request (Option A)
 * @param {string} [args.comment]     optional LUD-12 comment
 * @param {number} [args.commentAllowed]  max comment length the endpoint accepts
 * @returns {string} the fully-built callback URL
 */
export function buildLnurlPayCallbackUrl({ callback, amountSats, payout = null, comment = '', commentAllowed = 0 }) {
  const sep = callback.includes('?') ? '&' : '?'
  let url
  if (payout && payout.code && payout.amount > 0) {
    url = `${callback}${sep}amount=${payout.amount}&currency=${encodeURIComponent(payout.code)}`
  } else {
    url = `${callback}${sep}amount=${amountSats * 1000}`
  }
  const note = fitComment(comment, commentAllowed)
  if (note) {
    url += `&comment=${encodeURIComponent(note)}`
  }
  return url
}

/**
 * LUD-11 — may we keep the link this invoice came from?
 *
 * A payRequest callback can answer `disposable: false` to say its LNURL is
 * reusable: the service intends the link to be stored and paid again without
 * a new QR. Anything else — absent, null, or an explicit true — means
 * single-use, which is what every link was before the field existed and is
 * the only safe default (storing a one-shot link would offer the user a
 * "Pay again" that can only fail).
 *
 * Only the invoice callback (the response returning `pr`) is authoritative.
 * Earlier payRequest metadata must not override its disposable decision.
 *
 * @param {object|null|undefined} response  the invoice callback response
 * @returns {boolean}
 */
export function isStoreablePayLink(response) {
  return response?.disposable === false
}

/** A Lightning address name that stays one path segment of the service it names. */
function isAddressName(name) {
  if (!ADDRESS_NAME.test(name)) return false
  let decoded
  try {
    decoded = decodeURIComponent(name)
  } catch {
    return false
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return false
  return decoded.split('/').every((segment) => segment !== '.' && segment !== '..')
}

/**
 * The LUD-16 pay request URL of a Lightning address, or null when the text
 * cannot be one. The name goes into the path exactly as given (see
 * ADDRESS_NAME); the domain must be a public hostname, so nothing in the
 * address can point the request at another host, port or path.
 */
export function lightningAddressUrl(address) {
  if (typeof address !== 'string') return null
  const text = address.trim()
  const at = text.lastIndexOf('@')
  if (at < 1) return null
  const name = text.slice(0, at)
  const domain = text.slice(at + 1).toLowerCase()
  if (!isAddressName(name) || !HOSTNAME.test(domain) || LOCAL_TLDS.has(domain.slice(domain.lastIndexOf('.') + 1))) {
    return null
  }
  return `https://${domain}/.well-known/lnurlp/${name}`
}

/** A whole, positive number sent as a number or as digits, else NaN. */
function wholeNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value)
  return NaN
}

/**
 * A millisat limit as sent, the default when left out, or null when unusable.
 * A maximum too large to hold exactly (some services send 21 million bitcoin,
 * or a 64-bit maximum, to mean "no limit") is read as the largest one that is.
 */
function msatLimit(value, fallback, { isMax = false } = {}) {
  if (value === undefined || value === null || value === 0 || value === '') return fallback
  const msat = wholeNumber(value)
  if (isMax && Number.isFinite(msat) && msat > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return Number.isSafeInteger(msat) && msat >= 1 ? msat : null
}

/**
 * A URL the wallet may call: https, or http to a Tor onion host (LUD-01),
 * with no credentials. Null otherwise.
 */
function serviceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ONION_HOST_RE.test(url.hostname))) return null
  if (url.username || url.password) return null
  return url
}

/**
 * The callback, as parsed: what is checked here is exactly what is requested
 * later, whatever parser the transport uses.
 */
function checkedCallback(value) {
  const url = serviceUrl(value)
  // A fragment would swallow everything appended after it, and a parameter
  // the wallet adds would reach the service twice.
  const setsOurs = url && [...url.searchParams.keys()].some((name) => WALLET_PARAMS.includes(name.toLowerCase()))
  if (!url || value.includes('#') || setsOurs) {
    throw payRequestError(PAY_REQUEST_ERROR.INVALID, 'The pay request has an unusable callback')
  }
  return url.href
}

/**
 * The currency a service offers to be paid in (LUD-21), or null when it offers
 * none or describes it in a way that cannot be shown or asked for. Then the
 * person simply pays in Bitcoin. Fields this does not check are kept.
 */
function currencyOffer(currency) {
  if (!currency || typeof currency !== 'object' || Array.isArray(currency)) return null
  const code = typeof currency.code === 'string' ? currency.code.trim() : ''
  const multiplier = typeof currency.multiplier === 'string' && currency.multiplier.trim()
    ? Number(currency.multiplier)
    : currency.multiplier
  const decimals = currency.decimals === undefined || currency.decimals === null ? 0 : wholeNumber(currency.decimals)
  if (!CURRENCY_CODE.test(code) || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0
      || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_CURRENCY_DECIMALS) {
    return null
  }
  const symbol = typeof currency.symbol === 'string' ? currency.symbol.trim() : ''
  const offer = { ...currency, code, multiplier, decimals, symbol: /^\S{1,8}$/u.test(symbol) ? symbol : code }
  // Local-currency limits, when given, are amounts the sheet compares with.
  for (const limit of ['minSendable', 'maxSendable']) {
    if (offer[limit] === undefined) continue
    const value = Number(offer[limit])
    if (offer[limit] === null || !Number.isFinite(value) || value < 0) delete offer[limit]
    else offer[limit] = value
  }
  return offer
}

/**
 * The terms of a pay request: its callback, millisat limits, comment length
 * and the currency it offers, checked. Used again at payment time, since the
 * terms may have been kept since they were read.
 * @throws {Error} code PAY_REQUEST_ERROR.INVALID
 */
function payTerms(payRequest) {
  const callback = checkedCallback(payRequest?.callback)
  const minSendable = msatLimit(payRequest.minSendable, DEFAULT_MIN_MSAT)
  const maxSendable = msatLimit(payRequest.maxSendable, DEFAULT_MAX_MSAT, { isMax: true })
  // Amounts are sent in whole sats, so the range must hold at least one.
  if (minSendable === null || maxSendable === null || minSendable > maxSendable
      || Math.ceil(minSendable / 1000) > Math.floor(maxSendable / 1000)) {
    throw payRequestError(PAY_REQUEST_ERROR.INVALID, 'The pay request has unusable amount limits')
  }
  const allowed = wholeNumber(payRequest.commentAllowed)
  const commentAllowed = Number.isSafeInteger(allowed) && allowed > 0 ? allowed : 0
  return { callback, minSendable, maxSendable, commentAllowed, currency: currencyOffer(payRequest.currency) }
}

/**
 * Check a service's answer to the first request and return it with its
 * terms normalised (`currency` is null when none can be used). Unknown
 * fields (metadata, LUD-18 `payerData`, ...) are kept for the caller.
 * @param {object|null} data  the decoded JSON answer
 * @throws {Error} a refusal, or code NOT_PAY_REQUEST or INVALID
 */
export function readPayRequest(data) {
  if (data?.status === 'ERROR') throw refusal(data.reason)
  if (!data || typeof data !== 'object' || data.tag !== 'payRequest') {
    throw payRequestError(PAY_REQUEST_ERROR.NOT_PAY_REQUEST, 'The link is not a pay request')
  }
  return { ...data, ...payTerms(data) }
}

/**
 * First step: the service's pay request.
 * @param {string} url  the decoded LNURL, or lightningAddressUrl(address)
 * @param {{ get?: Function, timeoutMs?: number, signal?: AbortSignal }} [options]
 *   `get` defaults to the LNURL transport (utils/lnurlHttp.js)
 * @returns {Promise<object>} see readPayRequest
 * @throws {Error} a transport failure, a refusal, or a PAY_REQUEST_ERROR code
 */
export async function fetchPayRequest(url, { get = lnurlGetJson, timeoutMs, signal } = {}) {
  const target = serviceUrl(url)
  if (!target) throw new Error('Invalid LNURL')
  return readPayRequest(serviceAnswer(await get(target.href, { timeoutMs, signal })))
}

/** A payout in the recipient's currency the service offers, or null for sats. */
function currencyPayout(payout, offer) {
  if (payout === null || payout === undefined) return null
  const code = typeof payout.code === 'string' ? payout.code.trim() : ''
  const amount = typeof payout.amount === 'number' ? payout.amount : NaN
  // Plain decimal notation only: the amount goes into the URL as written.
  if (!CURRENCY_CODE.test(code) || !(amount > 0) || !/^\d+(?:\.\d+)?$/.test(String(amount))) {
    throw new Error('Invalid amount')
  }
  if (!offer || offer.code.toUpperCase() !== code.toUpperCase()) {
    throw payRequestError(PAY_REQUEST_ERROR.CURRENCY_UNAVAILABLE, `The service does not offer ${code}`, { currency: code })
  }
  return { code: offer.code, amount }
}

/**
 * What to ask a link for when the person confirmed `confirmedSats` without
 * seeing the link's own terms (a batch row): a fixed-amount link's amount
 * when it is no more than that, else the confirmed amount, which
 * requestPayInvoice then refuses if the link does not accept it. A link never
 * takes more than was confirmed.
 * @param {object} payRequest  from fetchPayRequest
 * @param {number} confirmedSats
 * @returns {number}
 */
export function linkAmountSats(payRequest, confirmedSats) {
  const { minSendable, maxSendable } = payRequest
  const fixedSats = minSendable === maxSendable ? minSendable / 1000 : null
  return Number.isSafeInteger(fixedSats) && fixedSats > 0 && fixedSats <= confirmedSats ? fixedSats : confirmedSats
}

/** A whole number of sats the person confirmed, or an Error. */
function confirmedSats(amountSats) {
  const sats = typeof amountSats === 'number' || typeof amountSats === 'string' ? Number(amountSats) : NaN
  if (!Number.isSafeInteger(sats) || sats <= 0 || !Number.isSafeInteger(sats * 1000)) {
    throw new Error('Invalid amount')
  }
  return sats
}

/**
 * The most an invoice in the recipient's currency may ask for an estimate.
 * Whole-number arithmetic, so 1850 sats allows exactly 2045.
 */
export function payoutCeilingSats(estimateSats) {
  return estimateSats + Math.ceil((estimateSats * PAYOUT_FEE_ALLOWANCE_PERCENT) / 100) + PAYOUT_ROUNDING_SATS
}

/** An answer that sends the request on: a 3xx, or a browser's opaque redirect (status 0). */
function isRedirect(response) {
  const status = Number(response?.status) || 0
  return !response?.ok && (status === 0 || (status >= 300 && status < 400))
}

/**
 * Where a redirect from `from` points, if it stays on the same scheme, host
 * and port, carries no credentials, and can be seen at all; else null.
 */
function sameHostRedirect(from, location) {
  if (typeof location !== 'string' || !location.trim()) return null
  try {
    const origin = new URL(from)
    const next = new URL(location.trim(), origin)
    if (next.origin !== origin.origin || next.username || next.password) return null
    next.hash = ''
    return next.href
  } catch {
    return null
  }
}

/** The service's clock in seconds, from its Date header, or null. */
function serviceClockSeconds(response) {
  const at = typeof response?.date === 'string' ? Date.parse(response.date) : NaN
  return Number.isFinite(at) ? at / 1000 : null
}

/** SHA-256 of a pay request's metadata, as an invoice for it carries it (LUD-06). */
function metadataHash(metadata) {
  return bytesToHex(sha256(new TextEncoder().encode(metadata)))
}

/** The invoice in a callback answer, decoded. */
function readInvoice(data, decode) {
  const missing = (message) => payRequestError(PAY_REQUEST_ERROR.INVOICE_MISSING, message)
  const pr = typeof data?.pr === 'string' ? data.pr.trim() : ''
  if (!pr) throw missing('The service sent no invoice')
  let decoded
  try {
    decoded = decode(pr)
  } catch {
    throw missing('The invoice could not be read')
  }
  const amountSats = Number(decoded?.amount)
  if (!Number.isFinite(amountSats) || amountSats <= 0) throw missing('The invoice has no amount')
  return {
    pr: typeof decoded.invoice === 'string' && decoded.invoice ? decoded.invoice : pr,
    amountSats,
    descriptionHash: typeof decoded.descriptionHash === 'string' ? decoded.descriptionHash.toLowerCase() : null,
    expiresAt: Number.isFinite(decoded.expiry) ? decoded.expiry : null,
  }
}

/**
 * Second step: the invoice for an amount.
 *
 * In sats, the amount must sit within the service's limits and the invoice
 * must be for exactly that amount. In the recipient's currency (LUD-21), the
 * currency must be one the service offers, and `amountSats` is the estimate
 * the person confirmed: the service adds its fee, so the invoice may be above
 * it, but never past payoutCeilingSats.
 *
 * The invoice must also be for this pay request when it says what it is for
 * (a description hash), and must not have long expired. The hash is checked
 * against `payRequest.metadata` as the service sent it; a kept copy without
 * it skips that check.
 *
 * @param {object} payRequest  from fetchPayRequest, or a kept copy of its terms
 * @param {{ amountSats: number, payout?: {code:string, amount:number}|null, comment?: string }} args
 * @param {{ get?: Function, decode?: Function, timeoutMs?: number, signal?: AbortSignal,
 *   now?: () => number }} [options]  `now` is the phone's clock in milliseconds
 * @returns {Promise<{ pr: string, amountSats: number, successAction: object|null,
 *   verify: string|null, storeable: boolean }>} `amountSats` is the invoice's;
 *   `successAction` is the LUD-09 action as utils/successAction.js reads it,
 *   `verify` the LUD-21 URL on the callback's own host, and `storeable` the
 *   LUD-11 verdict (isStoreablePayLink).
 * @throws {Error} a transport failure, a refusal, or a PAY_REQUEST_ERROR code.
 *   A failure here means nothing was paid.
 */
export async function requestPayInvoice(
  payRequest,
  { amountSats, payout = null, comment = '' } = {},
  { get = lnurlGetJson, decode = parseLightningInvoice, timeoutMs, signal, now = Date.now } = {},
) {
  const terms = payTerms(payRequest)
  const currency = currencyPayout(payout, terms.currency)
  const confirmed = confirmedSats(amountSats)
  let sats = null
  if (!currency) {
    sats = confirmed
    if (sats * 1000 < terms.minSendable || sats * 1000 > terms.maxSendable) {
      const minSats = Math.ceil(terms.minSendable / 1000)
      const maxSats = Math.floor(terms.maxSendable / 1000)
      throw payRequestError(
        PAY_REQUEST_ERROR.AMOUNT_OUT_OF_RANGE,
        `Amount must be between ${minSats} and ${maxSats} sats`,
        { minSats, maxSats },
      )
    }
  }

  const url = buildLnurlPayCallbackUrl({
    callback: terms.callback,
    amountSats: sats,
    payout: currency,
    comment,
    commentAllowed: terms.commentAllowed,
  })
  const ask = (target) => get(target, { timeoutMs, signal, disableRedirects: true })
  let target = url
  let response = await ask(target)
  for (let hops = 0; hops < MAX_SAME_HOST_REDIRECTS && isRedirect(response); hops += 1) {
    const next = sameHostRedirect(target, response?.location)
    if (!next) break
    target = next
    response = await ask(target)
  }
  // A refusal with its reason is still read first (serviceAnswer).
  if (isRedirect(response) && response?.data?.status !== 'ERROR') {
    const status = Number(response?.status) || 0
    throw payRequestError(PAY_REQUEST_ERROR.REDIRECTED, `The callback redirected (${status || 'opaque'})`, { status })
  }
  const data = serviceAnswer(response)
  const invoice = readInvoice(data, decode)
  if (invoice.descriptionHash && typeof payRequest.metadata === 'string'
      && invoice.descriptionHash !== metadataHash(payRequest.metadata)) {
    throw payRequestError(PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST, 'The invoice was made for another payment request')
  }
  const tooMuch = sats === null ? invoice.amountSats > payoutCeilingSats(confirmed) : invoice.amountSats !== sats
  if (tooMuch) {
    throw payRequestError(
      PAY_REQUEST_ERROR.INVOICE_MISMATCH,
      `The invoice is for ${invoice.amountSats} sats, not the ${confirmed} sats confirmed`,
      { askedSats: confirmed, invoiceSats: invoice.amountSats },
    )
  }
  const clock = serviceClockSeconds(response) ?? now() / 1000
  if (invoice.expiresAt !== null && invoice.expiresAt + EXPIRY_CLOCK_GRACE_SECONDS < clock) {
    throw payRequestError(PAY_REQUEST_ERROR.INVOICE_EXPIRED, 'The invoice had already expired')
  }
  return {
    pr: invoice.pr,
    amountSats: invoice.amountSats,
    successAction: parseSuccessAction(data.successAction, terms.callback),
    verify: validateVerifyUrl(data.verify, terms.callback),
    storeable: isStoreablePayLink(data),
  }
}
