/**
 * Recognize Lightning Addresses that belong to a known fiat-payout
 * service (e.g. Tando in Kenya, Bitzed in Zambia) and resolve them to
 * their destination country, so the send sheet can show a country flag
 * and a "you are about to pay a <country> phone number" hint.
 *
 * Pure and synchronous: it only inspects the address's domain. It never
 * blocks the send flow, never touches the network, and returns null for
 * the normal case (any other Lightning Address) exactly like a miss —
 * the caller then renders the address as usual.
 */
import { PAYOUT_COUNTRIES } from './countries'
import { assetUrl } from './assets'

// domain (lowercased) -> country entry, built once at module load.
const COUNTRY_BY_DOMAIN = new Map()
for (const country of PAYOUT_COUNTRIES) {
  for (const domain of country.domains) {
    COUNTRY_BY_DOMAIN.set(domain.toLowerCase(), country)
  }
}

/**
 * @param {string} lightningAddress  e.g. "254712345678@tando.me"
 * @returns {{ code: string, flag: string, logo: string|null, hint: string, currency: string, handle: string } | null}
 *          `flag` is a bundled SVG URL, `logo` an optional bundled provider
 *          logo (Zambia -> Bitzed; null otherwise), `hint` a flat i18n key,
 *          `handle` the part before the "@" (the phone number). null on no match.
 */
export function matchLnAddressService(lightningAddress) {
  if (typeof lightningAddress !== 'string') return null
  const trimmed = lightningAddress.trim()
  const at = trimmed.lastIndexOf('@')
  // Require a non-empty handle and domain ("a@b" at minimum).
  if (at < 1 || at === trimmed.length - 1) return null
  const country = COUNTRY_BY_DOMAIN.get(trimmed.slice(at + 1).toLowerCase())
  if (!country) return null
  return {
    code: country.code,
    flag: assetUrl(country.flagFile),
    logo: assetUrl(country.logoFile),
    hint: country.hint,
    note: country.note,
    currency: country.currency,
    handle: trimmed.slice(0, at),
  }
}

// Construction side: recognizing a raw phone number typed into the send field
// and building the provider Lightning Address. Re-exported here so callers
// have a single import surface for the lnAddressServices package.
export {
  recognizePhoneNumber,
  buildLightningAddress,
  formatInternational,
  formatE164,
  formatPhoneHandle,
  matchOperator,
  isValidMobile,
  AMBIGUOUS_DEFAULT_CODE,
} from './phoneNumbers'
