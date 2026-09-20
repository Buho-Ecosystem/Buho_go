/**
 * The fiat currency table is one file so that adding a currency is a single
 * edit. These tests keep that promise honest: a code that is offered in the
 * picker but is missing a symbol, a flag, or a rate source would show up as
 * a blank badge or a permanent "rates unavailable" for that user.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/fiatCurrencies.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  FIAT_SYMBOLS,
  FIAT_FLAGS,
  MEMPOOL_RATE_CURRENCIES,
  ALBY_RATE_CURRENCIES,
  SELECTABLE_FIAT_CURRENCIES,
  fiatSymbol,
  fiatFlag,
} from '../fiatCurrencies.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
    failed += 1
  }
}

console.log('fiatCurrencies')

test('every selectable currency has a display symbol', () => {
  for (const code of SELECTABLE_FIAT_CURRENCIES) {
    assert.ok(FIAT_SYMBOLS[code], `${code} has no symbol`)
  }
})

test('every selectable currency has a flag', () => {
  for (const code of SELECTABLE_FIAT_CURRENCIES) {
    assert.ok(FIAT_FLAGS[code], `${code} has no flag`)
  }
})

test('every selectable currency has exactly one rate source', () => {
  for (const code of SELECTABLE_FIAT_CURRENCIES) {
    const fromMempool = MEMPOOL_RATE_CURRENCIES.includes(code)
    const fromAlby = ALBY_RATE_CURRENCIES.includes(code)
    assert.ok(fromMempool || fromAlby, `${code} has no rate source`)
    assert.ok(!(fromMempool && fromAlby), `${code} is fetched twice`)
  }
})

test('no list carries a duplicate code', () => {
  for (const list of [MEMPOOL_RATE_CURRENCIES, ALBY_RATE_CURRENCIES, SELECTABLE_FIAT_CURRENCIES]) {
    assert.equal(new Set(list).size, list.length, `duplicate in ${list.join(',')}`)
  }
})

test('codes are upper-case ISO 4217 throughout', () => {
  const all = [
    ...Object.keys(FIAT_SYMBOLS),
    ...Object.keys(FIAT_FLAGS),
    ...MEMPOOL_RATE_CURRENCIES,
    ...ALBY_RATE_CURRENCIES,
    ...SELECTABLE_FIAT_CURRENCIES,
  ]
  for (const code of all) {
    assert.match(code, /^[A-Z]{3}$/, `${code} is not a 3-letter upper-case code`)
  }
})

test('fiatSymbol is case-insensitive and falls back to the code', () => {
  assert.equal(fiatSymbol('brl'), 'R$')
  assert.equal(fiatSymbol('BRL'), 'R$')
  assert.equal(fiatSymbol('xyz'), 'XYZ ')
  assert.equal(fiatSymbol(''), ' ')
  assert.equal(fiatSymbol(undefined), ' ')
})

test('fiatFlag is case-insensitive and falls back to a neutral glyph', () => {
  assert.equal(fiatFlag('brl'), FIAT_FLAGS.BRL)
  assert.equal(fiatFlag('xyz'), '💱')
  assert.equal(fiatFlag(undefined), '💱')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
