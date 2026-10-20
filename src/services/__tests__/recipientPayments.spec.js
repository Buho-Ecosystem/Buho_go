/**
 * recipientPayments - the payments made to one recipient, across wallets.
 *
 * Coverage focus:
 *   - outgoing payments match by address, recipient address, Pay again
 *     record or contact link; incoming only by the contact link
 *   - unsettled payments are never listed
 *   - a wallet without a provider, or whose provider fails, answers from
 *     History's cached list; one that cannot answer leaves the others
 *   - a full page says older payments may exist
 *   - the summary counts outgoing payments only
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecipientPayments, matchesRecipient, paymentTimeMs, summarizePayments } from '../recipientPayments.js';

const at = (day) => Date.UTC(2026, 9, day) / 1000;
const sent = (id, amount, day, extra = {}) => ({ id, type: 'outgoing', status: 'completed', amount, fee: 0, timestamp: at(day), ...extra });

test('outgoing payments match by any address they carry, incoming only by the contact link', () => {
  const aliases = new Set(['shop@example.com']);
  assert.ok(matchesRecipient({ type: 'outgoing', lnaddress: 'SHOP@example.com' }, null, { aliases }));
  assert.ok(matchesRecipient({ type: 'outgoing' }, { recipientAddress: 'shop@example.com' }, { aliases }));
  assert.ok(matchesRecipient({ type: 'outgoing' }, { payAgain: { address: 'shop@example.com' } }, { aliases }));
  assert.ok(matchesRecipient({ type: 'outgoing' }, { contactId: 'c1' }, { aliases, contactId: 'c1' }));
  assert.equal(matchesRecipient({ type: 'outgoing' }, { recipientAddress: 'other@example.com' }, { aliases }), false);
  // An incoming payment's address is the user's own.
  assert.equal(matchesRecipient({ type: 'incoming', lnaddress: 'shop@example.com' }, null, { aliases }), false);
  assert.ok(matchesRecipient({ type: 'incoming' }, { contactId: 'c1' }, { aliases, contactId: 'c1' }));
  assert.equal(matchesRecipient({ type: 'swap' }, { contactId: 'c1' }, { aliases, contactId: 'c1' }), false);
});

test('settled payments from every wallet, newest first; History answers when the provider cannot', async () => {
  const metadata = {
    'A:a1': { recipientAddress: 'shop@example.com' },
    'A:a2': { recipientAddress: 'shop@example.com' },
    'A:a3': { recipientAddress: 'shop@example.com' },
    'B:b1': { payAgain: { address: 'shop@example.com' } },
    'C:c1': { recipientAddress: 'shop@example.com' },
  };
  const { payments, complete } = await loadRecipientPayments({
    wallets: [{ id: 'A', type: 'lnbits' }, { id: 'B', type: 'nwc' }, { id: 'C', type: 'spark' }],
    providers: {
      A: { getTransactions: async () => [sent('a1', -4200, 3), sent('a2', -900, 9, { status: 'failed' }), sent('a3', -3900, 12)] },
      C: { getTransactions: async () => { throw new Error('offline'); } },
    },
    readCache: (walletId) => ({ B: [sent('b1', -4500, 15)], C: [sent('c1', -4100, 1)] }[walletId] || []),
    metadataFor: (txId, walletId) => metadata[`${walletId}:${txId}`] || null,
    addresses: ['Shop@example.com', ''],
  });
  assert.deepEqual(payments.map((p) => p.sourceKey), ['B:b1', 'A:a3', 'A:a1', 'C:c1']);
  assert.equal(payments[0].walletId, 'B');
  assert.equal(payments[1].amountSats, 3900);
  assert.equal(complete, true);
});

test('a wallet that answers with a full page may hold more', async () => {
  const page = Array.from({ length: 100 }, (_, i) => sent(`p${i}`, -10, 1));
  const { complete } = await loadRecipientPayments({
    wallets: [{ id: 'A', type: 'lnbits' }],
    providers: { A: { getTransactions: async () => page } },
    metadataFor: () => null,
    addresses: ['shop@example.com'],
  });
  assert.equal(complete, false);
});

test('nothing to match by, nothing listed', async () => {
  assert.deepEqual(await loadRecipientPayments({ wallets: [{ id: 'A' }], metadataFor: () => null, addresses: [] }), { payments: [], complete: true });
});

test('the summary counts what was paid, not what was received', () => {
  assert.deepEqual(summarizePayments([
    { type: 'outgoing', amountSats: 4200, timeMs: 3000 },
    { type: 'incoming', amountSats: 9999, timeMs: 1000 },
    { type: 'outgoing', amountSats: 3900, timeMs: 2000 },
  ]), { count: 2, totalSats: 8100, sinceMs: 2000 });
  assert.deepEqual(summarizePayments([]), { count: 0, totalSats: 0, sinceMs: 0 });
});

test('times come from whichever field the provider sets', () => {
  assert.equal(paymentTimeMs({ settled_at: 1700000000 }), 1700000000000);
  assert.equal(paymentTimeMs({ timestamp: 1700000000000 }), 1700000000000);
  assert.equal(paymentTimeMs({ created_at: '2026-10-01T00:00:00Z' }), Date.UTC(2026, 9, 1));
  assert.equal(paymentTimeMs({}), 0);
});
