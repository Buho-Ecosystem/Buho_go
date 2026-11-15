import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLatestTransactionHistory } from '../latestTransactionHistory.js';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createLatestTransactionPreview } from '../latestTransactionPreview.js';

test('LNbits preview uses the strict list API and preserves failures', async () => {
  const error = new Error('offline');
  const context = { wallet: { type: 'lnbits' }, owner: {
    getTransactions() { assert.fail('the legacy wrapper hides failures'); },
    async listPayments(options) { assert.deepEqual(options, { limit: 20, offset: 0 }); throw error; },
  } };
  await assert.rejects(readLatestTransactionHistory(context), e => e === error);
  context.owner.listPayments = async () => [];
  assert.deepEqual(await readLatestTransactionHistory(context), { rows: [] });
});

test('NWC history grants are respected without sending a request', async () => {
  const wallet = { type: 'nwc', metadata: { methods: ['get_balance', 'lookup_invoice'] } };
  assert.deepEqual(await readLatestTransactionHistory({ wallet, owner: null }), { rows: [], unsupported: true });
});

test('NWC uses its captured connection and propagates a list failure', async () => {
  const error = new Error('relay offline');
  let calls = 0;
  const owner = { async listTransactions() { calls++; throw error; } };
  await assert.rejects(readLatestTransactionHistory({ wallet: { type: 'nwc' }, owner }), e => e === error);
  assert.equal(calls, 1);
});

test('Spark and Arkade keep their existing provider history shape', async () => {
  for (const type of ['spark', 'arkade']) {
    const rows = [{ id: 'payment', type: 'incoming', amount: 100 }];
    const owner = { async getTransactions(options) {
      assert.deepEqual(options, { limit: 20, offset: 0 }); return { transactions: rows };
    } };
    assert.deepEqual(await readLatestTransactionHistory({ wallet: { type }, owner }), { rows });
  }
});

test('a disconnected owner is a failed read, not empty history', async () => {
  await assert.rejects(readLatestTransactionHistory({ wallet: { type: 'spark' }, owner: null }), { code: 'NOT_CONNECTED' });
});

test('a paid old LNbits invoice is ordered by the verified lookup while preserving a self-send half', async () => {
  const now = Date.now();
  const coffee = { id: 'coffee', type: 'send', amount: 100, status: 'completed', timestamp: (now - 1000) / 1000 };
  const received = { id: 'paid', paymentHash: 'paid', type: 'receive', amount: 2100, status: 'completed', timestamp: (now - 3600000) / 1000 };
  const selfSend = { ...received, type: 'send' };
  const wallet = { id: 'A', type: 'lnbits' };
  const owner = {
    async listPayments() { return [coffee, selfSend, received]; },
    async getPayment(hash) { assert.equal(hash, 'paid'); return { ...received, settled_at: now / 1000 }; },
  };
  const controller = createLatestTransactionPreview({
    readHistory: readLatestTransactionHistory, readCache: () => [coffee], writeCache() {},
  });
  try {
    controller.select({ walletId: 'A', walletType: 'lnbits', wallet, owner });
    controller.receive({ walletId: 'A', paymentHash: 'paid', amountSats: 2100, settledAt: null, observedAt: now });
    assert.equal(controller.getState().phase, 'receipt');
    await controller.refresh();
    assert.equal(controller.getState().phase, 'ready');
    assert.equal(controller.getState().transaction.id, 'paid');
    const result = await readLatestTransactionHistory({ wallet, owner }, { receipt: { paymentHash: 'paid' } });
    assert.equal(result.rows.filter(row => row.id === 'paid').length, 2);
  } finally { controller.dispose(); }
});

test('a metadata edit of an already reconciled LNbits invoice cannot promote it above a newer send', async () => {
  const now = Date.now();
  const received = { id: 'paid', paymentHash: 'paid', type: 'receive', amount: 2100, status: 'completed', timestamp: (now - 3600000) / 1000, receiptTimeIsCreation: true };
  let rows = [received], lookupTime = now, lookups = 0;
  const wallet = { id: 'A', type: 'lnbits' };
  const owner = {
    async listPayments() { return rows; },
    async getPayment() { lookups++; return { ...received, receiptTimeIsCreation: false, settled_at: lookupTime / 1000 }; },
  };
  const controller = createLatestTransactionPreview({ readHistory: readLatestTransactionHistory, readCache: () => [], writeCache() {} });
  try {
    controller.select({ walletId: 'A', walletType: 'lnbits', wallet, owner });
    controller.receive({ walletId: 'A', paymentHash: 'paid', amountSats: 2100, observedAt: now });
    await controller.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.getState().transaction.id, 'paid');
    rows = [{ id: 'newer-send', type: 'send', amount: 100, status: 'completed', timestamp: (now + 1000) / 1000 }, received];
    await controller.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.getState().transaction.id, 'newer-send');
    lookupTime = now + 2000;
    await controller.refresh();
    assert.equal(controller.getState().transaction.id, 'newer-send');
    assert.equal(lookups, 1, 'finished receipts are not polled by exact lookup');
  } finally { controller.dispose(); }
});

