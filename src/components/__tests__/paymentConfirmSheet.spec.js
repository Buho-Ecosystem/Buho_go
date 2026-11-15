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
import { test, after } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as ServerRenderer from 'vue/server-renderer'
import * as amountFormatting from '../../utils/amountFormatting.js'
import { normalizePaymentAmountInput } from '../../utils/paymentAmountInput.js'
import * as payingWallets from '../../utils/payingWallets.js'
import { safeBrantaUrl, brantaAvatar } from '../../utils/branta.js'
import '../../__tests__/memoryStorage.js'

// The real rates service, off the network: the sheet reads its rule for
// turning a typed fiat amount into Bitcoin.
const realFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'offline', json: async () => ({}) })
const { warn, error } = console
console.warn = console.error = () => {}
const { FiatRatesService, fiatRatesService: appRates } = await import('../../utils/fiatRates.js')
appRates.stopAutoUpdate()
// The app's own instance asks for rates once when it loads: let that end, unheard.
await appRates.inflight
Object.assign(console, { warn, error })
const ratesService = new FiatRatesService()
after(() => { globalThis.fetch = realFetch })

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
  '../utils/paymentAmountInput.js': { normalizePaymentAmountInput },
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

const MerchantMark = load('../BrantaMerchantMark.vue', { '../utils/branta.js': { safeBrantaUrl, brantaAvatar } })
const VerificationDetails = load('../BrantaVerificationDetails.vue', { '@capacitor/core': { Capacitor: { isNativePlatform: () => false } }, '@iconify/vue': { Icon }, './BrantaMerchantMark.vue': MerchantMark, '../utils/branta.js': { safeBrantaUrl }, '../utils/inAppBrowser.js': { openInAppBrowser: async () => {} } })
const ConfirmSheet = load('../PaymentConfirmSheet.vue', {
  './BrantaMerchantMark.vue': MerchantMark,
  './BrantaVerificationDetails.vue': VerificationDetails,
  ...baseDeps,
  '../utils/amountFormatting.js': amountFormatting,
  '../utils/fiatCurrencies.js': { FIAT_SYMBOLS: {} },
  '../utils/fiatRates.js': { fiatRatesService: ratesService },
})

async function render(component, props, { data, directives = [], locale } = {}) {
  const options = data ? { ...component, data: () => ({ ...(component.data?.() || {}), ...data }) } : component
  const app = Vue.createSSRApp(options, props)
  app.config.globalProperties.$t = t
  if (locale) app.config.globalProperties.$i18n = { locale }
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
// Rendered markup without the template's comments and the gaps between tags.
const bare = html => html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><')

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
    walletHint: 'This payment needs a different wallet.',
  }), { directives: sheetDirectives })
  assert.match(blocked, /wallet-hint/)
  assert.match(blocked, /This payment needs a different wallet\./)
  assert.match(blocked, /choose-wallet-cta/, 'an unavailable source offers the same wallet chooser for every send')
  const open = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives })
  assert.doesNotMatch(open, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(open, /wallet-hint/)
})

test('the fee row writes a quote as settings does and a limit the payment is held to as "Up to"', () => {
  const row = (feeEstimate, useBip177Format = true) => ConfirmSheet.computed.feeRowValueText.call({ payment: { feeEstimate }, useBip177Format, $t: t })
  assert.equal(row({ sats: 1234 }), `₿\u00a0${n(1234)}`)
  assert.equal(row({ sats: 1234 }, false), `${n(1234)}\u00a0sats`)
  assert.equal(row({ sats: 25, isLimit: true }), 'Up to ₿\u00a025')
  assert.equal(row({ sats: 25, isLimit: true }, false), 'Up to 25\u00a0sats')
  assert.equal(row({ sats: 0 }), 'Free')
  assert.equal(row({ sats: 0, label: 'Free · instant' }), 'Free · instant')
})

test('a payment link names its site under the name the site gave itself', () => {
  const label = (recipient, over = {}) => ConfirmSheet.computed.recipientAddressLabel.call({ verb: 'send', recipientVerification: null, recipientIsRawAddress: false, recipientAddress: '', payment: { recipient }, ...over })
  assert.equal(label({ name: 'Pay shop', addressType: 'lnurl', addressLabel: 'shop.example' }), 'shop.example')
  assert.equal(label({ name: 'shop.example', addressType: 'lnurl', addressLabel: 'shop.example' }), '', 'not said twice')
  assert.equal(label({ name: 'Bitcoin payment', addressType: 'invoice', addressLabel: 'lnbc1…' }), '', 'an encoded request stays in Payment details')
})

test('"Choose another wallet" needs another wallet that can pay; a limit is said in the sheet\'s own format', () => {
  const another = (payingWallets, sendingWalletId = 'a') => ConfirmSheet.computed.anotherWalletCanPay.call({ payingWallets, sendingWalletId, walletSelectable: ConfirmSheet.methods.walletSelectable })
  assert.equal(another([{ id: 'a', usable: false }]), false, 'the only wallet is the one that cannot pay')
  assert.equal(another([{ id: 'a', usable: false }, { id: 'b', usable: false }]), false)
  assert.equal(another([{ id: 'a', usable: false }, { id: 'b', usable: true, connectionFailed: true }]), false)
  assert.equal(another([{ id: 'a', usable: false }, { id: 'b', usable: true }]), true)
  const reason = (amountInSats, useBip177Format = true) => ConfirmSheet.computed.amountInvalidReason.call({ amountInputError: false, displayAmount: String(amountInSats), amountMode: 'range', isLocalDenomination: false, amountInSats, minSats: 1000, maxSats: 50000, currentCurrency: 'sats', useBip177Format, $t: t })
  assert.equal(reason(999), `Minimum is ₿\u00a0${n(1000)}`)
  assert.equal(reason(50001), `Maximum is ₿\u00a0${n(50000)}`)
  assert.equal(reason(999, false), `Minimum is ${n(1000)}\u00a0sats`)
  assert.equal(reason(2000), '')
})

test('typed in the recipient\'s currency, the limit and the total cover what the service may add', () => {
  // 1850 sats estimated; the invoice is refused above 2045 and the route fee above 19: at most 214 on top.
  const payoutCurrency = { code: 'KES', multiplier: 1000, decimals: 0 }
  const fee = { sats: 19, isLimit: true, payoutSats: 214 }
  const vm = (over = {}) => ({ payment: { feeEstimate: fee }, isLocalDenomination: true, payoutCurrency, amountInSats: 1850, useBip177Format: true, $t: t, ...over })
  const text = (name, over) => ConfirmSheet.computed[name].call(vm(over))
  assert.equal(text('feeRowLabel'), 'Fees', 'more than the network fee is in it')
  assert.match(text('feeRowValueText'), /^Up to .*214/)
  assert.match(text('totalRowValueText'), /^Up to .*2[.,]?064/, 'amount, service allowance and fee limit')
  // In Bitcoin the invoice must equal the amount: only the network fee can be added.
  assert.equal(text('feeRowLabel', { isLocalDenomination: false }), 'Network fee')
  assert.equal(text('feeRowValueText', { isLocalDenomination: false }), 'Up to ₿\u00a019')
  assert.equal(text('totalRowValueText', { isLocalDenomination: false }), `Up to ₿\u00a0${n(1869)}`)
  // Without the wider limit nothing is promised: no "Up to" that leaves the service's part out.
  const bare = { payment: { feeEstimate: { sats: 19, isLimit: true } } }
  assert.equal(text('feeRowValueText', bare), '')
  assert.doesNotMatch(text('totalRowValueText', bare), /Up to/)
})

