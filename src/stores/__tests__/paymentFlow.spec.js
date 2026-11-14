import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { usePaymentFlowStore } from '../paymentFlow.js'

beforeEach(() => setActivePinia(createPinia()))

test('an absent lease never owns an idle flow or moves it into a committed phase', () => {
  const flow = usePaymentFlowStore()
  for (const id of [undefined, null, 0, 1]) {
    assert.equal(flow.isCurrent(id), false)
    assert.equal(flow.setStage(id, 'sending'), false)
    assert.equal(flow.cancel(id), false)
    assert.equal(flow.finish(id), false)
  }
  assert.equal(flow.active, false)
  assert.equal(flow.committed, false)
  assert.equal(flow.stage, 'idle')
  assert.notEqual(flow.begin({ address: 'anna@example.com' }), false)
})

test('opening owns a synchronous, immutable preview before the resolver starts', () => {
  const flow = usePaymentFlowStore()
  let lookups = 0
  const resolve = async () => { lookups += 1; return { address: 'lnbc1fresh' } }
  const id = flow.begin({ address: ' anna@example.com ', name: 'Anna', amountSats: 25000, fixedAmount: true, resolve })
  assert.equal(typeof id, 'number')
  assert.equal(flow.active, true)
  assert.equal(flow.stage, 'preparing')
  assert.equal(flow.intent.address, 'anna@example.com')
  assert.equal(flow.intent.amountSats, 25000)
  assert.equal(flow.intent.fixedAmount, true)
  assert.equal(flow.intent.resolve, resolve)
  assert.equal(Object.isFrozen(flow.intent), true)
  assert.equal(lookups, 0)
})

test('invalid destinations do not occupy the flow; deferred requests need no known address', () => {
  const flow = usePaymentFlowStore()
  for (const input of [{}, { address: '  ' }, { address: 42 }, { resolve: true }]) assert.equal(flow.begin(input), false)
  assert.equal(flow.active, false)
  assert.equal(flow.stage, 'idle')
  assert.notEqual(flow.begin({ resolve: async () => ({ address: 'lnbc1' }) }), false)
})

test('repeated taps share one pending action and keep the existing lease', () => {
  const flow = usePaymentFlowStore()
  const first = flow.begin({ key: 'request:anna:one', resolve: async () => 'first' })
  const original = flow.intent
  assert.equal(flow.begin({ key: 'request:anna:one', resolve: async () => 'second' }), first)
  assert.equal(flow.intent, original)
  assert.equal(original.signal.aborted, false)
})

test('different Pay again amounts, notes, currencies and recipient previews supersede the pending action', () => {
  const flow = usePaymentFlowStore()
  const original = { address: 'shop@example.com', walletId: 'travel', amountSats: 100, note: 'Coffee', name: 'Shop', contactId: 'c1', payout: { code: 'USD', amount: 1 }, fixedAmount: false, repeat: true }
  for (const changes of [
    { amountSats: 200 }, { note: 'Lunch' }, { payout: { code: 'EUR', amount: 1 } },
    { payout: { code: 'USD', amount: 2 } }, { name: 'Other shop' }, { contactId: 'c2' },
    { fixedAmount: true }, { repeat: false },
  ]) {
    const first = flow.begin(original)
    const signal = flow.intent.signal
    const next = flow.begin({ ...original, ...changes })
    assert.notEqual(next, first, JSON.stringify(changes))
    assert.equal(signal.aborted, true)
    flow.cancel(next)
  }
})

test('fallback identity is stable across object order, callbacks and arbitrary contact objects', () => {
  const flow = usePaymentFlowStore()
  const contact = {}
  contact.self = contact
  const first = flow.begin({ address: ' anna@example.com ', name: 'Anna', payout: { code: 'USD', amount: 2 }, resolve: async () => 'one', contact })
  const signal = flow.intent.signal
  assert.equal(flow.begin({ contact: { different: true }, resolve: async () => 'two', payout: { amount: 2, code: 'USD' }, name: 'Anna', address: 'anna@example.com' }), first)
  assert.equal(signal.aborted, false)
})

test('opaque delimiters in destination and context cannot merge two distinct payment actions', () => {
  const flow = usePaymentFlowStore()
  const first = flow.begin({ address: 'anna@example.com:extra', context: 'context' })
  assert.notEqual(flow.begin({ address: 'anna@example.com', context: 'extra:context' }), first)
})

