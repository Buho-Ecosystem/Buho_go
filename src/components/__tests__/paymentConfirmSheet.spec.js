/**
 * The payment confirm sheet: wallet choice, preparation, details and fees.
 *
 * The real template is compiled (SSR) and rendered, the real script runs
 * with its imports stubbed, so these tests read the actual markup and the
 * actual component logic:
 *   - the wallet choice lives in the header, and never shows for redeem / charge
 *   - the chooser is a child view: a draft until applied, for this payment only
 *   - a wallet that cannot pay holds the commit gate and says why
 *   - a contact payment opens in the same sheet while its details load
 *   - payment details, fees and totals, keyboard and viewport handling
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as ServerRenderer from 'vue/server-renderer'
import * as amountFormatting from '../../utils/amountFormatting.js'
import * as payingWallets from '../../utils/payingWallets.js'

const sfc = createRequire(import.meta.url)('@vue/compiler-sfc')

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
// Display balances by wallet id, as the store's getDisplayBalance reports them.
const shownBalances = { biz: 1200, personal: 50, alby: 9000, ark: 700 }
const walletState = {
  useBip177Format: true,
  getDisplayBalance: (id) => (id in shownBalances
    ? { known: true, balance: shownBalances[id], outdated: false, refreshing: false }
    : { known: false, balance: null, outdated: false, refreshing: true }),
  fiatValueOf: (sats) => (sats ? `$${(sats / 1000).toFixed(2)}` : null),
}
// The app groups digits by the device locale; so does this machine.
const n = (value) => value.toLocaleString()

// Icon stand-in: shows which glyph was asked for.
const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }
// Brand mark stand-in: shows which wallet type was drawn.
const WalletBrandMark = { props: ['type'], render() { return Vue.h('i', { 'data-mark': this.type }) } }
const HiddenAmount = { render() { return Vue.h('span', {}, this.$slots.default?.()) } }
const baseDeps = {
  '@iconify/vue': { Icon },
  './WalletBrandMark.vue': WalletBrandMark,
  './HiddenAmount.vue': HiddenAmount,
  '../directives/balanceUpdating.js': {},
  // mapState(store, keys) -> { key() { ... } } computeds, read from walletState
  pinia: { mapState: (_store, keys) => Object.fromEntries(keys.map((key) => [key, function () { return walletState[key] }])) },
  '../stores/wallet': { useWalletStore: () => walletState },
  '../providers/WalletFactory': { WALLET_TYPE_LABELS: { spark: 'Spark', nwc: 'NWC', lnbits: 'LNbits', arkade: 'Arkade' } },
  '../utils/amountFormatting.js': amountFormatting,
  '../utils/payingWallets.js': payingWallets,
}

function run(code, extra = {}, deps = {}) {
  const { code: cjs } = transformSync(code, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', cjs)(name => (name in extra ? extra[name] : deps[name] || {}), module, module.exports)
  return module.exports
}

/** Script options, plus an SSR render function compiled from the real template. */
function load(file, deps = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const { descriptor } = sfc.parse(source)
  const component = run(descriptor.script.content, {}, deps).default
  const { code, errors } = sfc.compileTemplate({ source: descriptor.template.content, filename: file, id: 'test', ssr: true, ssrCssVars: descriptor.cssVars })
  assert.deepEqual(errors, [])
  component.ssrRender = run(code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender
  return component
}

const ConfirmSheet = load('../PaymentConfirmSheet.vue', {
  ...baseDeps,
  '../utils/amountFormatting.js': amountFormatting,
  '../utils/fiatCurrencies.js': { FIAT_SYMBOLS: {} },
  '../utils/fiatRates.js': { fiatRatesService: {} },
})

async function render(component, props, { data, directives = [] } = {}) {
  const options = data ? { ...component, data: () => ({ ...(component.data?.() || {}), ...data }) } : component
  const app = Vue.createSSRApp(options, props)
  app.config.globalProperties.$t = t
  app.config.globalProperties.$q = { dark: { isActive: false }, screen: { lt: { sm: false } } }
  app.config.warnHandler = () => {}
  for (const name of directives) app.directive(name, {})
  // Quasar shells and the globally registered icon: slot passthrough is all the markup checks need.
  const shell = (tag) => ({ inheritAttrs: false, render() { return Vue.h(tag, {}, this.$slots.default?.()) } })
  for (const name of ['q-dialog', 'q-card', 'q-btn', 'q-spinner-dots']) app.component(name, shell('div'))
  app.component('Icon', Icon)
  return ServerRenderer.renderToString(app)
}

const entry = (over) => ({
  id: 'a', name: 'Business', type: 'spark', balanceSats: 1200, isActive: true, usable: true, reason: null, ...over,
})
const WALLETS = [
  entry({ id: 'biz', name: 'Business' }),
  entry({ id: 'personal', name: 'Personal', isActive: false, balanceSats: 50 }),
  entry({ id: 'alby', name: 'Alby Hub', type: 'nwc', isActive: false, balanceSats: 9000 }),
  entry({ id: 'lnb', name: 'My LNbits', type: 'lnbits', isActive: false, balanceSats: null }),
  entry({ id: 'ark', name: 'Arkade', type: 'arkade', isActive: false, balanceSats: 700, usable: false, reason: 'unsupported-destination' }),
]

// ── PaymentConfirmSheet ──────────────────────────────────────────────

const sheetProps = (over = {}) => ({
  modelValue: true,
  payment: { recipient: { name: 'Alice', address: 'alice@example.com' }, amount: { mode: 'fixed', fixedSats: 1000 } },
  payingWallets: WALLETS.slice(0, 3),
  sendingWalletId: 'biz',
  ...over,
})
const sheetDirectives = ['touch-swipe']

test('every shared send review shows the compact wallet choice in the header only', async () => {
  for (const contextual of [false, true]) {
    const html = await render(ConfirmSheet, sheetProps({ contextual }), { directives: sheetDirectives })
    assert.match(html, /class="payment-wallet-trigger pay-with-field"/)
    assert.match(html, /aria-label="Pay with Business"/)
    const field = html.indexOf('class="payment-wallet-trigger pay-with-field"')
    assert.ok(field < html.indexOf('class="stage stage-compose"'), 'wallet choice is in the header')
    assert.doesNotMatch(html, /class="pay-with"/, 'no second selector below the recipient')
    assert.match(html, /<h2[^>]*>Send<\/h2>/)
  }
})

test('single-wallet sends retain their wallet identity; incoming card flows keep their original header', async () => {
  const single = await render(ConfirmSheet, sheetProps({ payingWallets: [WALLETS[0]] }), { directives: sheetDirectives })
  assert.match(single, /class="payment-wallet-trigger pay-with-field"/)
  for (const verb of ['redeem', 'charge']) {
    const html = await render(ConfirmSheet, sheetProps({ verb }), { directives: sheetDirectives })
    assert.doesNotMatch(html, /payment-wallet-trigger/)
  }
})

test('a wallet that cannot pay disables the commit control and its hint shows in the existing banner', async () => {
  const blocked = await render(ConfirmSheet, sheetProps({
    walletCanPay: false,
    walletHint: 'Lightning is temporarily unavailable on Arkade - switch to another wallet',
  }), { directives: sheetDirectives })
  assert.match(blocked, /wallet-hint/)
  assert.match(blocked, /Lightning is temporarily unavailable on Arkade/)
  assert.match(blocked, /choose-wallet-cta/, 'an unavailable source offers the same wallet chooser for every send')
  const open = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives })
  assert.doesNotMatch(open, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(open, /wallet-hint/)
})

