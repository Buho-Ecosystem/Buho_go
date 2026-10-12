/**
 * Payment request service tests (docs/CONTACT_CHAT.md sections 8 and 8a).
 *
 * The service has no wallet in it: it checks the user's own profile address
 * before a request is sent, and, on the payer's side, finds the requester's
 * current address and pulls an invoice from it. The LNURL server and the
 * profile lookup are fakes and time is fixed, so nothing here touches the
 * network.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/requests.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DM_ERROR, DmError } from '../errors.js';
import { PROFILE_LOOKUP_TIMEOUT_MS, createRequestService } from '../requests.js';
import { NOW, makeInvoice } from './invoiceFixture.js';

const ADDRESS = 'anna@btc.mybuho.de';
const PARTNER = 'b'.repeat(64);

const rejectsWith = (code) => (error) => DmError.is(error, code);

/** LNURL server behind a Lightning address (Breez at btc.mybuho.de). */
function fakeLnurl({ invoice = null, commentAllowed = 255, min = 1_000, max = 1_000_000_000, verify } = {}) {
  const server = {
    fetched: [],
    requested: [],
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
      return { pr: invoice.bolt11, routes: [], verify };
    },
  };
  return server;
}

/** A kind 0 event as `fetchProfile` hands it out. */
const profileEvent = (content) => ({ kind: 0, pubkey: PARTNER, content: JSON.stringify(content) });

function setup({ profileAddress = ADDRESS, lnurl = fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }) }), profile = null } = {}) {
  const lookups = [];
  const service = createRequestService({
    getProfileAddress: () => profileAddress,
    fetchProfile: async (pubkey, options) => {
      lookups.push({ pubkey, options });
      if (profile instanceof Error) throw profile;
      return profile;
    },
    lnurl,
    now: () => NOW * 1_000,
  });
  return { service, lnurl, lookups };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('createRequestService refuses missing collaborators', () => {
  const lnurl = fakeLnurl();
  for (const deps of [
    undefined,
    { fetchProfile() {}, lnurl },
    { getProfileAddress() {}, lnurl },
    { getProfileAddress() {}, fetchProfile() {}, lnurl: {} },
    { getProfileAddress() {}, fetchProfile() {}, lnurl: { fetchPayRequest() {} } },
  ]) {
    assert.throws(() => createRequestService(deps), rejectsWith(DM_ERROR.INVALID_ARGUMENT));
  }
});

// ---------------------------------------------------------------------------
// Before sending: the user's own address (preflight)
// ---------------------------------------------------------------------------

test('checkOwnAddress: an address that answers and accepts the amount passes, normalised, and nothing is invoiced', async () => {
  const { service, lnurl } = setup({ profileAddress: '  Anna@BTC.mybuho.de ' });
  assert.equal(await service.checkOwnAddress(5_000), ADDRESS);
  assert.deepEqual(lnurl.fetched, ['https://btc.mybuho.de/.well-known/lnurlp/anna']);
  assert.equal(lnurl.requested.length, 0);
});

test('checkOwnAddress: no profile address is NO_PAYMENT_ADDRESS and nothing is asked', async () => {
  for (const profileAddress of [null, '', '   ', 'no-at-sign', 'two words@x.io']) {
    const { service, lnurl } = setup({ profileAddress });
    await assert.rejects(service.checkOwnAddress(5_000), rejectsWith(DM_ERROR.NO_PAYMENT_ADDRESS), String(profileAddress));
    assert.equal(lnurl.fetched.length, 0);
  }
});

test('checkOwnAddress: an address that does not answer is PAYMENT_ADDRESS_UNREACHABLE', async () => {
  const { service, lnurl } = setup();
  lnurl.failFetch = true;
  await assert.rejects(service.checkOwnAddress(5_000), rejectsWith(DM_ERROR.PAYMENT_ADDRESS_UNREACHABLE));
});

test('checkOwnAddress: an amount outside min/maxSendable is AMOUNT_OUT_OF_RANGE', async () => {
  for (const sats of [5_000, 30_000]) {
    const { service } = setup({ lnurl: fakeLnurl({ min: 10_000_000, max: 20_000_000 }) });
    await assert.rejects(service.checkOwnAddress(sats), rejectsWith(DM_ERROR.AMOUNT_OUT_OF_RANGE), String(sats));
  }
  const { service } = setup({ lnurl: fakeLnurl({ min: 5_000_000, max: 5_000_000 }) });
  assert.equal(await service.checkOwnAddress(5_000), ADDRESS, 'the bounds are inclusive');
});

test('checkOwnAddress: a payRequest without bounds cannot vouch for the amount', async () => {
  const { service, lnurl } = setup();
  lnurl.payRequest = { tag: 'payRequest', callback: 'https://btc.mybuho.de/cb' };
  await assert.rejects(service.checkOwnAddress(5_000), rejectsWith(DM_ERROR.AMOUNT_OUT_OF_RANGE));
});

test('checkOwnAddress: a bad amount is INVALID_ARGUMENT', async () => {
  const { service } = setup();
  for (const amountSats of [0, -1, 1.5, '5000', undefined]) {
    await assert.rejects(service.checkOwnAddress(amountSats), rejectsWith(DM_ERROR.INVALID_ARGUMENT), String(amountSats));
  }
});

// ---------------------------------------------------------------------------
// Paying: where does the requester get paid today?
// ---------------------------------------------------------------------------

test('resolveRequesterAddress: the requester\'s current profile address wins over the signed one', async () => {
  const { service, lookups } = setup({ profile: profileEvent({ lud16: ' New@Wallet.example ' }) });
  assert.equal(await service.resolveRequesterAddress(PARTNER, ADDRESS), 'new@wallet.example');
  assert.deepEqual(lookups, [{ pubkey: PARTNER, options: { timeoutMs: PROFILE_LOOKUP_TIMEOUT_MS } }]);
});

test('resolveRequesterAddress: without a usable profile address the signed one is used', async () => {
  const cases = {
    'no profile found': null,
    'the lookup fails': new Error('relays down'),
    'a profile without lud16': profileEvent({ name: 'Anna' }),
    'an empty lud16': profileEvent({ lud16: '' }),
    'a lud16 that is no address': profileEvent({ lud16: 'not an address' }),
    'a lud16 that is no string': profileEvent({ lud16: 42 }),
    'an unreadable profile': { kind: 0, content: '{nope' },
  };
  for (const [name, profile] of Object.entries(cases)) {
    const { service } = setup({ profile });
    assert.equal(await service.resolveRequesterAddress(PARTNER, ADDRESS), ADDRESS, name);
  }
});

// ---------------------------------------------------------------------------
// Paying: the invoice, created when the payer taps Pay
// ---------------------------------------------------------------------------

test('pullInvoice: asks the address for exactly the amount, with no comment', async () => {
  const fresh = makeInvoice({ sats: 5_000, hash: 9 });
  const { service, lnurl } = setup({ lnurl: fakeLnurl({ invoice: fresh }) });
  const pulled = await service.pullInvoice({ lud16: ADDRESS, amountSats: 5_000 });
  assert.deepEqual(pulled, { bolt11: fresh.bolt11, verifyUrl: null });
  assert.deepEqual(lnurl.fetched, ['https://btc.mybuho.de/.well-known/lnurlp/anna']);
  assert.equal(lnurl.requested[0].msats, 5_000_000);
  // A comment would be the payment's message in the requester's wallet.
  assert.equal(lnurl.requested[0].options, undefined);
});

test('pullInvoice: hands on the LUD-21 verify URL only when it is https on the callback host', async () => {
  const cases = [
    ['https://btc.mybuho.de/lnurlp/verify/abc', 'https://btc.mybuho.de/lnurlp/verify/abc'],
    ['https://BTC.mybuho.de:8443/verify/abc', 'https://btc.mybuho.de:8443/verify/abc'],
    ['http://btc.mybuho.de/verify/abc', null],
    ['https://evil.example/verify/abc', null],
    ['https://btc.mybuho.de.evil.example/verify/abc', null],
    ['javascript:alert(1)', null],
    ['not a url', null],
    [42, null],
    [undefined, null],
  ];
  for (const [verify, expected] of cases) {
    const { service } = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats: 5_000 }), verify }) });
    const pulled = await service.pullInvoice({ lud16: ADDRESS, amountSats: 5_000 });
    assert.equal(pulled.verifyUrl, expected, String(verify));
  }
});


