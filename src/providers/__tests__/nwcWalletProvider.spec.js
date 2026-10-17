/**
 * NWCWalletProvider holds one connection: the SDK's NostrWebLNProvider and
 * its own NIP-47 client. Notifications ride that client; nothing opens a
 * second relay connection, and disconnecting closes it once.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function loadProvider(sdk) {
  const load = (file, deps) => {
    const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { format: 'cjs' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
    return module.exports;
  };
  const base = load('../WalletProvider.js', {});
  return load('../NWCWalletProvider.js', { './WalletProvider': base, '@getalby/sdk': sdk }).NWCWalletProvider;
}

function fakeSdk() {
  const built = { providers: 0, clients: 0, closed: 0 };
  class NWCClient {
    constructor() { built.clients += 1; }
    close() { built.closed += 1; }
    async subscribeNotifications(onNotification) {
      onNotification({ notification_type: 'payment_received', notification: { payment_hash: 'h1', amount: 21000, state: 'settled' } });
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
  assert.deepEqual(seen, ['h1']);
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
