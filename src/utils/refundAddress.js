/**
 * refundAddress - the "Refunds to" row of the confirm sheet.
 *
 * A service may ask for the payer's Lightning address (LUD-18 `identifier`,
 * read by utils/lud18.js). For a till payment that address is where a refund
 * goes: the provider refuses to take payments without one at stores it names,
 * and the address is the only way money for a cancelled sale can come back.
 * Everywhere else the address only says who paid.
 *
 *   | Service           | Asks for an address | What the sheet does              |
 *   |-------------------|---------------------|----------------------------------|
 *   | Till payment      | Optional            | Row, sent by default, may decline |
 *   | Till payment      | Mandatory           | Row, no decline                   |
 *   | Anything else     | Optional            | Nothing, nothing sent             |
 *   | Anything else     | Mandatory           | Row, no decline                   |
 *   | Any               | Other kinds required| Cannot pay, slide disabled        |
 *
 * A till payment is one the merchant code produced AND whose callback is on
 * the provider's own host (utils/merchantQR.isMerchantProviderUrl). The row
 * shows the exact address before the slide, so sending it by default there
 * hides nothing. Everywhere else sending stays opt-in, which here means: only
 * when the payment cannot go ahead without it.
 *
 * Which address, first match wins:
 *   1. the paying wallet's own,
 *   2. another wallet's, oldest first,
 *   3. the profile's payment address (the Social Bucket when nothing else).
 * A wallet's comes first so a refund lands somewhere visible on this phone.
 *
 * Pure: the caller passes the store's facts in.
 */
import { payerIdentifier, readPayerRequest } from './lud18.js'
import { isNpubCashAddress } from './npubCashAddress.js'
import { isCounterpartyError } from './errorOrigin.js'

/** What the address is for, which decides the row's words. */
export const PAYER_ADDRESS_PURPOSE = Object.freeze({
  /** A till payment: the address gets any refund. */
  REFUND: 'refund',
  /** Any other service that will not take the payment without it. */
  IDENTIFY: 'identify',
})

/** Where a listed address comes from. */
export const REFUND_SOURCE = Object.freeze({
  WALLET: 'wallet',
  PROFILE: 'profile',
  BUCKET: 'bucket',
  /** Typed in for this payment. */
  ENTERED: 'entered',
})

/** What a refusal at the till said about the address (refundRefusal). */
export const REFUND_PROBLEM = Object.freeze({
  /** An address is needed and none went with the payment. */
  REQUIRED: 'required',
  /** The address that went with it cannot receive a refund. */
  REFUSED: 'refused',
})

const NO_ROW = Object.freeze({ show: false, required: false, canDecline: false, purpose: null, blocked: false })

/**
 * How the sheet handles a pay request's `payerData` (the table above).
 * @param {unknown} payerData  as the service sent it
 * @param {{ tillPayment?: boolean }} [context]  true only for a merchant code
 *   whose callback is on the provider's host
 * @returns {{ show: boolean, required: boolean, canDecline: boolean,
 *   purpose: string|null, blocked: boolean }}  `blocked`: the service requires
 *   details BuhoGO never shares, so the payment cannot go ahead
 */
export function payerAddressRule(payerData, { tillPayment = false } = {}) {
  const request = readPayerRequest(payerData)
  if (request.unmetRequired.length) return { ...NO_ROW, blocked: true }
  if (!request.asksIdentifier) return NO_ROW
  if (request.identifierRequired) {
    return {
      show: true,
      required: true,
      canDecline: false,
      purpose: tillPayment ? PAYER_ADDRESS_PURPOSE.REFUND : PAYER_ADDRESS_PURPOSE.IDENTIFY,
      blocked: false,
    }
  }
  return tillPayment
    ? { show: true, required: false, canDecline: true, purpose: PAYER_ADDRESS_PURPOSE.REFUND, blocked: false }
    : NO_ROW
}

/**
 * The addresses the row offers, in the order above, each once (addresses
 * are compared without case).
 * @param {object} facts
 * @param {Array<{ id: string, name?: string, createdAt?: number }>} facts.wallets
 * @param {string|null} facts.payerWalletId  the wallet that pays
 * @param {(wallet: object) => string|null} facts.addressOf  a wallet's own address
 * @param {string|null} [facts.profileAddress]  the profile's payment address
 * @param {string|null} [facts.entered]  an address typed in for this payment
 * @returns {Array<{ address: string, source: string, walletId?: string, name?: string }>}
 */