test('the fee row writes known amounts as settings does and never exposes a spending cap', () => {
  const row = (feeEstimate, useBip177Format = true) => ConfirmSheet.computed.feeRowValueText.call({ payment: { feeEstimate }, useBip177Format, $t: t })
  assert.equal(row({ sats: 1234 }), `₿ ${n(1234)}`)
  assert.equal(row({ sats: 1234 }, false), `${n(1234)} sats`)
  assert.equal(row({ sats: 25, isLimit: true }), '')
  assert.equal(row({ sats: 25, isLimit: true }, false), '')
  assert.equal(row({ sats: 0 }), 'Free')
  assert.equal(row({ sats: 0, label: 'Free · instant' }), 'Free · instant')
})

test('canSubmit follows walletCanPay for every amount', () => {
  const vm = (walletCanPay) => ({ walletCanPay, isAmountAcceptable: true, commitGate: true })
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm(true)), true)
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm(false)), false)
})

// Contextual payments begin in this same sheet while recipient details load.
test('preparation shows known recipient and amount, placeholders, status and a disabled send', async () => {
  const html = await render(ConfirmSheet, sheetProps({ contextual: true, preparing: true }), {
    directives: sheetDirectives,
  })
  assert.match(html, /Alice/)
  assert.match(html, /value="1000"/)
  assert.match(html, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Cancel"/)
  assert.match(html, /payment-preparation-details/)
  assert.match(html, /Getting ready to pay…/)
  assert.match(html, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(html, /class="pay-with"/)
  assert.doesNotMatch(html, /wallet-preference-prompt/)
})

test('a failed preparation keeps the draft and exposes an inline retry with Back', async () => {
  const html = await render(ConfirmSheet, sheetProps({
    contextual: true, preparationError: 'Could not get payment details. Try again.',
    payment: { recipient: { name: 'Alice' }, amount: { mode: 'free' } },
  }), { directives: sheetDirectives, data: { displayAmount: '751' } })
  assert.match(html, /value="751"/)
  assert.match(html, /preparation-error[^>]*role="status"/)
  assert.match(html, /Could not get payment details. Try again./)
  assert.match(html, /preparation-retry/)
  assert.match(html, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Cancel"/)
})

test('resolving or retrying preparation preserves a free amount; a fixed invoice owns its amount', () => {
  const vm = { show: true, amountMode: 'free', displayAmount: '751', currentCurrency: 'fiat', fixedSats: 1000, initializeResolvedDetails: ConfirmSheet.methods.initializeResolvedDetails }
  ConfirmSheet.watch.preparing.call(vm, false, true)
  assert.equal(vm.displayAmount, '751')
  assert.equal(vm.currentCurrency, 'fiat')
  ConfirmSheet.watch.preparing.call(vm, true, false)
  assert.equal(vm.displayAmount, '751')
  vm.amountMode = 'fixed'
  ConfirmSheet.watch.preparing.call(vm, false, true)
  assert.equal(vm.displayAmount, '1000')
  assert.equal(vm.currentCurrency, 'sats')
})

test('preparation and the wallet chooser each hold the commit gate', () => {
  const vm = { walletCanPay: true, isAmountAcceptable: true, commitGate: true, preparationActive: true, walletPickerOpen: false }
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm), false)
  vm.preparationActive = false
  vm.walletPickerOpen = true
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm), false)
})

