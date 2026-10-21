/**
 * Bitrefill Widget - the frame contract and the never-pay-twice ledger.
 *
 * Coverage focus:
 *   - the widget URL: documented parameters only, Lightning only, no payment
 *     screen, theme and language from the app, email only when valid
 *   - messages: only from the widget origin AND the widget frame, JSON or
 *     object data, unknown events dropped
 *   - the invoice of a payment_intent: lightning: prefix, other methods refused
 *   - the ledger: attempted blocks a second payment, failed allows a retry,
 *     paid blocks for good, the list stays bounded
 *   - the email: encrypted at rest, asked once
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WIDGET_ORIGIN,
  WIDGET_EVENT,
  buildWidgetUrl,
  widgetLanguage,
  isValidEmail,
  parseWidgetMessage,
  invoiceFromIntent,
  isPaidUpdate,
  isExpiredUpdate,
} from '../widget.js'
import {
  createInvoiceLedger,
  PAY_STATE,
  PAY_BLOCK,
  LEDGER_LIMIT,
  LEDGER_KEY,
  EMAIL_KEY,
  loadEmail,
  saveEmail,
  clearEmail,
  wasEmailAsked,
  markEmailAsked,
} from '../storage.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => map,
  }
}

const INVOICE = 'lnbc1398460n1p4d0cvmpp5s6sygml7hsyxc0fayspp63gyna9k3caeeqjpnuaqw0230nv5tztq'
const frame = { name: 'widget-frame' }
const msg = (data, { origin = WIDGET_ORIGIN, source = frame } = {}) => ({ origin, source, data })

test('the URL carries only documented parameters, Lightning only, payment screen off', () => {
  const url = new URL(buildWidgetUrl({ dark: true, locale: 'de', email: 'a@b.co', utmSource: 'buhogo', ref: 'BUHO123' }))
  assert.equal(url.origin, WIDGET_ORIGIN)
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ref: 'BUHO123',
    utm_source: 'buhogo',
    paymentMethods: 'lightning',
    showPaymentInfo: 'false',
    theme: 'dark',
    hl: 'de',
    email: 'a@b.co',
  })
  assert.equal(url.searchParams.has('customStyles'), false, 'the widget keeps its own look')
})

test('no referral code yet: the ref parameter is left out, not sent empty', () => {
  const url = new URL(buildWidgetUrl({ ref: '' }))
  assert.equal(url.searchParams.has('ref'), false)
  assert.equal(url.searchParams.get('theme'), 'light')
})

test('an invalid or missing email is never passed', () => {
  for (const email of ['', 'nope', 'a@b', ' @x.y', null]) {
    assert.equal(new URL(buildWidgetUrl({ email })).searchParams.has('email'), false, String(email))
  }
  assert.equal(new URL(buildWidgetUrl({ email: '  me@mail.org ' })).searchParams.get('email'), 'me@mail.org')
})

test('email check', () => {
  assert.equal(isValidEmail('x@y.de'), true)
  assert.equal(isValidEmail('x y@z.de'), false)
  assert.equal(isValidEmail('x@y'), false)
  assert.equal(isValidEmail(42), false)
})

test('app locales map to the widget languages, unknown ones to English', () => {
  assert.equal(widgetLanguage('en-US'), 'en')
  assert.equal(widgetLanguage('de'), 'de')
  assert.equal(widgetLanguage('es'), 'es')
  assert.equal(widgetLanguage('pt-BR'), 'pt')
  assert.equal(widgetLanguage('zh-TW'), 'zh-Hans')
  assert.equal(widgetLanguage('sw'), 'en')
  assert.equal(widgetLanguage(''), 'en')
})

test('messages count only from the widget origin and the widget frame', () => {
  const data = JSON.stringify({ event: 'payment_intent', invoiceId: 'inv1', paymentUri: `lightning:${INVOICE}` })
  assert.equal(parseWidgetMessage(msg(data), frame).invoiceId, 'inv1')
  assert.equal(parseWidgetMessage(msg(data, { origin: 'https://evil.example' }), frame), null, 'other origin')
  assert.equal(parseWidgetMessage(msg(data, { origin: 'https://www.bitrefill.com' }), frame), null, 'not the widget host')
  assert.equal(parseWidgetMessage(msg(data, { source: {} }), frame), null, 'another window of the same origin')
  assert.equal(parseWidgetMessage(msg(data), null), null, 'no frame yet')
})

test('object data works too; junk and unknown events are dropped', () => {
  assert.equal(parseWidgetMessage(msg({ event: 'invoice_update', invoiceId: 'i', status: 'expired' }), frame).status, 'expired')
  assert.equal(parseWidgetMessage(msg('{not json'), frame), null)
  assert.equal(parseWidgetMessage(msg({ event: 'something_else', invoiceId: 'i' }), frame), null)
  assert.equal(parseWidgetMessage(msg({ event: 'payment_intent' }), frame), null, 'no invoice id')
  assert.equal(parseWidgetMessage(msg(null), frame), null)
})

test('the invoice of a payment intent', () => {
  const base = { event: WIDGET_EVENT.PAYMENT_INTENT, invoiceId: 'i', paymentMethod: 'lightning' }
  assert.equal(invoiceFromIntent({ ...base, paymentUri: `lightning:${INVOICE}` }), INVOICE)
  assert.equal(invoiceFromIntent({ ...base, paymentUri: INVOICE.toUpperCase() }), INVOICE)
  assert.equal(invoiceFromIntent({ ...base, paymentMethod: 'bitcoin', paymentUri: 'bitcoin:bc1q...' }), null)
  assert.equal(invoiceFromIntent({ ...base, paymentUri: '' }), null)
  assert.equal(invoiceFromIntent({ ...base, paymentUri: 'lightning:not-an-invoice' }), null)
  assert.equal(invoiceFromIntent({ ...base, event: WIDGET_EVENT.INVOICE_CREATED, paymentUri: INVOICE }), null, 'only an intent is paid')
})

test('paid and expired updates', () => {
  assert.equal(isPaidUpdate({ event: 'invoice_update', status: 'payment_detected' }), true)
  assert.equal(isPaidUpdate({ event: 'invoice_update', status: 'payment_confirmed' }), true)
  assert.equal(isPaidUpdate({ event: 'invoice_update', status: 'expired' }), false)
  assert.equal(isPaidUpdate({ event: 'invoice_complete', status: 'payment_detected' }), false)
  assert.equal(isExpiredUpdate({ event: 'invoice_update', status: 'expired' }), true)
})

test('ledger: a payment handed to a wallet blocks a second one', () => {
  const ledger = createInvoiceLedger({ storage: memoryStorage() })
  assert.deepEqual(ledger.canPay('a'), { ok: true })
  ledger.mark('a', PAY_STATE.ATTEMPTED, { amountSats: 1000 })
  assert.deepEqual(ledger.canPay('a'), { ok: false, reason: PAY_BLOCK.IN_FLIGHT })
  ledger.mark('a', PAY_STATE.FAILED)
  assert.deepEqual(ledger.canPay('a'), { ok: true }, 'a refused payment may be retried')
  ledger.mark('a', PAY_STATE.ATTEMPTED)
  ledger.mark('a', PAY_STATE.PAID)
  assert.deepEqual(ledger.canPay('a'), { ok: false, reason: PAY_BLOCK.PAID })
  assert.equal(ledger.get('a').amountSats, 1000, 'details survive later steps')
})

test('ledger: survives a reload and stays bounded', () => {
  const storage = memoryStorage()
  let t = 0
  const ledger = createInvoiceLedger({ storage, now: () => ++t })
  for (let i = 0; i < LEDGER_LIMIT + 5; i++) ledger.mark(`inv${i}`, PAY_STATE.PAID)
  const again = createInvoiceLedger({ storage })
  assert.equal(JSON.parse(storage.getItem(LEDGER_KEY)).length, LEDGER_LIMIT)
  assert.equal(again.get('inv0'), null, 'oldest dropped')
  assert.equal(again.canPay(`inv${LEDGER_LIMIT + 4}`).ok, false)
  assert.equal(ledger.mark('x', 'bogus'), null, 'unknown states are refused')
})

test('ledger: unreadable storage reads as empty, never throws', () => {
  const storage = memoryStorage()
  storage.setItem(LEDGER_KEY, '{oops')
  const ledger = createInvoiceLedger({ storage })
  assert.deepEqual(ledger.canPay('a'), { ok: true })
  assert.equal(createInvoiceLedger({ storage: null }).canPay('a').ok, true)
})

test('email: stored encrypted, asked once, removable', async () => {
  const storage = memoryStorage()
  const encrypt = async (s) => `enc(${s})`
  const decrypt = async (s) => s.slice(4, -1)
  assert.equal(wasEmailAsked(storage), false)
  await saveEmail(' me@mail.org ', { storage, encrypt })
  assert.equal(storage.getItem(EMAIL_KEY), 'enc(me@mail.org)', 'never stored in the clear')
  assert.equal(await loadEmail({ storage, decrypt }), 'me@mail.org')
  assert.equal(wasEmailAsked(storage), true)
  clearEmail(storage)
  assert.equal(await loadEmail({ storage, decrypt }), '')
  assert.equal(wasEmailAsked(storage), true, '"asked" outlives the email')
})

test('email: "Not now" counts as asked; an unreadable envelope reads as no email', async () => {
  const storage = memoryStorage()
  markEmailAsked(storage)
  assert.equal(wasEmailAsked(storage), true)
  storage.setItem(EMAIL_KEY, 'garbage')
  assert.equal(await loadEmail({ storage, decrypt: async () => { throw new Error('bad') } }), '')
})
