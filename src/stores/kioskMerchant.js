import { defineStore } from 'pinia';
import { toRaw } from 'vue';
import { createKioskMerchantStorage } from '../services/kioskMerchantStorage.js';
import {
  cloneKiosk, emptyKioskDraft, emptyKioskMerchant, exportKioskBundle, kioskCount,
  kioskCurrency, kioskDraftHasValue, kioskError, kioskIdentity, kioskSalesCsv,
  kioskText, LEGACY_KIOSK_PARKED_KEY, migrateLegacyKioskParked, newKioskId,
  normalizeKioskDraft, normalizeKioskItem, normalizeKioskMerchant, normalizeKioskOrder,
  normalizeKioskProduct, readKioskBundle,
} from '../utils/kioskMerchant.js';

// Pinia devtools gives every action a fresh wrapper Proxy. The root state
// remains stable across those wrappers and keeps repository/queue ownership intact.
const merchantKey = store => toRaw(store.$state);
const repositories = new WeakMap();
const loads = new WeakMap();
const queues = new WeakMap();
const NO_CHANGE = Symbol('no change');
const unchanged = value => ({ [NO_CHANGE]: true, value });
const safeReason = reason => /^[A-Z0-9_-]{1,80}$/i.test(reason || '') ? reason : null;
const attemptStatus = order => order.attempts.some(a => a.status === 'paid') ? 'paid' : ({ creating: 'preparing', uncertain: 'uncertain', waiting: 'waiting', expired: 'expired', failed: 'failed' }[order.attempts.find(a => a.id === order.activeAttemptId)?.status] || 'preparing');

function requireOrder(data, id) {
  const order = data.orders.find(value => value.id === id);
  if (!order) throw kioskError('KIOSK_ORDER_MISSING', 'This sale could not be found.');
  return order;
}
function changeOrder(data, id, update) {
  const previous = requireOrder(data, id);
  const order = cloneKiosk(previous);
  const result = update(order);
  if (result?.[NO_CHANGE]) return result;
  order.status = attemptStatus(order);
  const normalized = normalizeKioskOrder(order);
  data.orders = data.orders.map(value => value.id === id ? normalized : value);
  return result === undefined ? normalized : result;
}
function requireAttempt(order, attemptId) {
  const attempt = order.attempts.find(value => value.id === attemptId);
  if (!attempt) throw kioskError('KIOSK_ATTEMPT_MISSING', 'This payment could not be found.');
  return attempt;
}

