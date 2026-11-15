/**
 * A transfer between the person's own wallets: what it can cost is said
 * before it is confirmed, and what it moved and cost afterwards.
 *
 * The real script runs mounted (the amount, wallet and formatting helpers
 * real, the wallet store stubbed) and is driven through the functions the
 * buttons call.
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

const file = readFileSync(new URL('../InternalTransferModal.vue', import.meta.url), 'utf8')
const { descriptor } = parse(file)
const { code } = transformSync(compileScript(descriptor, { id: 'transfer-test' }).content, { format: 'cjs' })
const renderer = Vue.createRenderer({
  createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
  insert(node, parent) { node.parent = parent; parent.children.push(node) },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node) },
  setElementText() {}, setText() {}, parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
})

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
const n = (value) => value.toLocaleString()
const btc = (sats) => `₿ ${n(sats)}`
const wallet = (id, type, balance) => ({ id, name: id, type, balance, canSend: true, canReceive: true, sendAllowed: true })

/** The modal mounted; `transfer` is what the store's transfer answers with. */
function harness(ctx, { transfer = async (_from, _to, amount) => ({ amount, transactionId: 'tx', paymentResult: {} }) } = {}) {
  const transfers = []
  const store = Vue.reactive({
    useBip177Format: true, activeWalletId: null, wallets: [], connectionStates: {},
    getTransferableWallets: () => [],
    transferBetweenWallets: async (...args) => { transfers.push(args); return transfer(...args) },
    showPaymentError() {},
  })
  const module = { exports: {} }
  const dependencies = {
    vue: Vue,
    quasar: { useQuasar: () => ({ dark: { isActive: false }, notify() {} }) },
    '../utils/paymentAmountInput.js': paymentAmountInput,
    '../utils/amountFormatting.js': amountFormatting,
    '../utils/payingWallets.js': payingWallets,
    '../stores/wallet': { useWalletStore: () => store },
    '../utils/haptics': { haptics: { success() {}, error() {} } },
    './SuccessCheckmark.vue': {},
    './ArkadeLogo.vue': {},
    '../utils/internalTransferDetails.js': { internalTransferDetailsRoute: () => null },
  }
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in dependencies, `unexpected import ${name}`)
    return dependencies[name]
  }, module, module.exports)
  const emitted = []
  const app = renderer.createApp({ ...module.exports.default, render: () => Vue.h('div') }, { modelValue: false, onTransferComplete: (payload) => emitted.push(payload) })
  app.config.globalProperties.$t = t
  app.config.globalProperties.$i18n = { locale: 'en-US' }
  app.mount({ children: [] })
  ctx.after(() => app.unmount())
  const state = app._instance.setupState
  /** Choose the two wallets and type an amount. */
  const set = (from, to, amount) => {
    state.state.fromWallet = from
    state.state.toWallet = to
    state.state.currentStep = 2
    if (amount !== undefined) { state.state.amount = String(amount); state.onAmountInput() }
  }
  return { state, store, transfers, emitted, set }
}

test('a transfer says what it can cost before it is confirmed, and what it moved and cost afterwards', async (ctx) => {
  const h = harness(ctx, { transfer: async () => ({ amount: 5000, transactionId: 'tx', paymentResult: { fee: 3, status: 'completed' } }) })
  // From a Spark wallet to another kind: the wallet refuses a route above the limit of the amount.
  h.set(wallet('Spark', 'spark', 100_000), wallet('Hub', 'nwc', 0), 5000)
  assert.equal(payingWallets.unquotedFeeLimitSats(5000), 50)
  assert.deepEqual([h.state.transferCost.feeText, h.state.transferCost.totalText], [`Up to ${btc(50)}`, `Up to ${btc(5050)}`])

  // "Max" is the most whose amount and limit fit the balance, and it names what it leaves.
  h.state.setMax()
  assert.equal(h.state.state.amount, '99009')
  assert.equal(99_009 + payingWallets.unquotedFeeLimitSats(99_009), 100_000)
  assert.equal(h.state.maxKeptText, `${btc(991)} stays in Spark for the fee.`)

  // A wallet that cannot say beforehand gets words, never a figure.
  h.set(wallet('Bits', 'lnbits', 100_000), wallet('Spark', 'spark', 0), 5000)
  assert.equal(h.state.transferCost.feeText, '')
  assert.equal(h.state.transferCost.feeNote, 'Fee calculated when sending.')
  assert.equal(h.state.transferCost.totalText, `${btc(5000)} + fee`)

  // Afterwards: what was moved, and the fee the paying wallet reported.
  h.set(wallet('Spark', 'spark', 100_000), wallet('Hub', 'nwc', 0), 5000)
  await h.state.doTransfer()
  assert.deepEqual(h.transfers, [['Spark', 'Hub', 5000]])
  assert.deepEqual([h.state.state.transferComplete, h.state.state.movedSats, h.state.state.feePaidSats], [true, 5000, 3])
})
