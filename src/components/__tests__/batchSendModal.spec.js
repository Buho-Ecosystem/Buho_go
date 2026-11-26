/**
 * Batch send: every figure on the review is one the send is held to. No
 * guessed fee, and an on-chain row pays the quote the review showed, never
 * one fetched and accepted at send time.
 *
 * The real script runs mounted (its imports stubbed, the amount and wallet
 * helpers real), driven through the functions the buttons call.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as amountFormatting from '../../utils/amountFormatting.js'
import * as paymentAmountInput from '../../utils/paymentAmountInput.js'
import * as payingWallets from '../../utils/payingWallets.js'
import * as paymentOutcome from '../../utils/paymentOutcome.js'
import * as walletCapabilities from '../../utils/walletCapabilities.js'

const file = readFileSync(new URL('../BatchSendModal.vue', import.meta.url), 'utf8')
const { descriptor } = parse(file)
const { code } = transformSync(compileScript(descriptor, { id: 'batch-test' }).content, { format: 'cjs' })
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node) },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node) },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
})

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
const n = (value) => value.toLocaleString()
const btc = (sats) => `₿ ${n(sats)}`
const settle = async () => { for (let i = 0; i < 6; i++) await Vue.nextTick() }
const quiet = async (run) => {
  const { error, log, warn } = console
  console.error = console.log = console.warn = () => {}
  try { return await run() } finally { Object.assign(console, { error, log, warn }) }
}

const contact = (id, addressType, address = `${id}@example.com`) => ({ id, name: id, addressType, address })

/** The modal mounted over a wallet of `type`; `provider` is what that wallet answers with. */
function harness(ctx, { type = 'spark', balance = 100_000, provider = {}, store = {} } = {}) {
  const calls = []
  const record = (name, answer) => async (...args) => { calls.push([name, ...args]); return typeof answer === 'function' ? answer(...args) : answer }
  const walletProvider = {
    payLightningAddress: record('payLightningAddress', { status: 'completed' }),
    payInvoice: record('payInvoice', { status: 'completed' }),
    transferToSparkAddress: record('transferToSparkAddress', { status: 'completed' }),
    transferToArkadeAddress: record('transferToArkadeAddress', { status: 'completed' }),
    getWithdrawalFeeQuote: record('getWithdrawalFeeQuote', () => { throw new Error('no quote set up') }),
    withdrawToL1: record('withdrawToL1', { requestId: 'request', status: 'pending' }),
    ...provider,
  }
  const walletStore = Vue.reactive({
    activeWalletId: 'wallet', activeWalletType: type,
    isActiveWalletSpark: type === 'spark', isActiveWalletArkade: type === 'arkade',
    balances: { wallet: balance }, connectedWallets: [],
    preferredFiatCurrency: 'EUR', useBip177Format: true,
    getActiveProvider: () => walletProvider,
    ensureLNBitsConnected: async () => walletProvider,
    showPaymentError: (...args) => calls.push(['showPaymentError', ...args]),
    refreshWalletData: () => {},
    ...store,
  })
  const module = { exports: {} }
  const dependencies = {
    vue: Vue,
    quasar: { useQuasar: () => ({ dark: { isActive: false } }) },
    '../utils/lud23.js': { assertPaymentInput() {} },
    '../utils/paymentAmountInput.js': paymentAmountInput,
    '../utils/amountFormatting.js': amountFormatting,
    '../utils/payingWallets.js': payingWallets,
    '../utils/paymentOutcome.js': paymentOutcome,
    '../utils/fiatRates.js': { fiatRatesService: { freshRate: () => 0, convertFiatToSatsSync: () => null, formatSatsAsFiat: () => '', getRates: async () => ({}) } },
    '../utils/walletCapabilities': walletCapabilities,
    '../stores/wallet': { useWalletStore: () => walletStore },
    '../stores/addressBook': { useAddressBookStore: () => ({ entries: [], initialize: async () => {}, isEntryPayable: () => true, updateLastUsed: async () => {} }) },
    '../stores/transactionMetadata': { useTransactionMetadataStore: () => ({ enqueuePendingContactLink: async () => {} }) },
    '../utils/lightning.js': { default: class {} },
    '../utils/lnurlPay.js': {
      lightningAddressUrl: (address) => `https://example.com/${address}`,
      fetchPayRequest: async () => ({}),
      fetchAddressPayRequest: async (address) => ({ payRequest: {}, address }),
      linkAmountSats: (_request, sats) => sats,
      requestPayInvoice: async (_request, { amountSats }) => ({ pr: `invoice-${amountSats}`, amountSats, successAction: null }),
    },
    '../utils/addressUtils': { lnurlToUrl: (lnurl) => `https://example.com/${lnurl}` },
    '../utils/successAction.js': { resolveSuccessAction: async () => null, formatSuccessActionUrl: (url) => url },
    '../utils/inAppBrowser.js': { openInAppBrowser() {} },
    '../utils/userErrors': { buildPaymentError: (error) => ({ reason: error.message }), formatInsufficientBalanceBreakdown: () => 'short' },
    './AddressBook/ContactAvatar.vue': {},
    './SuccessCheckmark.vue': {},
    '../utils/haptics.js': { haptics: { success() {}, warning() {}, error() {} } },
  }
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in dependencies, `unexpected import ${name}`)
    return dependencies[name]
  }, module, module.exports)
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') }, { modelValue: true })
  app.config.globalProperties.$t = t
  app.config.globalProperties.$i18n = { locale: 'en-US' }
  app.mount({ children: [] })
  ctx.after(() => app.unmount())
  const state = app._instance.setupState
  /** Select, set one amount for all (or one each), and open the review. */
  const review = async (contacts, amount) => {
    state.selectedContacts = contacts
    state.step = 2
    await settle()
    if (typeof amount === 'object') {
      state.customAmountsMode = true
      for (const [id, sats] of Object.entries(amount)) state.updateCustomAmount(id, String(sats))
    } else {
      state.amountDisplay = String(amount)
    }
    state.nextStep()
    await settle()
    // The on-chain quotes are asked one after another.
    for (let i = 0; i < 20 && state.batchCost.state === 'loading'; i++) await settle()
  }
  const paid = (name) => calls.filter(([call]) => call === name)
  return { state, walletStore, calls, paid, review }
}

