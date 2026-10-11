/**
 * Payment request service tests (docs/CONTACT_CHAT.md section 8).
 *
 * Every wallet type gets its own fake provider with the exact method shapes of
 * the real one (Breez, LNbits, NWC as the raw WebLN provider the store keeps
 * and as `NWCWalletProvider`, Arkade whose Lightning throws). LNURL servers are
 * fakes, time is a manual clock and timers are a manual scheduler, so nothing
 * here sleeps or touches the network.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/requests.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DM_ERROR, DmError } from '../errors.js';
import {
  REQUEST_METHOD,
  WATCH_TIMING,
  INVOICE_REFRESH_MARGIN_SECONDS,
  checkPayable,
  createRequestService,
  invoiceNeedsRefresh,
  pickReceivingWallet,
} from '../requests.js';

// ---------------------------------------------------------------------------
// Invoice generator (same bech32 encoder as protocol.spec.js, hash selectable)
// ---------------------------------------------------------------------------

const NOW = 1_760_000_000;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= GENERATORS[i];
  }
  return chk;
}

function bech32Encode(hrp, words) {
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...words, ...checksum].map((w) => CHARSET[w]).join('');
}

const numberToWords = (value, count) => Array.from({ length: count }, (_, i) => Math.floor(value / 32 ** (count - 1 - i)) % 32);

function bytesToWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));

/** A structurally valid BOLT-11 invoice (unsigned; the decoder tolerates that). */
function makeInvoice({ sats, network = 'bc', timestamp = NOW, expiry = 3_600, hash = 1 } = {}) {
  const amount = sats === undefined ? '' : `${sats * 10}n`;
  const paymentHash = typeof hash === 'string'
    ? hexToBytes(hash)
    : Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + hash) % 256);
  const tag = (type, words) => [type, ...numberToWords(words.length, 2), ...words];
  const words = [
    ...numberToWords(timestamp, 7),
    ...tag(1, bytesToWords(paymentHash)),
    ...tag(6, numberToWords(expiry, 3)),
    ...bytesToWords(Uint8Array.from({ length: 65 }, (_, i) => (i + 1) % 251)),
  ];
  return { bolt11: bech32Encode(`ln${network}${amount}`, words), paymentHash: bytesToHex(paymentHash) };
}

const PREIMAGE = 'ab'.repeat(32);
const PREIMAGE_HASH = bytesToHex(sha256(hexToBytes(PREIMAGE)));

// ---------------------------------------------------------------------------
// Clock and timers
// ---------------------------------------------------------------------------

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function createClock() {
  let nowMs = NOW * 1_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => nowMs,
    setTimer(fn, ms) {
      seq += 1;
      timers.set(seq, { fn, due: nowMs + ms, ms });
      return seq;
    },
    clearTimer(handle) {
      timers.delete(handle);
    },
    get pending() {
      return timers.size;
    },
    /** Delays (ms) of the timers currently scheduled. */
    get delays() {
      return [...timers.values()].map((t) => t.ms);
    },
    /** Move time forward, running every timer that falls due on the way. */
    async advance(ms) {
      const target = nowMs + ms;
      await flush();
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        nowMs = Math.max(nowMs, due[1].due);
        due[1].fn();
        await flush();
      }
      nowMs = target;
      await flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Fake wallets, one per type and per provider shape
// ---------------------------------------------------------------------------

/** Breez Spark: `createInvoice`, push `onPaymentReceived`, `lookupInvoice(hash)`. */
function fakeSpark({ sats = null, invoice = null, ledger = new Map() } = {}) {
  const provider = {
    isConnected: true,
    created: [],
    listeners: new Set(),
    unsubscribed: 0,
    lookups: 0,
    ledger,
    async createInvoice(params) {
      provider.created.push(params);
      return { paymentRequest: invoice.bolt11, paymentHash: invoice.paymentHash, expiresAt: NOW + 3_600 };
    },
    async lookupInvoice(hash) {
      provider.lookups += 1;
      const hit = ledger.get(hash);
      return hit ? { paid: true, preimage: hit, amount: sats } : { paid: false, preimage: null, amount: 0 };
    },
    onPaymentReceived(callback) {
      provider.listeners.add(callback);
      return () => {
        provider.listeners.delete(callback);
        provider.unsubscribed += 1;
      };
    },
    /** What the SDK event carries: a `receive` payment with HTLC details. */
    receive(paymentHash, { preimage = PREIMAGE, timestamp = NOW + 10 } = {}) {
      const payment = { id: 'p1', timestamp, details: { type: 'lightning', htlcDetails: { paymentHash, preimage } } };
      for (const listener of [...provider.listeners]) listener('p1', 0, payment);
    },
  };
  return provider;
}

/** LNbits: `createInvoice`, `lookupInvoice(hash)` (errors become `paid: false`). */
function fakeLnbits({ invoice = null, ledger = new Map() } = {}) {
  const provider = {
    isConnected: true,
    created: [],
    lookups: 0,
    ledger,
    failLookups: false,
    async createInvoice(params) {
      provider.created.push(params);
      return { paymentRequest: invoice.bolt11, paymentHash: invoice.paymentHash, expiresAt: null };
    },
    async lookupInvoice(hash) {
      provider.lookups += 1;
      if (provider.failLookups) throw new Error('lnbits unreachable');
      const hit = ledger.get(hash);
      return hit ? { paid: true, preimage: hit } : { paid: false };
    },
  };
  return provider;
}

/** NWC as the wallet store keeps it: the raw @getalby/sdk WebLN provider. */
function fakeWebln({ invoice = null, methods = ['makeInvoice', 'lookupInvoice'], notifications = [], ledger = new Map() } = {}) {
  const provider = {
    made: [],
    listeners: new Set(),
    unsubscribed: 0,
    lookups: [],
    ledger,
    async makeInvoice(args) {
      provider.made.push(args);
      return { paymentRequest: invoice.bolt11 };
    },
    async getInfo() {
      return { methods };
    },
    async lookupInvoice(args) {
      provider.lookups.push(args);
      const hit = ledger.get(args.paymentHash);
      return hit ? { paid: true, preimage: hit } : { paid: false };
    },
    client: {
      async getInfo() {
        return { notifications };
      },
      async subscribeNotifications(callback, types) {
        assert.deepEqual(types, ['payment_received']);
        provider.listeners.add(callback);
        return () => {
          provider.listeners.delete(callback);
          provider.unsubscribed += 1;
        };
      },
    },
    notify(paymentHash, { preimage = PREIMAGE, settledAt = NOW + 20 } = {}) {
      const notification = { notification_type: 'payment_received', notification: { payment_hash: paymentHash, preimage, settled_at: settledAt } };
      for (const listener of [...provider.listeners]) listener(notification);
    },
  };
  return provider;
}

/** NWC as `NWCWalletProvider` (WalletFactory) speaks: `createInvoice`, `supportsMethod`, notifications. */
function fakeNwcClass({ invoice = null, methods = ['make_invoice'], notifications = true, ledger = new Map() } = {}) {
  const provider = {
    isConnected: true,
    created: [],
    listeners: new Set(),
    unsubscribed: 0,
    lookups: [],
    ledger,
    async createInvoice(params) {
      provider.created.push(params);
      return { paymentRequest: invoice.bolt11, paymentHash: invoice.paymentHash, expiresAt: undefined };
    },
    async supportsMethod(method) {
      return methods.includes(method);
    },
    async supportsNotifications() {
      return notifications;
    },
    async subscribeToPaymentNotifications(callback) {
      provider.listeners.add(callback);
      return () => {
        provider.listeners.delete(callback);
        provider.unsubscribed += 1;
      };
    },
    async lookupInvoice(hash) {
      provider.lookups.push(hash);
      const hit = ledger.get(hash);
      return hit ? { paid: true, preimage: hit } : { paid: false };
    },
    notify(paymentHash, { preimage = PREIMAGE, settledAt = NOW + 20 } = {}) {
      for (const listener of [...provider.listeners]) listener({ paymentHash, preimage, settledAt, state: 'settled' });
    },
  };
  return provider;
}

/** Arkade: Lightning is retired, every Lightning call throws. */
function fakeArkade() {
  const unavailable = async () => {
    throw new Error('Lightning is unavailable on Arkade');
  };
  return { isConnected: true, createInvoice: unavailable, lookupInvoice: unavailable, payInvoice: unavailable };
}

/** LNURL server behind a Lightning address (Breez at btc.mybuho.de). */
function fakeLnurl({ invoice = null, commentAllowed = 255, verify = 'https://btc.mybuho.de/verify/abc', min = 1_000, max = 1_000_000_000 } = {}) {
  const server = {
    fetched: [],
    requested: [],
    verifyCalls: [],
    verifyAnswer: { settled: false, preimage: null },
    failVerify: false,
    failFetch: false,
    payRequest: {
      tag: 'payRequest',
      callback: 'https://btc.mybuho.de/lnurlp/callback',
      minSendable: min,
      maxSendable: max,
      metadata: '[]',
      commentAllowed,
    },
    async fetchPayRequest(url) {
      server.fetched.push(url);
      if (server.failFetch) throw new Error('lnurl down');
      return server.payRequest;
    },
    async requestInvoice(payRequest, msats, options) {
      server.requested.push({ payRequest, msats, options });
      if (msats < payRequest.minSendable || msats > payRequest.maxSendable) throw new Error('amount out of range');
      return { pr: invoice.bolt11, routes: [], verify };
    },
    async verifyPayment(url, callback) {
      server.verifyCalls.push({ url, callback });
      if (server.failVerify) throw new Error('verify down');
      return server.verifyAnswer;
    },
  };
  return server;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BUSINESS = { id: 'spark-biz', type: 'spark', accountNumber: 1, lightningAddress: 'anna@btc.mybuho.de' };
const PERSONAL = { id: 'spark-pers', type: 'spark', accountNumber: 2, lightningAddress: 'anna-p@btc.mybuho.de' };
const LNBITS = { id: 'lnbits', type: 'lnbits' };
const NWC = { id: 'nwc', type: 'nwc', methods: ['pay_invoice', 'make_invoice', 'lookup_invoice'] };
const NWC_NO_INVOICE = { id: 'nwc-ro', type: 'nwc', methods: ['pay_invoice', 'get_balance'] };
const ARKADE = { id: 'arkade', type: 'arkade' };
const ADDRESS = 'anna@btc.mybuho.de';

function setup({ wallets, providers = {}, profileAddress = ADDRESS, lnurl = fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }) }) } = {}) {
  const clock = createClock();
  const connectCalls = [];
  const service = createRequestService({
    getWallets: () => wallets,
    getProvider: (id) => providers[id] ?? null,
    ensureConnected: async (id) => {
      connectCalls.push(id);
      if (!providers[id]) throw new Error('cannot connect');
      return providers[id];
    },
    getProfileAddress: () => profileAddress,
    lnurl,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    randomReference: () => 'c0ffee123456',
  });
  return { service, clock, lnurl, connectCalls };
}

