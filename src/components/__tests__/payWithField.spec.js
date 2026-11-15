/**
 * "Pay with" - the field and the sheet that hosts it.
 *
 * The real templates are compiled (SSR) and rendered, the real scripts run
 * with their imports stubbed, so these tests read the actual markup and the
 * actual component logic:
 *   - nothing renders for fewer than two wallets, and never for redeem / charge
 *   - collapsed field: name, "type · balance", chevron, aria-expanded
 *   - expanded list: listbox / option semantics, check on the selected row,
 *     unusable rows aria-disabled and carrying their reason
 *   - picking: only a usable, different wallet is reported; a disabled field
 *     reports nothing
 *   - the sheet forwards the pick and keeps its commit gate on walletCanPay
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as ServerRenderer from 'vue/server-renderer'
import * as amountFormatting from '../../utils/amountFormatting.js'
import { normalizePaymentAmountInput } from '../../utils/paymentAmountInput.js'
import * as payingWallets from '../../utils/payingWallets.js'
import { safeBrantaUrl, brantaAvatar } from '../../utils/branta.js'

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

const PayWithField = load('../PayWithField.vue', baseDeps)
const MerchantMark = load('../BrantaMerchantMark.vue', { '../utils/branta.js': { safeBrantaUrl, brantaAvatar } })
const VerificationDetails = load('../BrantaVerificationDetails.vue', { '@capacitor/core': { Capacitor: { isNativePlatform: () => false } }, '@iconify/vue': { Icon }, './BrantaMerchantMark.vue': MerchantMark, '../utils/branta.js': { safeBrantaUrl }, '../utils/inAppBrowser.js': { openInAppBrowser: async () => {} } })
const ConfirmSheet = load('../PaymentConfirmSheet.vue', {
  './BrantaMerchantMark.vue': MerchantMark,
  './BrantaVerificationDetails.vue': VerificationDetails,
  ...baseDeps,
  './PayWithField.vue': PayWithField,
  '../utils/amountFormatting.js': amountFormatting,
  '../utils/fiatCurrencies.js': { FIAT_SYMBOLS: {} },
  '../utils/fiatRates.js': { fiatRatesService: {} },
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

/** The text of the first "type · balance · fiat" line, markup removed. */
const detail = (html) => html.match(/<small[^>]*>([\s\S]*?)<\/small>/)[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

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

// ── PayWithField: rendering ──────────────────────────────────────────

test('nothing renders for a single wallet or none', async () => {
  for (const wallets of [[], [WALLETS[0]]]) {
    const html = await render(PayWithField, { wallets, modelValue: 'biz' })
    assert.doesNotMatch(html, /pay-with/)
    assert.doesNotMatch(html, /Pay with/)
  }
})

test('collapsed: label, selected wallet, "type · balance" and a closed state', async () => {
  const html = await render(PayWithField, { wallets: WALLETS.slice(0, 3), modelValue: 'biz' })
  assert.match(html, /Pay with/)
  assert.match(html, /class="pay-with-field"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /<strong>Business<\/strong>/)
  assert.equal(detail(html), `Spark · ₿ ${n(1200)} · $1.20`)
  assert.match(html, /data-icon="tabler:chevron-down"/)
  assert.doesNotMatch(html, /role="listbox"/)
  assert.doesNotMatch(html, /pay-with-reason/)
})

test('the legacy sats format and an unknown balance read correctly', async () => {
  walletState.useBip177Format = false
  try {
    const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'lnb' })
    assert.equal(detail(html), 'LNbits', 'no balance known: just the type, never an invented 0')
    const biz = await render(PayWithField, { wallets: WALLETS, modelValue: 'biz' })
    assert.equal(detail(biz), `Spark · ${n(1200)} sats · $1.20`)
  } finally {
    walletState.useBip177Format = true
  }
})

test('every wallet shows its brand mark, Arkade on its own tile', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'biz' }, { data: { open: true } })
  const marks = [...html.matchAll(/data-mark="([a-z]+)"/g)].map((m) => m[1])
  // the field's mark, then one per row
  assert.deepEqual(marks, ['spark', 'spark', 'spark', 'nwc', 'lnbits', 'arkade'])
  assert.equal((html.match(/pay-with-tile--arkade/g) || []).length, 1)
})

test('expanded: a listbox of options, the selected one checked, unusable ones disabled with their reason', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'alby' }, { data: { open: true } })
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /role="listbox"/)
  const options = html.match(/<button[^>]*role="option"[^>]*>/g)
  assert.equal(options.length, 5)
  assert.equal(options.filter((o) => o.includes('aria-selected="true"')).length, 1)
  assert.match(options[2], /aria-selected="true"/, 'Alby Hub is the selected row')
  assert.match(options[4], /aria-disabled="true"/, 'Arkade cannot pay a Lightning payment')
  assert.equal(options.filter((o) => o.includes('aria-disabled')).length, 1)
  assert.match(html, /<small class="pay-with-reason">Can&#39;t pay this<\/small>/)
  assert.equal((html.match(/data-icon="tabler:check"/g) || []).length, 1, 'one check mark, on the selected row')
  // 44 pt: the rows are real buttons, the sheet sizes them in CSS (asserted below)
  assert.ok(options.every((o) => o.includes('type="button"')))
})