test('pullInvoice: an amount outside min/maxSendable is AMOUNT_OUT_OF_RANGE and no invoice is requested', async () => {
  for (const sats of [5_000, 1]) {
    const { service, lnurl } = setup({ lnurl: fakeLnurl({ invoice: makeInvoice({ sats }), min: 10_000_000, max: 20_000_000 }) });
    await assert.rejects(service.pullInvoice({ lud16: ADDRESS, amountSats: sats }), rejectsWith(DM_ERROR.AMOUNT_OUT_OF_RANGE));
    assert.equal(lnurl.requested.length, 0);
  }
});

test('pullInvoice: LNURL failures and unusable addresses are INVOICE_FETCH_FAILED, bad arguments INVALID_ARGUMENT', async () => {
  const down = setup();
  down.lnurl.failFetch = true;
  await assert.rejects(down.service.pullInvoice({ lud16: ADDRESS, amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_FETCH_FAILED));

  const broken = setup();
  broken.lnurl.requestInvoice = async () => { throw new Error('server error'); };
  await assert.rejects(broken.service.pullInvoice({ lud16: ADDRESS, amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_FETCH_FAILED));

  const { service } = setup();
  for (const lud16 of ['', 'no-at-sign', null, undefined]) {
    await assert.rejects(service.pullInvoice({ lud16, amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_FETCH_FAILED), String(lud16));
  }
  for (const amountSats of [0, -1, 1.5, '5000', undefined]) {
    await assert.rejects(service.pullInvoice({ lud16: ADDRESS, amountSats }), rejectsWith(DM_ERROR.INVALID_ARGUMENT), String(amountSats));
  }
});

test('pullInvoice: an invoice that is not exactly the amount, not mainnet, expired or garbage is rejected', async () => {
  const bad = {
    'wrong amount': makeInvoice({ sats: 4_999 }),
    'zero amount': makeInvoice({}),
    testnet: makeInvoice({ sats: 5_000, network: 'tb' }),
    expired: makeInvoice({ sats: 5_000, timestamp: NOW - 7_200, expiry: 3_600 }),
    garbage: { bolt11: 'not-an-invoice' },
    empty: { bolt11: '' },
  };
  for (const [name, invoice] of Object.entries(bad)) {
    const { service } = setup({ lnurl: fakeLnurl({ invoice }) });
    await assert.rejects(service.pullInvoice({ lud16: ADDRESS, amountSats: 5_000 }), rejectsWith(DM_ERROR.INVOICE_FETCH_FAILED), name);
  }
});
