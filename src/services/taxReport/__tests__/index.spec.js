/**
 * `buildReport`, the one place the pieces are wired together.
 *
 * It had no coverage at all, which is how a per-wallet count that meant
 * something different from the report's own count got as far as the screen,
 * and how an array of objects ended up in the metadata of an XML file as the
 * text "[object Object]".
 *
 * Deliberately offline: the report's currency here is one mempool does not
 * serve, so the rate lookup answers null without a request. The fiat path is
 * exercised through `snapshotFor`, which is the rate the app recorded at
 * settlement and is the source the report prefers anyway.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/index.spec.js
 */

import { strict as assert } from 'node:assert'
import { buildReport } from '../index.js'
import { toXml } from '../rows.js'
import { normalizeTx } from '../../txNormalizer.js'

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

const AT = 1787774933 // 2026-08-27T02:48:53Z
const DAY = 86400
/** Not served by mempool's historical-price endpoint, so nothing is fetched. */
const OFFLINE = 'ZAR'

const tx = (id, at, over = {}) => ({
  id, type: 'incoming', amount: 1000, fee: 0, status: 'completed', timestamp: at, ...over,
})

function report(wallets, { period, ...rest } = {}) {
  return buildReport({
    wallets: wallets.map((w) => ({ id: w.id, name: w.name, type: 'lnbits' })),
    providers: Object.fromEntries(wallets.map((w) => [
      w.id, w.rows === null ? undefined : { getTransactions: async () => w.rows },
    ])),
    normalize: (raw, ctx) => normalizeTx(raw, ctx),
    currency: OFFLINE,
    period: period || { fromMs: null, toMs: null },
    ...rest,
  })
}

// ── the period is applied here and nowhere else ────────────────────────────

await test('only transactions inside the period reach the file', async () => {
  const r = await report(
    [{ id: 'w1', name: 'Business', rows: [tx('now', AT), tx('old', AT - 400 * DAY)] }],
    { period: { fromMs: (AT - 30 * DAY) * 1000, toMs: (AT + DAY) * 1000 } },
  )
  assert.equal(r.rows.length, 1)
  assert.equal(r.summary.count, 1)
  assert.equal(r.rows[0].transactionId, 'now')
})

// ── the figures beside each wallet add up to the figure on the report ──────

await test('per-wallet counts are counted after the period, like the report is', async () => {
  // Counting what was READ instead put "2 transactions" beside a wallet in a
  // report whose own header said 1.
  const r = await report(
    [
      { id: 'w1', name: 'Business', rows: [tx('a', AT), tx('b', AT - 400 * DAY)] },
      { id: 'w2', name: 'Personal', rows: [tx('c', AT - DAY)] },
    ],
    { period: { fromMs: (AT - 30 * DAY) * 1000, toMs: (AT + DAY) * 1000 } },
  )

  const by = Object.fromEntries(r.walletResults.map((w) => [w.name, w.count]))
  assert.deepEqual(by, { Business: 1, Personal: 1 })
  assert.equal(r.walletResults.reduce((n, w) => n + w.count, 0), r.summary.count)
})

await test('a wallet inside the report but outside the period reads as zero, not missing', async () => {
  const r = await report(
    [{ id: 'w1', name: 'Business', rows: [tx('old', AT - 400 * DAY)] }],
    { period: { fromMs: (AT - 30 * DAY) * 1000, toMs: (AT + DAY) * 1000 } },
  )
  assert.equal(r.walletResults.length, 1)
  assert.equal(r.walletResults[0].status, 'read')
  assert.equal(r.walletResults[0].count, 0)
})

// ── what goes in the file, and what must not ───────────────────────────────

await test('walletResults never reaches the XML metadata', async () => {
  // toXml writes one element per meta entry and stringifies the value, so an
  // array of objects in there becomes the literal text "[object Object]" in a
  // file whose whole purpose is to be machine readable.
  const r = await report([
    { id: 'w1', name: 'Business', rows: [tx('a', AT)] },
    { id: 'w2', name: 'Personal', rows: [tx('b', AT)] },
  ])

  assert.ok(!('walletResults' in r.meta), 'it belongs beside meta, not inside it')
  const xml = toXml(r.rows, r.meta)
  assert.ok(!xml.includes('[object Object]'), xml.slice(0, 200))
  assert.ok(xml.includes('<readWallets>Business,Personal</readWallets>'))
})

// ── a partial report says so ───────────────────────────────────────────────

await test('a wallet that could not be read is named on the document itself', async () => {
  const r = await report([
    { id: 'w1', name: 'Business', rows: [tx('a', AT)] },
    { id: 'w2', name: 'Old phone', rows: null },
  ])

  assert.deepEqual(r.meta.readWallets, ['Business'])
  assert.deepEqual(r.meta.failedWallets, ['Old phone'])
  assert.ok(r.meta.failedNote.includes('Old phone'))
  assert.equal(r.walletResults.find((w) => w.name === 'Old phone').status, 'failed')
})

await test('the note reads correctly for one wallet and for several', async () => {
  const one = await report([{ id: 'w1', name: 'Alpha', rows: null }])
  assert.ok(one.meta.failedNote.endsWith('appear here.'), one.meta.failedNote)
  assert.ok(one.meta.failedNote.includes(' it '), one.meta.failedNote)

  const many = await report([
    { id: 'w1', name: 'Alpha', rows: null },
    { id: 'w2', name: 'Beta', rows: null },
  ])
  assert.ok(many.meta.failedNote.includes(' them '), many.meta.failedNote)
})

// ── currencies we cannot price ─────────────────────────────────────────────

await test('an unpriceable currency produces rows without inventing values', async () => {
  const r = await report([{ id: 'w1', name: 'Business', rows: [tx('a', AT)] }])
  assert.equal(r.meta.currency, OFFLINE)
  assert.equal(r.meta.currencySupported, false)
  assert.equal(r.rows[0].fiatValueAtTime, '')
  assert.equal(r.summary.missingRates, 1)
})

await test('a rate recorded at settlement is used, and named as its source', async () => {
  const r = await report([{ id: 'w1', name: 'Business', rows: [tx('a', AT)] }], {
    snapshotFor: () => ({ currency: OFFLINE, rate: 1000000, capturedAt: AT * 1000 }),
  })
  assert.equal(r.rows[0].fiatValueAtTime, '10.00', '1000 sats at 1,000,000 a coin')
  assert.equal(r.rows[0].rateSource, 'recorded at settlement')
  assert.equal(r.summary.missingRates, 0)
})

// ── stopping ───────────────────────────────────────────────────────────────

await test('an aborted report says which wallets it never reached', async () => {
  const controller = new AbortController()
  const r = await buildReport({
    wallets: [
      { id: 'w1', name: 'One', type: 'lnbits' },
      { id: 'w2', name: 'Two', type: 'lnbits' },
    ],
    providers: {
      w1: {
        getTransactions: async () => {
          controller.abort()
          return [tx('a', AT)]
        },
      },
      w2: { getTransactions: async () => [tx('b', AT)] },
    },
    normalize: (raw, ctx) => normalizeTx(raw, ctx),
    currency: OFFLINE,
    signal: controller.signal,
  })

  assert.deepEqual(r.walletResults.map((w) => w.status), ['read', 'skipped'])
  assert.deepEqual(r.meta.readWallets, ['One'])
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
