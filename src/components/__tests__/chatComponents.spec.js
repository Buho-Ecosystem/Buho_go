/**
 * Contact chat components (src/components/chat/*).
 *
 * Same approach as payWithField.spec.js: the real templates are compiled (SSR)
 * and rendered, the real scripts run with their imports stubbed, so these
 * tests read the actual markup and the actual component logic:
 *   - chatFormat helpers: day separators, initials, npub fragment, counting
 *   - header: three real buttons, the honest second line
 *   - bubble: delivery states, retry, degraded, reactions, long press
 *   - request card: states, actions by side, disabled reason, no invoice row
 *   - money bar, composer, request sheet, wallet field, banner, thread
 *   - style contract: 44 pt targets and the reduced-motion rule
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as ServerRenderer from 'vue/server-renderer'
import * as amountFormatting from '../../utils/amountFormatting.js'
import * as constants from '../../services/dm/constants.js'

const sfc = createRequire(import.meta.url)('@vue/compiler-sfc')

// ── harness ──────────────────────────────────────────────────────────

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
const n = (value) => value.toLocaleString()

const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }

function run(code, extra = {}, deps = {}) {
  const { code: cjs } = transformSync(code, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', cjs)(name => (name in extra ? extra[name] : deps[name] || {}), module, module.exports)
  return module.exports
}

const read = (file) => readFileSync(new URL(`../chat/${file}`, import.meta.url), 'utf8')

/** A plain module of the chat folder, with its imports stubbed. */
function loadJs(file, deps = {}) {
  return run(read(file), {}, deps)
}

