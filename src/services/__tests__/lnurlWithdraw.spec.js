import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWithdrawRequest, submitWithdrawCallback, safeWithdrawError } from '../lnurlWithdraw.js';
const metadata = { tag: 'withdrawRequest', k1: 'one-time', callback: 'https://card.example/callback?session=KeepCase', minWithdrawable: 1000, maxWithdrawable: 100000, defaultDescription: 'Bolt Card', pinLimit: 50000 };
const get = async () => ({ ok: true, data: metadata });

test('uses shared withdrawal metadata and preserves PIN threshold and challenge', async () => {
  const result = await fetchWithdrawRequest('lnurlw://card.example/tap', { get });
  assert.equal(result.k1, 'one-time');
  assert.equal(result.pinLimit, 50000);
  assert.equal(result.minSats, 1);
  assert.equal(result.maxSats, 100);
});
test('rejects pay, auth, address requests and malformed card limits', async () => {
  for (const data of [
    { ...metadata, tag: 'payRequest' }, { ...metadata, tag: 'login' }, { ...metadata, tag: 'addressRequest' },
    { ...metadata, callback: 'https://user:password@card.example/callback' },
    { ...metadata, callback: 'lnurlw://card.example/callback' },
    { ...metadata, maxWithdrawable: -1 }, { ...metadata, pinLimit: '50000' },
  ]) await assert.rejects(fetchWithdrawRequest('https://card.example/tap', { get: async () => ({ ok: true, data }) }));
});
test('single callback retains invoice, challenge, PIN and existing query values', async () => {
  let calls = 0;
  await submitWithdrawCallback(metadata, 'lnbc-sale', '1234', { get: async (input, options) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.searchParams.get('pr'), 'lnbc-sale');
    assert.equal(url.searchParams.get('k1'), metadata.k1);
    assert.equal(url.searchParams.get('pin'), '1234');
    assert.equal(url.searchParams.get('session'), 'KeepCase');
    assert.equal(options.timeoutMs, 90000);
    return { ok: true, data: { status: 'OK' } };
  } });
  assert.equal(calls, 1);
});
test('errors cannot expose card challenges or PINs and are never retried', async () => {
  let calls = 0;
  await assert.rejects(submitWithdrawCallback(metadata, 'lnbc-sale', '1234', { get: async url => {
    calls++;
    throw new Error('Failed to fetch ' + url);
  } }), error => !error.message.includes('1234') && !error.message.includes(metadata.k1));
  assert.equal(calls, 1);
  assert.ok(!safeWithdrawError('error ?pin=1234&k1=one-time').includes('1234'));
});
test('PIN rejection and card blocking retain machine-readable codes', async () => {
  for (const [reason, code] of [['Invalid PIN', 'INVALID_PIN'], ['Card blocked: invalid PIN', 'CARD_BLOCKED']]) {
    await assert.rejects(submitWithdrawCallback(metadata, 'lnbc-sale', '1234', { get: async () => ({ ok: true, data: { status: 'ERROR', reason } }) }), { code });
  }
});
test('aborted sessions and insecure PIN callbacks never submit', async () => {
  const controller = new AbortController(); controller.abort();
  const never = async () => assert.fail('must not submit');
  await assert.rejects(submitWithdrawCallback(metadata, 'lnbc-sale', null, { signal: controller.signal, get: never }), { name: 'AbortError' });
  await assert.rejects(submitWithdrawCallback({ ...metadata, callback: 'http://abcdefghijklmnop.onion/callback' }, 'lnbc-sale', '1234', { get: never }), /secure/);
});

test('transport timeout is a visible failure, while caller cancellation remains an abort', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(submitWithdrawCallback(metadata, 'lnbc-sale', null, {
      signal: controller.signal,
      get: async () => {
        calls++;
        if (cancel) controller.abort();
        throw new DOMException('The server did not respond in time', 'AbortError');
      },
    }), { name: cancel ? 'AbortError' : 'TimeoutError' });
    assert.equal(calls, 1);
  }
});
