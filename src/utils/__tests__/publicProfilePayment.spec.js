import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceAppIntent, invoiceIsUsable, profileAmountSats } from '../publicProfilePayment.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

test('amount entry rejects partial, fractional, exponent and unsafe sats', () => {
  for (const input of ['', '0', '-1', '1.5', '1,5', '1e3', '1oops', '1 000', 'Infinity', '9007199254741']) {
    assert.equal(profileAmountSats(input), 0, input);
  }
  assert.equal(profileAmountSats(' 1000 '), 1000);
  assert.equal(profileAmountSats('001'), 1);
});

test('fiat input accepts decimal comma and converts to whole sats', () => {
  for (const input of ['1.25', '1,25']) {
    assert.equal(profileAmountSats(input, { fiat: true, rate: 100000 }), 1250);
  }
  assert.equal(profileAmountSats('1.25', { fiat: true, rate: 99999 }), 1250);
  for (const rate of [0, -1, NaN, Infinity]) assert.equal(profileAmountSats('1', { fiat: true, rate }), 0);
  assert.equal(profileAmountSats('1.234', { fiat: true, rate: 100000 }), 0);
});

test('expired or absent invoices cannot be handed off', () => {
  assert.equal(invoiceIsUsable(null, 100), false);
  assert.equal(invoiceIsUsable({ invoice: 'lnbc', expiresAt: 100 }, 100), false);
  assert.equal(invoiceIsUsable({ invoice: 'lnbc', expiresAt: 101 }, 100), true);
  assert.equal(invoiceIsUsable({ invoice: '', expiresAt: Infinity }, 100), false);
});

test('Android intent resolves to the exact Lightning invoice in BuhoGO', () => {
  const invoice = profileInvoiceFixture();
  const intent = invoiceAppIntent(invoice);
  assert.equal(intent.split('#')[0].replace(/^intent:/, 'lightning:'), `lightning:${invoice}`);
  assert.match(intent, /;scheme=lightning;package=mybuho\.buhogo;/);
  assert.ok(intent.endsWith('S.browser_fallback_url=https%3A%2F%2Fhome.mybuho.de%2Fbuhogo;end'));
  for (const value of ['', 'someone@example.com', 'lnbc1abc#Intent;package=evil;end', 'https://example.com']) {
    assert.equal(invoiceAppIntent(value), '');
  }
});
