/**
 * Gathering and filtering the transactions a report is built from.
 *
 * The failure this file guards against is a report that silently covers less
 * than it appears to: a wallet that could not be read, a history longer than
 * the page budget, a pending payment counted as money that moved.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/collect.spec.js
 */

import { strict as assert } from 'node:assert'
import { collectTransactions, filterForReport, standardPeriods } from '../collect.js'

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

/** A provider holding `count` transactions, paged the way the real ones are. */
function fakeProvider(count, prefix = 't') {
  const all = Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`, type: 'outgoing', status: 'completed',
    amount: 100 + i, settled_at: 1787774933 - i * 60,
  }))
  return {
    calls: 0,
    async getTransactions({ limit, offset }) {
      this.calls += 1
      return all.slice(offset, offset + limit)
    },
  }
}

async function run() {
  await test('a short page ends the paging', async () => {
    const p = fakeProvider(30)
    const out = await collectTransactions({
      wallets: [{ id: 'w1', name: 'Business' }],
      providers: { w1: p },
      normalize: (raw) => raw,
    })
    assert.equal(out.rows.length, 30)
    assert.equal(p.calls, 1, 'one page was enough')
    assert.deepEqual(out.readWallets, ['Business'])
    assert.deepEqual(out.truncatedWallets, [])
  })

  await test('an exact multiple of the page size still terminates', async () => {
    // The classic off-by-one: 100 rows fills a page exactly, so the loop has
    // to ask once more and get nothing rather than assume it is done.
    const p = fakeProvider(100)
    const out = await collectTransactions({
      wallets: [{ id: 'w1', name: 'B' }], providers: { w1: p }, normalize: (r) => r,
    })
    assert.equal(out.rows.length, 100)
    assert.equal(p.calls, 2)
    assert.deepEqual(out.truncatedWallets, [])
  })

  await test('a history longer than the budget is reported, not silently cut', async () => {
    // 20 pages of 100 is the ceiling. A report that quietly stops there and
    // says nothing is a report with a hole in it.
    const p = fakeProvider(2500)
    const out = await collectTransactions({
      wallets: [{ id: 'w1', name: 'Busy' }], providers: { w1: p }, normalize: (r) => r,
    })
    assert.equal(out.rows.length, 2000)
    assert.deepEqual(out.truncatedWallets, ['Busy'])
  })

  await test('one unreadable wallet never stops the others', async () => {
    const out = await collectTransactions({
      wallets: [
        { id: 'a', name: 'Broken' },
        { id: 'b', name: 'Fine' },
        { id: 'c', name: 'Disconnected' },
      ],
      providers: {
        a: { getTransactions: async () => { throw new Error('offline') } },
        b: fakeProvider(5, 'b'),
        // c has no provider at all
      },
      normalize: (r) => r,
    })
    assert.equal(out.rows.length, 5)
    assert.deepEqual(out.readWallets, ['Fine'])
    assert.deepEqual(out.failedWallets.sort(), ['Broken', 'Disconnected'])
  })

  await test('rows are tagged with the wallet they came from and sorted newest first', async () => {
    const out = await collectTransactions({
      wallets: [{ id: 'a', name: 'Personal' }, { id: 'b', name: 'Business' }],
      providers: { a: fakeProvider(3, 'a'), b: fakeProvider(3, 'b') },
      normalize: (r) => r,
    })
    assert.equal(out.rows.length, 6)
    assert.ok(out.rows.every((r) => r.walletName))
    for (let i = 1; i < out.rows.length; i += 1) {
      assert.ok(out.rows[i - 1].settled_at >= out.rows[i].settled_at, 'newest first')
    }
  })

  await test('an abort stops the walk', async () => {
    const c = new AbortController()
    c.abort()
    const out = await collectTransactions({
      wallets: [{ id: 'a', name: 'A' }], providers: { a: fakeProvider(50) },
      normalize: (r) => r, signal: c.signal,
    })
    assert.equal(out.rows.length, 0)
  })

  // ── what belongs in the report ───────────────────────────────────────────

  await test('only completed transactions count as money that moved', async () => {
    const rows = [
      { id: 'a', status: 'completed', settled_at: 1000 },
      { id: 'b', status: 'pending', settled_at: 1000 },
      { id: 'c', status: 'expired', settled_at: 1000 },
      { id: 'd', settled_at: 1000 }, // absent status defaults to completed
    ]
    const kept = filterForReport(rows)
    assert.deepEqual(kept.map((r) => r.id), ['a', 'd'])
  })

  await test('a transaction without a usable time cannot be placed in a period', async () => {
    const kept = filterForReport([
      { id: 'a', status: 'completed', settled_at: 0 },
      { id: 'b', status: 'completed' },
      { id: 'c', status: 'completed', settled_at: 1787774933 },
    ])
    assert.deepEqual(kept.map((r) => r.id), ['c'])
  })

  await test('the period bounds are inclusive at both ends', async () => {
    const at = (ms) => ({ id: String(ms), status: 'completed', settled_at: ms / 1000 })
    const kept = filterForReport(
      [at(999), at(1000), at(2000), at(2001)],
      { fromMs: 1000, toMs: 2000 },
    )
    assert.deepEqual(kept.map((r) => r.id), ['1000', '2000'])
  })

  await test('the offered periods are calendar years, resolved against a given clock', async () => {
    // Tax years differ by country, so naming one jurisdiction's would be
    // wrong for most users of an app shipping in three languages.
    const now = new Date('2026-08-27T12:00:00Z')
    const [thisYear, lastYear, all] = standardPeriods(now)
    assert.equal(new Date(thisYear.fromMs).getFullYear(), 2026)
    assert.equal(thisYear.toMs, now.getTime(), 'this year stops now, not in December')
    assert.equal(new Date(lastYear.fromMs).getFullYear(), 2025)
    assert.equal(new Date(lastYear.toMs).getFullYear(), 2025)
    assert.equal(all.fromMs, null)
    assert.equal(all.toMs, null)
  })

  console.log(`\n  ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
