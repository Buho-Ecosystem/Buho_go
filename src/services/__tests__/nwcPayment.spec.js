import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { payWithNwc, provesPayment } from '../nwcPayment.js';
import { NWC_ERROR } from '../../utils/nwcErrors.js';

const PREIMAGE = '11'.repeat(32);
const HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex');
const decodeInvoice = () => ({ paymentHash: HASH, amountSats: 5000 });
const fast = { decodeInvoice, sleep: async () => {}, lookupDelays: [1, 1, 1] };
const sdk = (message, code) => Object.assign(new Error(message), { code });

/** A stub NWC provider: scripted pay answers and lookup records. */
function wallet({ pay, lookups = [] } = {}) {
  const calls = { pay: 0, lookup: 0 };
  return {
    calls,
    sendPayment: async () => { calls.pay += 1; return pay(); },
    client: {
      lookupInvoice: async () => {
        const next = lookups[calls.lookup++] ?? lookups[lookups.length - 1];
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

test('a preimage that hashes to the invoice is proof', async () => {
  assert.equal(await provesPayment(PREIMAGE, HASH), true);
  assert.equal(await provesPayment('22'.repeat(32), HASH), false);
  assert.equal(await provesPayment('', HASH), false);
  const w = wallet({ pay: () => ({ preimage: PREIMAGE }) });
  assert.deepEqual(await payWithNwc(w, 'lnbc1', fast), { preimage: PREIMAGE });
  assert.equal(w.calls.lookup, 0);
});

test('an answer without proof is looked up, never paid again', async () => {
  const w = wallet({ pay: () => ({ preimage: '' }), lookups: [sdk('not yet', 'NOT_FOUND'), { state: 'settled', preimage: PREIMAGE }] });
  assert.deepEqual(await payWithNwc(w, 'lnbc1', fast), { preimage: PREIMAGE });
  assert.equal(w.calls.pay, 1);
});

test('no reply is unknown: looked up until the wallet says', async () => {
  const w = wallet({ pay: () => { throw sdk('reply timeout: event x', 'INTERNAL'); }, lookups: [{ state: 'pending' }, { state: 'settled', settled_at: 1 }] });
  const result = await payWithNwc(w, 'lnbc1', fast);
  assert.equal(result.preimage, '', 'the wallet record confirms even without a preimage');
  assert.equal(w.calls.pay, 1);
});

test('a lookup that says failed is a failure', async () => {
  const w = wallet({ pay: () => { throw sdk('boom', 'INTERNAL'); }, lookups: [{ state: 'failed' }] });
  await assert.rejects(payWithNwc(w, 'lnbc1', fast), (e) => e.code === 'PAYMENT_FAILED');
});

test('still unknown after every lookup: the person checks before paying again', async () => {
  const w = wallet({ pay: () => { throw sdk('reply timeout: x', 'INTERNAL'); }, lookups: [{ state: 'pending' }] });
  await assert.rejects(payWithNwc(w, 'lnbc1', fast), (e) => e.code === NWC_ERROR.UNCONFIRMED && e.paymentHash === HASH);
  assert.equal(w.calls.pay, 1, 'never sent twice');
  assert.equal(w.calls.lookup, 3);
});

test('a wallet that cannot look up stops early, still unconfirmed', async () => {
  const w = wallet({ pay: () => { throw sdk('reply timeout: x', 'INTERNAL'); }, lookups: [sdk('no', 'NOT_IMPLEMENTED')] });
  await assert.rejects(payWithNwc(w, 'lnbc1', fast), (e) => e.code === NWC_ERROR.UNCONFIRMED);
  assert.equal(w.calls.lookup, 1);
});

test('a clear refusal passes straight through, without lookups', async () => {
  const w = wallet({ pay: () => { throw sdk('limit', 'QUOTA_EXCEEDED'); } });
  await assert.rejects(payWithNwc(w, 'lnbc1', fast), (e) => e.code === 'QUOTA_EXCEEDED');
  assert.equal(w.calls.lookup, 0);
});

test('a payment above the shared spending limit stops before it is sent', async () => {
  const w = wallet({ pay: () => ({ preimage: PREIMAGE }) });
  await assert.rejects(
    payWithNwc(w, 'lnbc1', { ...fast, limit: { remainingSats: 2400, renewsAt: 1 } }),
    (e) => e.code === NWC_ERROR.LIMIT_TOO_LOW && e.remainingSats === 2400,
  );
  assert.equal(w.calls.pay, 0);
  assert.deepEqual(await payWithNwc(w, 'lnbc1', { ...fast, limit: { remainingSats: 9000 } }), { preimage: PREIMAGE });
});

test('a limit raised in the wallet since it was last read lets the payment through', async () => {
  // The cached figure says 2,400 sats left; the wallet now says otherwise.
  const msat = (sats) => sats * 1000;
  const cached = { remainingSats: 2400, renewsAt: null };
  const raised = wallet({ pay: () => ({ preimage: PREIMAGE }) });
  raised.client.getBudget = async () => ({ total_budget: msat(20000), used_budget: msat(1000) });
  assert.deepEqual(await payWithNwc(raised, 'lnbc1', { ...fast, limit: cached }), { preimage: PREIMAGE });
  assert.equal(raised.calls.pay, 1);

  const still = wallet({ pay: () => ({ preimage: PREIMAGE }) });
  still.client.getBudget = async () => ({ total_budget: msat(3000), used_budget: msat(1000) });
  await assert.rejects(payWithNwc(still, 'lnbc1', { ...fast, limit: cached }), (e) => e.code === NWC_ERROR.LIMIT_TOO_LOW && e.remainingSats === 2000);
  assert.equal(still.calls.pay, 0, 'the current figure is the one shown');

  const silent = wallet({ pay: () => ({ preimage: PREIMAGE }) });
  silent.client.getBudget = async () => { throw sdk('reply timeout', 'INTERNAL'); };
  await assert.rejects(payWithNwc(silent, 'lnbc1', { ...fast, limit: cached }), (e) => e.code === NWC_ERROR.LIMIT_TOO_LOW && e.remainingSats === 2400);
});
