import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupNwcInvoice, makeNwcInvoice } from '../nwcReceive.js';
import { NWC_ERROR } from '../../utils/nwcErrors.js';
import { checkNWCPaymentStatus } from '../../utils/paymentMonitor.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

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

// ── Paid means settled, never "has a preimage" ────────────────────────────

const ZEROS = '0'.repeat(64);

test('an unpaid invoice that carries a preimage is not paid', async () => {
  // The LNbits NWC extension's lookup_invoice for an unpaid incoming invoice:
  // a preimage (stored, or zeros) and settled_at null, no state.
  for (const record of [
    { invoice: 'lnbc1', payment_hash: HASH, preimage: ZEROS, settled_at: null, amount: 21000 },
    { state: 'pending', preimage: 'cafe' },
    { state: 'expired', preimage: 'cafe' },
    { state: 'accepted', preimage: 'cafe' }, // a hold invoice taken, not settled
  ]) {
    const { nwc } = connection({ lookup: () => record });
    assert.deepEqual(await lookupNwcInvoice(nwc, HASH, { methods: ['lookup_invoice'] }), { paid: false }, JSON.stringify(record));
  }
});

test('the settled check reads settlement fields only', () => {
  assert.equal(checkNWCPaymentStatus({ preimage: 'cafe' }), false, 'a preimage alone');
  assert.equal(checkNWCPaymentStatus({ paid: false, preimage: 'cafe' }), false, 'WebLN lookupInvoice of an unpaid invoice');
  assert.equal(checkNWCPaymentStatus({ state: 'pending', settled_at: 0 }), false);
  assert.equal(checkNWCPaymentStatus({ state: 'SETTLED' }), true);
  assert.equal(checkNWCPaymentStatus({ settled_at: 1_800_000_000 }), true, 'older wallets without state');
  assert.equal(checkNWCPaymentStatus({ settledAt: 1_800_000_000 }), true);
  assert.equal(checkNWCPaymentStatus({ paid: true }), true);
  assert.equal(checkNWCPaymentStatus({ status: 'completed' }), true);
  assert.equal(checkNWCPaymentStatus({ status: 'pending', preimage: 'cafe' }), false);
  assert.equal(checkNWCPaymentStatus(null), false);
});

test('an invoice without expires_at takes the expiry written in it', async () => {
  const invoice = profileInvoiceFixture(21, 1_800_000_000_000);
  const { nwc } = connection({ make: () => ({ invoice }) }); // no payment_hash, no expires_at
  const made = await makeNwcInvoice(nwc, { amountSats: 21 });
  assert.equal(made.expiresAt, 1_800_000_900, 'so a screen watching it stops at expiry');
  assert.match(made.paymentHash, /^[0-9a-f]{64}$/);
});

test('a lookup-only wallet that does not know an unpaid invoice yet means "not yet"', async () => {
  const { nwc } = connection({ lookup: () => { throw sdk('invoice not found', 'NOT_FOUND'); } });
  assert.deepEqual(await lookupNwcInvoice(nwc, HASH, { methods: ['lookup_invoice'] }), { paid: false });
});

// ── Records without `state`: "settled" is confirmed before it is believed ──

const now = () => Math.floor(Date.now() / 1000);
// The LNbits NWC extension's lookup_invoice: settled_at is the creation time
// for a paid invoice AND for one its node marked failed when it expired.
const lnbitsRecord = (expiresAt) => ({ invoice: 'lnbc1', payment_hash: HASH, preimage: ZEROS, amount: 21000, created_at: now() - 7200, expires_at: expiresAt, settled_at: now() - 7200 });

test('an expired invoice that a stateless wallet calls settled is paid only if its payment list says so', async () => {
  const failed = connection({ lookup: () => lnbitsRecord(now() - 3600), list: () => ({ transactions: [] }) });
  assert.deepEqual(await lookupNwcInvoice(failed.nwc, HASH, { methods: ['lookup_invoice', 'list_transactions'] }), { paid: false }, 'expired and failed: not in the list');
  assert.deepEqual(failed.asked.map(([m]) => m), ['lookup_invoice', 'list_transactions']);

  const paid = connection({ lookup: () => lnbitsRecord(now() - 3600), list: () => ({ transactions: [{ payment_hash: HASH, settled_at: now() - 7000, amount: 21000 }] }) });
  assert.equal((await lookupNwcInvoice(paid.nwc, HASH, { methods: ['lookup_invoice', 'list_transactions'] })).paid, true, 'paid: it is in the list');
});

test('without a list, a stateless "settled" is believed before expiry; after it, the answer is "cannot tell"', async () => {
  // Past expiry a paid and a failed LNbits record are identical: neither a
  // false "paid" nor a false "expired" for a sale that was paid.
  const expired = connection({ lookup: () => lnbitsRecord(now() - 3600) });
  await assert.rejects(lookupNwcInvoice(expired.nwc, HASH, { methods: ['lookup_invoice'] }), (e) => e.code === NWC_ERROR.RECEIPT_UNKNOWN);
  const live = connection({ lookup: () => lnbitsRecord(now() + 3600) });
  const answer = await lookupNwcInvoice(live.nwc, HASH, { methods: ['lookup_invoice'] });
  assert.equal(answer.paid, true);
  assert.equal(answer.preimage, undefined, 'the all-zero placeholder is not passed on as a preimage');
});

test('grants never saved and a list the wallet refuses: the expiry rule decides', async () => {
  const live = connection({ lookup: () => lnbitsRecord(now() + 3600), list: () => { throw sdk('not allowed', 'RESTRICTED'); } });
  assert.equal((await lookupNwcInvoice(live.nwc, HASH, {})).paid, true);
  const known = connection({ lookup: () => lnbitsRecord(now() + 3600), list: () => { throw sdk('reply timeout: x', 'INTERNAL'); } });
  await assert.rejects(lookupNwcInvoice(known.nwc, HASH, { methods: ['lookup_invoice', 'list_transactions'] }), /reply timeout/, 'granted list: its failure is real');
});

test('a record with `state` is read as given, without a second request', async () => {
  const { nwc, asked } = connection({ lookup: () => ({ state: 'settled', settled_at: now() - 10, expires_at: now() - 5 }) });
  assert.equal((await lookupNwcInvoice(nwc, HASH, { methods: ['lookup_invoice', 'list_transactions'] })).paid, true);
  assert.deepEqual(asked.map(([m]) => m), ['lookup_invoice']);
});
