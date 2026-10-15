import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitingSummary } from '../waitingSummary.js'

const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
const words = (hidden = false) => ({
  t,
  nameOf: (pubkey) => ({ lena: 'Lena', tom: 'Tom' })[pubkey],
  amountOf: (sats) => (hidden ? '' : `₿ ${sats.toLocaleString('en-US')}`),
  voucherName: (voucher) => voucher.title,
  voucherSats: (voucher) => voucher.sats,
})
const request = (partner, amountSats) => ({ partner, request: { amountSats } })
const voucher = { title: 'Meetup voucher', sats: 15_000 }

test('nothing waits: no line', () => {
  assert.equal(waitingSummary({ requests: [], vouchers: [] }, words()), null)
})

test('one request names who asks and how much, or only who while amounts are hidden', () => {
  const waiting = { requests: [request('lena', 8_000)], vouchers: [] }
  assert.equal(waitingSummary(waiting, words()), 'Lena asks for ₿ 8,000')
  assert.equal(waitingSummary(waiting, words(true)), 'Lena asks for money')
})

test('one voucher says what is left on it', () => {
  const waiting = { requests: [], vouchers: [voucher] }
  assert.equal(waitingSummary(waiting, words()), '₿ 15,000 left on Meetup voucher')
  assert.equal(waitingSummary(waiting, words(true)), 'Money left on Meetup voucher')
})

test('more than one thing: how many of each, in one line', () => {
  assert.equal(waitingSummary({ requests: [request('lena', 1), request('tom', 2)], vouchers: [] }, words()), '2 requests')
  assert.equal(waitingSummary({ requests: [request('lena', 1)], vouchers: [voucher] }, words()), '1 request · 1 voucher')
  assert.equal(waitingSummary({ requests: [request('lena', 1), request('tom', 2)], vouchers: [voucher, voucher] }, words()), '2 requests · 2 vouchers')
})
