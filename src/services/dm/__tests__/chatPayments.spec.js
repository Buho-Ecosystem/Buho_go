/**
 * The seam between a payment made from the chat and the announcement that
 * follows it: the context string, the always-on announcer and the wallet check
 * for incoming payment claims.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/chatPayments.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DM_ERROR, DmError } from '../errors.js';
import { buildChatPaymentContext, parseChatPaymentContext } from '../paymentContext.js';
import { PAYMENT_SENT_EVENT, createPaymentAnnouncer } from '../paymentAnnouncer.js';
import { CONFIRMATION_WINDOW_SECONDS, confirmIncomingPayments } from '../paymentConfirmation.js';

const PARTNER = 'a'.repeat(64);
const REQUEST = 'b'.repeat(64);

// ---------------------------------------------------------------------------
// paymentContext
// ---------------------------------------------------------------------------

test('context: a plain send and a request payment round-trip', () => {
  assert.equal(buildChatPaymentContext(PARTNER), `chat:${PARTNER}`);
  assert.deepEqual(parseChatPaymentContext(`chat:${PARTNER}`), { partner: PARTNER, requestId: null });
  const withRequest = buildChatPaymentContext(PARTNER.toUpperCase(), REQUEST.toUpperCase());
  assert.equal(withRequest, `chat:${PARTNER}:${REQUEST}`);
  assert.deepEqual(parseChatPaymentContext(withRequest), { partner: PARTNER, requestId: REQUEST });
});

test('context: builders refuse malformed ids, the parser refuses everything that is not exactly a chat context', () => {
  assert.throws(() => buildChatPaymentContext('nope'), TypeError);
  assert.throws(() => buildChatPaymentContext(PARTNER, 'short'), TypeError);
  for (const bad of [null, undefined, 42, '', 'chat', 'chat:', `chat:${PARTNER}:`, `chat:${PARTNER}:zz`,
    `chat:xyz`, `other:${PARTNER}`, `chat:${PARTNER}:${REQUEST}:extra`, `CHAT:${PARTNER}`]) {
    assert.equal(parseChatPaymentContext(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// paymentAnnouncer
// ---------------------------------------------------------------------------

function harness({ fail } = {}) {
  const listeners = new Map();
  const bus = {
    on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    off: (event, fn) => listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== fn)),
    emit: (event, data) => (listeners.get(event) ?? []).forEach((fn) => fn(data)),
    count: (event) => (listeners.get(event) ?? []).length,
  };
  const calls = [];
  const errors = [];
  const runtime = {
    announcePayment: async (partner, payment) => {
      calls.push({ partner, payment });
      if (fail) throw fail;
      return { payment: {}, status: null, statusError: null };
    },
  };
  const announcer = createPaymentAnnouncer({
    bus, runtime, onError: (code) => errors.push(code),
    noteFor: (partner, requestId) => (requestId ? 'Pizza' : undefined),
  });
  return { bus, calls, errors, announcer };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('announcer: a chat payment is announced to the partner, with the request id and preimage', async () => {
  const { bus, calls, announcer } = harness();
  announcer.start();
  bus.emit(PAYMENT_SENT_EVENT, {
    context: buildChatPaymentContext(PARTNER, REQUEST), amountSats: 25_000, preimage: 'c'.repeat(64), note: null,
  });
  await flush();
  assert.deepEqual(calls, [{
    partner: PARTNER,
    payment: { amountSats: 25_000, note: 'Pizza', preimage: 'c'.repeat(64), requestId: REQUEST },
  }]);
});

test('announcer: a plain send carries the comment as the note and no request id', async () => {
  const { bus, calls, announcer } = harness();
  announcer.start();
  bus.emit(PAYMENT_SENT_EVENT, { context: buildChatPaymentContext(PARTNER), amountSats: 5000, note: 'Coffee' });
  await flush();
  assert.deepEqual(calls[0].payment, { amountSats: 5000, note: 'Coffee', preimage: undefined, requestId: undefined });
});

test('announcer: payments without a chat context, or without an amount, are ignored', async () => {
  const { bus, calls, announcer } = harness();
  announcer.start();
  for (const event of [
    { amountSats: 100 }, { context: null, amountSats: 100 }, { context: 'other:thing', amountSats: 100 },
    { context: buildChatPaymentContext(PARTNER), amountSats: 0 },
    { context: buildChatPaymentContext(PARTNER), amountSats: 1.5 },
    { context: buildChatPaymentContext(PARTNER) }, undefined, null,
  ]) bus.emit(PAYMENT_SENT_EVENT, event);
  await flush();
  assert.equal(calls.length, 0);
});

test('announcer: start twice registers once, stop unregisters', () => {
  const { bus, announcer } = harness();
  announcer.start();
  announcer.start();
  assert.equal(bus.count(PAYMENT_SENT_EVENT), 1);
  announcer.stop();
  announcer.stop();
  assert.equal(bus.count(PAYMENT_SENT_EVENT), 0);
});

test('announcer: a failing announcement reports only the error code and never throws', async () => {
  const { bus, errors, announcer } = harness({ fail: new DmError(DM_ERROR.NO_INBOX_RELAYS, 'x') });
  announcer.start();
  bus.emit(PAYMENT_SENT_EVENT, { context: buildChatPaymentContext(PARTNER), amountSats: 10 });
  await flush();
  assert.deepEqual(errors, [DM_ERROR.NO_INBOX_RELAYS]);

  const other = harness({ fail: new Error('boom') });
  other.announcer.start();
  other.bus.emit(PAYMENT_SENT_EVENT, { context: buildChatPaymentContext(PARTNER), amountSats: 10 });
  await flush();
  assert.deepEqual(other.errors, ['UNKNOWN']);
});

test('announcer: refuses to be built without its collaborators', () => {
  assert.throws(() => createPaymentAnnouncer({ runtime: { announcePayment() {} } }), TypeError);
  assert.throws(() => createPaymentAnnouncer({ bus: { on() {}, off() {} }, runtime: {} }), TypeError);
});

// ---------------------------------------------------------------------------
// paymentConfirmation
// ---------------------------------------------------------------------------

const preimage = '11'.repeat(32);
const hash = bytesToHex(sha256(Uint8Array.from(preimage.match(/../g), (p) => parseInt(p, 16))));
const message = (id, createdAt, payment) => ({ id, createdAt, payment });

test('confirmation: a preimage must hash to an incoming transaction', () => {
  const ok = message('m1', 1000, { amountSats: 500, preimage });
  const lie = message('m2', 1000, { amountSats: 500, preimage: '22'.repeat(32) });
  const confirmed = confirmIncomingPayments([ok, lie], [{ amountSats: 500, settledAt: 1000, paymentHash: hash.toUpperCase() }]);
  assert.deepEqual([...confirmed], ['m1']);
});

test('confirmation: a wrong preimage is not rescued by a matching amount', () => {
  const lie = message('m', 1000, { amountSats: 500, preimage: '22'.repeat(32) });
  assert.equal(confirmIncomingPayments([lie], [{ amountSats: 500, settledAt: 1000, paymentHash: hash }]).size, 0);
});

test('confirmation: without a preimage amount and time window decide', () => {
  const claim = message('m', 10_000, { amountSats: 700, preimage: null });
  const inWindow = { amountSats: 700, settledAt: 10_000 + CONFIRMATION_WINDOW_SECONDS };
  const outside = { amountSats: 700, settledAt: 10_000 + CONFIRMATION_WINDOW_SECONDS + 1 };
  const wrongAmount = { amountSats: 701, settledAt: 10_000 };
  assert.equal(confirmIncomingPayments([claim], [inWindow]).has('m'), true);
  assert.equal(confirmIncomingPayments([claim], [outside]).has('m'), false);
  assert.equal(confirmIncomingPayments([claim], [wrongAmount]).has('m'), false);
  assert.equal(confirmIncomingPayments([claim], []).has('m'), false);
});

test('confirmation: one transaction confirms only one claim', () => {
  const a = message('a', 1000, { amountSats: 300, preimage: null });
  const b = message('b', 1100, { amountSats: 300, preimage: null });
  const once = confirmIncomingPayments([a, b], [{ amountSats: 300, settledAt: 1050 }]);
  assert.deepEqual([...once], ['a']);
  const twice = confirmIncomingPayments([a, b], [{ amountSats: 300, settledAt: 1050 }, { amountSats: 300, settledAt: 1060 }]);
  assert.deepEqual([...twice].sort(), ['a', 'b']);
});

test('confirmation: proof beats amount for the same transaction', () => {
  const early = message('early', 1000, { amountSats: 500, preimage: null });
  const proven = message('proven', 1200, { amountSats: 500, preimage });
  const confirmed = confirmIncomingPayments([early, proven], [{ amountSats: 500, settledAt: 1100, paymentHash: hash }]);
  assert.deepEqual([...confirmed], ['proven']);
});

test('confirmation: bad input is an empty answer', () => {
  assert.equal(confirmIncomingPayments(undefined, undefined).size, 0);
  assert.equal(confirmIncomingPayments([message('m', 1, { amountSats: 1, preimage: 'zz' })], [{ amountSats: 1, settledAt: 1 }]).size, 1);
});

// ---------------------------------------------------------------------------
// incomingTransactions
// ---------------------------------------------------------------------------

const { loadIncomingTransactions } = await import('../incomingTransactions.js');

test('incoming transactions: settled incoming rows of every wallet, times in seconds, failures skipped', async () => {
  const rows = {
    a: [
      { type: 'incoming', status: 'completed', recipientSats: 700, settled_at: 1_700_000_000, paymentHash: 'h1' },
      { type: 'incoming', status: 'pending', recipientSats: 5, settled_at: 1_700_000_000 },
      { type: 'incoming', status: 'failed', recipientSats: 6, settled_at: 1_700_000_000 },
      { type: 'outgoing', status: 'completed', recipientSats: 7, settled_at: 1_700_000_000 },
      { type: 'incoming', status: 'completed', amount: -300, settled_at: 1_700_000_000_000 },
      { type: 'incoming', status: 'completed', recipientSats: 0, settled_at: 1_700_000_000 },
      { type: 'incoming', status: 'completed', recipientSats: 9 },
    ],
    b: { transactions: [{ type: 'incoming', status: 'completed', recipientSats: 11, created_at: '2023-11-14T22:13:20Z' }] },
  };
  const providers = {
    a: { getTransactions: async ({ limit }) => { assert.equal(limit, 50); return rows.a; } },
    b: { getTransactions: async () => rows.b },
    broken: { getTransactions: async () => { throw new Error('offline'); } },
    mute: {},
  };
  const result = await loadIncomingTransactions({
    wallets: [{ id: 'a', type: 'spark' }, { id: 'b', type: 'lnbits' }, { id: 'broken' }, { id: 'mute' }, { id: 'locked' }],
    getProvider: (id) => providers[id],
    normalizeTx: (row) => ({ ...row }),
  });
  assert.deepEqual(result, [
    { amountSats: 700, settledAt: 1_700_000_000, paymentHash: 'h1' },
    { amountSats: 300, settledAt: 1_700_000_000, paymentHash: null },
    { amountSats: 11, settledAt: 1_700_000_000, paymentHash: null },
  ]);
  assert.deepEqual(await loadIncomingTransactions({ wallets: undefined, getProvider: () => null, normalizeTx: () => ({}) }), []);
});
