/**
 * "Refunds to" - the row and the sheet that hosts it.
 *
 * The real templates are compiled (SSR) and rendered, the real scripts run
 * with their imports stubbed, so these tests read the actual markup and the
 * actual component logic:
 *   - collapsed: label, the exact address (shortened in the middle), the
 *     state a screen reader hears, the warning when one is needed or refused
 *   - expanded: a listbox of choices only, each address written out, the
 *     chosen one checked and the one Tab lands on, declining only where the
 *     store allows it, one field for another address, who keeps it
 *   - picking: an address, a typed one (checked first), declining; nothing
 *     while the payment is in flight
 *   - the sheet: one group with the fee, and the commit control held while
 *     an address is needed, refused, or details are asked that BuhoGO never
 *     shares
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
import * as refundAddress from '../../utils/refundAddress.js'
import * as lud18 from '../../utils/lud18.js'

const sfc = createRequire(import.meta.url)('@vue/compiler-sfc')
const t = (key, values = {}) => key.replace(/\{'@'\}/g, '@').replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)

const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }
const walletState = { useBip177Format: true, getDisplayBalance: () => ({ known: true, balance: 1, outdated: false, refreshing: false }), fiatValueOf: () => null }
const deps = {
  '@iconify/vue': { Icon },
  '../utils/refundAddress.js': refundAddress,
  '../utils/lud18.js': lud18,
  './WalletBrandMark.vue': { render() { return Vue.h('i') } },
  './HiddenAmount.vue': { render() { return Vue.h('span', {}, this.$slots.default?.()) } },
  '../directives/balanceUpdating.js': {},
  pinia: { mapState: (_store, keys) => Object.fromEntries(keys.map((key) => [key, function () { return walletState[key] }])) },
  '../stores/wallet': { useWalletStore: () => walletState },
  '../providers/WalletFactory': { WALLET_TYPE_LABELS: { spark: 'Spark', nwc: 'NWC', lnbits: 'LNbits', arkade: 'Arkade' } },
  '../utils/amountFormatting.js': amountFormatting,
  '../utils/payingWallets.js': payingWallets,
  '../utils/fiatCurrencies.js': { FIAT_SYMBOLS: {} },
  '../utils/fiatRates.js': { fiatRatesService: {} },
}

function run(code, extra = {}) {
  const { code: cjs } = transformSync(code, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', cjs)((name) => (name in extra ? extra[name] : deps[name] || {}), module, module.exports)
  return module.exports
}

function load(file, extra = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const { descriptor } = sfc.parse(source)
  const component = run(descriptor.script.content, extra).default
  const { code, errors } = sfc.compileTemplate({ source: descriptor.template.content, filename: file, id: 'test', ssr: true, ssrCssVars: descriptor.cssVars })
  assert.deepEqual(errors, [])
  component.ssrRender = run(code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender
  return component
}

const RefundAddressField = load('../RefundAddressField.vue')
const PayWithField = load('../PayWithField.vue')
const ConfirmSheet = load('../PaymentConfirmSheet.vue', { './PayWithField.vue': PayWithField, './RefundAddressField.vue': RefundAddressField })

async function render(component, props, { data } = {}) {
  const options = data ? { ...component, data: () => ({ ...(component.data?.() || {}), ...data }) } : component
  const app = Vue.createSSRApp(options, props)
  app.config.globalProperties.$t = t
  app.config.globalProperties.$q = { dark: { isActive: false }, screen: { lt: { sm: false } } }
  app.config.warnHandler = () => {}
  app.directive('touch-swipe', {})
  const shell = (tag) => ({ inheritAttrs: false, render() { return Vue.h(tag, {}, this.$slots.default?.()) } })
  for (const name of ['q-dialog', 'q-card', 'q-btn', 'q-spinner-dots']) app.component(name, shell('div'))
  app.component('Icon', Icon)
  return ServerRenderer.renderToString(app)
}

// An address's domain sits in its own span (it never breaks): read joined.
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<span class="refund-option-domain">([^<]*)<\/span>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
/** The class list of the refund row's button. */
const rowClasses = (html) => html.match(/<button[^>]*class="([^"]*\brefund-row\b[^"]*)"/)[1].split(/\s+/)
const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6w6x'
const OPTIONS = [
  { address: 'maria@spark.example', source: 'wallet', walletId: 'biz', name: 'Business' },
  { address: `${NPUB}@npub.cash`, source: 'bucket' },
  { address: 'typed@else.example', source: 'entered' },
]
const row = (over = {}) => ({
  purpose: 'refund', options: OPTIONS, selected: 'maria@spark.example', required: false, canDecline: true,
  declined: false, problem: null, refusedAddress: null, holder: 'MoneyBadger', ...over,
})