/** Local merchant data and durable payment identities. No wallet/provider calls belong in this store. */
export const useKioskMerchantStore = defineStore('kioskMerchant', {
  state: () => ({ data: emptyKioskMerchant(), initialized: false, loading: false, storageError: null }),
  getters: {
    products: state => state.data.products,
    categories: state => state.data.categories,
    catalogCurrency: state => state.data.catalogCurrency,
    setupCompleted: state => state.data.setupCompleted,
    entryMode: state => state.data.entryMode,
    draft: state => state.data.draft,
    savedBaskets: state => state.data.savedBaskets,
    orders: state => state.data.orders,
    activeOrderId: state => state.data.activeOrderId,
    currentOrder: state => state.data.orders.find(order => order.id === state.data.activeOrderId) || null,
    sales: state => state.data.orders.filter(order => order.status === 'paid').sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt)),
    getOrder: state => id => state.data.orders.find(order => order.id === id) || null,
    pendingAttempts: state => state.data.orders.flatMap(order => order.attempts.filter(attempt => ['creating', 'uncertain', 'waiting', 'expired'].includes(attempt.status)).map(attempt => ({ ...attempt, orderId: order.id, attemptId: attempt.id, invoiceData: attempt.paymentHash ? { walletId: attempt.walletId, paymentHash: attempt.paymentHash, paymentRequest: attempt.paymentRequest, amountSats: attempt.amountSats, expiresAt: attempt.expiresAt, invoiceId: attempt.invoiceId } : null }))),
    canRestore: state => !state.data.products.length && !state.data.orders.length && !state.data.savedBaskets.length && !kioskDraftHasValue(state.data.draft),
  },
  actions: {
    async initialize({ storage, currency = 'USD', amountUnit = 'sats', entryMode = 'amount', legacyStorage = globalThis.localStorage } = {}) {
      if (this.initialized) return;
      if (loads.has(merchantKey(this))) return loads.get(merchantKey(this));
      if (storage) repositories.set(merchantKey(this), storage);
      if (!repositories.has(merchantKey(this))) repositories.set(merchantKey(this), createKioskMerchantStorage());
      this.loading = true;
      const load = (async () => {
        try {
          const repository = repositories.get(merchantKey(this));
          const saved = await repository.load();
          let data;
          if (saved) data = normalizeKioskMerchant(saved, currency);
          else {
            data = emptyKioskMerchant(currency);
            data.draft.amountUnit = amountUnit === 'fiat' ? 'fiat' : 'sats';
            data.entryMode = entryMode === 'products' ? 'products' : 'amount';
            let legacy;
            try { const raw = legacyStorage?.getItem(LEGACY_KIOSK_PARKED_KEY); legacy = raw ? JSON.parse(raw) : []; } catch { throw kioskError('KIOSK_STORAGE_UNREADABLE', 'Previous waiting payments could not be read. Keep the device data before trying again.'); }
            if (!Array.isArray(legacy)) throw kioskError('KIOSK_STORAGE_UNREADABLE', 'Previous waiting payments could not be read. Keep the device data before trying again.');
            if (legacy.length) {
              data.orders = migrateLegacyKioskParked(legacy, data.catalogCurrency);
              data.revision = 1;
              data = normalizeKioskMerchant(data, currency);
              await repository.commit(data, null);
              // Keep the old key as a recovery copy. The old watcher is retired by the kiosk integration.
            }
          }
          this.data = data;
          this.initialized = true;
          this.storageError = null;
        } catch (error) {
          this.storageError = error?.code || 'KIOSK_STORAGE_UNAVAILABLE';
          throw error?.code ? error : kioskError('KIOSK_STORAGE_UNAVAILABLE', 'Register records could not be opened. Reload before taking a payment.');
        } finally {
          this.loading = false;
          loads.delete(merchantKey(this));
        }
      })();
      loads.set(merchantKey(this), load);
      return load;
    },
    async reload() {
      await (queues.get(merchantKey(this)) || Promise.resolve()).catch(() => {});
      this.initialized = false;
      return this.initialize();
    },
    async flush() { await this.initialize(); await (queues.get(merchantKey(this)) || Promise.resolve()); },
    async _change(update) {
      await this.initialize();
      const queued = (queues.get(merchantKey(this)) || Promise.resolve()).catch(() => {}).then(async () => {
        const previous = this.data;
        const next = { ...previous };
        const result = update(next);
        if (result?.[NO_CHANGE]) return cloneKiosk(result.value);
        next.revision = previous.revision + 1;
        try {
          await repositories.get(merchantKey(this)).commit(next, previous);
        } catch (error) {
          this.storageError = error?.code || 'KIOSK_STORAGE_FAILED';
          throw error?.code ? error : Object.assign(kioskError('KIOSK_STORAGE_FAILED', 'The register could not save this change. Try again before continuing.'), { cause: error });
        }
        this.data = next;
        this.storageError = null;
        return result === undefined ? undefined : cloneKiosk(result);
      });
      queues.set(merchantKey(this), queued);
      return queued;
    },
    async completeSetup() { return this._change(data => { data.setupCompleted = true; return true; }); },
    async setEntryMode(mode) {
      if (!['amount', 'products'].includes(mode)) throw kioskError('KIOSK_INVALID_DATA', 'Choose Amount or Products.');
      return this._change(data => { data.entryMode = mode; return mode; });
    },
    async setCatalogCurrency(currency) {
      currency = kioskCurrency(currency);
      return this._change(data => {
        if (currency === data.catalogCurrency) return unchanged(currency);
        if (data.products.length || data.savedBaskets.length || kioskDraftHasValue(data.draft) || data.activeOrderId && requireOrder(data, data.activeOrderId).status !== 'paid') throw kioskError('KIOSK_CURRENCY_LOCKED', 'Finish the open sale and keep existing product prices in their original currency.');
        data.catalogCurrency = currency;
        data.draft = { ...emptyKioskDraft(currency), amountUnit: data.draft.amountUnit };
        return currency;
      });
    },
    async saveProduct(value) {
      return this._change(data => {
        const product = normalizeKioskProduct(value, data.catalogCurrency);
        const exists = data.products.some(p => p.id === product.id);
        data.products = exists ? data.products.map(p => p.id === product.id ? product : p) : [...data.products, product];
        if (product.category && !data.categories.includes(product.category)) data.categories = [...data.categories, product.category];
        return product;
      });
    },
    async removeProduct(id) { return this._change(data => { data.products = data.products.filter(p => p.id !== id); return true; }); },
    async saveCategory(name, previous = null) {
      name = kioskText(name);
      if (!name) throw kioskError('KIOSK_INVALID_DATA', 'Give the category a name.');
      return this._change(data => {
        if (previous && !data.categories.includes(previous)) throw kioskError('KIOSK_CATEGORY_MISSING', 'This category could not be found.');
        if (data.categories.some(category => category.toLocaleLowerCase() === name.toLocaleLowerCase() && category !== previous)) throw kioskError('KIOSK_CATEGORY_EXISTS', 'This category already exists.');
        data.categories = previous ? data.categories.map(category => category === previous ? name : category) : [...data.categories, name];
        if (previous) data.products = data.products.map(product => product.category === previous ? { ...product, category: name } : product);
        return name;
      });
    },
    async removeCategory(name) {
      return this._change(data => {
        if (data.products.some(product => product.category === name)) throw kioskError('KIOSK_CATEGORY_IN_USE', 'Move these products to another category first.');
        data.categories = data.categories.filter(category => category !== name);
        return true;
      });
    },
    async saveDraft(value) { return this._change(data => { data.draft = normalizeKioskDraft(value, data.catalogCurrency); return data.draft; }); },
    async setDraft(value) { return this.saveDraft(value); },
    async updateDraft(partial) { return this._change(data => { data.draft = normalizeKioskDraft({ ...data.draft, ...partial }, data.catalogCurrency); return data.draft; }); },
    async addProduct(id) {
      return this._change(data => {
        const product = data.products.find(value => value.id === id);
        if (!product) throw kioskError('KIOSK_PRODUCT_MISSING', 'This product is no longer available.');
        const draft = cloneKiosk(data.draft);
        const existing = draft.items.find(item => item.productId === id && item.unit === 'fiat' && item.priceMinor === product.priceMinor && item.currency === product.currency && item.name === product.name);
        if (existing) existing.qty += 1;
        else draft.items.push({ ...product, id: newKioskId('item'), productId: id, unit: 'fiat', qty: 1 });
        data.draft = normalizeKioskDraft(draft, data.catalogCurrency);
        return data.draft;
      });
    },
    async addItem(value) {
      return this._change(data => { data.draft = normalizeKioskDraft({ ...data.draft, items: [...data.draft.items, normalizeKioskItem(value, data.catalogCurrency)] }, data.catalogCurrency); return data.draft; });
    },
    async setItemQuantity(id, qty) {
      kioskCount(qty);
      return this._change(data => {
        data.draft = normalizeKioskDraft({ ...data.draft, items: data.draft.items.filter(item => item.id !== id || qty > 0).map(item => item.id === id ? { ...item, qty } : item) }, data.catalogCurrency);
        return data.draft;
      });
    },
    async clearDraft() { return this._change(data => { data.draft = { ...emptyKioskDraft(data.catalogCurrency), amountUnit: data.draft.amountUnit }; return data.draft; }); },
    async saveBasket(name = '') {
      return this._change(data => {
        if (!kioskDraftHasValue(data.draft)) throw kioskError('KIOSK_EMPTY_BASKET', 'Add something before saving this basket.');
        const basket = { id: newKioskId('basket'), name: kioskText(name) || `Basket ${data.savedBaskets.length + 1}`, createdAt: Date.now(), draft: cloneKiosk(data.draft) };
        data.savedBaskets = [...data.savedBaskets, basket];
        data.draft = { ...emptyKioskDraft(data.catalogCurrency), amountUnit: data.draft.amountUnit };
        return basket;
      });
    },
    async saveRecoveredBasket(value, name = 'Recovered basket') {
      return this._change(data => {
        const draft = normalizeKioskDraft(value, data.catalogCurrency);
        if (!kioskDraftHasValue(draft)) return unchanged(null);
        const existing = data.savedBaskets.find(basket => JSON.stringify(basket.draft) === JSON.stringify(draft));
        if (existing) return unchanged(existing);
        const basket = { id: newKioskId('basket'), name: kioskText(name) || 'Recovered basket', createdAt: Date.now(), draft };
        data.savedBaskets = [...data.savedBaskets, basket];
        return basket;
      });
    },
    async resumeBasket(id) {
      return this._change(data => {
        if (kioskDraftHasValue(data.draft) || data.activeOrderId && requireOrder(data, data.activeOrderId).status !== 'paid') throw kioskError('KIOSK_BASKET_CONFLICT', 'Save or clear the current basket before opening another.');
        const basket = data.savedBaskets.find(value => value.id === id);
        if (!basket) throw kioskError('KIOSK_BASKET_MISSING', 'This saved basket could not be found.');
        if (basket.draft.currency !== data.catalogCurrency) throw kioskError('KIOSK_CURRENCY_LOCKED', 'This basket keeps its original price currency.');
        data.draft = cloneKiosk(basket.draft);
        data.savedBaskets = data.savedBaskets.filter(value => value.id !== id);
        return data.draft;
      });
    },
    async removeBasket(id) { return this._change(data => { data.savedBaskets = data.savedBaskets.filter(basket => basket.id !== id); return true; }); },
    async createOrder(snapshot) {
      return this._change(data => {
        if (data.activeOrderId && requireOrder(data, data.activeOrderId).status !== 'paid') throw kioskError('KIOSK_ACTIVE_ORDER', 'Finish or set aside the current payment before charging again.');
        const order = normalizeKioskOrder({ ...snapshot, id: newKioskId('sale'), createdAt: Date.now(), paidAt: null, status: 'preparing', activeAttemptId: null, attempts: [], duplicatePayment: false });
        data.orders = [...data.orders, order];
        data.activeOrderId = order.id;
        return order;
      });
    },
    async beginAttempt(orderId, { walletId, amountSats } = {}) {
      return this._change(data => changeOrder(data, orderId, order => {
        if (order.status === 'paid') throw kioskError('KIOSK_ORDER_PAID', 'This sale is already paid.');
        if (walletId && walletId !== order.walletId || amountSats != null && amountSats !== order.totalSats) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'The payment no longer matches this sale.');
        if (order.attempts.some(attempt => ['creating', 'uncertain', 'waiting'].includes(attempt.status))) throw kioskError('KIOSK_PAYMENT_PENDING', 'Check the existing payment before requesting another.');
        const attempt = { id: newKioskId('attempt'), walletId: order.walletId, amountSats: order.totalSats, status: 'creating', createdAt: Date.now(), paymentHash: null, paymentRequest: null, invoiceId: null, transactionId: null, expiresAt: null, paidAt: null, settledSats: null, reason: null };
        order.activeAttemptId = attempt.id;
        order.attempts.push(attempt);
        return attempt;
      }));
    },
    async attachInvoice(orderId, attemptId, details) {
      return this._change(data => changeOrder(data, orderId, order => {
        const attempt = requireAttempt(order, attemptId);
        const paymentHash = kioskIdentity(details?.paymentHash);
        const paymentRequest = kioskIdentity(details?.paymentRequest, 8192);
        if (!paymentHash || !paymentRequest || details.walletId && details.walletId !== order.walletId || details.amountSats != null && details.amountSats !== order.totalSats) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'The payment request does not match this sale.');
        if (attempt.paymentHash && (attempt.paymentHash !== paymentHash || attempt.paymentRequest !== paymentRequest)) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'This payment already has a different request.');
        if (attempt.status === 'paid') return unchanged(attempt);
        if (!['creating', 'uncertain', 'waiting'].includes(attempt.status)) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'This payment request is no longer current.');
        if (data.orders.some(other => other.attempts.some(value => value.walletId === order.walletId && value.paymentHash === paymentHash && value.id !== attempt.id))) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'This invoice already belongs to another payment.');
        attempt.paymentHash = paymentHash;
        attempt.paymentRequest = paymentRequest;
        attempt.invoiceId = kioskIdentity(details.invoiceId);
        attempt.expiresAt = details.expiresAt == null ? null : kioskCount(details.expiresAt);
        attempt.status = 'waiting';
        attempt.reason = null;
        return attempt;
      }));
    },
    async markCreationUncertain(orderId, attemptId, reason = null) {
      return this._change(data => changeOrder(data, orderId, order => { const attempt = requireAttempt(order, attemptId); if (attempt.status === 'paid' || attempt.paymentHash) return unchanged(attempt); attempt.status = 'uncertain'; attempt.reason = safeReason(reason); return attempt; }));
    },
    async markAttemptFailed(orderId, attemptId, reason = null) {
      return this._change(data => changeOrder(data, orderId, order => { const attempt = requireAttempt(order, attemptId); if (attempt.paymentHash || attempt.status === 'paid') throw kioskError('KIOSK_PAYMENT_PENDING', 'An issued request must still be checked.'); attempt.status = 'failed'; attempt.reason = safeReason(reason); return attempt; }));
    },
    async markAttemptExpired(orderId, attemptId) {
      return this._change(data => changeOrder(data, orderId, order => { const attempt = requireAttempt(order, attemptId); if (attempt.status === 'paid') return unchanged(attempt); if (!attempt.paymentHash) throw kioskError('KIOSK_PAYMENT_PENDING', 'This request still needs to be checked.'); attempt.status = 'expired'; return attempt; }));
    },
    async settleAttempt(orderId, attemptId, proof) {
      return this._change(data => changeOrder(data, orderId, order => {
        const attempt = requireAttempt(order, attemptId);
        if (!attempt.paymentHash || proof?.walletId !== attempt.walletId || proof?.paymentHash !== attempt.paymentHash || proof.settledSats != null && proof.settledSats !== order.totalSats) throw kioskError('KIOSK_PAYMENT_MISMATCH', 'The received payment does not match this sale.');
        if (attempt.status === 'paid') return unchanged({ newlyPaid: false, duplicate: true, duplicatePayment: order.duplicatePayment, order, attempt });
        const alreadyPaid = order.attempts.some(value => value.status === 'paid');
        attempt.status = 'paid';
        attempt.paidAt = proof.paidAt == null ? Date.now() : kioskCount(proof.paidAt);
        attempt.settledSats = proof.settledSats ?? order.totalSats;
        attempt.transactionId = kioskIdentity(proof.transactionId);
        order.paidAt ||= attempt.paidAt;
        order.duplicatePayment ||= alreadyPaid;
        if (proof.method) order.method = kioskText(proof.method);
        order.status = 'paid';
        return { newlyPaid: !alreadyPaid, duplicate: false, duplicatePayment: alreadyPaid, order, attempt };
      }));
    },
    async setActiveOrder(id) {
      return this._change(data => { if (id != null) requireOrder(data, id); data.activeOrderId = id || null; return id || null; });
    },
    async startNextSale() {
      return this._change(data => { data.activeOrderId = null; data.draft = { ...emptyKioskDraft(data.catalogCurrency), amountUnit: data.draft.amountUnit }; return data.draft; });
    },
    async setSaleLabel(id, label) { return this._change(data => changeOrder(data, id, order => { order.label = kioskText(label); })); },
    async exportBundle() { await this.flush(); return exportKioskBundle(this.data); },
    async restoreBundle(text) {
      const restored = readKioskBundle(text);
      return this._change(data => {
        if (data.products.length || data.orders.length || data.savedBaskets.length || kioskDraftHasValue(data.draft)) throw kioskError('KIOSK_RESTORE_CONFLICT', 'Restore register data into an empty register so existing records stay safe.');
        const revision = data.revision;
        Object.assign(data, restored, { revision });
        return true;
      });
    },
    salesCsv(orders = this.sales) { return kioskSalesCsv(orders); },
  },
});
