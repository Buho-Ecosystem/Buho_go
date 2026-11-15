/**
 * A payment's fiat value reads the same on History and on its receipt: the
 * value recorded when it happened, or else the value at today's rate, said
 * as that, and only while a current rate exists.
 */
import '../../__tests__/memoryStorage.js'
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const realFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'offline', json: async () => ({}) })
const { warn, error } = console
console.warn = console.error = () => {}
const { FiatRatesService, fiatRatesService: appRates } = await import('../../utils/fiatRates.js')
appRates.stopAutoUpdate()
// The app's own instance asks for rates once when it loads: let that end, unheard.
await appRates.inflight
Object.assign(console, { warn, error })
after(() => { globalThis.fetch = realFetch })
const fiatRatesService = new FiatRatesService()

function methods(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => (name.endsWith('utils/fiatRates.js') ? { fiatRatesService } : {}), module, module.exports)
  return module.exports.default.methods
}
const history = methods('../TransactionHistory.vue')
const receipt = methods('../TransactionDetails.vue')
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
const walletState = { preferredFiatCurrency: 'EUR' }
const eur = (value) => `€${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

test('History and the receipt show the same fiat value for a payment', () => {
  const onHistory = (tx) => history.getFiatAmount.call({ ...history, walletState, loadingFiatRates: false, $t: t }, tx)
  const onReceipt = (tx) => receipt.getFiatAmount.call({ walletState, loadingFiatRates: false, transaction: tx, displayAmountSats: tx.recipientSats, $t: t })
  const HOUR = 60 * 60 * 1000
  fiatRatesService.rates = { EUR: 100_000 }
  fiatRatesService.rateTimes = { EUR: Date.now() }
  fiatRatesService.ratesAvailable = true

  // A value recorded when the payment happened: History shows it, as the receipt does, not today's.
  const recorded = { id: 'a', status: 'completed', recipientSats: 2000, fiatAtSettlement: { currency: 'EUR', amount: 1.5, rate: 75_000 } }
  assert.equal(onHistory(recorded), eur(1.5))
  assert.equal(receipt.formatFiatValue.call({}, recorded.fiatAtSettlement.amount, recorded.fiatAtSettlement.currency), eur(1.5))

  // None recorded: today's value, marked as that, the same on both.
  const plain = { id: 'b', status: 'completed', recipientSats: 2000 }
  assert.equal(onHistory(plain), `≈ ${eur(2)} today`)
  assert.equal(onReceipt(plain), onHistory(plain))

  // No current rate: no value at all, on either.
  fiatRatesService.rateTimes = { EUR: Date.now() - 3 * HOUR }
  assert.equal(onHistory(plain), '')
  assert.equal(onReceipt(plain), '')
  assert.equal(onHistory(recorded), eur(1.5), 'the recorded value does not depend on today\'s rate')
})