function rejectsWith(code) {
  return (error) => {
    assert.ok(DmError.is(error, code), `expected ${code}, got ${error?.code ?? error}`);
    return true;
  };
}

// ---------------------------------------------------------------------------
// pickReceivingWallet
// ---------------------------------------------------------------------------

test('pickReceivingWallet: default choice per wallet mix (all four wallet types)', () => {
  const table = [
    ['Spark Business wins over Personal', [PERSONAL, BUSINESS], {}, 'spark-biz', 'direct'],
    ['the wallet behind the profile address wins', [BUSINESS, PERSONAL], { profileAddress: 'Anna-P@btc.mybuho.de' }, 'spark-pers', 'direct'],
    ['Spark Personal when there is no Business', [LNBITS, PERSONAL], {}, 'spark-pers', 'direct'],
    ['LNbits issues directly', [LNBITS], {}, 'lnbits', 'direct'],
    ['NWC with make_invoice issues directly', [NWC], {}, 'nwc', 'direct'],
    ['NWC with unknown methods is tried directly', [{ id: 'n', type: 'nwc' }], {}, 'n', 'direct'],
    ['NWC with WebLN-style method names', [{ id: 'n', type: 'nwc', methods: ['makeInvoice'] }], {}, 'n', 'direct'],
    ['NWC read-only falls to LNbits before LNURL', [NWC_NO_INVOICE, LNBITS], { profileAddress: null }, 'lnbits', 'direct'],
    ['NWC read-only alone uses the profile address', [NWC_NO_INVOICE], {}, 'nwc-ro', 'lnurl'],
    ['Arkade alone uses the profile address', [ARKADE], {}, 'arkade', 'lnurl'],
    ['Arkade is skipped when another wallet can invoice', [ARKADE, LNBITS], {}, 'lnbits', 'direct'],
    ['raw store entries (connectionData / metadata) work', [{ id: 'raw', type: 'spark', connectionData: { accountNumber: 1 }, metadata: { lud16: ADDRESS } }], {}, 'raw', 'direct'],
  ];
  for (const [name, wallets, options, id, method] of table) {
    const picked = pickReceivingWallet(wallets, { profileAddress: ADDRESS, ...options });
    assert.equal(picked?.wallet.id, id, name);
    assert.equal(picked?.method, method, name);
  }
});

