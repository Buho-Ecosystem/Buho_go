/**
 * Recognize a phone number in a payout country, typed or in a `tel:` link,
 * and build the fiat-payout Lightning Address for it (one provider per
 * country, ./countries.js). This is the construction counterpart to
 * matchLnAddressService() in ./index.js, which only recognizes an
 * already-formed `<phone>@<domain>`.
 *
 * Pure and synchronous, no network. Only digits with phone punctuation, or
 * a `tel:` link, are read as a number, which no other destination the send
 * field takes looks like. The one overlap, ten digits that are also a
 * scanned till code, is decided in the send field (SendModal
 * processPaymentData; docs/notes/PnP_honeybadger.md).
 *
 * Design notes:
 *   - We accept international (`+254...`, `254...`, `00254...`) and national
 *     trunk (`0...`) forms, typed or in a `tel:` link (readNumberText). A
 *     bare national significant number (no "+", no trunk "0") is
 *     deliberately NOT accepted: in a payment field a naked 9-digit string
 *     is too weak a signal and would invite false positives.
 *   - Every payout country writes a local number as `0` and nine digits,
 *     and some prefixes are mobile ranges in more than one of them (075/076:
 *     KE, ZM and TZ; 077/078: KE and ZM; 074/079: KE and TZ). A calling code
 *     makes the result exact. A colliding local number comes back
 *     `ambiguous`, with one candidate per country, and is never paid until
 *     the person picks one (SendModal's "Which country?").
 *   - All numbering rules live in ./countries.js (operator tables, calling
 *     codes, NSN length) so this stays generic.
 */
import { PAYOUT_COUNTRIES } from './countries.js'
import { isTelUri, parseTelUri } from '../../utils/telUri.js'

/**
 * The candidate listed first for a local number valid in more than one
 * country. Only an order, never a choice: an ambiguous result is not paid as
 * it is (its own lightningAddress is this first candidate's), the person
 * picks the country, and the chooser leads with the one they last picked.
 */
export const AMBIGUOUS_DEFAULT_CODE = 'KE'

// ----------------------------------------------------------------------------
// Prefix matching
// ----------------------------------------------------------------------------

/**
 * Does `nsn` begin with `spec`? `spec` is either an exact prefix ('120') or
 * an inclusive range of equal-length prefixes ('700-729').
 * @param {string} spec
 * @param {string} nsn
 * @returns {boolean}
 */
function prefixMatches(spec, nsn) {
  const dash = spec.indexOf('-')
  if (dash === -1) return nsn.startsWith(spec)
  const lo = spec.slice(0, dash)
  const hi = spec.slice(dash + 1)
  const head = nsn.slice(0, lo.length)
  if (head.length < lo.length) return false
  const value = Number(head)
  return value >= Number(lo) && value <= Number(hi)
}

/**
 * The operator a national significant number belongs to, or null if the NSN
 * isn't a valid mobile number for this country.
 * @param {object} country  a PAYOUT_COUNTRIES entry
 * @param {string} nsn
 * @returns {{ name: string, special: boolean } | null}
 */
export function matchOperator(country, nsn) {
  if (typeof nsn !== 'string' || nsn.length !== country.nsnLength) return null
  for (const op of country.operators) {
    if (op.prefixes.some((spec) => prefixMatches(spec, nsn))) {
      return { name: op.name, special: op.special === true }
    }
  }
  return null
}

/**
 * True if `nsn` is a valid mobile NSN for `country`.
 * @param {object} country
 * @param {string} nsn
 * @returns {boolean}
 */
export function isValidMobile(country, nsn) {
  return matchOperator(country, nsn) !== null
}

// ----------------------------------------------------------------------------
// Normalization
// ----------------------------------------------------------------------------

/**
 * The text to read as a number. A `tel:` link (utils/telUri.js) gives the
 * number it calls, read the way the same number typed would be.
 *
 * A local number in a link carries its `phone-context`, which "does NOT
 * indicate a prefix that turns the local number into a global (E.164)
 * number" (RFC 3966 5.1.5): it names where the number is valid, so it only
 * picks the country among the ones the number is already valid in. To call
 * a local number, a reader "MUST understand the context": a context that is
 * not a payout country's calling code (a region inside a country, say) is
 * one this cannot place, so the link is not read. Separators in a context
 * do not count (RFC 3966 4).
 *
 * A `tel:` link telUri.js does not read is not read here either; any other
 * text is read as it is.
 *
 * @param {unknown} raw
 * @returns {{ text: unknown, contextCode: string|null } | null}
 *   `contextCode`: the payout country a link's context names
 */