test('canSubmit follows walletCanPay for every amount', () => {
  const vm = (walletCanPay) => ({ walletCanPay, isAmountAcceptable: true, commitGate: true })
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm(true)), true)
  assert.equal(ConfirmSheet.computed.canSubmit.call(vm(false)), false)
})

test('the sheet forwards the pick, except mid-send', () => {
  const emitted = []
  const vm = { isSending: false, isComplete: false, walletSelectable: ConfirmSheet.methods.walletSelectable, closeWalletPicker() {}, $emit: (...args) => emitted.push(args) }
  ConfirmSheet.methods.pickWallet.call(vm, WALLETS[2])
  assert.deepEqual(emitted, [['update:sendingWalletId', 'alby']])
  vm.isSending = true
  ConfirmSheet.methods.pickWallet.call(vm, WALLETS[1])
  vm.isSending = false
  vm.isComplete = true
  ConfirmSheet.methods.pickWallet.call(vm, WALLETS[1])
  assert.equal(emitted.length, 1)
  assert.ok(ConfirmSheet.emits.includes('update:sendingWalletId'))
})

// Contextual payments begin in this same sheet while recipient details load.
test('preparation shows known recipient and amount, the rows of the ready review, and its status where the commit control will be', async () => {
  const html = bare(await render(ConfirmSheet, sheetProps({ contextual: true, preparing: true }), {
    directives: sheetDirectives,
  }))
  assert.match(html, /Alice/)
  assert.match(html, /value="1,000"/)
  assert.match(html, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Cancel"/)
  assert.match(html, /class="fact-group payment-summary payment-preparation-details"[^>]*aria-busy="true"/)
  // The fee row and the total are the ready review's own rows, their values still to come.
  assert.match(html, /class="fee-row"[^>]*><span class="fee-row-label">Network fee<\/span><span class="fee-row-value"><i class="preparation-placeholder preparation-placeholder--fee"/)
  assert.match(html, /class="payment-total-row"><span>Total<\/span><i class="preparation-placeholder preparation-placeholder--total"/)
  assert.match(html, /class="primary-cta primary-cta--waiting preparation-status" role="status"[^>]*>.*Getting ready to pay…/s)
  assert.doesNotMatch(html, /<button[^>]*class="primary-cta"/, 'nothing to press until the payment is ready')
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

test('a failure that another try cannot change offers Close, never Try again', async () => {
  const failed = (extra) => render(ConfirmSheet, sheetProps({
    contextual: true, preparationError: 'This request can no longer be paid.',
    payment: { recipient: { name: 'Alice' }, amount: { mode: 'fixed', fixedSats: 500 } }, ...extra,
  }), { directives: sheetDirectives })
  const final = await failed({ preparationRetryable: false })
  assert.match(final, /This request can no longer be paid\./)
  assert.match(final, /class="primary-cta preparation-retry"[^>]*>Close</)
  assert.doesNotMatch(final, />Try again</)
  // Close is the sheet's own Cancel: nothing is retried or sent.
  const events = []
  const vm = { verb: 'send', isRedeem: false, $emit: (...event) => events.push(event) }
  ConfirmSheet.methods.onTopAction.call(vm)
  assert.equal(vm.show, false)
  assert.deepEqual(events, [['cancel']])
  const retryable = await failed({})
  assert.match(retryable, /class="primary-cta preparation-retry"[^>]*>Try again</)
  assert.doesNotMatch(retryable, />Close</)
})

test('a default wallet that sat the payment out is said in one plain line, and blocks nothing', async () => {
  const notice = "Travel can't make this payment. Everyday pays this time."
  const html = await render(ConfirmSheet, sheetProps({ walletNotice: notice }), { directives: sheetDirectives })
  assert.match(html, /class="wallet-hint" role="status"/)
  assert.match(html, /Travel can&#39;t make this payment\. Everyday pays this time\./)
  assert.match(html, /data-icon="tabler:switch-horizontal"/)
  assert.doesNotMatch(html, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(html, /choose-wallet-cta/)
  // A wallet that cannot pay keeps its own reason; the two lines never stack.
  const blocked = await render(ConfirmSheet, sheetProps({ walletNotice: notice, walletCanPay: false, walletHint: 'Not enough in Travel' }), { directives: sheetDirectives })
  assert.match(blocked, /Not enough in Travel/)
  assert.doesNotMatch(blocked, /pays this time/)
  // The reason is marked as something to act on, not with the Details button's icon.
  assert.match(blocked, /class="wallet-hint"[^>]*><i data-icon="tabler:alert-circle"/)
  // While the payment is still being prepared the line waits.
  const preparing = await render(ConfirmSheet, sheetProps({ walletNotice: notice, contextual: true, preparing: true }), { directives: sheetDirectives })
  assert.doesNotMatch(preparing, /pays this time/)
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

test('the contextual chooser uses the same sheet; the paying wallet is marked and a tap chooses', async () => {
  const html = await render(ConfirmSheet, sheetProps({ contextual: true, preferredWalletId: 'biz', sendingWalletId: 'personal' }), {
    directives: sheetDirectives, data: { walletPickerOpen: true },
  })
  assert.match(html, /class="top-btn send-back-btn sheet-nav-icon"[^>]*aria-label="Back"/)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /data-wallet-id="personal" tabindex="0"[^>]*aria-checked="true"/)
  assert.match(html, /data-wallet-id="biz" tabindex="-1"[^>]*aria-checked="false"/)
  assert.doesNotMatch(html, /payment-wallet-apply|Use Personal/, 'no second step after the tap')
  assert.match(html, /class="cta-row confirm-cta" style="display:none;"/, 'the commit control is not on screen while choosing')
  assert.match(html, /This is just for this payment/)
  // A row's figure says what it is, and no row names the kind of wallet: its mark does.
  const rows = html.slice(html.indexOf('role="radiogroup"')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  assert.match(rows, new RegExp(`Business Default Available · ₿\\s${n(1200)}`))
  assert.match(rows, new RegExp(`Alby Hub Available · ₿\\s${n(9000)}`))
  assert.doesNotMatch(rows, /Spark|LNbits|NWC|Lightning|· (spark|nwc|lnbits|arkade)/)
  assert.doesNotMatch(html, /type="checkbox"/)
  assert.doesNotMatch(html, /future payments|Make preferred|wallet-preference-prompt/)
  assert.doesNotMatch(html, /Getting ready to pay/)
  assert.equal((readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8').match(/<q-dialog\b/g) || []).length, 1)
})

test('one tap on a wallet that can pay chooses it for this payment and returns to the review', () => {
  const emitted = []
  const vm = {
    sendingWalletId: 'biz', preferredWalletId: 'biz',
    walletSelectable: ConfirmSheet.methods.walletSelectable,
    $emit: (...event) => emitted.push(event), closeWalletPicker() { this.closed = true },
  }
  ConfirmSheet.methods.pickWallet.call(vm, WALLETS[1])
  assert.deepEqual(emitted, [['update:sendingWalletId', 'personal']])
  assert.equal(vm.closed, true)
  // A wallet that cannot pay says why in its row; a tap on it changes nothing.
  for (const wallet of [{ ...WALLETS[1], connectionFailed: true }, WALLETS[4], null]) {
    emitted.length = 0; vm.closed = false
    ConfirmSheet.methods.pickWallet.call(vm, wallet)
    assert.deepEqual(emitted, [])
    assert.equal(vm.closed, false, 'the chooser stays open on its reason')
  }
})

test('Back in the chooser returns to the review without choosing or cancelling', () => {
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

test('arrow keys move through the wallets that can pay and never choose one', () => {
  const first = { dataset: { walletId: 'biz' }, focus() { globalThis.document.activeElement = this } }
  const second = { dataset: { walletId: 'personal' }, focus() { globalThis.document.activeElement = this } }
  const vm = {
    payingWallets: WALLETS, sendingWalletId: 'biz',
    walletSelectable: ConfirmSheet.methods.walletSelectable,
    $emit: () => assert.fail('arrow navigation does not choose'),
  }
  globalThis.document = { activeElement: first }
  try {
    let prevented = false
    ConfirmSheet.methods.onWalletPickerKeydown.call(vm, {
      key: 'ArrowRight', preventDefault() { prevented = true },
      currentTarget: { querySelectorAll(selector) { assert.match(selector, /:not\(\[aria-disabled/); return [first, second] } },
    })
    assert.equal(prevented, true)
    assert.equal(vm.sendingWalletId, 'biz')
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

test('Escape handles persistent send child views once at the card and preserves native redeem behavior', () => {
  const source = readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8')
  assert.match(source, /<q-card\b[^>]*@keydown\.esc="onEscape"/)
  const calls = []
  const event = { stopPropagation() { calls.push('stop') }, preventDefault() { calls.push('prevent') } }
  const vm = { verb: 'send', brantaDetailsOpen: true, onTopAction: ConfirmSheet.methods.onTopAction, closeBrantaDetails() { calls.push('back'); this.brantaDetailsOpen = false; this.detailsOpen = true } }
  ConfirmSheet.methods.onEscape.call(vm, event)
  assert.deepEqual(calls, ['stop', 'prevent', 'back'])
  assert.equal(vm.detailsOpen, true)
  for (const busy of ['isSending', 'isComplete']) {
    calls.length = 0
    ConfirmSheet.methods.onEscape.call({ verb: 'send', [busy]: true, onTopAction() { assert.fail('busy payment cannot navigate') } }, event)
    assert.deepEqual(calls, ['stop', 'prevent'])
  }
  for (const verb of ['redeem', 'charge']) {
    calls.length = 0
    ConfirmSheet.methods.onEscape.call({ verb, onTopAction() { assert.fail('Quasar owns idle redeem Escape') } }, event)
    assert.deepEqual(calls, [])
  }
})

test('ordinary scanned sends and contextual sends open the same wallet chooser without changing the payment', () => {
  for (const contextual of [false, true]) {
    const vm = {
      verb: 'send', contextual, sendingWalletId: 'biz', displayAmount: '900', comment: 'Coffee', currentCurrency: 'sats',
      $nextTick() {},
    }
    ConfirmSheet.methods.openWalletPicker.call(vm)
    assert.equal(vm.walletPickerOpen, true)
    assert.deepEqual([vm.sendingWalletId, vm.displayAmount, vm.comment, vm.currentCurrency], ['biz', '900', 'Coffee', 'sats'])
  }
})

test('one fee slot and a total under it: a quote, a limit, and a fee that comes later without an invented number', async () => {
  const withFee = async fee => bare(await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, ...fee } }), { directives: sheetDirectives }))
  const slots = html => (html.match(/class="fee-row[" ]/g) || []).length
  const known = await withFee({ feeEstimate: { sats: 12 } })
  assert.equal(slots(known), 1)
  assert.match(known, new RegExp(`payment-total-row"><span>Total</span><strong>₿(\u00a0|&nbsp;)${n(1012)}<`))
  // A limit the payment is held to: said as "Up to", in the fee row and in the total.
  const limit = await withFee({ feeEstimate: { sats: 10, isLimit: true } })
  assert.equal(slots(limit), 1)
  assert.match(limit, /fee-row-value"><span>Up to ₿(\u00a0|&nbsp;)10</)
  assert.match(limit, new RegExp(`payment-total-row"><span>Total</span><strong>Up to ₿(\u00a0|&nbsp;)${n(1010)}<`))
  // A wallet that cannot tell the fee beforehand: one line in the same slot, the total names the fee instead of guessing it.
  const unknown = await withFee({ feeNotice: 'Fee calculated when sending.' })
  assert.equal(slots(unknown), 1)
  assert.match(unknown, /class="fee-row"><span class="fee-row-label payment-fee-notice" role="status">Fee calculated when sending\.</)
  assert.match(unknown, new RegExp(`payment-total-row"><span>Total</span><strong>₿(\u00a0|&nbsp;)${n(1000)} \\+ fee<`))
  // A quote on its way: the slot and the total wait in place, so nothing moves when it lands.
  const pending = await withFee({ feeEstimate: { sats: null, isEstimating: true } })
  assert.equal(slots(pending), 1)
  assert.match(pending, /payment-total-row"><span>Total<\/span><i class="preparation-placeholder preparation-placeholder--total"/)
  // Nothing to say about a fee yet (no amount, or the on-chain panel owns it): no slot, no total.
  const none = await withFee({})
  assert.equal(slots(none), 0)
  assert.doesNotMatch(none, /payment-total-row/)
})

test('a note sits above the fee and the total, which stay together', async () => {
  const html = await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, commentAllowed: 120, feeEstimate: { sats: 12 } } }), { directives: sheetDirectives })
  const [note, fee, total] = ['class="note-row"', 'class="fee-row"', 'class="payment-total-row"'].map(mark => html.indexOf(mark))
  assert.ok(note > 0 && note < fee && fee < total, 'note, fee, total')
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

test('the keyboard is followed only while the sheet is open', () => {
  const calls = []
  const vm = () => ({
    resetForFreshOpen() {}, loadFiatRates() {}, listenForBack() {},
    startViewportTracking() { calls.push('start') }, stopViewportTracking() { calls.push('stop') },
  })
  ConfirmSheet.mounted.call({ ...vm(), show: false })
  assert.deepEqual(calls, [], 'a closed sheet listens to nothing')
  ConfirmSheet.watch.show.call(vm(), true)
  ConfirmSheet.watch.show.call(vm(), false)
  assert.deepEqual(calls, ['start', 'stop'])
  // Starting twice attaches once; stopping forgets the keyboard it last saw.
  const added = []
  globalThis.window = { innerHeight: 844, visualViewport: { height: 460, offsetTop: 0, scale: 1, addEventListener: type => added.push(type), removeEventListener() {} }, addEventListener: type => added.push(type), removeEventListener() {} }
  try {
    const live = { verb: 'send', syncVisualViewport: ConfirmSheet.methods.syncVisualViewport }
    ConfirmSheet.methods.startViewportTracking.call(live)
    ConfirmSheet.methods.startViewportTracking.call(live)
    assert.equal(added.length, 3)
    assert.equal(live.visualViewportBottom, 384)
    ConfirmSheet.methods.stopViewportTracking.call(live)
    assert.deepEqual([live.visualViewportHeight, live.visualViewportBottom], [null, 0])
  } finally { delete globalThis.window }
})

test('with the keyboard up the send review takes its compact form; redeem and a full screen do not', () => {
  const compact = vm => ConfirmSheet.computed.keyboardCompact.call(vm)
  assert.equal(compact({ verb: 'send', visualViewportHeight: 460, visualViewportBottom: 384 }), true, 'keyboard over the page')
  assert.equal(compact({ verb: 'send', visualViewportHeight: 420, visualViewportBottom: 0 }), true, 'keyboard that shrinks the page')
  assert.equal(compact({ verb: 'send', visualViewportHeight: 844, visualViewportBottom: 0 }), false)
  assert.equal(compact({ verb: 'send', visualViewportHeight: null, visualViewportBottom: 0 }), false)
  assert.equal(compact({ verb: 'redeem', visualViewportHeight: 460, visualViewportBottom: 384 }), false)
})

test('a pasted address shows its start and end under the name; an encoded request stays in details', async () => {
  const bitcoin = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
  for (const [addressType, address] of [['bitcoin', bitcoin], ['spark', 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2'], ['arkade', 'ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kldfugg29k34y7j96q2w4t567uy9ukgfl2ntulzvlzj7swsprfxwy584hksedkc6t']]) {
    const payment = { recipient: { name: 'Bitcoin payment', addressType, address }, amount: { mode: 'fixed', fixedSats: 1000 } }
    const html = await render(ConfirmSheet, sheetProps({ payment, payingWallets: [] }), { directives: sheetDirectives })
    assert.match(html, /class="recipient-name">Bitcoin payment/)
    assert.ok(html.includes(`class="recipient-addr">${address.slice(0, 10)}…${address.slice(-8)}<`), `${addressType}: first and last characters`)
    assert.ok(!html.includes(address), 'the whole address is one tap away, not in the row')
  }
  // The same address under a saved contact's name.
  const contact = await render(ConfirmSheet, sheetProps({ payment: { recipient: { name: 'Anna', matchedContact: true, addressType: 'bitcoin', address: bitcoin }, amount: { mode: 'fixed', fixedSats: 1000 } }, payingWallets: [] }), { directives: sheetDirectives })
  assert.match(contact, /class="recipient-name">Anna/)
  assert.ok(contact.includes('class="recipient-addr">bc1qcr8te4…8z306fyu<'))
  // A short address is shown whole.
  assert.equal(ConfirmSheet.computed.compactRecipientIdentifier.call({ recipientAddressLabel: 'bc1qshort', recipientIsRawAddress: true }), 'bc1qshort')
  // Redeem keeps its own wording and never takes the send row.
  assert.equal(ConfirmSheet.computed.recipientIsRawAddress.call({ verb: 'redeem', payment: { recipient: { addressType: 'bitcoin' } }, recipientAddress: bitcoin }), false)
})

test('without details from the parent, the destination is named in plain words and a network only for its own kind of address', () => {
  const details = (addressType, address = 'destination') => ConfirmSheet.computed.paymentDetails.call({ payment: { recipient: { addressType } }, recipientAddress: address, $t: t })
  assert.deepEqual([details('invoice').addressLabel, details('invoice').networkLabel], ['Payment request', ''])
  assert.deepEqual([details('lightning').addressLabel, details('lightning').networkLabel], ['Payment address', ''])
  assert.deepEqual([details('lnurl').addressLabel, details('lnurl').networkLabel], ['Payment link', ''])
  for (const [type, network] of [['bitcoin', 'Bitcoin'], ['spark', 'Spark'], ['arkade', 'Arkade']]) {
    assert.deepEqual([details(type).addressLabel, details(type).networkLabel], ['Address', network])
  }
  assert.equal(details('invoice').typeLabel, undefined)
  const given = { typeLabel: 'Bitcoin payment', address: 'x' }
  assert.equal(ConfirmSheet.computed.paymentDetails.call({ payment: { details: given } }), given, 'a parent that supplies details is taken at its word')
})

test('the paid screen names the recipient in the app\'s language; a caller can still set its own words or none', () => {
  const { descriptor } = sfc.parse(readFileSync(new URL('../PaymentConfirmation.vue', import.meta.url), 'utf8'))
  const Confirmation = run(descriptor.script.content, {}, {}).default
  const named = (recipientPrefix, translate = t) => Confirmation.methods.namedRecipient.call({ recipientPrefix, $t: translate }, 'Anna')
  assert.equal(Confirmation.props.recipientPrefix.default, null)
  assert.equal(named(null), 'To Anna')
  assert.equal(named(null, (key, values) => ({ 'To {name}': `An ${values.name}` })[key]), 'An Anna', 'German reads "An Anna", not "To Anna"')
  assert.equal(named(''), 'Anna')
  assert.equal(named('From '), 'From Anna')
})

test('the paid screen can be closed with a button, and closing reports once', async () => {
  const Confirmation = load('../PaymentConfirmation.vue', baseDeps)
  const html = await render(Confirmation, { modelValue: true, amount: 1000, label: 'Payment sent' })
  assert.match(html, /<button type="button" class="done-btn[^"]*">\s*Done\s*<\/button>/)
  const emitted = []
  const vm = { cleanup() {}, show: true, $emit: (name) => emitted.push(name) }
  Confirmation.methods.closeNow.call(vm)
  assert.deepEqual([vm.show, emitted], [false, ['closed']])
  // The button's tap stops at the button: the surface behind it closes on a tap too.
  assert.match(readFileSync(new URL('../PaymentConfirmation.vue', import.meta.url), 'utf8'), /class="done-btn"[\s\S]{0,80}@click\.stop="closeNow"/)
})

test('limits speak the denomination of the amount, the fee and the total', () => {
  const limits = useBip177Format => ConfirmSheet.computed.limitsHelperText.call({ amountMode: 'range', minSats: 1, maxSats: 100000, denominationMode: 'sats', useBip177Format, $t: t })
  assert.equal(limits(true), `Limits ₿\u00a01 – ₿\u00a0${n(100000)}`)
  assert.equal(limits(false), `Limits 1 – ${n(100000)} sats`)
})

test('while a payment to an address is made ready its note row is held; a request has none', async () => {
  const reserved = (addressType, over = {}) => ConfirmSheet.computed.noteRowReserved.call({ preparationActive: true, payment: { recipient: { addressType } }, ...over })
  assert.equal(reserved('lightning'), true)
  assert.equal(reserved('lnurl'), true)
  assert.equal(reserved('invoice'), false)
  assert.equal(reserved('lightning', { preparationActive: false }), false)
  const preparing = { recipient: { name: 'Alice', addressType: 'lightning', address: 'alice@example.com' }, amount: { mode: 'free', defaultAmount: 1000 } }
  const html = bare(await render(ConfirmSheet, sheetProps({ contextual: true, preparing: true, payment: preparing }), { directives: sheetDirectives }))
  assert.match(html, /class="note-row" aria-hidden="true"><span class="note-label">Note \(optional\)<\/span><i class="preparation-placeholder preparation-placeholder--note"/)
  assert.doesNotMatch(html, /class="note-input"/, 'nothing to type into until the address has answered')
  assert.match(html, /class="amount-helper"/, 'the limits line is held too')
})


test('a payment that could not be made ready shows its reason without held rows', async () => {
  const payment = { recipient: { name: 'Alice', addressType: 'lightning', address: 'alice@example.com' }, amount: { mode: 'free', defaultAmount: 1000 } }
  const failed = bare(await render(ConfirmSheet, sheetProps({ contextual: true, preparing: false, preparationError: 'No payment address found.', payment }), { directives: sheetDirectives }))
  assert.match(failed, /No payment address found\./)
  assert.doesNotMatch(failed, /preparation-placeholder/, 'held rows would read as still loading')
  assert.doesNotMatch(failed, /aria-label="Getting ready to pay"/)
  const visible = (over) => ConfirmSheet.computed.factGroupVisible.call({ preparationFailed: false, preparationActive: true, feeSlotVisible: true, noteRowReserved: false, ...over })
  assert.equal(visible({}), true)
  assert.equal(visible({ preparationFailed: true }), false)
})
test('while a payment is made ready its limits line is held; a fixed amount has none to hold', () => {
  const reserved = vm => ConfirmSheet.computed.limitsHelperReserved.call(vm)
  assert.equal(reserved({ verb: 'send', preparing: true, amountMode: 'free' }), true)
  assert.equal(reserved({ verb: 'send', preparing: true, amountMode: 'fixed' }), false)
  assert.equal(reserved({ verb: 'send', preparing: false, amountMode: 'range' }), false)
  assert.equal(reserved({ verb: 'redeem', preparing: true, amountMode: 'free' }), false)
})

test('a balance still being read pulses in its row of the chooser', async () => {
  assert.equal(ConfirmSheet.methods.walletPickerBalancePending.call({}, { id: 'unknown' }), true, 'being read')
  assert.equal(ConfirmSheet.methods.walletPickerBalancePending.call({}, { id: 'biz' }), false, 'settled')
  assert.equal(ConfirmSheet.methods.walletPickerBalancePending.call({}, { id: 'unknown', connectionFailed: true }), false, 'a failed connection is not a read under way')
  assert.ok('balanceUpdating' in ConfirmSheet.directives, 'the app-wide pulse, not a dimmed figure of its own')
  assert.match(readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8'), /<small v-balance-updating="walletPickerBalancePending\(wallet\)">/)
})

test('wallet chooser keeps known balances beside restriction reasons without inventing unknown balances', () => {
  const vm = { useBip177Format: true }
  assert.equal(ConfirmSheet.methods.walletPickerBalance.call(vm, { ...WALLETS[0], usable: false }), `₿\u00a0${n(1200)}`)
  assert.equal(ConfirmSheet.methods.walletPickerBalance.call(vm, { ...WALLETS[0], connectionFailed: true }), `₿\u00a0${n(1200)}`)
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
  for (const data of [{ walletPickerOpen: true }, { detailsOpen: true }]) {
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

const VERIFIED_BUSINESS = {
  name: 'North Cafe', logoUrl: 'https://guardrail.branta.pro/merchant.png',
  verifyUrl: 'https://guardrail.branta.pro/v1/verify/check-id#device-key',
  checkedAt: 1763136000000, environment: 'Production',
}

test('a verified business is named in the recipient row with its seal, and the row opens its check', async () => {
  const payment = { ...sheetProps().payment, recipient: { name: 'North Cafe', address: 'lnbc-request', verification: VERIFIED_BUSINESS } }
  const html = await render(ConfirmSheet, sheetProps({ payment }), { directives: sheetDirectives })
  // The name is on the screen where it matters, never only in an aria-label.
  assert.match(html, /class="recipient-name">North Cafe</)
  assert.match(html, /class="recipient-verified"[\s\S]*?Verified business/)
  assert.match(html, /class="recipient-identity recipient-identity--action"[^>]*role="button"[^>]*tabindex="0"/)
  assert.doesNotMatch(html, /verified-merchant-stage|branta-badge|recipient-addr/)
  // Without artwork it keeps its own initial, never the generic Bitcoin mark.
  assert.doesNotMatch(html, /recipient-bitcoin-logo/)
  assert.match(html, /recipient-info/, 'payment details stay one tap away')
  const plain = await render(ConfirmSheet, sheetProps({ payment: { ...payment, recipient: { name: 'North Cafe', address: 'lnbc-request' } } }), { directives: sheetDirectives })
  assert.doesNotMatch(plain, /recipient-verified|role="button"[^>]*class="recipient-identity/)
  assert.doesNotMatch(plain, /recipient-identity--action/)
  const details = await render(ConfirmSheet, sheetProps({ payment }), { directives: sheetDirectives, data: { detailsOpen: true } })
  assert.match(details, /branta-current-check[\s\S]*?Business check/)
  const proof = await render(ConfirmSheet, sheetProps({ payment }), { directives: sheetDirectives, data: { brantaDetailsOpen: true } })
  assert.match(proof, /branta-verification-view/)
  assert.match(proof, />Business check</, 'one name for the check, in the title')
  assert.match(proof, /Branta matched this payment to the business below/)
  assert.equal((proof.match(/Business check/g) || []).length, 1, 'said once on the screen')
  assert.equal((readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8').match(/<q-dialog\b/g) || []).length, 1)
})

test('the check opens from the recipient row and from payment details, and Back returns where it came from', () => {
  const base = () => ({
    recipientVerification: VERIFIED_BUSINESS, brantaDetailsOpen: false, detailsOpen: false, walletPickerOpen: true, brantaDetailsFrom: 'review',
    displayAmount: '751', currentCurrency: 'btc', comment: 'Coffee',
    closeBrantaDetails: ConfirmSheet.methods.closeBrantaDetails, $nextTick() {}, $refs: {},
  })
  const fromRow = base()
  ConfirmSheet.methods.openBrantaDetails.call(fromRow, 'review')
  assert.deepEqual([fromRow.brantaDetailsOpen, fromRow.detailsOpen, fromRow.walletPickerOpen], [true, false, false])
  ConfirmSheet.methods.onTopAction.call(fromRow)
  assert.deepEqual([fromRow.brantaDetailsOpen, fromRow.detailsOpen], [false, false], 'back on the review')
  const fromDetails = { ...base(), detailsOpen: true }
  ConfirmSheet.methods.openBrantaDetails.call(fromDetails, 'details')
  ConfirmSheet.methods.onTopAction.call(fromDetails)
  assert.deepEqual([fromDetails.brantaDetailsOpen, fromDetails.detailsOpen], [false, true], 'back on payment details')
  for (const vm of [fromRow, fromDetails]) assert.deepEqual([vm.displayAmount, vm.currentCurrency, vm.comment], ['751', 'btc', 'Coffee'])
  const sending = { ...base(), isSending: true }
  ConfirmSheet.methods.openBrantaDetails.call(sending, 'review')
  assert.equal(sending.brantaDetailsOpen, false)
})

test('a send that came back for another look says why in one plain line', async () => {
  const payment = { ...sheetProps().payment, reviewNotice: 'The recipient changed. Review it before sending.' }
  const html = await render(ConfirmSheet, sheetProps({ payment }), { directives: sheetDirectives })
  assert.match(html, /class="wallet-hint" role="status"[\s\S]*?The recipient changed\. Review it before sending\./)
  assert.doesNotMatch(await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives }), /The recipient changed/)
})

test('fixed hero groups like the rest of the app without formatting the exact sat state', async () => {
  // One number format on every screen: the device's, whatever the app language.
  for (const [locale, sats] of [['en-US', 2400], ['de', 2400], ['es', 12400]]) {
    const html = await render(ConfirmSheet, sheetProps({ payment: { ...sheetProps().payment, amount: { mode: 'fixed', fixedSats: sats } } }), { directives: sheetDirectives, locale })
    assert.ok(html.includes(`value="${n(sats)}"`), locale)
    assert.match(html, /<span>₿<\/span>/)
    const vm = { amountMode: 'fixed', fixedSats: sats, displayAmount: String(sats) }
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), sats)
    assert.equal(vm.displayAmount, String(sats))
  }
})

test('BTC hero, fee, total and deliberate slide use one denomination while send stays simple', () => {
  const vm = { currentCurrency: 'btc', fixedSats: 2400, amountInSats: 2400, payment: { feeEstimate: { sats: 7 } }, useBip177Format: true, $t: t }
  const btc = fraction => `0${(1.1).toLocaleString().charAt(1)}${fraction}`
  assert.equal(ConfirmSheet.computed.fixedAmountDisplay.call(vm), btc('00002400'))
  assert.equal(ConfirmSheet.computed.feeRowValueText.call(vm), `${btc('00000007')}\u00a0BTC`)
  assert.equal(ConfirmSheet.computed.totalRowValueText.call(vm), `${btc('00002407')}\u00a0BTC`)
  assert.equal(ConfirmSheet.computed.formattedConfirmAmount.call(vm), `${btc('00002400')}\u00a0BTC`)
  assert.equal(ConfirmSheet.computed.primaryCtaLabel.call({ verb: 'send', isAmountAcceptable: true, $t: t }), 'Send')
})

test('BTC presentation preserves every satoshi across the safe integer range', () => {
  const decimal = (1.1).toLocaleString().charAt(1)
  const maximum = `${n(90071992)}${decimal}54740991`
  const small = `0${decimal}00000029`
  const vm = { currentCurrency: 'btc', fixedSats: Number.MAX_SAFE_INTEGER, amountInSats: Number.MAX_SAFE_INTEGER - 29, payment: { feeEstimate: { sats: 29 } }, $i18n: { locale: 'de' }, $t: t }
  assert.equal(ConfirmSheet.computed.fixedAmountDisplay.call(vm), maximum)
  assert.equal(ConfirmSheet.computed.totalRowValueText.call(vm), `${maximum}\u00a0BTC`)
  assert.equal(ConfirmSheet.computed.feeRowValueText.call(vm), `${small}\u00a0BTC`)
  vm.amountInSats = 29
  assert.equal(ConfirmSheet.computed.formattedConfirmAmount.call(vm), `${small}\u00a0BTC`)
})

test('legacy sats and BIP177 stay consistent and small converted fees never pretend to be zero', () => {
  for (const useBip177Format of [false, true]) {
    const vm = { currentCurrency: 'sats', amountMode: 'fixed', fixedSats: 2400, amountInSats: 2400, payment: { feeEstimate: { sats: 7 } }, useBip177Format, $t: t }
    assert.equal(ConfirmSheet.computed.unitPillLabel.call(vm), useBip177Format ? '₿' : 'sats')
    assert.equal(ConfirmSheet.computed.feeRowValueText.call(vm), useBip177Format ? '₿\u00a07' : '7\u00a0sats')
    assert.equal(ConfirmSheet.computed.totalRowValueText.call(vm), useBip177Format ? `₿\u00a0${n(2407)}` : `${n(2407)}\u00a0sats`)
  }
  const fiat = { currentCurrency: 'usd', fiatCurrencyCode: 'USD', fiatRate: 85000, payment: { feeEstimate: { sats: 1 } } }
  assert.equal(ConfirmSheet.computed.feeRowValueText.call(fiat), `≈\u00a0<\u00a0${(0.01).toLocaleString()}\u00a0USD`)
  // The anchor of a fixed amount shown in fiat is a conversion too, and says so.
  const anchor = { currentCurrency: 'usd', fiatCurrencyCode: 'USD', fiatRate: 100000, fixedSats: 2400 }
  assert.equal(ConfirmSheet.computed.fixedAmountDisplay.call(anchor), `≈\u00a0${(2.4).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
})

test('decimal BTC input converts exactly: 0.00000029 is 29 sats, not 28', () => {
  const vm = { amountMode: 'free', currentCurrency: 'btc', displayAmount: '0.00000029' }
  assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 29)
  vm.displayAmount = '0.000000299'
  ConfirmSheet.methods.onAmountChange.call(vm)
  assert.equal(vm.displayAmount, '0.000000299', 'extra precision remains visible for correction')
  assert.equal(vm.amountInputError, true)
  assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
})

test('incremental German BTC decimal entry survives normalization, blur and digit edits', () => {
  const edit = (vm, value, inputType, data = null) => ConfirmSheet.methods.onAmountChange.call(vm, {
    target: { value }, inputType, data,
  })
  for (const [typed, canonical, sats] of [['1,234', '1.234', 123400000], ['0,00000029', '0.00000029', 29]]) {
    const vm = { amountMode: 'free', currentCurrency: 'btc', displayAmount: '', $i18n: { locale: 'de' } }
    for (const digit of typed) {
      edit(vm, vm.displayAmount + digit, 'insertText', digit)
      assert.equal(vm.amountInputError, false, `${typed}: ${vm.displayAmount}`)
    }
    assert.equal(vm.displayAmount, canonical)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), sats)
    ConfirmSheet.methods.onAmountBlur.call(vm)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), sats)
    // Removing padded digits can land on the same ambiguous-looking draft.
    while (vm.displayAmount.length > canonical.length) edit(vm, vm.displayAmount.slice(0, -1), 'deleteContentBackward')
    const lastDigit = canonical.at(-1)
    edit(vm, vm.displayAmount.slice(0, -1), 'deleteContentBackward')
    edit(vm, vm.displayAmount + lastDigit, 'insertText', lastDigit)
    assert.equal(vm.amountInputError, false)
    assert.equal(vm.displayAmount, canonical)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), sats)
    ConfirmSheet.methods.onAmountBlur.call(vm)
    edit(vm, vm.displayAmount + '1', 'insertText', '1')
    assert.equal(vm.amountInputError, true, 'canonical provenance never accepts excess precision')
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
  }
  for (const [inputType, data] of [['insertFromPaste', '1.234'], ['insertFromDrop', '1.234'], ['insertText', '1.234'], [undefined, undefined]]) {
    const vm = { currentCurrency: 'btc', displayAmount: '1.23', $i18n: { locale: 'de' } }
    edit(vm, '1.234', inputType, data)
    assert.equal(vm.amountInputError, true, `${inputType}: ambiguous new input stays rejected`)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
  }
})

test('merchant mark missing artwork uses the saved initials, also for a record with a name only', async () => {
  const html = await render(MerchantMark, { verification: { name: 'North Cafe' }, size: 40 })
  assert.match(html, /aria-label="North Cafe"/)
  assert.match(html, />NC<\/span>/)
  const broken = await render(MerchantMark, { verification: VERIFIED_BUSINESS }, { data: { failed: true } })
  assert.match(broken, /background:var\(--bg-input\)/)
  assert.match(broken, />NC<\/span>/)
})

test('saved checks do not invent a date or claim current verification, and hostile links cannot open', async () => {
  const old = await render(VerificationDetails, { context: 'historical', verification: { name: 'Old Cafe' } })
  assert.match(old, /Verified business/)
  assert.match(old, /Saved on this device/)
  assert.match(old, /before you sent it/)
  assert.doesNotMatch(old, /branta-proof-time|Branta matched this payment|branta-record-link/)
  for (const verifyUrl of ['javascript:alert(1)', 'https://guardrail.branta.pro.evil.example/v1/verify/id', 'https://user@guardrail.branta.pro/v1/verify/id', 'https://guardrail.branta.pro/']) {
    assert.equal(VerificationDetails.computed.recordUrl.call({ verification: { verifyUrl, environment: 'Production' } }), '')
  }
  assert.equal(VerificationDetails.computed.recordUrl.call({ verification: VERIFIED_BUSINESS }), VERIFIED_BUSINESS.verifyUrl)
})

test('offline record open fails quietly inside saved details', async () => {
  const vm = { recordUrl: VERIFIED_BUSINESS.verifyUrl, opening: false, linkError: false }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
  try { await VerificationDetails.methods.openRecord.call(vm) }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator }
  assert.equal(vm.linkError, true)
  assert.equal(vm.opening, false)
})

test('a late changed-code verdict closes child views without changing the payment draft', () => {
  const vm = { walletPickerOpen: true, detailsOpen: true, brantaDetailsOpen: true, displayAmount: '751', comment: 'Lunch', $nextTick() {} }
  ConfirmSheet.watch.takeover.call(vm, true)
  assert.deepEqual([vm.walletPickerOpen, vm.detailsOpen, vm.brantaDetailsOpen], [false, false, false])
  assert.deepEqual([vm.displayAmount, vm.comment], ['751', 'Lunch'])
})

test('a fixed request displayed in local currency never interprets its raw sats as a payout amount', () => {
  const sent = []
  const vm = { canSubmit: true, amountMode: 'fixed', amountInSats: 2400, displayAmount: '2400', isLocalDenomination: true, payoutCurrency: { code: 'KES', decimals: 0 }, $emit: (...event) => sent.push(event) }
  ConfirmSheet.methods.emitConfirm.call(vm)
  assert.deepEqual(sent, [['confirm', { amountSats: 2400, comment: '' }]])
})

test('merchant initials handle whitespace and camel-case saved names', () => {
  assert.equal(MerchantMark.computed.initials.call({ businessName: '  Northstar   Coffee  ' }), 'NC')
  assert.equal(MerchantMark.computed.initials.call({ businessName: 'NorthstarCoffee' }), 'NC')
})

test('locale editing normalizes explicit decimals/grouping and blocks malformed or fractional sats', () => {
  for (const [locale, currentCurrency, input, expected, sats] of [
    ['de', 'sats', '2.400', '2400', 2400], ['en-US', 'sats', '2,400', '2400', 2400],
    ['de', 'btc', '0,00000029', '0.00000029', 29], ['de', 'btc', '0.00000029', '0.00000029', 29],
  ]) {
    const vm = { currentCurrency, displayAmount: input, $i18n: { locale } }
    ConfirmSheet.methods.onAmountChange.call(vm)
    assert.equal(vm.displayAmount, expected)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), sats)
  }
  const fiat = { currentCurrency: 'fiat', displayAmount: '10,5', $i18n: { locale: 'de' } }
  ConfirmSheet.methods.onAmountChange.call(fiat)
  assert.equal(fiat.displayAmount, '10.5')
  for (const [locale, input] of [['de', '2,5'], ['de', '2.5'], ['de', '2.40'], ['en-US', '2.5'], ['en-US', '2,40']]) {
    const vm = { currentCurrency: 'sats', displayAmount: input, $i18n: { locale }, $t: t, walletCanPay: true, isAmountAcceptable: true, commitGate: true }
    ConfirmSheet.methods.onAmountChange.call(vm)
    assert.equal(vm.displayAmount, input)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
    assert.equal(ConfirmSheet.computed.canSubmit.call(vm), false)
    assert.equal(ConfirmSheet.computed.amountInvalidReason.call(vm), 'Check the amount format.')
  }
})

test('partial and payout drafts keep their precision without enabling a different payment', () => {
  const vm = { currentCurrency: 'KES', displayAmount: '10,', isLocalDenomination: true, payoutCurrency: { code: 'KES', decimals: 2, multiplier: 1000 }, $i18n: { locale: 'de' } }
  ConfirmSheet.methods.onAmountChange.call(vm)
  assert.equal(vm.displayAmount, '10.')
  assert.equal(vm.amountInputPartial, true)
  assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
  vm.displayAmount = '10,25'
  ConfirmSheet.methods.onAmountChange.call(vm)
  assert.equal(vm.displayAmount, '10.25')
  assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 10)
  vm.displayAmount = '10,251'
  ConfirmSheet.methods.onAmountChange.call(vm)
  assert.equal(vm.amountInputError, true)
  assert.equal(ConfirmSheet.computed.amountInSats.call(vm), 0)
})

test('committed amount, denomination and note cannot change through native or stray events', () => {
  for (const busy of ['isSending', 'isComplete']) {
    const vm = { [busy]: true, amountMode: 'free', displayAmount: '2400', currentCurrency: 'sats', comment: 'Coffee', walletCanPay: true, isAmountAcceptable: true, commitGate: true }
    const amountEvent = { target: { value: '9999' } }, noteEvent = { target: { value: 'Changed' } }
    ConfirmSheet.methods.onAmountChange.call(vm, amountEvent)
    ConfirmSheet.methods.toggleCurrency.call(vm)
    ConfirmSheet.methods.onAmountBlur.call(vm)
    ConfirmSheet.methods.setAmountSats.call(vm, 9999)
    ConfirmSheet.methods.onCommentChange.call(vm, noteEvent)
    assert.deepEqual([vm.displayAmount, vm.currentCurrency, vm.comment], ['2400', 'sats', 'Coffee'])
    assert.deepEqual([amountEvent.target.value, noteEvent.target.value], ['2400', 'Coffee'])
    assert.equal(ConfirmSheet.computed.canSubmit.call(vm), false)
  }
})

test('record links are safe anchors on web and do not pretend to detect popup failures', async () => {
  const html = await render(VerificationDetails, { context: 'historical', verification: VERIFIED_BUSINESS })
  assert.match(html, /<a[^>]*href="https:\/\/guardrail.branta.pro\/v1\/verify\/check-id#device-key"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*referrerpolicy="no-referrer"/)
  let prevented = false
  const vm = { recordUrl: VERIFIED_BUSINESS.verifyUrl, opening: false, linkError: true }
  await VerificationDetails.methods.openRecord.call(vm, { preventDefault() { prevented = true } })
  assert.equal(prevented, false)
  assert.equal(vm.linkError, false)
})

test('a late native record failure cannot replace another receipt context', async () => {
  let reject
  const opening = new Promise((_, no) => { reject = no })
  const NativeDetails = load('../BrantaVerificationDetails.vue', {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    '@capacitor/browser': { Browser: { open: () => opening } },
    '../utils/branta.js': { safeBrantaUrl },
  })
  const vm = { verification: VERIFIED_BUSINESS, context: 'current', recordUrl: VERIFIED_BUSINESS.verifyUrl, opening: false, linkError: false }
  let prevented = false
  const run = NativeDetails.methods.openRecord.call(vm, { preventDefault() { prevented = true } })
  await Promise.resolve()
  assert.equal(prevented, true)
  vm.verification = { name: 'Another business' }
  vm.context = 'historical'
  vm.recordUrl = ''
  NativeDetails.watch.verification.call(vm)
  reject(new Error('native browser unavailable'))
  await run
  assert.equal(vm.linkError, false)
  assert.equal(vm.opening, false)
})

test('blur pads canonical decimals without floating-point rounding or changing a fixed request', () => {
  for (const [input, expected] of [['0.00000029', '0.00000029'], ['90071992.54740991', '90071992.54740991'], ['1.', '1.00000000']]) {
    const vm = { currentCurrency: 'btc', displayAmount: input }
    const before = ConfirmSheet.computed.amountInSats.call(vm)
    ConfirmSheet.methods.onAmountBlur.call(vm)
    assert.equal(vm.displayAmount, expected)
    assert.equal(ConfirmSheet.computed.amountInSats.call(vm), before)
    const emitted = []
    ConfirmSheet.methods.emitConfirm.call({ ...vm, canSubmit: true, amountInSats: before, $emit: (...event) => emitted.push(event) })
    assert.equal(emitted[0][1].amountSats, before)
  }
  const fixed = { amountMode: 'fixed', currentCurrency: 'btc', displayAmount: '2400' }
  ConfirmSheet.methods.onAmountBlur.call(fixed)
  assert.equal(fixed.displayAmount, '2400')
  const unsafe = { currentCurrency: 'sats', displayAmount: '9007199254740992' }
  ConfirmSheet.methods.onAmountBlur.call(unsafe)
  assert.equal(unsafe.displayAmount, '9007199254740992')
  assert.equal(ConfirmSheet.computed.amountInSats.call(unsafe), 0)
})

test('an amount typed in fiat is turned into Bitcoin only at a rate fetched within the hour, and never sent at an older one', async () => {
  const HOUR = 60 * 60 * 1000
  // The service holds a euro rate fetched `age` ago, and a shilling rate its own source has failed to renew for a month.
  const hold = (age) => Object.assign(ratesService, {
    rates: { EUR: 90000, KES: 9_000_000 }, rateTimes: { EUR: Date.now() - age, KES: Date.now() - 30 * 24 * HOUR },
    lastUpdate: new Date(), ratesAvailable: true,
  })
  // The sheet as a live object: every computed reads the state it has now.
  const emitted = []
  const vm = {
    ...ConfirmSheet.methods, ...ConfirmSheet.data.call({ payment: null }), $t: t, $emit: (...event) => emitted.push(event),
    $refs: {}, $nextTick: (next) => next?.(), show: true, payment: { amount: { mode: 'free' } }, verb: 'send', walletCanPay: true, commitGate: true, payingWallets: [],
  }
  for (const [name, compute] of Object.entries(ConfirmSheet.computed)) {
    if (typeof compute === 'function' && !(name in vm)) Object.defineProperty(vm, name, { get: compute.bind(vm) })
  }
  walletState.preferredFiatCurrency = 'EUR'
  walletState.denominationCurrency = 'eur'
  try {
    hold(10 * 60 * 1000)
    vm.resetForFreshOpen()
    await vm.loadFiatRates()
    vm.displayAmount = '50.00'
    assert.equal(vm.amountInSats, 55555)
    assert.equal(vm.canSubmit, true)

    // The reviewer's probe: the last good fetch was three hours ago, and the service still hands the rate out.
    hold(3 * HOUR)
    assert.equal((await ratesService.getRates()).EUR, 90000)
    assert.equal(vm.amountInSats, 0, 'nothing is converted at a three-hour-old rate')
    vm.emitConfirm()
    assert.deepEqual(emitted.filter(([name]) => name === 'confirm'), [], 'and nothing is sent')
    // What Vue's watcher does once the rate is gone: the amount is typed in Bitcoin, and one line says why.
    ConfirmSheet.watch.fiatUnavailable.call(vm, vm.fiatUnavailable)
    assert.deepEqual([vm.currentCurrency, vm.displayAmount], ['sats', ''])
    assert.equal(vm.rateNotice, 'No current exchange rate. Enter the amount in Bitcoin.')
    vm.toggleCurrency()
    assert.equal(vm.currentCurrency, 'sats', 'fiat is not offered')
    await Promise.resolve()

    // A currency is not current because the others were just fetched.
    hold(10 * 60 * 1000)
    walletState.preferredFiatCurrency = 'KES'
    Object.assign(vm, { currentCurrency: 'kes', displayAmount: '5000' })
    assert.equal(ratesService.areRatesStale(), false)
    assert.equal(vm.amountInSats, 0, 'a month-old rate converts nothing')
  } finally {
    delete walletState.preferredFiatCurrency
    delete walletState.denominationCurrency
  }
})
