/**
 * Encrypted, per-identity persistence for the contact chat.
 *
 * One IndexedDB record per identity pubkey; its value is the chat state as JSON,
 * encrypted with the device key (`utils/deviceCrypto`). Nothing readable is ever
 * written: not the messages, not the partner pubkeys, not the invoices. Kept in
 * its own database, apart from `kitStorage` and the SDK databases, so wiping one
 * never touches another.
 *
 * Where IndexedDB does not exist (tests, SSR) an in-memory map stands in, never a
 * thrown error. Both the backend and the cipher are injectable
 * (`createDmStorage`), which is how the tests run without a browser.
 *
 * Failure contract:
 *   - a record that cannot be decrypted or parsed is treated as absent: `null`
 *     (it is logged without its content, and the next save replaces it);
 *   - a backend that cannot be reached throws, so a caller never mistakes
 *     "storage is down" for "there is no history" and overwrites it.
 */

import { encryptString, decryptString } from './deviceCrypto.js'

const DB_NAME = 'buhoGO-chat'
const STORE = 'state'
const KEY_PREFIX = 'chat:'
const HEX_PUBKEY = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------------------
// Backends: { get(key), set(key, value), delete(key) }
// ---------------------------------------------------------------------------

/** In-memory backend: the fallback without IndexedDB, and the test double. */
export function createMemoryBackend() {
  const map = new Map()
  return {
    async get(key) { return map.has(key) ? map.get(key) : null },
    async set(key, value) { map.set(key, value) },
    async delete(key) { map.delete(key) },
    async keys() { return [...map.keys()] },
  }
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'))
    request.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

function run(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = operation(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

/** IndexedDB backend. `indexedDB` is injectable. */
export function createIndexedDbBackend(indexedDB) {
  let dbPromise = null
  const db = () => (dbPromise ||= openDatabase(indexedDB).catch((error) => { dbPromise = null; throw error }))
  return {
    async get(key) {
      const result = await run(await db(), 'readonly', store => store.get(key))
      return result === undefined ? null : result
    },
    async set(key, value) { await run(await db(), 'readwrite', store => store.put(value, key)) },
    async delete(key) { await run(await db(), 'readwrite', store => store.delete(key)) },
    async keys() { return run(await db(), 'readonly', store => store.getAllKeys()) },
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function recordKey(pubkey) {
  const hex = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : ''
  if (!HEX_PUBKEY.test(hex)) throw new TypeError('dmStorage: pubkey must be 64 hex characters')
  return KEY_PREFIX + hex
}

/**
 * @param {object} [options]
 * @param {{ get, set, delete }} [options.backend] Defaults to IndexedDB, else memory.
 * @param {{ encrypt(plain: string): Promise<string>, decrypt(envelope: string): Promise<string> }} [options.cipher]
 *   Defaults to the device key.
 * @param {(message: string, detail?: object) => void} [options.warn] Never receives content.
 */
export function createDmStorage({
  backend = globalThis.indexedDB ? createIndexedDbBackend(globalThis.indexedDB) : createMemoryBackend(),
  cipher = { encrypt: encryptString, decrypt: decryptString },
  warn = (message, detail) => console.warn(message, detail ?? ''),
} = {}) {
  return {
    /**
     * @param {string} pubkey Identity pubkey (64 hex).
     * @returns {Promise<object | null>} The saved state; null when there is none or
     *   it is unreadable. Throws only when the backend itself fails.
     */
    async loadChatState(pubkey) {
      const envelope = await backend.get(recordKey(pubkey))
      if (envelope === null || envelope === undefined) return null
      try {
        const state = JSON.parse(await cipher.decrypt(envelope))
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('not an object')
        return state
      } catch (error) {
        // Name only the failure class: the message could echo ciphertext or JSON.
        warn('[dmStorage] chat record unreadable, ignoring it', { reason: error?.name || 'Error' })
        return null
      }
    },

    /**
     * @param {string} pubkey
     * @param {object} state JSON-serialisable.
     */
    async saveChatState(pubkey, state) {
      const key = recordKey(pubkey)
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError('dmStorage: state must be an object')
      }
      await backend.set(key, await cipher.encrypt(JSON.stringify(state)))
    },

    /** Remove one identity's chat history. Resolves even when there was none. */
    async deleteChatState(pubkey) {
      await backend.delete(recordKey(pubkey))
    },

    /** Receipt identities only: prevent reusing a payment after changing identity. */
    async loadSettledTransactionKeys(exceptOwner) {
      const excluded = recordKey(exceptOwner)
      const keys = new Set()
      for (const key of await backend.keys()) {
        const owner = String(key).startsWith(KEY_PREFIX) ? String(key).slice(KEY_PREFIX.length) : ''
        if (!HEX_PUBKEY.test(owner) || key === excluded) continue
        const state = await this.loadChatState(owner)
        for (const settlement of Object.values(state?.settlements || {})) {
          const hash = typeof settlement?.paymentHash === 'string' ? settlement.paymentHash.toLowerCase() : ''
          if (HEX_PUBKEY.test(hash)) keys.add(hash)
          if (typeof settlement?.transactionKey === 'string') keys.add(settlement.transactionKey)
        }
      }
      return keys
    },

    /** Remove every identity's chat history (the identities themselves were erased). */
    async deleteAllChatStates() {
      const keys = await backend.keys()
      await Promise.all(keys.filter(key => String(key).startsWith(KEY_PREFIX)).map(key => backend.delete(key)))
    },
  }
}

let shared = null
const app = () => (shared ||= createDmStorage())

export const loadChatState = pubkey => app().loadChatState(pubkey)
export const saveChatState = (pubkey, state) => app().saveChatState(pubkey, state)
export const deleteChatState = pubkey => app().deleteChatState(pubkey)
export const deleteAllChatStates = () => app().deleteAllChatStates()
export const loadSettledTransactionKeys = owner => app().loadSettledTransactionKeys(owner)
