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
const walletState = { useBip177Format: true }
// The app groups digits by the device locale; so does this machine.
const n = (value) => value.toLocaleString()

// Icon stand-in: shows which glyph was asked for.
const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }
const baseDeps = {
  '@iconify/vue': { Icon },
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
  assert.ok(html.includes(`<small>Spark · ₿ ${n(1200)}</small>`))
  assert.match(html, /data-icon="tabler:chevron-down"/)
  assert.doesNotMatch(html, /role="listbox"/)
  assert.doesNotMatch(html, /pay-with-reason/)
})

test('the legacy sats format and an unknown balance read correctly', async () => {
  walletState.useBip177Format = false
  try {
    const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'lnb' })
    assert.match(html, /<small>LNbits<\/small>/, 'no balance known: just the type')
    const biz = await render(PayWithField, { wallets: WALLETS, modelValue: 'biz' })
    assert.ok(biz.includes(`<small>Spark · ${n(1200)} sats</small>`))
  } finally {
    walletState.useBip177Format = true
  }
})

test('the wallet type picks the icon tile', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'biz' }, { data: { open: true } })
  const icons = [...html.matchAll(/data-icon="(tabler:[a-z-]+)"/g)].map((m) => m[1])
  // field tile + chevron, then one tile per row (spark, spark, nwc, lnbits, arkade) and the check
  assert.ok(icons.includes('tabler:plug-connected'), 'nwc')
  assert.ok(icons.includes('tabler:server'), 'lnbits')
  assert.ok(icons.filter((i) => i === 'tabler:wallet').length >= 4, 'spark + arkade use the wallet glyph')
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
  assert.match(html, /<small class="pay-with-reason">Lightning unavailable<\/small>/)
  assert.equal((html.match(/data-icon="tabler:check"/g) || []).length, 1, 'one check mark, on the selected row')
  // 44 pt: the rows are real buttons, the sheet sizes them in CSS (asserted below)
  assert.ok(options.every((o) => o.includes('type="button"')))
})

test('the reason names the rail of the payment', async () => {
  const wallets = [
    entry({ id: 'biz' }),
    entry({ id: 'alby', name: 'Alby Hub', type: 'nwc', isActive: false, usable: false, reason: 'unsupported-destination' }),
  ]
  const render1 = (destinationType) => render(PayWithField, { wallets, modelValue: 'biz', destinationType }, { data: { open: true } })
  assert.match(await render1('lightning_invoice'), /Lightning unavailable/)
  assert.match(await render1('spark_address'), /Spark wallets only/)
  assert.match(await render1('arkade_address'), /Arkade wallets only/)
  assert.match(await render1('bitcoin_address'), /Spark or Arkade only/)
  assert.match(await render1(undefined), /Lightning unavailable/)
})

test('balance and availability reasons are worded too', async () => {
  const wallets = [
    entry({ id: 'biz' }),
    entry({ id: 'p', name: 'Personal', isActive: false, usable: false, reason: 'insufficient-balance' }),
    entry({ id: 'n', name: 'Alby', type: 'nwc', isActive: false, usable: false, reason: 'unavailable' }),
  ]
  const html = await render(PayWithField, { wallets, modelValue: 'biz' }, { data: { open: true } })
  assert.match(html, /Not enough balance/)
  assert.match(html, /<small class="pay-with-reason">Unavailable<\/small>/)
})

test('a selected wallet that cannot pay shows its reason in the collapsed field', async () => {
  const html = await render(PayWithField, { wallets: WALLETS, modelValue: 'ark' })
  assert.match(html, /class="[^"]*pay-with-field--blocked[^"]*"/)
  assert.match(html, /<small class="pay-with-reason">Lightning unavailable<\/small>/)
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
    wallets: WALLETS, modelValue: 'biz', disabled: false, destinationType: 'lightning_invoice', open: false,
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
  payingDestinationType: 'lightning_address',
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
