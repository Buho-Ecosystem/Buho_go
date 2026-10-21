/**
 * Bitrefill Widget: Bitrefill's own shop (embed.bitrefill.com), shown inside
 * the app in a frame. Bitrefill runs the catalog, the checkout and the voucher
 * delivery; the app opens the frame and pays the Lightning invoice the widget
 * hands over.
 *
 * Everything here follows the documented widget contract
 * (https://www.bitrefill.com/playground/):
 *
 *   URL      embed.bitrefill.com/?ref&utm_source&paymentMethods&theme&hl
 *            &email&showPaymentInfo
 *   events   posted to the parent window as JSON strings:
 *              invoice_created  { invoiceId, paymentUri, paymentMethod,
 *                                 paymentAmount, paymentCurrency, products }
 *              payment_intent   { invoiceId, paymentUri, paymentMethod, ... }
 *              invoice_update   { invoiceId, status }  payment_detected |
 *                                 payment_confirmed | expired | refunded
 *              invoice_complete { invoiceId, deliveryStatus, refundNeeded }
 *
 * With showPaymentInfo=false the widget skips its own payment screen: after
 * the user confirms the order it sends `payment_intent`, and the app pays.
 *
 * The widget's look is Bitrefill's. Only the documented `theme` and `hl`
 * follow the app; no custom styles are injected.
 *
 * Pure functions only: no DOM, no Vue, no storage, so the rules are testable.
 */

export const WIDGET_ORIGIN = 'https://embed.bitrefill.com'

const env = import.meta.env || {}

/**
 * The name Bitrefill approves the integration under. Until BuhoGO is approved
 * the widget answers "Unverified Bitrefill Integration"; a local build can use
 * Bitrefill's demo source (`bitrefill_demo`) through the env override.
 */
export const BITREFILL_UTM_SOURCE = env.VITE_BITREFILL_UTM_SOURCE || 'buhogo'

/** BuhoGO's referral code, credited on every purchase. Issued by Bitrefill. */
export const BITREFILL_REF = env.VITE_BITREFILL_REF || ''

/** Languages the widget offers (`hl`); anything else falls back to English. */
export const WIDGET_LANGUAGES = Object.freeze([
  'en', 'ru', 'fr', 'es', 'de', 'it', 'nl', 'pt', 'vi', 'ko', 'ja', 'zh-Hans', 'pl', 'uk', 'tr',
])

export const WIDGET_EVENT = Object.freeze({
  INVOICE_CREATED: 'invoice_created',
  PAYMENT_INTENT: 'payment_intent',
  INVOICE_UPDATE: 'invoice_update',
  INVOICE_COMPLETE: 'invoice_complete',
})

/** `invoice_update` statuses that mean the invoice is paid. */
export const PAID_STATUSES = Object.freeze(['payment_detected', 'payment_confirmed'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True for a plausible email address. Bitrefill makes the final check. */
export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim())
}

/** The widget's `hl` for an app locale such as 'en-US' or 'de'. */
export function widgetLanguage(locale) {
  const tag = String(locale || '').trim()
  if (!tag) return 'en'
  if (/^zh/i.test(tag)) return 'zh-Hans'
  const base = tag.split(/[-_]/)[0].toLowerCase()
  return WIDGET_LANGUAGES.includes(base) ? base : 'en'
}

/**
 * The widget URL. Lightning is the only payment method: the app pays from the
 * user's own wallet, and the widget's own payment screen stays off.
 */
export function buildWidgetUrl({
  dark = false,
  locale = 'en',
  email = '',
  utmSource = BITREFILL_UTM_SOURCE,
  ref = BITREFILL_REF,
} = {}) {
  const params = new URLSearchParams()
  if (ref) params.set('ref', ref)
  params.set('utm_source', utmSource)
  params.set('paymentMethods', 'lightning')
  params.set('showPaymentInfo', 'false')
  params.set('theme', dark ? 'dark' : 'light')
  params.set('hl', widgetLanguage(locale))
  if (isValidEmail(email)) params.set('email', email.trim())
  return `${WIDGET_ORIGIN}/?${params.toString()}`
}

/**
 * Read one `message` event. Returns the widget event, or null for anything
 * that is not from the widget frame: another origin, another window (a page
 * the widget opened, another frame), or data that is not a widget event.
 *
 * @param {MessageEvent} event
 * @param {Window|null} frameWindow  the widget iframe's contentWindow
 */
export function parseWidgetMessage(event, frameWindow) {
  if (!event || event.origin !== WIDGET_ORIGIN) return null
  if (!frameWindow || event.source !== frameWindow) return null
  let data = event.data
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return null }
  }
  if (!data || typeof data !== 'object') return null
  if (!Object.values(WIDGET_EVENT).includes(data.event)) return null
  if (typeof data.invoiceId !== 'string' || !data.invoiceId) return null
  return data
}

/**
 * The BOLT11 invoice of a `payment_intent`, or null when it carries none the
 * app can pay (another payment method, a missing or malformed URI).
 */
export function invoiceFromIntent(message) {
  if (!message || message.event !== WIDGET_EVENT.PAYMENT_INTENT) return null
  if (message.paymentMethod && message.paymentMethod !== 'lightning') return null
  const uri = typeof message.paymentUri === 'string' ? message.paymentUri.trim() : ''
  const invoice = uri.replace(/^lightning:/i, '')
  return /^ln(bc|tb|bcrt|tbs)[0-9a-z]+$/i.test(invoice) ? invoice.toLowerCase() : null
}

/** True when an `invoice_update` says the invoice was paid. */
export function isPaidUpdate(message) {
  return message?.event === WIDGET_EVENT.INVOICE_UPDATE && PAID_STATUSES.includes(message.status)
}

/** True when an `invoice_update` says the price ran out before payment. */
export function isExpiredUpdate(message) {
  return message?.event === WIDGET_EVENT.INVOICE_UPDATE && message.status === 'expired'
}