// ── The row, collapsed ─────────────────────────────────────────────────

test('collapsed: the label, the exact address and a closed list', async () => {
  const html = await render(RefundAddressField, { refund: row() })
  assert.match(text(html), /^Refunds to maria@spark\.example$/)
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /data-icon="tabler:chevron-down"/)
  assert.doesNotMatch(html, /refund-row--warn|refund-hint|role="listbox"/)
})

test('a long address is shortened in the middle, the domain kept whole', async () => {
  const html = await render(RefundAddressField, { refund: row({ selected: `${NPUB}@npub.cash` }) })
  assert.match(text(html), /npub1q…6w6x@npub\.cash/)
})

test('the screen reader hears the label with the whole address, and the reason when there is one', async () => {
  const long = await render(RefundAddressField, { refund: row({ selected: `${NPUB}@npub.cash` }) })
  assert.match(long, new RegExp(`aria-label="Refunds to, ${NPUB}@npub\\.cash"`), 'never the shortened one')
  const html = await render(RefundAddressField, { refund: row({ required: true, canDecline: false, selected: null, options: [] }) })
  assert.match(html, /aria-label="Refunds to, Add an address"/)
  const described = html.match(/aria-describedby="([^"]+)"/)[1]
  assert.match(html, new RegExp(`id="${described}"[^>]*role="status"`))
})

test('elsewhere the row says it is your address', async () => {
  const html = await render(RefundAddressField, { refund: row({ purpose: 'identify', canDecline: false, required: true }) })
  assert.match(text(html), /^Your address maria@spark\.example$/)
})

test('declined reads "No address"; nothing to offer and needed reads "Add an address", with the reason', async () => {
  assert.match(text(await render(RefundAddressField, { refund: row({ selected: null, declined: true }) })), /^Refunds to No address$/)
  const store = await render(RefundAddressField, { refund: row({ selected: null, options: [], required: true, canDecline: false }) })
  assert.match(store, /refund-row--warn/)
  assert.match(text(store), /Refunds to Add an address This store needs a refund address\./)
  const other = await render(RefundAddressField, { refund: row({ purpose: 'identify', selected: null, options: [], required: true, canDecline: false }) })
  assert.match(text(other), /This recipient needs your address\./)
})

