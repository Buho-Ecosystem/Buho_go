/**
 * usePayContact: the hand-over of a payment to the wallet page, including what
 * the contact chat adds to it (the paying wallet, a context string, a request's
 * invoice as the destination).
 *
 * Run directly with Node:
 *   node --test src/composables/__tests__/usePayContact.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as payAgain from '../../utils/payAgain.js';

// The composable imports the address book store through a path Node cannot
// resolve (no extension); compile it the way the repo's other page specs do.
function load(store) {
  const source = readFileSync(new URL('../usePayContact.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs' });
  const module = { exports: {} };
  const modules = { '../utils/payAgain.js': payAgain };
  new Function('require', 'module', 'exports', code)((name) => modules[name] || { useAddressBookStore: () => store }, module, module.exports);
  return module.exports.usePayContact;
}

function harness(contactOverrides = {}) {
  const pushed = [];
  const notices = [];
  const store = {
    isEntryPayable: (entry) => Boolean(entry.address),
    updateLastUsed: async () => {},
    refreshContact: async () => {},
  };
  const ctx = {
    $q: { notify: (notice) => notices.push(notice) },
    $t: (key) => key,
    $router: { push: (value) => pushed.push(value) },
  };
  const contact = { id: 'c1', name: 'Bob', source: 'manual', address: 'bob@example.com', addressType: 'lightning', ...contactOverrides };
  return { pay: load(store)(ctx), pushed, notices, contact };
}

test('payContact: the plain hand-over is unchanged', () => {
  const { pay, pushed, contact } = harness();
  pay.payContact(contact);
  assert.deepEqual(pushed, [{
    path: '/wallet',
    query: { action: 'pay_contact', address: 'bob@example.com', addressType: 'lightning', contactName: 'Bob' },
  }]);
});

test('payContact: a chosen wallet and a context ride along, empty ones do not', () => {
  const { pay, pushed, contact } = harness();
  pay.payContact(contact, { walletId: 'lnb', context: 'chat:abc' });
  pay.payContact(contact, { walletId: '', context: undefined });
  assert.deepEqual(pushed[0].query, {
    action: 'pay_contact', address: 'bob@example.com', addressType: 'lightning', contactName: 'Bob', walletId: 'lnb', context: 'chat:abc',
  });
  assert.equal('walletId' in pushed[1].query, false);
  assert.equal('context' in pushed[1].query, false);
});

test('payContact: an identity-only contact still stops with the explanation', () => {
  const { pay, pushed, notices, contact } = harness({ source: 'nostr', address: '' });
  pay.payContact(contact, { walletId: 'lnb', context: 'chat:abc' });
  assert.deepEqual(pushed, []);
  assert.equal(notices[0].message, 'No Lightning address yet');
});

test('payInvoice: a request\'s invoice is the destination, with the wallet and context', () => {
  const { pay, pushed } = harness();
  pay.payInvoice({ bolt11: '  lnbc1invoice  ', name: 'Anna' }, { walletId: 'biz', context: 'chat:abc:def' });
  assert.deepEqual(pushed, [{
    path: '/wallet',
    query: { action: 'pay_contact', address: 'lnbc1invoice', addressType: 'invoice', contactName: 'Anna', walletId: 'biz', context: 'chat:abc:def' },
  }]);
});

test('payInvoice: names the contact for the history link, only as a non-empty string', () => {
  const { pay, pushed } = harness();
  pay.payInvoice({ bolt11: 'lnbc1x' }, { contactId: 'c1' });
  pay.payInvoice({ bolt11: 'lnbc1x' }, { contactId: '' });
  assert.equal(pushed[0].query.contactId, 'c1');
  assert.equal('contactId' in pushed[1].query, false);
});

test('payInvoice: needs no contact address and ignores an empty invoice', () => {
  const { pay, pushed } = harness();
  pay.payInvoice({ bolt11: 'lnbc1x' });
  pay.payInvoice({ bolt11: '   ' });
  pay.payInvoice({});
  pay.payInvoice();
  assert.equal(pushed.length, 1);
  assert.equal('contactName' in pushed[0].query, false);
});

test('payContact: a prefilled amount and note ride along as query parameters, invalid ones do not', () => {
  const { pay, pushed, contact } = harness();
  pay.payContact(contact, { amountSats: 25000, note: 'Pizza' });
  pay.payContact(contact, { amountSats: -5, note: '' });
  assert.equal(pushed[0].query.prefillAmount, '25000');
  assert.equal(pushed[0].query.prefillNote, 'Pizza');
  assert.equal('prefillAmount' in pushed[1].query, false);
  assert.equal('prefillNote' in pushed[1].query, false);
});

test('payAddress: pays an address that is no saved contact, with wallet, context and prefill', () => {
  const { pay, pushed } = harness();
  pay.payAddress({ address: ' anna@x.org ', name: 'Anna' }, { walletId: 'lnb', context: 'chat:abc', amountSats: 100, note: 'Hi' });
  pay.payAddress({ address: '  ' });
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0], {
    path: '/wallet',
    query: {
      action: 'pay_contact', address: 'anna@x.org', addressType: 'lightning', contactName: 'Anna',
      walletId: 'lnb', context: 'chat:abc', prefillAmount: '100', prefillNote: 'Hi',
    },
  });
});

test('payAddress: Pay again carries the recipient currency amount and always ends on the slide', () => {
  const { pay, pushed } = harness();
  pay.payAddress({ address: 'shop@example.com' }, { amountSats: 15000, payout: { code: 'KES', amount: 1645 }, repeat: true });
  assert.deepEqual(pushed[0].query, {
    action: 'pay_contact', address: 'shop@example.com', addressType: 'lightning',
    prefillAmount: '15000', prefillPayout: 'KES:1645', repeat: '1',
  });
  // Anything unsound is left out rather than passed on.
  pay.payAddress({ address: 'shop@example.com' }, { payout: { code: 'kes', amount: 5 }, repeat: 'yes' });
  pay.payAddress({ address: 'shop@example.com' }, { payout: { code: 'KES', amount: 0 } });
  for (const { query } of pushed.slice(1)) {
    assert.equal('prefillPayout' in query, false);
    assert.equal('repeat' in query, false);
  }
});
