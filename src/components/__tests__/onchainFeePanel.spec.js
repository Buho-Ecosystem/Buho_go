/** SDK quote ownership across wallet, amount, address and component lifetime. */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
const script = readFileSync(new URL('../OnchainFeePanel.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const { code } = transformSync(script, { format: 'cjs' })
const module = { exports: {} }
const dependencies = {
  '../utils/amountFormatting': { formatAmount: value => `${value} sats` },
  '../utils/l1WithdrawErrors': { describeL1WithdrawError: () => ({ title: 'Could not calculate fee', description: 'Try again.' }) },
}
new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports)
const panel = module.exports.default
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const quote = (id, fee = 17) => Object.fromEntries(['slow', 'medium', 'fast'].map(speed => [speed,
  { feeQuoteId: id, serviceFee: 7, networkFee: fee - 7, totalFee: fee, timeEstimate: 'Next block' },
]))
const panels = []
afterEach(() => { for (const vm of panels.splice(0)) panel.beforeUnmount.call(vm) })
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function harness({ connect } = {}) {
  const requests = [], errors = [], gates = [], pending = [], responses = []
  const vm = { ...panel.methods, ...panel.data(), amountSats: 1000, address: 'bc1-address-A', walletId: 'wallet-A', availableBalance: 100000,
    $t: key => key, $emit: (event, value) => { if (event === 'update:fee') gates.push(value) },
    walletStore: { useBip177Format: false, showPaymentError: (...args) => errors.push(args),
      ensureSparkConnected: connect || (async walletId => ({ getWithdrawalFeeQuote: (amount, address) => {
        const response = deferred()
        requests.push({ walletId, amount, address })
        responses.push(response)
        return response.promise
      } })),
    },
  }
  for (const [key, compute] of Object.entries(panel.computed)) Object.defineProperty(vm, key, { get: () => compute.call(vm) })
  const fetch = vm.fetchFeeQuote
  vm.fetchFeeQuote = function() { const job = fetch.call(this); pending.push(job); return job }
  vm.change = (key, value) => {
    const before = vm[key]
    vm[key] = value
    panel.watch[key].handler.call(vm, value, before)
  }
  panels.push(vm)
  return { vm, requests, errors, gates, pending, responses }
}

test('a live SDK quote supplies exact tier totals and the commit gate', async () => {
  const { vm, requests, responses, gates } = harness()
  const reading = vm.fetchFeeQuote()
  await tick()
  assert.deepEqual(requests, [{ walletId: 'wallet-A', amount: 1000, address: 'bc1-address-A' }])
  responses[0].resolve(quote('sdk-quote', 19))
  await reading
  assert.equal(vm.totalAmount, 1019)
  assert.equal(vm.selectedFee.totalFee, 19)
  assert.deepEqual(gates.at(-1), { ready: true, speed: 'medium', feeQuoteId: 'sdk-quote', totalFeeSats: 19, insufficient: false })
  assert.equal(vm.isLoadingFeeQuote, false)
})

test('amount, address and payer edits synchronously invalidate the old quote and gate', () => {
  for (const [key, next] of [['amountSats', 2000], ['address', 'bc1-address-B'], ['walletId', 'wallet-B']]) {
    const { vm, gates } = harness()
    vm.feeQuote = quote('old')
    assert.equal(panel.watch[key].flush, 'sync')
    vm.change(key, next)
    assert.equal(vm.feeQuote, null, key)
    assert.equal(gates.at(-1), null, key)
    assert.equal(vm.selectedFee, null, key)
  }
})

test('a quote for the previous address cannot price the new destination', async () => {
  const { vm, responses, pending } = harness()
  const first = vm.fetchFeeQuote()
  await tick()
  vm.change('address', 'bc1-address-B')
  await tick()
  responses[1].resolve(quote('new-address', 30))
  await pending[1]
  responses[0].resolve(quote('old-address', 1))
  await first
  assert.equal(vm.selectedFee.feeQuoteId, 'new-address')
  assert.equal(vm.selectedFee.totalFee, 30)
})

test('wallet A to B to A never resurrects the first A response', async () => {
  const { vm, responses, pending } = harness()
  const first = vm.fetchFeeQuote()
  await tick()
  vm.change('walletId', 'wallet-B')
  await tick()
  vm.change('walletId', 'wallet-A')
  await tick()
  responses[2].resolve(quote('latest-A', 40))
  await pending[2]
  responses[0].resolve(quote('stale-A', 1))
  responses[1].resolve(quote('stale-B', 2))
  await Promise.all([first, pending[1]])
  assert.equal(vm.selectedFee.feeQuoteId, 'latest-A')
  assert.equal(vm.selectedFee.totalFee, 40)
})

test('a stale failure cannot report an error, clear a newer quote or stop its loading state', async () => {
  const { vm, responses, pending, errors } = harness()
  const first = vm.fetchFeeQuote()
  await tick()
  vm.change('walletId', 'wallet-B')
  await tick()
  responses[0].reject(new Error('stale private failure'))
  await first
  assert.equal(vm.isLoadingFeeQuote, true, 'new request remains in progress')
  assert.deepEqual(errors, [])
  responses[1].resolve(quote('new', 30))
  await pending[1]
  assert.equal(vm.selectedFee.feeQuoteId, 'new')
  assert.equal(vm.isLoadingFeeQuote, false)
})

test('changing context while a provider connects prevents even starting the old SDK quote', async () => {
  const connected = deferred()
  let sdkCalls = 0
  const { vm } = harness({ connect: () => connected.promise })
  const first = vm.fetchFeeQuote()
  vm.change('amountSats', 2000)
  connected.resolve({ getWithdrawalFeeQuote: async () => { sdkCalls += 1; return quote('old') } })
  await first
  assert.equal(sdkCalls, 0)
  assert.equal(vm.feeQuote, null)
})

test('late quote success or rejection after unmount emits nothing and shows no error', async () => {
  for (const fails of [false, true]) {
    const { vm, responses, gates, errors } = harness()
    const reading = vm.fetchFeeQuote()
    await tick()
    panel.beforeUnmount.call(vm)
    const gateCount = gates.length
    if (fails) responses[0].reject(new Error('late failure'))
    else responses[0].resolve(quote('late'))
    await reading
    assert.equal(vm.feeQuote, null)
    assert.equal(gates.length, gateCount)
    assert.deepEqual(errors, [])
  }
})

test('a current failure closes the fee gate and uses the existing concise error presentation', async () => {
  const { vm, responses, gates, errors } = harness()
  const reading = vm.fetchFeeQuote()
  await tick()
  const original = console.error
  console.error = () => {}
  try { responses[0].reject(new Error('SDK quote unavailable')); await reading }
  finally { console.error = original }
  assert.equal(vm.feeQuote, null)
  assert.equal(vm.isLoadingFeeQuote, false)
  assert.equal(gates.at(-1), null)
  assert.equal(errors.length, 1)
  assert.equal(errors[0][1].reason, 'Try again.')
})