const tiers = (id, fee) => Object.fromEntries(['slow', 'medium', 'fast'].map((speed, index) => [speed, { feeQuoteId: id, serviceFee: 100, networkFee: fee - 100 + index, totalFee: fee + index }]))

test('the review shows the real on-chain quote and the limit each address payment is held to, and the send pays that quote', async (ctx) => {
  const quoted = []
  let fails = false
  const h = harness(ctx, {
    provider: {
      getWithdrawalFeeQuote: async (amount, address) => {
        quoted.push([amount, address])
        if (fails) throw new Error('No quote')
        return tiers(`quote-${quoted.length}`, 1900)
      },
    },
  })
  await h.review([contact('ann', 'lightning'), contact('bob', 'bitcoin', 'bc1-bob')], { ann: 500, bob: 20_000 })
  assert.deepEqual(quoted, [[20_000, 'bc1-bob']], 'asked before the confirm')
  // The old review printed 1 % of 500 (5) and a flat 500. A Spark wallet holds
  // this address payment to 10, and the on-chain row costs what its quote says.
  assert.equal(payingWallets.unquotedFeeLimitSats(500), 10)
  assert.equal(h.state.batchCost.feeText, `Up to ${btc(1901 + 10)}`, 'the medium quote plus the limit')
  assert.equal(h.state.batchCost.totalText, `Up to ${btc(20_500 + 1911)}`)

  // Without a quote on the review nothing can be sent.
  fails = true
  await quiet(() => h.state.loadOnchainQuotes())
  assert.equal(h.state.batchCost.ready, false)
  assert.equal(h.state.batchCost.totalText, '', 'no total without the fee')
  await quiet(() => h.state.startBatch())
  assert.equal(h.state.step, 3, 'still on the review')
  assert.deepEqual(h.paid('withdrawToL1'), [])

  // The quote now on the review is the one submitted: none is fetched at send time.
  fails = false
  await h.state.loadOnchainQuotes()
  assert.equal(h.state.batchCost.ready, true)
  const asked = quoted.length
  await quiet(() => h.state.startBatch())
  assert.equal(quoted.length, asked, 'no quote is fetched and accepted unseen')
  assert.deepEqual(h.paid('withdrawToL1')[0][1], {
    amountSats: 20_000, destinationAddress: 'bc1-bob', speed: 'medium',
    feeQuoteId: `quote-${asked}`, feeAmountSats: 1901, deductFeeFromWithdrawalAmount: false,
  })
  assert.deepEqual(h.paid('payLightningAddress')[0].slice(1), ['ann@example.com', 500])
  assert.equal(h.state.totalSent, 20_500)

  // A wallet that cannot say what a payment costs says so in words: no figure is made up.
  const other = harness(ctx, { type: 'lnbits' })
  await other.review([contact('cyd', 'lightning')], 1000)
  assert.equal(other.state.batchCost.feeText, '')
  assert.equal(other.state.batchCost.feeNote, 'Fee calculated when sending.')
  assert.equal(other.state.batchCost.totalText, `${btc(1000)} + fees`)
})