function readNumberText(raw) {
  const tel = parseTelUri(raw)
  if (!tel) return isTelUri(raw) ? null : { text: raw, contextCode: null }
  if (tel.phoneContext === null) return { text: tel.number, contextCode: null }
  const context = tel.phoneContext.replace(/[().-]/g, '')
  const country = PAYOUT_COUNTRIES.find((c) => context === `+${c.callingCode}`)
  return country ? { text: tel.number, contextCode: country.code } : null
}

/**
 * Strip the human punctuation (spaces, dashes, parens, dots) and surface a
 * leading "+" / "00" international marker. Returns null when the input
 * contains anything other than phone-ish characters (letters, "@", etc.) —
 * those are handled by the other predicates.
 * @param {unknown} raw
 * @returns {{ digits: string, hadInternationalMarker: boolean } | null}
 */
function parseRaw(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) return null
  let rest = trimmed
  let hadInternationalMarker = false
  if (rest.startsWith('+')) {
    hadInternationalMarker = true
    rest = rest.slice(1)
  }
  let digits = rest.replace(/\D/g, '')
  if (!hadInternationalMarker && digits.startsWith('00')) {
    hadInternationalMarker = true
    digits = digits.slice(2)
  }
  return digits ? { digits, hadInternationalMarker } : null
}

// ----------------------------------------------------------------------------
// Formatting & construction
// ----------------------------------------------------------------------------

/**
 * Group an NSN into international display form: '712345678' (KE) ->
 * '+254 712 345 678'. Digits are grouped in threes for readability.
 * @param {object} country
 * @param {string} nsn
 * @returns {string}
 */
export function formatInternational(country, nsn) {
  const grouped = nsn.replace(/(\d{3})(?=\d)/g, '$1 ')
  return `+${country.callingCode} ${grouped}`
}

/**
 * E.164 form, no spaces: '712345678' (KE) -> '+254712345678'.
 * @param {object} country
 * @param {string} nsn
 * @returns {string}
 */
export function formatE164(country, nsn) {
  return `+${country.callingCode}${nsn}`
}

/**
 * Format an existing payout-address handle (the part before "@") as an
 * international number for a KNOWN country, e.g. ('ZM', '0777491011') ->
 * '+260 777 491 011'. The address domain already told us the country, so
 * unlike recognizePhoneNumber this does NOT guess the country — it only
 * normalizes the handle (local '0...', international 'CC...', or bare NSN) to
 * the international display. Returns the handle unchanged when it isn't a
 * clean phone number for that country.
 * @param {string} countryCode  ISO 3166-1 alpha-2 (e.g. 'KE', 'ZM')
 * @param {unknown} handle
 * @returns {string}
 */
export function formatPhoneHandle(countryCode, handle) {
  if (typeof handle !== 'string') return handle
  const country = PAYOUT_COUNTRIES.find((c) => c.code === countryCode)
  if (!country) return handle
  let digits = handle.replace(/\D/g, '')
  if (digits.startsWith(country.callingCode)) {
    digits = digits.slice(country.callingCode.length)
  } else if (
    country.trunkPrefix &&
    digits.startsWith(country.trunkPrefix) &&
    digits.length === country.trunkPrefix.length + country.nsnLength
  ) {
    digits = digits.slice(country.trunkPrefix.length)
  }
  if (digits.length !== country.nsnLength) return handle
  return formatInternational(country, digits)
}

/**
 * Build the provider Lightning Address in the local-part shape it expects.
 * @param {object} country
 * @param {string} nsn
 * @returns {string} e.g. '254712345678@bitcoin.co.ke' or '260978123456@bitzed.xyz'
 */
export function buildLightningAddress(country, nsn) {
  let localPart
  switch (country.localPartFormat) {
    case 'national0':
      localPart = `${country.trunkPrefix}${nsn}`
      break
    case 'nsn':
      localPart = nsn
      break
    case 'international':
    default:
      localPart = `${country.callingCode}${nsn}`
  }
  return `${localPart}@${country.sendDomain}`
}