test('reasons are plain words, never the payment rail', async () => {
  const wallets = [
    entry({ id: 'biz' }),
    entry({ id: 'alby', name: 'Alby Hub', type: 'nwc', isActive: false, usable: false, reason: 'unsupported-destination' }),
    entry({ id: 'p', name: 'Personal', isActive: false, usable: false, reason: 'insufficient-balance' }),
  ]
  const html = await render(PayWithField, { wallets, modelValue: 'biz' }, { data: { open: true } })
  assert.match(html, /<small class="pay-with-reason">Can&#39;t pay this<\/small>/)
  assert.match(html, /<small class="pay-with-reason">Not enough balance<\/small>/)
  assert.doesNotMatch(html, /Lightning|Spark wallets only/)
})

test('a selected wallet that cannot pay shows its reason in the collapsed field', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'ark' })
  assert.match(html, /class="[^"]*pay-with-field--blocked[^"]*"/)
  assert.match(html, /<small class="pay-with-reason">Can&#39;t pay this<\/small>/)
})

test('a stale or missing selection falls back to the active wallet', async () => {
  for (const modelValue of [null, undefined, 'removed']) {
    const html = await render(PayWithField, { wallets: WALLETS, modelValue })
    assert.match(html, /<strong>Business<\/strong>/, String(modelValue))
  }
})

test('a disabled field cannot be opened by the user', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'biz', disabled: true })
  assert.match(html, /class="pay-with-field"[^>]*disabled/)
})

