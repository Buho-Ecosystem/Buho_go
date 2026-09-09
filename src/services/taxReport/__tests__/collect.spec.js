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

  // ── providers that do not page the way we ask ──────────────────────────────

await test('a provider that ignores limit and offset is read once, not twenty times', async () => {
  // Arkade's getTransactions() takes no arguments and returns the whole
  // history every call. Paging it appended the same rows twenty times, which
  // in a tax document is every amount counted twenty times.
  const history = Array.from({ length: 250 }, (_, i) => ({
    id: `ark-${i}`, status: 'completed', amount: 100 + i, settled_at: 1787774933 - i * 60,
  }))
  let calls = 0
  const out = await collectTransactions({
    wallets: [{ id: 'w1', name: 'Ark', type: 'arkade' }],
    providers: { w1: { getTransactions: async () => { calls += 1; return history } } },
  })

  assert.equal(calls, 1, 'asked once')
  assert.equal(out.rows.length, 250, 'every transaction, each of them once')
  assert.equal(out.truncatedWallets.length, 0)
})

await test('two real transactions that share an id both survive', async () => {
  // The Arkade provider flattens the SDK's three-part key into one field, so
  // two boarding deposits swept by the same settlement transaction arrive with
  // the same id. Keying the dedupe on the id alone dropped one of them and
  // understated what the wallet received.
  const out = await collectTransactions({
    wallets: [{ id: 'w1', name: 'Ark', type: 'arkade' }],
    providers: {
      w1: {
        getTransactions: async () => [
          { id: 'commitment-C', type: 'incoming', amount: 100000, status: 'completed', settled_at: 1787774933 },
          { id: 'commitment-C', type: 'incoming', amount: 200000, status: 'completed', settled_at: 1787774900 },
        ],
      },
    },
  })

  assert.equal(out.rows.length, 2)
  assert.equal(out.rows.reduce((n, r) => n + r.amount, 0), 300000, 'nothing was silently dropped')
})

await test('a page we have already seen never lands twice', async () => {
  // LNbits offsets shift when a payment settles mid-read, so the same
  // transaction can come back on the next page.
  // The SAME payment on two pages is identical in every field, which is what
  // makes it recognisable as one we already have.
  const row = (n) => ({ id: `tx-${n}`, status: 'completed', amount: 10, settled_at: 1787774933 - n })
  const page = (start) => Array.from({ length: 100 }, (_, i) => row(start + i))
  let call = 0
  const out = await collectTransactions({
    wallets: [{ id: 'w1', name: 'Shop', type: 'lnbits' }],
    // Second page overlaps the first by half.
    providers: { w1: { getTransactions: async () => (call++ === 0 ? page(0) : page(50)) } },
  })

  assert.equal(out.rows.length, 150, 'the union, not the sum')
  assert.equal(new Set(out.rows.map((r) => r.id)).size, 150)
})

await test('a provider stuck on one page stops instead of spinning', async () => {
  let calls = 0
  const page = Array.from({ length: 100 }, (_, i) => ({
    id: `tx-${i}`, status: 'completed', amount: 10, settled_at: 1787774933 - i,
  }))
  const out = await collectTransactions({
    wallets: [{ id: 'w1', name: 'Stuck', type: 'lnbits' }],
    providers: { w1: { getTransactions: async () => { calls += 1; return page } } },
  })
  assert.equal(out.rows.length, 100)
  assert.ok(calls <= 2, `asked ${calls} times`)
})

// ── connecting wallets that are not live ───────────────────────────────────

await test('a wallet with no live provider is connected rather than skipped', async () => {
  // The app keeps one wallet live. Without this, a report over five wallets
  // read one and called the other four unreadable.
  const opened = []
  const out = await collectTransactions({
    wallets: [
      { id: 'live', name: 'Active', type: 'lnbits' },
      { id: 'cold', name: 'Other', type: 'nwc' },
    ],
    providers: { live: { getTransactions: async () => [{ id: 'a', status: 'completed', settled_at: 1787774933 }] } },
    connect: async (w) => {
      opened.push(w.id)
      return { getTransactions: async () => [{ id: 'b', status: 'completed', settled_at: 1787774900 }] }
    },
  })

  assert.deepEqual(opened, ['cold'], 'only the one that was not already open')
  assert.equal(out.rows.length, 2)
  assert.deepEqual(out.readWallets, ['Active', 'Other'])
})

await test('a wallet that will not open is named, and the rest still run', async () => {
  const out = await collectTransactions({
    wallets: [
      { id: 'ok', name: 'Shop', type: 'lnbits' },
      { id: 'bad', name: 'Old phone', type: 'nwc' },
    ],
    connect: async (w) => {
      if (w.id === 'bad') throw new Error('unreachable')
      return { getTransactions: async () => [{ id: 'a', status: 'completed', settled_at: 1787774933 }] }
    },
  })

  assert.deepEqual(out.readWallets, ['Shop'])
  assert.deepEqual(out.failedWallets, ['Old phone'])
  assert.equal(out.rows.length, 1)
  assert.deepEqual(
    out.walletResults.map((r) => `${r.name}:${r.status}`),
    ['Shop:read', 'Old phone:failed'],
  )
})

await test('cancelling says which wallets it never reached', async () => {
  const controller = new AbortController()
  const out = await collectTransactions({
    wallets: [
      { id: 'a', name: 'One', type: 'lnbits' },
      { id: 'b', name: 'Two', type: 'lnbits' },
      { id: 'c', name: 'Three', type: 'lnbits' },
    ],
    connect: async () => ({
      getTransactions: async () => {
        controller.abort()
        return [{ id: 'x', status: 'completed', settled_at: 1787774933 }]
      },
    }),
    signal: controller.signal,
  })

  assert.deepEqual(
    out.walletResults.map((r) => r.status),
    ['read', 'skipped', 'skipped'],
    'a short list is never presented as a complete one',
  )
})

console.log(`\n  ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