test('a distinct action supersedes preparation and stale callbacks cannot update or close it', () => {
  const flow = usePaymentFlowStore()
  const first = flow.begin({ address: 'anna@example.com' })
  const signal = flow.intent.signal
  const second = flow.begin({ address: 'bob@example.com' })
  assert.notEqual(second, first)
  assert.equal(signal.aborted, true)
  assert.equal(flow.isCurrent(first), false)
  assert.equal(flow.setStage(first, 'ready'), false)
  assert.equal(flow.cancel(first), false)
  assert.equal(flow.finish(first), false)
  assert.equal(flow.isCurrent(second), true)
  assert.equal(flow.stage, 'preparing')
})

test('cancellation aborts pending preparation and its eventual result cannot revive the sheet', async () => {
  const flow = usePaymentFlowStore()
  let release
  const response = new Promise(resolve => { release = resolve })
  const id = flow.begin({ resolve: () => response })
  const { signal, resolve } = flow.intent
  const pending = resolve()
  assert.equal(flow.cancel(id), true)
  assert.equal(signal.aborted, true)
  release({ address: 'lnbc1late' })
  await pending
  assert.equal(flow.setStage(id, 'ready'), false)
  assert.equal(flow.active, false)
  assert.equal(flow.intent, null)
  assert.equal(flow.stage, 'idle')
})

test('ready and failed preparations remain cancellable and can be explicitly retried', () => {
  const flow = usePaymentFlowStore()
  for (const stage of ['ready', 'error']) {
    const first = flow.begin({ address: 'anna@example.com' })
    assert.equal(flow.setStage(first, stage), true)
    const retry = flow.begin({ address: 'anna@example.com' })
    assert.notEqual(retry, first)
    assert.equal(flow.cancel(retry), true)
  }
})

test('committed sends and success own the flow until explicit completion', () => {
  const flow = usePaymentFlowStore()
  for (const stage of ['sending', 'complete']) {
    const id = flow.begin({ address: 'anna@example.com' })
    const original = flow.intent
    assert.equal(flow.setStage(id, stage), true)
    assert.equal(flow.committed, true)
    assert.equal(flow.cancel(id), false)
    assert.equal(flow.begin({ address: 'bob@example.com' }), false)
    assert.equal(flow.intent, original)
    assert.equal(original.signal.aborted, false)
    assert.equal(flow.finish(id), true)
    assert.equal(original.signal.aborted, true)
    assert.equal(flow.active, false)
    assert.equal(flow.committed, false)
  }
})

test('unrecognized phases and invalid amounts cannot create misleading review state', () => {
  const flow = usePaymentFlowStore()
  for (const amountSats of [0, -1, 1.5, '25', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const id = flow.begin({ address: 'anna@example.com', amountSats, fixedAmount: 'true' })
    assert.equal(flow.intent.amountSats, null)
    assert.equal(flow.intent.fixedAmount, false)
    assert.equal(flow.setStage(id, 'mystery'), false)
    assert.equal(flow.stage, 'preparing')
    flow.cancel(id)
  }
})

test('payment destinations, resolver and lease are never persisted or restored', () => {
  const previous = globalThis.localStorage
  let reads = 0, writes = 0
  globalThis.localStorage = { getItem() { reads += 1; throw new Error('must not read') }, setItem() { writes += 1; throw new Error('must not write') } }
  try {
    const flow = usePaymentFlowStore()
    flow.begin({ address: 'anna@example.com', resolve: async () => ({ address: 'lnbc1secret' }) })
    setActivePinia(createPinia())
    const fresh = usePaymentFlowStore()
    assert.equal(fresh.intent, null)
    assert.equal(fresh.stage, 'idle')
    assert.equal(reads, 0)
    assert.equal(writes, 0)
  } finally { globalThis.localStorage = previous }
})


test('a synchronous host rejection keeps the flow idle and reports a rejected handoff', () => {
  const flow = usePaymentFlowStore()
  const stop = watch(() => flow.intent, intent => {
    if (intent) flow.cancel(intent.id)
  }, { flush: 'sync' })
  assert.equal(flow.begin({ address: 'anna@example.com' }), false)
  assert.equal(flow.intent, null)
  assert.equal(flow.stage, 'idle')
  assert.equal(flow.committed, false)
  stop()
})