test('pickReceivingWallet: an explicit choice is honoured and never silently replaced', () => {
  const wallets = [BUSINESS, LNBITS, NWC_NO_INVOICE, ARKADE];
  const table = [
    ['LNbits', 'lnbits', ADDRESS, 'lnbits', 'direct'],
    ['Arkade with an address', 'arkade', ADDRESS, 'arkade', 'lnurl'],
    ['NWC without make_invoice with an address', 'nwc-ro', ADDRESS, 'nwc-ro', 'lnurl'],
  ];
  for (const [name, preferredWalletId, profileAddress, id, method] of table) {
    const picked = pickReceivingWallet(wallets, { preferredWalletId, profileAddress });
    assert.deepEqual([picked?.wallet.id, picked?.method], [id, method], name);
  }
  assert.equal(pickReceivingWallet(wallets, { preferredWalletId: 'arkade', profileAddress: null }), null);
  assert.equal(pickReceivingWallet(wallets, { preferredWalletId: 'nwc-ro', profileAddress: '' }), null);
  // A wallet that no longer exists falls back to the default pick.
  assert.equal(pickReceivingWallet(wallets, { preferredWalletId: 'gone', profileAddress: ADDRESS }).wallet.id, 'spark-biz');
});

test('pickReceivingWallet: nothing usable gives null and never throws', () => {
  assert.equal(pickReceivingWallet([], { profileAddress: ADDRESS }), null);
  assert.equal(pickReceivingWallet([ARKADE], { profileAddress: null }), null);
  assert.equal(pickReceivingWallet([ARKADE], { profileAddress: 'not-an-address' }), null);
  assert.equal(pickReceivingWallet(null), null);
  assert.equal(pickReceivingWallet([null, 5, {}, { type: 'spark' }]), null);
});

// ---------------------------------------------------------------------------
// createRequestInvoice
// ---------------------------------------------------------------------------

test('createRequestInvoice: Spark mints directly, with an expiry, and reports the invoice facts', async () => {
  const invoice = makeInvoice({ sats: 12_000 });
  const spark = fakeSpark({ invoice });
  const { service } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });

  const result = await service.createRequestInvoice({ amountSats: 12_000, note: ' Pizza ' });

  assert.deepEqual(spark.created, [{ amount: 12_000, description: 'Pizza', expiry: 86_400 }]);
  assert.deepEqual(result, {
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    expiresAt: NOW + 3_600,
    walletId: 'spark-biz',
    method: 'direct',
    reference: 'c0ffee123456',
  });
});

test('createRequestInvoice: LNbits mints directly', async () => {
  const invoice = makeInvoice({ sats: 500 });
  const lnbits = fakeLnbits({ invoice });
  const { service } = setup({ wallets: [LNBITS], providers: { lnbits } });

  const result = await service.createRequestInvoice({ walletId: 'lnbits', amountSats: 500, note: 'Coffee' });

  assert.deepEqual(lnbits.created, [{ amount: 500, description: 'Coffee', expiry: 86_400 }]);
  assert.equal(result.method, 'direct');
  assert.equal(result.walletId, 'lnbits');
  assert.equal(result.expiresAt, NOW + 3_600, 'the invoice is the source of the expiry (LNbits reports none)');
});

test('createRequestInvoice: NWC through the WebLN provider the store keeps', async () => {
  const invoice = makeInvoice({ sats: 800 });
  const webln = fakeWebln({ invoice });
  const { service } = setup({ wallets: [NWC], providers: { nwc: webln } });

  const result = await service.createRequestInvoice({ amountSats: 800, note: 'Lunch' });

  assert.deepEqual(webln.made, [{ amount: 800, defaultMemo: 'Lunch' }], 'WebLN reads only defaultMemo');
  assert.equal(result.method, 'direct');
  assert.equal(result.paymentHash, invoice.paymentHash, 'the hash comes from the invoice: WebLN returns none');
});

test('createRequestInvoice: NWC through NWCWalletProvider', async () => {
  const invoice = makeInvoice({ sats: 800 });
  const nwc = fakeNwcClass({ invoice });
  const { service } = setup({ wallets: [NWC], providers: { nwc } });

  const result = await service.createRequestInvoice({ amountSats: 800, note: 'Lunch' });

  assert.deepEqual(nwc.created, [{ amount: 800, description: 'Lunch', expiry: 86_400 }]);
  assert.equal(result.method, 'direct');
});

test('createRequestInvoice: an NWC wallet that refuses make_invoice falls back to the profile address', async () => {
  const invoice = makeInvoice({ sats: 800 });
  // The wallet list did not know the methods; the wallet itself says no.
  const unknown = { id: 'nwc', type: 'nwc' };
  const nwc = fakeNwcClass({ invoice, methods: ['pay_invoice'] });
  const lnurl = fakeLnurl({ invoice });
  const { service } = setup({ wallets: [unknown, BUSINESS], providers: { nwc }, lnurl });

  const result = await service.createRequestInvoice({ walletId: 'nwc', amountSats: 800 });

  assert.equal(nwc.created.length, 0);
  assert.equal(result.method, 'lnurl');
  assert.equal(result.walletId, 'nwc');
  assert.equal(result.settlementWalletId, 'spark-biz');
});

test('createRequestInvoice: NWC without make_invoice and without a profile address cannot invoice', async () => {
  const nwc = fakeNwcClass({ invoice: makeInvoice({ sats: 5 }), methods: [] });
  const { service } = setup({ wallets: [{ id: 'nwc', type: 'nwc' }], providers: { nwc }, profileAddress: null });
  await assert.rejects(service.createRequestInvoice({ amountSats: 5 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));
});

test('createRequestInvoice: Arkade requests go through the profile address with a LUD-12 comment and LUD-21 verify', async () => {
  const invoice = makeInvoice({ sats: 5_000 });
  const lnurl = fakeLnurl({ invoice });
  const { service } = setup({ wallets: [ARKADE, BUSINESS], providers: { arkade: fakeArkade() }, lnurl });

  const result = await service.createRequestInvoice({ walletId: 'arkade', amountSats: 5_000, note: 'Rent' });

  assert.deepEqual(lnurl.fetched, ['https://btc.mybuho.de/.well-known/lnurlp/anna']);
  assert.equal(lnurl.requested[0].msats, 5_000_000);
  assert.deepEqual(lnurl.requested[0].options, { comment: 'buho:req:c0ffee123456' });
  assert.deepEqual(result, {
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    expiresAt: NOW + 3_600,
    walletId: 'arkade',
    method: 'lnurl',
    reference: 'c0ffee123456',
    verifyUrl: 'https://btc.mybuho.de/verify/abc',
    settlementWalletId: 'spark-biz',
  });
});

test('createRequestInvoice: no comment when the server allows none, no settlement wallet when the address is foreign', async () => {
  const invoice = makeInvoice({ sats: 70 });
  const lnurl = fakeLnurl({ invoice, commentAllowed: 0 });
  const { service } = setup({ wallets: [ARKADE], providers: {}, profileAddress: 'me@npub.cash', lnurl });

  const result = await service.createRequestInvoice({ amountSats: 70 });

  assert.equal(lnurl.requested[0].options, undefined);
  assert.equal('settlementWalletId' in result, false);
});

test('createRequestInvoice: a verify URL on a foreign host or over http is dropped', async () => {
  for (const verify of ['https://evil.example/verify/abc', 'http://btc.mybuho.de/verify/abc', 'not a url', null]) {
    const invoice = makeInvoice({ sats: 70 });
    const lnurl = fakeLnurl({ invoice, verify });
    const { service } = setup({ wallets: [ARKADE], lnurl });
    const result = await service.createRequestInvoice({ amountSats: 70 });
    assert.equal('verifyUrl' in result, false, String(verify));
  }
});

test('createRequestInvoice: a returned invoice is validated (INVALID_INVOICE)', async () => {
  const cases = [
    ['wrong amount', makeInvoice({ sats: 11 })],
    ['testnet', makeInvoice({ sats: 100, network: 'tb' })],
    ['zero amount', makeInvoice()],
    ['already expired', makeInvoice({ sats: 100, timestamp: NOW - 7_200, expiry: 3_600 })],
    ['not an invoice', { bolt11: 'lnbc1garbage', paymentHash: 'x' }],
    ['empty', { bolt11: '', paymentHash: 'x' }],
  ];
  for (const [name, bad] of cases) {
    const spark = fakeSpark({ invoice: bad });
    const direct = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
    await assert.rejects(direct.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.INVALID_INVOICE), `direct: ${name}`);

    const viaAddress = setup({ wallets: [ARKADE], lnurl: fakeLnurl({ invoice: bad }) });
    await assert.rejects(viaAddress.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.INVALID_INVOICE), `lnurl: ${name}`);
  }
});

