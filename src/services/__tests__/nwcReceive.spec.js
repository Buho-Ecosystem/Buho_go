import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupNwcInvoice, makeNwcInvoice } from '../nwcReceive.js';
import { NWC_ERROR } from '../../utils/nwcErrors.js';

const HASH = 'ab'.repeat(32);
const sdk = (message, code) => Object.assign(new Error(message), { code });

/** A stand-in NWC connection: its NIP-47 client records every request. */
function connection({ make, lookup, list } = {}) {
  const asked = [];
  const client = {
    makeInvoice: async (request) => { asked.push(['make_invoice', request]); return make(request); },
    lookupInvoice: async (request) => { asked.push(['lookup_invoice', request]); return lookup(request); },
    listTransactions: async (request) => { asked.push(['list_transactions', request]); return list(request); },
  };
  return { nwc: { client }, asked };
}

test('an invoice is asked for in millisats and comes back with its hash and expiry', async () => {
  const { nwc, asked } = connection({ make: () => ({ invoice: 'lnbc210n1kiosk', payment_hash: HASH, expires_at: 1_900_000_000 }) });
  assert.deepEqual(await makeNwcInvoice(nwc, { amountSats: 21, description: 'Kiosk Payment' }), {
    paymentRequest: 'lnbc210n1kiosk', paymentHash: HASH, expiresAt: 1_900_000_000,
  });
  assert.deepEqual(asked, [['make_invoice', { amount: 21000, description: 'Kiosk Payment' }]]);
});

test('a wallet that leaves out the hash or the invoice', async () => {
  const noHash = connection({ make: () => ({ invoice: 'not-a-bolt11' }) });
  assert.deepEqual(await makeNwcInvoice(noHash.nwc, { amountSats: 1 }), { paymentRequest: 'not-a-bolt11', paymentHash: null, expiresAt: null });
  const empty = connection({ make: () => ({}) });
  await assert.rejects(makeNwcInvoice(empty.nwc, { amountSats: 1 }), /did not return an invoice/);
});

test('a paid invoice is found by its hash, the amount in sats', async () => {
  const { nwc, asked } = connection({ lookup: () => ({ state: 'settled', settled_at: 1, preimage: 'pre', amount: 21000 }) });
  assert.deepEqual(await lookupNwcInvoice(nwc, HASH, { methods: ['make_invoice', 'lookup_invoice'] }), { paid: true, preimage: 'pre', amount: 21 });
  // The hash itself reaches the wallet (the WebLN layer would drop it).
  assert.deepEqual(asked, [['lookup_invoice', { payment_hash: HASH }]]);
});

test('an unpaid invoice is not paid', async () => {
  const { nwc } = connection({ lookup: () => ({ state: 'pending' }) });
  assert.deepEqual(await lookupNwcInvoice(nwc, HASH, { methods: ['lookup_invoice'] }), { paid: false });
});

test('without lookup_invoice, the recent incoming payments are read instead', async () => {
  const { nwc, asked } = connection({ list: () => ({ transactions: [
    { payment_hash: 'cd'.repeat(32), state: 'settled', amount: 5000 },
    { payment_hash: HASH, state: 'settled', amount: 21000, preimage: 'pre' },
  ] }) });
  assert.deepEqual(await lookupNwcInvoice(nwc, HASH, { methods: ['make_invoice', 'list_transactions'] }), { paid: true, preimage: 'pre', amount: 21 });
  assert.deepEqual(asked.map(([method]) => method), ['list_transactions']);
});

test('a lookup the wallet cannot answer falls back to the list when allowed, and fails when not', async () => {
  const lagging = connection({
    lookup: () => { throw sdk('invoice not found', 'NOT_FOUND'); },
    list: () => ({ transactions: [{ payment_hash: HASH, settled_at: 5, amount: 1000 }] }),
  });
  assert.equal((await lookupNwcInvoice(lagging.nwc, HASH, { methods: ['lookup_invoice', 'list_transactions'] })).paid, true);

  const lookupOnly = connection({ lookup: () => { throw sdk('reply timeout: x', 'INTERNAL'); } });
  await assert.rejects(lookupNwcInvoice(lookupOnly.nwc, HASH, { methods: ['lookup_invoice'] }), /reply timeout/);
});

test('saved before grants were stored: lookup first, the list as fallback', async () => {
  const { nwc, asked } = connection({
    lookup: () => { throw sdk('not implemented', 'NOT_IMPLEMENTED'); },
    list: () => ({ transactions: [] }),
  });
  assert.deepEqual(await lookupNwcInvoice(nwc, HASH, {}), { paid: false });
  assert.deepEqual(asked.map(([method]) => method), ['lookup_invoice', 'list_transactions']);
});

test('a connection allowed neither cannot confirm a payment and says so', async () => {
  const { nwc, asked } = connection({});
  await assert.rejects(lookupNwcInvoice(nwc, HASH, { methods: ['make_invoice'] }), (e) => e.code === NWC_ERROR.CONFIRM_NOT_ALLOWED);
  assert.equal(asked.length, 0);
});
