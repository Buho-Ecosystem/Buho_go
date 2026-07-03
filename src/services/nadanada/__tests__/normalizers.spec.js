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
  toPurchasableBundleName,
} from '../esim.js'
import {
  normalizeVpnCountry,
  normalizeDuration,
  sortDurations,
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

test('toPurchasableBundleName maps catalog name to the esim_*_V2 SKU', () => {
  // The purchase endpoint rejects the catalog `fixed_*` name and only accepts
  // the versioned eSIM SKU (verified live for AT/BR + the docs' JP example).
  assert.equal(toPurchasableBundleName('fixed_1GB_7D_AT'), 'esim_1GB_7D_AT_V2')
  assert.equal(toPurchasableBundleName('fixed_50GB_30D_BR'), 'esim_50GB_30D_BR_V2')
  // already a SKU / unknown shape -> passthrough
  assert.equal(toPurchasableBundleName('esim_1GB_7D_AT_V2'), 'esim_1GB_7D_AT_V2')
  assert.equal(toPurchasableBundleName(''), '')
})

test('normalizeBundle yields the purchasable SKU + keeps the raw name', () => {
  const b = normalizeBundle({
    name: 'fixed_1GB_7D_AT',
    description: 'eSIM, 1GB, 7 Days, Austria',
    dataInGB: 1,
    durationInDays: 7,
    countryName: 'Austria',
    price: 0.99,
    unlimited: false,
  })
  assert.equal(b.bundleName, 'esim_1GB_7D_AT_V2')
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