test('createRequestInvoice: a payment hash that contradicts the invoice is refused', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice });
  spark.createInvoice = async () => ({ paymentRequest: invoice.bolt11, paymentHash: 'f'.repeat(64) });
  const { service } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  await assert.rejects(service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.INVALID_INVOICE));
});

test('createRequestInvoice: wallets and servers that fail become WALLET_CANNOT_INVOICE', async () => {
  const invoice = makeInvoice({ sats: 100 });

  const broken = fakeSpark({ invoice });
  broken.createInvoice = async () => { throw new Error('sdk exploded'); };
  const a = setup({ wallets: [BUSINESS], providers: { 'spark-biz': broken } });
  await assert.rejects(a.service.createRequestInvoice({ amountSats: 100 }), (e) => DmError.is(e, DM_ERROR.WALLET_CANNOT_INVOICE) && e.cause?.message === 'sdk exploded');

  const unreachable = setup({ wallets: [BUSINESS], providers: {} });
  await assert.rejects(unreachable.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));

  const down = fakeLnurl({ invoice });
  down.failFetch = true;
  const b = setup({ wallets: [ARKADE], lnurl: down });
  await assert.rejects(b.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));

  const outOfRange = setup({ wallets: [ARKADE], lnurl: fakeLnurl({ invoice, min: 5_000_000 }) });
  await assert.rejects(outOfRange.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));

  const arkade = setup({ wallets: [ARKADE], providers: { arkade: fakeArkade() }, profileAddress: null });
  await assert.rejects(arkade.service.createRequestInvoice({ walletId: 'arkade', amountSats: 100 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));

  const none = setup({ wallets: [] });
  await assert.rejects(none.service.createRequestInvoice({ amountSats: 100 }), rejectsWith(DM_ERROR.WALLET_CANNOT_INVOICE));
});

test('createRequestInvoice: connects a wallet that is not connected yet, and validates its arguments', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice });
  spark.isConnected = false;
  const { service, connectCalls } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  await service.createRequestInvoice({ amountSats: 100 });
  assert.deepEqual(connectCalls, ['spark-biz']);

  for (const amountSats of [0, -5, 1.5, '100', NaN, undefined]) {
    await assert.rejects(service.createRequestInvoice({ amountSats }), rejectsWith(DM_ERROR.INVALID_ARGUMENT), String(amountSats));
  }
  await assert.rejects(service.createRequestInvoice({ amountSats: 100, note: 7 }), rejectsWith(DM_ERROR.INVALID_ARGUMENT));
  await assert.rejects(service.createRequestInvoice({ amountSats: 100, note: 'x'.repeat(201) }), rejectsWith(DM_ERROR.MESSAGE_TOO_LARGE));
});

test('createRequestService refuses missing collaborators', () => {
  assert.throws(() => createRequestService({}), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  assert.throws(
    () => createRequestService({ getWallets() {}, getProvider() {}, ensureConnected() {}, getProfileAddress() {}, lnurl: {} }),
    (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT),
  );
});

// ---------------------------------------------------------------------------
// watchRequest
// ---------------------------------------------------------------------------

function direct(walletId, invoice, extra = {}) {
  return { walletId, method: 'direct', paymentHash: invoice.paymentHash, expiresAt: NOW + 3_600, ...extra };
}

function collect() {
  const paid = [];
  const errors = [];
  return { paid, errors, handlers: { onPaid: (r) => paid.push(r), onError: (e) => errors.push(e) } };
}

test('watch Spark: the SDK event settles it once, with preimage, then nothing is left running', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice });
  const { service, clock } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  const { paid, handlers } = collect();

  const stop = service.watchRequest(direct('spark-biz', invoice), handlers);
  await flush();
  assert.equal(spark.listeners.size, 1);
  assert.equal(clock.pending, 1, 'the safety-net poll is scheduled');
  assert.deepEqual(clock.delays, [WATCH_TIMING.PUSH_POLL_INITIAL_MS], 'a push source slows the poll down');

  spark.receive('f'.repeat(64)); // someone else's payment
  assert.equal(paid.length, 0);

  spark.receive(invoice.paymentHash.toUpperCase(), { timestamp: NOW + 42 });
  spark.receive(invoice.paymentHash); // a duplicate event
  await flush();

  assert.deepEqual(paid, [{ paymentHash: invoice.paymentHash, preimage: PREIMAGE, settledAt: NOW + 42 }]);
  assert.equal(spark.unsubscribed, 1);
  assert.equal(clock.pending, 0);
  stop(); // idempotent
  assert.equal(spark.unsubscribed, 1);
});

test('watch Spark: a payment made while the app was closed is found by the first look', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice, ledger: new Map([[invoice.paymentHash, PREIMAGE]]) });
  const { service, clock } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  const { paid, handlers } = collect();

  service.watchRequest(direct('spark-biz', invoice), handlers);
  await flush();

  assert.equal(paid.length, 1);
  assert.equal(paid[0].preimage, PREIMAGE);
  assert.equal(paid[0].settledAt, NOW);
  assert.equal(spark.listeners.size, 0);
  assert.equal(clock.pending, 0);
});

test('watch LNbits: polls with backoff until paid, then stops', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnbits = fakeLnbits({ invoice });
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const { paid, handlers } = collect();

  service.watchRequest(direct('lnbits', invoice), handlers);
  await flush();
  assert.equal(lnbits.lookups, 1, 'first look is immediate');
  assert.deepEqual(clock.delays, [3_000]);

  await clock.advance(3_000);
  assert.equal(lnbits.lookups, 2);
  assert.deepEqual(clock.delays, [4_500], 'backoff x1.5');

  await clock.advance(4_500);
  assert.deepEqual(clock.delays, [6_750]);

  lnbits.ledger.set(invoice.paymentHash, PREIMAGE);
  await clock.advance(6_750);

  assert.equal(paid.length, 1);
  assert.equal(paid[0].preimage, PREIMAGE);
  assert.equal(clock.pending, 0);
});

