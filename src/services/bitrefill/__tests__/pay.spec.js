/**
 * Paying a Bitrefill invoice - what a wallet's answer means.
 *
 * Coverage focus:
 *   - paid means settled: a pending answer is not a payment, a failed answer
 *     is an error, for Spark-shaped and LNbits-shaped results alike
 *   - an expired price (with its safety margin) is checked after the wallet
 *     connected and before anything is sent
 *   - which errors free the invoice for another attempt, and which keep it
 *     blocked until the paying wallet can say
 *   - asking the paying wallet about a payment by its hash
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const { code } = transformSync(readFileSync(new URL('../pay.js', import.meta.url), 'utf8'), { format: 'cjs' })
const module = { exports: {} }
const labels = []
const notes = []
const deps = {
  '../nwcPayment.js': {
    payWithNwc: (provider, invoice, options) => provider.pay(invoice, options),
    provesPayment: async (preimage) => preimage === 'proof',
  },
  '../../utils/nwcErrors.js': { NWC_ERROR: { UNCONFIRMED: 'NWC_PAYMENT_UNCONFIRMED' } },
  '../../utils/internalTransferDetails.js': { internalTransferTransactionId: (type, result) => result?.id || result?.paymentHash || null },
  '../../stores/transactionMetadata.js': {
    useTransactionMetadataStore: () => ({
      async setLabelForTransaction(...args) { labels.push(args) },
      async setNoteForTransaction(...args) { notes.push(args) },
      async enqueuePendingContactLink() {},
    }),
  },
}
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports)
const {
  payBitrefillInvoice,
  probeBitrefillPayment,
  outcomeAfterError,
  outcomeOfResult,
  isDefiniteRefusal,
  secondsToPay,
  PAY_OUTCOME,
  EXPIRY_MARGIN_SECONDS,
  BITREFILL_PRICE_EXPIRED,
  BITREFILL_PAYMENT_FAILED,
} = module.exports

const nowSec = () => Math.floor(Date.now() / 1000)

/** A wallet store with one wallet whose provider is `provider`. */
function storeOf(type, provider, extra = {}) {
  return {
    wallets: [{ id: 'wallet', type }],
    async ensureWalletConnectedForTransfer() { return provider },
    nwcPayOptions: () => ({ limit: null }),
    ...extra,
  }
}

test('a Spark payment still on its way is pending, not paid', async () => {
  const store = storeOf('spark', { async payInvoice() { return { id: 'spark-1', status: 'pending', preimage: null } } })
  const { outcome } = await payBitrefillInvoice(store, 'wallet', 'lnbc1testing')
  assert.equal(outcome, PAY_OUTCOME.PENDING)
})

test('a settled Spark payment is paid, capped at the fee the sheet showed', async () => {
  let sent = null
  const store = storeOf('spark', { async payInvoice(args) { sent = args; return { id: 'spark-2', status: 'completed', preimage: 'aa' } } })
  const { outcome } = await payBitrefillInvoice(store, 'wallet', 'lnbc1testing', { maxFeeSats: 7, note: 'Order reference: order-9' })
  assert.equal(outcome, PAY_OUTCOME.PAID)
  assert.deepEqual(sent, { invoice: 'lnbc1testing', preferSpark: true, maxFee: 7 })
  assert.deepEqual(labels.at(-1), ['spark-2', 'wallet', 'Bitrefill'])
  assert.deepEqual(notes.at(-1), ['spark-2', 'wallet', 'Order reference: order-9'], 'the order is findable on the payment')
})

test('without a quote no cap is invented: the wallet applies its own limit', async () => {
  let sent = null
  const store = storeOf('spark', { async payInvoice(args) { sent = args; return { id: 'spark-3', status: 'completed' } } })
  await payBitrefillInvoice(store, 'wallet', 'lnbc1testing')
  assert.equal('maxFee' in sent, false)
})

test('an LNbits answer of pending or failed is never reported as paid', async () => {
  const lnbits = (status) => storeOf('lnbits', { async payInvoice() { return { status, preimage: null, paymentHash: 'hash' } } })
  assert.equal((await payBitrefillInvoice(lnbits('pending'), 'wallet', 'lnbc1testing')).outcome, PAY_OUTCOME.PENDING)
  assert.equal((await payBitrefillInvoice(lnbits('completed'), 'wallet', 'lnbc1testing')).outcome, PAY_OUTCOME.PAID)
  await assert.rejects(
    () => payBitrefillInvoice(lnbits('failed'), 'wallet', 'lnbc1testing'),
    (error) => error.code === BITREFILL_PAYMENT_FAILED && isDefiniteRefusal(error, 'lnbits'),
  )
})

