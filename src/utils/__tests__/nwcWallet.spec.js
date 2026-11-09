import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nip47Methods, nwcCapabilities, capabilitiesOf, suggestedWalletName, findSameWallet, spendingLimitFrom, relayHost, walletKeyOf,
  nwcPaymentHash, nwcTransactionRow,
} from '../nwcWallet.js';
import { Invoice } from '@getalby/lightning-tools';
import { createReceiptLedger } from '../../services/paymentReceipts.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

const INVOICE = profileInvoiceFixture(21, 1_800_000_000_000);
const INVOICE_HASH = new Invoice({ pr: INVOICE }).paymentHash;
/** sha256 of a preimage's hex TEXT instead of its bytes: a wrong hash a wallet may report. */
const WRONG_HASH = 'c386d8e8d07342f2e39e189c8e6c57bb205bb373fe4e3a6f69404a8bb767b417';

test('both method vocabularies read the same; unknown names are kept, empties dropped', () => {
  assert.deepEqual(nip47Methods(['sendPayment', 'makeInvoice', 'getBalance', 'pay_invoice', '', null, 'get_budget']),
    ['pay_invoice', 'make_invoice', 'get_balance', 'get_budget']);
});

test('a connection can do exactly what its wallet granted', () => {
  const receiveOnly = nwcCapabilities(['make_invoice', 'lookup_invoice', 'get_info']);
  assert.deepEqual(receiveOnly, { known: true, send: false, receive: true, balance: false, history: false, lookup: true, limit: false });
  const full = nwcCapabilities(['pay_invoice', 'make_invoice', 'get_balance', 'list_transactions', 'get_budget']);
  assert.deepEqual(full, { known: true, send: true, receive: true, balance: true, history: true, lookup: false, limit: true });
});

test('a wallet saved before methods were stored keeps working', () => {
  const legacy = nwcCapabilities([]);
  assert.equal(legacy.known, false);
  assert.equal(legacy.send && legacy.receive && legacy.balance, true);
  assert.equal(capabilitiesOf({ type: 'nwc', metadata: {} }).send, true);
  assert.equal(capabilitiesOf({ metadata: { methods: ['make_invoice'] } }).send, false, 'untyped wallets are NWC');
  assert.equal(capabilitiesOf({ type: 'spark' }).send, true, 'other wallet types can do all');
});

test('a wallet names itself, unless it says nothing useful', () => {
  assert.equal(suggestedWalletName({ alias: 'Alby Hub' }), 'Alby Hub');
  assert.equal(suggestedWalletName({ alias: 'N/A', lud16: 'shop@blink.sv' }), 'shop');
  assert.equal(suggestedWalletName({ alias: 'Unknown' }), 'Lightning wallet');
  assert.equal(suggestedWalletName({ alias: '  ' }, ''), '');
  assert.equal(suggestedWalletName({ alias: 'x'.repeat(60) }).length, 40);
});

const NODE = `02${'ab'.repeat(32)}`;

test('a wallet key is a real key; placeholders are none', () => {
  assert.equal(walletKeyOf(NODE.toUpperCase()), NODE);
  assert.equal(walletKeyOf('cd'.repeat(32)), 'cd'.repeat(32), 'x-only keys count');
  for (const placeholder of ['N/A', 'n/a', 'Unknown', '', null, undefined, '02abc', `04${'ab'.repeat(32)}`]) {
    assert.equal(walletKeyOf(placeholder), '', String(placeholder));
  }
});

test('two wallets that both answer a placeholder key are not the same wallet', () => {
  const wallets = [{ id: 'first', type: 'nwc', metadata: { pubkey: 'N/A', lud16: null, walletPubkey: 'c1' } }];
  assert.equal(findSameWallet(wallets, { nodePubkey: 'N/A', connectionPubkey: 'c2' }), null);
  assert.equal(findSameWallet(wallets, { nodePubkey: '', connectionPubkey: 'c2' }), null);
  assert.equal(findSameWallet(wallets, { nodePubkey: 'N/A', connectionPubkey: 'c1' })?.id, 'first', 'the same connection still is');
});

