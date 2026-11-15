/** Contextual payment handoff: opens before any network work or navigation. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as payAgain from '../../utils/payAgain.js';

function load(store, flow) {
  const source = readFileSync(new URL('../usePayContact.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs' });
  const module = { exports: {} };
  const modules = {
    '../utils/payAgain.js': payAgain,
    '../stores/addressBook': { useAddressBookStore: () => store },
    '../stores/paymentFlow.js': { usePaymentFlowStore: () => flow },
  };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, module, module.exports);
  return module.exports.usePayContact;
}

function harness(contactOverrides = {}) {
  const begun = [], pushed = [], notices = [], used = [];
  const flow = { accepts: true, begin(input) { if (!this.accepts) return false; begun.push(input); return begun.length; } };
  const store = {
    isEntryPayable: (entry) => Boolean(entry.address),
    updateLastUsed: async id => { used.push(id); },
    refreshContact: async () => {},
  };
  const ctx = { $q: { notify: notice => notices.push(notice) }, $t: key => key, $router: { push: value => pushed.push(value) } };
  const contact = { id: 'c1', name: 'Bob', source: 'manual', address: 'bob@example.com', addressType: 'lightning', ...contactOverrides };
  return { pay: load(store, flow)(ctx), flow, begun, pushed, notices, used, contact };
}

test('contact opens contextual payment synchronously with identity and no Home navigation', () => {
  const { pay, begun, pushed, used, contact } = harness({ nostrProfile: { picture: 'https://example.com/avatar.jpg' } });
  assert.equal(pay.payContact(contact), true);
  assert.deepEqual(begun, [{ address: 'bob@example.com', addressType: 'lightning', name: 'Bob', contactId: 'c1', contact }]);
  assert.deepEqual(pushed, []);
  assert.deepEqual(used, ['c1']);
  assert.equal('walletId' in begun[0], false, 'automatic choice is left to the payment controller');
});

test('explicit wallet and chat context survive handoff; empty options do not select a wallet', () => {
  const { pay, begun, contact } = harness();
  pay.payContact(contact, { walletId: 'lnb', context: 'chat:abc' });
  pay.payContact(contact, { walletId: '', context: undefined });
  assert.equal(begun[0].walletId, 'lnb');
  assert.equal(begun[0].context, 'chat:abc');
  assert.equal('walletId' in begun[1], false);
  assert.equal('context' in begun[1], false);
});

test('identity-only and missing contacts stop with one plain explanation', () => {
  for (const source of ['nostr', 'manual']) {
    const { pay, begun, notices, contact } = harness({ source, address: '' });
    assert.equal(pay.payContact(contact), false);
    assert.deepEqual(begun, []);
    assert.equal(notices[0].message, 'No Lightning address yet');
    assert.equal(pay.payContact(null), false);
  }
});

test('invoice request keeps its destination, explicit wallet, context, note and contact history link', () => {
  const { pay, begun, pushed } = harness();
  pay.payInvoice({ bolt11: '  lnbc1invoice  ', name: 'Anna' }, { walletId: 'biz', context: 'chat:abc:def', contactId: 'c1', note: 'Pizza' });
  assert.deepEqual(begun, [{ address: 'lnbc1invoice', addressType: 'invoice', name: 'Anna', walletId: 'biz', context: 'chat:abc:def', contactId: 'c1', note: 'Pizza' }]);
  assert.deepEqual(pushed, []);
});

test('invoice needs no contact address and ignores empty invoice/options', () => {
  const { pay, begun } = harness();
  pay.payInvoice({ bolt11: 'lnbc1x' }, { contactId: '' });
  pay.payInvoice({ bolt11: '   ' });
  pay.payInvoice({});
  pay.payInvoice();
  assert.equal(begun.length, 1);
  assert.equal('contactId' in begun[0], false);
  assert.equal('walletId' in begun[0], false);
});

test('amount and note are typed prefills; negative, fractional and unsafe amounts are ignored', () => {
  const { pay, begun, contact } = harness();
  pay.payContact(contact, { amountSats: 25000, note: 'Pizza' });
  assert.equal(begun[0].amountSats, 25000);
  assert.equal(begun[0].note, 'Pizza');
  for (const amountSats of [-5, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, '25']) {
    pay.payContact(contact, { amountSats, note: '' });
    assert.equal('amountSats' in begun.at(-1), false);
    assert.equal('note' in begun.at(-1), false);
  }
});

test('unsaved address uses the same contextual handoff and preserves prefills', () => {
  const { pay, begun } = harness();
  pay.payAddress({ address: ' anna@x.org ', name: 'Anna' }, { context: 'chat:abc', amountSats: 100, note: 'Hi' });
  pay.payAddress({ address: '  ' });
  assert.deepEqual(begun, [{ address: 'anna@x.org', addressType: 'lightning', name: 'Anna', context: 'chat:abc', amountSats: 100, note: 'Hi' }]);
});

test('Pay again preserves the explicit past wallet and recipient currency amount', () => {
  const { pay, begun, pushed } = harness();
  pay.payAgain({ address: 'shop@example.com', addressType: 'lightning', amountSats: 15000, payout: { code: 'KES', amount: 1645 } }, { walletId: 'travel', name: 'Shop' });
  assert.deepEqual(begun[0], { address: 'shop@example.com', addressType: 'lightning', name: 'Shop', walletId: 'travel', amountSats: 15000, payout: { code: 'KES', amount: 1645 }, repeat: true });
  assert.deepEqual(pushed, []);
  for (const payout of [{ code: 'kes', amount: 5 }, { code: 'KES', amount: 0 }]) {
    pay.payAddress({ address: 'shop@example.com' }, { payout, repeat: 'yes' });
    assert.equal('payout' in begun.at(-1), false);
    assert.equal('repeat' in begun.at(-1), false);
  }
});

test('deferred preparation hands the resolver over without running it and reports flow rejection', () => {
  const { pay, flow, begun, pushed } = harness();
  let lookups = 0;
  const resolve = async () => { lookups += 1; return { address: 'lnbc1fresh' }; };
  assert.equal(pay.preparePayment({ name: 'Anna', amountSats: 500, fixedAmount: true, resolve }), true);
  assert.equal(begun[0].resolve, resolve);
  assert.equal(begun[0].fixedAmount, true);
  assert.equal(lookups, 0);
  assert.deepEqual(pushed, []);
  flow.accepts = false;
  assert.equal(pay.preparePayment({ resolve }), false);
  assert.equal(begun.length, 1);
});