export function refundAddressOptions({ wallets = [], payerWalletId = null, addressOf, profileAddress = null, entered = null }) {
  const options = []
  const seen = new Set()
  // Only an address that can be shared (utils/lud18.payerIdentifier) is
  // offered: one the request would refuse is never on the row.
  const add = (value, entry) => {
    const address = payerIdentifier(value)
    if (!address) return
    const key = address.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    options.push({ address, ...entry })
  }
  const list = Array.isArray(wallets) ? wallets.filter(Boolean) : []
  const oldestFirst = list
    .map((wallet, index) => ({ wallet, index }))
    .sort((a, b) => (Number(a.wallet.createdAt) || 0) - (Number(b.wallet.createdAt) || 0) || a.index - b.index)
    .map(({ wallet }) => wallet)
  const payer = list.find((wallet) => wallet.id === payerWalletId)
  for (const wallet of payer ? [payer, ...oldestFirst.filter((w) => w !== payer)] : oldestFirst) {
    add(typeof addressOf === 'function' ? addressOf(wallet) : null, {
      source: REFUND_SOURCE.WALLET,
      walletId: wallet.id,
      name: wallet.name || '',
    })
  }
  add(profileAddress, { source: isNpubCashAddress(profileAddress) ? REFUND_SOURCE.BUCKET : REFUND_SOURCE.PROFILE })
  // A typed address stays listed after it was used, last, so going back to
  // a suggested one is one tap.
  add(entered, { source: REFUND_SOURCE.ENTERED })
  return options
}

/**
 * The address that goes with the payment.
 * @param {{ show: boolean, canDecline: boolean }} rule  from payerAddressRule
 * @param {Array<{ address: string }>} options  from refundAddressOptions
 * @param {{ address?: string, declined?: boolean }|null} pick  the person's
 *   choice for this payment; null follows the default (the first option)
 * @returns {string|null}
 */
export function chosenRefundAddress(rule, options, pick) {
  if (!rule?.show) return null
  if (pick?.declined && rule.canDecline) return null
  if (pick?.address) return pick.address
  return options?.[0]?.address || null
}

// What the provider says about the address. It answers with its own words,
// sometimes with one of its scanner codes in them; both are matched. "No
// refund address needed" says the opposite, so a "no" in front never counts.
const ADDRESS_REQUIRED = /\bREFUND_ADDRESS_REQUIRED\b|(?<!\bno )refund address (?:is )?(?:required|missing|mandatory|needed)\b|\b(?:requires?|needs?) a refund address\b/i
const ADDRESS_REFUSED = /\bINVALID_REFUND_ADDRESS\b|\b(?:could ?not|couldn't|cannot|can't|unable to|failed to) (?:validate|resolve|verify|reach) (?:the |this |your )?refund address\b|\binvalid refund address\b|(?<!\bno )refund address (?:is )?(?:invalid|not valid|unresolvable|not resolvable|unreachable)\b/i

/**
 * What a failed request said about the address, so the sheet can say it on
 * the row and stay open: an address is needed, or the one sent was refused.
 * Null for any other failure, which takes the usual error dialog.
 *
 * A service that turned out to require an address (utils/lnurlPay.js
 * PAYER_DATA_REQUIRED) counts even without a row: the row then appears. The
 * service's own words are read only when the row was shown, so a refusal
 * that merely mentions refunds never changes an ordinary payment.
 *
 * @param {Error} error  from the payment
 * @param {{ sent?: string|null, shown?: boolean }} [context]  the address
 *   that went with it, and whether the row was on the sheet
 * @returns {string|null} a REFUND_PROBLEM
 */
export function refundRefusal(error, { sent = null, shown = true } = {}) {
  if (!error || typeof error !== 'object') return null
  if (error.code === 'LNURL_PAYER_DATA_REQUIRED') return REFUND_PROBLEM.REQUIRED
  if (!shown) return null
  if (error.code === 'LNURL_PAYER_DATA_INVALID') return REFUND_PROBLEM.REFUSED
  // Only the service's own words (utils/errorOrigin.js) are read.
  if (!isCounterpartyError(error) || typeof error.message !== 'string') return null
  const text = error.message.slice(0, 500)
  if (ADDRESS_REFUSED.test(text)) return sent ? REFUND_PROBLEM.REFUSED : REFUND_PROBLEM.REQUIRED
  // "Required" although an address went with it: the row cannot explain
  // that, so the service's own words go to the usual dialog.
  if (ADDRESS_REQUIRED.test(text)) return sent ? null : REFUND_PROBLEM.REQUIRED
  return null
}

/**
 * Two addresses are the same address whatever their case (the domain has
 * none, and services treat the name the same way).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameRefundAddress(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.trim() || !b.trim()) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * An address shortened in the middle: the domain, the part people
 * recognise, stays whole. A Social Bucket's 63-character key becomes
 * `npub1…6w6`.
 * @param {string} address
 * @returns {string}
 */
export function shortRefundAddress(address) {
  const text = typeof address === 'string' ? address.trim() : ''
  const at = text.lastIndexOf('@')
  if (at < 1) return text
  const name = text.slice(0, at)
  return name.length <= 16 ? text : `${name.slice(0, 6)}…${name.slice(-4)}${text.slice(at)}`
}
