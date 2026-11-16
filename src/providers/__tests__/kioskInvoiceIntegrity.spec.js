import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('network disabled under test'); };
const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');
const { fiatRatesService } = await import('../../utils/fiatRates.js');
fiatRatesService.stopAutoUpdate();
const hash = 'd'.repeat(64);
const paid = { id: 'authoritative-history-id', paymentType: 'receive', amount: 995, fees: 5, status: 'completed',
  details: { type: 'lightning', htlcDetails: { paymentHash: hash, preimage: 'not-persisted' } } };
function provider(sdk) { const p = new BreezSparkWalletProvider('kiosk-integrity-test', { _testSdk: sdk }); p.isConnected = true; return p; }

test('lost invoice-creation reply is never automatically retried', async () => {
  let calls = 0;
  const p = provider({ receivePayment: async () => { calls++; throw new Error('Failed to fetch'); } });
  await assert.rejects(() => p.createInvoice({ amount: 21, description: 'Sale' }), /Failed to fetch/);
  assert.equal(calls, 1, 'the remote wallet may already have created the first request');
});
test('successful invoice creation retains the exact signed request hash', async () => {
  const request = profileInvoiceFixture(21, 1_800_000_000_000);
  const p = provider({ receivePayment: async () => ({ paymentRequest: request }) });
  const result = await p.createInvoice({ amount: 21, description: 'Sale' });
  assert.equal(result.paymentRequest, request);
  assert.match(result.paymentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.id, result.paymentHash);
});
test('a durable creation timestamp finds an exact late payment beyond the legacy scan limit', async () => {
  const calls = [];
  const unrelated = Array.from({ length: 100 }, (_, i) => ({ id: `other-${i}`, details: { type: 'lightning', htlcDetails: { paymentHash: 'e'.repeat(64) } } }));
  const p = provider({ listPayments: async request => { calls.push(request); return { payments: request.offset < 300 ? unrelated : [paid] }; } });
  const createdAt = 1_700_000_000_000;
  const result = await p.lookupInvoice(hash, { createdAt, strict: true });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].fromTimestamp, createdAt / 1000 - 60);
  assert.equal(result.paid, true);
  assert.equal(result.paymentHash, hash);
  assert.equal(result.transactionId, paid.id);
  assert.equal(result.amount, 1000, 'gross matches the fixed invoice');
  assert.equal(result.receivedSats, 995, 'net credit remains available separately');
});
test('legacy lookup remains bounded and strict lookup propagates an unknown receipt state', async () => {
  let pages = 0;
  const p = provider({ listPayments: async () => { pages++; return { payments: Array.from({ length: 100 }, () => ({ id: 'other' })) }; } });
  assert.equal((await p.lookupInvoice(hash)).paid, false);
  assert.equal(pages, 3);
  p.sdk.listPayments = async () => { throw new Error('unavailable'); };
  await assert.rejects(() => p.lookupInvoice(hash, { strict: true }), /unavailable/);
});
