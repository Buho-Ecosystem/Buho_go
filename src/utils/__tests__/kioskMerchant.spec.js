import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSaleSnapshot, emptyKioskMerchant, exportKioskBundle, formatKioskMoney, kioskSalesCsv, normalizeKioskDraft, normalizeKioskOrder, priceBasket, readKioskBundle } from '../kioskMerchant.js';

const sats = value => ({ id: `sats-${value}`, name: 'Amount', unit: 'sats', unitSats: value, qty: 1 });
const fiat = (id, priceMinor) => ({ id, name: 'Coffee', unit: 'fiat', priceMinor, currency: 'USD', qty: 1 });
const order = extra => ({ ...buildSaleSnapshot({ items: [sats(101)], currency: 'USD', rate: 100_000, walletId: 'wallet' }), id: 'sale', createdAt: 1, status: 'preparing', attempts: [], ...extra });

test('explicit tiny sats remain exact through pricing and backup', () => {
  for (const value of [1, 8, 10, 101]) {
    const priced = buildSaleSnapshot({ items: [sats(value)], currency: 'USD', walletId: 'wallet' });
    assert.equal(priced.totalSats, value);
    assert.equal(priced.totalMinor, null);
    const data = emptyKioskMerchant();
    data.orders.push(normalizeKioskOrder({ ...priced, id: `sale-${value}`, createdAt: 1, status: 'preparing', attempts: [] }));
    assert.equal(readKioskBundle(exportKioskBundle(data)).orders[0].totalSats, value);
  }
});

test('fiat subtotal is quoted once and immutable lines receive the remainder', () => {
  const priced = priceBasket([fiat('one', 1), fiat('two', 1), sats(8)], { currency: 'USD', rate: 60_000 });
  assert.equal(priced.baseSats, Math.floor(.02 / 60_000 * 100_000_000) + 8);
  assert.equal(priced.items.reduce((sum, item) => sum + item.lineSats, 0), priced.baseSats);
  assert.deepEqual(priced.items.map(item => item.lineSats), [17, 16, 8]);
  assert.equal(priced.subtotalMinor, 2);
});

test('invalid quotes and contradictory imported totals fail closed', () => {
  assert.throws(() => priceBasket([fiat('one', 100)], { rate: 0 }), { code: 'KIOSK_RATE_UNAVAILABLE' });
  assert.throws(() => normalizeKioskOrder(order({ baseSats: 102, totalSats: 102 })), { code: 'KIOSK_INVALID_DATA' });
  assert.throws(() => normalizeKioskOrder(order({ items: [sats(101)] })), { code: 'KIOSK_INVALID_DATA' });
  assert.throws(() => normalizeKioskOrder(order({ rate: Infinity })), { code: 'KIOSK_INVALID_DATA' });
  assert.throws(() => normalizeKioskOrder(order({ subtotalMinor: null, totalMinor: 0 })), { code: 'KIOSK_INVALID_DATA' });
  assert.throws(() => normalizeKioskDraft({ amountRaw: '2', amountUnit: 'fiat', currency: 'EUR' }, 'USD'), { code: 'KIOSK_INVALID_DATA' });
});

test('CSV keeps original units, sums once and escapes merchant formula text', () => {
  const sale = order({ items: undefined });
  const snapshot = buildSaleSnapshot({ items: [{ ...fiat('one', 100), name: '=SUM(1,2)', qty: 2 }, sats(101)], currency: 'USD', rate: 100_000, walletId: 'wallet', tipSats: 5, roundUpSats: 2 });
  Object.assign(sale, snapshot, { label: '@unsafe', duplicatePayment: true });
  const csv = kioskSalesCsv([sale]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'@unsafe"'));
  assert.equal(csv.split(`"${snapshot.totalSats}"`).length - 1, 1);
  assert.ok(csv.includes('"fiat","100",""'));
  assert.ok(csv.includes('"sats","","101"'));
});

test('shared integer fiat conversion avoids a one-sat underquote at decimal boundaries', () => {
  assert.equal(priceBasket([fiat('one', 21)], { currency: 'USD', rate: 100_000 }).baseSats, 210);
});

test('duplicate basket identities and altered quoted line prices are rejected', () => {
  assert.throws(() => normalizeKioskDraft({ items: [sats(8), sats(8)] }, 'USD'), { code: 'KIOSK_INVALID_DATA' });
  const sale = order(); sale.items[0].unitSats = 100;
  assert.throws(() => normalizeKioskOrder(sale), { code: 'KIOSK_INVALID_DATA' });
});

test('catalog hundredths remain visible for currencies whose locale usually hides decimals', () => {
  assert.equal(formatKioskMoney(125, 'JPY', 'en-US'), '¥1.25');
  assert.equal(formatKioskMoney(125, 'USD', 'en-US'), '$1.25');
});
