/**
 * The wallet store's side of incoming payments for LNbits, NWC and Arkade:
 * a balance rise only asks the wallet watch to look, the user's own
 * transfers are marked by hash, the watch hears about wallets coming and
 * going, and the LNbits invoice key is kept with its wallet.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as lightningTools from '@getalby/lightning-tools';
import * as breezPayments from '../../utils/breezPayments.js';
import { createHarness, tick } from './sparkWalletHarness.js';

// A regtest invoice for decoding only (scripts/fixtures/profileInvoice.mjs).
const BOLT11 = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
const HASH = new lightningTools.Invoice({ pr: BOLT11 }).paymentHash;

/** A wallet watch stand-in that records what the store tells it. */
function watched({ reads = true, deps = {} } = {}) {
  const calls = [];
  const harness = createHarness({
    deps: {
      '@getalby/lightning-tools': lightningTools,
      '../utils/breezPayments.js': breezPayments,
      './notifications': { useNotificationsStore: () => ({ canNotifyPayments: false }) },
      '../services/walletWatch.js': {
        walletWatch: () => ({
          hint: (id) => { calls.push(['hint', id]); return reads; },
          sync: () => calls.push(['sync']),
          forget: (id) => calls.push(['forget', id]),
        }),
        startWalletWatch: () => null,
      },
      '../services/paymentReceiptsApp.js': { forgetWalletReceipts: (id) => calls.push(['receipts', id]) },
      ...deps,
    },
  });
  harness.store._schedulePersist = () => calls.push(['persist']);
  return { ...harness, calls };
}

const lnbitsWallet = (id, extra = {}) => ({ id, type: 'lnbits', name: id, connectionData: { serverUrl: 'https://pay.example', walletId: `lnbits-${id}`, adminKey: 'a'.repeat(32) }, metadata: {}, ...extra });

test('a balance rise on a wallet the watch reads only asks it to look', () => {
  const { store, calls } = watched();
  const wallet = lnbitsWallet('k');
  store.wallets = [wallet];
  store.noticeIncomingPayment(wallet, 1000); // the first reading only seeds
  store.noticeIncomingPayment(wallet, 1500);
  assert.deepEqual(calls.filter(([c]) => c === 'hint'), [['hint', 'k']]);
  assert.equal(store.lastReceipt, null, 'announced by payment, by the watch, not from the rise');
});

test('a wallet the watch cannot read is still announced from its rise', () => {
  const { store } = watched({ reads: false });
  const wallet = { id: 'n', type: 'nwc', name: 'Tips', metadata: { methods: ['get_balance'] } };
  store.wallets = [wallet];
  store.noticeIncomingPayment(wallet, 1000);
  store.noticeIncomingPayment(wallet, 1210);
  assert.deepEqual([store.lastReceipt?.walletId, store.lastReceipt?.amountSats], ['n', 210]);
});

test('a transfer into an LNbits wallet is the user\'s own move: its receipt is marked by hash', async () => {
  const { store, setBalance } = watched();
  store.wallets = [lnbitsWallet('from'), lnbitsWallet('to')];
  setBalance('from', 10_000);
  store.ensureWalletConnectedForTransfer = async () => ({ payInvoice: async () => ({ status: 'completed', preimage: 'p'.repeat(64) }) });
  store.createInvoiceOnWallet = async () => BOLT11;
  await store.transferBetweenWallets('from', 'to', 4519).catch(() => {});
  assert.equal(store.isInternalTransferReceipt('to', { paymentHash: HASH }), true);
  assert.equal(store.isInternalTransferReceipt('to', { paymentHash: HASH }), false, 'once');
});

test('the watch hears about wallets coming and going', async () => {
  const { store, calls } = watched();
  const wallet = lnbitsWallet('gone');
  store.wallets = [wallet];
  store._noteWalletsChanged();
  assert.ok(calls.some(([c]) => c === 'sync'));
  await store._dropWalletEntry(wallet);
  assert.ok(calls.some(([c, id]) => c === 'forget' && id === 'gone'), 'its live channel closes');
  assert.ok(calls.some(([c, id]) => c === 'receipts' && id === 'gone'), 'its receipt history goes with it');
});

test('the invoice key LNbits returns is kept with the wallet and handed back on the next connect', async () => {
  const built = [];
  class FakeLNbits {
    constructor(walletId, data) { this.data = data; this.isConnected = false; built.push(this); }
    async connect() { this.isConnected = true; }
    async getBalance() { return { balance: 5 }; }
    async getInfo() { return { alias: 'x' }; }
  }
  const { store, calls } = watched({ deps: { '../providers/LNBitsWalletProvider': { LNBitsWalletProvider: FakeLNbits } } });
  const wallet = lnbitsWallet('k');
  store.wallets = [wallet];
  await store.connectLNBitsWallet('k');
  assert.equal(built[0].data.invoiceKey, undefined);
  built[0]._onInvoiceKey('b'.repeat(32));
  assert.equal(wallet.connectionData.invoiceKey, 'b'.repeat(32));
  assert.equal(wallet.connectionData.adminKey, 'a'.repeat(32), 'next to the admin key, which stays');
  assert.ok(calls.some(([c]) => c === 'persist'));
  await store.connectLNBitsWallet('k');
  assert.equal(built[1].data.invoiceKey, 'b'.repeat(32), 'never fetched twice');
  await tick();
});
