import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidUsername, suggestUsername, splitAddress, extensionsUrl, payLinksStatusOf } from '../lnbitsAddress.js';

test('usernames follow the LNbits rule', () => {
  for (const ok of ['shop', 'shop.till', 'tips_2', 'a-b', 'x'.repeat(32)]) assert.equal(isValidUsername(ok), true, ok);
  for (const bad of ['', 'Shop', 'shop till', 'shop@x', 'ü', 'x'.repeat(33), null]) assert.equal(isValidUsername(bad), false, String(bad));
});

test('a suggestion comes from the wallet name and is always valid or empty', () => {
  assert.equal(suggestUsername('Shop till'), 'shoptill');
  assert.equal(suggestUsername('Café 1!'), 'caf1');
  assert.equal(suggestUsername(''), '');
  assert.equal(suggestUsername('A'.repeat(40)).length, 32);
  assert.equal(isValidUsername(suggestUsername('My LNbits Wallet')), true);
});

test('addresses split into name and domain, also with a custom domain', () => {
  assert.deepEqual(splitAddress('shop@legend.lnbits.com'), { user: 'shop', domain: 'legend.lnbits.com' });
  assert.deepEqual(splitAddress('tips@pay.example.org', 'legend.lnbits.com'), { user: 'tips', domain: 'pay.example.org' });
  assert.deepEqual(splitAddress('shop', 'legend.lnbits.com'), { user: 'shop', domain: 'legend.lnbits.com' });
});

test('the Extensions page lives under the server root', () => {
  assert.equal(extensionsUrl('https://legend.lnbits.com'), 'https://legend.lnbits.com/extensions');
  assert.equal(extensionsUrl('https://legend.lnbits.com/'), 'https://legend.lnbits.com/extensions');
});

test('only 404 and 403 mean Pay Links is off; anything else is unknown', () => {
  assert.equal(payLinksStatusOf({ status: 404 }), 'off', 'not installed');
  assert.equal(payLinksStatusOf({ status: 403 }), 'off', 'not enabled for this account');
  for (const error of [{ status: 401 }, { status: 500 }, { status: 502 }, { isNetworkError: true }, new TypeError('Failed to fetch'), null]) {
    assert.equal(payLinksStatusOf(error), 'unknown', JSON.stringify(error));
  }
});