test('watch: the poll interval is capped', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnbits = fakeLnbits({ invoice });
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  service.watchRequest(direct('lnbits', invoice, { expiresAt: NOW + 86_400 }), collect().handlers);
  await flush();
  for (let i = 0; i < 12; i += 1) await clock.advance(clock.delays[0]);
  assert.deepEqual(clock.delays, [WATCH_TIMING.POLL_MAX_MS]);
});

test('watch: stops at expiry with one final look just after it, and leaves nothing running', async () => {
  const invoice = makeInvoice({ sats: 100, expiry: 10 });
  const lnbits = fakeLnbits({ invoice });
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const { paid, handlers } = collect();

  service.watchRequest({ ...direct('lnbits', invoice), expiresAt: NOW + 10 }, handlers);
  await flush();
  await clock.advance(3_000);
  await clock.advance(4_500);
  // 7.5 s in: the next sleep is cut short so the last look lands after expiry.
  assert.deepEqual(clock.delays, [2_500 + WATCH_TIMING.EXPIRY_GRACE_MS]);
  const looksBefore = lnbits.lookups;
  await clock.advance(10_000);

  assert.equal(lnbits.lookups, looksBefore + 1);
  assert.equal(paid.length, 0);
  assert.equal(clock.pending, 0);
});

test('watch: an already expired request gets exactly one look', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnbits = fakeLnbits({ invoice, ledger: new Map([[invoice.paymentHash, PREIMAGE]]) });
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const { paid, handlers } = collect();
  service.watchRequest({ ...direct('lnbits', invoice), expiresAt: NOW - 100 }, handlers);
  await flush();
  assert.equal(lnbits.lookups, 1);
  assert.equal(paid.length, 1, 'paid before it expired');

  const other = fakeLnbits({ invoice });
  const second = setup({ wallets: [LNBITS], providers: { lnbits: other } });
  second.service.watchRequest({ ...direct('lnbits', invoice), expiresAt: NOW - 100 }, collect().handlers);
  await flush();
  assert.equal(other.lookups, 1);
  assert.equal(second.clock.pending, 0);
  assert.equal(clock.pending, 0);
});

test('watch: stop() clears the timer and the subscription, even before the subscription is ready', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice });
  const { service, clock } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  const { paid, handlers } = collect();

  const stop = service.watchRequest(direct('spark-biz', invoice), handlers);
  await flush();
  stop();
  assert.equal(clock.pending, 0);
  assert.equal(spark.unsubscribed, 1);
  spark.receive(invoice.paymentHash);
  await flush();
  assert.equal(paid.length, 0);

  // Stopped synchronously, before the async setup ran at all.
  const early = service.watchRequest(direct('spark-biz', invoice), handlers);
  early();
  await flush();
  assert.equal(spark.listeners.size, 0, 'a late subscription is torn down at once');
  assert.equal(clock.pending, 0);
});

test('watch: a stop in the middle of a look prevents any further timer', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnbits = fakeLnbits({ invoice });
  let release;
  lnbits.lookupInvoice = () => new Promise((resolve) => { release = () => resolve({ paid: false }); });
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const stop = service.watchRequest(direct('lnbits', invoice), collect().handlers);
  await flush();
  stop();
  release();
  await flush();
  assert.equal(clock.pending, 0);
});

test('watch: polling failures are reported and polling carries on', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnbits = fakeLnbits({ invoice });
  lnbits.failLookups = true;
  const { service, clock } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const { paid, errors, handlers } = collect();

  service.watchRequest(direct('lnbits', invoice), handlers);
  await flush();
  assert.equal(errors.length, 1);
  assert.equal(clock.pending, 1);

  lnbits.failLookups = false;
  lnbits.ledger.set(invoice.paymentHash, PREIMAGE);
  await clock.advance(3_000);
  assert.equal(paid.length, 1);
});

test('watch: a throwing onPaid is contained and still tears everything down', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const spark = fakeSpark({ invoice });
  const { service, clock } = setup({ wallets: [BUSINESS], providers: { 'spark-biz': spark } });
  const errors = [];
  service.watchRequest(direct('spark-biz', invoice), { onPaid: () => { throw new Error('ui bug'); }, onError: (e) => errors.push(e) });
  await flush();
  spark.receive(invoice.paymentHash);
  await flush();
  assert.equal(errors.length, 1);
  assert.equal(spark.unsubscribed, 1);
  assert.equal(clock.pending, 0);
});

test('watch: a missing wallet is retried by the poll instead of crashing', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const providers = {};
  const { service, clock } = setup({ wallets: [LNBITS], providers });
  const { paid, errors, handlers } = collect();
  service.watchRequest(direct('lnbits', invoice), handlers);
  await flush();
  assert.equal(errors.length, 1);
  providers.lnbits = fakeLnbits({ invoice, ledger: new Map([[invoice.paymentHash, PREIMAGE]]) });
  await clock.advance(3_000);
  assert.equal(paid.length, 1);
});

test('watch NWC (WebLN provider): a payment_received notification settles it; the poll is only a safety net', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const webln = fakeWebln({ invoice, notifications: ['payment_received'] });
  const { service, clock } = setup({ wallets: [NWC], providers: { nwc: webln } });
  const { paid, handlers } = collect();

  service.watchRequest(direct('nwc', invoice), handlers);
  await flush();
  assert.equal(webln.listeners.size, 1);
  assert.deepEqual(clock.delays, [WATCH_TIMING.PUSH_POLL_INITIAL_MS]);
  assert.deepEqual(webln.lookups, [{ paymentHash: invoice.paymentHash }], 'WebLN looks up by { paymentHash }');

  webln.notify('e'.repeat(64));
  assert.equal(paid.length, 0);
  webln.notify(invoice.paymentHash, { settledAt: NOW + 20 });
  await flush();

  assert.deepEqual(paid, [{ paymentHash: invoice.paymentHash, preimage: PREIMAGE, settledAt: NOW + 20 }]);
  assert.equal(webln.unsubscribed, 1);
  assert.equal(clock.pending, 0);
});

test('watch NWC (WebLN provider): without notification support it polls lookupInvoice', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const webln = fakeWebln({ invoice, notifications: [] });
  const { service, clock } = setup({ wallets: [NWC], providers: { nwc: webln } });
  const { paid, handlers } = collect();

  service.watchRequest(direct('nwc', invoice), handlers);
  await flush();
  assert.equal(webln.listeners.size, 0);
  assert.deepEqual(clock.delays, [WATCH_TIMING.POLL_INITIAL_MS]);

  webln.ledger.set(invoice.paymentHash, PREIMAGE);
  await clock.advance(3_000);
  assert.equal(paid.length, 1);
  assert.equal(clock.pending, 0);
});

