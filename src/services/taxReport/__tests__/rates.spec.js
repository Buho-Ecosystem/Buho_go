/**
 * The historical rate lookup.
 *
 * The property under test throughout is that "we do not know" survives every
 * path. mempool.space answers an unsupported currency with HTTP 200 and an
 * EMPTY BODY, so the obvious implementations — trust res.ok, or fall back to
 * 0 — both produce a confident wrong number in a tax record.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/rates.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  createRateLookup, rateFromSnapshot, supportsCurrency,
  SUPPORTED_CURRENCIES, SETTLEMENT_SOURCE, rateSource,
} from '../rates.js'

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

/** The endpoint's real shape, captured from the live API. */
const ok = (body) => async () => ({ ok: true, text: async () => body })
const priced = (cur, price, timeSec) =>
  ok(JSON.stringify({ prices: [{ time: timeSec, [cur]: price, USD: 71810 }] }))

const AUG_2026 = Date.parse('2026-08-26T12:00:00Z')
const DAY = 86400_000

const PRIMARY = 'https://mempool.space/api/v1'
const FALLBACK = 'https://mempool.emzy.de/api/v1'

/** A server that accepts the connection and never answers, until aborted. */
const hangs = (url, { signal } = {}) => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => reject(new Error('aborted')))
})

/** A fetch that answers per server and counts what each one was asked. */
function servers(byServer) {
  const asked = {}
  const fetchImpl = (url, init) => {
    const server = Object.keys(byServer).find((s) => url.startsWith(s))
    asked[server] = (asked[server] || 0) + 1
    return byServer[server](url, init)
  }
  return { fetchImpl, asked }
}

