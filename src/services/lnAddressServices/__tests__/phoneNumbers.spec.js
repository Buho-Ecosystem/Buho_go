/**
 * phoneNumbers — Kenyan / Zambian mobile recognition + Lightning-address
 * construction tests.
 *
 * Coverage focus:
 *   - international (+CC) and national (0...) recognition for both countries
 *   - operator detection from the published prefix tables
 *   - the 075-078 KE/ZM collision (ambiguous, both candidates, KE preselected)
 *   - normalization of human punctuation, "+" and "00" markers
 *   - constructed Lightning Address shape per provider
 *   - rejection of foreign / unassigned / bare-NSN / junk inputs
 *
 * Run directly with Node:
 *   node src/services/lnAddressServices/__tests__/phoneNumbers.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  recognizePhoneNumber,
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

test('KE international (+254): exact, Safaricom, builds tando address', () => {
  const r = recognizePhoneNumber('+254712345678')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'exact')
  assert.equal(r.ambiguous, false)
  assert.equal(r.operator, 'Safaricom')
  assert.equal(r.nsn, '712345678')
  assert.equal(r.e164, '+254712345678')
  assert.equal(r.display, '+254 712 345 678')
  assert.equal(r.lightningAddress, '254712345678@tando.me')
  assert.equal(r.localPartVerified, false) // Tando format unconfirmed
})

test('KE international without "+" (254...) is still exact', () => {
  const r = recognizePhoneNumber('254712345678')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'exact')
})

test('KE national (0712...): high confidence, single country', () => {
  const r = recognizePhoneNumber('0712345678')
  assert.equal(r.country.code, 'KE')
  assert.equal(r.confidence, 'high')
  assert.equal(r.ambiguous, false)
  assert.equal(r.lightningAddress, '254712345678@tando.me')
})

test('KE 011x Safaricom block', () => {
  assert.equal(recognizePhoneNumber('0110123456').operator, 'Safaricom')
})

test('KE 010x Airtel block', () => {
  assert.equal(recognizePhoneNumber('0100123456').operator, 'Airtel')
})

test('KE 070-074 / 079 are Kenya-only (no ZM collision)', () => {
  for (const n of ['0700123456', '0741123456', '0799123456']) {
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

test('ZM 09x and 05x are Zambia-only (Kenya has no 09/05 mobile)', () => {
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
// The 075-078 collision
// ---------------------------------------------------------------------------

test('ambiguous 077 (national): both candidates, KE preselected', () => {
  const r = recognizePhoneNumber('0771234567')
  assert.equal(r.ambiguous, true)
  assert.equal(r.confidence, 'ambiguous')
  assert.ok(Array.isArray(r.candidates))
  assert.equal(r.candidates.length, 2)
  // preselected entry matches the default and is the top-level result
  assert.equal(r.country.code, AMBIGUOUS_DEFAULT_CODE)
  assert.equal(r.candidates[0].country.code, AMBIGUOUS_DEFAULT_CODE)
  const codes = r.candidates.map((c) => c.country.code).sort()
  assert.deepEqual(codes, ['KE', 'ZM'])
  // each candidate carries its own provider address
  const ke = r.candidates.find((c) => c.country.code === 'KE')
  const zm = r.candidates.find((c) => c.country.code === 'ZM')
  assert.equal(ke.lightningAddress, '254771234567@tando.me')
  assert.equal(zm.lightningAddress, '260771234567@bitzed.xyz')
})

test('all four colliding prefixes (075-078) are ambiguous as national', () => {
  for (const p of ['075', '076', '077', '078']) {
    const r = recognizePhoneNumber(`0${p.slice(1)}1234567`)
    assert.equal(r.ambiguous, true, `0${p.slice(1)}... should be ambiguous`)
  }
})

test('a calling code resolves the collision exactly (no ambiguity)', () => {
  assert.equal(recognizePhoneNumber('+254771234567').country.code, 'KE')
  assert.equal(recognizePhoneNumber('+254771234567').ambiguous, false)
  assert.equal(recognizePhoneNumber('+260771234567').country.code, 'ZM')
  assert.equal(recognizePhoneNumber('+260771234567').ambiguous, false)
})

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('normalizes spaces, dashes, parens, dots', () => {
  for (const n of ['+254 712 345 678', '0712-345-678', '(0712) 345.678', ' 0712345678 ']) {
    const r = recognizePhoneNumber(n)
    assert.ok(r, `${n} should be recognized`)
    assert.equal(r.country.code, 'KE')
    assert.equal(r.nsn, '712345678')
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

test('rejects unassigned KE/ZM ranges', () => {
  assert.equal(recognizePhoneNumber('0109123456'), null) // KE 109 unassigned, no ZM 10
  assert.equal(recognizePhoneNumber('0123456789'), null) // KE 123 unassigned, no ZM 12
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
  assert.equal(matchOperator(KE, '999999999'), null)
  assert.equal(isValidMobile(ZM, '961234567'), true)
  assert.equal(isValidMobile(ZM, '111234567'), false)
})

test('formatInternational / formatE164 / buildLightningAddress', () => {
  assert.equal(formatInternational(KE, '712345678'), '+254 712 345 678')
  assert.equal(formatInternational(ZM, '978123456'), '+260 978 123 456')
  assert.equal(formatE164(KE, '712345678'), '+254712345678')
  assert.equal(buildLightningAddress(KE, '712345678'), '254712345678@tando.me')
  assert.equal(buildLightningAddress(ZM, '978123456'), '260978123456@bitzed.xyz')
})

test('formatPhoneHandle: normalizes a known-country handle to international', () => {
  // local, international, and bare-NSN handles all render the same way
  assert.equal(formatPhoneHandle('ZM', '0777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('ZM', '260777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('ZM', '777491011'), '+260 777 491 011')
  assert.equal(formatPhoneHandle('KE', '0712345678'), '+254 712 345 678')
  // unknown country / non-phone / non-string -> returned unchanged
  assert.equal(formatPhoneHandle('XX', '0777491011'), '0777491011')
  assert.equal(formatPhoneHandle('ZM', 'not-a-number'), 'not-a-number')
  assert.equal(formatPhoneHandle('ZM', null), null)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
