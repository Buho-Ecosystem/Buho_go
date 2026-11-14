import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as storage from '../storage.js'
import * as widget from '../widget.js'

const source = readFileSync(new URL('../../../pages/BitrefillPage.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const { code } = transformSync(script, { format: 'cjs' })
const module = { exports: {} }
const deps = {
  '../services/bitrefill/storage.js': storage,
  '../services/bitrefill/widget.js': widget,
  '../services/bitrefill/pay.js': { payBitrefillInvoice: (store, ...args) => store.pay(...args), BITREFILL_PRICE_EXPIRED: 'BITREFILL_PRICE_EXPIRED' },
  '../utils/lightningInvoice.js': { parseLightningInvoice: invoice => ({ invoice, amount: 100, expiry: Math.floor(Date.now() / 1000) + 60, description: '' }) },
  '../utils/payingWallets.js': { pickDefaultPayingWallet: entries => entries[0] || null },
  '../utils/nwcErrors.js': { NWC_ERROR: { UNCONFIRMED: 'UNCONFIRMED' } },
  '../utils/haptics': { haptics: { success() {}, warning() {}, error() {} } },
}
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports)
const page = module.exports.default

function vmOf({ failWrite = false } = {}) {
  const map = new Map()
  const backing = { getItem: key => map.get(key) ?? null, setItem(key, value) { if (failWrite) throw new Error('quota'); map.set(key, value) } }
  const calls = []
  const notices = []
  const vm = {
    ...page.data(), ...page.methods,
    ledger: storage.createInvoiceLedger({ storage: backing }),
    $t: text => text,
    $q: { notify: notice => notices.push(notice) },
    $refs: { paySheet: { resetSlide() {} } },
    walletStore: { wallets: [{ id: 'wallet', type: 'spark' }], pay: async (...args) => calls.push(args), showPaymentError: error => notices.push(error) },
    payingWallets: [{ id: 'wallet' }],
    sendingWalletId: 'wallet', paySheetOpen: true,
    intent: { invoiceId: 'order', invoice: 'lnbc1testing', amountSats: 100, expiresAt: Math.floor(Date.now() / 1000) + 60 },
    waitForWidgetPaid: async () => false,
  }
  return { vm, calls, notices, map, setFailWrite: value => { failWrite = value } }
}

test('confirm rechecks actual expiry even when the countdown has not ticked', async () => {
  const { vm, calls, notices } = vmOf()
  vm.nowSec -= 60
  vm.intent.expiresAt = Math.floor(Date.now() / 1000) - 1
  await vm.onConfirm()
  clearTimeout(vm.closeTimer)
  assert.equal(calls.length, 0)
  assert.equal(vm.paySheetOpen, false)
  assert.ok(notices.length)
})

test('a payment never reaches a wallet if recording the attempt fails', async () => {
  const { vm, calls, notices } = vmOf({ failWrite: true })
  await assert.doesNotReject(() => vm.onConfirm())
  assert.equal(calls.length, 0)
  assert.equal(vm.isSending, false)
  assert.ok(notices.length)
})

test('a paid update received before a local attempt blocks a later intent', () => {
  const { vm } = vmOf()
  vm.paySheetOpen = false
  vm.intent = null
  vm.onWidgetPaid('order')
  assert.equal(vm.ledger.canPay('order').ok, false)
  vm.onPaymentIntent({ event: 'payment_intent', invoiceId: 'order', paymentUri: 'lnbc1testing' })
  assert.equal(vm.paySheetOpen, false)
})

test('failure to record completion never turns a successful payment into a retry', async () => {
  const { vm, calls, notices, setFailWrite } = vmOf()
  vm.walletStore.pay = async (...args) => { calls.push(args); setFailWrite(true) }
  await assert.doesNotReject(() => vm.onConfirm())
  clearTimeout(vm.closeTimer)
  assert.equal(calls.length, 1)
  assert.equal(vm.isComplete, true)
  assert.equal(notices.length, 0)
  assert.equal(vm.ledger.canPay('order').ok, false)
})

test('expiry while connecting closes the sheet and permits no send', async () => {
  const { vm, notices } = vmOf()
  vm.walletStore.pay = async () => { throw Object.assign(new Error('expired'), { code: 'BITREFILL_PRICE_EXPIRED' }) }
  await vm.onConfirm()
  assert.equal(vm.paySheetOpen, false)
  assert.equal(vm.isSending, false)
  assert.ok(notices.some(notice => /price ran out/.test(notice.message)))
})

const sheetSource = readFileSync(new URL('../../../components/bitrefill/BitrefillEmailSheet.vue', import.meta.url), 'utf8')
const sheetModule = { exports: {} }
const sheetCode = transformSync(sheetSource.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' }).code
new Function('require', 'module', 'exports', sheetCode)(name => deps[name] || (name === '../../services/bitrefill/widget.js' ? widget : {}), sheetModule, sheetModule.exports)
const emailSheet = sheetModule.exports.default

test('an email save cannot be submitted or dismissed again while busy', () => {
  const events = []
  const vm = { ...emailSheet.data(), ...emailSheet.methods, busy: true, editing: false, email: 'person@example.com', $emit: (...args) => events.push(args) }
  vm.onSubmit()
  vm.onDialogModel(false)
  assert.deepEqual(events, [])
  vm.busy = false
  vm.onSubmit()
  assert.deepEqual(events, [['save', 'person@example.com']])
})

test('removing or skipping email waits for an active save', () => {
  const { vm } = vmOf()
  vm.emailBusy = true
  vm.savedEmail = 'person@example.com'
  vm.emailSheetOpen = true
  vm.onEmailRemove()
  vm.onEmailSkip()
  assert.equal(vm.savedEmail, 'person@example.com')
  assert.equal(vm.emailSheetOpen, true)
})