async function run() {
  await test('the covered currencies are the ones the endpoint answers for', () => {
    assert.deepEqual([...SUPPORTED_CURRENCIES].sort(),
      ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'USD'])
    assert.equal(supportsCurrency('eur'), true)
    assert.equal(supportsCurrency('PLN'), false)
    assert.equal(supportsCurrency(''), false)
    assert.equal(supportsCurrency(null), false)
  })

  await test('an unsupported currency is never asked about', async () => {
    let called = 0
    const lookup = createRateLookup({ currency: 'PLN', fetchImpl: async () => { called += 1; return ok('')() } })
    assert.equal(await lookup.at(AUG_2026), null)
    assert.equal(called, 0, 'no request for a currency the endpoint cannot answer')
    assert.equal(lookup.supported, false)
  })

  await test('an empty body is "not covered", not a crash and not a zero', async () => {
    // HTTP 200 with no body is the documented shape for an uncovered
    // currency. JSON.parse('') throws; a naive `|| 0` invents a price.
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl: ok('') })
    assert.equal(await lookup.at(AUG_2026), null)
  })

  await test('a rate carries the price point\'s own time, not the one we asked for', async () => {
    // The endpoint answers with the NEAREST point it holds. A record that
    // pretends those are the same cannot be audited.
    const pointSec = 1787572400
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl: priced('EUR', 62960, pointSec) })
    const r = await lookup.at(AUG_2026)
    assert.equal(r.rate, 62960)
    assert.equal(r.currency, 'EUR')
    assert.equal(r.source, 'mempool.space/historical-price')
    assert.equal(r.at, pointSec * 1000)
    assert.notEqual(r.at, AUG_2026)
  })

  await test('a response missing the currency key yields no rate', async () => {
    // USD is always present in the payload; asking for EUR and getting only
    // USD back must not silently report dollars as euros.
    const lookup = createRateLookup({
      currency: 'EUR',
      fetchImpl: ok(JSON.stringify({ prices: [{ time: 1787572400, USD: 71810 }] })),
    })
    assert.equal(await lookup.at(AUG_2026), null)
  })

  await test('a failed request is no rate, never an exception', async () => {
    const boom = createRateLookup({ currency: 'EUR', fetchImpl: async () => { throw new Error('offline') } })
    assert.equal(await boom.at(AUG_2026), null)
    const notOk = createRateLookup({ currency: 'EUR', fetchImpl: async () => ({ ok: false, text: async () => '' }) })
    assert.equal(await notOk.at(AUG_2026), null)
    const garbage = createRateLookup({ currency: 'EUR', fetchImpl: ok('<html>rate limited</html>') })
    assert.equal(await garbage.at(AUG_2026), null)
  })

  await test('one request per day, however many transactions fall in it', async () => {
    let calls = 0
    const lookup = createRateLookup({
      currency: 'EUR',
      fetchImpl: async (...a) => { calls += 1; return priced('EUR', 62960, 1787572400)(...a) },
    })
    const noon = Date.parse('2026-08-26T12:00:00Z')
    await lookup.at(noon)
    await lookup.at(noon + 3600_000)
    await lookup.at(noon + 7200_000)
    assert.equal(calls, 1, 'same day, one request')
    await lookup.at(noon + 86400_000)
    assert.equal(calls, 2, 'a new day, a new request')
    assert.equal(lookup.daysCached, 2)
  })

  await test('a miss is cached too, so a dead currency is not asked twice a day', async () => {
    let calls = 0
    const lookup = createRateLookup({
      currency: 'EUR',
      fetchImpl: async () => { calls += 1; return { ok: true, text: async () => '' } },
    })
    await lookup.at(AUG_2026)
    await lookup.at(AUG_2026 + 1000)
    assert.equal(calls, 1)
  })

  await test('the request budget is a hard stop, and running out means no rate', async () => {
    // Hundreds of requests at a public API for one report is both slow and
    // rude. Past the budget the report states nothing rather than guessing.
    let calls = 0
    const lookup = createRateLookup({
      currency: 'EUR', maxRequests: 2,
      fetchImpl: async (...a) => { calls += 1; return priced('EUR', 62960, 1787572400)(...a) },
    })
    const day = 86400_000
    assert.ok(await lookup.at(AUG_2026))
    assert.ok(await lookup.at(AUG_2026 + day))
    assert.equal(await lookup.at(AUG_2026 + 2 * day), null, 'budget spent')
    assert.equal(calls, 2)
  })

  // ── servers that fail ────────────────────────────────────────────────────

  await test('a server that never answers is given up on its time limit, and the fallback answers', async () => {
    const { fetchImpl, asked } = servers({ [PRIMARY]: hangs, [FALLBACK]: priced('EUR', 62960, 1787572400) })
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl, servers: [PRIMARY, FALLBACK], timeoutMs: 20 })
    const r = await lookup.at(AUG_2026)
    assert.equal(r.rate, 62960)
    assert.equal(r.source, rateSource(FALLBACK))
    assert.equal(r.source, 'mempool.emzy.de/historical-price', 'the source names the server that answered')
    assert.deepEqual(asked, { [PRIMARY]: 1, [FALLBACK]: 1 })
  })

  await test('a server that failed is not asked again for later days', async () => {
    // Otherwise a year of rates waits out the dead server's limit once per day.
    const { fetchImpl, asked } = servers({ [PRIMARY]: hangs, [FALLBACK]: priced('EUR', 62960, 1787572400) })
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl, servers: [PRIMARY, FALLBACK], timeoutMs: 20 })
    for (let i = 0; i < 5; i += 1) assert.ok(await lookup.at(AUG_2026 + i * DAY))
    assert.deepEqual(asked, { [PRIMARY]: 1, [FALLBACK]: 5 })
  })

  await test('an error answer moves on to the next server too', async () => {
    const { fetchImpl } = servers({
      [PRIMARY]: async () => ({ ok: false, status: 503, text: async () => '' }),
      [FALLBACK]: priced('EUR', 62960, 1787572400),
    })
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl, servers: [PRIMARY, FALLBACK] })
    assert.equal((await lookup.at(AUG_2026)).source, rateSource(FALLBACK))
  })

  await test('with no server answering, every row has no rate and nothing more is asked', async () => {
    const { fetchImpl, asked } = servers({ [PRIMARY]: hangs, [FALLBACK]: hangs })
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl, servers: [PRIMARY, FALLBACK], timeoutMs: 20 })
    assert.equal(await lookup.at(AUG_2026), null)
    assert.equal(await lookup.at(AUG_2026 + DAY), null)
    assert.deepEqual(asked, { [PRIMARY]: 1, [FALLBACK]: 1 })
  })

  await test('a server that answers without a price point is believed, not skipped', async () => {
    // It answered: the fallback mirrors the same data, so asking it as well
    // would only double the requests for a currency neither covers.
    const { fetchImpl, asked } = servers({ [PRIMARY]: ok(''), [FALLBACK]: priced('EUR', 62960, 1787572400) })
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl, servers: [PRIMARY, FALLBACK] })
    assert.equal(await lookup.at(AUG_2026), null)
    assert.deepEqual(asked, { [PRIMARY]: 1 })
  })

  await test('the default servers are the app\'s own default and fallback', async () => {
    const urls = []
    const lookup = createRateLookup({
      currency: 'EUR',
      fetchImpl: async (url) => { urls.push(url); throw new Error('offline') },
    })
    await lookup.at(AUG_2026)
    assert.deepEqual(urls.map((u) => u.split('/historical-price')[0]), [PRIMARY, FALLBACK])
  })

  await test('an unusable timestamp is not looked up', async () => {
    let calls = 0
    const lookup = createRateLookup({ currency: 'EUR', fetchImpl: async () => { calls += 1; return ok('')() } })
    for (const bad of [0, -1, NaN, null, undefined, 'yesterday']) {
      assert.equal(await lookup.at(bad), null, String(bad))
    }
    assert.equal(calls, 0)
  })

  // ── the snapshot recorded at settlement ──────────────────────────────────

  await test('a settlement snapshot outranks a lookup and says so', () => {
    const r = rateFromSnapshot({ currency: 'EUR', rate: 62960, capturedAt: 1787774900000 }, 'EUR')
    assert.equal(r.rate, 62960)
    assert.equal(r.source, SETTLEMENT_SOURCE)
    assert.equal(r.at, 1787774900000)
  })

  await test('a snapshot in another currency is refused, not converted', () => {
    // Converting would need a second historical rate for the pair, and the
    // compounded guess is exactly the kind of number that looks precise and
    // is not.
    assert.equal(rateFromSnapshot({ currency: 'USD', rate: 71810 }, 'EUR'), null)
  })

  await test('a snapshot without a usable rate is no rate', () => {
    assert.equal(rateFromSnapshot(null, 'EUR'), null)
    assert.equal(rateFromSnapshot({ currency: 'EUR' }, 'EUR'), null)
    assert.equal(rateFromSnapshot({ currency: 'EUR', rate: 0 }, 'EUR'), null)
    assert.equal(rateFromSnapshot({ currency: 'EUR', rate: -1 }, 'EUR'), null)
    assert.equal(rateFromSnapshot({ currency: 'EUR', rate: 'lots' }, 'EUR'), null)
  })

  console.log(`\n  ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