/**
 * Assemble the public result object for a resolved (country, nsn) pair.
 *
 * Only pure registry fields are surfaced (code, hint, currency) so this
 * module never touches image assets. Branding URLs (flag/logo) are resolved
 * downstream by matchLnAddressService(lightningAddress) in ./index.js — the
 * same path that brands a pasted address — so the constructed address is
 * branded identically with no duplicated asset wiring here.
 */
function buildResult(country, nsn, { confidence, ambiguous, source }) {
  const operator = matchOperator(country, nsn)
  return {
    country: {
      code: country.code,
      hint: country.hint,
      currency: country.currency,
    },
    operator: operator ? operator.name : null,
    operatorSpecial: operator ? operator.special : false,
    nsn,
    e164: formatE164(country, nsn),
    display: formatInternational(country, nsn),
    lightningAddress: buildLightningAddress(country, nsn),
    localPartVerified: country.localPartVerified !== false,
    confidence,
    ambiguous,
    source,
  }
}

// ----------------------------------------------------------------------------
// Recognition
// ----------------------------------------------------------------------------

/**
 * Country-locked recognition: the user has explicitly chosen the payout
 * country (Mobile Money country selector), so cross-country ambiguity is
 * impossible. Because the country is certain we can additionally accept the
 * bare NSN (no trunk zero, no calling code) that the country-agnostic
 * recognizePhoneNumber deliberately rejects as too weak a signal.
 *
 * @param {string} countryCode  ISO 3166-1 alpha-2 (e.g. 'KE', 'TZ', 'ZM')
 * @param {unknown} raw
 * @returns {object | null}  same shape as recognizePhoneNumber (never ambiguous)
 */
export function recognizePhoneNumberForCountry(countryCode, raw) {
  const country = PAYOUT_COUNTRIES.find((c) => c.code === countryCode)
  const read = readNumberText(raw)
  if (!country || !read || (read.contextCode !== null && read.contextCode !== countryCode)) return null
  const parsed = parseRaw(read.text)
  if (!parsed) return null
  const { digits, hadInternationalMarker } = parsed

  let nsn = null
  if (digits.startsWith(country.callingCode)
      && digits.length === country.callingCode.length + country.nsnLength) {
    nsn = digits.slice(country.callingCode.length)
  } else if (hadInternationalMarker) {
    // An explicit "+" / "00" for a different calling code is a foreign
    // number — locking the country must not reinterpret it.
    return null
  } else if (digits.startsWith(country.trunkPrefix)
      && digits.length === country.trunkPrefix.length + country.nsnLength) {
    nsn = digits.slice(country.trunkPrefix.length)
  } else if (digits.length === country.nsnLength) {
    nsn = digits
  }

  if (!nsn || !isValidMobile(country, nsn)) return null
  return buildResult(country, nsn, { confidence: 'exact', ambiguous: false, source: 'country-locked' })
}

/**
 * Mobile Money, a country chosen: the number read in that country, or in
 * the country it names itself (a calling code, a `tel:` link's
 * phone-context), as its label then shows.
 *
 * A national number is never read in another country. Choosing a country is
 * the person's answer to "Which country?", and a number its payout service
 * can't take may still be a number there: Tanzania's service pays Vodacom
 * only, yet 0712345678 is a Tanzanian number on Yas as well as a Kenyan one
 * on Safaricom (countries.js).
 *
 * @param {string} countryCode  the chosen country, ISO 3166-1 alpha-2
 * @param {unknown} raw
 * @returns {object | null}  same shape as recognizePhoneNumber
 */
export function recognizeInChosenCountry(countryCode, raw) {
  const inChosen = recognizePhoneNumberForCountry(countryCode, raw)
  if (inChosen) return inChosen
  const named = recognizePhoneNumber(raw)
  return named?.confidence === 'exact' ? named : null
}

