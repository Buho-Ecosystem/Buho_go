/**
 * Recognized fiat-payout countries for Lightning Address sends.
 *
 * Some Lightning Address providers don't pay the recipient in Bitcoin —
 * they convert it and deliver local currency to a phone / mobile-money
 * account. Kenya (Tando, Bitika, …) settles to M-Pesa; Zambia (Bitzed)
 * settles to local mobile money. For the same phone number these
 * providers are interchangeable, so we recognize and brand the
 * destination by COUNTRY, never by individual provider.
 *
 * To add a provider in an existing country: add its Lightning Address
 * domain to that country's `domains`. To add a country: add an entry
 * here, drop a round flag SVG in ../../assets/lnAddressServices/flags/,
 * and add the `hint` key to the en-US / de / es message catalogs.
 *
 * `flag` is a bundled local SVG (imported as a URL) so the send sheet
 * never calls an icon CDN: it works offline and doesn't reveal the
 * destination country to a third party at payment time. `hint` is a flat
 * i18n key, resolved by the caller.
 *
 * Codes are ISO 3166-1 alpha-2.
 */
import keFlag from '../../assets/lnAddressServices/flags/circle-flags--ke.svg?url'
import zmFlag from '../../assets/lnAddressServices/flags/circle-flags--zm.svg?url'

export const PAYOUT_COUNTRIES = [
  {
    code: 'KE',
    flag: keFlag,
    // Kenyan Lightning -> M-Pesa bridges. Tando is confirmed; add Bitika
    // (and any future Kenyan provider) by appending its Lightning Address
    // domain here once known.
    domains: ['tando.me'],
    hint: 'You are about to pay a Kenyan phone number',
  },
  {
    code: 'ZM',
    flag: zmFlag,
    // Zambian Lightning -> mobile-money bridge. Verify the live Lightning
    // Address domain before relying on it (website is bitzed.xyz).
    domains: ['bitzed.xyz'],
    hint: 'You are about to pay a Zambian phone number',
  },
]
