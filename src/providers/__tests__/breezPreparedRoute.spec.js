/** Verify the actual prepared route before the SDK can debit, without changing route preference. */
import assert from 'node:assert/strict'
import { invoiceFor } from '../../utils/__tests__/lnurlPayFixtures.js'
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.fetch = async () => { throw new Error('network disabled under test') }
const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js')
const invoice = invoiceFor(2400)
function harness(sparkFee = null) {
  const sends = [], prepared = []
  const sdk = {
    async prepareSendPayment(request) { prepared.push(request); return { amount: 2400n, paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 7, sparkTransferFeeSats: sparkFee, invoiceDetails: { invoice: { bolt11: invoice } } } } },
    async sendPayment(input) { sends.push(input); return { payment: { id: 'payment', status: 'completed', amount: 2400n, fees: 7n } } },
  }
  const provider = new BreezSparkWalletProvider('actual-route', { _testSdk: sdk })
  provider.isConnected = true
  return { provider, sdk, sends, prepared }
}
// The provider keeps timers alive, so this file runs as a plain script that
// exits on its own (like the other provider specs), not under `node --test`.
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failed++; console.error(`  ✗ ${name}\n${error.stack}`) } }
await test('fee quote exposes the destination selected by the identical actual route preference', async () => {
  for (const [sparkFee, kind, fee] of [[null, 'lightning', 7], [1, 'optimizedSpark', 1]]) {
    const { provider } = harness(sparkFee)
    const quote = await provider.getLightningSendFeeEstimate(invoice)
    assert.deepEqual(quote.preparedRoute, { kind, value: invoice })
    assert.equal(quote.estimatedFeeSats, fee)
  }
})
await test('actual prepared destination is checked before funds move', async () => {
  const { provider, sends } = harness()
  const seen = []
  await provider.payInvoice({ invoice, preferSpark: true, maxFee: 7, onPreparedRoute(target) { assert.equal(sends.length, 0); seen.push(target) } })
  assert.deepEqual(seen, [{ kind: 'lightning', value: invoice }])
  assert.equal(sends.length, 1)
})
await test('a changed optimized route refuses before debit while preserving its existing route preference', async () => {
  const { provider, sdk, sends } = harness()
  assert.equal((await provider.getLightningSendFeeEstimate(invoice)).preparedRoute.kind, 'lightning')
  provider._preparedSends.clear() // the 30-second review quote expired
  sdk.prepareSendPayment = async () => ({ amount: 2400n, paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 7, sparkTransferFeeSats: 1 } })
  await assert.rejects(provider.payInvoice({ invoice, preferSpark: true, maxFee: 7, onPreparedRoute(target) {
    assert.equal(target.kind, 'optimizedSpark')
    throw Object.assign(new Error('review route'), { code: 'PAYMENT_REVIEW_REQUIRED' })
  } }), { code: 'PAYMENT_REVIEW_REQUIRED' })
  assert.equal(sends.length, 0)
  assert.equal(provider.isConnected, true, 'a review change is not a provider connection failure')
})
await test('missing or different SDK-parsed invoice cannot inherit the caller input identity', async () => {
  const { provider, sdk, sends } = harness()
  sdk.prepareSendPayment = async () => ({ amount: 2400n, paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 7 } })
  assert.equal((await provider.getLightningSendFeeEstimate(invoice)).preparedRoute.kind, 'unknown')
  provider._preparedSends.clear()
  const other = invoiceFor(2500)
  sdk.prepareSendPayment = async () => ({ amount: 2400n, paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 7, invoiceDetails: { invoice: { bolt11: other } } } })
  await assert.rejects(provider.payInvoice({ invoice, preferSpark: true, maxFee: 7, onPreparedRoute(target) {
    assert.equal(target.value, other)
    throw Object.assign(new Error('review destination'), { code: 'PAYMENT_REVIEW_REQUIRED' })
  } }), { code: 'PAYMENT_REVIEW_REQUIRED' })
  assert.equal(sends.length, 0)
})
await test('verification never bypasses the existing fee cap or forces an alternate route', async () => {
  const { provider, sends } = harness(20)
  let callbacks = 0
  await assert.rejects(provider.payInvoice({ invoice, preferSpark: true, maxFee: 7, onPreparedRoute() { callbacks++ } }), { code: 'PAYMENT_REVIEW_REQUIRED', reason: 'fee' })
  assert.equal(callbacks, 0)
  assert.equal(sends.length, 0)
})
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
