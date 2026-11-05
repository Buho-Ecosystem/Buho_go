/**
 * A rate's age is what lets the register refuse a sale priced with an old
 * Bitcoin price (#456). The service keeps a currency's last real rate when
 * its own source fails; that rate must keep its old fetch time, or a stale
 * price would pass as fresh because another currency was just fetched.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/fiatRates.spec.js
 */

import '../../__tests__/memoryStorage.js'
import { strict as assert } from 'node:assert'
import { FiatRatesService } from '../fiatRates.js'
import { MEMPOOL_RATE_CURRENCIES } from '../fiatCurrencies.js'

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

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => body })

/** Mempool answers with `prices`; Alby answers per currency, or fails for those in `albyDown`. */
function serve({ prices, albyDown = [] }) {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/prices')) return prices ? json(prices) : json({}, false)
    const code = url.match(/rates\/(\w+)\.json$/)[1].toUpperCase()
    return albyDown.includes(code) ? json({}, false) : json({ rate_float: 1_000 })
  }
}

const quiet = { log: console.log, warn: console.warn, error: console.error }
console.warn = () => {}
console.error = () => {}
console.log = (...args) => { if (String(args[0]).startsWith('  ')) quiet.log(...args) }

await test('a fetched rate carries the time it was priced at', async () => {
  const pricedAt = 1_800_000_000
  serve({ prices: { time: pricedAt, ...Object.fromEntries(MEMPOOL_RATE_CURRENCIES.map((c) => [c, 100_000])) } })
  const service = new FiatRatesService()
  await service.refreshRates()
  assert.equal(service.getRateTimes().USD, pricedAt * 1000)
  assert.ok(service.getRateTimes().KES >= Date.now() - 5_000, 'an Alby rate is timed when fetched')
})

await test('a rate kept from an earlier fetch keeps its old time', async () => {
  const old = Date.now() - 3 * 60 * 60 * 1000
  serve({ prices: { time: Math.floor(Date.now() / 1000), ...Object.fromEntries(MEMPOOL_RATE_CURRENCIES.map((c) => [c, 100_000])) }, albyDown: ['KES'] })
  const service = new FiatRatesService()
  service.rates = { KES: 9_000_000 }
  service.rateTimes = { KES: old }
  await service.refreshRates()
  assert.equal(service.rates.KES, 9_000_000, 'the last real rate is still shown')
  assert.equal(service.getRateTimes().KES, old, 'but it is three hours old, not fresh')
})

await test('a kept rate without a known time gets none', async () => {
  serve({ prices: { time: Math.floor(Date.now() / 1000), USD: 100_000 }, albyDown: ['ZMW'] })
  const service = new FiatRatesService()
  service.rates = { ZMW: 1_500_000 }
  service.rateTimes = {}
  await service.refreshRates()
  assert.equal(service.getRateTimes().ZMW, undefined)
})

await test('rates saved before fetch times were kept are fetched again', async () => {
  const service = new FiatRatesService()
  service.rates = { USD: 100_000 }
  service.lastUpdate = new Date()
  service.rateTimes = {}
  assert.equal(service.needsUpdate(), true)
  service.rateTimes = { USD: Date.now() }
  assert.equal(service.needsUpdate(), false)
})

await test('fetch times survive a restart with the cached rates', async () => {
  serve({ prices: { time: 1_800_000_000, USD: 100_000 } })
  const first = new FiatRatesService()
  await first.refreshRates()
  const restarted = new FiatRatesService()
  assert.equal(restarted.getRateTimes().USD, 1_800_000_000 * 1000)
})

Object.assign(console, quiet)
console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
