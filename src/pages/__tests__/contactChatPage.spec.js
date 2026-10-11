/**
 * ContactChatPage: routing, states, dialogs and the glue between the
 * components and the view-model (the view-model itself is covered by
 * composables/__tests__/useContactChat.spec.js).
 *
 * Same approach as the chat component specs: the real script runs with its
 * imports stubbed and the real template is compiled (SSR) and rendered.
 *
 *   node --test src/pages/__tests__/contactChatPage.spec.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as ServerRenderer from 'vue/server-renderer'
import * as amountFormatting from '../../utils/amountFormatting.js'

const sfc = createRequire(import.meta.url)('@vue/compiler-sfc')

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
const hex = (ch) => ch.repeat(64)
const ME = hex('1')
const ANNA = hex('a')
const STRANGER = hex('d')

function run(code, deps = {}) {
  const { code: cjs } = transformSync(code, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', cjs)((name) => deps[name] || {}, module, module.exports)
  return module.exports
}
const readSrc = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const chatFormat = run(readSrc('components/chat/chatFormat.js'), { '../../utils/amountFormatting.js': amountFormatting })

// ── the page, with its imports stubbed ───────────────────────────────

const stub = (name) => ({ name, render: () => Vue.h('div', { class: `stub-${name}` }) })
const slotStub = (name) => ({
  name, inheritAttrs: false,
  render() { return Vue.h('div', { class: `stub-${name}` }, [this.$slots.avatar?.(), this.$slots.header?.(), this.$slots.empty?.(), this.$slots.default?.()]) },
})
const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }

const { descriptor } = sfc.parse(readSrc('pages/ContactChatPage.vue'))
const page = run(descriptor.script.content, {
  '@iconify/vue': { Icon },
  'nostr-core': { nip19: { npubEncode: (key) => `npub1${key.slice(0, 40)}` } },
  '../components/chat/chatFormat.js': chatFormat,
  '../components/chat/ChatHeader.vue': slotStub('ChatHeader'),
  '../components/chat/ChatThread.vue': slotStub('ChatThread'),
  '../components/chat/MoneyBar.vue': slotStub('MoneyBar'),
  '../components/chat/Composer.vue': stub('Composer'),
  '../components/chat/RequestSheet.vue': stub('RequestSheet'),
  '../components/chat/UnknownSenderBanner.vue': stub('UnknownSenderBanner'),
  '../components/AddressBook/ContactAvatar.vue': stub('ContactAvatar'),
  '../components/AddressBook/AddressBookModal.vue': stub('AddressBookModal'),
  '../components/identity/IdentityGetPaidSheet.vue': stub('IdentityGetPaidSheet'),
  '../services/dm/protocol.js': { containsSecretKey: (text) => /nsec1/.test(text) },
  '../services/dm/runtime.js': { contactChatRoute: (id) => `/address-book/${id}/chat` },
}).default

const compiled = sfc.compileTemplate({ source: descriptor.template.content, filename: 'ContactChatPage.vue', id: 'page', ssr: true })
assert.deepEqual(compiled.errors, [])
page.ssrRender = run(compiled.code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender

// ── a page instance stand-in ─────────────────────────────────────────

const ENTRIES = {
  'addr-1': { id: 'addr-1', name: 'Anna', nostr_pubkey: ANNA },
  'addr-2': { id: 'addr-2', name: 'Manual Mike' },
}

function fakeChat(extra = {}) {
  const calls = []
  const result = (name, value = { ok: true }) => async (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value }
  return {
    calls,
    items: { value: [] },
    paymentsOnly: { value: false },
    open: () => calls.push(['open']),
    close: () => calls.push(['close']),
    resume: () => calls.push(['resume']),
    dispose: () => calls.push(['dispose']),
    refreshReachability: () => calls.push(['refreshReachability']),
    sendText: result('sendText'),
    react: result('react'),
    retry: result('retry'),
    decline: result('decline'),
    withdraw: result('withdraw'),
    remind: result('remind'),
    requestMoney: result('requestMoney'),
    payRequest: async (id) => { calls.push(['payRequest', id]); return { ok: true } },
    sendAnyway: async (id) => { calls.push(['sendAnyway', id]); return { ok: true } },
    requestAgain: result('requestAgain'),
    sendMoney: () => { calls.push(['sendMoney']); return { ok: true } },
    ...extra,
  }
}

function pageOf({ route = { params: { id: 'addr-1' } }, available = true, scope = ME, bookReady = true, chat = fakeChat(), muted = false, wallets = [], isBlocked = false } = {}) {
  const notices = []
  const replaced = []
  const pushed = []
  const blocked = []
  const unblocked = []
  const muteCalls = []
  const store = {
    scope,
    thread: () => ({ muted }),
    block: (key) => blocked.push(key),
    unblock: (key) => unblocked.push(key),
    isBlocked: () => isBlocked,
    mute: (key, value) => muteCalls.push([key, value]),
  }
  const addressBook = {
    getEntryById: (id) => ENTRIES[id] || null,
    findContactByPubkey: (key) => Object.values(ENTRIES).find((entry) => entry.nostr_pubkey === key) || null,
  }
  const $route = route
  const contact = () => {
    if (typeof $route.params.id === 'string') return addressBook.getEntryById($route.params.id)
    return addressBook.findContactByPubkey($route.params.pubkey)
  }
  const partner = () => {
    const entry = contact()
    if (entry) return entry.nostr_pubkey || null
    return /^[0-9a-f]{64}$/.test($route.params.pubkey || '') ? $route.params.pubkey : null
  }
  const vm = {
    ...page.data.call({}),
    ...page.methods,
    t, $t: t, $route,
    $router: { replace: (to) => replaced.push(to), push: (to) => pushed.push(to), back: () => pushed.push('BACK') },
    $q: { notify: (notice) => notices.push(notice) },
    $nextTick: (fn) => fn?.(),
    $refs: {},
    store, addressBook, chat, contact, partner,
    partnerName: () => contact()?.name || `npub1${(partner() || '').slice(0, 8)}…`,
    runtime: { available: { value: available }, me: { value: ME } },
    walletStore: { wallets, useBip177Format: true, getDisplayBalance: () => ({ known: false }), sparkLightningAddressOf: () => null },
    profile: { lud16: 'me@example.com' },
    formatFiat: () => '',
    fiatToSats: () => null,
    requestFiatCode: () => '',
  }
  vm.bookReady = bookReady
  for (const [name, getter] of Object.entries(page.computed)) {
    Object.defineProperty(vm, name, { get: () => getter.call(vm), configurable: true })
  }
  return { vm, notices, replaced, pushed, blocked, unblocked, muteCalls, store, chat }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

// ── view state ───────────────────────────────────────────────────────

test('view: no runtime means no identity; waiting for the address book or the store scope means loading', () => {
  assert.equal(pageOf({ available: false }).vm.view, 'no-identity')
  assert.equal(pageOf({ bookReady: false }).vm.view, 'loading')
  assert.equal(pageOf({ scope: null }).vm.view, 'loading')
  assert.equal(pageOf({ scope: hex('9') }).vm.view, 'loading', 'another identity\'s data is never shown')
  assert.equal(pageOf().vm.view, 'chat')
})

test('view: a contact without a Nostr profile has no chat; an unknown sender does', () => {
  assert.equal(pageOf({ route: { params: { id: 'addr-2' } } }).vm.view, 'no-nostr')
  const stranger = pageOf({ route: { params: { pubkey: STRANGER } } })
  assert.equal(stranger.vm.view, 'chat')
  assert.equal(stranger.vm.unknown, true)
  assert.equal(stranger.vm.partnerKey, STRANGER)
  assert.match(stranger.vm.displayName, /^npub1/)
  assert.equal(pageOf().vm.unknown, false)
  assert.equal(pageOf().vm.displayName, 'Anna')
})

test('the npub of an unknown sender is the whole key in bech32 (the banner shortens it)', () => {
  const { vm } = pageOf({ route: { params: { pubkey: STRANGER } } })
  assert.equal(vm.npub, `npub1${STRANGER.slice(0, 40)}`)
})

// ── route checks ─────────────────────────────────────────────────────

test('route: a contact that does not exist, or a malformed pubkey, goes back to the address book', () => {
  const missing = pageOf({ route: { params: { id: 'gone' } } })
  missing.vm.checkRoute()
  assert.deepEqual(missing.replaced, ['/address-book'])

  const malformed = pageOf({ route: { params: { pubkey: 'nope' } } })
  malformed.vm.checkRoute()
  assert.deepEqual(malformed.replaced, ['/address-book'])

  const fine = pageOf()
  fine.vm.checkRoute()
  assert.deepEqual(fine.replaced, [])
})

test('route: an unknown-sender route whose sender is a contact moves to the contact route', () => {
  const known = pageOf({ route: { params: { pubkey: ANNA } } })
  known.vm.checkRoute()
  assert.deepEqual(known.replaced, ['/address-book/addr-1/chat'])

  const stranger = pageOf({ route: { params: { pubkey: STRANGER } } })
  stranger.vm.checkRoute()
  assert.deepEqual(stranger.replaced, [])
})

test('route: saving the sender while on the unknown route hands over to the contact route', () => {
  const { vm, replaced } = pageOf({ route: { params: { pubkey: ANNA } } })
  page.watch.contactEntry.call(vm, ENTRIES['addr-1'])
  assert.deepEqual(replaced, ['/address-book/addr-1/chat'])
  const onContactRoute = pageOf()
  page.watch.contactEntry.call(onContactRoute.vm, ENTRIES['addr-1'])
  assert.deepEqual(onContactRoute.replaced, [])
  page.watch.contactEntry.call(vm, null)
  assert.equal(replaced.length, 1)
})

test('back: uses history when there is some, otherwise lands on the address book', () => {
  const previous = globalThis.window
  try {
    globalThis.window = { history: { state: { back: '/x' } } }
    const withHistory = pageOf()
    withHistory.vm.goBack()
    assert.deepEqual(withHistory.pushed, ['BACK'])
    globalThis.window = { history: { state: { back: null } } }
    const cold = pageOf()
    cold.vm.goBack()
    assert.deepEqual(cold.replaced, ['/address-book'])
  } finally {
    globalThis.window = previous
  }
})

test('profile: the header name opens the contact page; there is none for a stranger', () => {
  const contact = pageOf()
  contact.vm.openProfile()
  assert.deepEqual(contact.pushed, ['/address-book/addr-1'])
  const stranger = pageOf({ route: { params: { pubkey: STRANGER } } })
  stranger.vm.openProfile()
  assert.deepEqual(stranger.pushed, [])
})

// ── lifecycle ────────────────────────────────────────────────────────

test('activate: opens the chat once per partner, only when it is ready', () => {
  const ready = pageOf()
  ready.vm.activate()
  ready.vm.activate()
  assert.deepEqual(ready.chat.calls, [['open']])
  ready.vm.activeKey = null
  ready.vm.activate()
  assert.equal(ready.chat.calls.length, 2)

  const loading = pageOf({ scope: null })
  loading.vm.activate()
  assert.deepEqual(loading.chat.calls, [])
})

test('a new partner on the same page starts from a clean conversation state', () => {
  const { vm } = pageOf()
  Object.assign(vm, { draft: 'half a thought', replyToId: 'x', requestOpen: true, menuOpen: true, activeKey: ANNA })
  page.watch.partnerKey.call(vm)
  assert.deepEqual([vm.draft, vm.replyToId, vm.requestOpen, vm.menuOpen], ['', null, false, false])
  assert.equal(vm.activeKey, ANNA, 'and the new chat was opened')
})

// ── text ─────────────────────────────────────────────────────────────

test('send text: clears the field at once, sends trimmed text with the reply target', async () => {
  const { vm, chat } = pageOf()
  Object.assign(vm, { draft: '  hello  ', replyToId: 'r1' })
  const sending = vm.onSendText()
  assert.equal(vm.draft, '')
  assert.equal(vm.replyToId, null)
  await sending
  assert.deepEqual(chat.calls, [['sendText', 'hello', { replyTo: 'r1' }]])
})

test('send text: a failure puts the words back and says why', async () => {
  const chat = fakeChat({ sendText: async () => ({ ok: false, error: { code: 'X', kind: 'general', message: 'Couldn\'t send right now.' } }) })
  const { vm, notices } = pageOf({ chat })
  Object.assign(vm, { draft: 'hello', replyToId: 'r1' })
  await vm.onSendText()
  assert.equal(vm.draft, 'hello')
  assert.equal(vm.replyToId, 'r1')
  assert.deepEqual(notices.map((notice) => [notice.type, notice.message]), [['negative', 'Couldn\'t send right now.']])
})

test('send text: a secret key blocks sending, empty text sends nothing', async () => {
  const { vm, chat } = pageOf()
  vm.draft = 'my key nsec1abc'
  assert.equal(vm.secretKeyWarning, true)
  await vm.onSendText()
  assert.equal(vm.draft, 'my key nsec1abc')
  vm.draft = '   '
  await vm.onSendText()
  assert.deepEqual(chat.calls, [])
})

test('reply: previews the answered message above the field', () => {
  const { vm } = pageOf()
  vm.chat.items.value = [{ key: 'm1', type: 'message', message: { id: 'm1', text: 'Dinner   on Friday?', outgoing: true } }]
  vm.onReply({ id: 'm1' })
  assert.equal(vm.replyToId, 'm1')
  assert.deepEqual(vm.replyPreview, { author: 'You', text: 'Dinner on Friday?' })
  vm.chat.items.value = [{ key: 'm1', type: 'message', message: { id: 'm1', text: 'x', outgoing: false } }]
  assert.equal(vm.replyPreview.author, 'Anna')
  vm.replyToId = 'gone'
  assert.equal(vm.replyPreview, null)
})

test('copy: puts the text on the clipboard and says so, or says it failed', async () => {
  const previous = globalThis.navigator
  const written = []
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (text) => { written.push(text) } } }, configurable: true })
    const ok = pageOf()
    await ok.vm.onCopy({ text: 'hi' })
    assert.deepEqual(written, ['hi'])
    assert.equal(ok.notices[0].message, 'Copied')
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => { throw new Error('denied') } } }, configurable: true })
    const failed = pageOf()
    await failed.vm.onCopy({ text: 'hi' })
    assert.equal(failed.notices[0].type, 'negative')
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: previous, configurable: true })
  }
})

test('react, retry and the request card actions go to the view-model; a reminder confirms itself', async () => {
  const { vm, chat, notices } = pageOf()
  await vm.onReact({ id: 'm', emoji: '👍' })
  await vm.onRetry({ id: 'm' })
  // Decline and cancel are seen by the partner: each waits for its confirmation.
  vm.onDecline({ id: 'r' })
  assert.equal(chat.calls.length, 2, 'nothing declined before the confirmation')
  await vm.runConfirm()
  vm.onWithdraw({ id: 'r' })
  assert.equal(vm.confirm.keep, 'Keep request')
  await vm.runConfirm()
  await vm.onRemind({ id: 'r' })
  await vm.onPayRequest({ id: 'r' })
  vm.onSend()
  assert.deepEqual(chat.calls, [['react', 'm', '👍'], ['retry', 'm'], ['decline', 'r'], ['withdraw', 'r'], ['remind', 'r'], ['payRequest', 'r'], ['sendMoney']])
  assert.deepEqual(notices.map((notice) => notice.message), ['Reminder sent'])
})

test('expired request: Send anyway and Request again go to the view-model, one tap each', async () => {
  const { vm, chat, notices } = pageOf()
  await vm.onSendAnyway({ id: 'r' })
  await vm.onRequestAgain({ id: 'r' })
  assert.deepEqual(chat.calls, [['sendAnyway', 'r'], ['requestAgain', 'r']])
  assert.deepEqual(notices, [])
})

test('pay: a failure shows its words and nothing else', async () => {
  const error = { code: 'INVOICE_FETCH_FAILED', kind: 'general', message: 'Could not get an invoice' }
  const { vm, notices } = pageOf({ chat: fakeChat({ payRequest: async () => ({ ok: false, error }) }) })
  await vm.onPayRequest({ id: 'r' })
  assert.equal(notices.length, 1)
  assert.equal(notices[0].message, error.message)
  assert.equal(notices[0].type, 'negative')
  assert.equal(notices[0].actions, undefined)
  assert.equal(vm.draft, '')
})

// ── requests ─────────────────────────────────────────────────────────

test('request: opens the sheet', () => {
  const { vm } = pageOf()
  vm.requestError = 'old'
  vm.onRequest()
  assert.equal(vm.requestOpen, true)
  assert.equal(vm.requestError, '')
  assert.equal(vm.linkOpen, false)
})

test('request: a contact who cannot receive messages gets the payment-link explanation instead of a sheet', () => {
  const { vm } = pageOf({ chat: fakeChat({ paymentsOnly: { value: true } }) })
  vm.onRequest()
  assert.equal(vm.requestOpen, false)
  assert.equal(vm.linkOpen, true)
})

test('request submit: success closes the sheet', async () => {
  const { vm, chat } = pageOf()
  vm.requestOpen = true
  await vm.onSubmitRequest({ amountSats: 100, note: 'x' })
  assert.deepEqual(chat.calls, [['requestMoney', { amountSats: 100, note: 'x' }]])
  assert.equal(vm.requestOpen, false)
  assert.equal(vm.requestSubmitting, false)
})

test('request submit: NO_INBOX_RELAYS closes the sheet and offers the payment link; other errors stay in the sheet', async () => {
  const noInbox = pageOf({ chat: fakeChat({ requestMoney: async () => ({ ok: false, error: { code: 'NO_INBOX_RELAYS', kind: 'no-inbox', message: 'x' } }) }) })
  noInbox.vm.requestOpen = true
  await noInbox.vm.onSubmitRequest({ amountSats: 1 })
  assert.equal(noInbox.vm.requestOpen, false)
  assert.equal(noInbox.vm.linkOpen, true)
  assert.deepEqual(noInbox.chat.calls.at(-1), ['refreshReachability'])

  const failing = pageOf({ chat: fakeChat({ requestMoney: async () => ({ ok: false, error: { code: 'PAYMENT_ADDRESS_UNREACHABLE', kind: 'general', message: 'Check your address.' } }) }) })
  failing.vm.requestOpen = true
  await failing.vm.onSubmitRequest({ amountSats: 1 })
  assert.equal(failing.vm.requestOpen, true)
  assert.equal(failing.vm.requestError, 'Check your address.')
  assert.equal(failing.vm.requestSubmitting, false)
})

test('closing the sheet forgets its error', () => {
  const { vm } = pageOf()
  Object.assign(vm, { requestError: 'boom', requestSubmitting: true })
  page.watch.requestOpen.call(vm, false)
  assert.deepEqual([vm.requestError, vm.requestSubmitting], ['', false])
  vm.requestError = 'keep'
  page.watch.requestOpen.call(vm, true)
  assert.equal(vm.requestError, 'keep')
})

test('share link: closes the explanation and opens the existing payment-link sheet', () => {
  const { vm } = pageOf()
  vm.linkOpen = true
  vm.shareLink()
  assert.deepEqual([vm.linkOpen, vm.getPaidOpen], [false, true])
})

test('request sheet: gets the profile address and opens the address sheet from its row and its set-up button', () => {
  const template = descriptor.template.content
  assert.match(template, /<RequestSheet[\s\S]*:address="profile\.lud16 \|\| ''"[\s\S]*@open-address="getPaidOpen = true"/)
  assert.doesNotMatch(template, /wallet-id|landing-info|ask-new/)
})

// ── menu: mute, block, add ───────────────────────────────────────────

test('mute: toggles the thread\'s flag', () => {
  const off = pageOf()
  off.vm.toggleMute()
  assert.deepEqual(off.muteCalls, [[ANNA, true]])
  const on = pageOf({ muted: true })
  on.vm.toggleMute()
  assert.deepEqual(on.muteCalls, [[ANNA, false]])
})

test('block: needs the confirmation; confirming blocks the partner and leaves the chat', async () => {
  const previous = globalThis.window
  globalThis.window = { history: { state: { back: '/x' } } }
  try {
    const { vm, blocked, pushed, notices } = pageOf({ route: { params: { pubkey: STRANGER } } })
    vm.askBlock()
    assert.equal(blocked.length, 0, 'nothing happens before the confirmation')
    assert.match(vm.confirm.title, /^Block npub1/)
    await vm.runConfirm()
    assert.equal(vm.confirm, null)
    assert.deepEqual(blocked, [STRANGER])
    assert.deepEqual(pushed, ['BACK'])
    assert.match(notices[0].message, /^Blocked npub1/)
  } finally {
    globalThis.window = previous
  }
})

test('unblock: lifts the block, stays in the chat and says so', () => {
  const { vm, unblocked, pushed, notices } = pageOf({ isBlocked: true })
  assert.equal(vm.blocked, true)
  vm.unblock()
  assert.deepEqual(unblocked, [ANNA])
  assert.deepEqual(pushed, [])
  assert.equal(notices[0].message, 'Unblocked Anna')
  assert.equal(pageOf().vm.blocked, false)
})

test('markup: a blocked partner shows the notice with Unblock instead of the money bar; the menu offers Unblock', async () => {
  const blocked = await markupOf({ isBlocked: true })
  assert.match(blocked, /class="chat-blocked" role="status"/)
  assert.match(blocked, /You blocked Anna\./)
  assert.match(blocked, /chat-blocked__action[^>]*>Unblock</)
  assert.doesNotMatch(blocked, /stub-MoneyBar/)
  const bans = (html) => html.split('data-icon="tabler:ban"').length - 1
  assert.match(blocked, /data-icon="tabler:circle-check"[^>]*><\/i><\/div><div>Unblock</)
  assert.equal(bans(blocked), 0, 'the menu offers no Block (the confirmation draws its icon only when open)')
  const open = await markupOf()
  assert.match(open, /stub-MoneyBar/)
  assert.doesNotMatch(open, /chat-blocked/)
  assert.equal(bans(open), 1, 'the menu Block item')
  assert.doesNotMatch(open, /data-icon="tabler:circle-check"/)
})

test('add contact: opens the existing add flow; saving closes it', () => {
  const { vm } = pageOf({ route: { params: { pubkey: STRANGER } } })
  vm.addContact()
  assert.equal(vm.addOpen, true)
  vm.onContactSaved()
  assert.equal(vm.addOpen, false)
})

// ── viewport ─────────────────────────────────────────────────────────

test('viewport: follows the visible viewport and scrolls to the newest message only when the height changed', () => {
  const previous = globalThis.window
  const scrolled = []
  try {
    const viewport = { height: 500.4, offsetTop: 12.2 }
    globalThis.window = { visualViewport: viewport }
    const { vm } = pageOf()
    vm.$refs.thread = { scrollToBottom: () => scrolled.push(1) }
    vm.syncViewport()
    assert.deepEqual(vm.viewportStyle, { height: '500px', transform: 'translateY(12px)' })
    assert.equal(scrolled.length, 1)
    vm.syncViewport()
    assert.equal(scrolled.length, 1, 'same height: no jump')
    viewport.height = 300
    vm.syncViewport()
    assert.equal(scrolled.length, 2)
    assert.deepEqual(pageOf().vm.viewportStyle, {}, 'no viewport reading yet: CSS height')
  } finally {
    globalThis.window = previous
  }
})

// ── markup ───────────────────────────────────────────────────────────

/**
 * Render the real template over a page stand-in: the stand-in's properties are
 * the render context, the child components are the stubs above, the Quasar
 * layout components are plain containers.
 */
