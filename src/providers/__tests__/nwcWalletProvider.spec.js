/**
 * NWCWalletProvider holds one connection: the SDK's NostrWebLNProvider and
 * its own NIP-47 client. Notifications ride that client; nothing opens a
 * second relay connection, and disconnecting closes it once.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import * as nwcWallet from '../../utils/nwcWallet.js';
import { profileInvoiceFixture } from '../../../scripts/fixtures/profileInvoice.mjs';

const HASH = 'ab'.repeat(32);

function loadProvider(sdk) {
  const load = (file, deps) => {
    const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { format: 'cjs' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
    return module.exports;
  };
  const base = load('../WalletProvider.js', {});
  const nwcClient = { createNwcProvider: (url) => new sdk.NostrWebLNProvider({ nostrWalletConnectUrl: url }) };
  return load('../NWCWalletProvider.js', { './WalletProvider': base, '../services/nwcClient.js': nwcClient, '../utils/nwcWallet.js': nwcWallet }).NWCWalletProvider;
}

function fakeSdk() {
  const built = { providers: 0, clients: 0, closed: 0 };
  class NWCClient {
    constructor() { built.clients += 1; }
    close() { built.closed += 1; }
    async subscribeNotifications(onNotification) {
      onNotification({ notification_type: 'payment_received', notification: { payment_hash: HASH, amount: 21000, state: 'settled' } });
      return () => {};
    }
  }
  class NostrWebLNProvider {
    constructor() { built.providers += 1; this.client = new NWCClient(); }
    async enable() {}
    close() { this.client.close(); }
  }
  return { built, sdk: { NostrWebLNProvider, NWCClient } };
}

test('connecting opens one client, and notifications use it', async () => {
  const { built, sdk } = fakeSdk();
  const NWCWalletProvider = loadProvider(sdk);
  const provider = new NWCWalletProvider('w1', { nwcUrl: 'nostr+walletconnect://x' });
  await provider.connect();
  assert.deepEqual([built.providers, built.clients], [1, 1]);
  assert.equal(provider.getNWCClient(), provider.getNWCInstance().client);

  const seen = [];
  await provider.subscribeToPaymentNotifications((payment) => seen.push(payment.paymentHash));
  assert.deepEqual(seen, [HASH]);
});

test('disconnecting closes the connection once', async () => {
  const { built, sdk } = fakeSdk();
  const NWCWalletProvider = loadProvider(sdk);
  const provider = new NWCWalletProvider('w1', { nwcUrl: 'nostr+walletconnect://x' });
  await provider.connect();
  await provider.disconnect();
  assert.equal(built.closed, 1);
  assert.equal(provider.getNWCClient(), null);
  assert.equal(provider.isConnected, false);
});

test('an invoice, a paid check and a notification all name the payment by its invoice\'s hash', async () => {
  const invoice = profileInvoiceFixture(21, 1_800_000_000_000);
  const named = nwcWallet.nwcPaymentHash({ invoice });
  const claimed = 'ef'.repeat(32); // what a wallet that computes it wrongly answers
  class NWCClient {
    close() {}
    async subscribeNotifications(onNotification) {
      onNotification({ notification_type: 'payment_received', notification: { invoice, payment_hash: claimed, amount: 21000, state: 'settled' } });
      return () => {};
    }
  }
  class NostrWebLNProvider {
    constructor() { this.client = new NWCClient(); }
    async enable() {}
    close() {}
    async makeInvoice() { return { paymentRequest: invoice, payment_hash: claimed }; }
    async lookupInvoice() { throw new Error('not supported'); }
    async listTransactions() { return { transactions: [{ invoice, payment_hash: claimed, type: 'incoming', state: 'settled', settled_at: 1_800_000_050, amount: 21 }] }; }
  }
  const NWCWalletProvider = loadProvider({ NostrWebLNProvider, NWCClient });
  const provider = new NWCWalletProvider('w1', { nwcUrl: 'nostr+walletconnect://x' });
  await provider.connect();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await provider.createInvoice({ amount: 21 })).paymentHash, named);
    assert.equal((await provider.lookupInvoice(named)).paid, true, 'found by the hash its invoice names');
  } finally {
    console.warn = warn;
  }
  const seen = [];
  await provider.subscribeToPaymentNotifications((payment) => seen.push(payment.paymentHash));
  assert.deepEqual(seen, [named]);
});
