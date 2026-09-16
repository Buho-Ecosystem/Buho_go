/**
 * The transaction report's data layer.
 *
 * These tests exist because this is the one place where being wrong is worse
 * than being incomplete. Almost every case below is a way a report could look
 * authoritative while stating something false — a zero standing in for an
 * unknown, a subset total presented as a whole, a memo executing as a formula
 * when the accountant opens it.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/rows.spec.js
 */

import { strict as assert } from 'node:assert'
import { toReportRow, toCsv, toXml, summarise, REPORT_COLUMNS } from '../rows.js'

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

const EUR = { currency: 'EUR', rate: 62960, source: 'mempool.space/historical-price', at: 1787774900000 }
const tx = (over = {}) => ({
  id: 'tx1', type: 'outgoing', status: 'completed',
  amount: 2418, fee: 11, settled_at: 1787774933, ...over,
})

// ── the rule the whole module exists for ───────────────────────────────────

test('a value we cannot establish is empty, never zero', () => {
  // Number(null) is 0, so the naive implementation reports a confident 0.00
  // for a transaction whose rate was never known. Zero is a claim; empty is
  // an admission, and only one of them is true.
  const row = toReportRow(tx(), { walletName: 'B' })
  assert.equal(row.fiatValueAtTime, '')
  assert.equal(row.btcPriceAtTime, '')
  assert.equal(row.fiatCurrency, '')
  assert.equal(row.rateSource, '')
})

test('a value we can establish is the amount at the rate that applied then', () => {
  const row = toReportRow(tx(), { walletName: 'B', rate: EUR })
  // 2418 sats at 62 960 EUR/BTC
  assert.equal(row.fiatValueAtTime, '1.52')
  assert.equal(row.btcPriceAtTime, '62960.00')
  assert.equal(row.rateSource, 'mempool.space/historical-price')
  // The rate's own timestamp, not the transaction's: the price point is the
  // nearest one held, and pretending otherwise cannot be audited.
  assert.equal(row.rateTimeUtc, new Date(EUR.at).toISOString())
})

test('a fee that was never measured is absent, not zero', () => {
  assert.equal(toReportRow(tx({ fee: undefined }), {}).feeSats, null)
  assert.equal(toReportRow(tx({ fee: null }), {}).feeSats, null)
  assert.equal(toReportRow(tx({ fee: 0 }), {}).feeSats, 0, 'a measured zero is a fact')
})

test('amounts are stated in units we can prove', () => {
  const row = toReportRow(tx({ amount: 100000000 }), {})
  assert.equal(row.amountSats, 100000000)
  assert.equal(row.amountBtc, '1.00000000')
  // A row with no amount states none rather than 0.
  assert.equal(toReportRow(tx({ amount: 0 }), {}).amountSats, null)
})

test('direction is recorded, and outgoing is the default for anything else', () => {
  assert.equal(toReportRow(tx({ type: 'incoming' }), {}).direction, 'Received')
  assert.equal(toReportRow(tx({ type: 'outgoing' }), {}).direction, 'Sent')
})

// ── CSV ────────────────────────────────────────────────────────────────────

test('CSV neutralises a memo that Excel would execute', () => {
  // A description beginning =, +, - or @ is run as a formula the moment the
  // file is opened. A payment memo is exactly the kind of user-supplied
  // string that carries one.
  for (const evil of ['=1+1', '+cmd', '-2+3', '@SUM(A1)']) {
    const csv = toCsv([toReportRow(tx({ description: evil }), {})])
    assert.ok(csv.includes(`\t${evil}`), `${evil} should be prefixed with a tab`)
  }
})

test('CSV is RFC 4180 with a BOM, so Excel on Windows keeps the accents', () => {
  const csv = toCsv([toReportRow(tx({ description: 'Café "Grün", Berlin' }), {})])
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.ok(csv.includes('\r\n'))
  assert.ok(csv.includes('"Café ""Grün"", Berlin"'), 'quotes doubled, field quoted')
})

test('CSV headings and columns cannot drift apart', () => {
  const csv = toCsv([toReportRow(tx(), {})])
  const head = csv.replace(/^﻿/, '').split('\r\n')[0].split(',')
  assert.equal(head.length, REPORT_COLUMNS.length)
  assert.equal(head[0], 'Date (UTC)')
})

// ── XML ────────────────────────────────────────────────────────────────────

test('XML omits an unknown field rather than emitting an empty one', () => {
  // <fiatValueAtTime></fiatValueAtTime> invites being parsed as zero by the
  // bookkeeping software that ingests this.
  const xml = toXml([toReportRow(tx(), { walletName: 'B' })])
  assert.ok(!xml.includes('<fiatValueAtTime>'))
  assert.ok(!xml.includes('<feeSats></feeSats>'))
  assert.ok(xml.includes('<amountSats>2418</amountSats>'))
})

test('XML escapes markup and strips what XML 1.0 forbids', () => {
  const bell = String.fromCharCode(7)
  const xml = toXml([toReportRow(tx({ description: `a & b <c> "d"${bell}` }), {})])
  assert.ok(xml.includes('a &amp; b &lt;c&gt;'))
  assert.ok(!xml.includes(bell))
  // Ordinary punctuation must survive: an over-broad control-character class
  // silently ate #, $, % and the rest.
  const punct = toXml([toReportRow(tx({ description: '50% off (item #3) - $5' }), {})])
  assert.ok(punct.includes('50% off (item #3) - $5'))
})

// ── summary ────────────────────────────────────────────────────────────────

test('received and sent are kept apart, because turnover is the number asked for', () => {
  const rows = [
    toReportRow(tx({ id: 'a', type: 'incoming', amount: 5000 }), { rate: EUR }),
    toReportRow(tx({ id: 'b', type: 'outgoing', amount: 2000 }), { rate: EUR }),
  ]
  const s = summarise(rows)
  assert.equal(s.receivedSats, 5000)
  assert.equal(s.sentSats, 2000)
  assert.equal(s.netSats, 3000)
  assert.equal(s.count, 2)
})

test('the summary says how much of itself it could not price', () => {
  // A fiat total covering three of five rows, presented without saying so, is
  // the quiet way this document becomes false.
  const rows = [
    toReportRow(tx({ id: 'a', type: 'incoming', amount: 100000000 }), { rate: EUR }),
    toReportRow(tx({ id: 'b', type: 'incoming', amount: 100000000 }), {}),
  ]
  const s = summarise(rows)
  assert.equal(s.missingRates, 1)
  assert.equal(s.receivedSats, 200000000, 'sats are known for both')
  assert.equal(s.receivedFiat, '62960.00', 'fiat covers only the priced one')
  assert.equal(s.currency, 'EUR')
})

test('the summary reports the span it actually covers', () => {
  const rows = [
    toReportRow(tx({ id: 'a', settled_at: 1700000000 }), {}),
    toReportRow(tx({ id: 'b', settled_at: 1787774933 }), {}),
  ]
  const s = summarise(rows)
  assert.equal(s.firstUtc, new Date(1700000000000).toISOString())
  assert.equal(s.lastUtc, new Date(1787774933000).toISOString())
})

test('an empty report is empty, not zero-filled nonsense', () => {
  const s = summarise([])
  assert.equal(s.count, 0)
  assert.equal(s.currency, '')
  assert.equal(s.firstUtc, '')
  assert.equal(s.missingRates, 0)
  assert.ok(toCsv([]).includes('Date (UTC)'), 'headings still present')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
