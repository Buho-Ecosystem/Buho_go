/**
 * LNbits incoming payments: the read-only invoice key is fetched once with
 * the admin key, the live channel opens on the invoice key only, and every
 * message is a hint to look, never proof.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function loadModule() {
  const load = (file, deps) => {
    const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { format: 'cjs' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
    return module.exports;
  };
  const base = load('../WalletProvider.js', {});
  return load('../LNBitsWalletProvider.js', { './WalletProvider': base });
}

const { LNBitsWalletProvider, lnbitsPaymentHint } = loadModule();

const ADMIN = 'a'.repeat(32);
const INVOICE = 'b'.repeat(32);
const HASH = 'c'.repeat(64);

/** fetch stand-in: answers by method and path, records every request. */
function server(routes) {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const { pathname, search } = new URL(url);
    const method = options.method || 'GET';
    requests.push({ method, path: pathname + search, key: options.headers?.['X-Api-Key'], body: options.body });
    const answer = routes[`${method} ${pathname}`];
    if (!answer) return { ok: false, status: 404, text: async () => '{"detail":"Not found"}' };
    const value = typeof answer === 'function' ? answer() : answer;
    if (value?.status >= 400) return { ok: false, status: value.status, text: async () => '{"detail":"no"}' };
    return { ok: true, status: 200, text: async () => JSON.stringify(value) };
  };
  return requests;
}

/** WebSocket stand-in: records every socket opened. */
function sockets() {
  const opened = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.closed = 0; opened.push(this); }
    close() { this.closed += 1; this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; }
    drop() { this.readyState = 3; this.onclose?.(); }
    send(data) { this.onmessage?.({ data }); }
  }
  return { opened, FakeSocket };
}

function provider(extra = {}) {
  const p = new LNBitsWalletProvider('w1', { serverUrl: 'https://pay.example', adminKey: ADMIN, walletId: 'lnbits-1', ...extra });
  p.isConnected = true;
  return p;
}

test('the invoice key is asked for once, with the admin key, and kept', async () => {
  const requests = server({ 'PATCH /api/v1/wallet': { id: 'lnbits-1', name: 'Shop', inkey: INVOICE, adminkey: ADMIN } });
  const p = provider();
  const kept = [];
  p._onInvoiceKey = (key) => kept.push(key);
  const [first, second] = await Promise.all([p.getInvoiceKey(), p.getInvoiceKey()]);
  assert.equal(first, INVOICE);
  assert.equal(second, INVOICE);
  assert.equal(await p.getInvoiceKey(), INVOICE);
  assert.equal(requests.length, 1, 'one request, shared by callers at the same time');
  assert.deepEqual([requests[0].key, requests[0].body], [ADMIN, '{}'], 'an empty update: nothing about the wallet changes');
  assert.deepEqual(kept, [INVOICE]);
});

test('a wallet saved with its invoice key never asks again', async () => {
  const requests = server({});
  const p = provider({ invoiceKey: INVOICE });
  assert.equal(await p.getInvoiceKey(), INVOICE);
  assert.equal(requests.length, 0);
});

test('an answer for another wallet, or without a usable key, is refused', async () => {
  server({ 'PATCH /api/v1/wallet': { id: 'someone-else', inkey: INVOICE } });
  await assert.rejects(provider().getInvoiceKey(), /another wallet/);
  server({ 'PATCH /api/v1/wallet': { id: 'lnbits-1', inkey: '<script>' } });
  const p = provider();
  await assert.rejects(p.getInvoiceKey(), /invoice key/);
  assert.equal(p.invoiceKey, null);
});

test('the live channel opens on the invoice key, never the admin key', async () => {
  server({ 'PATCH /api/v1/wallet': { id: 'lnbits-1', inkey: INVOICE } });
  const { opened, FakeSocket } = sockets();
  const watch = await provider().watchPayments(() => {}, { WebSocket: FakeSocket });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, `wss://pay.example/api/v1/ws/${INVOICE}`);
  assert.ok(!opened[0].url.includes(ADMIN));
  watch.stop();
});