test('a missing preferred wallet is shown honestly even with only one alternative', async () => {
  const html = await render(ConfirmSheet, sheetProps({
    contextual: true, preferredWalletId: 'deleted', sendingWalletId: 'deleted',
    payingWallets: [WALLETS[0]], walletCanPay: false,
    walletHint: 'Your payment wallet is unavailable. Choose another wallet.',
  }), { directives: sheetDirectives })
  assert.match(html, /Wallet unavailable/)
  assert.match(html, /Choose another wallet/)
  assert.match(html, /choose-wallet-cta/)
  assert.doesNotMatch(html, /<strong>Business<\/strong>/, 'never silently shows the alternative as selected')
})

test('the contextual chooser uses the same sheet and has a separate explicit apply action', async () => {
  const html = await render(ConfirmSheet, sheetProps({ contextual: true, preferredWalletId: 'biz' }), {
    directives: sheetDirectives, data: { walletPickerOpen: true, walletDraftId: 'personal' },
  })
  assert.match(html, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Back"/)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /data-wallet-id="personal" tabindex="0"[^>]*aria-checked="true"/)
  assert.match(html, /payment-wallet-apply[^>]*>Use Personal/)
  assert.match(html, /This is just for this payment/)
  assert.doesNotMatch(html, /type="checkbox"/)
  assert.doesNotMatch(html, /future payments|Make preferred|wallet-preference-prompt/)
  assert.doesNotMatch(html, /Getting ready to pay/)
  assert.equal((readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8').match(/<q-dialog\b/g) || []).length, 1)
})

test('picker changes remain a draft and applying changes only this payment', () => {
  const emitted = []
  const vm = {
    walletDraftId: 'biz', preferWalletDraft: true, preferredWalletId: 'biz',
    walletSelectable: ConfirmSheet.methods.walletSelectable,
    $emit: (...event) => emitted.push(event), closeWalletPicker() { this.closed = true },
  }
  ConfirmSheet.methods.chooseWalletDraft.call(vm, WALLETS[1])
  assert.equal(vm.walletDraftId, 'personal')
  assert.deepEqual(emitted, [])
  vm.walletDraft = WALLETS[1]
  ConfirmSheet.methods.applyWalletDraft.call(vm)
  assert.deepEqual(emitted, [['update:sendingWalletId', 'personal']])
  emitted.length = 0
  vm.walletDraft = { ...WALLETS[1], connectionFailed: true }
  ConfirmSheet.methods.applyWalletDraft.call(vm)
  assert.deepEqual(emitted, [])
})

test('Back in the chooser discards its draft without cancelling the payment', () => {
  let closed = false
  const vm = { walletPickerOpen: true, closeWalletPicker: () => { closed = true }, $emit: () => assert.fail('no cancel or wallet event') }
  ConfirmSheet.methods.onTopAction.call(vm)
  assert.equal(closed, true)
})

test('the payment review never asks to save a default wallet inline', async () => {
  for (const preparing of [true, false]) {
    const html = await render(ConfirmSheet, sheetProps({ contextual: true, preparing }), { directives: sheetDirectives })
    assert.doesNotMatch(html, /wallet-preference-prompt|future payments|Make preferred|type="checkbox"/)
  }
})

test('radio keyboard navigation selects a draft, skips unavailable wallets and never applies it', () => {
  const first = { dataset: { walletId: 'biz' }, focus() { globalThis.document.activeElement = this } }
  const second = { dataset: { walletId: 'personal' }, focus() { globalThis.document.activeElement = this } }
  const vm = {
    payingWallets: WALLETS, walletDraftId: 'biz', preferWalletDraft: true,
    walletSelectable: ConfirmSheet.methods.walletSelectable,
    chooseWalletDraft: ConfirmSheet.methods.chooseWalletDraft,
    $emit: () => assert.fail('arrow navigation does not apply'),
  }
  globalThis.document = { activeElement: first }
  try {
    let prevented = false
    ConfirmSheet.methods.onWalletPickerKeydown.call(vm, {
      key: 'ArrowRight', preventDefault() { prevented = true },
      currentTarget: { querySelectorAll(selector) { assert.match(selector, /:not\(\[aria-disabled/); return [first, second] } },
    })
    assert.equal(prevented, true)
    assert.equal(vm.walletDraftId, 'personal')
      assert.equal(globalThis.document.activeElement, second)
  } finally { delete globalThis.document }
})

test('a newly mounted open sheet initializes its amount and cancellation listener immediately', () => {
  const calls = []
  ConfirmSheet.mounted.call({
    show: true,
    startViewportTracking() { calls.push('viewport') },
    resetForFreshOpen() { calls.push('amount') },
    loadFiatRates() { calls.push('rates') },
    listenForBack(open) { calls.push(['back', open]) },
  })
  assert.deepEqual(calls, ['viewport', 'amount', 'rates', ['back', true]])
})

test('resolved terms initialize the request note and payment-again payout default', () => {
  const vm = {
    show: true, amountMode: 'range', displayAmount: '2500', currentCurrency: 'sats',
    payment: { commentAllowed: true, defaultComment: 'Lunch for us', commentMaxLength: 7, amount: { defaultPayout: 10000 } },
    payoutCurrency: { code: 'TZS' },
    initializeResolvedDetails: ConfirmSheet.methods.initializeResolvedDetails,
  }
  ConfirmSheet.watch.preparing.call(vm, false, true)
  assert.equal(vm.comment, 'Lunch f', 'the recipient comment limit applies')
  assert.equal(vm.displayAmount, '10000')
  assert.equal(vm.currentCurrency, 'TZS')
})

test('resolved payout terms preserve user amount, denomination and note edits, including cleared amounts', () => {
  for (const over of [
    { amountEdited: true, displayAmount: '751', currentCurrency: 'sats' },
    { amountEdited: true, displayAmount: '', currentCurrency: 'sats' },
    { denominationChanged: true, displayAmount: '', currentCurrency: 'usd' },
  ]) {
    const vm = {
      amountMode: 'range', commentEdited: true, comment: 'My own note',
      payment: { commentAllowed: true, defaultComment: 'Request note', amount: { defaultPayout: 10000 } },
      payoutCurrency: { code: 'TZS' }, ...over,
    }
    ConfirmSheet.methods.initializeResolvedDetails.call(vm)
    assert.equal(vm.displayAmount, over.displayAmount)
    assert.equal(vm.currentCurrency, over.currentCurrency)
    assert.equal(vm.comment, 'My own note')
  }
})

test('new payout currency becomes the default for an untouched empty amount only', () => {
  const vm = { amountMode: 'range', displayAmount: '', currentCurrency: 'sats', payoutCurrency: { code: 'TZS' } }
  ConfirmSheet.methods.initializeResolvedDetails.call(vm)
  assert.equal(vm.currentCurrency, 'TZS')
  vm.displayAmount = '251'
  vm.currentCurrency = 'sats'
  ConfirmSheet.methods.initializeResolvedDetails.call(vm)
  assert.equal(vm.currentCurrency, 'sats', 'never reinterpret an existing sat value as local currency')
  assert.equal(vm.displayAmount, '251')
})

test('known fixed amount is visible on the first preparing frame', () => {
  const emitted = []
  const vm = {
    amountMode: 'fixed', fixedSats: 2100, amountInSats: 2100,
    payment: { amount: { mode: 'fixed', fixedSats: 2100 } },
    $nextTick(callback) { callback() }, $emit: (...event) => emitted.push(event),
  }
  ConfirmSheet.methods.resetForFreshOpen.call(vm)
  assert.equal(vm.displayAmount, '2100')
  assert.equal(vm.currentCurrency, 'sats')
  assert.deepEqual(emitted, [['amount-changed', 2100]])
})

test('payment details are a dedicated child view with exact destination and useful metadata', async () => {
  const address = 'spark1' + '0123456789abcdef'.repeat(8)
  const payment = {
    recipient: { name: 'Spark payment', addressType: 'spark', address },
    amount: { mode: 'free' }, description: 'A long provider description belongs in details.',
    details: { typeLabel: 'Spark payment', networkLabel: 'Bitcoin', address, description: 'Lunch', metadata: [{ label: 'Expires', value: 'Tomorrow' }] },
  }
  const main = await render(ConfirmSheet, sheetProps({ payment }), { directives: sheetDirectives })
  assert.match(main, /aria-label="Payment details"/)
  assert.doesNotMatch(main, /class="payment-details-view"/)
  assert.doesNotMatch(main, new RegExp(address))
  assert.doesNotMatch(main, /A long provider description belongs in details/)
  const details = await render(ConfirmSheet, sheetProps({ payment }), {
    directives: sheetDirectives, data: { detailsOpen: true, displayAmount: '751', comment: 'My note' },
  })
  assert.match(details, /class="stage payment-details-view"/)
  assert.ok(details.includes(address), 'exact destination is available for verification and copy')
  assert.match(details, /Network<\/dt><dd>Bitcoin/)
  assert.match(details, /Description<\/dt><dd>Lunch/)
  assert.match(details, /Expires<\/dt><dd>Tomorrow/)
  assert.match(details, /payment-details-copy/)
  assert.match(details, /class="stage stage-compose" style="display:none;"/)
  assert.match(details, /value="751"/, 'the compose draft stays mounted')
})

test('details Back restores the review without changing amount, currency, comment or wallet', () => {
  const vm = {
    detailsOpen: true, walletPickerOpen: false, displayAmount: '751', currentCurrency: 'usd', comment: 'My note', sendingWalletId: 'alby',
    closePaymentDetails: ConfirmSheet.methods.closePaymentDetails,
    $nextTick() {}, $emit: () => assert.fail('Back from details never submits or cancels'),
  }
  ConfirmSheet.methods.onTopAction.call(vm)
  assert.equal(vm.detailsOpen, false)
  assert.deepEqual([vm.displayAmount, vm.currentCurrency, vm.comment, vm.sendingWalletId], ['751', 'usd', 'My note', 'alby'])
  assert.equal(ConfirmSheet.computed.canSubmit.call({ walletCanPay: true, isAmountAcceptable: true, commitGate: true, detailsOpen: true }), false)
})

test('ordinary scanned sends and contextual sends open the same wallet chooser without changing drafts', () => {
  for (const contextual of [false, true]) {
    const vm = {
      verb: 'send', contextual, sendingWalletId: 'biz', displayAmount: '900', comment: 'Coffee', currentCurrency: 'sats',
      $nextTick() {},
    }
    ConfirmSheet.methods.openWalletPicker.call(vm)
    assert.equal(vm.walletPickerOpen, true)
    assert.equal(vm.walletDraftId, 'biz')
    assert.deepEqual([vm.displayAmount, vm.comment, vm.currentCurrency], ['900', 'Coffee', 'sats'])
  }
})

test('only known fees produce a total; unknown fees stay explicit without invented numbers', async () => {
  for (const feeEstimate of [{ sats: 42, isGuess: true }, { sats: 42, isEstimated: true }, { sats: 42, isLimit: true }]) {
    assert.equal(ConfirmSheet.computed.feeRowVisible.call({ payment: { feeEstimate } }), false)
    assert.equal(ConfirmSheet.computed.feeRowValueText.call({ payment: { feeEstimate } }), '')
  }
  const known = await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, feeEstimate: { sats: 12 } } }), { directives: sheetDirectives })
  assert.match(known, /payment-total-row/)
  assert.match(known, new RegExp(`₿ ${n(1012)}`))
  const unknown = await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, feeNotice: 'Fee calculated when sending.' } }), { directives: sheetDirectives })
  assert.match(unknown, /payment-fee-notice[^>]*role="status"/)
  assert.match(unknown, /Fee calculated when sending/)
  assert.doesNotMatch(unknown, /payment-total-row/)
})

