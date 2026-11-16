import { cloneKiosk, kioskError, KIOSK_MERCHANT_VERSION } from '../utils/kioskMerchant.js';

const DATABASE = 'buhoGO_kiosk_merchant_v1';
const RECORDS = 'records';
const metadata = data => ({ version: data.version, revision: data.revision, setupCompleted: data.setupCompleted, catalogCurrency: data.catalogCurrency, entryMode: data.entryMode, activeOrderId: data.activeOrderId });

/** One merchant repository. Individual records share one atomic transaction; a keypress never rewrites the ledger. */
export function createKioskMerchantStorage({ indexedDB = globalThis.indexedDB, name = DATABASE } = {}) {
  let connection;
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(kioskError('KIOSK_STORAGE_UNAVAILABLE', 'This browser cannot safely save register records.')); return; }
      let request;
      try { request = indexedDB.open(name, KIOSK_MERCHANT_VERSION); } catch { reject(kioskError('KIOSK_STORAGE_UNAVAILABLE', 'Register storage is unavailable.')); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(RECORDS)) request.result.createObjectStore(RECORDS, { keyPath: 'key' }); };
      request.onerror = () => { connection = null; reject(kioskError('KIOSK_STORAGE_UNAVAILABLE', 'Register storage could not be opened.')); };
      request.onblocked = () => { connection = null; reject(kioskError('KIOSK_STORAGE_UNAVAILABLE', 'Close another BuhoGO tab before opening these register records.')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    });
    return connection;
  }
  async function load() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readonly');
      const request = tx.objectStore(RECORDS).getAll();
      let rows;
      request.onsuccess = () => { rows = request.result; };
      tx.onerror = tx.onabort = () => reject(kioskError('KIOSK_STORAGE_UNAVAILABLE', 'Register records could not be read.'));
      tx.oncomplete = () => {
        if (!rows.length) { resolve(null); return; }
        const meta = rows.find(row => row.key === 'meta')?.value;
        if (!meta) { reject(kioskError('KIOSK_STORAGE_UNREADABLE', 'The register records are incomplete. Keep a backup before replacing them.')); return; }
        const catalog = rows.find(row => row.key === 'catalog')?.value;
        const draft = rows.find(row => row.key === 'draft')?.value;
        resolve({ ...meta, products: catalog?.products, categories: catalog?.categories, draft, orders: rows.filter(row => row.key.startsWith('order:')).map(row => row.value).sort((a, b) => a.createdAt - b.createdAt), savedBaskets: rows.filter(row => row.key.startsWith('basket:')).map(row => row.value).sort((a, b) => a.createdAt - b.createdAt) });
      };
    });
  }
  async function commit(next, previous) {
    const db = await open();
    const puts = [{ key: 'meta', value: metadata(next) }];
    const deletes = [];
    if (!previous || next.products !== previous.products || next.categories !== previous.categories) puts.push({ key: 'catalog', value: { products: next.products, categories: next.categories } });
    if (!previous || next.draft !== previous.draft) puts.push({ key: 'draft', value: next.draft });
    for (const [collection, prefix] of [['orders', 'order:'], ['savedBaskets', 'basket:']]) {
      if (previous && next[collection] === previous[collection]) continue;
      const old = new Map((previous?.[collection] || []).map(value => [value.id, value]));
      for (const value of next[collection]) {
        if (old.get(value.id) !== value) puts.push({ key: prefix + value.id, value });
        old.delete(value.id);
      }
      for (const id of old.keys()) deletes.push(prefix + id);
    }
    // Strip Vue proxies only from changed records, never JSON-serialize the whole history for a draft edit.
    const records = puts.map(cloneKiosk);
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(RECORDS, 'readwrite', { durability: 'strict' }); }
      catch { tx = db.transaction(RECORDS, 'readwrite'); }
      const store = tx.objectStore(RECORDS);
      let conflict = false;
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(kioskError(conflict ? 'KIOSK_STORAGE_CONFLICT' : 'KIOSK_STORAGE_FAILED', conflict ? 'The register changed in another tab. Reload it before continuing.' : 'The register could not save this change. Free some device storage and try again.'));
      const request = store.get('meta');
      request.onsuccess = () => {
        if ((request.result?.value?.revision || 0) !== (previous?.revision || 0)) { conflict = true; tx.abort(); return; }
        if (!request.result) {
          store.put(cloneKiosk({ key: 'catalog', value: { products: next.products, categories: next.categories } }));
          store.put(cloneKiosk({ key: 'draft', value: next.draft }));
        }
        for (const record of records) store.put(record);
        for (const key of deletes) store.delete(key);
      };
    });
  }
  return { load, commit, async close() { const db = await connection; db?.close(); connection = null; } };
}