test('a message is a hint to look; anything that is not LNbits JSON is ignored', async () => {
  server({});
  const { opened, FakeSocket } = sockets();
  const hints = [];
  const watch = await provider({ invoiceKey: INVOICE }).watchPayments((hint) => hints.push(hint), { WebSocket: FakeSocket });
  const ws = opened[0];
  ws.send(JSON.stringify({ wallet_balance: 10, payment: { payment_hash: HASH.toUpperCase(), amount: 21000, status: 'success' } }));
  ws.send('not json');
  ws.send(JSON.stringify({ pending: false }));
  ws.send(JSON.stringify({ payment: { payment_hash: '../../etc' } }));
  ws.send(42);
  assert.deepEqual(hints, [{ paymentHash: HASH }, {}, {}]);
  watch.stop();
  ws.onmessage?.({ data: JSON.stringify({ payment: { payment_hash: HASH } }) });
  assert.equal(hints.length, 3, 'a stopped watch says nothing');
});

test('a dropped socket opens again only on revive; an open one is left alone', async () => {
  server({});
  const { opened, FakeSocket } = sockets();
  const p = provider({ invoiceKey: INVOICE });
  const watch = await p.watchPayments(() => {}, { WebSocket: FakeSocket });
  opened[0].open();
  watch.revive();
  assert.equal(opened.length, 1, 'open: nothing to do');
  opened[0].drop();
  assert.equal(opened.length, 1, 'no reconnect loop of its own');
  watch.revive();
  assert.equal(opened.length, 2);
  watch.stop();
  watch.revive();
  assert.equal(opened.length, 2, 'stopped stays stopped');
});

test('disconnecting closes every live channel', async () => {
  server({});
  const { opened, FakeSocket } = sockets();
  const p = provider({ invoiceKey: INVOICE });
  await p.watchPayments(() => {}, { WebSocket: FakeSocket });
  await p.watchPayments(() => {}, { WebSocket: FakeSocket });
  await p.disconnect();
  assert.deepEqual(opened.map((ws) => ws.closed), [1, 1]);
});

test('the history read tells a failure from an empty list; the screens keep their empty list', async () => {
  server({ 'GET /api/v1/payments': { status: 500 } });
  const p = provider();
  await assert.rejects(p.listPayments({ limit: 5 }), /LNBits API error/);
  assert.deepEqual(await p.getTransactions({ limit: 5 }), []);
});

test('a settled row says when it was paid, apart from when its invoice was made', async () => {
  server({
    'GET /api/v1/payments': [
      { payment_hash: HASH, amount: 50000, fee: 0, status: 'success', time: '2026-10-27T10:00:00Z', created_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T12:30:00Z' },
      { payment_hash: 'd'.repeat(64), amount: 10000, status: 'pending', time: '2026-10-27T11:00:00Z' },
    ],
  });
  const [paid, open] = await provider().listPayments({ limit: 2 });
  assert.equal(paid.type, 'receive');
  assert.equal(paid.amount, 50);
  assert.equal(paid.timestamp, Date.parse('2026-10-27T10:00:00Z') / 1000);
  assert.equal(paid.settled_at, Date.parse('2026-10-27T12:30:00Z') / 1000);
  assert.equal(open.status, 'pending');
  assert.equal(open.settled_at, null);
});

test('one payment is read by its hash; another wallet\'s payment is nothing to this one', async () => {
  server({
    [`GET /api/v1/payments/${HASH}`]: { paid: true, preimage: 'p', details: { payment_hash: HASH, amount: 21000, status: 'pending', time: 1790000000, updated_at: 1790000600 } },
  });
  const row = await provider().getPayment(HASH);
  assert.deepEqual([row.id, row.status, row.amount, row.settled_at], [HASH, 'completed', 21, 1790000600]);
  server({ [`GET /api/v1/payments/${HASH}`]: { paid: true, preimage: 'p' } });
  assert.equal(await provider().getPayment(HASH), null);
});

test('the message reader alone', () => {
  assert.deepEqual(lnbitsPaymentHint(JSON.stringify({ payment: { payment_hash: HASH } })), { paymentHash: HASH });
  assert.equal(lnbitsPaymentHint('x'.repeat(200_000)), null);
  assert.equal(lnbitsPaymentHint('null'), null);
});
