/**
 * payAgain - which payments can be made again.
 *
 * Coverage focus:
 *   - only completed outgoing payments qualify
 *   - only the send-time record is repeated, never the other stamps
 *   - each destination kind, and an address that does not match its kind
 *   - the LUD-11 pay link kept from before the record, without an amount
 *   - amount and recipient-currency values are kept only when sound
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesOneOrder, payAgainProof, payAgainRecord, payAgainTarget, provesPayment, sendsPayoutAmount } from '../payAgain.js';

const SPARK = 'spark1pgssyuuuhnrrdjswal5c3s3rafw9w3y5dd4cjy3duxlf7hjzkp0rqx6dj6mrhu';
const ARK = 'ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kldfugg29k34y7j96q2w4t567uy9ukgfl2ntulrsw0z5txqlhc2tvdmlnnnwplyajfwpaq4rxztzadm9';
const LNURL = 'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const done = { type: 'outgoing', status: 'completed', amount: -1502 };
const record = (extra = {}) => ({ address: 'alice@example.com', addressType: 'lightning', amountSats: 1500, ...extra });

test('a completed outgoing payment with a record can be paid again', () => {
  assert.deepEqual(payAgainTarget({ tx: done, metadata: { payAgain: record() } }), {
    address: 'alice@example.com', addressType: 'lightning', amountSats: 1500, payout: null,
  });
  // A payment without a status counts as completed, as it always has.
  assert.ok(payAgainTarget({ tx: { type: 'outgoing' }, metadata: { payAgain: record() } }));
});

test('receives, pending and failed payments never can', () => {
  for (const tx of [
    { ...done, type: 'incoming' },
    { ...done, status: 'pending' },
    { ...done, status: 'failed' },
    { ...done, status: 'expired' },
    null,
  ]) {
    assert.equal(payAgainTarget({ tx, metadata: { payAgain: record() } }), null);
  }
});

test('the other stamps on a payment are never repeated', () => {
  // A recipient address, a contact or a service identity can be inferred;
  // without the send-time record there is nothing to pay again.
  assert.equal(payAgainTarget({
    tx: done,
    metadata: { recipientAddress: 'alice@example.com', contactId: 'c1', label: 'Alice' },
  }), null);
  assert.equal(payAgainTarget({ tx: done, metadata: null }), null);
});

test('each destination kind, and only an address of that kind', () => {
  for (const [addressType, address] of [['lightning', 'bob@example.com'], ['lnurl', LNURL], ['spark', SPARK], ['arkade', ARK], ['bitcoin', BTC]]) {
    assert.equal(payAgainRecord({ address, addressType })?.addressType, addressType);
  }
  for (const bad of [
    { address: 'bob@example.com', addressType: 'bitcoin' },
    { address: 'lnbc10u1pexample', addressType: 'invoice' },
    { address: SPARK, addressType: 'lightning' },
    { address: 'bob@example.com', addressType: 'spark' },
    { address: '', addressType: 'lightning' },
    { address: 'bob@example.com', addressType: 'toString' },
    'bob@example.com',
  ]) {
    assert.equal(payAgainRecord(bad), null, JSON.stringify(bad));
  }
});

test('a reusable pay link from before the record: Details offers it without an amount, the swipe does not', () => {
  assert.deepEqual(payAgainTarget({ tx: done, metadata: { payLink: LNURL }, withPayLink: true }), {
    address: LNURL, addressType: 'lnurl', amountSats: null, payout: null,
  });
  // It can be stamped by time alone, so History's swipe leaves it out.
  assert.equal(payAgainTarget({ tx: done, metadata: { payLink: LNURL } }), null);
  // The record wins over the older link.
  assert.equal(payAgainTarget({ tx: done, metadata: { payLink: LNURL, payAgain: record() }, withPayLink: true }).address, 'alice@example.com');
});

test('amounts and the recipient currency are kept only when sound', () => {
  for (const amountSats of [0, -5, 1.5, 'x', Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(payAgainRecord(record({ amountSats })).amountSats, null, String(amountSats));
  }
  assert.deepEqual(payAgainRecord(record({ payout: { code: 'KES', amount: 1645 } })).payout, { code: 'KES', amount: 1645 });
  for (const payout of [{ code: 'kes', amount: 1645 }, { code: 'KES', amount: 0 }, { code: 'KESX', amount: 5 }, { amount: 5 }, 'KES:1645']) {
    assert.equal(payAgainRecord(record({ payout })).payout, null, JSON.stringify(payout));
  }
});

test('a payment is proven only by an id, payment hash or preimage the send returned', () => {
  const proof = payAgainProof(['p1', '', null, 7, ' h1 ', 'p1']);
  assert.deepEqual(proof, ['p1', 'h1']);
  assert.ok(provesPayment({ id: 'p1' }, proof));
  assert.ok(provesPayment({ id: 'x', paymentHash: 'h1' }, proof));
  assert.ok(provesPayment({ id: 'x', preimage: 'p1' }, proof));
  assert.equal(provesPayment({ id: 'x', amount: -1500 }, proof), false);
  assert.equal(provesPayment({ id: 'p1' }, []), false);
  assert.deepEqual(payAgainProof('p1'), []);
  // Hex is spelled in either case by different providers.
  assert.ok(provesPayment({ id: 'x', paymentHash: 'AB12' }, payAgainProof(['ab12'])));
  assert.ok(provesPayment({ id: 'x', paymentHash: 'ab12' }, payAgainProof(['AB12'])));
});

test('only wallets that send an amount in the recipient currency keep one', () => {
  for (const type of ['spark', 'arkade', 'lnbits']) assert.equal(sendsPayoutAmount(type), true, type);
  for (const type of ['nwc', null, undefined, 'bitcoin']) assert.equal(sendsPayoutAmount(type), false, String(type));
});

test('a plain Bitcoin address code can be paid again; a code for one order cannot', () => {
  assert.equal(namesOneOrder(null), false);
  assert.equal(namesOneOrder({ address: BTC }), false);
  assert.equal(namesOneOrder({ address: BTC, label: 'Savings' }), false);
  assert.equal(namesOneOrder({ address: BTC, amount: '0.0005' }), true);
  assert.equal(namesOneOrder({ address: BTC, lightning: 'lnbc1' }), true);
  assert.equal(namesOneOrder({ address: BTC, lno: 'lno1' }), true);
  assert.equal(namesOneOrder({ address: BTC, params: { spark: SPARK } }), true);
  assert.equal(namesOneOrder({ address: BTC, params: { spark: 'not-an-address' } }), true, 'any Spark rail, valid or not');
  assert.equal(namesOneOrder({ address: BTC, params: { branta_id: 'x', branta_secret: 'y' } }), true, 'a verified business');
  assert.equal(namesOneOrder({ address: BTC, params: { pj: 'https://shop.example/pj' } }), true, 'a payjoin checkout');
  assert.equal(namesOneOrder({ address: BTC, params: { 'req-terms': '1' } }), true);
  assert.equal(namesOneOrder({ address: BTC, params: { label: 'Savings' } }), false);
});
