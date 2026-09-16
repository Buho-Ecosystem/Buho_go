/**
 * nadanada catalog normalisers — eSIM + VPN shape tests.
 *
 * Coverage focus:
 *   - country/region/bundle normalisation from the live API shapes
 *   - bundle sorting (data asc, duration asc, unlimited last)
 *   - VPN country flag/name splitting and duration label pluralisation
 *   - duration sort (cheapest first)
 *   - junk inputs return null rather than throwing
 *
 * Run directly with Node:
 *   node src/services/nadanada/__tests__/normalizers.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  normalizeCountry,
  normalizeRegion,
  normalizeBundle,
  sortBundles,
  deriveEsimState,
  declaredBundleBytes,
  unitsAreBytes,
} from '../esim.js'
import {
  normalizeVpnCountry,
  normalizeDuration,
  sortDurations,
  deriveVpnState,
} from '../vpn.js'

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
// eSIM
// ---------------------------------------------------------------------------

test('normalizeCountry maps the live shape', () => {
  const c = normalizeCountry({ code: 'AL', name: 'Albania', flag: '🇦🇱', slug: 'albania' })
  assert.deepEqual(c, { code: 'AL', name: 'Albania', flag: '🇦🇱', slug: 'albania' })
})

test('normalizeCountry rejects records without a slug', () => {
  assert.equal(normalizeCountry({ code: 'XX', name: 'No Slug' }), null)
  assert.equal(normalizeCountry(null), null)
})

test('normalizeRegion handles object and string forms', () => {
  assert.deepEqual(normalizeRegion({ name: 'Europe', slug: 'europe' }), { name: 'Europe', slug: 'europe' })
  assert.deepEqual(normalizeRegion('Middle East'), { name: 'Middle East', slug: 'middle-east' })
})

test('normalizeBundle sends the catalog name to the purchase endpoint', () => {
  const b = normalizeBundle({
    name: 'fixed_1GB_7D_AT',
    description: 'eSIM, 1GB, 7 Days, Austria',
    dataInGB: 1,
    durationInDays: 7,
    countryName: 'Austria',
    price: 0.99,
    unlimited: false,
  })
  // nadanada documents the catalog name as the canonical purchase input and
  // resolves it to the consumption SKU itself. An earlier build rewrote this
  // to an invented `esim_*_V2` form that appears nowhere in their spec.
  assert.equal(b.bundleName, 'fixed_1GB_7D_AT')
  assert.equal(b.rawName, 'fixed_1GB_7D_AT')
  assert.equal(b.dataInGB, 1)
  assert.equal(b.durationInDays, 7)
  assert.equal(b.priceUsd, 0.99)
  assert.equal(b.unlimited, false)
})

test('normalizeBundle rejects records without a name', () => {
  assert.equal(normalizeBundle({ dataInGB: 1 }), null)
})

test('sortBundles orders by data then duration, unlimited last', () => {
  const out = sortBundles([
    { bundleName: 'c', dataInGB: 3, durationInDays: 30, unlimited: false },
    { bundleName: 'u', dataInGB: null, durationInDays: 30, unlimited: true },
    { bundleName: 'a', dataInGB: 1, durationInDays: 7, unlimited: false },
    { bundleName: 'b', dataInGB: 1, durationInDays: 30, unlimited: false },
  ])
  assert.deepEqual(out.map((x) => x.bundleName), ['a', 'b', 'c', 'u'])
})

// ---------------------------------------------------------------------------
// VPN
// ---------------------------------------------------------------------------

test('normalizeVpnCountry splits the flag and cleans the name', () => {
  const c = normalizeVpnCountry({ code: '13', name: '🇺🇸 United-States', isoCode: 'US' })
  assert.equal(c.code, '13')
  assert.equal(c.isoCode, 'US')
  assert.equal(c.flag, '🇺🇸')
  assert.equal(c.name, 'United States')
})

test('normalizeVpnCountry coerces a numeric code to string', () => {
  const c = normalizeVpnCountry({ code: 13, name: 'Nowhere', isoCode: 'NW' })
  assert.equal(c.code, '13')
  assert.equal(c.flag, '')
  assert.equal(c.name, 'Nowhere')
})

test('normalizeDuration builds a pluralised label and keeps the value', () => {
  assert.equal(normalizeDuration({ duration: 0.5, price: 0.5, unit: 'day', amount: 1 }).label, '1 day')
  const yr = normalizeDuration({ duration: 30, price: 30, unit: 'year', amount: 1 })
  assert.equal(yr.label, '1 year')
  assert.equal(yr.value, 30)
  assert.equal(yr.priceUsd, 30)
  assert.equal(normalizeDuration({ duration: 7, price: 1.5, unit: 'month', amount: 3 }).label, '3 months')
})

test('normalizeDuration rejects records without a duration', () => {
  assert.equal(normalizeDuration({ price: 1 }), null)
})

// ---------------------------------------------------------------------------
// Derived state — what the product cards lead with
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-08-26T12:00:00Z')
const iso = (days) => new Date(NOW + days * 86400000).toISOString()

test('deriveEsimState reads active from the live assignment window', () => {
  const d = deriveEsimState({
    activeBundleCount: 1,
    usage: { percent: 12.5 },
    bundles: [{ startTime: iso(-3), endTime: iso(27), usage: { percent: 12.5 } }],
  }, NOW)
  assert.equal(d.state, 'active')
  assert.equal(d.daysLeft, 27)
  assert.equal(d.percent, 12.5)
})

test('deriveEsimState marks a past window expired', () => {
  const d = deriveEsimState({
    activeBundleCount: 0,
    usage: { percent: 100 },
    bundles: [{ startTime: iso(-40), endTime: iso(-10), usage: { percent: 100 } }],
  }, NOW)
  assert.equal(d.state, 'expired')
  assert.equal(d.daysLeft, 0)
})

test('deriveEsimState never guesses from profileStatus', () => {
  // profileStatus is a provider enum with no documented values, so an eSIM
  // with no assignment windows stays "unknown" rather than being called active.
  const d = deriveEsimState({ profileStatus: 'RELEASED', activeBundleCount: 0, bundles: [] }, NOW)
  assert.equal(d.state, 'unknown')
  assert.equal(d.endsAt, null)
})

test('deriveEsimState survives a null status', () => {
  assert.deepEqual(deriveEsimState(null, NOW), {
    state: 'unknown', endsAt: null, startsAt: null, daysLeft: null,
    percent: null, bytesUsed: null, bytesTotal: null,
  })
})

test('a data figure is only shown when the provider proves the unit', () => {
  // `provider_units` is undocumented. The one thing that pins it down is the
  // provider's own arithmetic: a bundle calling itself 1GB and reporting
  // 1000000000 units has said what a unit is. Live sample, 2026-08-26:
  // esimc_1GB_7D_DE_V2 -> totalInitialQuantity 1000000000.
  assert.equal(declaredBundleBytes('esimc_1GB_7D_DE_V2'), 1e9)
  assert.equal(declaredBundleBytes('eSIM, 500MB, 7 Days, Germany'), 5e8)
  assert.equal(declaredBundleBytes('esimc_unlimited_30D_DE'), null)

  assert.equal(unitsAreBytes({ initial: 1e9 }, 'esimc_1GB_7D_DE_V2'), true)
  // Disagreement means we do NOT know the unit — stay silent rather than lie
  // about how much allowance is left.
  assert.equal(unitsAreBytes({ initial: 1024 }, 'esimc_1GB_7D_DE_V2'), false)
  assert.equal(unitsAreBytes({ initial: 1e9 }, 'esimc_unlimited_30D_DE'), false)
  assert.equal(unitsAreBytes(null, 'esimc_1GB_7D_DE_V2'), false)
})

test('deriveEsimState exposes bytes only once confirmed', () => {
  const confirmed = deriveEsimState({
    activeBundleCount: 1,
    usage: { initial: 1e9, used: 4.14e8, percent: 41.4, isBytes: true },
    bundles: [{ startTime: iso(-1), endTime: iso(6) }],
  }, NOW)
  assert.equal(confirmed.bytesTotal, 1e9)
  assert.equal(confirmed.bytesUsed, 4.14e8)

  const unconfirmed = deriveEsimState({
    activeBundleCount: 1,
    usage: { initial: 1e9, used: 4.14e8, percent: 41.4, isBytes: false },
    bundles: [{ startTime: iso(-1), endTime: iso(6) }],
  }, NOW)
  assert.equal(unconfirmed.bytesTotal, null)
  assert.equal(unconfirmed.bytesUsed, null)
  assert.equal(unconfirmed.percent, 41.4, 'the percentage still carries the meaning')
})

test('deriveVpnState reports active, expired and paused', () => {
  assert.equal(deriveVpnState({ found: true, expiryDate: iso(10), isEnabled: true }, NOW).state, 'active')
  assert.equal(deriveVpnState({ found: true, expiryDate: iso(-1), isEnabled: true }, NOW).state, 'expired')
  assert.equal(deriveVpnState({ found: true, expiryDate: iso(10), isEnabled: false }, NOW).state, 'disabled')
  assert.equal(deriveVpnState({ found: false }, NOW).state, 'unknown')
})

test('deriveVpnState omits the meter unless both figures are reported', () => {
  // A bar drawn at 0% because the data is missing reads as broken.
  assert.equal(deriveVpnState({ found: true, expiryDate: iso(5), isEnabled: true, bandwidthUsed: 5 }, NOW).percent, null)
  const withBoth = deriveVpnState(
    { found: true, expiryDate: iso(5), isEnabled: true, bandwidthUsed: 25, bandwidthAllotted: 100 },
    NOW,
  )
  assert.equal(withBoth.percent, 25)
})

test('sortDurations orders cheapest first', () => {
  const out = sortDurations([
    { value: 30, label: '1 year' },
    { value: 0.5, label: '1 day' },
    { value: 3, label: '1 month' },
  ])
  assert.deepEqual(out.map((d) => d.value), [0.5, 3, 30])
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
