/**
 * phoneNumbers — Kenyan / Zambian / Tanzanian mobile recognition + Lightning-
 * address construction tests.
 *
 * Coverage focus:
 *   - international (+CC) and national (0...) recognition for all three countries
 *   - operator detection from the published prefix tables
 *   - the overlapping national forms (ChapSmart is Vodacom-only, 74/75/76/79):
 *     075/076 are valid in KE, ZM AND TZ (three-way); 074/079 in KE and TZ
 *     (two-way); 077/078 in KE and ZM; only the +255 form is an unambiguous
 *     Tanzania number
 *   - normalization of human punctuation, "+" and "00" markers
 *   - constructed Lightning Address shape per provider
 *   - rejection of foreign / unassigned / omitted / bare-NSN / junk inputs
 *
 * Run directly with Node:
 *   node src/services/lnAddressServices/__tests__/phoneNumbers.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  recognizePhoneNumber,
  recognizePhoneNumberForCountry,
  buildLightningAddress,
  formatInternational,
  formatE164,
  formatPhoneHandle,
  matchOperator,
  isValidMobile,
  AMBIGUOUS_DEFAULT_CODE,
} from '../phoneNumbers.js'
import { PAYOUT_COUNTRIES } from '../countries.js'

const KE = PAYOUT_COUNTRIES.find((c) => c.code === 'KE')
const ZM = PAYOUT_COUNTRIES.find((c) => c.code === 'ZM')
const TZ = PAYOUT_COUNTRIES.find((c) => c.code === 'TZ')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

// ---------------------------------------------------------------------------
// Kenya — international + national
// ---------------------------------------------------------------------------

test('KE international (+254): exact, Safaricom, builds Tando (bitcoin.co.ke) address', () => {
  const r = recognizePhoneNumber('+254712345678')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.ambiguous, false)
  assert.equal(r.operator, 'Safaricom')
  assert.equal(r.nsn, '712345678')
  assert.equal(r.e164, '+254712345678')
  assert.equal(r.display, '+254 712 345 678')
  assert.equal(r.lightningAddress, '254712345678@bitcoin.co.ke')
  assert.equal(r.localPartVerified, true) // Tando format verified live (bitcoin.co.ke)
})

test('KE international without "+" (254...) is still exact', () => {
  const r = recognizePhoneNumber('254712345678')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'exact')
})

test('KE national (0110...): high confidence, single country', () => {
  // 011x (Safaricom) is Kenya-only: neither Zambia nor Tanzania has 1x mobile.
  const r = recognizePhoneNumber('0110123456')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'high')
  assert.equal(r.ambiguous, false)
  assert.equal(r.lightningAddress, '254110123456@bitcoin.co.ke')
})

test('KE 011x Safaricom block', () => {
  assert.equal(recognizePhoneNumber('0110123456').operator, 'Safaricom')
})

test('KE 010x Airtel block', () => {
  assert.equal(recognizePhoneNumber('0100123456').operator, 'Airtel')
})

test('KE 01x and 070-073 blocks are Kenya-only (no TZ/ZM overlap)', () => {
  // 1x has no mobile in TZ/ZM. ChapSmart is Vodacom-only, and Vodacom does not
  // hold 70/71/72/73, so those Kenyan blocks stay unambiguous Kenya.
  for (const n of ['0100123456', '0110123456', '0700123456', '0710123456', '0720123456', '0730123456']) {
    const r = recognizePhoneNumber(n)
    assert.equal(r.country.code, 'KE', `${n} should be KE`)
    assert.equal(r.ambiguous, false, `${n} should be unambiguous`)
  }
})

test('KE special ranges flagged (199 test/research)', () => {
  const r = recognizePhoneNumber('0199123456')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.operator, 'Test / Research')
  assert.equal(r.operatorSpecial, true)
})

// ---------------------------------------------------------------------------
// Zambia — international + national
// ---------------------------------------------------------------------------

test('ZM international (+260): exact, Airtel, builds bitzed address', () => {
  const r = recognizePhoneNumber('+260978123456')
  assert.equal(r.country.code, 'ZM')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.operator, 'Airtel')
  assert.equal(r.e164, '+260978123456')
  assert.equal(r.display, '+260 978 123 456')
  assert.equal(r.lightningAddress, '260978123456@bitzed.xyz') // verified live
  assert.equal(r.localPartVerified, true)
})

test('ZM national (0978...): high confidence, single country', () => {
  const r = recognizePhoneNumber('0978123456')
  assert.equal(r.country.code, 'ZM')
  assert.equal(r.confidence, 'high')
  assert.equal(r.lightningAddress, '260978123456@bitzed.xyz')
})

test('ZM 09x and 05x are Zambia-only (KE/TZ have no 09/05 mobile)', () => {
  assert.equal(recognizePhoneNumber('0961234567').country.code, 'ZM') // MTN
  assert.equal(recognizePhoneNumber('0951234567').country.code, 'ZM') // Zamtel
  assert.equal(recognizePhoneNumber('0981234567').country.code, 'ZM') // Beeline
  assert.equal(recognizePhoneNumber('0571234567').country.code, 'ZM') // Airtel 57
})

test('ZM operator mapping (97 Airtel / 96 MTN / 95 Zamtel / 98 Beeline)', () => {
  assert.equal(recognizePhoneNumber('+260971234567').operator, 'Airtel')
  assert.equal(recognizePhoneNumber('+260961234567').operator, 'MTN')
  assert.equal(recognizePhoneNumber('+260951234567').operator, 'Zamtel')
  assert.equal(recognizePhoneNumber('+260981234567').operator, 'Beeline')
})

// ---------------------------------------------------------------------------
// Tanzania — international + national
// ---------------------------------------------------------------------------

test('TZ international (+255): exact, Vodacom, builds ChapSmart (chapsmart.com) address', () => {
  const r = recognizePhoneNumber('+255740034110') // the live smoke-test number
  assert.equal(r.country.code, 'TZ')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.ambiguous, false)
  assert.equal(r.operator, 'Vodacom')
  assert.equal(r.nsn, '740034110')
  assert.equal(r.e164, '+255740034110')
  assert.equal(r.display, '+255 740 034 110')
  assert.equal(r.lightningAddress, '255740034110@chapsmart.com')
  assert.equal(r.localPartVerified, true)
})

test('TZ is Vodacom-only: non-Vodacom TZ networks are NOT recognized (would dead-end)', () => {
  // ChapSmart rejects non-Vodacom numbers, so we must not recognize them.
  // 06x (Halotel/Yas/Airtel) and the Vodacom-absent 07x blocks (Yas 77, Airtel
  // 78) are not valid Tanzanian destinations for us.
  assert.equal(recognizePhoneNumber('+255611234567'), null) // Halotel 61
  assert.equal(recognizePhoneNumber('+255651234567'), null) // Yas 65
  assert.equal(recognizePhoneNumber('+255681234567'), null) // Airtel 68
  assert.equal(recognizePhoneNumber('+255771234567'), null) // Yas 77
  assert.equal(recognizePhoneNumber('+255781234567'), null) // Airtel 78
})

test('TZ operator mapping is Vodacom-only (74/75/76/79)', () => {
  const op = (i) => recognizePhoneNumber(i).operator
  assert.equal(op('+255740000000'), 'Vodacom')
  assert.equal(op('+255750000000'), 'Vodacom')
  assert.equal(op('+255760000000'), 'Vodacom')
  assert.equal(op('+255790000000'), 'Vodacom')
})

// ---------------------------------------------------------------------------
// Cross-country collisions on the bare national (0...) form
// ---------------------------------------------------------------------------

test('three-way ambiguous 075 (national): KE/ZM/TZ candidates, default preselected', () => {
  // 75 is valid mobile in Kenya (Airtel 750-756), Zambia (Zamtel) AND Tanzania
  // (Vodacom) — the only kind of triple collision left after Vodacom-only TZ.
  const r = recognizePhoneNumber('0751234567')
  assert.equal(r.ambiguous, true)
  assert.equal(r.confidence, 'ambiguous')
  assert.ok(Array.isArray(r.candidates))
  assert.equal(r.candidates.length, 3)
  // preselected entry matches the default and is the top-level result
  assert.equal(r.country.code, AMBIGUOUS_DEFAULT_CODE)
  assert.equal(r.candidates[0].country.code, AMBIGUOUS_DEFAULT_CODE)
  const codes = r.candidates.map((c) => c.country.code).sort()
  assert.deepEqual(codes, ['KE', 'TZ', 'ZM'])
  // each candidate carries its own provider address
  const ke = r.candidates.find((c) => c.country.code === 'KE')
  const zm = r.candidates.find((c) => c.country.code === 'ZM')
  const tz = r.candidates.find((c) => c.country.code === 'TZ')
  assert.equal(ke.lightningAddress, '254751234567@bitcoin.co.ke')
  assert.equal(zm.lightningAddress, '260751234567@bitzed.xyz')
  assert.equal(tz.lightningAddress, '255751234567@chapsmart.com')
})

test('075/076 are three-way (KE/ZM/TZ); 077/078 are two-way KE/ZM (77/78 are not Vodacom)', () => {
  for (const p of ['75', '76']) {
    const r = recognizePhoneNumber(`0${p}1234567`)
    assert.equal(r.candidates.length, 3, `0${p}... should be three-way`)
  }
  for (const p of ['77', '78']) {
    const r = recognizePhoneNumber(`0${p}1234567`)
    assert.equal(r.ambiguous, true, `0${p}... should be ambiguous`)
    const codes = r.candidates.map((c) => c.country.code).sort()
    assert.deepEqual(codes, ['KE', 'ZM'], `0${p}... should be KE/ZM only`)
  }
})

test('074/079 are two-way ambiguous KE/TZ (Vodacom; Zambia has no 74/79)', () => {
  for (const n of ['0745123456', '0791234567']) {
    const r = recognizePhoneNumber(n)
    assert.equal(r.ambiguous, true, `${n} should be ambiguous`)
    const codes = r.candidates.map((c) => c.country.code).sort()
    assert.deepEqual(codes, ['KE', 'TZ'], `${n} should be KE/TZ`)
  }
})

test('a calling code resolves the collision exactly (no ambiguity)', () => {
  // 075 is valid mobile in all three countries; the calling code disambiguates.
  assert.equal(recognizePhoneNumber('+254751234567').country.code, 'KE')
  assert.equal(recognizePhoneNumber('+254751234567').ambiguous, false)
  assert.equal(recognizePhoneNumber('+260751234567').country.code, 'ZM')
  assert.equal(recognizePhoneNumber('+260751234567').ambiguous, false)
  assert.equal(recognizePhoneNumber('+255751234567').country.code, 'TZ')
  assert.equal(recognizePhoneNumber('+255751234567').ambiguous, false)
})

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('normalizes spaces, dashes, parens, dots', () => {
  for (const n of ['+254 110 123 456', '0110-123-456', '(0110) 123.456', ' 0110123456 ']) {
    const r = recognizePhoneNumber(n)
    assert.ok(r, `${n} should be recognized`)
    assert.equal(r.country.code, 'KE')
    assert.equal(r.nsn, '110123456')
  }
})

test('00 international access code behaves like "+"', () => {
  const r = recognizePhoneNumber('00260978123456')
  assert.equal(r.country.code, 'ZM')
  assert.equal(r.confidence, 'exact')
})

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

test('rejects bare NSN with no trunk 0 and no calling code', () => {
  assert.equal(recognizePhoneNumber('712345678'), null)
  assert.equal(recognizePhoneNumber('978123456'), null)
})

test('rejects foreign calling codes we do not serve', () => {
  assert.equal(recognizePhoneNumber('+15551234567'), null)
  assert.equal(recognizePhoneNumber('+447911123456'), null)
})

test('rejects unassigned / non-Vodacom ranges (KE, ZM, TZ)', () => {
  assert.equal(recognizePhoneNumber('0109123456'), null) // KE 109 unassigned; no ZM/TZ 10
  assert.equal(recognizePhoneNumber('0123456789'), null) // KE 123 unassigned; no ZM/TZ 12
  // Tanzania is Vodacom-only: every 06x number is a non-Vodacom network and has
  // no Kenyan/Zambian counterpart, so it is unrecognized rather than a dead-end.
  assert.equal(recognizePhoneNumber('0611234567'), null) // TZ Halotel 61 (not Vodacom)
  assert.equal(recognizePhoneNumber('0651234567'), null) // TZ Yas 65 (not Vodacom)
  assert.equal(recognizePhoneNumber('0681234567'), null) // TZ Airtel 68 (not Vodacom)
  assert.equal(recognizePhoneNumber('0601234567'), null) // TZ 60 reserved; no KE/ZM 60
})

test('rejects wrong-length numbers', () => {
  assert.equal(recognizePhoneNumber('071234567'), null) // too short
  assert.equal(recognizePhoneNumber('07123456789'), null) // too long
})

test('rejects non-phone input (letters / @ / empty / non-strings)', () => {
  assert.equal(recognizePhoneNumber('alice@example.com'), null)
  assert.equal(recognizePhoneNumber('lnbc10n1pjxyz'), null)
  assert.equal(recognizePhoneNumber(''), null)
  assert.equal(recognizePhoneNumber('   '), null)
  assert.equal(recognizePhoneNumber(null), null)
  assert.equal(recognizePhoneNumber(undefined), null)
  assert.equal(recognizePhoneNumber(254712345678), null) // number, not string
})

// ---------------------------------------------------------------------------
// Helpers (direct)
// ---------------------------------------------------------------------------

test('matchOperator / isValidMobile direct', () => {
  assert.equal(matchOperator(KE, '712345678').name, 'Safaricom')
  assert.equal(matchOperator(KE, '770123456').name, 'Telkom')
  assert.equal(matchOperator(ZM, '978123456').name, 'Airtel')
  assert.equal(matchOperator(TZ, '740034110').name, 'Vodacom')
  assert.equal(matchOperator(TZ, '730000000'), null) // 73 (TTCL) not paid by ChapSmart
  assert.equal(matchOperator(KE, '999999999'), null)
  assert.equal(isValidMobile(ZM, '961234567'), true)
  assert.equal(isValidMobile(TZ, '751234567'), true) // Vodacom 75
  assert.equal(isValidMobile(TZ, '611234567'), false) // Halotel 61 (not Vodacom)
  assert.equal(isValidMobile(ZM, '111234567'), false)
})

test('formatInternational / formatE164 / buildLightningAddress', () => {
  assert.equal(formatInternational(KE, '712345678'), '+254 712 345 678')
  assert.equal(formatInternational(ZM, '978123456'), '+260 978 123 456')
  assert.equal(formatInternational(TZ, '740034110'), '+255 740 034 110')
  assert.equal(formatE164(KE, '712345678'), '+254712345678')
  assert.equal(buildLightningAddress(KE, '712345678'), '254712345678@bitcoin.co.ke')
  assert.equal(buildLightningAddress(ZM, '978123456'), '260978123456@bitzed.xyz')
  assert.equal(buildLightningAddress(TZ, '740034110'), '255740034110@chapsmart.com')
})

test('formatPhoneHandle: normalizes a known-country handle to international', () => {
  // local, international, and bare-NSN handles all render the same way
  assert.equal(formatPhoneHandle('ZM', '0777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('ZM', '260777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('ZM', '777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('KE', '0712345678'), '+254 712 345 678')
  assert.equal(formatPhoneHandle('TZ', '0740034110'), '+255 740 034 110')
  assert.equal(formatPhoneHandle('TZ', '255740034110'), '+255 740 034 110')
  // unknown country / non-phone / non-string -> returned unchanged
  assert.equal(formatPhoneHandle('XX', '0777491011'), '0777491011')
  assert.equal(formatPhoneHandle('ZM', 'not-a-number'), 'not-a-number')
  assert.equal(formatPhoneHandle('ZM', null), null)
})

// ── Ghana (BitSpenda) ──────────────────────────────────────────────────────

test('Ghana: a typed number is built the same way as the other three', () => {
  // bitspenda.app resolves both local and international local-parts to the
  // same payout, so Ghana constructs the international form like Kenya,
  // Zambia and Tanzania rather than inventing a fourth convention.
  for (const typed of ['0246341938', '233246341938', '+233 24 634 1938', '+233 246 341 938']) {
    const r = recognizePhoneNumber(typed)
    assert.ok(r, `${typed}: no match`)
    assert.equal(r.country.code, 'GH', typed)
    assert.equal(r.lightningAddress, '233246341938@bitspenda.app', typed)
    assert.equal(r.display, '+233 246 341 938', typed)
  }
})

test('every country builds its address the same way', () => {
  // A fourth country is a row in the registry, not a fourth convention.
  for (const country of PAYOUT_COUNTRIES) {
    assert.equal(country.localPartFormat, 'international', country.code)
    assert.equal(country.trunkPrefix, '0', country.code)
    assert.equal(country.nsnLength, 9, country.code)
  }
})

test('Ghana: every MTN block BitSpenda documents', () => {
  // Their docs: "Only MTN Ghana numbers 024 054 055 059 prefixes are
  // currently supported". The table is the provider's, not the regulator's.
  for (const prefix of ['24', '54', '55', '59']) {
    const r = recognizePhoneNumber(`0${prefix}6341938`)
    assert.ok(r, `0${prefix}...: no match`)
    assert.equal(r.country.code, 'GH')
    assert.equal(r.operator, 'MTN')
  }
})

test('Ghana: a number BitSpenda will not pay never resolves to Ghana', () => {
  // Two different live rejections, and both have to stop here rather than at
  // resolution: 020/026/027/050/056/057 are real Ghanaian numbers on other
  // networks ("only MTN Mobile Money supported"), and 023/025/028/029/051/
  // 052/058 are not Ghanaian mobile prefixes at all ("unsupported phone
  // prefix"). Reaching an address that always fails is worse than no match.
  for (const prefix of ['20', '26', '27', '50', '56', '57', '23', '25', '28', '29', '51', '52', '58']) {
    assert.notEqual(recognizePhoneNumber(`0${prefix}6341938`)?.country?.code, 'GH', `0${prefix}...`)
  }
})

test('Ghana: 053 is left out even though the live endpoint takes it', () => {
  // Their LNURL layer is more permissive than their documentation. Resolving
  // is not paying, and a settled invoice cannot be refunded, so we follow the
  // documented set until BitSpenda confirms 053 in writing.
  assert.notEqual(recognizePhoneNumber('0536341938')?.country?.code, 'GH')
  assert.equal(recognizePhoneNumberForCountry('GH', '0536341938'), null)
})

test('Ghana: tapping the country chip refuses a non-MTN Ghanaian number', () => {
  // The chip is what a Ghanaian on another network will use, and it is where
  // the refusal has to be honest. 057 is a real AirtelTigo block, and it is
  // also a Zambian Airtel block, so untapped it resolves to Zambia (see the
  // collision test below). Locked to Ghana it must simply not match.
  for (const prefix of ['20', '26', '27', '50', '56', '57']) {
    assert.equal(recognizePhoneNumberForCountry('GH', `0${prefix}6341938`), null, `0${prefix}...`)
  }
  assert.ok(recognizePhoneNumberForCountry('GH', '0246341938'), 'MTN still resolves')
})

test('the one prefix Ghana shares with a country already served is 057', () => {
  // Ghana does not create this: 057 resolved to Zambian Airtel before Ghana
  // existed. But Ghana brings users who will type it, so it is pinned here.
  // BitSpenda would refuse 057 anyway, and the country chip refuses it above.
  // If a future country changes this set, this test says so out loud.
  const collisions = []
  for (const prefix of ['20', '23', '24', '25', '26', '27', '28', '29',
    '50', '51', '52', '53', '54', '55', '56', '57', '58', '59']) {
    const r = recognizePhoneNumber(`0${prefix}6341938`)
    if (r && r.country.code !== 'GH') collisions.push(`0${prefix}->${r.country.code}`)
  }
  assert.deepEqual(collisions, ['057->ZM'])
})

test('a partial-network country says so, and it is not a Ghana special case', () => {
  // `operators` is also the validity rule, so where a provider pays only some
  // of a country's networks a customer on another one is told their own
  // number is invalid. Tanzania has had that problem since ChapSmart shipped
  // (Vodacom only); the field is shared, and the UI reads it before the first
  // keystroke.
  const noted = PAYOUT_COUNTRIES.filter((c) => c.networkNote).map((c) => c.code)
  assert.deepEqual(noted, ['TZ', 'GH'])
  for (const code of noted) {
    const country = PAYOUT_COUNTRIES.find((c) => c.code === code)
    assert.equal(country.operators.length, 1, `${code}: a note implies one paid network`)
  }
})

test('Ghana adds no ambiguity to the countries already served', () => {
  // GH blocks are 2-digit (24/53/54/55/59); ZM and TZ are 2-digit but
  // disjoint, and KE's are 3-digit. Nothing typed for Ghana may resolve
  // anywhere else, and nothing already served may start resolving to Ghana.
  for (const prefix of ['24', '54', '55', '59']) {
    const r = recognizePhoneNumber(`0${prefix}6341938`)
    assert.equal(r.ambiguous, false, `0${prefix}... became ambiguous`)
    assert.equal(r.candidates, undefined)
  }
  const gh = PAYOUT_COUNTRIES.find((c) => c.code === 'GH')
  for (const other of PAYOUT_COUNTRIES.filter((c) => c.code !== 'GH')) {
    for (const op of gh.operators) {
      for (const prefix of op.prefixes) {
        assert.ok(
          !isValidMobile(other, `${prefix}6341938`.slice(0, other.nsnLength)),
          `GH ${prefix} also validates in ${other.code}`,
        )
      }
    }
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
