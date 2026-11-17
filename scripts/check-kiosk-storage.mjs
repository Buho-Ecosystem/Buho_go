import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Uses the application's dev server so the browser imports the production modules unchanged.
const url = process.env.BUHO_KIOSK_TEST_URL || 'http://127.0.0.1:9100';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(async () => {
    const { createKioskMerchantStorage } = await import('/src/services/kioskMerchantStorage.js');
    const { emptyKioskMerchant, buildSaleSnapshot, normalizeKioskOrder } = await import('/src/utils/kioskMerchant.js');
    const name = `buhogo-kiosk-storage-test-${crypto.randomUUID()}`;
    const first = createKioskMerchantStorage({ name });
    const second = createKioskMerchantStorage({ name });
    const initial = emptyKioskMerchant('EUR');
    const initialized = { ...initial, revision: 1, setupCompleted: true };
    const checks = {};
    try {
      await first.commit(initialized, initial);
      await first.close();
      const loaded = await first.load();
      checks.initialRecordComplete = loaded.catalogCurrency === 'EUR' && Array.isArray(loaded.products) && loaded.draft.amountUnit === 'sats';
      const snapshot = buildSaleSnapshot({ items: [{ id: 'amount', name: 'Amount', unit: 'sats', unitSats: 101, qty: 1 }], currency: 'EUR', walletId: 'wallet' });
      const order = normalizeKioskOrder({ ...snapshot, id: 'sale-0', createdAt: 1, status: 'waiting', activeAttemptId: 'attempt-0', attempts: [{ id: 'attempt-0', walletId: 'wallet', amountSats: 101, status: 'waiting', createdAt: 1, paymentHash: 'hash', paymentRequest: 'lnbc', expiresAt: 200 }] });
      const changed = { ...loaded, revision: 2, orders: [order], activeOrderId: order.id };
      await first.commit(changed, loaded);
      await first.close();
      const recovered = await first.load();
      checks.pendingRecovered = recovered.orders[0].attempts[0].paymentHash === 'hash' && recovered.orders[0].totalSats === 101 && recovered.activeOrderId === order.id;
      const stale = await second.load();
      const edited = { ...recovered, revision: 3, draft: { ...recovered.draft, amountRaw: '8', exactSats: 8 } };
      await first.commit(edited, recovered);
      try { await second.commit({ ...stale, revision: 3, setupCompleted: false }, stale); checks.conflictRejected = false; }
      catch (error) { checks.conflictRejected = error.code === 'KIOSK_STORAGE_CONFLICT'; }
      checks.conflictPreserved = (await first.load()).draft.exactSats === 8;
      const history = { ...edited, revision: 4, orders: Array.from({ length: 10_000 }, (_, index) => ({ ...snapshot, id: `sale-${index}`, createdAt: index + 1, status: 'preparing', attempts: [], activeAttemptId: null })) };
      await first.commit(history, edited);
      let orderWrites = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (record, ...args) { if (record.key.startsWith('order:')) orderWrites++; return put.call(this, record, ...args); };
      try { await first.commit({ ...history, revision: 5, draft: { ...history.draft, amountRaw: '101', exactSats: 101 } }, history); }
      finally { IDBObjectStore.prototype.put = put; }
      const final = await first.load();
      checks.tenThousandRecordsSurvive = final.orders.length === 10_000 && final.draft.exactSats === 101;
      checks.keypressDoesNotRewriteOrders = orderWrites === 0;
      return checks;
    } finally {
      await first.close(); await second.close();
      await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = reject; });
    }
  });
  for (const [name, passed] of Object.entries(results)) { assert.equal(passed, true, name); process.stdout.write(`PASS ${name}\n`); }
} finally { await browser.close(); }
