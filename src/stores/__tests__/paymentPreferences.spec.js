import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { PAYMENT_PREFERENCES_KEY, usePaymentPreferencesStore } from '../paymentPreferences.js'

class MemoryStorage {
  data = new Map()
  failRead = false
  failWrite = false
  getItem(key) { if (this.failRead) throw new Error('blocked'); return this.data.get(key) ?? null }
  setItem(key, value) { if (this.failWrite) throw new Error('full'); this.data.set(key, String(value)) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  setActivePinia(createPinia())
})

function reloaded() {
  setActivePinia(createPinia())
  const store = usePaymentPreferencesStore()
  store.initialize()
  return store
}

test('first payment prompts only after initialization, and initialization never waits on a wallet', () => {
  const store = usePaymentPreferencesStore()
  assert.equal(store.shouldPrompt, false)
  assert.equal(store.initialize(), undefined)
  assert.equal(store.preferredWalletId, null)
  assert.equal(store.shouldPrompt, true)
})

test('saving a wallet survives restart and persists only the preference and prompt answer', () => {
  const store = usePaymentPreferencesStore()
  assert.equal(store.setPreferred('travel'), true)
  assert.equal(store.shouldPrompt, false)
  assert.deepEqual(JSON.parse(localStorage.getItem(PAYMENT_PREFERENCES_KEY)), {
    version: 1, preferredWalletId: 'travel', promptDismissed: true,
  })
  assert.equal(reloaded().preferredWalletId, 'travel')
})

test('Automatic explicitly clears the wallet without asking again next time', () => {
  const store = usePaymentPreferencesStore()
  store.setPreferred('travel')
  assert.equal(store.setPreferred(null), true)
  const next = reloaded()
  assert.equal(next.preferredWalletId, null)
  assert.equal(next.shouldPrompt, false)
})

test('Not now persists without inventing a preferred wallet', () => {
  const store = usePaymentPreferencesStore()
  assert.equal(store.dismissPrompt(), true)
  assert.equal(reloaded().shouldPrompt, false)
  assert.equal(store.preferredWalletId, null)
})

test('a deleted wallet id is retained until the person explicitly replaces it', () => {
  const store = usePaymentPreferencesStore()
  store.setPreferred('removed-wallet')
  const next = reloaded()
  assert.equal(next.preferredWalletId, 'removed-wallet')
  assert.equal(next.shouldPrompt, false)
  next.setPreferred('replacement-wallet')
  assert.equal(reloaded().preferredWalletId, 'replacement-wallet')
})

test('a full or blocked storage cannot turn a failed save into a success', () => {
  const store = usePaymentPreferencesStore()
  store.setPreferred('everyday')
  localStorage.failWrite = true
  assert.equal(store.setPreferred('travel'), false)
  assert.equal(store.preferredWalletId, 'everyday')
  assert.equal(reloaded().preferredWalletId, 'everyday')
  assert.equal(store.setPreferred(null), false)
  assert.equal(store.preferredWalletId, 'everyday')
})

test('a failed optional-prompt write still keeps the prompt dismissed for the session', () => {
  localStorage.failWrite = true
  const store = usePaymentPreferencesStore()
  assert.equal(store.dismissPrompt(), false)
  assert.equal(store.shouldPrompt, false)
  assert.equal(store.preferredWalletId, null)
})

test('unreadable, hostile and newer snapshots never break the store or become a wallet id', () => {
  for (const raw of ['{', 'null', '[]', '1', '{"version":2,"preferredWalletId":"foreign"}', '{"version":1,"preferredWalletId":{}}']) {
    localStorage.setItem(PAYMENT_PREFERENCES_KEY, raw)
    const store = reloaded()
    assert.equal(store.preferredWalletId, null, raw)
    assert.equal(store.shouldPrompt, true, raw)
  }
  localStorage.failRead = true
  assert.doesNotThrow(reloaded)
})

test('initialization is idempotent and malformed choices leave the old preference alone', () => {
  const store = usePaymentPreferencesStore()
  store.setPreferred('everyday')
  localStorage.setItem(PAYMENT_PREFERENCES_KEY, '{"version":1,"preferredWalletId":"other"}')
  store.initialize()
  assert.equal(store.preferredWalletId, 'everyday')
  for (const invalid of [undefined, '', 42, {}, ' trailing ', 'line\nbreak', 'x'.repeat(201)]) {
    assert.equal(store.setPreferred(invalid), false)
    assert.equal(store.preferredWalletId, 'everyday')
  }
})