test('malformed numeric fees never appear as a price or a total', () => {
  for (const sats of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const vm = { payment: { feeEstimate: { sats } } }
    assert.equal(ConfirmSheet.computed.feeRowVisible.call(vm), false)
    assert.equal(ConfirmSheet.computed.feeRowValueText.call(vm), '')
  }
})

test('the visual viewport owns the keyboard inset without applying a second inset on pinch zoom', () => {
  const vm = {}
  globalThis.window = { innerHeight: 844, visualViewport: { height: 460, offsetTop: 0, scale: 1 } }
  try {
    ConfirmSheet.methods.syncVisualViewport.call(vm)
    assert.deepEqual([vm.visualViewportHeight, vm.visualViewportBottom], [460, 384])
    assert.deepEqual(ConfirmSheet.computed.sendViewportStyle.call({ ...vm, verb: 'send' }), {
      '--payment-viewport-height': '460px', '--payment-viewport-bottom': '384px',
    })
    globalThis.window.visualViewport.scale = 2
    ConfirmSheet.methods.syncVisualViewport.call(vm)
    assert.deepEqual([vm.visualViewportHeight, vm.visualViewportBottom], [null, 0])
    assert.equal(ConfirmSheet.computed.sendViewportStyle.call({ ...vm, verb: 'send' }), undefined)
  } finally { delete globalThis.window }
})

