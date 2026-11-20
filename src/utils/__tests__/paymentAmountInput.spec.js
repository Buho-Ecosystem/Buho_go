import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePaymentAmountInput as normalize, parsePaymentAmount, formatPaymentAmountDraft as draftText, caretAcrossGrouping } from '../paymentAmountInput.js'

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
    ['en-US', 8, ['0.000000299', '1,2345', '1.2.3']],
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

test('the decimal the field wrote keeps its meaning without relaxing precision or structure', () => {
  assert.equal(normalize('1.234', { locale: 'de', precision: 8, decimalMark: '.' }).value, '1.234')
  assert.ok(normalize('1.234', { locale: 'de', precision: 8 }).error, 'new ambiguous values still reject')
  for (const [input, precision] of [['1.234', 2], ['1.234567891', 8], ['1.23.4', 8], ['1,2,3', 8]]) {
    assert.ok(normalize(input, { locale: 'de', precision, decimalMark: '.' }).error, input)
  }
})

test('the field writes a draft in the phone format, digit for digit', () => {
  // Editing: the decimal mark the person typed, never the internal dot.
  assert.equal(draftText('1.234', { locale: 'de' }), '1,234')
  assert.equal(draftText('1.', { locale: 'de' }), '1,')
  assert.equal(draftText('2400', { locale: 'de' }), '2400')
  // Resting: grouped as well, and exact past what a float can hold.
  assert.equal(draftText('2400', { locale: 'de', grouped: true }), '2.400')
  assert.equal(draftText('20999999.99999999', { locale: 'en-US', grouped: true }), '20,999,999.99999999')
  assert.equal(draftText('20999999.99999999', { locale: 'de', grouped: true }), '20.999.999,99999999')
  assert.equal(draftText('2,40', { locale: 'en-US' }), '2,40', 'a refused entry stays as typed')
  // Dropping the grouping keeps the caret, or a whole selection, on the same digits.
  assert.equal(caretAcrossGrouping('1.234,5', '1234,5', 3, { locale: 'de' }), 2)
  assert.equal(caretAcrossGrouping('1.234,5', '1234,5', 7, { locale: 'de' }), 6)
  assert.equal(caretAcrossGrouping('1.234,5', '1234,5', 0, { locale: 'de' }), 0)
})

test('the keypad decimal key works whatever the app language is', () => {
  // App in English, phone in German: the keypad types a comma.
  const mixed = { locales: ['en-US', 'de'] }
  for (const [input, precision, expected] of [
    ['1,5', 2, '1.5'], ['1.5', 2, '1.5'], ['12,50', 2, '12.50'], ['0,00002400', 8, '0.00002400'],
    ['1.234,56', 2, '1234.56'], ['1,234.56', 2, '1234.56'], ['2.400', 0, '2400'], ['2,400', 0, '2400'],
  ]) {
    const result = normalize(input, { ...mixed, precision })
    assert.equal(result.error, null, input)
    assert.equal(result.value, expected)
  }
  // Three digits after one mark could be thousands or a decimal: refused.
  for (const input of ['1,234', '1.234']) assert.equal(normalize(input, { ...mixed, precision: 8 }).error, 'ambiguous', input)
  assert.equal(normalize('1.234', { ...mixed, precision: 8, decimalMark: '.' }).value, '1.234')
  assert.equal(normalize('1,234', { ...mixed, precision: 8, decimalMark: ',' }).value, '1.234', 'a comma the field wrote stays a decimal')
  // Even with no language that uses a comma, one or two digits after it are a decimal.
  assert.equal(normalize('1,5', { locale: 'en-US', precision: 2 }).value, '1.5')
  assert.equal(normalize('1,23', { locale: 'en-US', precision: 8 }).value, '1.23')
  assert.deepEqual(normalize('1,', { locale: 'en-US', precision: 2, caret: 2 }), { value: '1.', error: null, complete: false, caret: 2 })
  assert.equal(normalize('1,234', { locale: 'en-US', precision: 2 }).value, '1234', 'a thousands group stays one')
  assert.ok(normalize('1,5', { locale: 'en-US', precision: 0 }).error, 'whole units take no decimal')
})

test('a finished field parses to a number or to nothing', () => {
  assert.equal(parsePaymentAmount('2,5', { locale: 'de', precision: 2 }), 2.5)
  assert.equal(parsePaymentAmount('2.500', { locale: 'de', precision: 0 }), 2500)
  assert.equal(parsePaymentAmount('2,500', { locale: 'en-US', precision: 0 }), 2500)
  assert.equal(parsePaymentAmount('2,5', { locale: 'de', precision: 0 }), null)
  assert.equal(parsePaymentAmount('2,', { locale: 'de', precision: 2 }), null)
  assert.equal(parsePaymentAmount('', { precision: 0 }), null)
  assert.equal(parsePaymentAmount('abc', { precision: 0 }), null)
})
