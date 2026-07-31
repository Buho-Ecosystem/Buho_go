/**
 * Sticky preference for the fiat-payout country chooser.
 *
 * Several African numbering plans overlap on the bare national form (a `07x`
 * number can be a valid mobile in Kenya, Zambia AND Tanzania), so a typed
 * number with no country code is genuinely ambiguous. We never guess — paying
 * the wrong country is irreversible — but we DO remember which country the user
 * picked last and lead the chooser with it next time. A daily user in one
 * country then taps once, ever; after that their country is always first.
 *
 * This is a pure UI convenience (ordering only, never auto-selection), so it
 * lives here rather than in the pure ./services/lnAddressServices package, which
 * must stay Node-testable and free of browser globals.
 */
const STORAGE_KEY = 'buho.payoutCountry'

/**
 * The ISO 3166-1 alpha-2 code the user last chose in the chooser, or '' when
 * there is no history (fresh install) or storage is unavailable.
 * @returns {string}
 */
export function getPreferredPayoutCountry() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Remember the country the user just picked so the chooser can lead with it.
 * No-op on a falsy code or when storage is unavailable (private mode, etc.).
 * @param {string} code  ISO 3166-1 alpha-2 (e.g. 'KE', 'TZ')
 */
export function rememberPayoutCountry(code) {
  if (!code) return
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* storage unavailable — ordering just falls back to the registry default */
  }
}
