/**
 * The report against the rows the providers actually emit.
 *
 * The first version of this file invented its own raw shape, which is the same
 * mistake it was written to prevent: it fed the chain `settled_at`, and not
 * one provider in this app emits that field. LNbits, Spark and Arkade all
 * emit `timestamp`; only NWC carries `settled_at`, and only sometimes.
 *
 * So every fixture below is copied from the provider that produces it:
 *
 *   LNbits  providers/LNBitsWalletProvider.js  getTransactions
 *   Spark   providers/SparkWalletProvider.js   getTransactions
 *   Arkade  providers/ArkadeWalletProvider.js  getTransactions
 *   NWC     providers/NWCWalletProvider.js     getTransactions
 *
 * If a provider renames a field the report depends on, this is what fails.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/pipeline.spec.js
 */

import { strict as assert } from 'node:assert'
import { normalizeTx } from '../../txNormalizer.js'
import { collectTransactions, filterForReport } from '../collect.js'
import { toReportRow, toCsv, REPORT_COLUMNS } from '../rows.js'
import { txTimeMs } from '../time.js'

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

/**
 * A fixed instant, not the current one.
 *
 * Dating fixtures relative to the live clock made two of these tests fail on
 * 1 January between 00:00 and 00:59, when "an hour ago" falls in the previous
 * calendar year and "This year" no longer contains it.
 */
const AT = 1787774933 // 2026-08-27T02:48:53Z, unix SECONDS as every provider sends
const DAY = 86400

/** Raw rows exactly as each provider hands them over. Note: no `settled_at`. */
const RAW = {
  lnbits: (over = {}) => ({
    id: 'ln-1', paymentHash: 'ln-1', type: 'send', amount: 10000,
    timestamp: AT, created_at: AT, description: 'Supplier', status: 'completed',
    fee: 12, bolt11: null, preimage: null, expiry: null, tag: null, extra: null, ...over,
  }),
  spark: (over = {}) => ({
    id: 'sp-1', type: 'send', amount: 10000, timestamp: AT,
    description: '', status: 'completed', fee: 12, sparkTransfer: false,
    rawType: 'LIGHTNING_SEND', paymentHash: null, preimage: null, bolt11: null, ...over,
  }),
  arkade: (over = {}) => ({
    id: 'ark-1', type: 'outgoing', amount: 10000, timestamp: AT, status: 'completed', ...over,
  }),
  nwc: (over = {}) => ({
    id: 'nw-1', type: 'send', amount: 10000, timestamp: AT, created_at: AT,
    settled_at: AT, description: '', status: 'completed', fee: 12,
    paymentHash: 'nw-1', preimage: null, bolt11: null, descriptionHash: null, ...over,
  }),
}

const wallets = (types) => types.map((t) => ({ id: `w-${t}`, name: t, type: t }))

/**
 * Split one CSV line into fields, honouring quotes.
 *
 * A plain `split(',')` misreads every row: the local date is written
 * "27.08.26, 04:44", quoted precisely because it contains a comma.
 */
function fields(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1 }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

async function through(types, over = {}) {
  return collectTransactions({
    wallets: wallets(types),
    providers: Object.fromEntries(types.map((t) => [
      `w-${t}`, { getTransactions: async () => [RAW[t](over)] },
    ])),
    normalize: (r, ctx) => normalizeTx(r, ctx),
  })
}

// ── the field the report reads is the field that arrives ───────────────────

await test('every provider reaches the report with a time on it', async () => {
  const { rows } = await through(['lnbits', 'spark', 'arkade', 'nwc'])
  assert.equal(rows.length, 4)
  for (const tx of rows) {
    assert.equal(txTimeMs(tx), AT * 1000, `${tx.walletName}: time lost in the chain`)
  }
})

await test('settled_at is what the report reads, and the normaliser sets it', async () => {
  // Three of the four providers never send `settled_at`; the normaliser
  // derives it from `timestamp`. That derivation is the contract this file
  // exists to pin down.
  for (const t of ['lnbits', 'spark', 'arkade']) {
    assert.equal(RAW[t]().settled_at, undefined, `${t} is not supposed to send settled_at`)
    const tx = normalizeTx(RAW[t](), { walletType: t })
    assert.equal(tx.settled_at, AT, `${t}: normaliser did not derive settled_at`)
  }
})

await test('a row with no time at all is left out rather than dated', async () => {
  // Arkade emits `timestamp: 0` when the SDK gives it nothing usable.
  const { rows } = await through(['arkade'], { timestamp: 0 })
  assert.equal(rows.length, 1, 'it is still collected')
  assert.equal(filterForReport(rows, { fromMs: null, toMs: null }).length, 0, 'but never dated')
})

// ── the period ─────────────────────────────────────────────────────────────