test('an answer without a status counts as paid only with a preimage', () => {
  assert.equal(outcomeOfResult('lnbits', { preimage: 'aa' }), PAY_OUTCOME.PAID)
  assert.equal(outcomeOfResult('lnbits', {}), PAY_OUTCOME.PENDING)
  assert.equal(outcomeOfResult('spark', undefined), PAY_OUTCOME.PENDING)
  assert.equal(outcomeOfResult('nwc', { preimage: '' }), PAY_OUTCOME.PAID, 'NWC answers only on proof')
})

test('NWC pays with the connection options the store keeps', async () => {
  let got = null
  const store = storeOf('nwc', { async pay(invoice, options) { got = options; return { preimage: 'aa', paymentHash: 'hash' } } }, { nwcPayOptions: (id) => ({ limit: { remainingSats: 5 }, walletId: id }) })
  const { outcome } = await payBitrefillInvoice(store, 'wallet', 'lnbc1testing')
  assert.equal(outcome, PAY_OUTCOME.PAID)
  assert.deepEqual(got, { limit: { remainingSats: 5 }, walletId: 'wallet' })
})

test('an expired price is checked after wallet connection and before provider payment', async () => {
  let connected = false
  let sent = false
  const store = {
    wallets: [{ id: 'wallet', type: 'spark' }],
    async ensureWalletConnectedForTransfer() {
      await Promise.resolve()
      connected = true
      return { async payInvoice() { sent = true } }
    },
  }
  await assert.rejects(
    () => payBitrefillInvoice(store, 'wallet', 'lnbc1testing', { expiresAt: nowSec() - 1 }),
    (error) => error.code === BITREFILL_PRICE_EXPIRED && error.beforeSend === true,
  )
  assert.equal(connected, true)
  assert.equal(sent, false)
})

test('a price about to end is not paid any more', async () => {
  let sent = false
  const store = storeOf('spark', { async payInvoice() { sent = true; return { status: 'completed' } } })
  await assert.rejects(
    () => payBitrefillInvoice(store, 'wallet', 'lnbc1testing', { expiresAt: nowSec() + EXPIRY_MARGIN_SECONDS - 2 }),
    (error) => error.code === BITREFILL_PRICE_EXPIRED,
  )
  assert.equal(sent, false)
  assert.equal(secondsToPay(nowSec() + EXPIRY_MARGIN_SECONDS + 30) > 0, true)
  assert.equal(secondsToPay(null), Infinity, 'no end known: nothing to refuse')
})

test('a wallet that cannot be reached never had the invoice', async () => {
  const store = { wallets: [{ id: 'wallet', type: 'lnbits' }], async ensureWalletConnectedForTransfer() { throw new Error('offline') } }
  await assert.rejects(() => payBitrefillInvoice(store, 'wallet', 'lnbc1testing'), (error) => error.beforeSend === true)
  await assert.rejects(() => payBitrefillInvoice({ wallets: [] }, 'gone', 'lnbc1testing'), (error) => error.beforeSend === true)
})

test('a balance refresh failure cannot turn a successful payment into an error', async () => {
  const result = { id: 'tx', status: 'completed' }
  const store = storeOf('spark', { async payInvoice() { return result } }, { refreshWalletData() { throw new Error('refresh unavailable') } })
  const paid = await payBitrefillInvoice(store, 'wallet', 'lnbc1testing')
  assert.equal(paid.outcome, PAY_OUTCOME.PAID)
  assert.equal(paid.result, result)
})

test('only a definite refusal frees the invoice', () => {
  // Spark: a thrown send says nothing, except the fee limit (refused before any money moves).
  assert.equal(isDefiniteRefusal(new Error('Lightning payment failed'), 'spark'), false)
  assert.equal(isDefiniteRefusal(new Error('network request failed'), 'spark'), false)
  assert.equal(isDefiniteRefusal(Object.assign(new Error('fee'), { code: 'LIGHTNING_FEE_ABOVE_LIMIT' }), 'spark'), true)
  // LNbits: a plain refusal from the server, never a timeout or a server fault.
  assert.equal(isDefiniteRefusal(Object.assign(new Error('Insufficient balance'), { status: 400 }), 'lnbits'), true)
  assert.equal(isDefiniteRefusal(Object.assign(new Error('timeout'), { status: 408 }), 'lnbits'), false)
  assert.equal(isDefiniteRefusal(Object.assign(new Error('Payment failed'), { status: 520 }), 'lnbits'), false)
  assert.equal(isDefiniteRefusal(Object.assign(new Error('Network error'), { isNetworkError: true }), 'lnbits'), false)
  // NWC: payWithNwc turns every unknown outcome into UNCONFIRMED itself.
  assert.equal(isDefiniteRefusal(Object.assign(new Error('no'), { code: 'INSUFFICIENT_BALANCE' }), 'nwc'), true)
  assert.equal(isDefiniteRefusal(Object.assign(new Error('?'), { code: 'NWC_PAYMENT_UNCONFIRMED' }), 'nwc'), false)
  assert.equal(isDefiniteRefusal(null, 'spark'), false)
})

