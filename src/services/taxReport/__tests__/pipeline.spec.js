/**
 * The report against the transaction shape the app actually produces.
 *
 * Every other spec in this folder builds its own transaction objects, which
 * is how the report shipped empty: the objects carried a `timestamp` field,
 * the app's normaliser produces `settled_at`, and nothing in the suite ever
 * put the two together. Every row failed the period filter and every report
 * came out with nothing in it.
 *
 * So this file builds NOTHING by hand. It starts from raw provider records,
 * runs them through the real `normalizeTx`, and asserts on what comes out the
 * far end of the real collect → filter → row chain. If the normaliser ever
 * renames a field the report depends on, this is what fails.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/pipeline.spec.js
 */

import { strict as assert } from 'node:assert'
import { normalizeTx } from '../../txNormalizer.js'
import { collectTransactions, filterForReport, standardPeriods } from '../collect.js'
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

/** Unix SECONDS, which is what every provider in this app sends. */
const HOUR = 3600
const nowSec = () => Math.floor(Date.now() / 1000)

/** Raw records in each provider's own shape, before the normaliser. */
const rawFor = (walletType, at) => {
  const base = { id: `${walletType}-1`, status: 'completed', settled_at: at, time: at }
  if (walletType === 'arkade') return { ...base, type: 'outgoing', amount: 10000 }
  return { ...base, type: 'outgoing', amount: 10000, fee: 12 }
}

const walletOf = (type) => ({ id: `w-${type}`, name: type, type })

async function through(walletTypes, at) {
  const wallets = walletTypes.map(walletOf)
  const providers = Object.fromEntries(
    walletTypes.map((t) => [`w-${t}`, { getTransactions: async () => [rawFor(t, at)] }]),
  )
  return collectTransactions({ wallets, providers, normalize: (r, ctx) => normalizeTx(r, ctx) })
}

// ── the bug this file exists for ───────────────────────────────────────────

await test('a normalised transaction survives the period filter', async () => {
  // The whole failure in one line: this returned 0 for every period, so every
  // report was empty no matter which wallet or year was chosen.
  const { rows } = await through(['lnbits'], nowSec() - HOUR)
  assert.equal(rows.length, 1)

  for (const period of standardPeriods(new Date())) {
    if (period.id === 'lastYear') continue // the transaction is from today
    assert.equal(filterForReport(rows, period).length, 1, `dropped by "${period.id}"`)
  }
})

await test('the report reads the field the normaliser writes', async () => {
  const at = nowSec() - HOUR
  const { rows } = await through(['lnbits'], at)
  const tx = rows[0]

  assert.equal(tx.timestamp, undefined, 'the normaliser does not produce `timestamp`')
  assert.equal(tx.settled_at, at, 'it produces `settled_at`, in seconds')
  assert.equal(txTimeMs(tx), at * 1000)
})

await test('every row carries a date the file can print', async () => {
  const { rows } = await through(['lnbits', 'spark', 'arkade', 'nwc'], nowSec() - HOUR)
  const kept = filterForReport(rows, { fromMs: null, toMs: null })
  assert.equal(kept.length, 4)

  for (const tx of kept) {
    const row = toReportRow(tx, { walletName: tx.walletName })
    assert.ok(row.dateUtc, `${tx.walletName}: no UTC date`)
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(row.dateUtc), `${tx.walletName}: ${row.dateUtc}`)
    assert.ok(row.amountSats > 0, `${tx.walletName}: no amount`)
  }
})

// ── amounts mean the same thing whichever wallet they came from ────────────

await test('the amount is what the other side got, on every provider', async () => {
  // The raw `amount` does not mean the same thing across providers: Spark's
  // includes the fee, LNbits' and NWC's exclude it. Reading it directly
  // overstated a Spark send by the size of its fee.
  const { rows } = await through(['spark', 'lnbits', 'nwc', 'arkade'], nowSec() - HOUR)
  const by = Object.fromEntries(rows.map((r) => [r.walletName, toReportRow(r, {})]))

  assert.equal(by.spark.amountSats, 9988, 'spark: amount includes the fee')
  assert.equal(by.spark.totalSats, 10000)

  for (const t of ['lnbits', 'nwc']) {
    assert.equal(by[t].amountSats, 10000, `${t}: amount excludes the fee`)
    assert.equal(by[t].totalSats, 10012, `${t}: total adds it back`)
  }

  // Whatever the provider, amount + fee is the total. Nothing to infer.
  for (const t of ['spark', 'lnbits', 'nwc']) {
    assert.equal(by[t].amountSats + by[t].feeSats, by[t].totalSats, t)
  }
})

await test('a fee nobody measured is empty, not zero', async () => {
  // Arkade reports a single total and no fee figure. The normaliser says so
  // with feeSats: null, and the report must not answer that with "free".
  const { rows } = await through(['arkade'], nowSec() - HOUR)
  const row = toReportRow(rows[0], {})
  assert.equal(row.feeSats, null)
  assert.equal(row.amountSats, 10000)
  assert.equal(row.totalSats, 10000)
})

// ── the file that comes out ────────────────────────────────────────────────

await test('the CSV has a line per transaction, with a date on each', async () => {
  const { rows } = await through(['lnbits', 'spark'], nowSec() - HOUR)
  const kept = filterForReport(rows, { fromMs: null, toMs: null })
  const csv = toCsv(kept.map((tx) => toReportRow(tx, { walletName: tx.walletName })))

  const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(lines.length, 3, 'a header and two transactions')
  assert.equal(lines[0].split(',').length, REPORT_COLUMNS.length)
  for (const line of lines.slice(1)) {
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(line), `no date on: ${line.slice(0, 40)}`)
  }
})

await test('a transaction outside the period is left out, not merely undated', async () => {
  const { rows } = await through(['lnbits'], nowSec() - HOUR)
  const yearAgo = standardPeriods(new Date()).find((p) => p.id === 'lastYear')
  assert.equal(filterForReport(rows, yearAgo).length, 0)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
