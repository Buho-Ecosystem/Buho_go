import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOME_PATH,
  incomingSurface,
  expectReceiveInvoice,
  confirmReceivePayment,
  forgetReceiveInvoice,
  expectReceiveFunds,
  forgetReceiveFunds,
  shownByReceive,
  transactionRoute,
  findReceivedTransactionId,
} from '../incomingPayments.js';

const at = (path, extra = {}) => ({ path, dialogOpen: false, kiosk: false, settledWhileAway: false, ...extra });

test('the open address receive sheet owns only its wallet until it closes', () => {
  expectReceiveFunds('arkade');
  assert.equal(shownByReceive({ walletId: 'arkade', amountSats: 2100 }), true);
  assert.equal(shownByReceive({ walletId: 'another', amountSats: 2100 }), false);
  forgetReceiveFunds('arkade');
  assert.equal(shownByReceive({ walletId: 'arkade', amountSats: 2100 }), false);
});

test('Home with nothing open shows the screen; everywhere else a toast', () => {
  assert.equal(incomingSurface(at(HOME_PATH)), 'screen');
  assert.equal(incomingSurface(at(HOME_PATH, { dialogOpen: true })), 'toast');
  assert.equal(incomingSurface(at('/settings')), 'toast');
  assert.equal(incomingSurface(at('/transactions')), 'toast');
});

test('kiosk mode and payments that settled while away are not shown in the app', () => {
  assert.equal(incomingSurface(at(HOME_PATH, { kiosk: true })), null);
  assert.equal(incomingSurface(at('/settings', { settledWhileAway: true })), null);
});

test('a receipt for an invoice the Receive sheet shows is left to the sheet, by hash', () => {
  const now = 1_000_000;
  expectReceiveInvoice({ walletId: 'w1', paymentHash: 'AB12', amountSats: 0 }, now);
  assert.equal(shownByReceive({ walletId: 'w1', paymentHash: 'ab12', amountSats: 2100 }, now), true);
  assert.equal(shownByReceive({ walletId: 'w1', paymentHash: 'ffff', amountSats: 2100 }, now), false);
  forgetReceiveInvoice('ab12');
  assert.equal(shownByReceive({ walletId: 'w1', paymentHash: 'ab12', amountSats: 2100 }, now), false);
});

test('an unpaid invoice the sheet stops showing is news again; a confirmed one stays covered for a while', () => {
  const now = 2_000_000;
  expectReceiveInvoice({ walletId: 'w1', paymentHash: 'c0de', amountSats: 500 }, now);
  confirmReceivePayment({ walletId: 'w1', paymentHash: 'c0de', amountSats: 500 }, now);
  forgetReceiveInvoice('c0de');
  // A balance rise (no hash) of the same amount on the same wallet is the same payment.
  assert.equal(shownByReceive({ walletId: 'w1', paymentHash: null, amountSats: 500 }, now + 1000), true);
  assert.equal(shownByReceive({ walletId: 'w2', paymentHash: null, amountSats: 500 }, now + 1000), false);
  assert.equal(shownByReceive({ walletId: 'w1', paymentHash: null, amountSats: 500 }, now + 3 * 60 * 1000), false);
});

test('a deposit the sheet confirmed covers the balance rise it causes', () => {
  const now = 3_000_000;
  confirmReceivePayment({ walletId: 'w3', amountSats: 25000 }, now);
  assert.equal(shownByReceive({ walletId: 'w3', paymentHash: null, amountSats: 25000 }, now), true);
  assert.equal(shownByReceive({ walletId: 'w3', paymentHash: null, amountSats: 900 }, now), false);
});

test('the Transaction details route names the payment and its wallet', () => {
  assert.equal(transactionRoute('w 1', 'tx/9'), '/transaction/tx%2F9?wallet=w%201');
});

const nowS = Math.floor(Date.now() / 1000);
const rows = [
  { id: 'old', type: 'incoming', amount: 2100, settled_at: nowS - 3 * 3600 },
  { id: 'sent', type: 'outgoing', amount: 2100, settled_at: nowS - 30 },
  { id: 'other', type: 'incoming', amount: 900, settled_at: nowS - 20 },
  { id: 'match', type: 'incoming', amount: 2100, settled_at: nowS - 60 },
  { id: 'pending', type: 'incoming', amount: 2100, settled_at: nowS - 5, status: 'pending' },
];

test('the received payment is the recent settled incoming one of that amount', async () => {
  const provider = { getTransactions: async () => rows };
  const id = await findReceivedTransactionId({ wallet: { id: 'w1', type: 'nwc' }, provider, amountSats: 2100, sinceMs: Date.now() - 15 * 60 * 1000 });
  assert.equal(id, 'match');
});

test('without an amount match the newest recent incoming payment is taken', async () => {
  const provider = { getTransactions: async () => rows };
  const id = await findReceivedTransactionId({ wallet: { id: 'w1', type: 'nwc' }, provider, amountSats: 4242, sinceMs: Date.now() - 15 * 60 * 1000 });
  assert.equal(id, 'other');
});

test('a slow or missing provider falls back to the cached list; nothing recent gives null', async () => {
  const slow = { getTransactions: () => new Promise(() => {}) };
  const id = await findReceivedTransactionId({
    wallet: { id: 'w1', type: 'lnbits' }, provider: slow, amountSats: 2100,
    sinceMs: Date.now() - 15 * 60 * 1000, readCache: () => rows, timeoutMs: 20,
  });
  assert.equal(id, 'match');
  const none = await findReceivedTransactionId({
    wallet: { id: 'w1', type: 'lnbits' }, provider: null, amountSats: 2100,
    sinceMs: Date.now(), readCache: () => rows.filter((r) => r.id === 'old'),
  });
  assert.equal(none, null);
});
