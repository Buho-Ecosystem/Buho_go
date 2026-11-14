import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePaymentAmountInput as normalize } from '../paymentAmountInput.js'

test('locale decimals normalize without multiplying the draft', () => {
  for (const [locale, input, precision, expected] of [
    ['de', '10,5', 2, '10.5'], ['es', '10,50', 2, '10.50'], ['en-US', '10.5', 2, '10.5'],
    ['de', '0,00000029', 8, '0.00000029'], ['de', '0.00000029', 8, '0.00000029'],
    ['de', '1.234,56', 2, '1234.56'], ['en-US', '1,234.56', 2, '1234.56'],
    ['de', '2.400', 0, '2400'], ['en-US', '2,400', 0, '2400'], ['de', '2.400.000', 2, '2400000'],
    ['de', '2\u202f400', 0, '2400'],
  ]) {
    const result = normalize(input, { locale, precision })
    assert.equal(result.error, null, `${locale} ${input}`)
    assert.equal(result.value, expected)
    assert.equal(result.complete, true)
  }
})

test('ambiguous, malformed and excessive precision never silently changes the payment', () => {
  for (const [locale, precision, inputs] of [
    ['de', 0, ['2.40', '2,40', '2,5', '2.5', '2.400,00']],
    ['en-US', 0, ['2,40', '2.40', '2.5', '2,400.00']],
    ['de', 8, ['1.234', '0,000000299', '1.23.456', '1,2,3']],
    ['en-US', 8, ['0.000000299', '1,23', '1.2.3']],
    ['de', 2, ['10,123', '1.234', '1.234,567']],
    ['de', 0, ['-1', '+1', '1e3', '€ 10', '2 40']],
  ]) for (const input of inputs) {
    const result = normalize(input, { locale, precision })
    assert.ok(result.error, `${locale} ${input}`)
    assert.equal(result.value, input, 'keep the invalid input available for correction')
    assert.equal(result.complete, false)
  }
})

test('partial editing, canonical drafts and caret positions stay usable', () => {
  assert.deepEqual(normalize('10,', { locale: 'de', precision: 2, caret: 3 }), { value: '10.', error: null, complete: false, caret: 3 })
  assert.equal(normalize('10.', { locale: 'de', precision: 2 }).error, null)
  assert.equal(normalize('10.5', { locale: 'de', precision: 2 }).value, '10.5')
  assert.equal(normalize('0,', { locale: 'de', precision: 8 }).value, '0.')
  assert.equal(normalize('', { locale: 'de', precision: 2 }).error, null)
  assert.equal(normalize('2,400', { locale: 'en-US', precision: 0, caret: 5 }).caret, 4)
  assert.equal(normalize(',', { locale: 'de', precision: 2, caret: 1 }).value, '0.')
})

test('payout precision is explicit, including whole-unit local currencies', () => {
  assert.equal(normalize('10,25', { locale: 'de', precision: 2 }).value, '10.25')
  assert.ok(normalize('10,251', { locale: 'de', precision: 2 }).error)
  assert.equal(normalize('10', { locale: 'de', precision: 0 }).value, '10')
  assert.ok(normalize('10,5', { locale: 'de', precision: 0 }).error)
})

test('known canonical decimal edits retain meaning without relaxing precision or structure', () => {
  assert.equal(normalize('1.234', { locale: 'de', precision: 8, canonicalDecimal: true }).value, '1.234')
  assert.ok(normalize('1.234', { locale: 'de', precision: 8 }).error, 'new ambiguous values still reject')
  for (const [input, precision] of [['1.234', 2], ['1.234567891', 8], ['1.23.4', 8], ['1,2,3', 8]]) {
    assert.ok(normalize(input, { locale: 'de', precision, canonicalDecimal: true }).error, input)
  }
})
