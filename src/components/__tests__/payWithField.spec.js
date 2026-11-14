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

const PayWithField = load('../PayWithField.vue', baseDeps)
const ConfirmSheet = load('../PaymentConfirmSheet.vue', {
  ...baseDeps,
  './PayWithField.vue': PayWithField,
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

test('the sheet shows "Pay with" above the commit control for a send with a choice', async () => {
  const html = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives })
  assert.match(html, /class="pay-with"/)
  const field = html.indexOf('class="pay-with"')
  assert.ok(field > html.indexOf('class="stage stage-compose"'), 'inside the scroll region')
  assert.ok(field < html.indexOf('cta-row confirm-cta'), 'above the pinned commit control')
})

test('the sheet shows no field for a single wallet, for redeem / charge, or without wallets', async () => {
  for (const over of [
    { payingWallets: [WALLETS[0]] },
    { payingWallets: [] },
    { verb: 'redeem' },
    { verb: 'charge' },
  ]) {
    const html = await render(ConfirmSheet, sheetProps(over), { directives: sheetDirectives })
    assert.doesNotMatch(html, /class="pay-with"/, JSON.stringify(over))
  }
  const html = await render(ConfirmSheet, { modelValue: true, payment: sheetProps().payment }, { directives: sheetDirectives })
  assert.doesNotMatch(html, /class="pay-with"/, 'default props: the field is opt-in')
})

test('a wallet that cannot pay disables the commit control and its hint shows in the existing banner', async () => {
  const blocked = await render(ConfirmSheet, sheetProps({
    walletCanPay: false,
    walletHint: 'Lightning is temporarily unavailable on Arkade - switch to another wallet',
  }), { directives: sheetDirectives })
  assert.match(blocked, /wallet-hint/)
  assert.match(blocked, /Lightning is temporarily unavailable on Arkade/)
  assert.match(blocked, /class="primary-cta"[^>]*disabled/)
  const open = await render(ConfirmSheet, sheetProps(), { directives: sheetDirectives })
  assert.doesNotMatch(open, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(open, /wallet-hint/)
})

test('the fee row writes amounts as settings does, and a limit as "Up to"', () => {
  const row = (feeEstimate, useBip177Format = true) => ConfirmSheet.computed.feeRowValueText.call({ payment: { feeEstimate }, useBip177Format, $t: t })
  assert.equal(row({ sats: 1234 }), `₿ ${n(1234)}`)
  assert.equal(row({ sats: 1234 }, false), `${n(1234)} sats`)
  assert.equal(row({ sats: 25, isLimit: true }), 'Up to ₿ 25')
  assert.equal(row({ sats: 25, isLimit: true }, false), 'Up to 25 sats')
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
  assert.match(html, /value="1000"/)
  assert.match(html, />Cancel<\/button>/)
  assert.match(html, /payment-preparation-details/)
  assert.match(html, /Getting payment details…/)
  assert.match(html, /class="primary-cta"[^>]*disabled/)
  assert.doesNotMatch(html, /class="pay-with"/)
  assert.doesNotMatch(html, /wallet-preference-prompt/)
})

test('a failed preparation keeps the draft and exposes an inline retry with Cancel', async () => {
  const html = await render(ConfirmSheet, sheetProps({
    contextual: true, preparationError: 'Could not get payment details. Try again.',
    payment: { recipient: { name: 'Alice' }, amount: { mode: 'free' } },
  }), { directives: sheetDirectives, data: { displayAmount: '751' } })
  assert.match(html, /value="751"/)
  assert.match(html, /preparation-error[^>]*role="status"/)
  assert.match(html, /Could not get payment details. Try again./)
  assert.match(html, /preparation-retry/)
  assert.match(html, />Cancel<\/button>/)
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
  assert.match(html, />Back<\/button>/)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /data-wallet-id="personal" tabindex="0"[^>]*aria-checked="true"/)
  assert.match(html, /payment-wallet-apply[^>]*>Use Personal/)
  assert.match(html, /Make this my preferred wallet/)
  assert.match(html, /type="checkbox"/)
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/)
  assert.doesNotMatch(html, /Getting payment details/)
  assert.equal((readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8').match(/<q-dialog\b/g) || []).length, 1)
})

test('picker changes remain a draft; applying changes only this payment unless preference is opted in', () => {
  const emitted = []
  const vm = {
    walletDraftId: 'biz', preferWalletDraft: true, preferredWalletId: 'biz',
    walletSelectable: ConfirmSheet.methods.walletSelectable,
    $emit: (...event) => emitted.push(event), closeWalletPicker() { this.closed = true },
  }
  ConfirmSheet.methods.chooseWalletDraft.call(vm, WALLETS[1])
  assert.equal(vm.walletDraftId, 'personal')
  assert.equal(vm.preferWalletDraft, false)
  assert.deepEqual(emitted, [])
  vm.walletDraft = WALLETS[1]
  ConfirmSheet.methods.applyWalletDraft.call(vm)
  assert.deepEqual(emitted, [['update:sendingWalletId', 'personal']])
  emitted.length = 0
  vm.preferWalletDraft = true
  ConfirmSheet.methods.applyWalletDraft.call(vm)
  assert.deepEqual(emitted, [['update:sendingWalletId', 'personal'], ['update:preferredWalletId', 'personal']])
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

test('wallet preference prompt is optional and appears only for an available choice after preparation', () => {
  const vm = {
    contextual: true, preparationActive: false, showWalletPreferencePrompt: true,
    preferredWalletId: null, payingWallets: WALLETS, selectedPayingWallet: WALLETS[0],
    walletSelectable: ConfirmSheet.methods.walletSelectable,
  }
  assert.equal(ConfirmSheet.computed.walletPreferencePromptVisible.call(vm), true)
  vm.preparationActive = true
  assert.equal(ConfirmSheet.computed.walletPreferencePromptVisible.call(vm), false)
  vm.preparationActive = false
  vm.selectedPayingWallet = { ...WALLETS[0], connectionFailed: true }
  assert.equal(ConfirmSheet.computed.walletPreferencePromptVisible.call(vm), false)
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
    assert.equal(vm.preferWalletDraft, false)
    assert.equal(globalThis.document.activeElement, second)
  } finally { delete globalThis.document }
})

test('a newly mounted open sheet initializes its amount and cancellation listener immediately', () => {
  const calls = []
  ConfirmSheet.mounted.call({
    show: true,
    resetForFreshOpen() { calls.push('amount') },
    loadFiatRates() { calls.push('rates') },
    listenForBack(open) { calls.push(['back', open]) },
  })
  assert.deepEqual(calls, ['amount', 'rates', ['back', true]])
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
