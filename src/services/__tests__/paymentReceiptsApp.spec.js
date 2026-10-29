import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import * as receipts from '../paymentReceipts.js';
import { createHarness } from '../../stores/__tests__/sparkWalletHarness.js';

const source = readFileSync(new URL('../paymentReceiptsApp.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });

function deliveryHarness({ notifications = false } = {}) {
  const { store } = createHarness();
  store.wallets = [{ id: 'wallet', name: 'Tips', type: 'lnbits' }];
  const notices = [];
  const dependencies = {
    './paymentReceipts.js': receipts,
    '../stores/wallet.js': { useWalletStore: () => store },
    '../stores/notifications.js': { useNotificationsStore: () => ({ canNotifyPayments: notifications, notifyIfEnabled: async value => notices.push(value) }) },
    '../boot/i18n.js': { i18n: { global: { t: key => key } } },
    '../utils/amountFormatting.js': { formatAmount: value => String(value) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => dependencies[name] || {}, module, module.exports);
  return { store, notices, ...module.exports };
}

test('delivery publishes Home activity before receipt observers, even with notifications disabled', async () => {
  const { store, notices, deliverReceipt } = deliveryHarness();
  let observedActivity, lastReceipt;
  Object.defineProperty(store, 'lastReceipt', {
    get: () => lastReceipt,
    set: receipt => { lastReceipt = receipt; observedActivity = store.confirmedReceiveActivity; },
  });
  await deliverReceipt({ walletId: 'wallet', id: 'boarding', aliases: ['commitment'], paymentHash: 'AB', amountSats: 2100, timestamp: 1_900_000_000 });
  assert.equal(observedActivity, store.latestConfirmedReceive('wallet'));
  assert.equal(observedActivity.paymentId, 'boarding');
  assert.equal(observedActivity.paymentHash, 'ab');
  assert.equal(observedActivity.settledAt, 1_900_000_000_000);
  assert.ok(observedActivity.aliases.includes('commitment'));
  assert.equal(lastReceipt.amountSats, 2100);
  assert.equal(lastReceipt.settledAt, observedActivity.settledAt);
  assert.equal(notices.length, 0);
});

test('a wallet removed while delivery imports resolve cannot publish activity or a notification', async () => {
  const { store, notices, deliverReceipt } = deliveryHarness({ notifications: true });
  const delivering = deliverReceipt({ walletId: 'wallet', id: 'late', amountSats: 2100, timestamp: 1_900_000_000 });
  store.wallets = [];
  await delivering;
  assert.equal(store.confirmedReceiveActivity, null);
  assert.equal(store.lastReceipt, null);
  assert.equal(notices.length, 0);
});

test('sheet activity and later ledger delivery enrich the same sequence while retaining notification policy', async () => {
  const { store, notices, deliverReceipt } = deliveryHarness({ notifications: true });
  const sheet = store.recordConfirmedReceive({ walletId: 'wallet', paymentHash: 'ab', amountSats: 2100 });
  await deliverReceipt({ walletId: 'wallet', id: 'provider-id', paymentHash: 'ab', amountSats: 2100 });
  assert.equal(store.confirmedReceiveActivity.sequence, sheet.sequence);
  assert.equal(store.confirmedReceivesByWallet.wallet.length, 1);
  assert.equal(store.confirmedReceiveActivity.paymentId, 'provider-id');
  assert.equal(notices.length, 0, 'foreground delivery remains an in-app receipt only');
});

test('invoice creation time is not published as confirmed settlement time', async () => {
  const { store, deliverReceipt } = deliveryHarness();
  await deliverReceipt({ walletId: 'wallet', id: 'old-invoice', amountSats: 2100, timestamp: 1_900_000_000, settlementKnown: false });
  assert.equal(store.confirmedReceiveActivity.settledAt, null);
  assert.equal(store.lastReceipt.settledAt, null);
  assert.ok(store.confirmedReceiveActivity.observedAt > 0);
});