test('viewport resize listeners are removed with the payment sheet', () => {
  const listeners = new Set()
  const viewport = { height: 844, scale: 1, addEventListener(type, callback) { listeners.add(`${type}:${callback}`) }, removeEventListener(type, callback) { listeners.delete(`${type}:${callback}`) } }
  globalThis.window = { innerHeight: 844, visualViewport: viewport, addEventListener() {}, removeEventListener() {} }
  const vm = { verb: 'send', syncVisualViewport: ConfirmSheet.methods.syncVisualViewport }
  try {
    ConfirmSheet.methods.startViewportTracking.call(vm)
    assert.equal(listeners.size, 2)
    ConfirmSheet.methods.stopViewportTracking.call(vm)
    assert.equal(listeners.size, 0)
  } finally { delete globalThis.window }
})

test('wallet chooser keeps known balances beside restriction reasons without inventing unknown balances', () => {
  const vm = { useBip177Format: true }
  assert.equal(ConfirmSheet.methods.walletPickerBalance.call(vm, { ...WALLETS[0], usable: false }), `₿ ${n(1200)}`)
  assert.equal(ConfirmSheet.methods.walletPickerBalance.call(vm, { ...WALLETS[0], connectionFailed: true }), `₿ ${n(1200)}`)
  assert.equal(ConfirmSheet.methods.walletPickerBalanceOutdated.call(vm, { ...WALLETS[0], connectionFailed: true }), true)
  assert.equal(ConfirmSheet.methods.walletPickerBalance.call(vm, { id: 'unknown', usable: false }), null)
})

