/**
 * Canonical fiat currency metadata for BuhoGO.
 *
 * Single source of truth: add a currency here once and it flows through to
 *  - rate fetching (ALBY_RATE_CURRENCIES, for the currencies Mempool omits),
 *  - display symbols (FIAT_SYMBOLS, used by the send sheet, settings, and
 *    fiatRates formatting),
 *  - the global fiat picker and the send sats/fiat toggle
 *    (SELECTABLE_FIAT_CURRENCIES).
 */

// ISO 4217 code -> display symbol. Multi-letter symbols carry a trailing
// space so "KSh 250" reads cleanly; single-glyph symbols ("$") do not.
export const FIAT_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  CHF: 'CHF ',
  AUD: 'A$',
  JPY: '¥',
  ZAR: 'R',
  KES: 'KSh ',
  ZMW: 'K ',
}

// Currencies the Mempool /prices endpoint does not return. We fetch each
// from Alby's per-currency endpoint (getalby.com/api/rates/<code>.json).
export const ALBY_RATE_CURRENCIES = ['ZAR', 'KES', 'ZMW']

// Currencies a user can pick as their global display currency. This list
// also drives the send screen's sats <-> fiat toggle (it denominates in
// whatever the user picks here).
export const SELECTABLE_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'ZAR', 'KES', 'ZMW']

// Display symbol for a currency code, with a sensible fallback ("<CODE> ").
export function fiatSymbol(code) {
  const c = (code || '').toUpperCase()
  return FIAT_SYMBOLS[c] || c + ' '
}
