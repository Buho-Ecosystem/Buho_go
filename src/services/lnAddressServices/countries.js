/**
 * Recognized fiat-payout countries for Lightning Address sends — the single
 * registry. Pure data only (no asset imports) so it can be unit-tested under
 * plain Node and imported by the numbering logic without dragging in Vite
 * asset handling. The bundled flag/logo URLs are resolved from the filenames
 * below by ./assets.js.
 *
 * Some Lightning Address providers don't pay the recipient in Bitcoin —
 * they convert it and deliver local currency to a phone / mobile-money
 * account. Kenya (Tando) settles to M-Pesa; Zambia (Bitzed) settles to
 * local mobile money.
 *
 * This registry powers two things:
 *   1. RECOGNITION of a pasted Lightning Address (`<phone>@<domain>`) —
 *      see matchLnAddressService() in ./index.js. Branding is by COUNTRY.
 *   2. CONSTRUCTION from a raw phone number a user types into the send
 *      field — see ./phoneNumbers.js. We detect the country/operator from
 *      the number, normalize it to international form, and build the
 *      provider's Lightning Address.
 *
 * Per-country fields:
 *   code         ISO 3166-1 alpha-2.
 *   flagFile     Bundled round flag SVG, relative to src/assets/lnAddressServices/.
 *                Resolved to a URL by ./assets.js — no icon CDN, works
 *                offline, doesn't leak the destination country at payment time.
 *   logoFile     Optional bundled provider logo (round SVG, same base dir).
 *                When a country has a single partner provider we brand with
 *                the logo instead of the flag (Zambia -> Bitzed). null falls
 *                back to the flag.
 *   hint         Flat i18n key, resolved by the caller.
 *   currency     ISO 4217 local payout currency, for the on-sheet estimate.
 *   domains      Lightning Address domains we RECOGNIZE for this country.
 *   sendDomain   The domain we CONSTRUCT against for a typed phone number.
 *   callingCode  E.164 country calling code (digits only, no "+").
 *   trunkPrefix  National trunk / dialling prefix (the leading "0").
 *   nsnLength    National significant number length (digits after the
 *                trunk prefix / calling code).
 *   localPartFormat    How the provider expects the number in the address
 *                local-part: 'international' (callingCode + nsn),
 *                'national0' (trunkPrefix + nsn) or 'nsn' (bare nsn).
 *   localPartVerified  Whether localPartFormat is confirmed against a live
 *                number. Bitzed is verified; Tando is ASSUMED (see below).
 *   operators    Ordered operator table. Each entry is { name, prefixes }
 *                where a prefix is an exact NSN prefix ('120') or an
 *                inclusive range of equal-length prefixes ('700-729').
 *                Membership in this table is also what makes an NSN a valid
 *                mobile number for the country, so keep it accurate.
 *
 * To add a provider in an existing country: append its domain to `domains`.
 * To add a country: add an entry here, drop a round flag SVG in
 * ../../assets/lnAddressServices/flags/, register it in ./assets.js, add the
 * `hint` key to the en-US / de / es catalogs, and fill in the numbering fields.
 *
 * Sources: ZICTA / ITU numbering plan (Zambia, +260) and CA Kenya
 * March 2025 numbering plan (Kenya, +254).
 */
export const PAYOUT_COUNTRIES = [
  {
    code: 'KE',
    flagFile: 'flags/circle-flags--ke.svg',
    logoFile: null, // Tando logo not supplied yet -> brand Kenya with the flag.
    hint: 'You are about to pay a Kenyan phone number',
    note: 'Tando Kenyan Lightning address', // prefilled when saving as a contact
    currency: 'KES',
    domains: ['tando.me'],
    sendDomain: 'tando.me',
    callingCode: '254',
    trunkPrefix: '0',
    nsnLength: 9,
    // ASSUMPTION (unverified): Tando resolves the international local-part.
    // Every synthetic test number 404'd on tando.me/.well-known/lnurlp/* —
    // Tando appears to only mint a payRequest for a real, M-Pesa-registered
    // number — so confirm against a live number before fully trusting
    // construction. If it's actually the local form, flip localPartFormat
    // to 'national0' here and nothing else needs to change.
    localPartFormat: 'international',
    localPartVerified: false,
    operators: [
      { name: 'Safaricom', prefixes: ['110-117', '700-729', '740-743', '745-746', '748', '757-759', '768-769', '790-799'] },
      { name: 'Airtel', prefixes: ['100-108', '730-739', '750-756', '762', '780-789'] },
      { name: 'Telkom', prefixes: ['770-779'] },
      { name: 'Equitel', prefixes: ['763-766'] },
      { name: 'Faiba', prefixes: ['747'] },
      { name: 'Jambo Telcoms', prefixes: ['120'] },
      { name: 'Infura', prefixes: ['124'] },
      { name: 'Hidiga', prefixes: ['126'] },
      { name: 'Webtribe', prefixes: ['128'] },
      { name: 'NRG Media', prefixes: ['130'] },
      { name: 'Mobile Pay', prefixes: ['760'] },
      { name: 'Eferio', prefixes: ['761'] },
      { name: 'Homelands Media', prefixes: ['744'] },
      { name: 'IEBC KIEMS', prefixes: ['749'], special: true },
      { name: 'Test / Research', prefixes: ['199'], special: true },
    ],
  },
  {
    code: 'ZM',
    flagFile: 'flags/circle-flags--zm.svg',
    logoFile: 'logos/bitzed.svg', // Bitzed is our partner and the sole ZM provider -> brand with the logo.
    hint: 'You are about to pay a Zambian phone number',
    note: 'Bitzed Zambian Lightning address', // prefilled when saving as a contact
    currency: 'ZMW',
    domains: ['bitzed.xyz'],
    sendDomain: 'bitzed.xyz',
    callingCode: '260',
    trunkPrefix: '0',
    nsnLength: 9,
    // Verified live: bitzed.xyz resolves both 260... (international) and 0...
    // (local) local-parts to the same payout (p=260...). We construct the
    // international form for consistent, readable display.
    localPartFormat: 'international',
    localPartVerified: true,
    operators: [
      { name: 'Airtel', prefixes: ['57', '77', '97'] },
      { name: 'MTN', prefixes: ['76', '96'] },
      { name: 'Zamtel', prefixes: ['75', '95'] },
      { name: 'Beeline', prefixes: ['78', '98'] }, // 78 reserved for Beeline
    ],
  },
]