/** Script options, plus an SSR render function compiled from the real template. */
function loadSfc(file, deps = {}) {
  const { descriptor } = sfc.parse(read(file))
  const component = run(descriptor.script.content, {}, deps).default
  const { code, errors } = sfc.compileTemplate({ source: descriptor.template.content, filename: file, id: file, ssr: true })
  assert.deepEqual(errors, [])
  component.ssrRender = run(code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender
  return component
}

const chatFormat = loadJs('chatFormat.js', { '../../utils/amountFormatting.js': amountFormatting, '../../services/dm/constants.js': constants })
const base = { '@iconify/vue': { Icon }, './chatFormat.js': chatFormat }

const ChatHeader = loadSfc('ChatHeader.vue', base)
const DaySeparator = loadSfc('DaySeparator.vue', base)
const PaymentLine = loadSfc('PaymentLine.vue', base)
const MessageMenu = loadSfc('MessageMenu.vue', base)
const MessageBubble = loadSfc('MessageBubble.vue', { ...base, './MessageMenu.vue': MessageMenu })
const RequestCard = loadSfc('RequestCard.vue', base)
const MoneyBar = loadSfc('MoneyBar.vue', base)
const Composer = loadSfc('Composer.vue', { ...base, '../../services/dm/constants.js': constants })
const RequestSheet = loadSfc('RequestSheet.vue', { ...base, '../../services/dm/constants.js': constants })
const UnknownSenderBanner = loadSfc('UnknownSenderBanner.vue', base)
const SignerAppNotice = loadSfc('SignerAppNotice.vue', base)
const ChatThread = loadSfc('ChatThread.vue', {
  ...base, './DaySeparator.vue': DaySeparator, './MessageBubble.vue': MessageBubble, './PaymentLine.vue': PaymentLine, './RequestCard.vue': RequestCard,
})

async function render(component, props = {}, { slots, data } = {}) {
  const options = data ? { ...component, data: () => ({ ...(component.data?.() || {}), ...data }) } : component
  const app = Vue.createSSRApp({ render: () => Vue.h(options, props, slots) })
  app.config.globalProperties.$t = t
  app.config.warnHandler = () => {}
  const shell = (tag) => ({ inheritAttrs: false, render() { return Vue.h(tag, {}, this.$slots.default?.()) } })
  app.component('q-dialog', shell('div'))
  return ServerRenderer.renderToString(app)
}

/**
 * A component instance stand-in for logic tests: props, data, methods and
 * computeds as plain properties, `$emit` recorded.
 */
function vmOf(component, props = {}, extra = {}) {
  const emitted = []
  const defaults = Object.fromEntries(
    Object.entries(component.props || {}).map(([key, spec]) => {
      const d = spec?.default
      return [key, typeof d === 'function' && spec.type !== Function ? d() : d]
    }),
  )
  const vm = {
    ...defaults, ...(component.data?.call({}) || {}), ...component.methods, ...props,
    $t: t, $: { uid: 1 }, $emit: (...args) => emitted.push(args), $nextTick: (fn) => fn?.(), $refs: {},
    ...extra,
  }
  for (const [name, getter] of Object.entries(component.computed || {})) {
    Object.defineProperty(vm, name, { get: () => getter.call(vm), configurable: true })
  }
  return { vm, emitted }
}

const tags = (html, selector) => html.match(new RegExp(`<[a-z]+[^>]*${selector}[^>]*>`, 'g')) || []
const NOW = Math.floor(Date.now() / 1000)

// ── chatFormat ───────────────────────────────────────────────────────

test('initials: first and last word, whole code points, never empty', () => {
  assert.equal(chatFormat.initialsOf('Anna'), 'A')
  assert.equal(chatFormat.initialsOf('anna muster'), 'AM')
  assert.equal(chatFormat.initialsOf('Hans Peter Meier'), 'HM')
  assert.equal(chatFormat.initialsOf('  '), '?')
  assert.equal(chatFormat.initialsOf(undefined), '?')
  assert.equal(chatFormat.initialsOf('🦉 Owl'), '🦉O')
})

test('an npub is shortened to a fragment, never shown whole', () => {
  const npub = `npub1${'q'.repeat(58)}`
  const short = chatFormat.shortNpub(npub)
  assert.match(short, /^npub1qqqqqq….{5}$/)
  assert.ok(short.length < npub.length / 2)
  assert.equal(chatFormat.shortNpub('npub1short'), 'npub1short')
})

test('lengths are counted in code points', () => {
  assert.equal(chatFormat.countChars('abc'), 3)
  assert.equal(chatFormat.countChars('😀😀'), 2)
  assert.equal(chatFormat.countChars(''), 0)
})

test('amounts follow the BIP-177 setting', () => {
  assert.equal(chatFormat.formatSats(5000, true), `₿ ${n(5000)}`)
  assert.equal(chatFormat.formatSats(5000, false), `${n(5000)} sats`)
  assert.equal(chatFormat.formatSats(NaN, true), '₿ 0')
})

test('day separators open every calendar day once and are idempotent', () => {
  const day = 86400
  const noon = Math.floor(new Date().setHours(12, 0, 0, 0) / 1000)
  const items = [
    { key: 'a', type: 'message', ts: noon - day },
    { key: 'b', type: 'message', ts: noon - day + 60 },
    { key: 'c', type: 'message', ts: noon },
  ]
  const out = chatFormat.insertDaySeparators(items)
  assert.deepEqual(out.map((i) => i.type), ['day', 'message', 'message', 'day', 'message'])
  assert.deepEqual(chatFormat.insertDaySeparators(out).map((i) => i.key), out.map((i) => i.key))
  assert.deepEqual(chatFormat.insertDaySeparators([]), [])
})

test('"valid until" is a clock time today and a date otherwise', () => {
  const today = chatFormat.formatWhen(NOW + 60)
  assert.equal(today, chatFormat.formatClock(NOW + 60))
  assert.notEqual(chatFormat.formatWhen(NOW + 5 * 86400), chatFormat.formatClock(NOW + 5 * 86400))
  assert.equal(chatFormat.formatWhen(NaN), '')
  // The app's language decides, not the device's.
  const march = Date.UTC(2026, 2, 12, 12) / 1000
  assert.match(chatFormat.formatWhen(march, NOW * 1000, 'de'), /März/)
  assert.match(chatFormat.formatWhen(march, NOW * 1000, 'es'), /mar/)
  assert.match(chatFormat.formatWhen(march, NOW * 1000, 'en-US'), /Mar/)
})

// ── ChatHeader ───────────────────────────────────────────────────────

test('header: back, one name button, menu; each a real, labelled 44 pt button', async () => {
  const html = await render(ChatHeader, { name: 'Anna' })
  const buttons = html.match(/<button[^>]*>/g)
  assert.equal(buttons.length, 3)
  assert.ok(buttons.every((b) => b.includes('type="button"')))
  assert.match(html, /aria-label="Back"/)
  assert.match(html, /aria-label="Open contact: Anna"/)
  assert.match(html, /aria-label="More options"/)
  assert.match(html, /aria-haspopup="menu"/)
  assert.match(html, /chat-header__initials">A</, 'no picture: initials')
})

test('header: the second line is honest about the thread', async () => {
  const secure = await render(ChatHeader, { name: 'Anna' })
  assert.match(secure, /End-to-end encrypted/)
  assert.match(secure, /data-icon="tabler:lock"/)
  const payOnly = await render(ChatHeader, { name: 'Anna', paymentsOnly: true })
  assert.match(payOnly, /Payments only/)
  assert.doesNotMatch(payOnly, /End-to-end/)
  const unknown = await render(ChatHeader, { name: 'Anna', paymentsOnly: true, unknown: true })
  assert.match(unknown, /Not in your contacts/)
  assert.match(unknown, /chat-header__sub--danger/)
})

test('header: a picture replaces the initials, and the avatar slot replaces both', async () => {
  const withImage = await render(ChatHeader, { name: 'Anna', avatarUrl: 'https://x/y.png' })
  assert.match(withImage, /<img src="https:\/\/x\/y.png" alt=""/)
  const slotted = await render(ChatHeader, { name: 'Anna' }, { slots: { avatar: () => Vue.h('b', 'SLOT') } })
  assert.match(slotted, /<b>SLOT<\/b>/)
  assert.doesNotMatch(slotted, /chat-header__initials/)
})

test('header: the buttons report back, profile and menu', () => {
  const { emitted } = vmOf(ChatHeader, { name: 'Anna' })
  assert.deepEqual(ChatHeader.emits, ['back', 'open-profile', 'menu'])
  assert.deepEqual(emitted, [])
})

// ── DaySeparator / PaymentLine ───────────────────────────────────────

test('day separator: Today, Yesterday, then a date; a named separator', async () => {
  const today = await render(DaySeparator, { ts: NOW })
  assert.match(today, /role="separator" aria-label="Today"/)
  const yesterday = await render(DaySeparator, { ts: NOW - 86400 })
  assert.match(yesterday, /aria-label="Yesterday"/)
  const old = await render(DaySeparator, { ts: NOW - 40 * 86400 })
  assert.doesNotMatch(old, /Today|Yesterday/)
  assert.match(old, /aria-label="[^"]+"/)
})

test('payment line: direction, amount, note, one button that opens the details', async () => {
  const out = await render(PaymentLine, { outgoing: true, amountSats: 5000, note: 'Coffee' })
  assert.match(out, /<button type="button"[^>]*class="payment-line"/)
  assert.ok(out.includes(`You sent ₿ ${n(5000)} · Coffee`))
  assert.match(out, /data-icon="tabler:arrow-up-right"/)
  const inc = await render(PaymentLine, { outgoing: false, amountSats: 8000, bip177: false })
  assert.ok(inc.includes(`Received ${n(8000)} sats`))
  assert.doesNotMatch(inc, / · /, 'no note, no separator')
  assert.match(inc, /data-icon="tabler:arrow-down-left"/)
  assert.deepEqual(PaymentLine.emits, ['open'])
})

// ── MessageBubble / MessageMenu ──────────────────────────────────────

test('bubble: incoming and outgoing sit on their own side', async () => {
  const inc = await render(MessageBubble, { text: 'Hi', outgoing: false })
  assert.match(inc, /bubble-row--in/)
  assert.match(inc, /bubble--in/)
  assert.doesNotMatch(inc, /bubble__delivery/, 'incoming messages show no delivery state')
  const out = await render(MessageBubble, { text: 'Hi', outgoing: true })
  assert.match(out, /bubble-row--out/)
  assert.match(out, /bubble--out/)
})

test('bubble: honest delivery states, and no "delivered" or "read"', async () => {
  const states = { queued: 'Waiting to send', sending: 'Sending…', sent: 'Sent', failed: 'Not sent' }
  for (const [delivery, text] of Object.entries(states)) {
    const html = await render(MessageBubble, { text: 'Hi', outgoing: true, delivery })
    assert.match(html, new RegExp(`bubble__delivery--${delivery}[^>]*role="status"`), delivery)
    assert.ok(html.includes(text), delivery)
    assert.doesNotMatch(html, /Delivered|Read/i, delivery)
  }
})

test('bubble: only a failed message offers Send again', async () => {
  const failed = await render(MessageBubble, { text: 'Hi', outgoing: true, delivery: 'failed' })
  assert.match(failed, /<button type="button" class="bubble__retry">\s*Send again/)
  assert.match(failed, /bubble--failed/)
  for (const delivery of ['queued', 'sending', 'sent']) {
    assert.doesNotMatch(await render(MessageBubble, { text: 'Hi', outgoing: true, delivery }), /bubble__retry/)
  }
})

test('bubble: a degraded message is plain text with a note and a dashed outline', async () => {
  const html = await render(MessageBubble, { text: '💸 fallback', degraded: true })
  assert.match(html, /bubble--degraded/)
  assert.match(html, /Shown as plain text/)
  assert.doesNotMatch(await render(MessageBubble, { text: 'x' }), /Shown as plain text/)
})

test('bubble: reply quote, reactions as pressed-state buttons, a spoken label', async () => {
  const html = await render(MessageBubble, {
    text: 'Perfect',
    reply: { author: 'You', text: 'Sounds good' },
    reactions: [{ emoji: '❤️', count: 2, mine: true }, { emoji: '👍', count: 1, mine: false }],
  })
  assert.match(html, /<strong>You<\/strong><span>Sounds good<\/span>/)
  assert.match(html, /role="group" aria-label="Reactions"/)
  const chips = tags(html, 'bubble__reaction"')
  assert.equal(chips.length, 2)
  assert.match(chips[0], /aria-pressed="true"/)
  assert.match(chips[1], /aria-pressed="false"/)
  assert.match(html, /bubble__reaction-count[^>]*>2</)
  assert.match(html, /role="button"[^>]*aria-label="Them: Reply to You: Sounds good. Perfect"/)
  assert.match(await render(MessageBubble, { text: 'Hi', outgoing: true }), /aria-label="You: Hi"/)
})

test('bubble: the spoken reaction label is singular for one, plural otherwise', () => {
  const label = (count) => MessageBubble.methods.reactionLabel.call({ $t: t }, { emoji: '👍', count })
  assert.equal(label(1), '👍 1 reaction')
  assert.equal(label(2), '👍 2 reactions')
  assert.equal(label(undefined), '👍 1 reaction')
})

test('header: the second line may wrap to two lines, the name stays on one', () => {
  const css = read('ChatHeader.vue')
  assert.match(css, /\.chat-header__sub > span \{[^}]*-webkit-line-clamp: 2/)
  assert.match(css, /\.chat-header__name \{[^}]*white-space: nowrap/)
})

test('bubble: strangers get no reactions, but may see existing ones', async () => {
  const html = await render(MessageBubble, { text: 'Hi', canReact: false, reactions: [{ emoji: '👍', count: 1, mine: false }] })
  assert.match(html, /bubble__reaction"[^>]*disabled/)
})

test('bubble: long press opens the menu for touch, never for a mouse, and scrolling cancels it', () => {
  const timers = []
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  globalThis.clearTimeout = (id) => { timers[id - 1].cleared = true }
  try {
    const { vm } = vmOf(MessageBubble, { text: 'Hi' })
    vm.onPointerDown({ pointerType: 'mouse', clientX: 0, clientY: 0 })
    assert.equal(timers.length, 0, 'a mouse uses the context menu')

    vm.onPointerDown({ pointerType: 'touch', clientX: 10, clientY: 10 })
    assert.equal(timers.length, 1)
    assert.ok(timers[0].ms >= 350 && timers[0].ms <= 600)
    vm.onPointerMove({ clientX: 12, clientY: 11 })
    assert.notEqual(timers[0].cleared, true, 'a small wobble keeps the press')
    vm.onPointerMove({ clientX: 10, clientY: 60 })
    assert.equal(timers[0].cleared, true, 'moving is scrolling')
    assert.equal(vm.menuOpen, false)

    vm.onPointerDown({ pointerType: 'pen', clientX: 0, clientY: 0 })
    timers[1].fn()
    assert.equal(vm.menuOpen, true)
    assert.equal(vm.menuMounted, true)
  } finally {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
  }
})

test('bubble: the menu forwards react, reply, copy (with the text) and retry', () => {
  assert.deepEqual(MessageBubble.emits, ['react', 'reply', 'copy', 'retry'])
  const source = read('MessageBubble.vue')
  assert.match(source, /@copy="\$emit\('copy', text\)"/)
  assert.match(source, /:can-retry="outgoing && delivery === 'failed'"/)
})

test('menu: reactions as a pressed-state group, then Reply and Copy; Send again only when failed', async () => {
  const html = await render(MessageMenu, { modelValue: true, myReaction: '❤️' })
  assert.match(html, /role="menu"/)
  const emoji = tags(html, 'message-menu__emoji')
  assert.equal(emoji.length, 5)
  assert.equal(emoji.filter((e) => e.includes('aria-pressed="true"')).length, 1)
  assert.match(html, />\s*Reply|<span>Reply<\/span>/)
  assert.match(html, /<span>Copy text<\/span>/)
  assert.doesNotMatch(html, /Send again/)
  assert.match(await render(MessageMenu, { modelValue: true, canRetry: true }), /<span>Send again<\/span>/)
  assert.doesNotMatch(await render(MessageMenu, { modelValue: true, canReact: false }), /message-menu__emoji/)
})

test('menu: a pick closes the menu first, then reports', () => {
  const { vm, emitted } = vmOf(MessageMenu)
  vm.pick('react', '🙏')
  vm.pick('reply')
  vm.pick('copy')
  assert.deepEqual(emitted, [
    ['update:modelValue', false], ['react', '🙏'],
    ['update:modelValue', false], ['reply'],
    ['update:modelValue', false], ['copy'],
  ])
})

// ── RequestCard ──────────────────────────────────────────────────────

const card = (props, opts) => render(RequestCard, { amountSats: 25000, ...props }, opts)

test('request card: the payer sees Decline and a filled Pay', async () => {
  const html = await card({ partnerName: 'Anna', note: 'Pizza', fiatText: '≈ $15.00' })
  assert.ok(html.includes(`₿ ${n(25000)}`))
  assert.match(html, /Anna requests/)
  assert.match(html, /Pizza/)
  assert.match(html, /≈ \$15.00/)
  const buttons = tags(html, 'request-btn')
  assert.equal(buttons.length, 2)
  assert.match(buttons[0], /request-btn--quiet/)
  assert.match(buttons[1], /request-btn--pay/)
  assert.match(html, />\s*Decline\s*</)
  assert.match(html, />\s*Pay\s*</)
  assert.doesNotMatch(html, /Remind|Cancel request/)
})

test('request card: the requester sees Remind and Cancel request, never Pay', async () => {
  const html = await card({ outgoing: true })
  assert.match(html, /You requested/)
  assert.match(html, />\s*Remind\s*</)
  assert.match(html, />\s*Cancel request\s*</)
  assert.doesNotMatch(html, />\s*Pay\s*<|Decline/)
})

test('request card: after a reminder the button says so and waits a day', async () => {
  const html = await card({ outgoing: true, remindedRecently: true })
  assert.match(html, /<button[^>]*disabled[^>]*>\s*Reminded\s*</)
})

test('request card: a payment still on its way shows that, with nothing to tap', async () => {
  const html = await card({ state: 'paying' })
  assert.match(html, /Payment on its way/)
  assert.doesNotMatch(html, />\s*Pay\s*<|Decline/)
})

test('request card: every end state says so; only pending and expired have actions', async () => {
  const lines = { paid: 'Paid', declined: 'Declined', cancelled: 'Request cancelled', expired: 'Expired' }
  for (const [state, text] of Object.entries(lines)) {
    for (const outgoing of [false, true]) {
      const html = await card({ state, outgoing })
      assert.equal(tags(html, 'request-btn').length, state === 'expired' ? 1 : 0, `${state} ${outgoing}`)
      assert.match(html, new RegExp(`request-card__state[^>]*>[\\s\\S]*${text}`), state)
      assert.match(html, new RegExp(`request-card--${state}`))
    }
  }
  assert.doesNotMatch(await card({}), /request-card__state/)
})

test('request card: an expired request always has a next action (docs 8a)', async () => {
  const payer = await card({ state: 'expired' })
  assert.match(payer, />\s*Send anyway\s*</)
  assert.match(tags(payer, 'request-btn')[0], /request-btn--quiet/, 'an expired request no longer asks: the button is quiet')
  assert.doesNotMatch(payer, /Request again|Decline/)
  const requester = await card({ state: 'expired', outgoing: true })
  assert.match(requester, />\s*Request again\s*</)
  assert.doesNotMatch(requester, /Send anyway|Pay/)
  assert.deepEqual(RequestCard.emits, ['pay', 'decline', 'remind', 'withdraw', 'send-anyway', 'request-again'])
})

test('request card: a paid request of the requester says where it arrived or that it is only reported', async () => {
  const verified = await card({ outgoing: true, state: 'paid', paidVerified: true, receivedIn: 'Spark Business' })
  assert.match(verified, />\s*Paid\s*</)
  assert.match(verified, /Received in Spark Business/)
  const reported = await card({ outgoing: true, state: 'paid', paidVerified: false, receivedIn: 'Spark Business', partnerName: 'Anna' })
  assert.match(reported, /Anna says it(&#39;|')s paid/)
  assert.match(reported, /data-icon="tabler:clock-question"/)
  assert.match(reported, /request-card__state--muted/, 'only the payer says so: no green check')
  assert.doesNotMatch(reported, /circle-check|Received in/)
  assert.doesNotMatch(await card({ outgoing: true, state: 'paid' }), /Received in/, 'unknown wallet: no claim')
  assert.doesNotMatch(await card({ state: 'paid', receivedIn: 'Spark' }), /Received in/, 'the payer has nothing received')

  const byAddress = await card({ outgoing: true, state: 'paid', paidVerified: true, receivedAt: 'alice@getalby.com' })
  assert.match(byAddress, /Received at alice@getalby\.com/)
  assert.doesNotMatch(byAddress, /Received in/)
  const both = await card({ outgoing: true, state: 'paid', paidVerified: true, receivedIn: 'Spark', receivedAt: 'alice@getalby.com' })
  assert.match(both, /Received in Spark/, 'a wallet of the user wins')
  assert.doesNotMatch(await card({ outgoing: true, state: 'paid', paidVerified: false, receivedAt: 'alice@getalby.com' }), /Received at/)
  assert.doesNotMatch(await card({ state: 'paid', receivedAt: 'alice@getalby.com' }), /Received at/, 'the payer has nothing received')
})

test('request card: no "amount in invoice" row, ever', async () => {
  for (const props of [{}, { outgoing: true }, { state: 'paid' }, { disabledReason: 'x' }]) {
    assert.doesNotMatch(await card(props), /invoice/i, JSON.stringify(props))
  }
  assert.doesNotMatch(read('RequestCard.vue').replace(/<!--[\s\S]*?-->/, ''), /in invoice|Amount in/i)
})

test('request card: a reason keeps Pay visible but aria-disabled, and is linked to it', async () => {
  const html = await card({ disabledReason: 'None of your wallets can pay this.' })
  assert.match(html, /<p id="request-reason-[^"]*" class="request-card__reason" role="status">/)
  assert.match(html, /None of your wallets can pay this\./)
  const pay = tags(html, 'request-btn--pay')[0]
  assert.match(pay, /aria-disabled="true"/)
  assert.match(pay, /aria-describedby="request-reason-/)
  assert.doesNotMatch(pay, /\sdisabled(=|\s|>)/, 'stays focusable so the reason is reachable')
  assert.doesNotMatch(await card({}), /request-card__reason/)
  assert.doesNotMatch(await card({ outgoing: true, disabledReason: 'x' }), /request-card__reason/, 'the requester never pays')
})

test('request card: while the wallets load, Pay waits busy and nothing is claimed', async () => {
  const html = await card({ walletsLoading: true })
  const pay = tags(html, 'request-btn--pay')[0]
  assert.match(pay, /aria-disabled="true"/)
  assert.match(pay, /aria-busy="true"/)
  assert.doesNotMatch(pay, /aria-describedby/)
  assert.doesNotMatch(html, /request-card__reason/)
  assert.doesNotMatch(tags(html, 'request-btn--quiet')[0], /\sdisabled(=|\s|>)/, 'Decline does not wait for the wallets')
  assert.doesNotMatch(tags(await card({}), 'request-btn--pay')[0], /aria-busy/)
})

test('request card: Pay does nothing while blocked or busy', () => {
  const blocked = vmOf(RequestCard, { amountSats: 1, disabledReason: 'no' })
  blocked.vm.onPay()
  assert.deepEqual(blocked.emitted, [])
  const loading = vmOf(RequestCard, { amountSats: 1, walletsLoading: true })
  loading.vm.onPay()
  assert.deepEqual(loading.emitted, [])
  const busy = vmOf(RequestCard, { amountSats: 1, busy: true })
  busy.vm.onPay()
  assert.deepEqual(busy.emitted, [])
  const free = vmOf(RequestCard, { amountSats: 1 })
  free.vm.onPay()
  assert.deepEqual(free.emitted, [['pay']])
})

test('request card: busy disables the quiet actions', async () => {
  const html = await card({ busy: true })
  assert.match(tags(html, 'request-btn--quiet')[0], /disabled/)
})

test('request card: a stranger\'s request is marked and Pay is no longer the filled button', async () => {
  const html = await card({ untrusted: true })
  assert.match(html, /request-card--untrusted/)
  assert.match(html, /request-btn--outline/)
  assert.doesNotMatch(html, /request-btn--pay/)
  assert.doesNotMatch(await card({ untrusted: true, state: 'expired' }), /request-card--untrusted/, 'finished requests are quiet')
})

test('request card: it is a named group and says valid-until only while pending', async () => {
  const html = await card({ partnerName: 'Anna', validUntil: NOW + 300 })
  assert.match(html, /role="group" aria-label="Anna requests, ₿ [^"]*, open"/)
  assert.match(html, /Valid until/)
  assert.doesNotMatch(await card({ validUntil: NOW + 300, state: 'paid' }), /Valid until/)
  assert.match(await card({}), /Payment request/, 'no name: a neutral label')
})

test('header: a muted chat says so next to the name', async () => {
  assert.doesNotMatch(await render(ChatHeader, { name: 'Anna' }), /bell-off/)
  const muted = await render(ChatHeader, { name: 'Anna', muted: true })
  assert.match(muted, /chat-header__name[^>]*>Anna<\/span><i[^>]*data-icon="tabler:bell-off"/)
})

// ── MoneyBar ─────────────────────────────────────────────────────────

test('money bar: no modes; the message field sits above Request and Send', async () => {
  const html = await render(MoneyBar, {}, { slots: { default: () => Vue.h('i', 'COMPOSER') } })
  assert.match(html, /<i>COMPOSER<\/i>[\s\S]*money-btn--request[\s\S]*Request[\s\S]*money-btn--send[\s\S]*Send/)
  assert.doesNotMatch(html, /currency-bitcoin|Back to payments/, 'no hidden mode behind a glyph')
})

test('money bar: a partner who cannot receive messages gets money buttons only', async () => {
  const html = await render(MoneyBar, { canMessage: false }, { slots: { default: () => Vue.h('i', 'COMPOSER') } })
  assert.doesNotMatch(html, /COMPOSER/)
  assert.match(html, /money-btn--request/)
})

test('money bar: a disabled button says why, right above it', async () => {
  const html = await render(MoneyBar, { sendDisabled: true, disabledHint: 'Add them to your contacts to send money.' })
  const [hint] = tags(html, 'money-bar__hint')
  const id = hint.match(/id="([^"]+)"/)[1]
  assert.match(html, /Add them to your contacts to send money\./)
  assert.match(tags(html, 'money-btn--send')[0], new RegExp(`aria-describedby="${id}"`))
  assert.doesNotMatch(tags(html, 'money-btn--request')[0], /aria-describedby/, 'Request is not disabled')
})

test('money bar: disabled buttons are real disabled buttons', async () => {
  const html = await render(MoneyBar, { requestDisabled: true, sendDisabled: true })
  assert.ok(tags(html, 'money-btn').every((b) => b.includes('disabled')))
})

// ── Composer ─────────────────────────────────────────────────────────

test('composer: a labelled field and a labelled send button, disabled while empty', async () => {
  const html = await render(Composer, {})
  assert.match(html, /<textarea[^>]*rows="1"[^>]*aria-label="Message"/, 'one line that grows with the text')
  assert.match(html, /enterkeyhint="send"/)
  assert.match(tags(html, 'composer__send')[0], /aria-label="Send message"/)
  assert.match(tags(html, 'composer__send')[0], /disabled/)
  assert.doesNotMatch(await render(Composer, { modelValue: 'Hi' }), /composer__send"[^>]*disabled/)
  assert.doesNotMatch(html, /composer__counter/)
})

test('composer: the counter appears near the limit and turns into an error above it', async () => {
  const far = await render(Composer, { modelValue: 'x'.repeat(1700) })
  assert.doesNotMatch(far, /composer__counter/)
  const near = await render(Composer, { modelValue: 'x'.repeat(1900) })
  assert.match(near, /composer__counter[^>]*role="status"[^>]*>\s*100 characters left/)
  assert.match(near, /aria-describedby="composer-counter-/)
  const over = await render(Composer, { modelValue: 'x'.repeat(2005) })
  assert.match(over, /composer__counter--over[^>]*>\s*5 characters too long/)
  assert.match(over, /aria-invalid="true"/)
  assert.match(tags(over, 'composer__send')[0], /disabled/)
})

test('composer: sending is blocked over the limit, without text or with a secret key', () => {
  const can = (props) => vmOf(Composer, props).vm.canSend
  assert.equal(can({ modelValue: 'Hi' }), true)
  assert.equal(can({ modelValue: '   ' }), false)
  assert.equal(can({ modelValue: '' }), false)
  assert.equal(can({ modelValue: 'x'.repeat(2001) }), false)
  assert.equal(can({ modelValue: '😀'.repeat(2000) }), true, 'emoji count once')
  assert.equal(can({ modelValue: 'nsec1abc', secretKeyWarning: true }), false)
  assert.equal(can({ modelValue: 'Hi', disabled: true }), false)
})

test('composer: the secret key warning is an alert that says what and why', async () => {
  const html = await render(Composer, { modelValue: 'nsec1x', secretKeyWarning: true })
  assert.match(html, /role="alert"/)
  assert.match(html, /This looks like a secret key or recovery phrase/)
  assert.match(html, /Sending is blocked/)
  assert.doesNotMatch(await render(Composer, { modelValue: 'Hi' }), /role="alert"/)
})

test('composer: the reply preview names the author and can be cancelled', async () => {
  const html = await render(Composer, { reply: { author: 'Anna', text: 'See you at 7' } })
  assert.match(html, /Reply to Anna/)
  assert.match(html, /See you at 7/)
  assert.match(html, /aria-label="Cancel reply"/)
  assert.deepEqual(Composer.emits, ['update:modelValue', 'send', 'cancel-reply'])
})

test('composer: Enter sends, except while an IME is composing or with Shift (a new line); it never clears the text itself', () => {
  const press = (props, event) => {
    const { vm, emitted } = vmOf(Composer, props)
    let prevented = false
    vm.onEnter({ preventDefault() { prevented = true }, ...event })
    return { emitted, prevented }
  }
  assert.deepEqual(press({ modelValue: 'Hi' }, {}).emitted, [['send']])
  assert.deepEqual(press({ modelValue: '' }, {}).emitted, [])
  const ime = press({ modelValue: 'こん' }, { isComposing: true })
  assert.deepEqual(ime.emitted, [])
  assert.equal(ime.prevented, false)
  assert.deepEqual(press({ modelValue: 'こん' }, { keyCode: 229 }).emitted, [])
  assert.deepEqual(press({ modelValue: 'Hi', secretKeyWarning: true }, {}).emitted, [], 'blocked')
  const newLine = press({ modelValue: 'Hi' }, { shiftKey: true })
  assert.deepEqual(newLine.emitted, [])
  assert.equal(newLine.prevented, false, 'the field gets its new line')
})

test('composer: opening a chat does not raise the keyboard; the field grows up to five lines', () => {
  assert.equal(Composer.props.autofocus.default, false)
  const field = { style: {}, scrollHeight: 88 }
  const { vm } = vmOf(Composer, {})
  vm.$refs = { input: field }
  vm.fitHeight()
  assert.equal(field.style.height, '88px')
  assert.match(read('Composer.vue'), /max-height: 134px/)
})

const ADDRESS = 'me@btc.mybuho.de'

// ── RequestSheet ─────────────────────────────────────────────────────

test('request sheet: title, labelled amount and note, the profile address as a quiet row, CTA', async () => {
  const html = await render(RequestSheet, { modelValue: true, partnerName: 'Anna', address: ADDRESS })
  assert.match(html, /<section[^>]*aria-labelledby="request-title-/)
  assert.match(html, /Request from Anna/)
  assert.match(html, /<label for="request-amount-[^"]*"[^>]*>Amount in sats<\/label>/)
  assert.match(html, /inputmode="numeric"/)
  assert.match(html, /Note \(optional\)/)
  assert.match(html, /maxlength="200"/)
  assert.match(html, /request-sheet__to[\s\S]*>To<[\s\S]*me@btc\.mybuho\.de/)
  assert.doesNotMatch(html, /Receive in|receive-field/)
  assert.match(tags(html, 'request-sheet__cta')[0], /disabled/)
  assert.match(html, /request-sheet__unit[^>]*>₿</)
})

test('request sheet: a failure is shown as such', async () => {
  const html = await render(RequestSheet, { modelValue: true, address: ADDRESS, error: 'No relay accepted' })
  assert.match(html, /role="alert"[^>]*>[\s\S]*No relay accepted/)
  assert.doesNotMatch(await render(RequestSheet, { modelValue: true, address: ADDRESS }), /request-sheet__failure/)
})

test('request sheet: without a profile address it explains and offers one button, no amount form', async () => {
  const html = await render(RequestSheet, { modelValue: true, partnerName: 'Anna' })
  assert.match(html, /To request money you need a Lightning address in your profile\./)
  assert.match(html, />\s*Set up Lightning address\s*</)
  assert.doesNotMatch(html, /request-sheet__amount|inputmode="numeric"|request-sheet__to"/)
  const { vm, emitted } = vmOf(RequestSheet, {})
  vm.$emit('open-address')
  assert.deepEqual(emitted, [['open-address']])
  assert.deepEqual(RequestSheet.emits, ['update:modelValue', 'open-address', 'submit'])
})

test('request sheet: amount input keeps digits only, groups them, and validates the range', () => {
  const { vm } = vmOf(RequestSheet, { address: ADDRESS, minSats: 10, maxSats: 1_000_000 })
  const type = (value) => { const event = { target: { value } }; vm.onAmountInput(event); return event.target.value }
  assert.equal(type('2a5,0.00'), n(25000))
  assert.equal(vm.amountText, '25000')
  assert.equal(vm.amountSats, 25000)
  assert.equal(vm.canSubmit, true)
  assert.equal(type('00012'), n(12))
  assert.equal(type('1'.repeat(30)), n(Number('1'.repeat(12))), 'digits are capped')
  type('5')
  assert.match(vm.amountError, /The smallest request is/)
  assert.equal(vm.canSubmit, false)
  type('9999999')
  assert.match(vm.amountError, /The largest request is/)
  assert.equal(vm.canSubmit, false)
  type('')
  assert.equal(vm.amountError, '', 'an empty field is not an error yet')
  assert.equal(vm.canSubmit, false)
})

test('request sheet: submit reports amount and trimmed note', () => {
  const { vm, emitted } = vmOf(RequestSheet, { address: ADDRESS })
  vm.submit()
  assert.deepEqual(emitted, [], 'nothing to submit yet')
  vm.onAmountInput({ target: { value: '12000' } })
  vm.note = '  Pizza  '
  vm.submit()
  assert.deepEqual(emitted, [['submit', { amountSats: 12000, note: 'Pizza' }]])
})

test('request sheet: no submit while sending', () => {
  const sending = vmOf(RequestSheet, { address: ADDRESS, submitting: true, amountText: '100' })
  sending.vm.submit()
  assert.deepEqual(sending.emitted, [])
})

test('request sheet: fiat comes from the page, the CTA names the amount, a fresh sheet starts empty', () => {
  const { vm } = vmOf(RequestSheet, { address: ADDRESS, formatFiat: (s) => `≈ ${s / 100}` })
  assert.equal(vm.conversion, '')
  vm.amountText = '1500'
  assert.equal(vm.conversion, '≈ 15')
  assert.ok(vm.ctaText.includes(`₿ ${n(1500)}`))
  vm.note = 'old'
  RequestSheet.watch.modelValue.call(vm, true)
  assert.equal(vm.amountText, '')
  assert.equal(vm.note, '')
  const busy = vmOf(RequestSheet, { address: ADDRESS, submitting: true, amountText: '5' })
  assert.equal(busy.vm.ctaText, 'Creating request')
})

test('request sheet: without a rate there is no unit switch, the amount is in sats', async () => {
  const html = await render(RequestSheet, { modelValue: true, address: ADDRESS })
  assert.doesNotMatch(html, /request-sheet__unit-pill/)
})

test('request sheet: the amount can be typed in fiat; the request is still in sats', async () => {
  const fiat = { address: ADDRESS, fiatCode: 'USD', fiatToSats: (usd) => Math.floor(usd * 1000), formatFiat: (s) => `≈ $${s / 1000}` }
  const html = await render(RequestSheet, { modelValue: true, ...fiat })
  assert.match(html, /aria-label="Enter the amount in USD"/)
  const { vm, emitted } = vmOf(RequestSheet, fiat)
  const type = (value) => { const event = { target: { value } }; vm.onAmountInput(event); return event.target.value }
  type('25')
  vm.switchUnit()
  assert.equal(vm.amountText, '', 'switching clears the field: no half-converted number')
  assert.equal(vm.unitLabel, 'USD')
  assert.equal(vm.amountLabel, 'Amount in USD')
  assert.equal(type('4,2a59'), '4.25', 'a comma is a decimal point, two decimals at most')
  assert.equal(vm.amountSats, 4250)
  assert.equal(vm.conversion, `≈ ₿ ${n(4250)}`)
  assert.equal(type('007.5'), '7.5')
  assert.equal(type('.5'), '0.5')
  vm.submit()
  assert.deepEqual(emitted, [['submit', { amountSats: 500, note: '' }]])
  RequestSheet.watch.modelValue.call(vm, true)
  assert.equal(vm.unit, 'sats', 'a fresh sheet starts in sats')
})

// ── SignerAppNotice ──────────────────────────────────────────────────

test('signer app notice: one plain sentence per state and the one action it needs', async () => {
  const off = await render(SignerAppNotice, { state: 'off' })
  assert.match(off, /Messages are off for this identity/)
  assert.match(off, /Choose to always allow, so it asks only once\./)
  assert.match(off, />\s*Turn on messages\s*</)

  for (const state of ['approval', 'away']) {
    const html = await render(SignerAppNotice, { state })
    assert.match(html, />\s*Try again\s*</, state)
  }
  assert.match(await render(SignerAppNotice, { state: 'approval' }), /Approve messages in your signer app/)
  assert.match(await render(SignerAppNotice, { state: 'away' }), /isn&#39;t answering|isn't answering/)

  const unsupported = await render(SignerAppNotice, { state: 'unsupported' })
  assert.match(unsupported, /can&#39;t open messages|can't open messages/)
  assert.equal(tags(unsupported, 'signer-notice__btn').length, 0, 'nothing to tap: the app has to change')
  assert.deepEqual(SignerAppNotice.emits, ['turn-on', 'retry'])
})

// ── UnknownSenderBanner ──────────────────────────────────────────────

test('unknown sender: warns, shows a fragment of the npub and offers Add contact and Block', async () => {
  const npub = `npub1${'k'.repeat(58)}`
  const html = await render(UnknownSenderBanner, { npub })
  assert.match(html, /Not in your contacts/)
  assert.match(html, /Only pay if you are sure who this is\./)
  assert.match(html, /<code title="[^"]*">npub1k{6}….{5}<\/code>/)
  assert.ok(!html.includes(`>${npub}<`), 'the full key is not drawn')
  const buttons = tags(html, 'unknown-btn')
  assert.equal(buttons.length, 2)
  assert.match(html, />\s*Add contact\s*</)
  assert.match(html, />\s*Block\s*</)
  assert.deepEqual(UnknownSenderBanner.emits, ['add-contact', 'block'])
})

test('unknown sender: nothing is ever verified, no claimed name is shown', async () => {
  const html = await render(UnknownSenderBanner, { npub: `npub1${'k'.repeat(58)}` })
  assert.doesNotMatch(html, /verified|check/i)
  assert.ok(!('lookalikeName' in UnknownSenderBanner.props), 'the name is never shown, so nothing to compare')
  assert.doesNotMatch(read('UnknownSenderBanner.vue'), /nip05|circle-check|rosette/i)
})

// ── ChatThread ───────────────────────────────────────────────────────

const items = () => [
  { key: 'd1', type: 'day', ts: NOW },
  { key: 'm1', type: 'message', ts: NOW, message: { id: 'm1', text: 'Hi there', outgoing: false } },
  { key: 'm2', type: 'message', ts: NOW, message: { id: 'm2', text: 'Hello', outgoing: false } },
  { key: 'm3', type: 'message', ts: NOW, message: { id: 'm3', text: 'Hey', outgoing: true, delivery: 'queued' } },
  { key: 'r1', type: 'request', ts: NOW, request: { id: 'r1', amountSats: 5000, outgoing: false, state: 'pending' } },
  { key: 'r2', type: 'request', ts: NOW, request: { id: 'r2', amountSats: 7000, outgoing: true, state: 'paid' } },
  { key: 'p1', type: 'payment', ts: NOW, payment: { id: 'p1', outgoing: true, amountSats: 1000, note: 'Tip' } },
]

test('thread: a polite log region with a name and a keyboard-scrollable body', async () => {
  const html = await render(ChatThread, { items: items() })
  assert.match(html, /role="log"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /aria-label="Messages"/)
  assert.match(html, /role="log"[^>]*tabindex="0"|tabindex="0"[^>]*role="log"/)
})

test('thread: every item type is drawn by its component, in order', async () => {
  const html = await render(ChatThread, { items: items(), partnerName: 'Anna' })
  const order = [...html.matchAll(/class="day-separator"|class="bubble--(?:in|out) bubble"|class="request-card |class="payment-line"/g)].map((m) => m[0].replace(/^class="/, '').split(/[ "]/)[0])
  assert.deepEqual(order, ['day-separator', 'bubble--in', 'bubble--in', 'bubble--out', 'request-card', 'request-card', 'payment-line'])
  assert.match(html, /Anna requests/)
  assert.match(html, /You requested/)
  assert.match(html, /You sent/)
  assert.match(html, /Waiting to send/)
})

test('thread: requests sit on their side; consecutive bubbles of one side are tight', async () => {
  const html = await render(ChatThread, { items: items() })
  assert.match(html, /chat-thread__row--in chat-thread__row chat-thread__row--card/)
  assert.match(html, /chat-thread__row--out chat-thread__row chat-thread__row--card/)
  const rows = tags(html, 'chat-thread__row--message')
  assert.equal(rows.length, 3)
  assert.doesNotMatch(rows[0], /--tight/)
  assert.match(rows[1], /--tight/, 'second incoming bubble')
  assert.doesNotMatch(rows[2], /--tight/, 'the side changed')
})

test('thread: item fields reach the components', async () => {
  const html = await render(ChatThread, {
    items: [
      { key: 'm', type: 'message', ts: NOW, message: { id: 'm', text: 'x', outgoing: false, degraded: true, canReact: false, reactions: [{ emoji: '👍', count: 1, mine: false }] } },
      { key: 'r', type: 'request', ts: NOW, request: { id: 'r', amountSats: 100, outgoing: false, state: 'pending', disabledReason: 'Blocked', untrusted: true } },
    ],
  })
  assert.match(html, /bubble--degraded/)
  assert.match(html, /bubble__reaction"[^>]*disabled/)
  assert.match(html, /request-card--untrusted/)
  assert.match(html, /Blocked/)
})

test('thread: empty shows the text, or the empty slot, and the header slot scrolls with the thread', async () => {
  assert.match(await render(ChatThread, { items: [] }), /Nothing here yet\. Request or send money to get started\./)
  const slotted = await render(ChatThread, { items: [] }, { slots: { empty: () => Vue.h('b', 'EMPTY'), header: () => Vue.h('b', 'HEAD') } })
  assert.match(slotted, /<b>EMPTY<\/b>/)
  assert.doesNotMatch(slotted, /Nothing here yet/)
  assert.ok(slotted.indexOf('HEAD') < slotted.indexOf('EMPTY'))
})

test('thread: events carry the id of the item they come from', () => {
  const { vm, emitted } = vmOf(ChatThread)
  vm.forward('pay-request', 'r1')
  vm.forward('react', 'm1', { emoji: '👍' })
  vm.forward('copy', 'm1', { text: 'Hi' })
  assert.deepEqual(emitted, [
    ['pay-request', { id: 'r1' }],
    ['react', { id: 'm1', emoji: '👍' }],
    ['copy', { id: 'm1', text: 'Hi' }],
  ])
  for (const name of ['react', 'reply', 'copy', 'retry', 'pay-request', 'decline-request', 'remind-request', 'withdraw-request', 'send-anyway-request', 'request-again', 'open-payment']) {
    assert.ok(ChatThread.emits.includes(name), name)
  }
})

/** A thread instance with a scroller of the given geometry. */
function threadVm(geometry = {}) {
  const scroller = { scrollHeight: 2000, scrollTop: 1500, clientHeight: 500, scrollTo(options) { this.last = options }, ...geometry }
  const ctx = vmOf(ChatThread, {}, { $refs: { scroller } })
  return { ...ctx, scroller }
}

test('thread: "at the bottom" has a little slack, and reaching it clears the pill', () => {
  const near = threadVm({ scrollTop: 1450 })
  near.vm.hasUnseen = true
  near.vm.onScroll()
  assert.equal(near.vm.atBottom, true)
  assert.equal(near.vm.hasUnseen, false)
  const up = threadVm({ scrollTop: 300 })
  up.vm.hasUnseen = true
  up.vm.onScroll()
  assert.equal(up.vm.atBottom, false)
  assert.equal(up.vm.hasUnseen, true)
})

test('thread: a new item keeps a reader at the bottom there, smoothly', () => {
  const { vm, scroller } = threadVm()
  const before = items()
  const after = [...before, { key: 'm9', type: 'message', ts: NOW, message: { id: 'm9', text: 'new', outgoing: false } }]
  ChatThread.watch.items.call(vm, after, before)
  assert.equal(scroller.last.top, 2000)
  assert.equal(vm.hasUnseen, false)
})

test('thread: a reader who scrolled up is not yanked down: a pill appears instead', () => {
  const { vm, scroller } = threadVm({ scrollTop: 100 })
  vm.atBottom = false
  const before = items()
  const after = [...before, { key: 'm9', type: 'message', ts: NOW, message: { id: 'm9', text: 'new', outgoing: false } }]
  ChatThread.watch.items.call(vm, after, before)
  assert.equal(scroller.last, undefined)
  assert.equal(vm.hasUnseen, true)
})

test('thread: the user\'s own item always scrolls into view; a new day line alone is no news', () => {
  const own = threadVm({ scrollTop: 100 })
  own.vm.atBottom = false
  const before = items()
  ChatThread.watch.items.call(own.vm, [...before, { key: 'o', type: 'message', ts: NOW, message: { id: 'o', text: 'mine', outgoing: true } }], before)
  assert.equal(own.scroller.last.top, 2000)
  assert.equal(own.vm.hasUnseen, false)

  const day = threadVm({ scrollTop: 100 })
  day.vm.atBottom = false
  ChatThread.watch.items.call(day.vm, [...before, { key: 'd2', type: 'day', ts: NOW }], before)
  assert.equal(day.vm.hasUnseen, false)
})

test('thread: history older than the last item, or an unchanged list, does not move the view', () => {
  const { vm, scroller } = threadVm({ scrollTop: 100 })
  vm.atBottom = false
  const before = items()
  const older = [{ key: 'old', type: 'message', ts: NOW - 99, message: { id: 'old', text: 'old', outgoing: false } }, ...before]
  ChatThread.watch.items.call(vm, older, before)
  assert.equal(scroller.last, undefined)
  assert.equal(vm.hasUnseen, false)
})

test('thread: reduced motion jumps instead of gliding', () => {
  const realWindow = globalThis.window
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    const reduced = threadVm()
    reduced.vm.scrollToBottom({ smooth: true })
    assert.equal(reduced.scroller.last.behavior, 'auto')
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    const normal = threadVm()
    normal.vm.scrollToBottom({ smooth: true })
    assert.equal(normal.scroller.last.behavior, 'smooth')
    normal.vm.scrollToBottom({ smooth: false })
    assert.equal(normal.scroller.last.behavior, 'auto')
  } finally {
    if (realWindow === undefined) delete globalThis.window
    else globalThis.window = realWindow
  }
})

// ── style contract ───────────────────────────────────────────────────

const strip = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

test('touch targets: every control is at least 44 pt', () => {
  const rule = (file, selector) => {
    const source = read(file)
    const match = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))
    assert.ok(match, `${file} ${selector}`)
    return match[0]
  }
  const at44 = (file, selector) => assert.match(rule(file, selector), /(min-)?(height|width): (4[4-9]|[5-9]\d)px/, `${file} ${selector}`)
  at44('ChatHeader.vue', '.chat-header__icon-btn')
  at44('ChatHeader.vue', '.chat-header__person')
  at44('PaymentLine.vue', '.payment-line')
  at44('RequestCard.vue', '.request-btn')
  at44('MoneyBar.vue', '.money-btn')
  at44('Composer.vue', '.composer__input')
  at44('Composer.vue', '.composer__send')
  at44('Composer.vue', '.composer__icon-btn')
  at44('MessageBubble.vue', '.bubble__retry')
  at44('MessageMenu.vue', '.message-menu__emoji')
  at44('MessageMenu.vue', '.message-menu__item')
  at44('UnknownSenderBanner.vue', '.unknown-btn')
  at44('SignerAppNotice.vue', '.signer-notice__btn')
  at44('ChatThread.vue', '.chat-thread__pill')
  at44('RequestSheet.vue', '.request-sheet__unit-pill')
  at44('RequestSheet.vue', '.request-sheet__to')
})

test('dialog roots: a bottom sheet whose root is not a <div> still receives taps', () => {
  // Quasar sets `pointer-events: all` only on a dialog's direct child <div>; a <section> root
  // lets every tap fall through to the backdrop, which closes the sheet (found by check:contact-chat).
  for (const [file, root] of [['RequestSheet.vue', 'request-sheet'], ['MessagesSheet.vue', 'messages-sheet']]) {
    assert.match(read(file), new RegExp(`<section class="${root}"`), file)
    assert.match(read(file).split('<style')[1], new RegExp(`\\.${root} \\{[^}]*pointer-events: all;`), file)
  }
})

test('motion: every component that animates honours prefers-reduced-motion', () => {
  for (const file of ['MessageBubble.vue', 'RequestCard.vue', 'MoneyBar.vue', 'RequestSheet.vue', 'ChatThread.vue']) {
    assert.match(read(file), /@media \(prefers-reduced-motion: reduce\)/, file)
  }
})

test('theming: colours come from the app tokens, never a hard-coded palette', () => {
  const tokens = read('chatTokens.css')
  assert.match(tokens, /body\.body--light/)
  for (const file of ['ChatHeader.vue', 'MessageBubble.vue', 'RequestCard.vue', 'MoneyBar.vue', 'Composer.vue', 'ChatThread.vue', 'RequestSheet.vue']) {
    const css = read(file).split('<style')[1]
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![^{]*\{)/, `${file}: hex outside a rule`)
    assert.doesNotMatch(css.replace(/var\([^)]*\)/g, ''), /(color|background)[^;]*#[0-9a-fA-F]{3,8}/, `${file}: hard-coded colour`)
  }
  for (const token of ['--bg-input', '--bg-card', '--border-card', '--text-primary', '--text-secondary', '--text-muted', '--brand-accent', '--color-warn']) {
    assert.ok(Object.values({ a: read('RequestCard.vue') + read('MessageBubble.vue') + read('ChatHeader.vue') }).join('').includes(`var(${token}`), token)
  }
})

test('presentational: no store, router, network or runtime imports', () => {
  for (const file of ['ChatHeader.vue', 'MessageBubble.vue', 'MessageMenu.vue', 'RequestCard.vue', 'PaymentLine.vue', 'MoneyBar.vue', 'Composer.vue',
    'RequestSheet.vue', 'DaySeparator.vue', 'UnknownSenderBanner.vue', 'ChatThread.vue', 'chatFormat.js']) {
    const imports = [...strip(read(file)).matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    for (const spec of imports) {
      assert.ok(
        spec === '@iconify/vue' || spec.startsWith('./') || spec === '../../utils/amountFormatting.js' || spec === '../../services/dm/constants.js',
        `${file} imports ${spec}`,
      )
    }
    assert.doesNotMatch(strip(read(file)), /\bfetch\(|WebSocket|useRouter|\$router|\$route\b/, file)
  }
})