/**
 * Whether `raw` has every digit of a number in the country, in a form
 * recognizePhoneNumberForCountry reads there: the calling code and the
 * national number, `0` and the national number, or the national number
 * alone. Only then can the field say a number can't be paid, instead of
 * while it is still being typed.
 *
 * Not complete there: a number with another country's calling code, or a
 * `tel:` link naming another country (it reads where it says), and digits
 * that begin a payout country's calling code (`254 712 345`, a pause in
 * typing a Kenyan number).
 *
 * @param {string} countryCode  ISO 3166-1 alpha-2
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isCompleteNumberIn(countryCode, raw) {
  const country = PAYOUT_COUNTRIES.find((c) => c.code === countryCode)
  const read = readNumberText(raw)
  if (!country || !read || (read.contextCode !== null && read.contextCode !== countryCode)) return false
  const parsed = parseRaw(read.text)
  if (!parsed) return false
  const { digits, hadInternationalMarker } = parsed
  const { trunkPrefix, callingCode, nsnLength } = country
  if (digits.startsWith(callingCode)) return digits.length === callingCode.length + nsnLength
  if (hadInternationalMarker) return false
  if (digits.startsWith(trunkPrefix)) return digits.length === trunkPrefix.length + nsnLength
  return digits.length === nsnLength && !PAYOUT_COUNTRIES.some((c) => digits.startsWith(c.callingCode))
}

/**
 * Recognize a phone number, typed or in a `tel:` link, and resolve it to a
 * fiat-payout country plus a constructed Lightning Address. Returns null when
 * the input isn't a recognized mobile number in a payout country.
 *
 * Result shape (see buildResult): { country, operator, operatorSpecial, nsn,
 * e164, display, lightningAddress, localPartVerified, confidence, ambiguous,
 * source }. When `ambiguous` is true, `candidates` holds one fully-built
 * result per possible country (AMBIGUOUS_DEFAULT_CODE's first), and the
 * result itself must not be paid: the person picks a candidate.
 *
 * confidence:
 *   'exact'     — a calling code was given; single country, no ambiguity.
 *   'high'      — national trunk form, valid in exactly one country.
 *   'ambiguous' — national trunk form valid in more than one country.
 *
 * @param {unknown} raw
 * @returns {object | null}
 */
export function recognizePhoneNumber(raw) {
  const read = readNumberText(raw)
  if (!read) return null
  const result = recognizeNumber(read.text)
  if (!result || read.contextCode === null) return result
  // Of the countries the number is valid in, the context names one.
  const inContext = (result.candidates ?? [result]).find((r) => r.country.code === read.contextCode)
  return inContext ? { ...inContext, confidence: 'exact', ambiguous: false } : null
}

/** recognizePhoneNumber for the number itself, once readNumberText has it. */
function recognizeNumber(raw) {
  const parsed = parseRaw(raw)
  if (!parsed) return null
  const { digits, hadInternationalMarker } = parsed

  // 1) International: a known calling code followed by a valid NSN.
  for (const country of PAYOUT_COUNTRIES) {
    const cc = country.callingCode
    if (digits.startsWith(cc)) {
      const nsn = digits.slice(cc.length)
      if (nsn.length === country.nsnLength && isValidMobile(country, nsn)) {
        return buildResult(country, nsn, { confidence: 'exact', ambiguous: false, source: 'international' })
      }
    }
  }
  // An explicit "+" / "00" that didn't resolve is a foreign number we don't serve.
  if (hadInternationalMarker) return null

  // 2) National trunk form: a leading "0" then the NSN.
  if (!digits.startsWith('0')) return null
  const local = digits.slice(1)
  const matches = PAYOUT_COUNTRIES.filter(
    (country) => country.trunkPrefix === '0' && local.length === country.nsnLength && isValidMobile(country, local),
  )
  if (matches.length === 0) return null
  if (matches.length === 1) {
    return buildResult(matches[0], local, { confidence: 'high', ambiguous: false, source: 'national' })
  }

  // Collision: the same local number is valid in more than one country.
  // Every one is a candidate, AMBIGUOUS_DEFAULT_CODE's first.
  const ordered = [
    ...matches.filter((country) => country.code === AMBIGUOUS_DEFAULT_CODE),
    ...matches.filter((country) => country.code !== AMBIGUOUS_DEFAULT_CODE),
  ]
  const candidates = ordered.map((country) =>
    buildResult(country, local, { confidence: 'ambiguous', ambiguous: true, source: 'national' }),
  )
  return { ...candidates[0], candidates }
}
