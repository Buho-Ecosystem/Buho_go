import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestProfileInvoice } from '../publicProfileInvoice.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

const now = Date.now();
const input = { address: 'maria@pay.invalid', amountSats: 1000, comment: 'Thank you & bis bald!' };
const metadata = {
  tag: 'payRequest', minSendable: 1000, maxSendable: 10000000, commentAllowed: 100,
  callback: 'https://pay.invalid/callback?session=KeepCase&amount=1&currency=USD&comment=old',
};
function harness({ params = metadata, reply = { pr: profileInvoiceFixture(1000, now) }, ok = true } = {}) {
  const calls = [];
  return { calls, request: (payment = input) => requestProfileInvoice(payment, {
    now: () => now,
    getJson: async (url, options) => {
      calls.push({ url, options });
      return { ok, data: calls.length % 2 ? params : reply };
    },
  }) };
}

test('invoice preserves exact sats, recipient, supported note and expiry without paying', async () => {
  const h = harness();
  const signal = new AbortController().signal;
  const result = await h.request({ ...input, signal });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://pay.invalid/.well-known/lnurlp/maria');
  const url = new URL(h.calls[1].url);
  assert.equal(url.searchParams.get('amount'), '1000000');
  assert.equal(url.searchParams.get('comment'), input.comment);
  assert.equal(url.searchParams.get('session'), 'KeepCase');
  assert.equal(url.searchParams.has('currency'), false);
  for (const { options } of h.calls) {
    assert.equal(options.signal, signal);
    assert.equal(options.timeoutMs, 15000);
  }
  assert.deepEqual(result, {
    invoice: profileInvoiceFixture(1000, now), amountSats: 1000,
    expiresAt: (Math.floor(now / 1000) + 900) * 1000,
    address: input.address, comment: input.comment, noteChanged: false,
  });
});

test('invalid amounts and addresses never request an invoice', async () => {
  for (const amountSats of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '1000']) {
    const h = harness();
    await assert.rejects(h.request({ ...input, amountSats }), { code: 'amount' });
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  await assert.rejects(h.request({ ...input, address: 'not-an-address' }), { code: 'unavailable' });
  assert.equal(h.calls.length, 0);
});

test('limits fail explicitly before callback, including non-whole-sat limits', async () => {
  for (const [params, code, n] of [
    [{ ...metadata, minSendable: 1000001 }, 'minimum', 1001],
    [{ ...metadata, maxSendable: 999999 }, 'maximum', 999],
  ]) {
    const h = harness({ params });
    await assert.rejects(h.request(), { code, values: { n } });
    assert.equal(h.calls.length, 1);
  }
});

test('malformed metadata and unsafe callbacks are rejected', async () => {
  for (const change of [
    { tag: 'withdrawRequest' }, { status: 'ERROR' }, { minSendable: -1 },
    { maxSendable: 0 }, { maxSendable: Infinity }, { callback: 'javascript:alert(1)' },
    { callback: 'http://pay.invalid/callback' }, { callback: 'https://user:password@pay.invalid/callback' },
  ]) {
    const h = harness({ params: { ...metadata, ...change } });
    await assert.rejects(h.request(), { code: 'unavailable' });
    assert.equal(h.calls.length, 1);
  }
});

test('unsupported and shortened notes are disclosed and never inherited from callback URL', async () => {
  for (const allowed of [undefined, 0, -1, '10', 5]) {
    const h = harness({ params: { ...metadata, commentAllowed: allowed } });
    const result = await h.request();
    const expected = allowed === 5 ? 'Thank' : '';
    assert.equal(result.comment, expected);
    assert.equal(result.noteChanged, true);
    assert.equal(new URL(h.calls[1].url).searchParams.get('comment'), expected || null);
  }
});

test('malformed, mismatched and expired invoices never become wallet links', async () => {
  for (const [reply, code] of [
    [{ status: 'ERROR', reason: 'private provider message' }, 'unavailable'],
    [{}, 'unavailable'], [{ pr: 'lnbc1000-invalid' }, 'invalid'],
    [{ pr: profileInvoiceFixture(999, now) }, 'invalid'],
    [{ pr: profileInvoiceFixture(1000, now - 900000) }, 'expired'],
  ]) await assert.rejects(harness({ reply }).request(), { code });
  await assert.rejects(harness({ ok: false }).request(), { code: 'unavailable' });
});

test('network errors and cancellation propagate without a fallback address', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestProfileInvoice({ ...input, signal: controller.signal }, {
    getJson: async (_, { signal }) => { signal.throwIfAborted(); },
  }), { name: 'AbortError' });
  const failure = new Error('offline');
  await assert.rejects(requestProfileInvoice(input, { getJson: async () => { throw failure; } }), failure);
});