async function render(vm) {
  const app = Vue.createSSRApp({
    render: () => Vue.h({ ssrRender: page.ssrRender, components: page.components, data: () => vm }),
  })
  app.config.globalProperties.$t = t
  app.config.warnHandler = () => {}
  const container = (tag) => ({ inheritAttrs: false, render() { return Vue.h(tag, {}, this.$slots.default?.()) } })
  for (const name of ['q-page', 'q-dialog', 'q-menu', 'q-list', 'q-item', 'q-item-section', 'q-separator', 'q-spinner']) {
    app.component(name, container('div'))
  }
  return ServerRenderer.renderToString(app)
}

const markupOf = (options) => render(pageOf(options).vm)

test('markup: no identity shows the friendly state with a way to /identity', async () => {
  const html = await markupOf({ available: false })
  assert.match(html, /Set up your identity to use the chat\./)
  assert.match(html, /Set up identity/)
  assert.doesNotMatch(html, /stub-ChatHeader/)
})

test('markup: loading shows a spinner and no header', async () => {
  const html = await markupOf({ scope: null })
  assert.match(html, /role="status"/)
  assert.doesNotMatch(html, /stub-ChatHeader/)
})

test('markup: a contact without a Nostr profile says there is no chat and links to the profile', async () => {
  const html = await markupOf({ route: { params: { id: 'addr-2' } } })
  assert.match(html, /Manual Mike has no Nostr profile, so there is no chat\. You can still pay them\./)
})

