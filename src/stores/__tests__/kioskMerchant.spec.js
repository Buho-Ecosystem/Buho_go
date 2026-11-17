import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createPinia, setActivePinia } from 'pinia';
import { useKioskMerchantStore } from '../kioskMerchant.js';
import { buildSaleSnapshot, cloneKiosk, kioskError, LEGACY_KIOSK_PARKED_KEY } from '../../utils/kioskMerchant.js';

class Repository {
  data = null;
  fail = false;
  commits = 0;
  async load() { return this.data && cloneKiosk(this.data); }
  async commit(next, previous) {
    if (this.fail) throw kioskError('KIOSK_STORAGE_FAILED', 'full');
    if ((this.data?.revision || 0) !== (previous?.revision || 0)) throw kioskError('KIOSK_STORAGE_CONFLICT', 'stale');
    this.data = cloneKiosk(next); this.commits++;
  }
}
const legacyStorage = { getItem: () => null };
const snapshot = (walletId = 'wallet', amount = 101) => buildSaleSnapshot({ items: [{ id: 'amount', name: 'Amount', unit: 'sats', unitSats: amount, qty: 1 }], currency: 'USD', walletId });
async function register(repository = new Repository(), opts = {}) { setActivePinia(createPinia()); const store = useKioskMerchantStore(); await store.initialize({ storage: repository, legacyStorage, ...opts }); return { store, repository }; }
async function request(store, paymentHash = 'hash') { const sale = await store.createOrder(snapshot()); const attempt = await store.beginAttempt(sale.id); await store.attachInvoice(sale.id, attempt.id, { walletId: 'wallet', amountSats: 101, paymentHash, paymentRequest: 'lnbc', expiresAt: 200 }); return { sale, attempt }; }

beforeEach(() => setActivePinia(createPinia()));

test('fresh preferences persist and existing settings are not overwritten on reload', async () => {
  const { store, repository } = await register(undefined, { currency: 'EUR', amountUnit: 'fiat', entryMode: 'products' });
  assert.equal(store.catalogCurrency, 'EUR'); assert.equal(store.draft.amountUnit, 'fiat'); assert.equal(store.entryMode, 'products');
  await store.completeSetup();
  const { store: loaded } = await register(repository, { currency: 'USD', amountUnit: 'sats' });
  assert.equal(loaded.catalogCurrency, 'EUR'); assert.equal(loaded.draft.amountUnit, 'fiat'); assert.equal(loaded.setupCompleted, true);
});

test('writes are atomic and serialized; a failed commit never appears saved', async () => {
  const { store, repository } = await register();
  await Promise.all([store.updateDraft({ amountRaw: '101' }), store.updateDraft({ exactSats: 101 })]);
  assert.equal(store.draft.amountRaw, '101'); assert.equal(store.draft.exactSats, 101);
  repository.fail = true;
  await assert.rejects(store.createOrder(snapshot()), { code: 'KIOSK_STORAGE_FAILED' });
  assert.equal(store.orders.length, 0); assert.equal(store.activeOrderId, null);
  repository.fail = false; await store.createOrder(snapshot()); assert.equal(store.orders.length, 1);
});

test('catalog changes cannot rewrite draft, saved basket or immutable sales', async () => {
  const { store } = await register();
  const product = await store.saveProduct({ name: 'Coffee', priceMinor: 250, category: 'Drinks', currency: 'USD' });
  await store.addProduct(product.id); const basket = await store.saveBasket('Table 2');
  await store.saveProduct({ ...product, name: 'Tea', priceMinor: 300 });
  await store.resumeBasket(basket.id); assert.equal(store.draft.items[0].name, 'Coffee'); assert.equal(store.draft.items[0].priceMinor, 250);
  const sale = await store.createOrder(buildSaleSnapshot({ items: store.draft.items, currency: 'USD', rate: 100_000, walletId: 'wallet' }));
  await store.removeProduct(product.id); assert.equal(store.getOrder(sale.id).items[0].priceMinor, 250);
  await assert.rejects(store.resumeBasket('missing'), { code: 'KIOSK_BASKET_CONFLICT' });
});

test('issued invoice identity is mandatory; uncertain creation prevents a blind retry', async () => {
  const { store } = await register(); const sale = await store.createOrder(snapshot()); const attempt = await store.beginAttempt(sale.id);
  await store.markCreationUncertain(sale.id, attempt.id, 'raw secret error words');
  assert.equal(store.currentOrder.attempts[0].reason, null);
  await assert.rejects(store.beginAttempt(sale.id), { code: 'KIOSK_PAYMENT_PENDING' });
  await store.attachInvoice(sale.id, attempt.id, { paymentHash: 'hash', paymentRequest: 'lnbc', amountSats: 101 });
  for (const proof of [{ walletId: 'other', paymentHash: 'hash' }, { walletId: 'wallet', paymentHash: 'other' }, { walletId: 'wallet', paymentHash: 'hash', settledSats: 100 }]) await assert.rejects(store.settleAttempt(sale.id, attempt.id, proof), { code: 'KIOSK_PAYMENT_MISMATCH' });
  assert.equal(store.sales.length, 0);
});