test('a store that turned down the address says so on the row, in any case it was written', async () => {
  for (const refusedAddress of ['maria@spark.example', 'MARIA@Spark.Example']) {
    const html = await render(RefundAddressField, { refund: row({ problem: 'refused', refusedAddress }) })
    assert.match(html, /refund-row--warn/, refusedAddress)
    assert.match(text(html), /This address can't receive refunds\. Choose another\./)
  }
})

test('the warning goes once another address is on the row', async () => {
  // Pay with another wallet, or a pick: the refused address is no longer the one that goes.
  const html = await render(RefundAddressField, { refund: row({ problem: 'refused', refusedAddress: 'other@spark.example' }) })
  assert.doesNotMatch(html, /refund-row--warn|refund-hint/)
})

test('a service that asked for an address after all waits for a pick, then is quiet', async () => {
  const waiting = await render(RefundAddressField, { refund: row({ problem: 'required', required: true, canDecline: false, selected: null }) })
  assert.match(waiting, /refund-row--warn/)
  assert.match(text(waiting), /Refunds to Add an address This store needs a refund address\./)
  const picked = await render(RefundAddressField, { refund: row({ problem: 'required', required: true, canDecline: false, selected: 'maria@spark.example' }) })
  assert.doesNotMatch(picked, /refund-row--warn|refund-hint/)
})

test('the row joins the fee above it, or stands on its own', async () => {
  assert.ok(rowClasses(await render(RefundAddressField, { refund: row(), joined: true })).includes('refund-row--joined'))
  assert.doesNotMatch(await render(RefundAddressField, { refund: row() }), /refund-row--joined/)
})

test('a disabled row cannot be opened', async () => {
  assert.match(await render(RefundAddressField, { refund: row(), disabled: true }), /<button[^>]*\brefund-row\b[^>]*disabled/)
})

// ── The row, expanded ──────────────────────────────────────────────────

test('expanded: each address once with where it comes from, the chosen one checked', async () => {
  const html = await render(RefundAddressField, { refund: row() }, { data: { open: true } })
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /role="listbox"/)
  const options = html.match(/role="option"/g)
  assert.equal(options.length, 4, 'three addresses and "No refund address"')
  assert.equal(html.match(/aria-selected="true"/g).length, 1)
  assert.equal(html.match(/data-icon="tabler:check"/g).length, 1)
  const words = text(html)
  for (const line of ['maria@spark.example Business', `${NPUB}@npub.cash Social Bucket`, 'typed@else.example Just for this payment',
    'No refund address A refund may not reach you', 'Use another address', 'MoneyBadger keeps this address with your payment to send any refund.']) {
    assert.ok(words.includes(line), line)
  }
})

test('a long address wraps in its name, never inside its domain', async () => {
  const html = await render(RefundAddressField, { refund: row() }, { data: { open: true } })
  assert.match(html, new RegExp(`>${NPUB}<span class="refund-option-domain">@npub\\.cash</span></strong>`))
  assert.match(html, /<strong class="refund-option-address">maria<span class="refund-option-domain">@spark\.example<\/span><\/strong>/)
  const long = `name@${'very-long-domain-'.repeat(2)}example.com`
  const wide = await render(RefundAddressField, { refund: row({ options: [{ address: long, source: 'entered' }], selected: long }) }, { data: { open: true } })
  assert.ok(wide.replace(/<!--[\s\S]*?-->/g, '').includes(`<strong class="refund-option-address">${long}</strong>`), 'a domain too long for a line wraps with the name')
})

test('the listbox holds only the choices: "Use another address" is an action after it', async () => {
  const html = await render(RefundAddressField, { refund: row() }, { data: { open: true } })
  const listbox = html.match(/<div[^>]*role="listbox"[^>]*>/)[0]
  const foot = listbox.match(/aria-describedby="([^"]+)"/)[1]
  assert.match(html, new RegExp(`<p id="${foot}" class="refund-foot"`), 'the list is described by who keeps the address')
  const between = html.slice(html.lastIndexOf('role="option"'), html.indexOf('refund-option--action'))
  assert.match(between, /<\/div>/, 'the listbox closes before the action')
  assert.doesNotMatch(html.match(/<button[^>]*refund-option--action[^>]*>/)[0], /role=|tabindex/)
})

test('Tab lands on one choice: the chosen one, "No refund address" when declined, else the first', async () => {
  const tabStops = (html) => [...html.matchAll(/<button[^>]*role="option"[^>]*>/g)].map((m) => /tabindex="0"/.test(m[0]))
  assert.deepEqual(tabStops(await render(RefundAddressField, { refund: row({ selected: 'typed@else.example' }) }, { data: { open: true } })), [false, false, true, false])
  assert.deepEqual(tabStops(await render(RefundAddressField, { refund: row({ selected: null, declined: true }) }, { data: { open: true } })), [false, false, false, true])
  assert.deepEqual(tabStops(await render(RefundAddressField, { refund: row({ selected: null, required: true, canDecline: false }) }, { data: { open: true } })), [true, false, false])
})

test('where an address is needed there is no way to decline', async () => {
  const html = await render(RefundAddressField, { refund: row({ required: true, canDecline: false }) }, { data: { open: true } })
  assert.doesNotMatch(text(html), /No refund address/)
  assert.equal(html.match(/role="option"/g).length, 3)
})