test('watch NWC (NWCWalletProvider): notifications when offered, else polling by hash', async () => {
  const invoice = makeInvoice({ sats: 100 });

  const withPush = fakeNwcClass({ invoice, notifications: true });
  const a = setup({ wallets: [NWC], providers: { nwc: withPush } });
  const paidA = collect();
  a.service.watchRequest(direct('nwc', invoice), paidA.handlers);
  await flush();
  assert.equal(withPush.listeners.size, 1);
  withPush.notify(invoice.paymentHash);
  await flush();
  assert.equal(paidA.paid.length, 1);
  assert.equal(withPush.unsubscribed, 1);
  assert.equal(a.clock.pending, 0);

  const withoutPush = fakeNwcClass({ invoice, notifications: false });
  const b = setup({ wallets: [NWC], providers: { nwc: withoutPush } });
  const paidB = collect();
  b.service.watchRequest(direct('nwc', invoice), paidB.handlers);
  await flush();
  assert.equal(withoutPush.listeners.size, 0);
  withoutPush.ledger.set(invoice.paymentHash, PREIMAGE);
  await b.clock.advance(3_000);
  assert.equal(paidB.paid.length, 1);
  assert.deepEqual(withoutPush.lookups, [invoice.paymentHash, invoice.paymentHash]);
});

test('watch NWC: a failing notification subscription falls back to polling', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const nwc = fakeNwcClass({ invoice });
  nwc.subscribeToPaymentNotifications = async () => { throw new Error('relay down'); };
  const { service, clock } = setup({ wallets: [NWC], providers: { nwc } });
  const { errors, handlers } = collect();
  service.watchRequest(direct('nwc', invoice), handlers);
  await flush();
  assert.equal(errors.length, 1);
  assert.deepEqual(clock.delays, [WATCH_TIMING.POLL_INITIAL_MS]);
});

test('watch lnurl (Arkade): LUD-21 verify polling settles it, and the server must name the right preimage', async () => {
  const invoice = makeInvoice({ sats: 100, hash: PREIMAGE_HASH });
  const lnurl = fakeLnurl({ invoice });
  const { service, clock } = setup({ wallets: [ARKADE], providers: { arkade: fakeArkade() }, lnurl });
  const { paid, handlers } = collect();
  const request = {
    walletId: 'arkade',
    method: 'lnurl',
    paymentHash: invoice.paymentHash,
    expiresAt: NOW + 3_600,
    verifyUrl: 'https://btc.mybuho.de/verify/abc',
  };

  service.watchRequest(request, handlers);
  await flush();
  assert.equal(lnurl.verifyCalls.length, 1);
  assert.deepEqual(lnurl.verifyCalls[0], { url: request.verifyUrl, callback: request.verifyUrl });
  assert.equal(paid.length, 0);

  lnurl.verifyAnswer = { settled: true, preimage: 'cd'.repeat(32) }; // lies about the preimage
  await clock.advance(3_000);
  assert.equal(paid.length, 0, 'a mismatching preimage is not proof');

  lnurl.verifyAnswer = { settled: true, preimage: PREIMAGE };
  await clock.advance(4_500);
  assert.deepEqual(paid, [{ paymentHash: invoice.paymentHash, preimage: PREIMAGE, settledAt: NOW + 7 }]);
  assert.equal(clock.pending, 0);
});

test('watch lnurl: settled without a preimage is accepted; the Arkade ledger is never asked', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnurl = fakeLnurl({ invoice });
  lnurl.verifyAnswer = { settled: true, preimage: null };
  const arkade = fakeArkade();
  const { service, connectCalls } = setup({ wallets: [ARKADE], providers: { arkade }, lnurl });
  const { paid, handlers } = collect();
  service.watchRequest({ walletId: 'arkade', method: 'lnurl', paymentHash: invoice.paymentHash, expiresAt: NOW + 60, verifyUrl: 'https://btc.mybuho.de/verify/abc' }, handlers);
  await flush();
  assert.equal(paid.length, 1);
  assert.equal(paid[0].preimage, null);
  assert.deepEqual(connectCalls, []);
});

test('watch lnurl: with a settlement wallet the Breez event also settles it', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnurl = fakeLnurl({ invoice });
  const spark = fakeSpark({ invoice });
  const { service, clock } = setup({ wallets: [ARKADE, BUSINESS], providers: { 'spark-biz': spark }, lnurl });
  const { paid, handlers } = collect();
  service.watchRequest({
    walletId: 'arkade',
    method: 'lnurl',
    paymentHash: invoice.paymentHash,
    expiresAt: NOW + 3_600,
    verifyUrl: 'https://btc.mybuho.de/verify/abc',
    settlementWalletId: 'spark-biz',
  }, handlers);
  await flush();
  assert.equal(spark.listeners.size, 1);
  spark.receive(invoice.paymentHash);
  await flush();
  assert.equal(paid.length, 1);
  assert.equal(spark.unsubscribed, 1);
  assert.equal(clock.pending, 0);
});

test('watch lnurl: the ledger covers a verify server that is down; verify covers a ledger that is down', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const lnurl = fakeLnurl({ invoice });
  lnurl.failVerify = true;
  const spark = fakeSpark({ invoice, ledger: new Map([[invoice.paymentHash, PREIMAGE]]) });
  const a = setup({ wallets: [ARKADE, BUSINESS], providers: { 'spark-biz': spark }, lnurl });
  const resA = collect();
  a.service.watchRequest({ walletId: 'arkade', method: 'lnurl', paymentHash: invoice.paymentHash, expiresAt: NOW + 60, verifyUrl: 'https://btc.mybuho.de/verify/abc', settlementWalletId: 'spark-biz' }, resA.handlers);
  await flush();
  assert.equal(resA.paid.length, 1);

  const lnurl2 = fakeLnurl({ invoice });
  lnurl2.verifyAnswer = { settled: true, preimage: null };
  const b = setup({ wallets: [ARKADE, BUSINESS], providers: {}, lnurl: lnurl2 });
  const resB = collect();
  b.service.watchRequest({ walletId: 'arkade', method: 'lnurl', paymentHash: invoice.paymentHash, expiresAt: NOW + 60, verifyUrl: 'https://btc.mybuho.de/verify/abc', settlementWalletId: 'spark-biz' }, resB.handlers);
  await flush();
  assert.equal(resB.paid.length, 1);
});

