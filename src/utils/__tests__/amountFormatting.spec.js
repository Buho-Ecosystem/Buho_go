import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paymentAmountParts, formatPaymentAmount, formatFiatAmount, fiatDecimals } from '../amountFormatting.js'

const NBSP = ' '

test('whole Bitcoin units group by locale and keep number and unit on one line', () => {
  assert.equal(formatPaymentAmount(2407, { kind: 'sats', bip177: true }, { locale: 'en-US' }), `₿${NBSP}2,407`)
  assert.equal(formatPaymentAmount(2407, { kind: 'sats', bip177: true }, { locale: 'de' }), `₿${NBSP}2.407`)
  assert.equal(formatPaymentAmount(2407, { kind: 'sats', bip177: false }, { locale: 'en-US' }), `2,407${NBSP}sats`)
  assert.equal(formatPaymentAmount(7, { kind: 'sats' }, { locale: 'de' }), `₿${NBSP}7`)
  assert.deepEqual(paymentAmountParts(2400, { kind: 'sats', bip177: true }, { locale: 'en-US' }), { number: '2,400', unit: '₿' })
})

test('BTC keeps every satoshi across the safe integer range', () => {
  for (const [locale, maximum, small] of [
    ['en-US', '90,071,992.54740991', '0.00000029'],
    ['de', '90.071.992,54740991', '0,00000029'],
    ['es', '90.071.992,54740991', '0,00000029'],
  ]) {
    assert.equal(paymentAmountParts(Number.MAX_SAFE_INTEGER, { kind: 'btc' }, { locale }).number, maximum, locale)
    assert.equal(formatPaymentAmount(29, { kind: 'btc' }, { locale }), `${small}${NBSP}BTC`, locale)
  }
})

test('converted amounts are marked approximate and never round a real fee to zero', () => {
  const usd = { kind: 'fiat', code: 'USD', rate: 85000, decimals: 2 }
  assert.equal(formatPaymentAmount(2400, usd, { locale: 'en-US' }), `≈${NBSP}2.04${NBSP}USD`)
  assert.equal(formatPaymentAmount(2400, usd, { locale: 'de' }), `≈${NBSP}2,04${NBSP}USD`)
  assert.equal(formatPaymentAmount(1, usd, { locale: 'en-US' }), `≈${NBSP}<${NBSP}0.01${NBSP}USD`)
  const kes = { kind: 'local', code: 'KES', multiplier: 1000, decimals: 2 }
  assert.equal(formatPaymentAmount(10, kes, { locale: 'en-US' }), `≈${NBSP}10.00${NBSP}KES`)
  // A rate that is not there falls back to Bitcoin, never to a made-up figure.
  assert.equal(formatPaymentAmount(10, { kind: 'fiat', code: 'USD', rate: 0, bip177: true }, { locale: 'en-US' }), `₿${NBSP}10`)
})

test('the fiat line uses the same separators as the amounts beside it', () => {
  assert.equal(formatFiatAmount(1.87, 'EUR', { symbol: '€', locale: 'de' }), '€1,87')
  assert.equal(formatFiatAmount(1.87, 'EUR', { symbol: '€', locale: 'en-US' }), '€1.87')
  assert.equal(formatFiatAmount(1234.5, 'USD', { symbol: '$', locale: 'en-US' }), '$1,234.50')
  assert.equal(formatFiatAmount(187, 'JPY', { symbol: '¥', locale: 'en-US' }), '¥187')
  assert.equal(formatFiatAmount(5, 'KES', { locale: 'en-US' }), 'KES 5.00')
  assert.equal(fiatDecimals('JPY'), 0)
  assert.equal(fiatDecimals('EUR'), 2)
})