test('the refused address is marked in the list', async () => {
  const html = await render(RefundAddressField, { refund: row({ problem: 'refused', refusedAddress: 'maria@spark.example' }) }, { data: { open: true } })
  assert.match(text(html), /maria@spark\.example Can't receive refunds/)
  assert.match(html, /refund-option-warn/)
})

test('elsewhere the footer names the service that asks', async () => {
  const html = await render(RefundAddressField, { refund: row({ purpose: 'identify', canDecline: false, holder: 'coffee.example' }) }, { data: { open: true } })
  assert.match(text(html), /coffee\.example asks for your address with this payment\./)
})

test('typing another address: one email field that does not zoom, and its error', async () => {
  const html = await render(RefundAddressField, { refund: row() }, { data: { open: true, typing: true, draftInvalid: true } })
  const input = html.match(/<input[^>]*>/)[0]
  for (const attr of ['type="email"', 'inputmode="email"', 'maxlength="320"', 'autocapitalize="off"', 'spellcheck="false"', 'aria-invalid="true"', 'aria-label="Another address"']) {
    assert.ok(input.includes(attr), attr)
  }
  assert.doesNotMatch(text(html), /Use another address Use another address/, 'the action hides while typing')
  assert.match(html, /role="alert"[^>]*>\s*Enter an address like name@example\.com\./)
})

test('markup contract: touch targets, no zoom, tokens, reduced motion', () => {
  const source = readFileSync(new URL('../RefundAddressField.vue', import.meta.url), 'utf8')
  assert.match(source, /\.refund-row \{[^}]*min-height: 44px/)
  assert.match(source, /\.refund-option \{[^}]*min-height: 52px/)
  assert.match(source, /\.refund-entry-use \{[^}]*min-height: 44px/)
  assert.match(source, /\.refund-entry input \{[^}]*font-size: 16px/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(source, /prefers-reduced-motion: reduce\)'\)\?\.matches/, 'the list scrolls into view without motion then')
  assert.match(source, /\.refund-option-address \{[^}]*overflow-wrap: anywhere/, 'a long address wraps in the list')
  assert.match(source, /\.refund-option-domain \{[^}]*white-space: nowrap/, 'its domain stays whole')
  for (const token of ['--bg-input', '--bg-card', '--border-card', '--text-primary', '--text-secondary', '--brand-accent-text', '--color-warn']) {
    assert.ok(source.includes(`var(${token})`), token)
  }
})

// ── The row, behaviour ─────────────────────────────────────────────────

function fieldVm(props = {}) {
  const emitted = []
  const focused = []
  const vm = {
    ...RefundAddressField.methods, ...RefundAddressField.data(),
    refund: row(), disabled: false, joined: false, $: { uid: 1 },
    $t: t, $emit: (...args) => emitted.push(args), $nextTick: (fn) => fn?.(),
    $refs: { row: { focus: () => focused.push('row') }, draft: { focus: () => focused.push('draft') } },
    $el: { querySelector: () => ({ focus: () => focused.push('option'), scrollIntoView() {} }) },
    ...props,
  }
  for (const name of Object.keys(RefundAddressField.computed)) {
    Object.defineProperty(vm, name, { get: () => RefundAddressField.computed[name].call(vm), configurable: true })
  }
  return { vm, emitted, focused }
}

test('picking an address reports it and closes, focus back on the row', () => {
  const { vm, emitted, focused } = fieldVm()
  vm.toggle()
  assert.equal(vm.open, true)
  vm.pickAddress('typed@else.example')
  assert.deepEqual(emitted, [['pick', { address: 'typed@else.example' }]])
  assert.equal(vm.open, false)
  assert.equal(focused.at(-1), 'row')
})

test('declining is reported only where the store allows it', () => {
  const allowed = fieldVm()
  allowed.vm.decline()
  assert.deepEqual(allowed.emitted, [['pick', { declined: true }]])
  const needed = fieldVm({ refund: row({ canDecline: false, required: true }) })
  needed.vm.decline()
  assert.deepEqual(needed.emitted, [])
})

test('a typed address is checked before it is reported, and goes as written, trimmed', () => {
  const { vm, emitted } = fieldVm({ open: true, typing: true })
  for (const draft of ['', 'maria', 'maria@', 'maria smith@x.example', 'https://x.example']) {
    vm.draft = draft
    vm.useDraft()
    assert.equal(vm.draftInvalid, true, draft)
  }
  assert.deepEqual(emitted, [])
  vm.draft = '  Maria@Else.Example '
  vm.useDraft()
  assert.deepEqual(emitted, [['pick', { address: 'Maria@Else.Example', entered: true }]])
  assert.equal(vm.open, false)
  assert.equal(vm.draft, '', 'nothing typed is kept')
})

test('with nothing to offer and no way to decline, the tap opens the field', () => {
  const { vm, focused } = fieldVm({ refund: row({ options: [], canDecline: false, required: true, selected: null }) })
  vm.toggle()
  assert.equal(vm.typing, true)
  assert.equal(focused.at(-1), 'draft')
  vm.stopTyping()
  assert.equal(vm.open, false, 'Escape there closes the row')
})

test('Escape in the field goes back to the list when there is one', () => {
  const { vm } = fieldVm({ open: true, typing: true, draft: 'half@' })
  vm.stopTyping()
  assert.deepEqual([vm.open, vm.typing, vm.draft], [true, false, ''])
})

test('while the payment is in flight nothing opens or is picked, and an open list closes', () => {
  const { vm, emitted } = fieldVm({ disabled: true })
  vm.toggle()
  vm.pickAddress('typed@else.example')
  vm.decline()
  assert.equal(vm.open, false)
  assert.deepEqual(emitted, [])
  const open = fieldVm({ open: true, typing: true })
  RefundAddressField.watch.disabled.call(open.vm, true)
  assert.deepEqual([open.vm.open, open.vm.typing], [false, false])
})

test('arrow keys move through the list, Escape closes it', () => {
  const items = [0, 1, 2].map((i) => ({ i, focus() { globalThis.document.activeElement = this } }))
  globalThis.document = { activeElement: items[0] }
  const { vm } = fieldVm({ open: true, $el: { querySelectorAll: () => items, querySelector: () => null } })
  const press = (key) => {
    let prevented = false
    vm.onListKeydown({ key, preventDefault: () => { prevented = true }, stopPropagation() {} })
    return prevented
  }
  try {
    assert.equal(press('ArrowDown'), true); assert.equal(document.activeElement.i, 1)
    assert.equal(press('End'), true); assert.equal(document.activeElement.i, 2)
    assert.equal(press('ArrowDown'), true); assert.equal(document.activeElement.i, 0, 'wraps')
    assert.equal(press('ArrowUp'), true); assert.equal(document.activeElement.i, 2, 'wraps')
    assert.equal(press('Home'), true); assert.equal(document.activeElement.i, 0)
    assert.equal(press('x'), false)
    assert.equal(press('Escape'), true)
    assert.equal(vm.open, false)
  } finally {
    delete globalThis.document
  }
})

// ── The sheet ──────────────────────────────────────────────────────────

const sheetProps = (payment = {}) => ({
  modelValue: true,
  payment: { recipient: { name: 'Pick n Pay', address: 'till@cryptoqr.net' }, amount: { mode: 'fixed', fixedSats: 1000 }, ...payment },
})

test('the refund row sits right under the network fee, the two as one group', async () => {
  const html = await render(ConfirmSheet, sheetProps({ feeEstimate: { sats: 3 }, refund: row() }))
  const group = html.indexOf('class="fact-group"')
  assert.ok(group > 0)
  assert.match(html, /class="fee-row fee-row--joined"/)
  assert.ok(html.indexOf('fee-row') < html.indexOf('refund-row'))
  assert.ok(rowClasses(html).includes('refund-row--joined'))
})

test('without a fee row the refund row stands alone; without either there is no group', async () => {
  const alone = await render(ConfirmSheet, sheetProps({ refund: row() }))
  assert.match(alone, /class="fact-group"/)
  assert.doesNotMatch(alone, /refund-row--joined|fee-row--joined/)
  const feeOnly = await render(ConfirmSheet, sheetProps({ feeEstimate: { sats: 3 } }))
  assert.match(feeOnly, /class="fee-row"/)
  assert.doesNotMatch(feeOnly, /refund-row/)
  assert.doesNotMatch(await render(ConfirmSheet, sheetProps()), /fact-group/)
})

test('a service that requires details BuhoGO never shares holds the payment, with the reason', async () => {
  const html = await render(ConfirmSheet, sheetProps({ payerBlocked: true }))
  assert.match(text(html), /This service asks for details BuhoGO can't share\. Ask them for another way to pay\./)
  assert.match(html, /class="primary-cta"[^>]*disabled/)
})

test('a needed address that is missing, or the one just refused, holds the payment', async () => {
  for (const refund of [
    row({ required: true, canDecline: false, selected: null, options: [] }),
    row({ problem: 'refused', refusedAddress: 'maria@spark.example' }),
  ]) {
    assert.match(await render(ConfirmSheet, sheetProps({ refund })), /class="primary-cta"[^>]*disabled/, JSON.stringify(refund))
  }
  for (const refund of [row(), row({ selected: null, declined: true }), row({ problem: 'refused', refusedAddress: 'maria@spark.example', selected: 'typed@else.example' })]) {
    assert.doesNotMatch(await render(ConfirmSheet, sheetProps({ refund })), /class="primary-cta"[^>]*disabled/, JSON.stringify(refund))
  }
})

test('canSubmit: every hold, on its own', () => {
  const vm = (payment) => {
    const self = { payment, walletCanPay: true, isAmountAcceptable: true, commitGate: true, recipientChecking: false }
    for (const name of ['refundRow', 'payerBlocked', 'refundHolds']) {
      Object.defineProperty(self, name, { get: () => ConfirmSheet.computed[name].call(self) })
    }
    return ConfirmSheet.computed.canSubmit.call(self)
  }
  assert.equal(vm({}), true)
  assert.equal(vm({ refund: row() }), true)
  assert.equal(vm({ payerBlocked: true }), false)
  assert.equal(vm({ payerBlocked: 'yes' }), true, 'only a real true holds')
  assert.equal(vm({ refund: row({ required: true, selected: null }) }), false)
  assert.equal(vm({ refund: row({ refusedAddress: 'maria@spark.example' }) }), false)
  assert.equal(vm({ refund: row({ refusedAddress: ' MARIA@spark.example' }) }), false, 'in any case')
  assert.equal(vm({ refund: row({ refusedAddress: 'other@spark.example' }) }), true)
  assert.equal(vm({ refund: 'nonsense' }), true, 'a malformed row is no row')
})

test('the short-phone spacing applies only to a sheet with the refund row', async () => {
  assert.match(await render(ConfirmSheet, sheetProps({ refund: row() })), /class="stage stage-compose stage--refund"/)
  assert.doesNotMatch(await render(ConfirmSheet, sheetProps()), /stage--refund/)
  const source = readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8')
  const short = source.match(/@media \(max-height: 600px\) \{([\s\S]*?)\n\}/)[1]
  for (const rule of short.split('\n').filter((line) => line.includes('{'))) assert.match(rule, /^\s*\.stage--refund/, rule)
})

test('the sheet forwards the refund pick, except mid-send or once done', () => {
  const emitted = []
  const vm = { isSending: false, isComplete: false, $emit: (...args) => emitted.push(args) }
  ConfirmSheet.methods.onRefundPick.call(vm, { address: 'typed@else.example' })
  vm.isSending = true
  ConfirmSheet.methods.onRefundPick.call(vm, { declined: true })
  vm.isSending = false
  vm.isComplete = true
  ConfirmSheet.methods.onRefundPick.call(vm, { declined: true })
  assert.deepEqual(emitted, [['refund-pick', { address: 'typed@else.example' }]])
  assert.ok(ConfirmSheet.emits.includes('refund-pick'))
})
