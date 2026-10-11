/**
 * Contact chat entry points on existing screens: the Messages sheet's
 * view-model (threadRows.js), the sheet itself, the address-book tap routing,
 * and the contract of the small additions to the other screens.
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
const Icon = { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } }

function run(code, extra = {}) {
  const { code: cjs } = transformSync(code, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', cjs)(name => (name in extra ? extra[name] : {}), module, module.exports)
  return module.exports
}

const readSrc = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const chatFormat = run(readSrc('components/chat/chatFormat.js'), { '../../utils/amountFormatting.js': amountFormatting })
const protocol = {
  MESSAGE_TYPE: { TEXT: 'text', REQUEST: 'request', STATUS: 'status', PAYMENT: 'payment', REACTION: 'reaction' },
  REQUEST_STATUS: { PAID: 'paid', DECLINED: 'declined', CANCELLED: 'cancelled', REMINDER: 'reminder' },
}
const notificationCopy = run(readSrc('services/dm/notificationCopy.js'), { './protocol.js': protocol })
const rows = run(readSrc('components/chat/threadRows.js'), {
  '../../services/dm/notificationCopy.js': notificationCopy,
  '../../services/dm/protocol.js': protocol,
  './chatFormat.js': chatFormat,
})

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)
const sec = (ms) => Math.floor(ms / 1000)
const fmt = (sats) => `${sats} sats`
const env = (contacts = {}) => ({
  t, formatAmount: fmt, nowMs: NOW,
  findContact: (pk) => contacts[pk] || null,
  toNpub: (pk) => `npub1${pk}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
})
const msg = (extra) => ({ id: 'm', outgoing: false, createdAt: sec(NOW), text: '', ...extra })
const thread = (partner, lastMessage, extra = {}) => ({ partner, lastMessage, lastActivityAt: lastMessage.createdAt, unread: 0, muted: false, ...extra })

// ── view-model ───────────────────────────────────────────────────────

test('badge text caps at 99+ and hides at zero', () => {
  assert.equal(rows.badgeText(0), '')
  assert.equal(rows.badgeText(7), '7')
  assert.equal(rows.badgeText(99), '99')
  assert.equal(rows.badgeText(100), '99+')
})

test('preview: money is spelled out, from the right side', () => {
  const e = env()
  const p = (m) => rows.previewLine(m, e)
  assert.equal(p(msg({ type: 'request', request: { amountSats: 5000 } })), 'Requested 5000 sats')
  assert.equal(p(msg({ type: 'payment', payment: { amountSats: 800 } })), 'Says they sent you 800 sats')
  assert.equal(p(msg({ type: 'status', status: { value: 'paid' } })), 'Says they paid your request')
  assert.equal(p(msg({ outgoing: true, type: 'request', request: { amountSats: 5000 } })), 'You requested 5000 sats')
  assert.equal(p(msg({ outgoing: true, type: 'payment', payment: { amountSats: 800 } })), 'You sent 800 sats')
  assert.equal(p(msg({ outgoing: true, type: 'status', status: { value: 'cancelled' } })), 'You cancelled a request')
  assert.equal(p(msg({ outgoing: true, type: 'status', status: { value: 'reminder' } })), 'You sent a reminder')
  assert.equal(p(msg({ type: 'text', text: 'hello' })), 'hello')
  assert.equal(p(msg({ outgoing: true, type: 'text', text: 'hi\n there' })), 'You: hi there')
  assert.equal(p(msg({ type: 'text', text: '  ' })), 'New message')
  assert.equal(p(null), '')
})

test('time: clock today, Yesterday, then a short date', () => {
  const opts = { t, nowMs: NOW, locale: 'en-US' }
  assert.match(rows.threadTime(sec(NOW) - 60, opts), /\d{1,2}:\d{2}/)
  assert.equal(rows.threadTime(sec(NOW) - 86400, opts), 'Yesterday')
  assert.doesNotMatch(rows.threadTime(sec(NOW) - 5 * 86400, opts), /:|Yesterday/)
  assert.equal(rows.threadTime(NaN, opts), '')
})

test('rows: a contact opens its chat, an unknown sender the unknown thread', () => {
  const contacts = { aa: { id: 'c1', name: 'Anna', nostr_pubkey: 'aa' } }
  const [known, unknown] = rows.buildThreadRows([
    thread('aa', msg({ type: 'text', text: 'hi' }), { unread: 3 }),
    thread('bb', msg({ type: 'text', text: 'yo' }), { muted: true, unread: 120 }),
  ], env(contacts))
  assert.deepEqual([known.known, known.name, known.to, known.badge], [true, 'Anna', '/address-book/c1/chat', '3'])
  assert.equal(unknown.known, false)
  assert.equal(unknown.to, '/messages/bb')
  assert.match(unknown.name, /^npub1/)
  assert.ok(unknown.name.length < 20, 'only a fragment of the npub is shown')
  assert.deepEqual([unknown.badge, unknown.muted], ['99+', true])
})

test('address-book tap: chat for Nostr contacts while the chat runs, contact page otherwise', () => {
  assert.equal(rows.contactTapPath({ id: 'c1', nostr_pubkey: 'aa' }, true), '/address-book/c1/chat')
  assert.equal(rows.contactTapPath({ id: 'c1', nostr_pubkey: 'aa' }, false), '/address-book/c1')
  assert.equal(rows.contactTapPath({ id: 'c2' }, true), '/address-book/c2')
  assert.equal(rows.contactTapPath({ id: 'c3', nostr_pubkey: '' }, true), '/address-book/c3')
})

// ── sheet ────────────────────────────────────────────────────────────

function loadSheet(storeState) {
  const { descriptor } = sfc.parse(readSrc('components/chat/MessagesSheet.vue'))
  const ContactAvatar = { props: ['entry'], render() { return Vue.h('span', { class: 'av' }) } }
  const component = run(descriptor.script.content, {
    'nostr-core': { nip19: { npubEncode: env().toNpub } },
    '@iconify/vue': { Icon },
    '../AddressBook/ContactAvatar.vue': ContactAvatar,
    '../../stores/messages.js': { useMessagesStore: () => storeState.messages },
    '../../stores/addressBook.js': { useAddressBookStore: () => storeState.addressBook },
    '../../stores/wallet.js': { useWalletStore: () => ({ useBip177Format: false }) },
    './chatFormat.js': chatFormat,
    './threadRows.js': rows,
    './chatTokens.css': {},
    // A BuhoGO identity: no signer app, so no notice.
    './SignerAppNotice.vue': { render: () => null },
    '../../composables/useSignerAppNotice.js': {
      useSignerAppNotice: () => ({ state: Vue.ref(null), kind: Vue.ref('derived'), busy: Vue.ref(false), turnOn: () => {}, retry: () => {} }),
    },
  }).default
  const { code, errors } = sfc.compileTemplate({ source: descriptor.template.content, filename: 'MessagesSheet.vue', id: 'ms', ssr: true })
  assert.deepEqual(errors, [])
  component.ssrRender = run(code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender
  return component
}

const state = () => ({
  messages: {
    knownThreads: [thread('aa', msg({ type: 'request', request: { amountSats: 5000 } }), { unread: 2 })],
    unknownThreads: [thread('bb', msg({ type: 'text', text: 'hello stranger' }))],
  },
  addressBook: { findContactByPubkey: (pk) => (pk === 'aa' ? { id: 'c1', name: 'Anna' } : null) },
})

async function renderSheet(component) {
  const app = Vue.createSSRApp({ render: () => Vue.h(component, { modelValue: true }) })
  app.config.globalProperties.$t = t
  app.config.warnHandler = () => {}
  app.component('q-dialog', { inheritAttrs: false, render() { return Vue.h('div', {}, this.$slots.default?.()) } })
  return ServerRenderer.renderToString(app)
}

test('messages sheet: contacts first, then an unknown section, with previews and badge', async () => {
  const html = await renderSheet(loadSheet(state()))
  assert.match(html, /<h2[^>]*>Messages<\/h2>/)
  assert.match(html, /Anna/)
  assert.match(html, /Requested [^<]*5[.,]?000[^<]* sats/)
  assert.match(html, /thread-row__badge[^>]*>2</)
  assert.match(html, /<h3[^>]*>Not in your contacts<\/h3>/)
  assert.ok(html.indexOf('Anna') < html.indexOf('Not in your contacts'))
  assert.match(html, /hello stranger/)
})

test('messages sheet: no unknown heading without unknown senders, empty state without threads', async () => {
  const s = state()
  s.messages.unknownThreads = []
  assert.doesNotMatch(await renderSheet(loadSheet(s)), /Not in your contacts/)
  s.messages.knownThreads = []
  assert.match(await renderSheet(loadSheet(s)), /No messages yet/)
})

test('messages sheet: tapping a row navigates first, then closes the sheet', async () => {
  const component = loadSheet(state())
  const calls = []
  await component.methods.open.call({
    $emit: (...a) => calls.push(['emit', ...a]),
    $router: { push: async (p) => { calls.push(['push', p]); await Promise.resolve() } },
  }, { to: '/address-book/c1/chat' })
  // The sheet closes only once the navigation has settled, so the list never flashes back in between.
  assert.deepEqual(calls, [['push', '/address-book/c1/chat'], ['emit', 'update:modelValue', false]])
})

// ── contract of the small additions ──────────────────────────────────

test('entry points hide themselves behind the runtime availability; messages live in the address book', () => {
  const book = readSrc('components/AddressBook/AddressBookList.vue')
  assert.match(book, /<MessagesSheet v-if="chatAvailable"/)
  assert.match(book, /this\.chatAvailable && this\.messages\.threadsSorted\.length > 0/)
  assert.match(book, /this\.chatAvailable && entry\.nostr_pubkey/)
  assert.doesNotMatch(readSrc('pages/identity/IdentityHomePage.vue'), /MessagesSheet/, 'one home for messages')
  assert.match(readSrc('pages/Settings.vue'), /v-if="notificationsStore\.supported && chatAvailable"/)
  // The app badge counts contacts only: strangers wait inside Messages.
  assert.match(readSrc('components/MenuOverlay.vue'), /this\.chatAvailable \? this\.messagesStore\.knownUnread : 0/)
})

test('chat-messages switch is bound to the store and disabled without notifications', () => {
  const settings = readSrc('pages/Settings.vue')
  assert.match(settings, /:model-value="notificationsStore\.messagesEnabled"\s+:disable="!notificationsStore\.canNotify"\s+@update:model-value="notificationsStore\.setMessagesEnabled"/)
})