test('the paying wallet is asked by payment hash', async () => {
  const HASH = 'ab'.repeat(32)
  const spark = (rows) => storeOf('spark', { async getTransactions() { return rows } })
  const row = (extra) => ({ type: 'send', paymentHash: HASH, status: 'completed', ...extra })
  assert.equal(await probeBitrefillPayment(spark([row()]), 'wallet', HASH.toUpperCase()), PAY_OUTCOME.PAID)
  assert.equal(await probeBitrefillPayment(spark([row({ status: 'pending' })]), 'wallet', HASH), PAY_OUTCOME.PENDING)
  assert.equal(await probeBitrefillPayment(spark([row({ status: 'failed' })]), 'wallet', HASH), PAY_OUTCOME.FAILED)
  assert.equal(await probeBitrefillPayment(spark([row({ type: 'receive' })]), 'wallet', HASH), PAY_OUTCOME.UNKNOWN, 'a receipt is not this payment')
  assert.equal(await probeBitrefillPayment(spark([]), 'wallet', HASH), PAY_OUTCOME.UNKNOWN, 'not found is not "failed"')
  assert.equal(await probeBitrefillPayment(spark([row()]), 'wallet', ''), PAY_OUTCOME.UNKNOWN)

  const lnbits = storeOf('lnbits', { async getPayment(hash) { return row({ paymentHash: hash, status: 'failed' }) }, async getTransactions() { throw new Error('unused') } })
  assert.equal(await probeBitrefillPayment(lnbits, 'wallet', HASH), PAY_OUTCOME.FAILED)

  const broken = storeOf('spark', { async getTransactions() { throw new Error('offline') } })
  assert.equal(await probeBitrefillPayment(broken, 'wallet', HASH), PAY_OUTCOME.UNKNOWN, 'a wallet that cannot be asked keeps the invoice blocked')

  const nwc = (tx) => storeOf('nwc', { client: { async lookupInvoice() { return tx } } })
  assert.equal(await probeBitrefillPayment(nwc({ state: 'settled' }), 'wallet', HASH), PAY_OUTCOME.PAID)
  assert.equal(await probeBitrefillPayment(nwc({ state: 'failed' }), 'wallet', HASH), PAY_OUTCOME.FAILED)
  assert.equal(await probeBitrefillPayment(nwc({ state: 'pending' }), 'wallet', HASH), PAY_OUTCOME.PENDING)
  assert.equal(await probeBitrefillPayment(storeOf('nwc', {}), 'wallet', HASH), PAY_OUTCOME.UNKNOWN)
})

test('after a thrown send: the shop, then the refusal, then the wallet records', async () => {
  const HASH = 'cd'.repeat(32)
  const context = (extra = {}) => ({
    walletStore: storeOf('spark', { async getTransactions() { return [] } }),
    walletId: 'wallet',
    walletType: 'spark',
    paymentHash: HASH,
    shopSawPayment: async () => false,
    ...extra,
  })
  const thrown = new Error('Lightning payment failed')
  assert.equal(await outcomeAfterError(thrown, context()), PAY_OUTCOME.UNKNOWN, 'a thrown Spark send does not free the invoice')
  assert.equal(await outcomeAfterError(thrown, context({ shopSawPayment: async () => true })), PAY_OUTCOME.PAID, 'the shop saw the money')
  const records = storeOf('spark', { async getTransactions() { return [{ type: 'send', paymentHash: HASH, status: 'failed' }] } })
  assert.equal(await outcomeAfterError(thrown, context({ walletStore: records })), PAY_OUTCOME.FAILED, 'the wallet itself says failed')

  let asked = false
  const never = Object.assign(new Error('offline'), { beforeSend: true })
  assert.equal(await outcomeAfterError(never, context({ shopSawPayment: async () => { asked = true; return false } })), PAY_OUTCOME.FAILED)
  assert.equal(asked, false, 'nothing was sent: nothing to wait for')

  const unconfirmed = Object.assign(new Error('?'), { code: 'NWC_PAYMENT_UNCONFIRMED' })
  assert.equal(await outcomeAfterError(unconfirmed, context({ walletType: 'nwc' })), PAY_OUTCOME.UNKNOWN)
  const refused = Object.assign(new Error('no'), { code: 'INSUFFICIENT_BALANCE' })
  assert.equal(await outcomeAfterError(refused, context({ walletType: 'nwc' })), PAY_OUTCOME.FAILED)
})
