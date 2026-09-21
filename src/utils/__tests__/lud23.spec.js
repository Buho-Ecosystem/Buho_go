import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bech32 } from 'bech32';
import { isAddressRequest, parseAddressRequest, validateAddressRequestDetails, addressSubmissionUrl, assertPaymentInput } from '../lud23.js';
import { resolveAddressRequest, submitAddressRequest } from '../../services/addressRequest.js';
import { classifyDestination, isSuggestibleDestination, offerLabelKey, offerActionKey } from '../clipboardSuggestion.js';
import { preferredProfileLightningAddress } from '../profilePaymentAddress.js';

const k1 = 'aB'.repeat(32);
const data = { tag: 'addressRequest', k1, callback: 'https://receive.example/CaseSensitive?token=KeepMe&x=1', description: 'Rewards for Alice@Example.com' };
const inline = `https://game.example/share?${new URLSearchParams(data)}`;
const initial = `https://game.example/share?tag=addressRequest&k1=${k1}`;
const encoded = value => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(value)), 16384);
const code = value => error => error.code === value;

test('profile defaults keep Business before Personal regardless of the spending wallet', () => {
  const personal = { id: 'personal', type: 'spark', connectionData: { accountNumber: 2 }, metadata: { lud16: 'personal@example.com' } };
  const business = { id: 'business', type: 'spark', connectionData: { accountNumber: 1 }, metadata: { lud16: 'business@example.com' } };
  const state = { wallets: [personal, business], activeWalletId: 'personal' };
  assert.equal(preferredProfileLightningAddress(state), 'business@example.com');
  assert.equal(preferredProfileLightningAddress({ ...state, walletInfos: { business: { lightningAddress: 'Updated@Example.com' } } }), 'updated@example.com');
  assert.equal(preferredProfileLightningAddress({ wallets: [personal] }), 'personal@example.com');
  assert.equal(preferredProfileLightningAddress({ wallets: [null, { type: 'arkade' }] }), null);
  assert.equal(preferredProfileLightningAddress({ wallets: null }), null);
  assert.equal(preferredProfileLightningAddress({ wallets: [business], walletInfos: null }), 'business@example.com');
});

for (const [name, input] of Object.entries({ url: inline, lnurl: encoded(inline), uppercase: encoded(inline).toUpperCase(),
  wrapped: `lightning:${encoded(inline)}`, lnurlWrapper: `lnurl:${encoded(inline)}`,
  scheme: `lightning:addressRequest?${new URLSearchParams({ k1, callback: data.callback, description: data.description })}` })) {
  test(`recognizes and preserves ${name}`, () => {
    assert.equal(isAddressRequest(input), true);
    const { request } = parseAddressRequest(input);
    assert.equal(request.callback, data.callback);
    assert.equal(request.k1, k1);
    assert.equal(request.description, data.description);
    assert.equal(request.domain, 'receive.example');
    assert.throws(() => assertPaymentInput(input), code('ADDRESS_REQUEST_NOT_PAYMENT'));
  });
}

test('ordinary payment/auth URLs and non-strings are not sharing requests', () => {
  for (const value of [null, {}, '', 'alice@example.com', 'lnurlw://example.com/a', initial.replace('addressRequest', 'login'), encoded(initial.replace('addressRequest', 'payRequest'))]) {
    assert.equal(isAddressRequest(value), false);
  }
});

test('malformed recognizable requests stay in the sharing error path', () => {
  for (const input of [initial.replace(k1, 'bad'), initial + '&tag=payRequest', inline.replace('tag=addressRequest', 'tag=ADDRESSREQUEST')]) {
    assert.equal(isAddressRequest(input), true);
    assert.throws(() => parseAddressRequest(input), code('ADDRESS_REQUEST_INVALID'));
  }
});

test('rejects missing fields, duplicate fields and invalid challenge encodings', () => {
  for (const field of ['k1', 'description', 'callback']) {
    const params = new URLSearchParams(data); params.delete(field);
    assert.throws(() => parseAddressRequest(`lightning:addressRequest?${params}`));
  }
  for (const field of ['tag', 'k1', 'description', 'callback']) {
    assert.throws(() => parseAddressRequest(inline + `&${field}=duplicate`));
  }
  for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
    assert.throws(() => parseAddressRequest(initial.replace(k1, value)));
  }
});

