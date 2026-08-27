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
 * local mobile money; Tanzania (ChapSmart) settles TZS to M-Pesa.
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
 *   networkNote  Optional flat i18n key naming a network restriction, shown
 *                under the number field once the country is chosen. Set it
 *                whenever the provider pays only some of the country's
 *                networks, because `operators` is also the validity rule and
 *                a customer on another network would otherwise be told their
 *                own number is invalid.
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
 * Sources: ZICTA / ITU numbering plan (Zambia, +260), CA Kenya
 * March 2025 numbering plan (Kenya, +254), and the TCRA National Numbering
 * Plan July 2025 (Tanzania, +255).
 */
export const PAYOUT_COUNTRIES = [
  {
    code: 'KE',
    flagFile: 'flags/circle-flags--ke.svg',
    logoFile: 'logos/tando.png', // Tando is the KE provider -> brand with its logo.
    hint: 'You are about to pay a Kenyan phone number',
    note: 'Tando Kenyan Lightning address', // prefilled when saving as a contact
    currency: 'KES',
    domains: ['bitcoin.co.ke'], // Tando's live Lightning Address domain
    sendDomain: 'bitcoin.co.ke',
    callingCode: '254',
    trunkPrefix: '0',
    nsnLength: 9,
    // Verified live: bitcoin.co.ke (Tando) resolves both 254... (international)
    // and 0... (local) local-parts to the same payout (callback .../254...).
    // We construct the international form for consistent, readable display.
    localPartFormat: 'international',
    localPartVerified: true,
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
  {
    code: 'TZ',
    flagFile: 'flags/circle-flags--tz.svg',
    logoFile: 'logos/chapsmart.png', // ChapSmart is the sole TZ provider -> brand with its logo.
    hint: 'You are about to pay a Tanzanian phone number',
    note: 'ChapSmart Tanzanian Lightning address', // prefilled when saving as a contact
    currency: 'TZS',
    domains: ['chapsmart.com'],
    sendDomain: 'chapsmart.com',
    callingCode: '255',
    trunkPrefix: '0',
    nsnLength: 9,
    // Verified live: chapsmart.com resolves the international 255... local-part
    // (255740034110@chapsmart.com) to a TZS payout on M-Pesa. We construct the
    // international form for consistent, readable display.
    localPartFormat: 'international',
    localPartVerified: true,
    // ChapSmart currently settles ONLY to Vodacom M-Pesa numbers — its LNURL
    // endpoint rejects every other network ("Invalid Tanzanian M-Pesa number").
    // So we recognize only Vodacom's blocks; matching a number ChapSmart can't
    // pay would dead-end the user at resolution. Vodacom = NSN prefixes
    // 74/75/76/79 (national 0740-0749 / 0750-0759 / 0760-0769 / 0790-0799),
    // per the TCRA July 2025 plan. When ChapSmart adds other networks, append
    // their prefixes here (Airtel 68/69/78, Yas 65/67/71/77, Halotel 61,
    // TTCL 73). Note: Vodacom sits entirely in 07x, so every LOCAL Tanzanian
    // number collides with Kenya (75/76 also with Zambia); only the +255
    // international form is unambiguous — the country chooser resolves the rest.
    operators: [
      { name: 'Vodacom', prefixes: ['74', '75', '76', '79'] },
    ],
  },
  {
    code: 'GH',
    flagFile: 'flags/circle-flags--gh.svg',
    // BitSpenda has no round logo asset yet, so Ghana brands with the flag.
    logoFile: null,
    hint: 'You are about to pay a Ghanaian phone number',
    note: 'BitSpenda Ghanaian Lightning address', // prefilled when saving as a contact
    // Said BEFORE the first keystroke. The operators table below is also the
    // validity rule, so without this a Telecel or AirtelTigo customer types a
    // number that is perfectly valid in Ghana and is told it is not a number.
    networkNote: 'MTN Mobile Money only',
    currency: 'GHS',
    domains: ['bitspenda.app'],
    sendDomain: 'bitspenda.app',
    callingCode: '233',
    trunkPrefix: '0',
    nsnLength: 9,
    // Verified live 2026-08-27: bitspenda.app resolves both 0... (local) and
    // 233... (international) local-parts to the same payout. Unlike the other
    // three, its own text/identifier metadata answers in the LOCAL form
    // ("0246341938@bitspenda.app"), so we construct that: the address we show
    // then matches the one the provider names back to us. Display is still
    // international (+233 24 634 1938) via formatPhoneHandle.
    localPartFormat: 'national0',
    localPartVerified: true,
    // MTN ONLY, and this is not a numbering-plan fact — it is what BitSpenda
    // will actually pay. Probed live across every Ghanaian mobile prefix on
    // 2026-08-27: 024/053/054/055/059 return a payRequest; 020/026/027/050/
    // 056/057 are real Ghanaian numbers that come back "only MTN Mobile Money
    // supported"; 023/025/028/029/051/052/058 come back "unsupported phone
    // prefix". Since this table is also the validity rule, listing a
    // non-MTN block would let a user reach a resolution that always fails.
    // Re-probe before adding one: the set is the provider's, not the
    // regulator's.
    operators: [
      { name: 'MTN', prefixes: ['24', '53', '54', '55', '59'] },
    ],
  },
]