test('a metadata update during delayed LNbits reconciliation cannot outrank a send after observation', async () => {
  const now = Date.now();
  const received = { id: 'paid', paymentHash: 'paid', type: 'receive', amount: 2100, status: 'completed', timestamp: (now - 3600000) / 1000, receiptTimeIsCreation: true };
  const send = { id: 'newer-send', type: 'send', amount: 100, status: 'completed', timestamp: (now + 1000) / 1000 };
  const wallet = { id: 'A', type: 'lnbits' };
  const owner = {
    async listPayments() { return [send, received]; },
    async getPayment() { return { ...received, receiptTimeIsCreation: false, settled_at: (now + 3000) / 1000 }; },
  };
  let cached;
  const controller = createLatestTransactionPreview({ readHistory: readLatestTransactionHistory, readCache: () => [], writeCache: (_, rows) => { cached = rows; } });
  try {
    controller.select({ walletId: 'A', walletType: 'lnbits', wallet, owner });
    controller.receive({ walletId: 'A', paymentHash: 'paid', amountSats: 2100, observedAt: now });
    await controller.refresh();
    assert.equal(controller.getState().transaction.id, 'newer-send');
    assert.equal(cached[0].id, 'newer-send', 'the same proven ordering reaches shared cache');
  } finally { controller.dispose(); }
});

test('a production Arkade pending boarding deposit is actual incoming funds, not an unpaid invoice', async () => {
  const script = readFileSync(new URL('../../providers/ArkadeWalletProvider.js', import.meta.url), 'utf8');
  const { code } = transformSync(script, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === './WalletProvider' ? { WalletProvider: class {} } : {}, module, module.exports);
  const pending = module.exports.arkadeTransactionRow({
    key: { boardingTxid: 'deposit' }, type: 'RECEIVED', amount: 2100, settled: false, createdAt: Date.now(),
  });
  const wallet = { id: 'A', type: 'arkade' };
  const owner = { async getTransactions() { return [pending]; } };
  const controller = createLatestTransactionPreview({ readHistory: readLatestTransactionHistory, readCache: () => [], writeCache() {} });
  try {
    controller.select({ walletId: 'A', walletType: 'arkade', wallet, owner });
    await controller.refresh();
    assert.equal(controller.getState().phase, 'ready');
    assert.equal(controller.getState().transaction.status, 'pending');
    assert.equal(controller.getState().receipt, null);
  } finally { controller.dispose(); }
});

test('malformed provider data cannot clear the card as successful empty history', async () => {
  await assert.rejects(readLatestTransactionHistory({ wallet: { type: 'spark' }, owner: { async getTransactions() { return null; } } }), /Invalid preview history/);
});

test('an LNbits server without settlement timestamps cannot resolve an old invoice behind an ambiguously newer send', async () => {
  const now = Date.now();
  const coffee = { id: 'coffee', type: 'send', amount: 100, status: 'completed', timestamp: (now - 1000) / 1000 };
  const received = { id: 'paid', paymentHash: 'paid', type: 'receive', amount: 2100, status: 'completed', timestamp: (now - 3600000) / 1000, receiptTimeIsCreation: true };
  const wallet = { id: 'A', type: 'lnbits' };
  const owner = { async listPayments() { return [coffee, received]; }, async getPayment() { return received; } };
  const controller = createLatestTransactionPreview({ readHistory: readLatestTransactionHistory, readCache: () => [coffee], writeCache() {} });
  try {
    controller.select({ walletId: 'A', walletType: 'lnbits', wallet, owner });
    controller.receive({ walletId: 'A', paymentHash: 'paid', amountSats: 2100, settledAt: null, observedAt: now });
    await controller.refresh();
    assert.equal(controller.getState().phase, 'receipt');
    assert.equal(controller.getState().receipt.amountSats, 2100);
  } finally { controller.dispose(); }
});

test('unknown ordering is retained when LNbits exact lookup has no own-wallet details or NWC omits settlement time', async () => {
  const now = Date.now();
  const coffee = { id: 'coffee', type: 'send', amount: 100, status: 'completed', timestamp: (now - 1000) / 1000 };
  const received = { id: 'paid', paymentHash: 'paid', type: 'receive', amount: 2100, status: 'completed', timestamp: (now - 3600000) / 1000, receiptTimeIsCreation: true };
  for (const type of ['lnbits', 'nwc']) {
    const owner = type === 'lnbits'
      ? { async listPayments() { return [coffee, received]; }, async getPayment() { return null; } }
      : { async listTransactions() { return { transactions: [
        { payment_hash: 'coffee', type: 'outgoing', amount: 100, state: 'settled', settled_at: (now - 1000) / 1000 },
        { payment_hash: 'paid', type: 'incoming', amount: 2100, state: 'settled', created_at: (now - 3600000) / 1000 },
      ] }; } };
    const wallet = { id: 'A', type };
    const controller = createLatestTransactionPreview({ readHistory: readLatestTransactionHistory, readCache: () => [coffee], writeCache() {} });
    try {
      controller.select({ walletId: 'A', walletType: type, wallet, owner });
      controller.receive({ walletId: 'A', paymentHash: 'paid', amountSats: 2100, settledAt: null, observedAt: now });
      await controller.refresh();
      assert.equal(controller.getState().phase, 'receipt', type);
      assert.equal(controller.getState().receipt.amountSats, 2100, type);
    } finally { controller.dispose(); }
  }
});
