/** Production Wallet verification/commit boundaries with real request ownership. */
import assert from 'node:assert/strict'
import { beforeEach, afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createPinia, setActivePinia } from 'pinia'
import { usePaymentFlowStore } from '../../stores/paymentFlow.js'
import * as branta from '../../utils/branta.js'
import * as bip21 from '../../utils/bip21.js'
import * as service from '../../services/brantaVerification.js'
let verify, now
const source = readFileSync(new URL('../Wallet.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } })
const module = { exports: {} }
const dependencies = {
  '../utils/branta.js': branta, '../utils/bip21.js': bip21,
  '../utils/merchantQR.js': { SA_RETAIL_SOURCE: 'sa_retail' },
  '../services/brantaVerification.js': { ...service, createBrantaReview: host => service.createBrantaReview(host, {
    createSession: options => service.createBrantaVerification({ ...options, verify: args => verify(args), now: () => now, holdMs: 10, timeoutMs: 100 }),
  }) },
}
new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports)
const options = module.exports.default
const INVOICE = 'lnbc2400invoice'
const target = { kind: 'lightning', value: INVOICE }
const result = name => ({ status: 'match', matchedDestinations: [{ type: 'bolt11', value: INVOICE, isEncrypted: false }], payments: [{ platform: name, destinations: [{ type: 'bolt11', value: INVOICE, isEncrypted: false }] }], verifyUrl: 'https://guardrail.branta.pro/v1/verify/id#local' })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const controllers = []
beforeEach(() => { setActivePinia(createPinia()); now = 1000; verify = async () => result('Original business') })
afterEach(() => controllers.splice(0).forEach(vm => vm.cancelBrantaLookup()))
function harness({ walletType = 'lnbits', payment = {} } = {}) {
  const flow = usePaymentFlowStore()
  flow.begin({ address: INVOICE, addressType: 'invoice' })
  flow.setStage(flow.intent.id, 'ready')
  const reports = [], sent = [], resets = []
  const wallet = { id: 'payer', type: walletType }
  const vm = { ...options.methods, ...options.data.call({ paymentOnly: true }),
    pendingPayment: { type: 'lightning_invoice', invoice: INVOICE, amount: 2400, ...payment },
    sendingWalletId: 'payer', paymentOnly: true, paymentIntent: flow.intent, paymentFlow: flow,
    preparationState: 'ready', _paymentDisposed: false,
    walletStore: { wallets: [wallet], activeWalletId: 'payer', activeWalletType: walletType, activeWallet: wallet, showPaymentError: (...args) => reports.push(args) },
    bitcoinPrefsStore: { brantaVerificationEnabled: true }, payingAmountSats: 2400,
    paymentSheetWalletCanPay: true, isSparkL1Payment: false, canConfirmPayment: true,
    payerRule: { show: false }, refundAddress: null,
    $t: key => key, $q: { notify: () => assert.fail('a review change is one plain line on the sheet, never a toast') }, $refs: { sendSheetRef: { resetSlide: () => resets.push(true) } },
    confirmPayment: async function() { sent.push(this.brantaReceipt(this.pendingPayment)) },
  }
  if (walletType === 'spark') vm.brantaReview().prepared(vm.pendingPayment, { walletId: 'payer', amount: 2400, request: INVOICE, target })
  controllers.push(vm)
  return { vm, flow, reports, sent, resets }
}

test('a reviewed exact business is frozen for the accepted send including the historical check time', async () => {
  const { vm, sent } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  assert.equal(service.brantaVerificationOf(vm.pendingPayment).name, 'Original business')
  now = 1100
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].name, 'Original business')
  assert.equal(sent[0].checkedAt, 1000)
  assert.equal(Object.isFrozen(sent[0]), true)
  vm.pendingPayment.branta = { status: branta.BRANTA_STATUS.VERIFIED, verification: { name: 'Late replacement' } }
  assert.equal(vm.brantaReceipt(vm.pendingPayment).name, 'Original business')
  assert.equal(vm.brantaReceipt({ ...vm.pendingPayment }), null, 'another payment cannot inherit the accepted snapshot')
})
test('a check that only finishes at confirmation is no reason to stop: the send goes on and keeps the business', async () => {
  const response = deferred()
  verify = () => response.promise
  const { vm, sent } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  assert.equal(vm.pendingPayment.branta.status, branta.BRANTA_STATUS.NONE)
  const confirming = vm.onSendSheetConfirm({ amountSats: 2400 })
  response.resolve(result('Newly found business'))
  await confirming
  assert.equal(sent.length, 1, 'the destination is the one the person confirmed')
  assert.equal(sent[0].name, 'Newly found business')
  assert.equal(vm.reviewNotice, '')
})
test('a reviewed business that cannot be confirmed again stops once with a plain line, then sends without the claim', async () => {
  const { vm, sent, resets } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  assert.equal(service.brantaVerificationOf(vm.pendingPayment).name, 'Original business')
  verify = async () => ({ status: 'unknown' })
  vm.brantaReview().stale()
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(sent.length, 0)
  assert.equal(resets.length, 1)
  assert.equal(vm.reviewNotice, 'The business check is not available right now. Review the payment before sending.')
  assert.equal(vm.pendingPayment.branta.status, branta.BRANTA_STATUS.NONE)
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.deepEqual(sent, [null], 'the second tap pays: no loop, and no business is claimed')
  assert.equal(vm.reviewNotice, '')
})
test('a recheck still unanswered at confirmation keeps the business that was reviewed', async () => {
  const { vm, sent } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  verify = () => new Promise(() => {})
  vm.brantaReview().stale()
  now = 1500
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].name, 'Original business')
  assert.equal(sent[0].checkedAt, 1000, 'the time of the check that was shown')
})
test('pending tampering is caught by final confirmation and cannot be cleared by wallet/amount/setting changes', async () => {
  const response = deferred()
  verify = () => response.promise
  const { vm, sent, flow } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  const confirming = vm.onSendSheetConfirm({ amountSats: 2400 })
  response.resolve({ status: 'tampered' })
  await confirming
  assert.equal(sent.length, 0)
  assert.equal(vm.pendingPayment.brantaMismatch, true)
  assert.equal(flow.committed, false)
  vm.bitcoinPrefsStore.brantaVerificationEnabled = false
  vm.payingAmountSats = 5000
  await vm.brantaReview().run(vm.pendingPayment)
  assert.equal(vm.pendingPayment.branta.status, branta.BRANTA_STATUS.TAMPERED)
  await vm.onSendSheetConfirm({ amountSats: 5000 })
  assert.equal(sent.length, 0)
})
test('a stale/resumed merchant replacement returns to review before a send is committed', async () => {
  const { vm, sent } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  verify = async () => result('Changed business')
  vm.brantaReview().stale()
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(sent.length, 0)
  assert.equal(vm.pendingPayment.branta.verification.name, 'Changed business')
  assert.equal(vm.reviewNotice, 'The recipient changed. Review it before sending.')
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(sent.length, 1, 'the changed business was shown and confirmed')
  assert.equal(sent[0].name, 'Changed business')
})
test('a cancelled final check cannot send or replace a new payment', async () => {
  const response = deferred()
  verify = () => response.promise
  const { vm, sent, flow } = harness()
  await vm.brantaReview().run(vm.pendingPayment)
  const confirming = vm.onSendSheetConfirm({ amountSats: 2400 })
  vm.cancelBrantaLookup()
  vm.pendingPayment = null
  flow.cancel()
  response.resolve(result('Too late'))
  await confirming
  assert.deepEqual(sent, [])
  assert.equal(vm.pendingPayment, null)
})
test('first-party requests and SA retail keep their existing exclusion without a network lookup', async () => {
  verify = () => assert.fail('excluded payment must not query Branta')
  for (const payment of [{ firstParty: true }, { source: 'sa_retail' }]) {
    const { vm, sent } = harness({ payment })
    await vm.brantaReview().run(vm.pendingPayment)
    await vm.onSendSheetConfirm({ amountSats: 2400 })
    assert.deepEqual(sent, [null])
  }
})
test('an accepted ordinary payment never acquires a historical merchant from a late result', async () => {
  const { vm, sent } = harness()
  verify = async () => ({ status: 'unknown' })
  await vm.brantaReview().run(vm.pendingPayment)
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.deepEqual(sent, [null])
  vm.pendingPayment.branta = { status: branta.BRANTA_STATUS.VERIFIED, verification: { name: 'After send' } }
  assert.equal(vm.brantaReceipt(vm.pendingPayment), null)
})
test('a final Spark optimized route loses the business claim before debit and releases contextual commit ownership', async () => {
  const { vm, flow, reports } = harness({ walletType: 'spark' })
  await vm.brantaReview().run(vm.pendingPayment)
  assert.equal(vm.pendingPayment.branta.status, branta.BRANTA_STATUS.VERIFIED)
  let debits = 0
  vm.confirmPayment = options.methods.confirmPayment
  vm.sendSparkPayment = async () => {
    vm.brantaReview().assertPrepared(vm.pendingPayment, { kind: 'optimizedSpark', value: INVOICE })
    debits += 1
  }
  await vm.onSendSheetConfirm({ amountSats: 2400 })
  assert.equal(debits, 0)
  assert.equal(flow.stage, 'ready')
  assert.equal(flow.committed, false)
  assert.equal(vm.isSendingPayment, false)
  assert.equal(vm.pendingPayment.branta.status, branta.BRANTA_STATUS.NONE)
  assert.equal(vm.brantaReceipt(vm.pendingPayment), null)
  assert.deepEqual(reports, [], 'a review change is not an error report')
  assert.equal(vm.reviewNotice, 'The business check is not available right now. Review the payment before sending.')
})
