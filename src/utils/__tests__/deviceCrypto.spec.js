/**
 * Device-key encryption: round trips through the real Web Crypto AES-GCM.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/deviceCrypto.spec.js
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'

const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)) },
  removeItem: (key) => { memory.delete(key) },
}

const { encryptString, decryptString } = await import('../deviceCrypto.js')

test('a short text round trips', async () => {
  const envelope = await encryptString('hello')
  assert.notEqual(envelope, 'hello')
  assert.equal(await decryptString(envelope), 'hello')
})

test('a large text round trips (the chat history is one envelope)', async () => {
  // Far beyond the ~64K argument limit that spreading bytes into
  // String.fromCharCode runs into.
  const big = 'm'.repeat(1_500_000) + '\u{1F989}'
  assert.equal(await decryptString(await encryptString(big)), big)
})
