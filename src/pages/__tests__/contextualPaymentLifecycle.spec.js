/** Exercise production Wallet controller methods with real volatile ownership. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createPinia, setActivePinia } from 'pinia'
import { usePaymentFlowStore } from '../../stores/paymentFlow.js'
import { usePaymentPreferencesStore } from '../../stores/paymentPreferences.js'
import * as payingWallets from '../../utils/payingWallets.js'
import * as walletCapabilities from '../../utils/walletCapabilities.js'

const source = readFileSync(new URL('../Wallet.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } })
const module = { exports: {} }
const dependencies = { '../utils/payingWallets.js': payingWallets, '../utils/walletCapabilities.js': walletCapabilities }
new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports)
const options = module.exports.default
const t = key => key
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const controllers = []
beforeEach(() => {
  setActivePinia(createPinia())
  const values = new Map()
  globalThis.localStorage = {
    fail: false, getItem: key => values.get(key) || null,
    setItem(key, value) { if (this.fail) throw new Error('storage full'); values.set(key, value) },
  }
})
afterEach(() => { for (const vm of controllers.splice(0)) options.beforeUnmount.call(vm) })

function controller(input = {}, { readiness = Promise.resolve(), detected } = {}) {
  const paymentFlow = usePaymentFlowStore()
  paymentFlow.begin({ address: 'anna@example.com', name: 'Anna', amountSats: 25000, note: 'Pizza', ...input })
  const paymentPreferences = usePaymentPreferencesStore()
  const activeWallet = { id: 'home', name: 'Everyday', type: 'spark' }
  const walletStore = {
    wallets: [activeWallet, { id: 'travel', name: 'Travel', type: 'lnbits' }],
    activeWalletId: 'home', activeWallet, activeWalletType: 'spark',
    balances: { home: 100000, travel: 100000 }, connectionStates: {},
    whenHydrated: () => readiness,
    initialize: () => { throw new Error('recipient preparation must not wait for all provider connections') },
    getDisplayBalance: () => ({ known: true, balance: 100000, isCached: false }),
  }
  const payloads = [], resets = [], routes = []
  const vm = {
    ...options.methods,
    ...options.data.call({ paymentOnly: true }),
    identityStore: { nostrPubkeyHex: 'alice' }, paymentOnly: true, paymentIntent: paymentFlow.intent, paymentFlow, paymentPreferences, walletStore,
    pendingDestinationType: 'lightning', addressBookStore: { getEntryById: () => null },
    $t: t, $router: { push: value => routes.push(value), replace: value => routes.push(value), back: () => routes.push('back') },
    $refs: { sendSheetRef: { resetSlide: () => resets.push(true) } },
    recipientFromContact: (contact, fallback) => ({ name: contact?.name || fallback.fallbackName }),
    _stopDeliveryPoll() {}, stopBitcoinDepositPolling() {}, stopWithdrawMonitor() {}, stopMerchantCountdown() {}, cancelBrantaLookup() {},
    onPaymentDetected: detected || async function(payload) {
      payloads.push(payload)
      this.pendingPayment = { type: payload.type, address: payload.data }
      this.sendingWalletId = this.chooseSendingWalletId('lightning', payload.sendingWalletId)
      this.finishContextualPreparation(true)
    },
  }
  for (const key of ['contextualPaymentSheet', 'payerWalletId', 'payingAmountSats', 'payingWalletEntries', 'sendingWalletBlock', 'paymentSheetWalletCanPay', 'isSparkL1Payment']) {
    Object.defineProperty(vm, key, { configurable: true, get: () => options.computed[key].call(vm) })
  }
  const prepare = vm.prepareContextualPayment
  vm.prepareContextualPayment = function() { return this.preparationPromise = prepare.call(this) }
  controllers.push(vm)
  return { vm, paymentFlow, paymentPreferences, walletStore, payloads, resets, routes,
    start: () => options.created.call(vm) }
}

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

test('the sheet and stable preview exist immediately, while wallet readiness gates all resolver work', async () => {
  const ready = deferred()
  let lookups = 0
  const resolve = async () => { lookups += 1; return { address: 'lnbc1fresh', addressType: 'invoice', context: 'chat-context', contactId: 'anna-id' } }
  const { vm, start, payloads, routes } = controller({ fixedAmount: true, resolve }, { readiness: ready.promise })
  assert.equal(vm.showSendSheet, true)
  assert.equal(vm.preparationState, 'preparing')
  assert.deepEqual(vm.contextualPaymentSheet, { recipient: { name: 'Anna' }, amount: { mode: 'fixed', fixedSats: 25000 }, description: 'Pizza' })
  await start()
  assert.equal(lookups, 0)
  assert.deepEqual(payloads, [])
  assert.deepEqual(routes, [])
  ready.resolve()
  await vm.preparationPromise
  assert.equal(lookups, 1)
  assert.equal(vm.preparationState, 'ready')
  assert.equal(payloads[0].data, 'lnbc1fresh')
  assert.equal(payloads[0].type, 'lightning_invoice')
  assert.equal(payloads[0].firstParty, true)
  assert.equal(payloads[0].paymentContactId, 'anna-id')
  assert.equal(payloads[0].paymentContext, 'chat-context')
  assert.deepEqual(payloads[0].prefill, { amountSats: 25000, note: 'Pizza', payout: null })
})

test('cancelling before readiness prevents lookup and cannot reopen the origin payment', async () => {
  const ready = deferred()
  let lookups = 0
  const { vm, start, payloads, paymentFlow, routes } = controller({ resolve: async () => { lookups += 1; return { address: 'lnbc1late' } } }, { readiness: ready.promise })
  await start()
  vm.onSendSheetCancel()
  ready.resolve()
  await vm.preparationPromise
  assert.equal(lookups, 0)
  assert.equal(vm.showSendSheet, false)
  assert.equal(vm.pendingPayment, null)
  assert.equal(paymentFlow.active, false)
  assert.deepEqual(payloads, [])
  assert.deepEqual(routes, [])
})

test('cancelled, replaced and unmounted controllers ignore a resolver that finishes late', async () => {
  for (const abandon of ['cancel', 'supersede', 'unmount']) {
    const response = deferred()
    const { vm, start, payloads, paymentFlow } = controller({ resolve: () => response.promise })
    await start(); await tick()
    const old = vm.paymentIntent
    if (abandon === 'cancel') vm.onSendSheetCancel()
    if (abandon === 'supersede') paymentFlow.begin({ address: 'bob@example.com' })
    if (abandon === 'unmount') options.beforeUnmount.call(vm)
    response.resolve({ address: 'lnbc1late', addressType: 'invoice' })
    await vm.preparationPromise
    assert.deepEqual(payloads, [], abandon)
    assert.equal(vm.preparationError, '', abandon)
    if (abandon !== 'unmount') assert.equal(old.signal.aborted, true)
  }
})

test('a retry owns its own attempt; an earlier rejection cannot replace its ready result', async () => {
  const first = deferred(), second = deferred()
  let lookups = 0
  const { vm, start, payloads } = controller({ resolve: () => (++lookups === 1 ? first.promise : second.promise) })
  await start(); await tick()
  const original = vm.preparationPromise
  const retry = vm.prepareContextualPayment()
  await tick()
  second.resolve({ address: 'lnbc1retry', addressType: 'invoice' })
  await retry
  assert.equal(vm.preparationState, 'ready')
  first.reject(new Error('earlier attempt failed'))
  await original
  assert.equal(vm.preparationState, 'ready')
  assert.equal(vm.preparationError, '')
  assert.deepEqual(payloads.map(payload => payload.data), ['lnbc1retry'])
})

test('failed readiness or resolution becomes a brief retry message inside the existing sheet', async () => {
  for (const failure of ['readiness', 'resolver']) {
    const ready = deferred()
    const { vm, start, payloads } = controller({ resolve: async () => { throw new Error('private service detail') } }, { readiness: ready.promise })
    await start()
    if (failure === 'readiness') ready.reject(new Error('wallet details'))
    else ready.resolve()
    await vm.preparationPromise
    assert.equal(vm.preparationState, 'error')
    assert.equal(vm.preparationError, 'Could not get payment details. Try again.')
    assert.equal(vm.showSendSheet, true)
    assert.deepEqual(payloads, [])
  }
})

test('missing or blocked preference stays selected; explicit payment choice wins and Home stays unchanged', () => {
  const { vm, paymentPreferences, walletStore } = controller()
  paymentPreferences.setPreferred('removed')
  assert.equal(vm.chooseSendingWalletId('lightning'), 'removed')
  vm.sendingWalletId = 'removed'
  vm.pendingPayment = { type: 'lightning_invoice', amount: 25000 }
  assert.equal(vm.getSendingWallet(), null)
  assert.equal(vm.getSendingWalletType(), null)
  assert.equal(vm.paymentSheetWalletCanPay, false)
  assert.equal(vm.chooseSendingWalletId('lightning', 'travel'), 'travel')
  paymentPreferences.setPreferred('travel')
  walletStore.connectionStates.travel = { connected: false, error: 'offline' }
  vm.sendingWalletId = vm.chooseSendingWalletId('lightning')
  assert.equal(vm.sendingWalletId, 'travel')
  assert.equal(vm.paymentSheetWalletCanPay, false)
  assert.equal(vm.chooseSendingWalletId('lightning', 'home'), 'home')
  assert.equal(paymentPreferences.preferredWalletId, 'travel')
  assert.equal(walletStore.activeWalletId, 'home')
})

function readyToConfirm() {
  const state = controller()
  state.vm._preparationAttempt = 1
  state.vm.preparationState = 'ready'
  state.vm.pendingPayment = { type: 'lightning_invoice', amount: 25000 }
  state.vm.sendingWalletId = 'home'
  state.paymentFlow.setStage(state.vm.paymentIntent.id, 'ready')
  return state
}

test('confirm locks ownership synchronously before executor awaits; duplicate tap and Cancel cannot interrupt', async () => {
  const { vm, paymentFlow, resets } = readyToConfirm()
  const executor = deferred()
  let sends = 0
  vm.confirmPayment = () => { sends += 1; return executor.promise }
  const sent = vm.onSendSheetConfirm({ amountSats: 25000, comment: 'Pizza' })
  assert.equal(paymentFlow.committed, true)
  assert.equal(paymentFlow.stage, 'sending')
  await vm.onSendSheetConfirm({ amountSats: 25000 })
  vm.onSendSheetCancel()
  assert.equal(sends, 1)
  assert.equal(vm.showSendSheet, true)
  assert.equal(vm.paymentAmount, '25000')
  executor.resolve()
  await sent
  assert.equal(paymentFlow.stage, 'ready', 'an early executor return releases the lock for retry')
  assert.equal(resets.length, 1)
})

test('early PIN/validation return and thrown executor release ownership without losing payment draft', async () => {
  for (const throws of [false, true]) {
    const { vm, paymentFlow } = readyToConfirm()
    const draft = vm.pendingPayment
    vm.confirmPayment = async () => { if (throws) throw new Error('provider exception') }
    const result = vm.onSendSheetConfirm({ amountSats: 25000, comment: 'Keep me', payout: { code: 'KES', amount: 5 } })
    if (throws) await assert.rejects(result)
    else await result
    assert.equal(paymentFlow.stage, 'ready')
    assert.equal(paymentFlow.committed, false)
    assert.equal(vm.pendingPayment, draft)
    assert.equal(vm.paymentComment, 'Keep me')
    assert.deepEqual(vm.sendPayout, { code: 'KES', amount: 5 })
  }
})

test('successful payment keeps ownership for its receipt instead of reopening another send', async () => {
  const { vm, paymentFlow } = readyToConfirm()
  vm.confirmPayment = async () => { vm.pendingPayment = null; vm.showSendSuccess = true }
  await vm.onSendSheetConfirm({ amountSats: 25000 })
  assert.equal(paymentFlow.stage, 'complete')
  assert.equal(paymentFlow.begin({ address: 'bob@example.com' }), false)
  vm.returnAfterPayment()
  assert.equal(paymentFlow.active, false)
})

test('on-chain submission locks while pending, then releases only after the submission succeeds', async () => {
  for (const succeeds of [false, true]) {
    const { vm, paymentFlow } = readyToConfirm()
    const submitted = deferred()
    Object.defineProperty(vm, 'isSparkL1Payment', { value: true })
    vm.executeSparkL1Withdrawal = async amount => {
      assert.equal(amount, 25000)
      await submitted.promise
      if (succeeds) vm.pendingPayment = null
    }
    const sending = vm.onSendSheetConfirm({ amountSats: 25000 })
    assert.equal(paymentFlow.committed, true)
    submitted.resolve()
    await sending
    assert.equal(paymentFlow.active, !succeeds)
    assert.equal(paymentFlow.stage, succeeds ? 'idle' : 'ready')
  }
})

test('confirmation refuses a preparing, unavailable or stale payment before invoking the executor', async () => {
  for (const blockedBy of ['preparing', 'unavailable', 'stale']) {
    const { vm, paymentFlow } = readyToConfirm()
    let sends = 0
    vm.confirmPayment = async () => { sends += 1 }
    if (blockedBy === 'preparing') vm.preparationState = 'preparing'
    if (blockedBy === 'unavailable') vm.sendingWalletId = 'removed'
    if (blockedBy === 'stale') paymentFlow.begin({ address: 'bob@example.com' })
    await vm.onSendSheetConfirm({ amountSats: 25000 })
    assert.equal(sends, 0, blockedBy)
    assert.equal(paymentFlow.committed, false, blockedBy)
  }
})

test('preference write failure preserves saved preference and one-off choice with a short retry message', () => {
  const { vm, paymentPreferences } = readyToConfirm()
  paymentPreferences.setPreferred('home')
  vm.onSendingWalletChange('travel')
  assert.equal(vm.sendingWalletId, 'travel')
  localStorage.fail = true
  vm.savePaymentWalletPreference('travel')
  assert.equal(paymentPreferences.preferredWalletId, 'home')
  assert.equal(vm.sendingWalletId, 'travel')
  assert.equal(vm.walletPreferenceError, 'Could not save your preference. Try again.')
  localStorage.fail = false
  vm.savePaymentWalletPreference('travel')
  assert.equal(paymentPreferences.preferredWalletId, 'travel')
  assert.equal(vm.walletPreferenceError, '')
  vm.isSendingPayment = true
  vm.savePaymentWalletPreference('home')
  assert.equal(paymentPreferences.preferredWalletId, 'travel')
})


test('Home shortcuts cannot stack over a contextual payment', () => {
  assert.equal(options.computed.openActionWouldInterrupt.call({ paymentFlow: { active: true } }), true)
})

test('a changed identity cannot announce or save the old payment under its signer', () => {
  const { vm, paymentFlow } = controller()
  vm._paymentIdentity = 'alice'
  vm.identityStore.nostrPubkeyHex = 'carol'
  assert.equal(vm.isPaymentIdentityCurrent(), false)
  // The EventBus dependency deliberately has no emit: a changed identity
  // must return before touching it. The money/receipt owner remains current.
  vm.emitPaymentSent({ context: 'chat:alice-bob', amountSats: 500 })
  assert.equal(paymentFlow.active, true)
  vm.onSendSaveContactClicked()
  assert.equal(vm.showSaveContactDialog, false)
  assert.equal(paymentFlow.active, false)
})