test('markup: the chat has header, thread, money bar and dialogs; a stranger gets the banner', async () => {
  const known = await markupOf()
  for (const part of ['stub-ChatHeader', 'stub-ChatThread', 'stub-MoneyBar', 'stub-RequestSheet', 'stub-IdentityGetPaidSheet', 'stub-AddressBookModal']) {
    assert.match(known, new RegExp(part), part)
  }
  assert.doesNotMatch(known, /stub-UnknownSenderBanner/)
  const stranger = await markupOf({ route: { params: { pubkey: STRANGER } } })
  assert.match(stranger, /stub-UnknownSenderBanner/)
})

test('markup: the empty state explains a contact who only takes payments', async () => {
  const normal = await markupOf()
  assert.match(normal, /Nothing here yet\. Request or send money to get started\./)
  const paymentsOnly = await markupOf({ chat: fakeChat({ paymentsOnly: { value: true } }) })
  assert.match(paymentsOnly, /Anna can&#39;t receive messages yet\. You can still send money\./)
})

test('style contract: 44 pt targets on the buttons the page owns, safe areas respected', () => {
  const css = descriptor.styles.map((block) => block.content).join('\n')
  assert.match(css, /\.chat-state__back \{[^}]*width: 44px;[^}]*height: 44px;/)
  assert.match(css, /\.chat-state__action \{[^}]*min-height: 46px;/)
  assert.match(css, /var\(--safe-top, 0px\)/)
  assert.match(css, /var\(--safe-bottom, 0px\)/)
  assert.match(css, /100dvh/)
})
