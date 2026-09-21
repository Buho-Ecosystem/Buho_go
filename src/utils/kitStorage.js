/**
 * Durable, app-owned storage for emergency exit kits. Kept apart from the
 * SDK's own databases on purpose: removing a wallet wipes those, and the kit
 * is exactly what must survive that. IndexedDB in the browser; an in-memory
 * map where IndexedDB does not exist (tests, SSR), never a thrown error.
 */

const DB_NAME = 'buhoGO-exit-kits';
const STORE = 'kits';

function memoryStore() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async keys() { return [...map.keys()]; },
  };
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function run(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function indexedDbStore(indexedDB) {
  let dbPromise = null;
  const db = () => (dbPromise ||= openDatabase(indexedDB).catch(error => { dbPromise = null; throw error; }));
  return {
    async get(key) { const result = await run(await db(), 'readonly', store => store.get(key)); return result === undefined ? null : result; },
    async set(key, value) { await run(await db(), 'readwrite', store => store.put(value, key)); },
    async delete(key) { await run(await db(), 'readwrite', store => store.delete(key)); },
    async keys() { return run(await db(), 'readonly', store => store.getAllKeys()); },
  };
}

let shared = null;

/** The app-wide kit store. `indexedDB` is injectable for tests. */
export function openKitStorage({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return memoryStore();
  return indexedDbStore(indexedDB);
}

export function kitStorage() {
  return (shared ||= openKitStorage());
}

export const kitKey = sparkAddress => `kit:${String(sparkAddress || '').toLowerCase()}`;