test('an in-flight SDK fee quote blocks confirmation until its result is reviewable', async () => {
  const vm = { walletCanPay: true, isAmountAcceptable: true, commitGate: true, payment: { feeEstimate: { isEstimating: true } } }
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm), false)
  vm.payment.feeEstimate = { sats: 7, isEstimating: false }
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm), true)
  vm.payment = { feeNotice: 'Fee calculated when sending.' }
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm), true, 'a settled unknown fee retains the existing payment path')
  const html = await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, feeEstimate: { isEstimating: true } } }), { directives: sheetDirectives })
  assert.match(html, /class="primary-cta"[^>]*disabled/)
})

test('root dismiss uses Cancel and x; child return uses Back and chevron', async () => {
  const main = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives })
  assert.match(main, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Cancel"/)
  assert.match(main, /data-icon="tabler:x"/)
  for (const data of [{ walletPickerOpen: true, walletDraftId: 'biz' }, { detailsOpen: true }]) {
    const child = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives, data })
    assert.match(child, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Back"/)
    assert.match(child, /data-icon="tabler:chevron-left"/)
  }
})

test('generic payments use the original Bitcoin logo and keep encoded requests exclusively in details', async () => {
  for (const network of ['Spark', 'Arkade', 'Lightning', 'Bitcoin']) {
    const address = 'lnbc24000n1' + 'rawsignedrequest'.repeat(8)
    const payment = { recipient: { name: 'Bitcoin payment', addressType: 'invoice', address }, amount: { mode: 'fixed', fixedSats: 1000 }, details: { networkLabel: network, address } }
    const html = await render(ConfirmSheet, sheetProps({ payment, payingWallets: [] }), { directives: sheetDirectives })
    assert.match(html, /class="recipient-name">Bitcoin payment/)
    assert.match(html, /src="\/icons\/bitcoin.svg" alt(?:="")? class="recipient-bitcoin-logo"/)
    assert.doesNotMatch(html, /class="recipient-addr"/, 'protocol wording stays in Payment details')
    assert.ok(!html.includes(address.slice(0, 17)), 'even a shortened invoice stays out of the main review')
    assert.doesNotMatch(html, /class="recipient-method-cue"/, 'anonymous payment uses the existing icon area')
  }
})

test('a known contact keeps its avatar and name without a protocol badge', async () => {
  const payment = {
    recipient: { name: 'Alice', addressType: 'lightning', address: 'alice@example.com', matchedContact: true, logoUrl: 'https://example.com/alice.jpg' },
    amount: { mode: 'fixed', fixedSats: 1000 }, details: { networkLabel: 'Lightning', typeLabel: 'Lightning address' },
  }
  const html = await render(ConfirmSheet, sheetProps({ payment, payingWallets: [] }), { directives: sheetDirectives })
  assert.match(html, /src="https:\/\/example.com\/alice.jpg" alt="Alice"/)
  assert.match(html, /class="recipient-name">Alice/)
  assert.match(html, /class="recipient-addr">alice@example.com/)
  assert.doesNotMatch(html, /recipient-method-cue|data-mark="spark"|data-icon="tabler:bolt"/)
})
