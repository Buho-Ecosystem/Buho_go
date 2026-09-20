/**
 * Canonical fiat currency metadata for BuhoGO.
 *
 * Single source of truth: add a currency here once and it flows through to
 *  - rate fetching (MEMPOOL_RATE_CURRENCIES and ALBY_RATE_CURRENCIES),
 *  - the wallet store's exchange-rate table,
 *  - display symbols (FIAT_SYMBOLS, used by the send sheet, settings, and
 *    fiatRates formatting),
 *  - the global fiat picker and the send sats/fiat toggle
 *    (SELECTABLE_FIAT_CURRENCIES).
 *
 * Every selectable currency needs exactly one rate source. Mempool's /prices
 * endpoint serves a fixed set in a single call; anything else is fetched from
 * Alby per currency. __tests__/fiatCurrencies.spec.js enforces that pairing,
 * so a currency cannot be offered in the picker without a live rate.
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
  BRL: 'R$',
  ZAR: 'R',
  KES: 'KSh ',
  ZMW: 'K ',
}

// Currencies the Mempool /prices endpoint returns in one response.
export const MEMPOOL_RATE_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY']

// Currencies the Mempool /prices endpoint does not return. We fetch each
// from Alby's per-currency endpoint (getalby.com/api/rates/<code>.json).
export const ALBY_RATE_CURRENCIES = ['BRL', 'ZAR', 'KES', 'ZMW']

// Currencies a user can pick as their global display currency. This list
// also drives the send screen's sats <-> fiat toggle (it denominates in
// whatever the user picks here).
export const SELECTABLE_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'BRL', 'ZAR', 'KES', 'ZMW']

// ISO 4217 code -> flag emoji, for the currency picker's left-hand badge.
export const FIAT_FLAGS = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  CAD: '🇨🇦',
  CHF: '🇨🇭',
  AUD: '🇦🇺',
  JPY: '🇯🇵',
  BRL: '🇧🇷',
  ZAR: '🇿🇦',
  KES: '🇰🇪',
  ZMW: '🇿🇲',
}

// Display symbol for a currency code, with a sensible fallback ("<CODE> ").
export function fiatSymbol(code) {
  const c = (code || '').toUpperCase()
  return FIAT_SYMBOLS[c] || c + ' '
}

// Flag emoji for a currency code, with a neutral fallback for anything
// not in FIAT_FLAGS (e.g. a future addition made only to FIAT_SYMBOLS).
export function fiatFlag(code) {
  const c = (code || '').toUpperCase()
  return FIAT_FLAGS[c] || '💱'
}