test('markup contract: touch targets and the reduced-motion rule live in the stylesheet', () => {
  const source = readFileSync(new URL('../PayWithField.vue', import.meta.url), 'utf8')
  assert.match(source, /\.pay-with-field \{[^}]*min-height: 56px/)
  assert.match(source, /\.pay-with-option \{[^}]*min-height: 56px/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  for (const token of ['--bg-input', '--bg-card', '--border-card', '--text-primary', '--text-secondary', '--text-muted', '--brand-accent-text', '--brand-accent-soft']) {
    assert.ok(source.includes(`var(${token})`), token)
  }
})

// ── PayWithField: behaviour ──────────────────────────────────────────

function fieldVm(props = {}) {
  const emitted = []
  const vm = {
    ...PayWithField.methods,
    wallets: WALLETS, modelValue: 'biz', disabled: false, open: false,
    useBip177Format: true,
    $t: t, $emit: (...args) => emitted.push(args), $nextTick: (fn) => fn?.(), $refs: { field: { focus() {} } },
    $el: { querySelector: () => ({ focus() {} }) },
    ...props,
  }
  for (const name of Object.keys(PayWithField.computed)) {
    if (name === 'useBip177Format') continue
    Object.defineProperty(vm, name, { get: () => PayWithField.computed[name].call(vm), configurable: true })
  }
  return { vm, emitted }
}

test('picking a different usable wallet reports it once and closes the list', () => {
  const { vm, emitted } = fieldVm({ open: true })
  vm.choose(WALLETS[2])
  assert.deepEqual(emitted, [['update:modelValue', 'alby']])
  assert.equal(vm.open, false)
})

test('a wallet that cannot pay can be looked at but never picked', () => {
  const { vm, emitted } = fieldVm({ open: true })
  vm.choose(WALLETS[4])
  assert.deepEqual(emitted, [])
  assert.equal(vm.open, true, 'the list stays open so another row can be chosen')
  vm.choose({ id: 'x', usable: false, reason: 'insufficient-balance' })
  vm.choose(null)
  assert.deepEqual(emitted, [])
})

test('re-picking the selected wallet closes the list without a change event', () => {
  const { vm, emitted } = fieldVm({ open: true })
  vm.choose(WALLETS[0])
  assert.deepEqual(emitted, [])
  assert.equal(vm.open, false)
})

test('a disabled field neither opens nor picks', () => {
  const { vm, emitted } = fieldVm({ disabled: true })
  vm.toggle()
  assert.equal(vm.open, false)
  vm.openList()
  assert.equal(vm.open, false)
  vm.open = true
  vm.choose(WALLETS[2])
  assert.deepEqual(emitted, [])
})

test('the list toggles, and never opens with fewer than two wallets', () => {
  const { vm } = fieldVm()
  vm.toggle()
  assert.equal(vm.open, true)
  vm.toggle()
  assert.equal(vm.open, false)
  const single = fieldVm({ wallets: [WALLETS[0]] })
  single.vm.toggle()
  assert.equal(single.vm.open, false)
})

test('an open list closes when the choice disappears or the payment starts', () => {
  const { vm } = fieldVm({ open: true })
  PayWithField.watch.visible.call(vm, false)
  assert.equal(vm.open, false)
  vm.open = true
  PayWithField.watch.visible.call(vm, true)
  assert.equal(vm.open, true, 'still a choice')
  PayWithField.watch.disabled.call(vm, true)
  assert.equal(vm.open, false)
})

test('Escape closes the list and arrow keys move between rows', () => {
  const rows = [0, 1, 2].map((i) => ({ i, focused: false, focus() { this.focused = true } }))
  const focusedIndex = () => rows.findIndex((r) => r.focused)
  const { vm } = fieldVm({ open: true })
  vm.$el = { querySelectorAll: () => rows }
  const press = (key, at) => {
    rows.forEach((r) => { r.focused = false })
    globalThis.document = { activeElement: at === undefined ? null : rows[at] }
    let prevented = false
    vm.onListKeydown({ key, preventDefault() { prevented = true }, stopPropagation() {} })
    return prevented
  }
  try {
    assert.equal(press('ArrowDown', 0), true); assert.equal(focusedIndex(), 1)
    assert.equal(press('ArrowDown', 2), true); assert.equal(focusedIndex(), 0, 'wraps')
    assert.equal(press('ArrowUp', 0), true); assert.equal(focusedIndex(), 2, 'wraps')
    assert.equal(press('Home', 2), true); assert.equal(focusedIndex(), 0)
    assert.equal(press('End', 0), true); assert.equal(focusedIndex(), 2)
    assert.equal(press('a', 1), false, 'other keys are left alone')
    assert.equal(press('Escape', 1), true)
    assert.equal(vm.open, false)
  } finally {
    delete globalThis.document
  }
})

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
  assert.equal(row({ sats: 1234 }), `₿\u00a0${n(1234)}`)
  assert.equal(row({ sats: 1234 }, false), `${n(1234)}\u00a0sats`)
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

test('the sheet forwards the pick, except mid-send', () => {
  const emitted = []
  const vm = { isSending: false, isComplete: false, $emit: (...args) => emitted.push(args) }
  ConfirmSheet.methods.onPayWithPick.call(vm, 'alby')
  assert.deepEqual(emitted, [['update:sendingWalletId', 'alby']])
  vm.isSending = true
  ConfirmSheet.methods.onPayWithPick.call(vm, 'personal')
  vm.isSending = false
  vm.isComplete = true
  ConfirmSheet.methods.onPayWithPick.call(vm, 'personal')
  assert.equal(emitted.length, 1)
  assert.ok(ConfirmSheet.emits.includes('update:sendingWalletId'))
})

// Contextual payments begin in this same sheet while recipient details load.
test('preparation shows known recipient and amount, placeholders, status and a disabled send', async () => {
  const html = await render(ConfirmSheet, sheetProps({ contextual: true, preparing: true }), {
    directives: sheetDirectives,
  })
  assert.match(html, /Alice/)
  assert.match(html, /value="1,000"/)
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
  assert.match(known, new RegExp(`₿(\u00a0|&nbsp;)${n(1012)}`))
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
    displayAmount: '751', currentCurrency: 'btc', comment: 'Coffee', walletDraftId: 'personal',
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
  for (const vm of [fromRow, fromDetails]) assert.deepEqual([vm.displayAmount, vm.currentCurrency, vm.comment, vm.walletDraftId], ['751', 'btc', 'Coffee', 'personal'])
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
  const fiat = { currentCurrency: 'usd', fiatCurrencyCode: 'USD', fiatRates: { USD: 85000 }, payment: { feeEstimate: { sats: 1 } } }
  assert.equal(ConfirmSheet.computed.feeRowValueText.call(fiat), `≈\u00a0<\u00a0${(0.01).toLocaleString()}\u00a0USD`)
  // The anchor of a fixed amount shown in fiat is a conversion too, and says so.
  const anchor = { currentCurrency: 'usd', fiatCurrencyCode: 'USD', fiatRates: { USD: 100000 }, fixedSats: 2400 }
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
  const vm = { walletPickerOpen: true, walletDraftId: 'biz', detailsOpen: true, brantaDetailsOpen: true, displayAmount: '751', comment: 'Lunch', $nextTick() {} }
  ConfirmSheet.watch.takeover.call(vm, true)
  assert.deepEqual([vm.walletPickerOpen, vm.walletDraftId, vm.detailsOpen, vm.brantaDetailsOpen], [false, null, false, false])
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
