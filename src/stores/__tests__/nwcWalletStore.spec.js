/**
 * The wallet store's NWC rules: whether a wallet answered is recorded
 * apart from whether its connection is set up, and a spending limit whose
 * period has ended no longer holds a payment back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from './sparkWalletHarness.js';
import * as internalTransferDetails from '../../utils/internalTransferDetails.js';
import * as userErrors from '../../utils/userErrors.js';

const URL_A = `nostr+walletconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const timeout = () => Object.assign(new Error('reply timeout: event abc'), { code: 'INTERNAL' });

function nwcWallet(store, client) {
  store.wallets = [{ id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: URL_A, metadata: { methods: ['pay_invoice', 'get_info', 'get_budget'] } }];
  store.connectionStates.hub = { connected: true, nwcInstance: { client }, error: null };
  store._schedulePersist = () => {};
}

test('a wallet that misses one reply stays connected; its status says it was silent', async () => {
  const { store } = createHarness();
  nwcWallet(store, { getInfo: async () => { throw timeout(); } });
  assert.equal(await store.refreshNwcDetails('hub'), 'no-answer');
  assert.equal(store.nwcStatus.hub, 'no-answer');
  assert.equal(store.connectionStates.hub.connected, true, 'still offered for payments, which wait longer');
  assert.equal(store.connectionStates.hub.error, null);
});

test('an answer refreshes the name, the grants and the limit', async () => {
  const { store } = createHarness();
  nwcWallet(store, {
    getInfo: async () => ({ alias: 'Alby Hub', pubkey: '02ab', methods: ['pay_invoice', 'make_invoice', 'get_budget'] }),
    getBudget: async () => ({ total_budget: 10_000_000, used_budget: 4_000_000, renews_at: 4_000_000_000 }),
  });
  assert.equal(await store.refreshNwcDetails('hub'), 'answering');
  assert.equal(store.wallets[0].metadata.alias, 'Alby Hub');
  assert.deepEqual(store.wallets[0].metadata.methods, ['pay_invoice', 'make_invoice', 'get_budget']);
  assert.equal(store.nwcLimitFor('hub').remainingSats, 6000);
});

test('a limit whose period has ended no longer holds a payment back', () => {
  const { store } = createHarness();
  store.nwcLimits.hub = { totalSats: 10_000, usedSats: 10_000, remainingSats: 0, renewsAt: Date.now() - 1000, period: 'monthly' };
  assert.equal(store.nwcLimitFor('hub'), null);
  store.nwcLimits.hub = { ...store.nwcLimits.hub, renewsAt: Date.now() + 60_000 };
  assert.equal(store.nwcLimitFor('hub').remainingSats, 0);
  store.nwcLimits.hub = { ...store.nwcLimits.hub, renewsAt: null };
  assert.equal(store.nwcLimitFor('hub').remainingSats, 0, 'a limit that never renews keeps holding');
});

// ── Receiving into an NWC wallet (#392) ───────────────────────────────────

const RECEIVE_URL = `nostr+walletconnect://${'b2'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;

/** An NWC wallet whose connection lives where the store keeps NWC: connectionStates. */
function receivingStore({ methods = ['pay_invoice', 'make_invoice'] } = {}) {
  const harness = createHarness({ deps: {
    '../utils/internalTransferDetails.js': internalTransferDetails,
    '../utils/userErrors': userErrors,
    './transactionMetadata': { useTransactionMetadataStore: () => ({
      async setLabelForTransaction() {}, async setSourceForTransaction() {}, async enqueuePendingContactLink() {},
    }) },
  } });
  const { store } = harness;
  const asked = [];
  const nwc = {
    async makeInvoice(args) { asked.push(args); return { paymentRequest: 'lnbc210n1nwc' }; },
  };
  store.wallets = [
    { id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: RECEIVE_URL, metadata: { methods } },
    { id: 'kitty', type: 'lnbits', name: 'Kitty', metadata: {} },
  ];
  store.connectionStates.hub = { connected: true, nwcInstance: nwc, error: null };
  assert.equal(store.providers.hub, undefined, 'NWC wallets never get a `providers` entry');
  return { store, asked, setBalance: harness.setBalance };
}

test('the Social Bucket can ask an NWC wallet for an invoice, with its memo', async () => {
  const { store, asked } = receivingStore();
  assert.equal(await store.createInvoiceOnWallet('hub', 21, 'Social Bucket'), 'lnbc210n1nwc');
  // The SDK reads the memo from `defaultMemo` only.
  assert.deepEqual(asked, [{ amount: 21, defaultMemo: 'Social Bucket' }]);
});

test('a connection without make_invoice is refused before the wallet is asked', async () => {
  const { store, asked } = receivingStore({ methods: ['pay_invoice'] });
  await assert.rejects(store.createInvoiceOnWallet('hub', 21, 'Social Bucket'), (e) => e.code === 'NWC_RECEIVE_NOT_ALLOWED');
  assert.equal(asked.length, 0);
});

test('an internal transfer into an NWC wallet takes the same path', async () => {
  const { store, asked, setBalance } = receivingStore();
  const paid = [];
  const lnbits = { payInvoice: async ({ invoice }) => { paid.push(invoice); return { payment_hash: 'h' }; } };
  setBalance('kitty', 5000);
  store.ensureWalletConnectedForTransfer = async (id) => (id === 'kitty' ? lnbits : store.connectionStates[id].nwcInstance);
  store.refreshWalletData = async () => {};
  const result = await store.transferBetweenWallets('kitty', 'hub', 21, 'Rent');
  assert.equal(result.success, true);
  assert.deepEqual(asked, [{ amount: 21, defaultMemo: 'Rent' }]);
  assert.deepEqual(paid, ['lnbc210n1nwc']);
});

test('wallet lists say what each wallet may do: receive-only and send-only connections', () => {
  const { store } = createHarness();
  store.wallets = [
    { id: 'spark', type: 'spark', name: 'Spark', metadata: {} },
    { id: 'tips', type: 'nwc', name: 'Tips', nwcUrl: RECEIVE_URL, metadata: { methods: ['make_invoice', 'get_balance'] } },
    { id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: RECEIVE_URL, metadata: { methods: ['pay_invoice', 'get_balance'] } },
    { id: 'old', type: 'nwc', name: 'Old', nwcUrl: RECEIVE_URL, metadata: {} },
    { id: 'ark', type: 'arkade', name: 'Ark', metadata: {} },
  ];
  for (const w of store.wallets) store.connectionStates[w.id] = { connected: true };
  store.balanceStates = Object.fromEntries(store.wallets.map((w) => [w.id, { value: 500 }]));
  const flags = Object.fromEntries(store.getTransferableWallets().map((w) => [w.id, [w.canSend, w.canReceive, w.receiveOnly]]));
  assert.deepEqual(flags, {
    spark: [true, true, false],
    tips: [false, true, true],   // may not pay: never a source
    hub: [true, false, false],   // may not create invoices: never a destination
    old: [true, true, false],    // saved before grants were stored: as before
  }, 'Arkade stays out while its Lightning is paused');
});