test('HTTPS is required except for onion callbacks; credentials and fragments are rejected', () => {
  for (const callback of ['http://example.com/', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com/#secret', 'https://example.com/?k1=a&k1=b']) {
    assert.throws(() => parseAddressRequest(`https://game.example/?${new URLSearchParams({ ...data, callback })}`));
  }
  for (const length of [16, 56]) {
    const callback = `http://${'a'.repeat(length)}.onion/share`;
    assert.equal(parseAddressRequest(`https://game.example/?${new URLSearchParams({ ...data, callback })}`).request.callback, callback);
  }
});

test('initial endpoint itself must be secure', () => {
  assert.throws(() => parseAddressRequest(initial.replace('https:', 'http:')), code('ADDRESS_REQUEST_INSECURE'));
});

test('fetched tag and challenge must match; descriptions must be human readable', () => {
  const parsed = parseAddressRequest(initial);
  assert.equal(validateAddressRequestDetails(data, parsed).callback, data.callback);
  for (const change of [{ k1: 'c'.repeat(64) }, { tag: 'payRequest' }, { description: '' }, { description: {} }, { description: '\u0000' }]) {
    assert.throws(() => validateAddressRequestDetails({ ...data, ...change }, parsed));
  }
});

test('constructs the approved callback without losing existing query parameters', () => {
  const url = new URL(addressSubmissionUrl({ ...data, callback: data.callback + '&k1=old&address=old' }, 'alice+rewards@example.com'));
  assert.equal(url.searchParams.get('token'), 'KeepMe');
  assert.deepEqual(url.searchParams.getAll('k1'), [k1]);
  assert.deepEqual(url.searchParams.getAll('address'), ['alice+rewards@example.com']);
  assert.throws(() => addressSubmissionUrl(data, 'alice@example.com&extra=yes'));
});

test('inline resolution makes no network request', async () => {
  const request = await resolveAddressRequest(inline, { get: () => assert.fail('unexpected fetch') });
  assert.equal(request.callback, data.callback);
});

test('metadata resolution disables redirects and passes cancellation', async () => {
  const controller = new AbortController();
  const request = await resolveAddressRequest(initial, { signal: controller.signal, get: async (url, options) => {
    assert.equal(url, initial);
    assert.equal(options.disableRedirects, true);
    assert.equal(options.signal, controller.signal);
    return { ok: true, data };
  } });
  assert.equal(request.k1, k1);
});

test('metadata failures are safe and do not echo request URLs', async () => {
  await assert.rejects(resolveAddressRequest(initial, { get: async () => { throw new Error(inline); } }), code('ADDRESS_REQUEST_UNREACHABLE'));
  await assert.rejects(resolveAddressRequest(initial, { get: async () => ({ ok: true, data: { status: 'ERROR', reason: inline } }) }), code('ADDRESS_REQUEST_REJECTED'));
});

test('submission confirms only explicit OK, rejects ERROR, treats other responses as uncertain', async () => {
  for (const [response, outcome] of [[{ ok: true, data: { status: 'OK' } }, 'confirmed'], [{ ok: true, data: { status: 'ERROR' } }, 'rejected'],
    [{ ok: false, status: 302 }, 'unknown'], [{ ok: true, data: {} }, 'unknown'], [{ ok: true, data: null }, 'unknown']]) {
    let calls = 0;
    assert.equal(await submitAddressRequest(data, 'alice@example.com', { get: async (url, options) => {
      calls++; assert.equal(options.disableRedirects, true);
      assert.equal(new URL(url).searchParams.get('address'), 'alice@example.com');
      return response;
    } }), outcome);
    assert.equal(calls, 1);
  }
  assert.equal(await submitAddressRequest(data, 'alice@example.com', { get: async () => { throw new Error('CORS'); } }), 'unknown');
});

test('clipboard classification is local, neutral for LNURLs, and independent of the active wallet', () => {
  for (const wallet of ['spark', 'arkade', 'nwc', 'lnbits', null]) {
    assert.equal(classifyDestination(inline, wallet), 'address_request');
    assert.equal(classifyDestination(inline + '&lightning=lnbc1unrelated', wallet), 'address_request');
    assert.equal(isSuggestibleDestination(encoded(inline), wallet), true);
    assert.equal(offerLabelKey(inline, wallet), 'Copied address request');
    assert.equal(offerActionKey(inline, wallet), 'Review');
  }
  assert.equal(offerActionKey(encoded('https://example.com/lnurl'), 'spark'), 'Open');
  assert.equal(offerLabelKey(encoded('https://example.com/lnurl'), 'spark'), 'Copied link');
});
