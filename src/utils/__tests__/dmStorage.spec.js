/**
 * dmStorage: the chat's encrypted per-identity record.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/dmStorage.spec.js
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'

class MemoryStorage {
  constructor() { this._data = new Map() }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null }
  setItem(key, value) { this._data.set(key, String(value)) }
  removeItem(key) { this._data.delete(key) }
}
globalThis.localStorage = new MemoryStorage()

const { createDmStorage, createMemoryBackend } = await import('../dmStorage.js')

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

/** Reversible stand-in cipher: lets a test see what reached the backend. */
const fakeCipher = {
  encrypt: async plain => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async envelope => {
    if (!envelope.startsWith('enc:')) throw new Error('bad envelope')
    return Buffer.from(envelope.slice(4), 'base64').toString()
  },
}

function setup(overrides = {}) {
  const backend = createMemoryBackend()
  const warnings = []
  const storage = createDmStorage({ backend, cipher: fakeCipher, warn: (m, d) => warnings.push([m, d]), ...overrides })
  return { backend, storage, warnings }
}

test('round trip returns what was saved', async () => {
  const { storage } = setup()
  const state = { version: 1, threads: { [BOB]: { messages: [{ id: 'x', text: 'héllo 🔒' }] } } }
  await storage.saveChatState(ALICE, state)
  assert.deepEqual(await storage.loadChatState(ALICE), state)
})

test('unknown identity loads as null', async () => {
  const { storage } = setup()
  assert.equal(await storage.loadChatState(ALICE), null)
})

test('identities are stored apart', async () => {
  const { storage } = setup()
  await storage.saveChatState(ALICE, { who: 'alice' })
  await storage.saveChatState(BOB, { who: 'bob' })
  assert.deepEqual(await storage.loadChatState(ALICE), { who: 'alice' })
  assert.deepEqual(await storage.loadChatState(BOB), { who: 'bob' })
})

test('pubkey case does not matter', async () => {
  const { storage } = setup()
  await storage.saveChatState('AB'.repeat(32), { n: 1 })
  assert.deepEqual(await storage.loadChatState('ab'.repeat(32)), { n: 1 })
})

test('delete removes the record and tolerates a missing one', async () => {
  const { storage } = setup()
  await storage.saveChatState(ALICE, { n: 1 })
  await storage.deleteChatState(ALICE)
  assert.equal(await storage.loadChatState(ALICE), null)
  await storage.deleteChatState(ALICE)
})

test('the backend never sees plaintext or the partner pubkey', async () => {
  const { backend, storage } = setup({ cipher: undefined })
  const secret = 'pay me back for the pizza'
  await storage.saveChatState(ALICE, { threads: { [BOB]: { messages: [{ text: secret }] } } })
  const [key] = await backend.keys()
  const stored = await backend.get(key)
  assert.equal(typeof stored, 'string')
  assert.ok(!stored.includes(secret))
  assert.ok(!stored.includes(BOB))
  assert.deepEqual(await storage.loadChatState(ALICE), { threads: { [BOB]: { messages: [{ text: secret }] } } })
})

test('the default cipher is the device-key AES-GCM envelope', async () => {
  const { backend, storage } = setup({ cipher: undefined })
  await storage.saveChatState(ALICE, { a: 1 })
  const [key] = await backend.keys()
  const raw = Buffer.from(await backend.get(key), 'base64')
  assert.ok(raw.length > 12 + 16) // iv + GCM tag at least
})

test('an undecryptable record is null, logged without content', async () => {
  const { backend, storage, warnings } = setup()
  await backend.set(`chat:${ALICE}`, 'enc:!!!not-json-secret-content')
  assert.equal(await storage.loadChatState(ALICE), null)
  assert.equal(warnings.length, 1)
  assert.ok(!JSON.stringify(warnings).includes('secret-content'))
})

test('a record that decrypts to a non-object is null', async () => {
  const { backend, storage } = setup()
  await backend.set(`chat:${ALICE}`, await fakeCipher.encrypt('[1,2]'))
  assert.equal(await storage.loadChatState(ALICE), null)
  await backend.set(`chat:${ALICE}`, await fakeCipher.encrypt('"text"'))
  assert.equal(await storage.loadChatState(ALICE), null)
})

test('a failing backend throws instead of reporting "no history"', async () => {
  const backend = { get: async () => { throw new Error('IDB down') }, set: async () => {}, delete: async () => {} }
  const storage = createDmStorage({ backend, cipher: fakeCipher })
  await assert.rejects(() => storage.loadChatState(ALICE), /IDB down/)
})

test('invalid pubkeys and states are refused', async () => {
  const { storage } = setup()
  await assert.rejects(() => storage.saveChatState('nope', {}), TypeError)
  await assert.rejects(() => storage.saveChatState(ALICE, null), TypeError)
  await assert.rejects(() => storage.saveChatState(ALICE, []), TypeError)
  await assert.rejects(() => storage.loadChatState(undefined), TypeError)
  await assert.rejects(() => storage.deleteChatState(''), TypeError)
})

test('deleteAllChatStates removes every identity\'s record and nothing else', async () => {
  const { storage, backend } = setup()
  await storage.saveChatState('a'.repeat(64), { threads: {} })
  await storage.saveChatState('b'.repeat(64), { threads: {} })
  await backend.set('unrelated', 'keep me')
  await storage.deleteAllChatStates()
  assert.equal(await storage.loadChatState('a'.repeat(64)), null)
  assert.equal(await storage.loadChatState('b'.repeat(64)), null)
  assert.equal(await backend.get('unrelated'), 'keep me')
})