test('the same wallet is found by its key or its address, not by the connection text', () => {
  const wallets = [
    { id: 'a', type: 'nwc', metadata: { pubkey: NODE, lud16: 'shop@getalby.com', walletPubkey: 'c1' } },
    { id: 'b', type: 'spark', metadata: { lud16: 'tips@getalby.com' } },
  ];
  assert.equal(findSameWallet(wallets, { nodePubkey: NODE.toUpperCase() })?.id, 'a');
  assert.equal(findSameWallet(wallets, { lud16: 'Shop@GetAlby.com' })?.id, 'a');
  assert.equal(findSameWallet(wallets, { connectionPubkey: 'c1' })?.id, 'a');
  assert.equal(findSameWallet(wallets, { lud16: 'tips@getalby.com' }), null, 'only NWC wallets compare');
  assert.equal(findSameWallet(wallets, {}), null);
});

test('a spending limit is read in sats; an empty answer means no limit, not zero', () => {
  assert.equal(spendingLimitFrom({}), null);
  assert.equal(spendingLimitFrom(null), null);
  assert.deepEqual(spendingLimitFrom({ total_budget: 100_000_000, used_budget: 12_400_500, renews_at: 1_800_000_000, renewal_period: 'monthly' }),
    { totalSats: 100000, usedSats: 12401, remainingSats: 87599, renewsAt: 1_800_000_000_000, period: 'monthly' });
  assert.equal(spendingLimitFrom({ total_budget: 5000, used_budget: 9000 }).remainingSats, 0, 'never below zero');
});

test('the relay shows as its host', () => {
  assert.equal(relayHost('nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=x'), 'relay.getalby.com');
  assert.equal(relayHost('nostr+walletconnect://abc?secret=x'), '');
});

test('the SDK\'s stand-in answer for a failed get_info says nothing about the grants', () => {
  // Earlier versions saved WebLN getInfo() as is; on a failed get_info that
  // is exactly ['sendPayment']. Read as unknown: everything assumed, as before.
  const legacy = nwcCapabilities(['sendPayment']);
  assert.deepEqual([legacy.known, legacy.send, legacy.receive, legacy.balance], [false, true, true, true]);
  // A real answer in either vocabulary is read as given.
  assert.deepEqual(nwcCapabilities(['pay_invoice']).receive, false);
  assert.deepEqual(nwcCapabilities(['sendPayment', 'getBalance']).receive, false);
  assert.equal(capabilitiesOf({ type: 'nwc', metadata: { methods: ['sendPayment'] } }).receive, true);
});

test('a record\'s payment hash is the one its invoice names', () => {
  assert.equal(nwcPaymentHash({ invoice: INVOICE, payment_hash: WRONG_HASH }), INVOICE_HASH, 'the invoice decides');
  assert.equal(nwcPaymentHash({ invoice: 'not-a-bolt11', payment_hash: 'AB'.repeat(32) }), 'ab'.repeat(32), 'without one, the record');
  assert.equal(nwcPaymentHash({ paymentHash: 'cd'.repeat(32) }), 'cd'.repeat(32));
  assert.equal(nwcPaymentHash({ payment_hash: 'false' }), null, 'a field that is not a hash is none');
  assert.equal(nwcPaymentHash({}), null);
});

test('a history row with a wrongly computed hash is the payment Receive already showed', () => {
  const ledger = createReceiptLedger({ storage: { getItem: () => null, setItem() {}, removeItem() {} }, now: () => 1_800_000_100_000 });
  ledger.prime('w1', []);
  ledger.markSeen('w1', INVOICE_HASH); // the Receive sheet confirmed it under the invoice's hash
  const row = nwcTransactionRow({ type: 'incoming', invoice: INVOICE, payment_hash: WRONG_HASH, amount: 21, settled_at: 1_800_000_050 });
  assert.deepEqual([row.id, row.paymentHash, row.payment_hash], [INVOICE_HASH, INVOICE_HASH, INVOICE_HASH]);
  assert.equal(nwcTransactionRow({ type: 'incoming', payment_hash: 'odd-id', amount: 1 }).id, 'odd-id', 'a row keeps an id that is not a hash');
  assert.equal(ledger.ingest('w1', row, { origin: 'catchup' }), null, 'never announced a second time');
});
