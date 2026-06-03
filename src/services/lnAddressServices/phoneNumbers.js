/**
 * Recognize a raw phone number a user types into the send field and build
 * the fiat-payout Lightning Address for it (Tando in Kenya, Bitzed in
 * Zambia). This is the construction counterpart to matchLnAddressService()
 * in ./index.js, which only recognizes an already-formed `<phone>@<domain>`.
 *
 * Pure and synchronous — no network. The send flow runs this only after the
 * other identifier predicates (Spark / invoice / LNURL / Bitcoin / Lightning
 * address) miss, so a recognized number is unambiguously a phone number.
 *
 * Design notes:
 *   - We accept international (`+254...`, `254...`, `00254...`) and national
 *     trunk (`0...`) forms. A bare national significant number (no "+", no
 *     trunk "0") is deliberately NOT accepted: in a payment field a naked
 *     9-digit string is too weak a signal and would invite false positives.
 *   - Kenya and Zambia both use a 9-digit NSN and collide on the local
 *     prefixes 075 / 076 / 077 / 078 (valid mobile in BOTH countries). When
 *     the user gives a calling code the result is exact; for a colliding
 *     local number we return BOTH candidates and preselect
 *     AMBIGUOUS_DEFAULT_CODE so the UI can show a one-tap country switch.
 *   - All numbering rules live in ./countries.js (operator tables, calling
 *     codes, NSN length) so this stays generic.
 */
import { PAYOUT_COUNTRIES } from './countries.js'

/**
 * Preselected country when a bare local number is valid in more than one
 * country (the 075-078 collision). The UI still shows the alternative as a
 * one-tap switch, and the international number + flag make the choice obvious
 * before sending. Flip this single constant to change the default.
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
 * @returns {string} e.g. '254712345678@tando.me' or '260978123456@bitzed.xyz'
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
 * Recognize a typed phone number and resolve it to a fiat-payout country plus
 * a constructed Lightning Address. Returns null when the input isn't a
 * recognized Kenyan / Zambian mobile number.
 *
 * Result shape (see buildResult): { country, operator, operatorSpecial, nsn,
 * e164, display, lightningAddress, localPartVerified, confidence, ambiguous,
 * source }. When `ambiguous` is true, `candidates` holds one fully-built
 * result per possible country (the preselected entry first).
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

  // Collision (075-078): the same local number is valid in more than one
  // country. Preselect AMBIGUOUS_DEFAULT_CODE, expose both as candidates.
  const ordered = [
    ...matches.filter((country) => country.code === AMBIGUOUS_DEFAULT_CODE),
    ...matches.filter((country) => country.code !== AMBIGUOUS_DEFAULT_CODE),
  ]
  const candidates = ordered.map((country) =>
    buildResult(country, local, { confidence: 'ambiguous', ambiguous: true, source: 'national' }),
  )
  return { ...candidates[0], candidates }
}