await test('the period is applied against the transaction time, in seconds', async () => {
  const { rows } = await through(['lnbits'])
  const on = { fromMs: (AT - DAY) * 1000, toMs: (AT + DAY) * 1000 }
  const before = { fromMs: (AT - 30 * DAY) * 1000, toMs: (AT - DAY) * 1000 }

  assert.equal(filterForReport(rows, on).length, 1)
  assert.equal(filterForReport(rows, before).length, 0)
})

await test('only completed transactions count as money that moved', async () => {
  for (const status of ['pending', 'failed', 'expired']) {
    const { rows } = await through(['lnbits'], { status })
    assert.equal(filterForReport(rows, { fromMs: null, toMs: null }).length, 0, status)
  }
})

// ── amounts mean the same thing whichever wallet they came from ────────────

await test('the amount is what the other side got, on every provider', async () => {
  // The raw `amount` does not mean the same thing across providers: Spark's
  // includes the fee, LNbits' and NWC's exclude it. Reading it directly
  // overstated a Spark send by the size of its fee.
  const { rows } = await through(['spark', 'lnbits', 'nwc', 'arkade'])
  const by = Object.fromEntries(rows.map((r) => [r.walletName, toReportRow(r, {})]))

  assert.equal(by.spark.amountSats, 9988, 'spark: raw amount includes the fee')
  assert.equal(by.spark.totalSats, 10000)

  for (const t of ['lnbits', 'nwc']) {
    assert.equal(by[t].amountSats, 10000, `${t}: raw amount excludes the fee`)
    assert.equal(by[t].totalSats, 10012, `${t}: total adds it back`)
  }

  // Whatever the provider, amount + fee is the total. Nothing to infer.
  for (const t of ['spark', 'lnbits', 'nwc']) {
    assert.equal(by[t].amountSats + by[t].feeSats, by[t].totalSats, t)
  }
})

await test('a send is a send, on every provider', async () => {
  // The providers disagree on wording: 'send' for LNbits, Spark and NWC,
  // 'outgoing' for Arkade. All four must reach the file as Sent.
  const { rows } = await through(['lnbits', 'spark', 'arkade', 'nwc'])
  for (const tx of rows) {
    assert.equal(toReportRow(tx, {}).direction, 'Sent', tx.walletName)
  }
})

await test('a fee nobody measured is empty, not zero', async () => {
  // Arkade reports a single total and no fee figure. The normaliser says so
  // with feeSats: null, and the report must not answer that with "free".
  const { rows } = await through(['arkade'])
  const row = toReportRow(rows[0], {})
  assert.equal(row.feeSats, null)
  assert.equal(row.amountSats, 10000)
  assert.equal(row.totalSats, 10000)
})

// ── the file that comes out ────────────────────────────────────────────────

await test('the CSV header is the one an accountant opens, spelled out', async () => {
  // Compared against literal text, not against REPORT_COLUMNS: checking the
  // header against the list it is generated from proves only that the code
  // agrees with itself.
  const csv = toCsv([toReportRow(normalizeTx(RAW.lnbits(), { walletType: 'lnbits' }), {})])
  const header = csv.replace(/^﻿/, '').split('\r\n')[0]

  assert.equal(header, [
    'Date (UTC)', 'Date (local)', 'Time zone', 'Wallet', 'Direction', 'Status',
    'Amount (sats)', 'Amount (BTC)', 'Fee (sats)', 'Total incl. fee (sats)',
    'Currency', 'Value at time', 'BTC price at time', 'Rate source',
    'Rate timestamp (UTC)', 'Description', 'Counterparty', 'Transaction ID',
    'Payment hash', 'Preimage', 'Invoice',
  ].join(','))
  assert.equal(fields(header).length, REPORT_COLUMNS.length)
})

await test('the total column carries a figure, not just a heading', async () => {
  const csv = toCsv([toReportRow(normalizeTx(RAW.lnbits(), { walletType: 'lnbits' }), {})])
  const [header, row] = csv.replace(/^﻿/, '').trim().split('\r\n')
  const at = fields(header).indexOf('Total incl. fee (sats)')
  const cells = fields(row)
  assert.equal(cells[at], '10012', 'amount 10000 plus a fee of 12')
  assert.equal(cells[at - 1], '12', 'the fee sits beside it')
  assert.equal(cells[at - 2], '0.00010000', 'and the amount before that')
})

await test('the CSV has a line per transaction, with a date on each', async () => {
  const { rows } = await through(['lnbits', 'spark'])
  const kept = filterForReport(rows, { fromMs: null, toMs: null })
  const csv = toCsv(kept.map((tx) => toReportRow(tx, { walletName: tx.walletName })))

  const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(lines.length, 3, 'a header and two transactions')
  for (const line of lines.slice(1)) {
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(line), `no date on: ${line.slice(0, 40)}`)
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