test('watch: an lnurl request with no way to observe it reports nothing and still ends at expiry', async () => {
  const invoice = makeInvoice({ sats: 100 });
  const { service, clock } = setup({ wallets: [ARKADE], providers: {} });
  const { paid, errors, handlers } = collect();
  service.watchRequest({ walletId: 'arkade', method: 'lnurl', paymentHash: invoice.paymentHash, expiresAt: NOW + 5 }, handlers);
  await flush();
  await clock.advance(10_000);
  assert.equal(paid.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(clock.pending, 0);
});

test('watch: rejects malformed requests and a missing onPaid', () => {
  const { service } = setup({ wallets: [LNBITS] });
  const good = { walletId: 'lnbits', method: 'direct', paymentHash: 'a'.repeat(64), expiresAt: NOW + 10 };
  const bad = [null, {}, { ...good, paymentHash: 'zz' }, { ...good, method: 'carrier-pigeon' }, { ...good, expiresAt: 'soon' }, { ...good, walletId: 5 }];
  for (const request of bad) {
    assert.throws(() => service.watchRequest(request, { onPaid() {} }), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
  }
  assert.throws(() => service.watchRequest(good, {}), (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT));
});

// ---------------------------------------------------------------------------
// reconcileRequests
// ---------------------------------------------------------------------------

test('reconcileRequests: returns exactly the paid requests, across all wallet types, once each', async () => {
  const paidSpark = makeInvoice({ sats: 1, hash: 11 });
  const openSpark = makeInvoice({ sats: 2, hash: 12 });
  const paidLnbits = makeInvoice({ sats: 3, hash: 13 });
  const paidWebln = makeInvoice({ sats: 4, hash: 14 });
  const paidNwc = makeInvoice({ sats: 5, hash: 15 });
  const paidArkade = makeInvoice({ sats: 6, hash: 16 });
  const openArkade = makeInvoice({ sats: 7, hash: 17 });

  const spark = fakeSpark({ invoice: paidSpark, ledger: new Map([[paidSpark.paymentHash, PREIMAGE]]) });
  const lnbits = fakeLnbits({ invoice: paidLnbits, ledger: new Map([[paidLnbits.paymentHash, PREIMAGE]]) });
  const webln = fakeWebln({ invoice: paidWebln, ledger: new Map([[paidWebln.paymentHash, PREIMAGE]]) });
  const nwcClass = fakeNwcClass({ invoice: paidNwc, ledger: new Map([[paidNwc.paymentHash, PREIMAGE]]) });
  const lnurl = fakeLnurl({ invoice: paidArkade });
  lnurl.verifyPayment = async (url) => ({ settled: url.endsWith('/paid'), preimage: null });

  const { service, clock } = setup({
    wallets: [BUSINESS, LNBITS, NWC, { ...NWC, id: 'nwc2' }, ARKADE],
    providers: { 'spark-biz': spark, lnbits, nwc: webln, nwc2: nwcClass },
    lnurl,
  });

  const result = await service.reconcileRequests([
    { id: 'r1', ...direct('spark-biz', paidSpark) },
    { id: 'r2', ...direct('spark-biz', openSpark) },
    { id: 'r3', ...direct('lnbits', paidLnbits) },
    { id: 'r4', ...direct('nwc', paidWebln) },
    { id: 'r5', ...direct('nwc2', paidNwc) },
    { id: 'r6', walletId: 'arkade', method: 'lnurl', paymentHash: paidArkade.paymentHash, expiresAt: NOW + 60, verifyUrl: 'https://btc.mybuho.de/verify/paid' },
    { id: 'r7', walletId: 'arkade', method: 'lnurl', paymentHash: openArkade.paymentHash, expiresAt: NOW + 60, verifyUrl: 'https://btc.mybuho.de/verify/open' },
    { id: 'junk', paymentHash: 'nope' },
  ]);

  assert.deepEqual(result.map((r) => r.id).sort(), ['r1', 'r3', 'r4', 'r5', 'r6']);
  assert.equal(result.find((r) => r.id === 'r1').preimage, PREIMAGE);
  assert.equal(result.find((r) => r.id === 'r6').preimage, null);
  assert.equal(result.find((r) => r.id === 'r1').settledAt, NOW);
  assert.equal(spark.lookups, 2, 'one look per request');
  assert.equal(clock.pending, 0, 'reconcile schedules nothing');
});

test('reconcileRequests: a request whose sources all fail is skipped, the rest still count', async () => {
  const a = makeInvoice({ sats: 1, hash: 21 });
  const b = makeInvoice({ sats: 2, hash: 22 });
  const lnbits = fakeLnbits({ invoice: a, ledger: new Map([[b.paymentHash, PREIMAGE]]) });
  const { service } = setup({ wallets: [LNBITS, BUSINESS], providers: { lnbits } }); // spark is unreachable
  const result = await service.reconcileRequests([
    { id: 'down', ...direct('spark-biz', a) },
    { id: 'ok', ...direct('lnbits', b) },
  ]);
  assert.deepEqual(result.map((r) => r.id), ['ok']);
  assert.deepEqual(await service.reconcileRequests(null), []);
  assert.deepEqual(await service.reconcileRequests([]), []);
});

test('reconcileRequests: never runs more than four checks at once', async () => {
  let running = 0;
  let peak = 0;
  const lnbits = fakeLnbits({ invoice: makeInvoice({ sats: 1 }) });
  lnbits.lookupInvoice = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return { paid: false };
  };
  const { service } = setup({ wallets: [LNBITS], providers: { lnbits } });
  const requests = Array.from({ length: 10 }, (_, i) => direct('lnbits', makeInvoice({ sats: 1, hash: 40 + i })));
  assert.deepEqual(await service.reconcileRequests(requests), []);
  assert.ok(peak <= 4 && peak > 1, `peak was ${peak}`);
});

// ---------------------------------------------------------------------------
// checkPayable
// ---------------------------------------------------------------------------

test('checkPayable: the payer-side verdict for every wallet type', () => {
  const invoice = makeInvoice({ sats: 12_000 });
  const request = { bolt11: invoice.bolt11, amountSats: 12_000, expiresAt: NOW + 3_600 };
  const opts = { now: NOW };

  const wallets = [
    ['Spark', { type: 'spark' }, { ok: true }],
    ['NWC', { type: 'nwc' }, { ok: true }],
    ['LNbits', { type: 'lnbits' }, { ok: true }],
    ['Arkade', { type: 'arkade' }, { ok: false, reason: DM_ERROR.WALLET_CANNOT_PAY }],
    ['no wallet', null, { ok: false, reason: DM_ERROR.WALLET_CANNOT_PAY }],
  ];
  for (const [name, wallet, expected] of wallets) {
    assert.deepEqual(checkPayable(request, wallet, opts), expected, name);
  }
});

test('checkPayable: invoice problems come first and say INVALID_INVOICE or EXPIRED', () => {
  const spark = { type: 'spark' };
  const good = makeInvoice({ sats: 12_000 });
  const table = [
    ['expired invoice', { bolt11: good.bolt11, amountSats: 12_000 }, { now: NOW + 3_600 }, DM_ERROR.INVOICE_EXPIRED],
    ['request expiry earlier than the invoice', { bolt11: good.bolt11, amountSats: 12_000, expiresAt: NOW + 10 }, { now: NOW + 10 }, DM_ERROR.INVOICE_EXPIRED],
    ['amount differs from the request', { bolt11: good.bolt11, amountSats: 11_999 }, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['non-integer amount', { bolt11: good.bolt11, amountSats: 12_000.5 }, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['testnet invoice', { bolt11: makeInvoice({ sats: 12_000, network: 'tb' }).bolt11, amountSats: 12_000 }, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['zero-amount invoice', { bolt11: makeInvoice().bolt11, amountSats: 12_000 }, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['garbage', { bolt11: 'lnbc1garbage', amountSats: 1 }, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['missing', {}, { now: NOW }, DM_ERROR.INVALID_INVOICE],
    ['null request', null, { now: NOW }, DM_ERROR.INVALID_INVOICE],
  ];
  for (const [name, request, options, reason] of table) {
    assert.deepEqual(checkPayable(request, spark, options), { ok: false, reason }, name);
  }
  // An expired invoice on a wallet that cannot pay is reported as the invoice's problem.
  assert.equal(checkPayable({ bolt11: good.bolt11, amountSats: 12_000 }, { type: 'arkade' }, { now: NOW + 9_999 }).reason, DM_ERROR.INVOICE_EXPIRED);
});

test('service.checkPayable uses the injected clock', () => {
  const invoice = makeInvoice({ sats: 5, expiry: 100 });
  const { service, clock } = setup({ wallets: [] });
  const request = { bolt11: invoice.bolt11, amountSats: 5 };
  assert.deepEqual(service.checkPayable(request, { type: 'lnbits' }), { ok: true });
  clock.setTimer(() => {}, 0);
  return clock.advance(101_000).then(() => {
    assert.deepEqual(service.checkPayable(request, { type: 'lnbits' }), { ok: false, reason: DM_ERROR.INVOICE_EXPIRED });
  });
});

test('vocabulary is frozen', () => {
  assert.throws(() => { 'use strict'; REQUEST_METHOD.DIRECT = 'x'; }, TypeError);
  assert.throws(() => { 'use strict'; WATCH_TIMING.BACKOFF = 9; }, TypeError);
});

// ---------------------------------------------------------------------------
// Pulling a fresh invoice for an expired request (docs section 8a)
// ---------------------------------------------------------------------------

test('pullInvoice: asks the request\'s address for exactly the amount, with the LUD-12 reference', async () => {
  const fresh = makeInvoice({ sats: 5_000, hash: 9, expiry: 3_600 });
  const { service, lnurl } = setup({ lnurl: fakeLnurl({ invoice: fresh }) });
  const result = await service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000, reference: 'abc123' });
  assert.equal(result.bolt11, fresh.bolt11);
  assert.equal(result.paymentHash, fresh.paymentHash);
  assert.equal(result.expiresAt, NOW + 3_600);
  assert.deepEqual(lnurl.fetched, ['https://btc.mybuho.de/.well-known/lnurlp/anna']);
  assert.equal(lnurl.requested[0].msats, 5_000_000);
  assert.deepEqual(lnurl.requested[0].options, { comment: 'buho:req:abc123' });
});

test('pullInvoice: no comment when the server allows none or too few characters', async () => {
  for (const commentAllowed of [0, 5]) {
    const { service, lnurl } = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }), commentAllowed }) });
    await service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000, reference: 'abc123' });
    assert.equal(lnurl.requested[0].options, undefined, String(commentAllowed));
  }
});

