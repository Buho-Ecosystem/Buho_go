import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as SSR from 'vue/server-renderer'
import * as VueI18n from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { usePaymentPreferencesStore } from '../../stores/paymentPreferences.js'
import * as amountFormatting from '../../utils/amountFormatting.js'
import * as walletNames from '../../utils/walletNames.js'

const sfc = createRequire(import.meta.url)('@vue/compiler-sfc')
const source = readFileSync(new URL('../settings/PreferredPaymentWalletSheet.vue', import.meta.url), 'utf8')
const { descriptor } = sfc.parse(source)
const t = key => key
let preferences, walletStore

function evaluate(source, dependencies) {
  const { code } = transformSync(source, { format: 'cjs' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`)
    return dependencies[name]
  }, module, module.exports)
  return module.exports
}

const component = evaluate(descriptor.script.content, {
  '@iconify/vue': { Icon: { props: ['icon'], render() { return Vue.h('i', { 'data-icon': this.icon }) } } },
  '../../stores/wallet.js': { useWalletStore: () => walletStore },
  '../../stores/paymentPreferences.js': { usePaymentPreferencesStore: () => preferences },
  '../../utils/amountFormatting.js': amountFormatting,
  '../../utils/walletNames.js': walletNames,
  '../WalletBrandMark.vue': { props: ['type'], render() { return Vue.h('i', { 'data-wallet-brand': this.type }) } },
  '../HiddenAmount.vue': { render() { return Vue.h('span', {}, walletStore.balanceHidden ? '••••' : this.$slots.default?.()) } },
}).default
const template = sfc.compileTemplate({ source: descriptor.template.content, filename: 'PreferredPaymentWalletSheet.vue', id: 'test', ssr: true, ssrCssVars: [] })
assert.deepEqual(template.errors, [])
component.ssrRender = evaluate(template.code, { vue: Vue, 'vue/server-renderer': SSR }).ssrRender

beforeEach(() => {
  const values = new Map()
  globalThis.localStorage = {
    fail: false,
    getItem: key => values.get(key) || null,
    setItem(key, value) { if (this.fail) throw new Error('full'); values.set(key, String(value)) },
  }
  setActivePinia(createPinia())
  preferences = usePaymentPreferencesStore()
  preferences.initialize()
  walletStore = {
    wallets: [{ id: 'home', name: 'Everyday', type: 'spark' }, { id: 'travel', name: 'Travel', type: 'lnbits' }],
    activeWalletId: 'home', hydrated: true, savedStateLoaded: true,
    useBip177Format: true, balanceHidden: false,
    getDisplayBalance: id => ({ known: id === 'home', balance: 84260 }),
    whenHydrated: () => Promise.resolve(),
  }
})

async function render() {
  const app = Vue.createSSRApp(component, { modelValue: true })
  app.config.globalProperties.$t = t
  const shell = { render() { return Vue.h('div', {}, this.$slots.default?.()) } }
  app.component('q-dialog', shell)
  app.component('q-card', shell)
  return SSR.renderToString(app)
}

function vm() {
  const events = []
  const instance = { ...component.data(), preferences, walletStore, modelValue: true, $: { uid: 1 }, $t: t,
    $emit: (...args) => events.push(args) }
  for (const [key, computed] of Object.entries(component.computed)) {
    Object.defineProperty(instance, key, typeof computed === 'function'
      ? { get: () => computed.call(instance) }
      : { get: () => computed.get.call(instance), set: value => computed.set.call(instance, value) })
  }
  for (const [key, method] of Object.entries(component.methods)) instance[key] = method.bind(instance)
  instance.resetDraft()
  return { instance, events }
}

test('settings picker renders Automatic plus real wallets, native radios, brands and balance privacy', async () => {
  const html = await render()
  assert.equal((html.match(/type="radio"/g) || []).length, 3)
  assert.match(html, /data-wallet-id="automatic"[^>]*checked/)
  assert.match(html, /data-wallet-brand="spark"/)
  assert.match(html, /data-wallet-brand="lnbits"/)
  assert.match(html, /Everyday/)
  assert.match(html, /Travel/)
  assert.match(html, /Balance not loaded yet/)
  assert.match(html, />Save</)
  walletStore.balanceHidden = true
  const privateHtml = await render()
  assert.match(privateHtml, /••••/)
  assert.doesNotMatch(privateHtml, /84[, .]?260/)
})

test('selection is a draft: cancellation does not save or switch the home wallet', () => {
  preferences.setPreferred('home')
  const { instance, events } = vm()
  instance.choose('travel')
  assert.equal(preferences.preferredWalletId, 'home')
  instance.open = false
  assert.equal(preferences.preferredWalletId, 'home')
  assert.equal(walletStore.activeWalletId, 'home')
  assert.deepEqual(events, [['update:modelValue', false]])
})

test('saving a preference or Automatic closes only after a durable save, without switching wallets', () => {
  const { instance, events } = vm()
  instance.choose('travel')
  instance.save()
  assert.equal(preferences.preferredWalletId, 'travel')
  assert.equal(walletStore.activeWalletId, 'home')
  assert.deepEqual(events, [['saved', 'travel'], ['update:modelValue', false]])
  instance.choose(null)
  instance.save()
  assert.equal(preferences.preferredWalletId, null)
  assert.equal(preferences.shouldPrompt, false)
})

test('removing the chosen wallet while the picker is open prevents saving a stale selection', () => {
  preferences.setPreferred('home')
  const { instance, events } = vm()
  instance.choose('travel')
  walletStore.wallets = walletStore.wallets.filter(wallet => wallet.id !== 'travel')
  assert.equal(instance.canSave, false)
  instance.save()
  assert.equal(preferences.preferredWalletId, 'home')
  assert.deepEqual(events, [])
})

test('a missing preferred wallet is explained and waits for an explicit replacement', async () => {
  preferences.setPreferred('removed')
  const html = await render()
  assert.match(html, /This wallet is no longer available/)
  assert.match(html, /class="form-sheet-primary"[^>]*disabled/)
  assert.equal(preferences.preferredWalletId, 'removed')
  const { instance } = vm()
  instance.choose(null)
  assert.equal(instance.canSave, true)
})

test('failed persistence stays in the picker and reports an actionable error', () => {
  preferences.setPreferred('home')
  const { instance, events } = vm()
  instance.choose('travel')
  localStorage.fail = true
  instance.save()
  assert.equal(instance.error, "Couldn't save this choice. Try again.")
  assert.equal(preferences.preferredWalletId, 'home')
  assert.deepEqual(events, [])
})


const promptSource = readFileSync(new URL('../DefaultPaymentWalletDialog.vue', import.meta.url), 'utf8')
const promptDescriptor = sfc.parse(promptSource).descriptor
const prompt = evaluate(promptDescriptor.script.content, { '@iconify/vue': { Icon: { render() { return Vue.h('i') } } }, 'vue-i18n': VueI18n }).default
const promptTemplate = sfc.compileTemplate({ source: promptDescriptor.template.content, filename: 'DefaultPaymentWalletDialog.vue', id: 'prompt-test', ssr: true, ssrCssVars: [] })
assert.deepEqual(promptTemplate.errors, [])
prompt.ssrRender = evaluate(promptTemplate.code, { vue: Vue, 'vue/server-renderer': SSR }).ssrRender

test('default-wallet popup uses short actionable copy and keeps a failed save in the same popup', async () => {
  const app = Vue.createSSRApp(prompt, { modelValue: true, walletName: 'Travel', error: "Couldn't save this choice. Try again." })
  app.use(VueI18n.createI18n({ legacy: true, locale: 'en', messages: { en: {
    'Use {name} for future payments?': 'Use {name} for future payments?',
    'You can change this in Settings.': 'You can change this in Settings.',
    'Use {name}': 'Use {name}', 'Not now': 'Not now',
  } } }))
  const shell = { render() { return Vue.h('div', {}, this.$slots.default?.()) } }
  app.component('q-dialog', shell); app.component('q-card', shell)
  const html = await SSR.renderToString(app)
  assert.match(html, /<strong[^>]*>Travel<\/strong>/)
  assert.match(html.replace(/<[^>]*>/g, ''), /Use Travel for future payments\?/)
  assert.match(html, /You can change this in Settings/)
  assert.match(html, />Use Travel</)
  assert.match(html, />Not now</)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /preferred|preference|automatically sends/)
})

test('Escape or backdrop dismissal uses the same Not now action', () => {
  const emitted = []
  prompt.computed.open.set.call({ $emit: (...event) => emitted.push(event) }, false)
  assert.deepEqual(emitted, [['dismiss']])
})
