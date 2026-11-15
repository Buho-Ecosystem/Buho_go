/**
 * The Bitrefill shop page (pages/BitrefillPage.vue) and its email sheet.
 *
 * The page's methods run on a plain object, the repo's way of testing a page
 * without a browser. The ledger, the widget rules and the outcome sorting are
 * the real modules; only the wallet call itself is a stand-in.
 *
 * Coverage focus:
 *   - paid means settled: a pending or unknown answer celebrates nothing and
 *     keeps the invoice blocked; only a definite refusal frees it
 *   - one invoice, one payment: the same invoice under another order id, a
 *     second tap, a cancel mid-send, an order already seen as paid
 *   - the price: its end, with the safety margin, at every step
 *   - what the shop says afterwards: paid late, delivered, in need of a refund
 *   - leaving and the email: asked first when something would be lost
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as storage from '../../services/bitrefill/storage.js'
import * as widget from '../../services/bitrefill/widget.js'

const load = (url, deps) => {
  let source = readFileSync(new URL(url, import.meta.url), 'utf8')
  if (url.endsWith('.vue')) source = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const module = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { format: 'cjs' }).code)(name => deps[name] || {}, module, module.exports)
  return module.exports
}

const NWC_ERROR = { UNCONFIRMED: 'NWC_PAYMENT_UNCONFIRMED' }
// The real outcome rules, with the wallet call replaced by the test's own.
const pay = {
  ...load('../../services/bitrefill/pay.js', {
    '../nwcPayment.js': { provesPayment: async () => false },
    '../../utils/nwcErrors.js': { NWC_ERROR },
  }),
  payBitrefillInvoice: (store, ...args) => store.pay(...args),
}
const haptic = []
const deps = {
  '../services/bitrefill/storage.js': storage,
  '../services/bitrefill/widget.js': widget,
  '../services/bitrefill/pay.js': pay,
  '../services/bitrefill/frameCookies.js': { setFrameCookies: async () => false },
  '../utils/lightningInvoice.js': { parseLightningInvoice: invoice => ({ invoice, amount: 100, expiry: Math.floor(Date.now() / 1000) + 600, description: '', paymentHash: `hash-of-${invoice}` }) },
  '../utils/payingWallets.js': { pickDefaultPayingWallet: entries => entries[0] || null },
  '../utils/nwcErrors.js': { NWC_ERROR },
  '../utils/haptics': { haptics: { success() { haptic.push('success') }, warning() { haptic.push('warning') }, error() { haptic.push('error') } } },
}
const page = load('../BitrefillPage.vue', deps).default

const INVOICE = 'lnbc1000n1testing'
const OTHER = 'lnbc1000n1another'
const intentMessage = (invoiceId, invoice = INVOICE, extra = {}) => ({ event: 'payment_intent', invoiceId, paymentUri: `lightning:${invoice}`, paymentMethod: 'lightning', ...extra })
const soon = (seconds) => Math.floor(Date.now() / 1000) + seconds

function vmOf({ failWrite = false, walletType = 'spark', transactions = [] } = {}) {
  haptic.length = 0
  const map = new Map()
  const backing = { getItem: key => map.get(key) ?? null, setItem(key, value) { if (failWrite) throw new Error('quota'); map.set(key, value) } }
  const calls = []
  const notices = []
  const vm = {
    ...page.data(), ...page.methods,
    ledger: storage.createInvoiceLedger({ storage: backing }),
    $t: text => text,
    $q: { notify: notice => notices.push(notice) },
    $refs: { paySheet: { resetSlide() { vm.slideResets = (vm.slideResets || 0) + 1 } } },
    $router: { replace: path => { vm.wentTo = path } },
    walletStore: {
      wallets: [{ id: 'wallet', type: walletType, name: 'Daily' }, { id: 'second', type: walletType, name: 'Second' }],
      pay: async (...args) => { calls.push(args); return { outcome: 'paid' } },
      showPaymentError: error => notices.push({ error }),
      async ensureWalletConnectedForTransfer() { return { async getTransactions() { return transactions } } },
    },
    payingWallets: [{ id: 'wallet', usable: true }, { id: 'second', usable: true }],
    preferredWalletId: null,
    sendingWalletId: 'wallet', paySheetOpen: true,
    intent: { invoiceId: 'order', invoice: INVOICE, paymentHash: `hash-of-${INVOICE}`, amountSats: 100, expiresAt: soon(600) },
    waitForWidgetPaid: async () => false,
    refreshFee() {},
  }
  return { vm, calls, notices, map, setFailWrite: value => { failWrite = value } }
}
const said = (notices, pattern) => notices.some(notice => pattern.test(notice.message || ''))
const KEY = { invoiceId: 'order', paymentHash: `hash-of-${INVOICE}` }

// ───── Paid means settled ─────

test('a payment still on its way celebrates nothing and stays blocked', async () => {
  const { vm, notices } = vmOf()
  vm.walletStore.pay = async () => ({ outcome: 'pending' })
  await vm.onConfirm()
  assert.equal(vm.isComplete, false)
  assert.equal(vm.paySheetOpen, false)
  assert.deepEqual(haptic, [], 'nothing plays while a payment is pending')
  assert.ok(said(notices, /on its way/))
  assert.ok(!said(notices, /^Paid/))
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.ATTEMPTED)
  assert.deepEqual(vm.unresolvedInvoiceIds, ['order'])
  assert.equal(vm.ledger.canPay(KEY).ok, false, 'it is not handed to a wallet again')
})

test('the shop reporting it paid later settles a pending payment and says so', async () => {
  const { vm, notices } = vmOf()
  vm.walletStore.pay = async () => ({ outcome: 'pending' })
  await vm.onConfirm()
  vm.onWidgetPaid('order')
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.PAID)
  assert.deepEqual(vm.unresolvedInvoiceIds, [])
  assert.ok(said(notices, /^Paid\. Bitrefill is preparing/))
  assert.deepEqual(haptic, ['success'])
})

test('a settled payment is paid, without promising the voucher yet', async () => {
  const { vm, calls, notices } = vmOf()
  await vm.onConfirm()
  clearTimeout(vm.closeTimer)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2].note, 'Order reference: order')
  assert.equal(vm.isComplete, true)
  assert.deepEqual(haptic, ['success'])
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.PAID)
  assert.ok(!said(notices, /voucher/i))
})

test('a thrown wallet error whose outcome is unknown keeps the invoice blocked', async () => {
  const { vm, notices } = vmOf()
  vm.walletStore.pay = async () => { throw new Error('Lightning payment failed') }
  await vm.onConfirm()
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.ATTEMPTED)
  assert.equal(vm.paySheetOpen, false)
  assert.deepEqual(haptic, ['warning'])
  assert.ok(said(notices, /couldn't confirm this payment/))
  // The same order again, also under a new order id, is refused.
  vm.onPaymentIntent(intentMessage('order'))
  vm.onPaymentIntent(intentMessage('order-again'))
  assert.equal(vm.paySheetOpen, false)
  assert.ok(said(notices, /may still be on its way/))
})

test('the paying wallet reporting the payment failed frees the invoice', async () => {
  const hash = `hash-of-${INVOICE}`
  const { vm, notices } = vmOf({ transactions: [{ type: 'send', paymentHash: hash, status: 'failed' }] })
  vm.walletStore.pay = async () => { throw new Error('Lightning payment failed') }
  await vm.onConfirm()
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.FAILED)
  assert.equal(vm.isSending, false)
  assert.equal(vm.paySheetOpen, true, 'the sheet stays for another try')
  assert.equal(vm.slideResets, 1)
  assert.deepEqual(haptic, ['error'])
  assert.ok(notices.some(notice => notice.error))
})

test('the paying wallet reporting the payment settled turns a thrown error into paid', async () => {
  const hash = `hash-of-${INVOICE}`
  const { vm } = vmOf({ transactions: [{ type: 'send', paymentHash: hash, status: 'completed' }] })
  vm.walletStore.pay = async () => { throw new Error('connection reset') }
  await vm.onConfirm()
  clearTimeout(vm.closeTimer)
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.PAID)
  assert.equal(vm.isComplete, true)
})

test('a refusal before anything was sent frees the invoice without waiting', async () => {
  const { vm } = vmOf()
  let waited = false
  vm.waitForWidgetPaid = async () => { waited = true; return false }
  vm.walletStore.pay = async () => { throw Object.assign(new Error('offline'), { beforeSend: true }) }
  await vm.onConfirm()
  assert.equal(waited, false)
  assert.equal(vm.ledger.canPay(KEY).ok, true)
})

test('an NWC outcome that cannot be told stays blocked and is explained by the wallet error', async () => {
  const { vm, notices } = vmOf({ walletType: 'nwc' })
  vm.walletStore.pay = async () => { throw Object.assign(new Error('?'), { code: NWC_ERROR.UNCONFIRMED }) }
  await vm.onConfirm()
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.ATTEMPTED)
  assert.ok(notices.some(notice => notice.error?.code === NWC_ERROR.UNCONFIRMED))
  assert.deepEqual(haptic, ['warning'])
})

test('the shop seeing the money wins over a wallet refusal', async () => {
  const { vm } = vmOf({ walletType: 'nwc' })
  vm.waitForWidgetPaid = async () => true
  vm.walletStore.pay = async () => { throw Object.assign(new Error('no'), { code: 'PAYMENT_FAILED' }) }
  await vm.onConfirm()
  clearTimeout(vm.closeTimer)
  assert.equal(vm.ledger.get(KEY).state, storage.PAY_STATE.PAID)
})

// ───── One invoice, one payment ─────

test('a payment never reaches a wallet if recording the attempt fails', async () => {
  const { vm, calls, notices } = vmOf({ failWrite: true })
  await assert.doesNotReject(() => vm.onConfirm())
  assert.equal(calls.length, 0)
  assert.equal(vm.isSending, false)
  assert.ok(notices.length)
})

test('failure to record completion never turns a successful payment into a retry', async () => {
  const { vm, calls, notices, setFailWrite } = vmOf()
  vm.walletStore.pay = async (...args) => { calls.push(args); setFailWrite(true); return { outcome: 'paid' } }
  await assert.doesNotReject(() => vm.onConfirm())
  clearTimeout(vm.closeTimer)
  assert.equal(calls.length, 1)
  assert.equal(vm.isComplete, true)
  assert.equal(notices.length, 0)
  assert.equal(vm.ledger.canPay(KEY).ok, false)
})

test('a paid update received before a local attempt blocks a later intent', () => {
  const { vm } = vmOf()
  vm.paySheetOpen = false
  vm.intent = null
  vm.onWidgetPaid('order')
  assert.equal(vm.ledger.canPay('order').ok, false)
  vm.onPaymentIntent(intentMessage('order'))
  assert.equal(vm.paySheetOpen, false)
})

test('the same invoice under a second order id is not paid twice', async () => {
  const { vm, calls, notices } = vmOf()
  await vm.onConfirm()
  clearTimeout(vm.closeTimer)
  vm.closePaySheet()
  vm.onPaymentIntent(intentMessage('another-order-id'))
  assert.equal(vm.paySheetOpen, false)
  assert.equal(calls.length, 1)
  assert.ok(said(notices, /already paid/))
})

test('cancelling the sheet while a payment is out changes nothing', async () => {
  const { vm } = vmOf()
  let release
  vm.walletStore.pay = () => new Promise(resolve => { release = resolve })
  const sending = vm.onConfirm()
  await new Promise(resolve => setTimeout(resolve, 0))
  vm.onPaySheetCancel()
  assert.equal(vm.isSending, true)
  assert.equal(vm.paySheetOpen, true)
  assert.equal(vm.intent.invoiceId, 'order')
  // No second order slips in behind it.
  vm.onPaymentIntent(intentMessage('second', OTHER))
  assert.equal(vm.intent.invoiceId, 'order')
  release({ outcome: 'paid' })
  await sending
  clearTimeout(vm.closeTimer)
  vm.onPaySheetCancel()
  assert.equal(vm.isComplete, true, 'nor while the finished state shows')
})

test('an order the shop reported paid while the sheet was open is not paid again', async () => {
  const { vm, calls, notices } = vmOf()
  vm.onWidgetPaid('order')
  await vm.onConfirm()
  assert.equal(calls.length, 0)
  assert.equal(vm.paySheetOpen, false)
  assert.ok(said(notices, /already paid/), 'and the person is told why the sheet closed')
})

// ───── The order as the shop states it ─────

test('an intent opens the sheet for exactly its invoice, with the slide and the default wallet', () => {
  const { vm } = vmOf()
  vm.paySheetOpen = false
  vm.intent = null
  vm.preferredWalletId = 'second'
  vm.onPaymentIntent(intentMessage('fresh', OTHER, { paymentAmount: 0.000001, paymentCurrency: 'BTC' }))
  assert.equal(vm.paySheetOpen, true)
  assert.equal(vm.intent.invoice, OTHER)
  assert.equal(vm.intent.paymentHash, `hash-of-${OTHER}`)
  assert.equal(vm.sendingWalletId, 'second', 'the default wallet from Settings, when it can pay')
  const props = page.computed.paymentProps.call({ ...vm, secondsLeft: 300 })
  assert.equal(props.forceSlide, true, 'a frame opened the sheet: paying takes the slide')
  assert.equal(props.feeNotice, 'Fee calculated when sending.')
  assert.equal(props.details.typeLabel, 'Bitcoin payment')
})

test('a default wallet that cannot pay is passed over', () => {
  const { vm } = vmOf()
  vm.preferredWalletId = 'second'
  vm.payingWallets = [{ id: 'wallet', usable: true }, { id: 'second', usable: false }]
  assert.equal(vm.defaultWalletId(), 'wallet')
  vm.preferredWalletId = 'removed'
  assert.equal(vm.defaultWalletId(), 'wallet')
})

test('a quoted fee shows as a number; while quoting the sheet waits', () => {
  const { vm } = vmOf()
  const props = (extra) => page.computed.paymentProps.call({ ...vm, secondsLeft: 300, ...extra })
  assert.deepEqual(props({ feeSats: 3, feeWalletId: 'wallet' }).feeEstimate, { sats: 3, isEstimating: false })
  assert.equal(props({ feeSats: 3, feeWalletId: 'wallet' }).feeNotice, '')
  assert.equal(props({ feeSats: 3, feeWalletId: 'second' }).feeEstimate, null, 'a quote belongs to the wallet that made it')
  assert.deepEqual(props({ feeEstimating: true }).feeEstimate, { sats: null, isEstimating: true })
})

test('an intent whose stated amount is not the invoice amount is refused', () => {
  const { vm, notices } = vmOf()
  vm.paySheetOpen = false
  vm.intent = null
  vm.onPaymentIntent(intentMessage('fresh', OTHER, { paymentAmount: 0.5, paymentCurrency: 'BTC' }))
  assert.equal(vm.paySheetOpen, false)
  assert.ok(said(notices, /can't pay this order/))
})

// ───── The price ─────

test('confirm rechecks actual expiry even when the countdown has not ticked', async () => {
  const { vm, calls, notices } = vmOf()
  vm.nowSec -= 60
  vm.intent.expiresAt = soon(-1)
  await vm.onConfirm()
  assert.equal(calls.length, 0)
  assert.equal(vm.paySheetOpen, false)
  assert.ok(said(notices, /price ran out/))
})

test('a price with only seconds left is not paid', async () => {
  const { vm, calls } = vmOf()
  vm.intent.expiresAt = soon(pay.EXPIRY_MARGIN_SECONDS - 3)
  await vm.onConfirm()
  assert.equal(calls.length, 0)
  assert.equal(vm.ledger.get(KEY), null, 'and it was never recorded as attempted')
})

test('expiry while connecting closes the sheet and permits no send', async () => {
  const { vm, notices } = vmOf()
  vm.walletStore.pay = async () => { throw Object.assign(new Error('expired'), { code: 'BITREFILL_PRICE_EXPIRED', beforeSend: true }) }
  await vm.onConfirm()
  assert.equal(vm.paySheetOpen, false)
  assert.equal(vm.isSending, false)
  assert.ok(said(notices, /price ran out/))
})

// ───── After the payment ─────

test('an order that needs a refund shows one line until it is read, also on the next visit', () => {
  const { vm, notices } = vmOf()
  vm.ledger.mark(KEY, storage.PAY_STATE.PAID)
  vm.onInvoiceComplete({ event: 'invoice_complete', invoiceId: 'order', deliveryStatus: 'failed', refundNeeded: true })
  assert.equal(vm.refundNotice, true)
  assert.equal(notices.length, 0, 'a line, not a toast')
  vm.refundNotice = false
  vm.restoreRefundNotice()
  assert.equal(vm.refundNotice, true)
  vm.dismissRefundNotice()
  vm.restoreRefundNotice()
  assert.equal(vm.refundNotice, false)
})

test('the voucher is promised only once the order is reported delivered', () => {
  const { vm, notices } = vmOf()
  vm.onWidgetPaid('order')
  assert.ok(!said(notices, /ready/))
  vm.onInvoiceComplete({ event: 'invoice_complete', invoiceId: 'order', deliveryStatus: 'delivered', refundNeeded: false })
  assert.ok(said(notices, /Your order is ready/))
  assert.equal(vm.refundNotice, false)
})

test('on opening the shop, unresolved attempts are settled by asking the paying wallet', async () => {
  const paid = { invoiceId: 'a', paymentHash: 'hash-a' }
  const failed = { invoiceId: 'b', paymentHash: 'hash-b' }
  const open = { invoiceId: 'c', paymentHash: 'hash-c' }
  const { vm } = vmOf({ transactions: [
    { type: 'send', paymentHash: 'hash-a', status: 'completed' },
    { type: 'send', paymentHash: 'hash-b', status: 'failed' },
  ] })
  for (const key of [paid, failed, open]) vm.ledger.claim(key, { walletId: 'wallet' })
  vm.ledger.claim({ invoiceId: 'no-wallet', paymentHash: 'hash-d' })
  await vm.reconcile()
  assert.equal(vm.ledger.get(paid).state, storage.PAY_STATE.PAID)
  assert.equal(vm.ledger.get(failed).state, storage.PAY_STATE.FAILED)
  assert.equal(vm.ledger.get(open).state, storage.PAY_STATE.ATTEMPTED, 'unknown to the wallet: still blocked')
  assert.equal(vm.ledger.get('no-wallet').state, storage.PAY_STATE.ATTEMPTED)
})

// ───── Leaving ─────

test('leaving asks first only when an order is on screen or unresolved', () => {
  const { vm } = vmOf()
  const question = (extra) => page.computed.leaveQuestion.call({ ...vm, ...extra })
  const leave = (state) => {
    const target = { ...vm, ...state, leaveQuestion: question(state) }
    let answer
    page.beforeRouteLeave.call(target, { fullPath: '/spend' }, {}, (value) => { answer = value })
    return { answer, target }
  }
  assert.equal(leave({ isSending: false, paidInvoiceIds: [], unresolvedInvoiceIds: [] }).answer, undefined, 'nothing to lose: straight out')
  const paid = leave({ isSending: false, paidInvoiceIds: ['order'], unresolvedInvoiceIds: [] })
  assert.equal(paid.answer, false)
  assert.equal(paid.target.leaveOpen, true)
  assert.match(paid.target.leaveQuestion, /shown here/)
  assert.match(question({ isSending: true, paidInvoiceIds: [], unresolvedInvoiceIds: [] }), /still on its way/)
  assert.match(question({ isSending: false, paidInvoiceIds: [], unresolvedInvoiceIds: ['order'] }), /still on its way/)
  // Confirmed once, the way out is open.
  paid.target.confirmLeave()
  assert.equal(vm.wentTo, '/spend')
  let again
  page.beforeRouteLeave.call(paid.target, { fullPath: '/spend' }, {}, (value) => { again = value })
  assert.equal(again, undefined)
})

test('the header button leaves to Spend, whatever the frame did to the history', () => {
  const { vm } = vmOf()
  vm.goBack()
  assert.equal(vm.wentTo, '/spend')
})

// ───── Email ─────

const emailSheet = load('../../components/bitrefill/BitrefillEmailSheet.vue', { '../../services/bitrefill/widget.js': widget }).default

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
  vm.loadWidget = () => { vm.reloaded = true }
  vm.emailBusy = true
  vm.savedEmail = 'person@example.com'
  vm.emailSheetOpen = true
  vm.onEmailRemove()
  vm.onEmailSkip()
  assert.equal(vm.savedEmail, 'person@example.com')
  assert.equal(vm.emailSheetOpen, true)
  assert.equal(vm.reloaded, undefined)
})

test('removing the email is asked first, and says the shop reloads', () => {
  const source = readFileSync(new URL('../BitrefillPage.vue', import.meta.url), 'utf8')
  assert.match(source, /@remove="removeEmailOpen = true"/, 'the sheet only asks; the page confirms')
  assert.match(source, /Bitrefill will ask for an email at checkout\. The shop reloads\./)
  const sheet = readFileSync(new URL('../../components/bitrefill/BitrefillEmailSheet.vue', import.meta.url), 'utf8')
  assert.match(sheet, /v-if="editing"[^>]*>\{\{ \$t\('Applies to your next order\. The shop reloads when you save\.'\) \}\}/)
})