test('pullInvoice: an amount outside min/maxSendable is AMOUNT_OUT_OF_RANGE and no invoice is requested', async () => {
  for (const sats of [5_000, 1]) {
    const { service, lnurl } = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats }), min: 10_000_000, max: 20_000_000 }) });
    await assert.rejects(service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: sats }), rejectsWith(DM_ERROR.AMOUNT_OUT_OF_RANGE));
    assert.equal(lnurl.requested.length, 0);
  }
});

test('pullInvoice: LNURL failures, unusable addresses and arguments map to codes', async () => {
  const down = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }) }) });
  down.lnurl.failFetch = true;
  await assert.rejects(down.service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_REFRESH_FAILED));

  const broken = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }) }) });
  broken.lnurl.requestInvoice = async () => { throw new Error('server error'); };
  await assert.rejects(broken.service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_REFRESH_FAILED));

  const { service } = setup();
  for (const lud16 of ['', 'no-at-sign', null, undefined]) {
    await assert.rejects(service.pullInvoice({ lud16, amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_REFRESH_FAILED), String(lud16));
  }
  for (const amountSats of [0, -1, 1.5, '5000', undefined]) {
    await assert.rejects(service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats }), rejectsWith(DM_ERROR.INVALID_ARGUMENT), String(amountSats));
  }
});

test('pullInvoice: an invoice that is not exactly the amount, not mainnet, expired or garbage is rejected', async () => {
  const bad = {
    'wrong amount': makeInvoice({ sats: 4_999 }),
    'zero amount': makeInvoice({}),
    testnet: makeInvoice({ sats: 5_000, network: 'tb' }),
    expired: makeInvoice({ sats: 5_000, timestamp: NOW - 7_200, expiry: 3_600 }),
  };
  for (const [name, invoice] of Object.entries(bad)) {
    const { service } = setup({ lnurl: fakeLnurl({ invoice }) });
    await assert.rejects(service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_REFRESH_FAILED), name);
  }
  const garbage = setup({ lnurl: fakeLnurl({ invoice: { bolt11: 'not-an-invoice' } }) });
  await assert.rejects(garbage.service.pullInvoice({ lud16: 'anna@btc.mybuho.de', amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_REFRESH_FAILED));
});

test('invoiceNeedsRefresh: valid yes-no, within the margin or expired yes; undecodable is not a refresh case', () => {
  const invoice = makeInvoice({ sats: 5_000, expiry: 3_600 });
  assert.equal(invoiceNeedsRefresh({ bolt11: invoice.bolt11, expiresAt: NOW + 3_600 }, NOW), false);
  assert.equal(invoiceNeedsRefresh({ expiresAt: NOW + INVOICE_REFRESH_MARGIN_SECONDS }, NOW), true);
  assert.equal(invoiceNeedsRefresh({ expiresAt: NOW + INVOICE_REFRESH_MARGIN_SECONDS + 1 }, NOW), false);
  assert.equal(invoiceNeedsRefresh({ expiresAt: NOW - 1 }, NOW), true);
  assert.equal(invoiceNeedsRefresh({ bolt11: invoice.bolt11 }, NOW + 3_590), true, 'falls back to the decoded invoice');
  assert.equal(invoiceNeedsRefresh({ bolt11: 'garbage' }, NOW), false);
});

test('checkPayable: an expired invoice blocks only a request without an address to ask', () => {
  const invoice = makeInvoice({ sats: 5_000, expiry: 60 });
  const wallet = { type: 'spark' };
  const later = NOW + 600;
  assert.deepEqual(checkPayable({ bolt11: invoice.bolt11, amountSats: 5_000 }, wallet, { now: later }), { ok: false, reason: DM_ERROR.INVOICE_EXPIRED });
  assert.deepEqual(checkPayable({ bolt11: invoice.bolt11, amountSats: 5_000, lud16: 'anna@btc.mybuho.de' }, wallet, { now: later }), { ok: true });
});
