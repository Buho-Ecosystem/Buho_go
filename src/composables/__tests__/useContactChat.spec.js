/**
 * useContactChat: the contact chat page's view-model.
 *
 * Run directly with Node:
 *   node --test src/composables/__tests__/useContactChat.spec.js
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
}
globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { createDmStorage, createMemoryBackend } = await import('../../utils/dmStorage.js');
const { useMessagesStore, configureMessages, resetMessagesConfig } = await import('../../stores/messages.js');
const { DM_ERROR, DmError } = await import('../../services/dm/errors.js');
const { parseChatPaymentContext } = await import('../../services/dm/paymentContext.js');
const { buildReceivingWallets, buildThreadItems, describeDmError, useContactChat } = await import('../useContactChat.js');

const hex = (ch) => ch.repeat(64);
const ME = hex('1');
const ANNA = hex('a');
const rid = (n) => n.toString(16).padStart(64, '0');
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? name);

let counter = 0;
const nextId = () => rid(++counter + 5000);

function msg(overrides = {}) {
  const outgoing = overrides.outgoing ?? false;
  return {
    id: nextId(), kind: 14, type: 'text', sender: outgoing ? ME : ANNA, recipient: outgoing ? ANNA : ME,
    partner: ANNA, outgoing, createdAt: 1_000_000, text: 'hi', replyTo: null,
    request: null, status: null, payment: null, reaction: null, degraded: false, ...overrides,
  };
}
const request = (o = {}) => msg({
  type: 'request', text: 'request',
  request: { amountSats: 25_000, note: 'Pizza', bolt11: 'lnbc1', paymentHash: hex('c'), lud16: null, expiresAt: 2_000_000 },
  ...o,
});
const status = (requestId, value, o = {}) => msg({
  type: 'status', text: value, replyTo: requestId, status: { requestId, value, preimage: null }, ...o,
});
const payment = (o = {}) => msg({
  type: 'payment', text: '↗ Sent', payment: { amountSats: 5000, note: 'Coffee', preimage: null, requestId: null }, ...o,
});

// ---------------------------------------------------------------------------
// buildThreadItems
// ---------------------------------------------------------------------------

function build(messages, overrides = {}) {
  return buildThreadItems({
    messages,
    partnerName: 'Anna',
    now: 1_500_000,
    reactionsFor: () => [],
    requestStateOf: () => 'pending',
    unconfirmedOf: () => false,
    disabledReasonOf: () => '',
    t,
    ...overrides,
  }).filter((item) => item.type !== 'day');
}

test('items: a text message carries delivery, reactions, degraded flag and a reply preview', () => {
  const original = msg({ text: 'Dinner on Friday?\n  at   seven', outgoing: true, delivery: 'sent' });
  const reply = msg({ text: 'Yes!', replyTo: original.id, degraded: true });
  const failed = msg({ outgoing: true, delivery: 'failed' });
  const items = build([original, reply, failed], {
    reactionsFor: (id) => (id === reply.id ? [{ emoji: '👍', count: 2, mine: true, senders: ['x'] }] : []),
  });
  assert.equal(items.length, 3);
  const [a, b, c] = items.map((item) => item.message);
  assert.equal(a.delivery, 'sent');
  assert.equal(b.delivery, 'sent', 'incoming messages are never shown as queued');
  assert.deepEqual(b.reply, { author: 'You', text: 'Dinner on Friday? at seven' });
  assert.deepEqual(b.reactions, [{ emoji: '👍', count: 2, mine: true }]);
  assert.equal(b.degraded, true);
  assert.equal(c.delivery, 'failed');
  assert.equal(a.reply, null);
  assert.equal(items[1].key, reply.id);
  assert.equal(items[1].ts, reply.createdAt);
});

test('items: a reply to a request says "Payment request"; a missing original gives no preview; long text is clipped', () => {
  const req = request();
  const toRequest = msg({ replyTo: req.id });
  const toMissing = msg({ replyTo: hex('9') });
  const long = msg({ text: 'x'.repeat(300), outgoing: true });
  const toLong = msg({ replyTo: long.id });
  const items = build([req, toRequest, toMissing, long, toLong]).filter((item) => item.type === 'message');
  assert.deepEqual(items[0].message.reply, { author: 'Anna', text: 'Payment request' });
  assert.equal(items[1].message.reply, null);
  assert.equal(items[3].message.reply.text.length, 140);
  assert.ok(items[3].message.reply.text.endsWith('…'));
});

test('items: an unknown sender cannot be reacted to and their requests are untrusted', () => {
  const items = build([msg(), request(), request({ outgoing: true })], { unknown: true });
  assert.equal(items[0].message.canReact, false);
  assert.equal(items[1].request.untrusted, true);
  assert.equal(items[2].request.untrusted, false, 'the user\'s own request is theirs');
  const known = build([msg()]);
  assert.equal(known[0].message.canReact, true);
});

test('items: a request card carries state, expiry, note, fiat and only pending incoming ones a disabled reason', () => {
  const incoming = request();
  const done = request({ id: rid(777) });
  const own = request({ outgoing: true });
  const items = build([incoming, done, own], {
    requestStateOf: (m) => (m.id === done.id ? 'paid' : 'pending'),
    disabledReasonOf: () => 'WALLET_CANNOT_PAY',
    unconfirmedOf: (m) => m.outgoing,
    formatFiat: (sats) => `≈ $${sats / 1000}`,
    busyIds: new Set([own.id]),
  });
  assert.deepEqual(items[0].request, {
    id: incoming.id, amountSats: 25_000, fiatText: '≈ $25', note: 'Pizza', outgoing: false, state: 'pending',
    validUntil: 2_000_000, invoiceExpiresAt: 2_000_000, unconfirmed: false, settlement: null, canSendAnyway: false,
    disabledReason: 'WALLET_CANNOT_PAY', untrusted: false, busy: false,
  });
  assert.equal(items[1].request.state, 'paid');
  assert.equal(items[1].request.disabledReason, '', 'a paid request has nothing to disable');
  assert.equal(items[2].request.disabledReason, '', 'the requester never pays');
  assert.equal(items[2].request.unconfirmed, true);
  assert.equal(items[2].request.busy, true);
});

test('items: a request without a known state is pending, without an expiry has none', () => {
  const noExpiry = request();
  noExpiry.request.expiresAt = null;
  const items = build([noExpiry], { requestStateOf: () => null });
  assert.equal(items[0].request.state, 'pending');
  assert.equal(items[0].request.invoiceExpiresAt, null);
  assert.equal(items[0].request.validUntil, null);
});

test('items: the card shows the request lifetime (valid_until), not the invoice expiry; legacy rules apply', () => {
  const withTag = request();
  withTag.request.validUntil = 1_900_000;
  const legacyWithAddress = request({ createdAt: 1_000_000 });
  legacyWithAddress.request.lud16 = 'anna@x.org';
  const legacyBare = request();
  const items = build([withTag, legacyWithAddress, legacyBare]);
  assert.equal(items[0].request.validUntil, 1_900_000);
  assert.equal(items[0].request.invoiceExpiresAt, 2_000_000);
  assert.equal(items[1].request.validUntil, 1_000_000 + 30 * 24 * 3600, 'lud16 but no tag: 30 days from created_at');
  assert.equal(items[2].request.validUntil, 2_000_000, 'neither: the invoice is all there is');
});

test('items: a paid own request says where it arrived only when the wallet showed it; an expired one offers Send anyway only with a target', () => {
  const own = request({ outgoing: true });
  const unverified = request({ outgoing: true });
  const expiredIncoming = request();
  const expiredOwn = request({ outgoing: true });
  const items = build([own, unverified, expiredIncoming, expiredOwn], {
    requestStateOf: (m) => (m === own || m === unverified ? 'paid' : 'expired'),
    settlementOf: (m) => (m === own ? { verified: true, walletId: 'biz' } : { verified: false, walletId: null }),
    walletNameOf: (id) => (id === 'biz' ? 'Spark Business' : ''),
    canSendAnywayOf: () => true,
  });
  assert.deepEqual(items[0].request.settlement, { verified: true, walletName: 'Spark Business' });
  assert.deepEqual(items[1].request.settlement, { verified: false, walletName: '' });
  assert.equal(items[2].request.canSendAnyway, true);
  assert.equal(items[2].request.settlement, null);
  assert.equal(items[3].request.canSendAnyway, false, 'only the payer sends');
  assert.equal(build([expiredIncoming], { requestStateOf: () => 'expired' })[0].request.canSendAnyway, false);
});

test('items: status messages are not rows, except the partner\'s reminder', () => {
  const req = request({ outgoing: true });
  const items = build([
    req,
    status(req.id, 'paid'), status(req.id, 'declined'), status(req.id, 'cancelled', { outgoing: true }),
    status(req.id, 'reminder', { outgoing: true }),
    status(req.id, 'reminder'),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[1].message.text, 'Reminder: a request is still open');
  assert.equal(items[1].message.canReact, false);
  assert.equal(items[1].message.outgoing, false);
});

test('items: an outgoing payment is a line; an incoming one only when a wallet confirmed it', () => {
  const out = payment({ outgoing: true });
  const confirmed = payment({ text: '↗ Sent 700', payment: { amountSats: 700, note: null, preimage: null, requestId: null } });
  const claim = payment({ text: '↗ Sent 9,999,999 sats', payment: { amountSats: 9_999_999, note: null, preimage: null, requestId: null } });
  const items = build([out, confirmed, claim], { confirmedPayments: new Set([confirmed.id]) });
  assert.deepEqual(items.map((item) => item.type), ['payment', 'payment', 'message']);
  assert.deepEqual(items[0].payment, { id: out.id, outgoing: true, amountSats: 5000, note: 'Coffee' });
  assert.deepEqual(items[1].payment, { id: confirmed.id, outgoing: false, amountSats: 700, note: '' });
  assert.equal(items[2].message.text, '↗ Sent 9,999,999 sats', 'an unproven claim is just the partner\'s words');
  assert.equal(items[2].message.degraded, false);
});

test('items: a payment that settles a request of the thread is not drawn twice', () => {
  const req = request();
  const paid = payment({ outgoing: true, payment: { amountSats: 25_000, note: null, preimage: null, requestId: req.id } });
  const elsewhere = payment({ outgoing: true, payment: { amountSats: 1, note: null, preimage: null, requestId: hex('8') } });
  const items = build([req, paid, elsewhere]);
  assert.deepEqual(items.map((item) => item.type), ['request', 'payment']);
  assert.equal(items[1].payment.id, elsewhere.id);
});

test('items: day separators are added and keys are unique', () => {
  const day = 86_400;
  const all = buildThreadItems({
    messages: [msg({ createdAt: 1_000_000 }), msg({ createdAt: 1_000_060 }), msg({ createdAt: 1_000_000 + 3 * day })],
    partnerName: 'Anna', now: 1_500_000, reactionsFor: () => [], requestStateOf: () => null,
    unconfirmedOf: () => false, disabledReasonOf: () => '', t,
  });
  assert.deepEqual(all.map((item) => item.type), ['day', 'message', 'message', 'day', 'message']);
  assert.equal(new Set(all.map((item) => item.key)).size, all.length);
});

test('items: an unnamed partner is "Them" in a reply preview', () => {
  const original = msg({ text: 'a' });
  const items = build([original, msg({ replyTo: original.id })], { partnerName: '' });
  assert.equal(items[1].message.reply.author, 'Them');
});

// ---------------------------------------------------------------------------
// buildReceivingWallets
// ---------------------------------------------------------------------------

const ADDRESS = 'me@btc.mybuho.de';
const WALLETS = [
  { id: 'biz', name: 'Business', type: 'spark', accountNumber: 1, lightningAddress: ADDRESS },
  { id: 'per', name: 'Personal', type: 'spark', accountNumber: 2 },
  { id: 'alby', name: 'Alby Hub', type: 'nwc', methods: ['pay_invoice'] },
  { id: 'lnb', name: 'My LNbits', type: 'lnbits' },
  { id: 'ark', name: 'Arkade', type: 'arkade' },
];
const sats = (n) => `${n} sats`;

test('receiving wallets: all four wallet types, with the runtime\'s default and usability', () => {
  const result = buildReceivingWallets({
    wallets: WALLETS, profileAddress: ADDRESS, balanceOf: (id) => (id === 'biz' ? 1200 : null), formatAmount: sats, t,
  });
  assert.equal(result.defaultId, 'biz');
  const byId = Object.fromEntries(result.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.biz.detail, 'Spark · 1200 sats');
  assert.equal(byId.per.detail, 'Spark');
  assert.equal(byId.lnb.detail, 'LNbits');
  assert.equal(byId.biz.usable, true);
  // Arkade and an NWC wallet without make_invoice settle through the profile address.
  assert.equal(byId.ark.usable, true);
  assert.equal(byId.alby.usable, true);
  assert.equal(result.landingInfo, '', 'the default wallet receives directly');
});

test('receiving wallets: Arkade and NWC without make_invoice explain where the money lands', () => {
  const arkade = buildReceivingWallets({ wallets: WALLETS, profileAddress: ADDRESS, selectedId: 'ark', formatAmount: sats, t });
  assert.equal(arkade.landingInfo, 'Arkade cannot create invoices. The request is paid to your profile address, which lands in Business.');
  const nwc = buildReceivingWallets({ wallets: WALLETS, profileAddress: ADDRESS, selectedId: 'alby', formatAmount: sats, t });
  assert.match(nwc.landingInfo, /^Alby Hub cannot create invoices/);
  const noOwner = buildReceivingWallets({ wallets: [WALLETS[4]], profileAddress: ADDRESS, formatAmount: sats, t });
  assert.equal(noOwner.landingInfo, 'Arkade cannot create invoices. The request is paid to your profile address.');
});

test('receiving wallets: without a profile address a wallet that cannot invoice is not usable', () => {
  const result = buildReceivingWallets({ wallets: [WALLETS[0], WALLETS[4]], profileAddress: null, formatAmount: sats, t });
  const ark = result.entries.find((entry) => entry.id === 'ark');
  assert.equal(ark.usable, false);
  assert.equal(ark.reason, 'Cannot create invoices');
  assert.equal(result.defaultId, 'biz');
});

test('receiving wallets: only Arkade and no address means nothing can receive', () => {
  const result = buildReceivingWallets({ wallets: [WALLETS[4]], profileAddress: null, formatAmount: sats, t });
  assert.equal(result.defaultId, null);
  assert.equal(result.entries[0].usable, false);
  assert.deepEqual(buildReceivingWallets({ wallets: [], formatAmount: sats, t }).entries, []);
});

test('receiving wallets: an unusable selection falls back to the default for the note', () => {
  const result = buildReceivingWallets({ wallets: [WALLETS[0], WALLETS[4]], profileAddress: null, selectedId: 'ark', formatAmount: sats, t });
  assert.equal(result.landingInfo, '');
});

// ---------------------------------------------------------------------------
// describeDmError
// ---------------------------------------------------------------------------

test('errors: every code the UI shows has words, NO_INBOX_RELAYS is its own kind', () => {
  const codes = [
    DM_ERROR.WALLET_CANNOT_INVOICE, DM_ERROR.INVALID_INVOICE, DM_ERROR.WALLET_CANNOT_PAY, DM_ERROR.INVOICE_EXPIRED,
    DM_ERROR.SECRET_KEY_IN_TEXT, DM_ERROR.MESSAGE_TOO_LARGE, DM_ERROR.KEY_WIPED, DM_ERROR.NO_IDENTITY,
    DM_ERROR.NO_RELAY_ACCEPTED, DM_ERROR.RELAY_UNAVAILABLE, DM_ERROR.AUTH_FAILED, DM_ERROR.TIMEOUT, DM_ERROR.INVALID_ARGUMENT,
  ];
  const messages = new Set();
  for (const code of codes) {
    const described = describeDmError(new DmError(code, 'dev text'), { t });
    assert.equal(described.code, code);
    assert.equal(described.kind, 'general');
    assert.ok(described.message && !described.message.includes('dev text'), code);
    messages.add(described.message);
  }
  assert.ok(messages.size >= 9, 'distinct codes are not all "something went wrong"');
  const none = describeDmError(new DmError(DM_ERROR.NO_INBOX_RELAYS, 'x'), { t, name: 'Anna' });
  assert.equal(none.kind, 'no-inbox');
  assert.equal(none.message, "Anna can't receive requests in the chat yet.");
  assert.equal(describeDmError(new DmError(DM_ERROR.NO_INBOX_RELAYS, 'x'), { t }).message, "This contact can't receive requests in the chat yet.");
});

test('errors: anything that is not a DmError is a generic failure that leaks nothing', () => {
  const described = describeDmError(new Error('secret nsec1 stuff'), { t });
  assert.deepEqual(described, { code: 'UNKNOWN', kind: 'general', message: 'Something went wrong. Try again.' });
});

// ---------------------------------------------------------------------------
// useContactChat (real messages store, fake runtime and clock)
// ---------------------------------------------------------------------------

function fakeTimers(start = 1_500_000_000) {
  const clock = { ms: start, timers: new Map(), seq: 0 };
  clock.setTimer = (fn, delay) => { clock.timers.set(++clock.seq, { fn, at: clock.ms + delay }); return clock.seq; };
  clock.clearTimer = (handle) => { clock.timers.delete(handle); };
  clock.now = () => clock.ms;
  clock.advance = (ms) => {
    clock.ms += ms;
    for (const [handle, timer] of [...clock.timers]) {
      if (timer.at <= clock.ms) { clock.timers.delete(handle); timer.fn(); }
    }
  };
  return clock;
}

let clock;
let store;

beforeEach(async () => {
  clock = fakeTimers();
  resetMessagesConfig();
  configureMessages({
    storage: createDmStorage({ backend: createMemoryBackend(), cipher: { encrypt: async (s) => s, decrypt: async (s) => s }, warn() {} }),
    now: () => Math.floor(clock.ms / 1000),
    nowMs: () => clock.ms,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isKnownContact: (pk) => pk === ANNA,
    warn() {},
  });
  setActivePinia(createPinia());
  store = useMessagesStore();
  await store.setScope(ME);
});

function fakeRuntime(overrides = {}) {
  const calls = [];
  const record = (name, result = {}) => async (...args) => { calls.push([name, ...args]); return result; };
  const runtime = {
    calls,
    sendText: record('sendText'),
    react: record('react'),
    retry: record('retry', true),
    declineRequest: record('declineRequest'),
    cancelRequest: record('cancelRequest'),
    remindRequest: record('remindRequest'),
    requestMoney: record('requestMoney'),
    announcePayment: record('announcePayment'),
    partnerReachability: async () => 'found',
    checkPayable: () => ({ ok: true }),
    requestState: () => null,
    requestSettlement: () => null,
    settleClaims: async () => ({ settled: 0, pending: 0 }),
    needsFreshInvoice: () => false,
    refreshInvoice: async () => ({ bolt11: 'lnbc-fresh', expiresAt: Math.floor(clock.ms / 1000) + 86_400 }),
    ...overrides,
  };
  return runtime;
}

function setup({ runtime = fakeRuntime(), payer = { id: 'biz', usable: true, reason: null }, loadIncomingTransactions, unknown = false, contact } = {}) {
  const pay = { calls: [], payInvoice(...args) { this.calls.push(['payInvoice', ...args]); }, payContact(...args) { this.calls.push(['payContact', ...args]); }, payAddress(...args) { this.calls.push(['payAddress', ...args]); } };
  const payers = [];
  const chat = useContactChat({
    partner: ANNA,
    partnerName: 'Anna',
    unknown,
    contact,
    store,
    runtime,
    pay,
    payingWalletFor: (amount, type) => { payers.push([amount, type]); return typeof payer === 'function' ? payer(amount, type) : payer; },
    loadIncomingTransactions,
    t,
    formatFiat: () => '',
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { chat, runtime, pay, payers };
}

const seconds = () => Math.floor(clock.ms / 1000);
const ingest = (message) => assert.equal(store.ingest(message), true);

test('open marks the thread read and open; close and dispose let go', async () => {
  ingest(msg({ createdAt: seconds() - 10 }));
  assert.equal(store.unreadFor(ANNA), 1);
  const { chat } = setup();
  await chat.open();
  assert.equal(store.openThread, ANNA);
  assert.equal(store.unreadFor(ANNA), 0);
  chat.close();
  assert.equal(store.openThread, null);
  chat.resume();
  assert.equal(store.openThread, ANNA);
  chat.dispose();
  assert.equal(store.openThread, null);
  await store.flush();
  assert.equal(clock.timers.size, 0, 'no timer outlives the page');
});

test('close does not clear a different chat that opened meanwhile', async () => {
  const { chat } = setup();
  await chat.open();
  store.setOpenThread(hex('b'));
  chat.close();
  assert.equal(store.openThread, hex('b'));
});

test('a message arriving while open is read at once', async () => {
  const { chat } = setup();
  await chat.open();
  ingest(msg({ createdAt: seconds() }));
  await Promise.resolve();
  assert.equal(store.unreadFor(ANNA), 0);
  assert.equal(chat.items.value.filter((item) => item.type === 'message').length, 1);
});

test('reachability: missing means payments only, unknown and failures stay normal', async () => {
  const missing = setup({ runtime: fakeRuntime({ partnerReachability: async () => 'missing' }) });
  await missing.chat.open();
  assert.equal(missing.chat.reachability.value, 'missing');
  assert.equal(missing.chat.paymentsOnly.value, true);

  const unknown = setup({ runtime: fakeRuntime({ partnerReachability: async () => 'unknown' }) });
  await unknown.chat.open();
  assert.equal(unknown.chat.paymentsOnly.value, false);

  const broken = setup({ runtime: fakeRuntime({ partnerReachability: async () => { throw new DmError(DM_ERROR.NO_IDENTITY, 'x'); } }) });
  await broken.chat.open();
  assert.equal(broken.chat.reachability.value, 'unknown');
  assert.equal(broken.chat.paymentsOnly.value, false);
});

test('the user\'s own request reads its state from the runtime, the partner\'s from the store', async () => {
  const own = request({ outgoing: true, createdAt: seconds() - 100 });
  own.request.expiresAt = seconds() + 3600;
  const theirs = request({ createdAt: seconds() - 90 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(own);
  ingest(theirs);
  const runtime = fakeRuntime({ requestState: (id) => (id === own.id ? 'paid' : null) });
  const { chat } = setup({ runtime });
  const states = () => Object.fromEntries(chat.items.value.filter((i) => i.type === 'request').map((i) => [i.request.id, i.request.state]));
  assert.deepEqual(states(), { [own.id]: 'paid', [theirs.id]: 'pending' });
  // The payer's own status message turns their card to paid, and a decline from them ends the other.
  ingest(status(theirs.id, 'paid', { outgoing: true, createdAt: seconds() }));
  assert.equal(states()[theirs.id], 'paid');
});

test('live expiry: a pending request turns expired by itself when its invoice runs out', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 90;
  ingest(theirs);
  const { chat } = setup();
  await chat.open();
  const state = () => chat.items.value.find((i) => i.type === 'request').request.state;
  assert.equal(state(), 'pending');
  clock.advance(60_000);
  assert.equal(state(), 'pending');
  clock.advance(31_000);
  assert.equal(state(), 'expired');
  chat.dispose();
});

test('live expiry: the clock sleeps at most a minute and wakes for the nearest expiry', async () => {
  const soon = request({ createdAt: seconds() - 10 });
  soon.request.expiresAt = seconds() + 5;
  ingest(soon);
  const { chat } = setup();
  await chat.open();
  await store.flush();
  const waits = [...clock.timers.values()].map((timer) => timer.at - clock.ms);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1000 && waits[0] <= 5600, String(waits[0]));
  chat.dispose();
});

test('disabled reason: the runtime\'s verdict for the paying wallet, balance and rail reasons in words', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  const reason = (chat) => chat.items.value.find((i) => i.type === 'request').request.disabledReason;

  assert.equal(reason(setup().chat), '');
  assert.equal(reason(setup({ payer: null }).chat), DM_ERROR.WALLET_CANNOT_PAY);
  const refused = fakeRuntime({ checkPayable: () => ({ ok: false, reason: DM_ERROR.INVALID_INVOICE }) });
  assert.equal(reason(setup({ runtime: refused }).chat), DM_ERROR.INVALID_INVOICE);
  assert.equal(reason(setup({ payer: { id: 'x', usable: false, reason: 'insufficient-balance' } }).chat), 'Not enough balance');
  assert.equal(reason(setup({ payer: { id: 'x', usable: false, reason: 'unavailable' } }).chat), 'Unavailable');
  assert.equal(reason(setup({ payer: { id: 'x', usable: false, reason: 'unsupported-destination' } }).chat), DM_ERROR.WALLET_CANNOT_PAY);

  const asked = [];
  const runtime = fakeRuntime({ checkPayable: (req, walletId) => { asked.push([req, walletId]); return { ok: true }; } });
  reason(setup({ runtime }).chat);
  assert.equal(asked[0][1], 'biz');
  assert.equal(asked[0][0].bolt11, 'lnbc1');
  assert.equal(asked[0][0].amountSats, 25_000);
});

test('own request: unconfirmed only when the money settles through an LNURL server that cannot verify', () => {
  const own = request({ outgoing: true, createdAt: seconds() - 10 });
  own.request.expiresAt = seconds() + 3600;
  ingest(own);
  const unconfirmed = () => setup().chat.items.value.find((i) => i.type === 'request').request.unconfirmed;
  assert.equal(unconfirmed(), false, 'no source record');
  store.setRequestSource(own.id, { method: 'direct', walletId: 'biz' });
  assert.equal(unconfirmed(), false);
  store.setRequestSource(own.id, { method: 'lnurl', walletId: 'ark' });
  assert.equal(unconfirmed(), true);
  store.setRequestSource(own.id, { method: 'lnurl', walletId: 'ark', verifyUrl: 'https://x/verify' });
  assert.equal(unconfirmed(), false);
  store.setRequestSource(own.id, { method: 'lnurl', walletId: 'ark', settlementWalletId: 'biz' });
  assert.equal(unconfirmed(), false);
});

test('actions: text, reply, request, decline, withdraw and remind go to the runtime with the partner', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  const { chat, runtime } = setup();
  assert.deepEqual(await chat.sendText('hello'), { ok: true, value: {} });
  await chat.sendText('re', { replyTo: theirs.id });
  await chat.requestMoney({ amountSats: 100, note: 'x', walletId: 'biz' });
  await chat.decline(theirs.id);
  await chat.withdraw(theirs.id);
  await chat.remind(theirs.id);
  await chat.retry(theirs.id);
  assert.deepEqual(runtime.calls, [
    ['sendText', ANNA, 'hello', {}],
    ['sendText', ANNA, 're', { replyTo: theirs.id }],
    ['requestMoney', ANNA, { amountSats: 100, note: 'x', walletId: 'biz' }],
    ['declineRequest', ANNA, theirs.id],
    ['cancelRequest', ANNA, theirs.id],
    ['remindRequest', ANNA, theirs.id],
    ['retry', theirs.id],
  ]);
});

test('actions: errors come back as words, never thrown', async () => {
  const runtime = fakeRuntime({
    sendText: async () => { throw new DmError(DM_ERROR.SECRET_KEY_IN_TEXT, 'x'); },
    requestMoney: async () => { throw new DmError(DM_ERROR.NO_INBOX_RELAYS, 'x'); },
    declineRequest: async () => { throw new Error('boom'); },
  });
  const { chat } = setup({ runtime });
  const text = await chat.sendText('nsec1');
  assert.equal(text.ok, false);
  assert.equal(text.error.code, DM_ERROR.SECRET_KEY_IN_TEXT);
  const asked = await chat.requestMoney({ amountSats: 5 });
  assert.equal(asked.error.kind, 'no-inbox');
  assert.equal(asked.error.message, "Anna can't receive requests in the chat yet.");
  assert.equal((await chat.decline(rid(1))).error.code, 'UNKNOWN');
  assert.equal(chat.busyIds.value.size, 0, 'busy is cleared after a failure');
});

test('busy: a card is busy while its action runs and a second tap is ignored', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  let release;
  const runtime = fakeRuntime({ declineRequest: () => new Promise((resolve) => { release = resolve; }) });
  const { chat } = setup({ runtime });
  const first = chat.decline(theirs.id);
  assert.equal(chat.items.value.find((i) => i.type === 'request').request.busy, true);
  assert.equal((await chat.decline(theirs.id)).error.code, 'BUSY');
  release({});
  assert.equal((await first).ok, true);
  assert.equal(chat.items.value.find((i) => i.type === 'request').request.busy, false);
});

test('react: an emoji already chosen changes nothing, a stranger cannot be reacted to', async () => {
  const theirs = msg({ createdAt: seconds() - 10 });
  ingest(theirs);
  const { chat, runtime } = setup();
  await chat.react(theirs.id, '👍');
  store.ingest(msg({ kind: 7, type: 'reaction', sender: ME, recipient: ANNA, outgoing: true, createdAt: seconds(), text: '👍', reaction: { targetId: theirs.id, emoji: '👍' } }));
  await chat.react(theirs.id, '👍');
  await chat.react(theirs.id, '❤️');
  assert.deepEqual(runtime.calls.map((c) => [c[0], c[3]]), [['react', '👍'], ['react', '❤️']]);

  const stranger = setup({ unknown: true });
  assert.equal((await stranger.chat.react(theirs.id, '👍')).ok, false);
  assert.equal(stranger.runtime.calls.length, 0);
});

test('pay a request: the existing pipeline gets the invoice, the paying wallet and a chat context', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  const { chat, pay } = setup({ contact: { id: 'c1', name: 'Anna' } });
  assert.deepEqual(await chat.payRequest(theirs.id), { ok: true });
  assert.equal(pay.calls.length, 1);
  const [name, invoice, options] = pay.calls[0];
  assert.equal(name, 'payInvoice');
  assert.deepEqual(invoice, { bolt11: 'lnbc1', name: 'Anna' });
  assert.equal(options.walletId, 'biz');
  assert.equal(options.contactId, 'c1');
  assert.deepEqual(parseChatPaymentContext(options.context), { partner: ANNA, requestId: theirs.id });
});

test('pay a request: an unusable pick is left to the wallet page, an invalid or expired invoice never leaves the chat', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  const unusable = setup({ payer: { id: 'x', usable: false, reason: 'insufficient-balance' } });
  await unusable.chat.payRequest(theirs.id);
  assert.equal(unusable.pay.calls[0][2].walletId, undefined);

  for (const reason of [DM_ERROR.INVALID_INVOICE, DM_ERROR.INVOICE_EXPIRED]) {
    const refused = setup({ runtime: fakeRuntime({ checkPayable: () => ({ ok: false, reason }) }) });
    const result = await refused.chat.payRequest(theirs.id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, reason);
    assert.equal(refused.pay.calls.length, 0);
  }

  const mine = request({ outgoing: true, createdAt: seconds() - 5 });
  ingest(mine);
  const none = setup();
  assert.equal((await none.chat.payRequest(mine.id)).ok, false, 'a request you sent is not payable by you');
  assert.equal((await none.chat.payRequest(rid(42))).ok, false);
  assert.equal(none.pay.calls.length, 0);
});

test('send money: the contact\'s address goes through payContact with the chat context and no request id', () => {
  const contact = { id: 'c1', name: 'Anna', address: 'anna@x.org', addressType: 'lightning' };
  const { chat, pay, payers } = setup({ contact });
  assert.deepEqual(chat.sendMoney(), { ok: true });
  assert.deepEqual(payers[0], [0, 'lightning']);
  const [name, entry, options] = pay.calls[0];
  assert.equal(name, 'payContact');
  assert.equal(entry, contact);
  assert.equal(options.walletId, 'biz');
  assert.deepEqual(parseChatPaymentContext(options.context), { partner: ANNA, requestId: null });

  const spark = setup({ contact: { ...contact, addressType: 'spark' } });
  spark.chat.sendMoney();
  assert.equal(spark.payers[0][1], 'spark', 'the rail decides which wallets can pay');

  const stranger = setup({ unknown: true });
  assert.equal(stranger.chat.sendMoney().ok, false, 'a stranger has no address to pay');
  assert.equal(stranger.pay.calls.length, 0);
});

test('incoming payment claims are confirmed from the wallets, retried while histories lag, and stop', async () => {
  const claim = payment({ createdAt: seconds() - 30, payment: { amountSats: 777, note: null, preimage: null, requestId: null } });
  ingest(claim);
  let transactions = [];
  let loads = 0;
  const { chat } = setup({ loadIncomingTransactions: async () => { loads += 1; return transactions; } });
  await chat.open();
  const type = () => chat.items.value.find((i) => i.key === claim.id).type;
  assert.equal(loads, 1);
  assert.equal(type(), 'message');

  transactions = [{ amountSats: 777, settledAt: seconds() - 20 }];
  clock.advance(5_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 2);
  assert.equal(type(), 'payment');

  clock.advance(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 2, 'nothing left to confirm: no more lookups');
  chat.dispose();
});

test('incoming payment claims: lookups stop after the retries and a failing wallet history is survivable', async () => {
  ingest(payment({ createdAt: seconds() - 30 }));
  let loads = 0;
  const { chat } = setup({ loadIncomingTransactions: async () => { loads += 1; throw new Error('offline'); } });
  await chat.open();
  for (let i = 0; i < 4; i += 1) {
    clock.advance(30_000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(loads, 3);
  assert.equal(chat.items.value.find((i) => i.type !== 'day').type, 'message');
  chat.dispose();
});

test('pay a request: an expired invoice with an address is replaced by a fresh one, transparently', async () => {
  const theirs = request({ createdAt: seconds() - 100_000 });
  theirs.request.expiresAt = seconds() - 10;
  theirs.request.lud16 = 'anna@x.org';
  ingest(theirs);
  const refreshed = [];
  const runtime = fakeRuntime({
    needsFreshInvoice: () => true,
    refreshInvoice: async (partner, id) => { refreshed.push([partner, id]); return { bolt11: 'lnbc-fresh', expiresAt: seconds() + 3600 }; },
  });
  const { chat, pay } = setup({ runtime, contact: { id: 'c1', name: 'Anna' } });
  assert.equal(chat.items.value.find((i) => i.type === 'request').request.disabledReason, '', 'Pay stays available');
  assert.deepEqual(await chat.payRequest(theirs.id), { ok: true });
  assert.deepEqual(refreshed, [[ANNA, theirs.id]]);
  const [name, invoice, options] = pay.calls[0];
  assert.equal(name, 'payInvoice');
  assert.deepEqual(invoice, { bolt11: 'lnbc-fresh', name: 'Anna' }, 'the fresh invoice, not the old one');
  assert.equal(options.walletId, 'biz');
  assert.equal(options.contactId, 'c1');
  assert.deepEqual(parseChatPaymentContext(options.context), { partner: ANNA, requestId: theirs.id });
});

test('pay a request: a valid invoice is paid as is; a request without an address never pulls', async () => {
  const theirs = request({ createdAt: seconds() - 10 });
  theirs.request.lud16 = 'anna@x.org';
  theirs.request.expiresAt = seconds() + 3600;
  ingest(theirs);
  const runtime = fakeRuntime({ refreshInvoice: async () => { throw new Error('must not pull'); } });
  const valid = setup({ runtime });
  await valid.chat.payRequest(theirs.id);
  assert.equal(valid.pay.calls[0][1].bolt11, 'lnbc1');

  const bare = request({ createdAt: seconds() - 5 });
  bare.request.expiresAt = seconds() + 30;
  ingest(bare);
  const noAddress = setup({ runtime: fakeRuntime({ needsFreshInvoice: () => true, refreshInvoice: async () => { throw new Error('must not pull'); } }) });
  await noAddress.chat.payRequest(bare.id);
  assert.equal(noAddress.pay.calls[0][1].bolt11, 'lnbc1');
});

test('pay a request: a failed pull is an error with the next action and nothing is paid', async () => {
  const theirs = request({ createdAt: seconds() - 100_000 });
  theirs.request.expiresAt = seconds() - 10;
  theirs.request.lud16 = 'anna@x.org';
  ingest(theirs);
  for (const code of [DM_ERROR.INVOICE_REFRESH_FAILED, DM_ERROR.AMOUNT_OUT_OF_RANGE]) {
    const runtime = fakeRuntime({ needsFreshInvoice: () => true, refreshInvoice: async () => { throw new DmError(code, 'no'); } });
    const { chat, pay } = setup({ runtime });
    const result = await chat.payRequest(theirs.id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(result.error.next, 'ask-new');
    assert.equal(pay.calls.length, 0);
    assert.equal(chat.busyIds?.value?.size ?? 0, 0, 'the card is free again');
  }
});

test('send anyway: the ordinary send flow with amount and note prefilled and the request in the context', async () => {
  const theirs = request({ createdAt: seconds() - 100 });
  theirs.request.lud16 = 'anna@x.org';
  theirs.request.validUntil = seconds() - 5;
  ingest(theirs);
  const { chat, pay } = setup({ contact: { id: 'c1', name: 'Anna', address: 'saved@x.org' } });
  assert.equal(chat.items.value.find((i) => i.type === 'request').request.state, 'expired');
  assert.deepEqual(chat.sendAnyway(theirs.id), { ok: true });
  const [name, target, options] = pay.calls[0];
  assert.equal(name, 'payAddress');
  assert.equal(target.address, 'anna@x.org', 'the address Anna signed into the request, not the saved contact');
  assert.equal(options.amountSats, 25_000);
  assert.equal(options.note, 'Pizza');
  assert.equal(options.walletId, 'biz');
  assert.deepEqual(parseChatPaymentContext(options.context), { partner: ANNA, requestId: theirs.id });
});

test('send anyway: without an address in the request the saved contact is used, without any there is no target', () => {
  const noAddress = request({ createdAt: seconds() - 100 });
  noAddress.request.expiresAt = seconds() - 5;
  ingest(noAddress);
  const withContact = setup({ contact: { id: 'c1', name: 'Anna', address: 'saved@x.org', addressType: 'lightning' } });
  assert.equal(withContact.chat.items.value.find((i) => i.type === 'request').request.canSendAnyway, true);
  assert.deepEqual(withContact.chat.sendAnyway(noAddress.id), { ok: true });
  assert.equal(withContact.pay.calls[0][0], 'payContact');
  assert.equal(withContact.pay.calls[0][2].amountSats, 25_000);

  const nothing = setup();
  assert.equal(nothing.chat.items.value.find((i) => i.type === 'request').request.canSendAnyway, false);
  assert.equal(nothing.chat.sendAnyway(noAddress.id).ok, false);
  assert.equal(nothing.pay.calls.length, 0);

  const mine = request({ outgoing: true });
  ingest(mine);
  assert.equal(withContact.chat.sendAnyway(mine.id).ok, false, 'only the payer sends');
});

test('request again: one call with the same amount and note, only for the own request', async () => {
  const mine = request({ outgoing: true, createdAt: seconds() - 100 });
  mine.request.expiresAt = seconds() - 5;
  const theirs = request({ createdAt: seconds() - 100 });
  ingest(mine);
  ingest(theirs);
  const { chat, runtime } = setup();
  assert.equal((await chat.requestAgain(mine.id)).ok, true);
  assert.deepEqual(runtime.calls.at(-1), ['requestMoney', ANNA, { amountSats: 25_000, note: 'Pizza' }]);
  assert.equal((await chat.requestAgain(theirs.id)).ok, false);
  assert.equal((await chat.requestAgain(rid(3))).ok, false);
  assert.equal(runtime.calls.filter((c) => c[0] === 'requestMoney').length, 1);
});

test('ask for a new request: the amount and note go back for the composer, never sent by itself', () => {
  const theirs = request({ createdAt: seconds() - 10 });
  const mine = request({ outgoing: true });
  ingest(theirs);
  ingest(mine);
  const { chat, runtime } = setup();
  assert.deepEqual(chat.askNewRequest(theirs.id), { ok: true, value: { amountSats: 25_000, note: 'Pizza' } });
  assert.equal(chat.askNewRequest(mine.id).ok, false);
  assert.equal(runtime.calls.length, 0);
});

test('a paid own request names the wallet it arrived in only when the runtime verified it', () => {
  const mine = request({ outgoing: true, createdAt: seconds() - 10 });
  mine.request.expiresAt = seconds() + 3600;
  ingest(mine);
  const card = (settlement) => {
    const { chat } = setup({ runtime: fakeRuntime({ requestState: () => 'paid', requestSettlement: () => settlement }) });
    return chat.items.value.find((i) => i.type === 'request').request;
  };
  assert.deepEqual(card({ verified: false, walletId: null }).settlement, { verified: false, walletName: '' });
  assert.equal(card({ verified: true, walletId: 'biz' }).settlement.verified, true);
});

test('opening the chat and every resume ask the runtime to check payment claims', async () => {
  let checks = 0;
  const { chat } = setup({ runtime: fakeRuntime({ settleClaims: async () => { checks += 1; return { settled: 0, pending: 0 }; } }) });
  await chat.open();
  chat.resume();
  assert.ok(checks >= 2, String(checks));
  chat.dispose();
  const broken = setup({ runtime: fakeRuntime({ settleClaims: async () => { throw new Error('boom'); } }) });
  await broken.chat.open();
  broken.chat.dispose();
});

test('describeDmError: a dead end always names the way forward', () => {
  for (const code of [DM_ERROR.INVOICE_EXPIRED, DM_ERROR.INVOICE_REFRESH_FAILED, DM_ERROR.AMOUNT_OUT_OF_RANGE]) {
    const described = describeDmError(new DmError(code, 'x'), { t });
    assert.equal(described.next, 'ask-new', code);
    assert.match(described.message, /new request/i, code);
  }
  assert.equal(describeDmError(new DmError(DM_ERROR.WALLET_CANNOT_PAY, 'x'), { t }).next, undefined);
});

test('the same view-model reused for another chat lets go of the first one', async () => {
  const BEA = hex('b');
  const { ref } = await import('vue');
  const current = ref(ANNA);
  const runtime = fakeRuntime();
  const chat = useContactChat({
    partner: current, partnerName: 'x', store, runtime, pay: {}, payingWalletFor: () => null, t,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await chat.open();
  assert.equal(store.openThread, ANNA);
  current.value = BEA;
  await chat.open();
  assert.equal(store.openThread, BEA);
  chat.close();
  assert.equal(store.openThread, null);
  chat.dispose();
});