test('expired and older attempts reconcile, duplicate receipt notifications count the sale once', async () => {
  const { store } = await register(); const { sale, attempt } = await request(store);
  await store.markAttemptExpired(sale.id, attempt.id);
  const second = await store.beginAttempt(sale.id);
  await store.attachInvoice(sale.id, second.id, { paymentHash: 'hash-2', paymentRequest: 'lnbc2' });
  assert.equal(store.pendingAttempts.length, 2);
  const proof = { walletId: 'wallet', paymentHash: 'hash', settledSats: 101 };
  assert.equal((await store.settleAttempt(sale.id, attempt.id, proof)).newlyPaid, true);
  const commits = store.data.revision;
  assert.equal((await store.settleAttempt(sale.id, attempt.id, proof)).duplicate, true);
  assert.equal(store.data.revision, commits);
  const result = await store.settleAttempt(sale.id, second.id, { ...proof, paymentHash: 'hash-2' });
  assert.equal(result.newlyPaid, false); assert.equal(result.duplicatePayment, true); assert.equal(store.sales.length, 1); assert.equal(store.sales[0].duplicatePayment, true);
});

test('request identities cannot cross orders, but the same hash in another wallet is distinct', async () => {
  const { store } = await register(); await request(store); await store.startNextSale();
  const next = await store.createOrder(snapshot()); const attempt = await store.beginAttempt(next.id);
  await assert.rejects(store.attachInvoice(next.id, attempt.id, { paymentHash: 'hash', paymentRequest: 'lnbc' }), { code: 'KIOSK_PAYMENT_MISMATCH' });
  await store.markAttemptFailed(next.id, attempt.id); await store.startNextSale();
  const other = await store.createOrder(snapshot('other')); const otherAttempt = await store.beginAttempt(other.id);
  await store.attachInvoice(other.id, otherAttempt.id, { paymentHash: 'hash', paymentRequest: 'lnbc-other' });
  assert.equal(store.pendingAttempts.filter(attempt => attempt.paymentHash === 'hash').length, 2);
});

test('backup restore cannot overwrite pending money and failed imports leave records intact', async () => {
  const { store, repository } = await register(); await request(store); const backup = await store.exportBundle();
  await assert.rejects(store.restoreBundle(backup), { code: 'KIOSK_RESTORE_CONFLICT' });
  const { store: empty } = await register(); await empty.restoreBundle(backup); assert.equal(empty.pendingAttempts.length, 1);
  await assert.rejects(empty.restoreBundle('{broken'), { code: 'KIOSK_INVALID_DATA' });
  assert.equal(empty.pendingAttempts.length, 1);
  const { store: reload } = await register(repository); assert.equal(reload.pendingAttempts.length, 1);
});

test('optimistic revision prevents two tabs silently overwriting each other', async () => {
  const repository = new Repository(); const { store: first } = await register(repository); const { store: second } = await register(repository);
  await first.updateDraft({ amountRaw: '101' });
  await assert.rejects(second.completeSetup(), { code: 'KIOSK_STORAGE_CONFLICT' });
  assert.equal(second.setupCompleted, false); assert.equal(repository.data.draft.amountRaw, '101');
});

test('existing parked payments migrate with exact wallet/hash and remain recoverable', async () => {
  const storage = { getItem: key => key === LEGACY_KIOSK_PARKED_KEY ? JSON.stringify([{ id: 'old', parkedAt: 100, invoiceData: { walletId: 'wallet', paymentHash: 'hash', paymentRequest: 'lnbc', amountSats: 101 }, saleSnapshot: { baseSats: 101, totalSats: 101 } }]) : null };
  const { store, repository } = await register(undefined, { legacyStorage: storage });
  assert.equal(store.pendingAttempts.length, 1); assert.equal(store.pendingAttempts[0].paymentHash, 'hash'); assert.equal(repository.data.orders.length, 1);
});

test('fiat entry choice survives save, clear, next customer and reload', async () => {
  const { store, repository } = await register();
  await store.updateDraft({ amountRaw: '2.50', amountUnit: 'fiat', exactSats: 2500 });
  await store.saveBasket('Table'); assert.equal(store.draft.amountUnit, 'fiat');
  await store.updateDraft({ amountRaw: '1.00' }); await store.clearDraft(); assert.equal(store.draft.amountUnit, 'fiat');
  await store.startNextSale(); assert.equal(store.draft.amountUnit, 'fiat');
  const { store: loaded } = await register(repository); assert.equal(loaded.draft.amountUnit, 'fiat');
});

test('conflict recovery preserves newer authoritative draft and saves local work only once', async () => {
  const repository = new Repository(); const { store: older } = await register(repository); const { store: newer } = await register(repository);
  await newer.updateDraft({ amountRaw: '8', exactSats: 8 });
  const recovered = { ...older.draft, amountRaw: '101', exactSats: 101 };
  await assert.rejects(older.updateDraft(recovered), { code: 'KIOSK_STORAGE_CONFLICT' });
  await older.reload();
  const basket = await older.saveRecoveredBasket(recovered, 'Recovered basket');
  const same = await older.saveRecoveredBasket(recovered, 'Recovered basket');
  assert.equal(same.id, basket.id); assert.equal(older.savedBaskets.length, 1); assert.equal(older.draft.exactSats, 8);
  await assert.rejects(older.saveRecoveredBasket({ ...recovered, currency: 'EUR' }), { code: 'KIOSK_INVALID_DATA' });
  assert.equal(older.draft.exactSats, 8);
});

test('repository and write queue survive Pinia action wrapper proxies', async () => {
  const store = useKioskMerchantStore(), repository = new Repository();
  await new Proxy(store, {}).initialize({ storage: repository, legacyStorage });
  await new Proxy(store, {}).completeSetup();
  await Promise.all([new Proxy(store, {}).updateDraft({ amountRaw: '101' }), new Proxy(store, {}).updateDraft({ exactSats: 101 })]);
  assert.equal(store.setupCompleted, true); assert.equal(store.draft.amountRaw, '101'); assert.equal(store.draft.exactSats, 101); assert.equal(repository.data.revision, 3);
});
