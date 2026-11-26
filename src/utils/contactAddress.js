/**
 * What a contact's payment address is: the one place that decides it.
 *
 * Every way into the address book (typing, pasting, scanning, saving after a
 * payment, the shared contacts doc another app wrote) goes through here, so
 * a contact always holds one lasting address in one stored form:
 *
 *   - Recognition: Lightning address, LNURL pay link, Spark, Arkade or
 *     Bitcoin address. A Lightning invoice or a Spark invoice pays once and
 *     expires, so it is never a contact; the reader says so instead.
 *   - Unwrapping: a payment link (BIP21 `bitcoin:`) gives its lasting part,
 *     the Spark address first, then Arkade, then a reusable Lightning link,
 *     then the Bitcoin address when the link does not name one order.
 *     `lightning:` / `lnurl:` wrappers are dropped.
 *   - Stored form: bech32 strings (Spark, Arkade, segwit Bitcoin, LNURL) are
 *     case-insensitive by spec and stored lowercase, so "Bc1q…" from a phone
 *     keyboard or "BC1Q…" from an upper-case QR becomes the address it
 *     means. Base58 Bitcoin addresses keep their case: there it is part of
 *     the address. A Lightning address keeps its name as typed, the way the
 *     pay request sends it (utils/lnurlPay).
 *   - Checks: a Spark address must decode, a segwit Bitcoin address must
 *     pass its checksum, so a typo is caught when saving, not when paying.
 */

import { bech32, bech32m } from 'bech32'
import { isBip21, parseBip21 } from './bip21.js'
import { isAddressRequest } from './lud23.js'
import { namesOneOrder } from './payAgain.js'
import { decodeSparkDestination, isSparkPaymentRequest } from './sparkPayment.js'
import {
  canonicalLnurl,
  isArkadeAddress,
  isBitcoinAddress,
  isLightningAddress,
  isLightningInvoice,
  isLnurl,
  isSparkAddress,
  stripWrapperScheme,
} from './addressUtils.js'

/** LUD-17 links that are not pay links: withdraw, channel and login. */
const NOT_A_PAY_LINK = /^(?:lnurlw|lnurlc|keyauth):\/\//i
const SEGWIT = /^(?:bc|tb)1/i
const ARKADE_HRPS = new Set(['ark', 'tark'])

/** A request that pays once (an invoice, a payment link for one order). */
const ONE_TIME = Object.freeze({ problem: 'one-time' })
/** Looks like an address of a known kind, but does not check out. */
const INVALID = Object.freeze({ problem: 'invalid' })

/**
 * The kind of a bare identifier, by format alone. No unwrapping.
 * @param {unknown} value
 * @returns {'spark'|'arkade'|'bitcoin'|'lnurl'|'lightning'|null}
 */
export function contactAddressType(value) {
  if (typeof value !== 'string' || !value.trim() || isAddressRequest(value)) return null
  if (isSparkAddress(value)) return 'spark'
  if (isArkadeAddress(value)) return 'arkade'
  if (isBitcoinAddress(value)) return 'bitcoin'
  if (isLnurl(value)) return NOT_A_PAY_LINK.test(stripWrapperScheme(value)) ? null : 'lnurl'
  if (isLightningAddress(value)) return 'lightning'
  return null
}

/**
 * The stored form of an address of the given kind, or '' when it is not a
 * lasting address of that kind.
 * @param {unknown} value
 * @param {string} type
 * @returns {string}
 */
export function canonicalContactAddress(value, type) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || isAddressRequest(text)) return ''
  switch (type) {
    case 'spark': return sparkAddress(text)
    case 'arkade': return arkadeAddress(text)
    case 'bitcoin': return bitcoinAddress(text)
    case 'lnurl': return contactAddressType(text) === 'lnurl' ? canonicalLnurl(text) || '' : ''
    case 'lightning': return isLightningAddress(text) ? text : ''
    default: return ''
  }
}

/**
 * Read what a person typed, pasted or scanned as a contact address.
 *
 * @param {unknown} raw
 * @returns {{ address: string, addressType: string, label?: string }
 *   | { problem: 'one-time' | 'invalid' }
 *   | null}  null: nothing that reads as an address
 */
export function readContactAddress(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || isAddressRequest(text)) return null
  if (isBip21(text)) return fromPaymentLink(parseBip21(text))
  return readBare(stripWrapperScheme(text))
}

/**
 * A name an address suggests for its contact, '' when it suggests none: the
 * label a payment link carries, else a Lightning address's own name in words
 * ("lena.fischer@…" and "LENA.FISCHER@…" are "Lena Fischer"). A name with no letters (a phone
 * number) or a public key says nothing about the person, so it suggests none.
 *
 * @param {{ address?: string, addressType?: string, label?: string }|null} reading
 * @returns {string}
 */
export function suggestedContactName(reading) {
  if (reading?.label) return reading.label
  if (reading?.addressType !== 'lightning' || typeof reading.address !== 'string') return ''
  const name = reading.address.slice(0, reading.address.lastIndexOf('@'))
  if (!/[a-z]/i.test(name) || /^npub1/i.test(name) || name.length > 32) return ''
  return name.split(/[._-]+/).filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(' ')
}

function readBare(value) {
  if (isLightningInvoice(value) || isSparkPaymentRequest(value)) return ONE_TIME
  const addressType = contactAddressType(value)
  if (!addressType) return null
  const address = canonicalContactAddress(value, addressType)
  return address ? { address, addressType } : INVALID
}

function fromPaymentLink(link) {
  if (!link) return null
  const params = link.params || {}
  const candidates = [params.spark, params.ark, link.lightning]
  // The Bitcoin address of a checkout is that order's address.
  if (!namesOneOrder(link)) candidates.push(link.address)
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const found = readBare(stripWrapperScheme(candidate))
    if (found?.address) {
      return link.label ? { ...found, label: link.label.trim().slice(0, 50) } : found
    }
  }
  return link.lightning || link.address ? ONE_TIME : null
}

function sparkAddress(text) {
  if (!isSparkAddress(text)) return ''
  try {
    return decodeSparkDestination(text).kind === 'address' ? text.toLowerCase() : ''
  } catch {
    return ''
  }
}

function arkadeAddress(text) {
  if (!isArkadeAddress(text)) return ''
  const lower = text.toLowerCase()
  try {
    return ARKADE_HRPS.has(bech32m.decode(lower, 1023).prefix) ? lower : ''
  } catch {
    return ''
  }
}

function bitcoinAddress(text) {
  if (!SEGWIT.test(text)) return isBitcoinAddress(text) ? text : ''
  const lower = text.toLowerCase()
  return isBitcoinAddress(lower) && segwitChecksumHolds(lower) ? lower : ''
}

/** Version 0 programs use bech32, every later version bech32m (BIP-350). */
function segwitChecksumHolds(lower) {
  for (const [codec, versionZero] of [[bech32, true], [bech32m, false]]) {
    try {
      if ((codec.decode(lower, 90).words[0] === 0) === versionZero) return true
    } catch { /* the other checksum */ }
  }
  return false
}
