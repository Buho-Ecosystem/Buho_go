import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFastWithdrawRequest, withdrawInfo } from '../lnurlWithdraw.js';

const metadata = { tag: 'withdrawRequest', k1: 'Opaque-Token+KeepCase', callback: 'https://cash.example/Callback?session=A%2BB',
  minWithdrawable: 1000, maxWithdrawable: 500000, defaultDescription: 'Voucher for Alice@Example.com · Danke 🎁' };
const endpoint = (changes = {}) => `https://cash.example/withdraw?${new URLSearchParams({ ...metadata, ...changes })}`;

test('complete inline parameters preserve opaque values and match fetched metadata', () => {
  const parsed = parseFastWithdrawRequest(endpoint());
  assert.deepEqual(parsed, metadata);
  assert.deepEqual(withdrawInfo(parsed), withdrawInfo(metadata));
});

test('each missing or duplicated required field falls back to the GET', () => {
  for (const field of Object.keys(metadata)) {
    const url = new URL(endpoint()); url.searchParams.delete(field);
    assert.equal(parseFastWithdrawRequest(url.href), null, field);
    assert.equal(parseFastWithdrawRequest(`${endpoint()}&${field}=duplicate`), null, field);
  }
});

test('amounts must be safe, non-negative integer millisatoshis in ascending order', () => {
  for (const field of ['minWithdrawable', 'maxWithdrawable']) {
    for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e3', '0x1000', '1.5', '1000x', '9007199254740992']) {
      assert.equal(parseFastWithdrawRequest(endpoint({ [field]: value })), null, `${field}=${value}`);
    }
  }
  assert.equal(parseFastWithdrawRequest(endpoint({ minWithdrawable: 10000, maxWithdrawable: 1000 })), null);
});

test('empty descriptions and arbitrary non-hex challenges are valid', () => {
  assert.equal(parseFastWithdrawRequest(endpoint({ defaultDescription: '' })).defaultDescription, '');
  assert.equal(parseFastWithdrawRequest(endpoint({ k1: 'Voucher:AbC/123+' })).k1, 'Voucher:AbC/123+');
  assert.equal(parseFastWithdrawRequest(endpoint({ k1: '' })), null);
});

test('pay, login, address sharing, and malformed endpoints do not use the fast path', () => {
  for (const tag of ['payRequest', 'login', 'addressRequest', 'WithdrawRequest', '']) {
    assert.equal(parseFastWithdrawRequest(endpoint({ tag })), null);
  }
  for (const value of [null, undefined, '', {}, 'not a URL', endpoint().replace('https:', 'http:')]) {
    assert.equal(parseFastWithdrawRequest(value), null);
  }
});

test('unsafe callback URLs fall back; HTTPS and onion HTTP are accepted', () => {
  for (const callback of ['', '/relative', 'javascript:alert(1)', 'http://cash.example/', 'https://user:pass@cash.example/', 'https://cash.example/#fragment']) {
    assert.equal(parseFastWithdrawRequest(endpoint({ callback })), null, callback);
  }
  const callback = `http://${'a'.repeat(56)}.onion/withdraw`;
  assert.equal(parseFastWithdrawRequest(endpoint({ callback })).callback, callback);
});

test('valid inline PIN threshold is retained; malformed thresholds require JSON', () => {
  assert.equal(withdrawInfo(parseFastWithdrawRequest(endpoint({ pinLimit: '100000' }))).pinLimit, 100000);
  for (const pinLimit of ['', '0', '-1', '1e3', '1.5', 'Infinity', '9007199254740992']) {
    assert.equal(parseFastWithdrawRequest(endpoint({ pinLimit })), null);
  }
  assert.equal(parseFastWithdrawRequest(endpoint({ pinLimit: 1000 }) + '&pinLimit=2000'), null);
  assert.equal(withdrawInfo(metadata).pinLimit, null);
});

test('zero balances stay zero and cannot become a large default withdrawal', () => {
  const info = withdrawInfo(parseFastWithdrawRequest(endpoint({ minWithdrawable: 0, maxWithdrawable: 0 })));
  assert.equal(info.maxWithdrawable, 0); assert.equal(info.fixedAmountSats, 0);
  assert.ok(info.minSats > info.maxSats);
});

test('whole-satoshi bounds round inward, including zero minimum and fractional fixed amounts', () => {
  assert.equal(withdrawInfo({ ...metadata, minWithdrawable: 0 }).minSats, 1);
  const range = withdrawInfo({ ...metadata, minWithdrawable: 1500, maxWithdrawable: 3500 });
  assert.equal(range.minSats, 2); assert.equal(range.maxSats, 3);
  const fixed = withdrawInfo({ ...metadata, minWithdrawable: 1500, maxWithdrawable: 1500 });
  assert.equal(fixed.isFixedAmount, true); assert.ok(fixed.minSats > fixed.maxSats);
  const single = withdrawInfo({ ...metadata, minWithdrawable: 1500, maxWithdrawable: 2500 });
  assert.equal(single.isFixedAmount, true); assert.equal(single.fixedAmountSats, 2);
});
