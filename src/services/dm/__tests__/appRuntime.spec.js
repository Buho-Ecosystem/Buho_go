/**
 * The wiring of the chat runtime onto the app's stores, with fake stores.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/appRuntime.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey } from 'nostr-core';
import { CHAT_REQUEST_SOURCE, createAppRuntimeFactory, describeWallet } from '../appRuntime.js';

test('wallet descriptors carry type, address, Spark account and NWC methods from wherever the store keeps them', () => {
  const spark = { id: 's', type: 'spark', connectionData: { accountNumber: 1 }, metadata: { lud16: 'stale@x.io' } };
  assert.deepEqual(describeWallet(spark, () => 'Me@Buho.example'), {
    id: 's', type: 'spark', lightningAddress: 'me@buho.example', accountNumber: 1,
  });
  assert.deepEqual(describeWallet(spark, () => null), { id: 's', type: 'spark', accountNumber: 1 });

  const nwc = { id: 'n', type: 'nwc', metadata: { lud16: 'Nwc@Host.io', methods: ['pay_invoice', 'make_invoice'] } };
  assert.deepEqual(describeWallet(nwc, () => 'ignored@x.io'), {
    id: 'n', type: 'nwc', lightningAddress: 'nwc@host.io', methods: ['pay_invoice', 'make_invoice'],
  });
  assert.deepEqual(describeWallet({ id: 'a', type: 'arkade', metadata: {} }, () => null), { id: 'a', type: 'arkade' });
  assert.deepEqual(describeWallet({ id: 'l', type: 'lnbits' }, () => null), { id: 'l', type: 'lnbits' });
});

test('the factory maps every runtime dependency onto the right store call', async () => {
  const me = 'a'.repeat(64);
  const partner = 'b'.repeat(64);
  const calls = [];
  const messagesStore = { scope: me };
  const wallet = {
    wallets: [
      { id: 's', type: 'spark', connectionData: { accountNumber: 1 } },
      { id: 'n', type: 'nwc', metadata: { methods: ['make_invoice'] } },
    ],
    sparkLightningAddressOf: () => 'me@buho.example',
    getProvider: (id) => { calls.push(['getProvider', id]); return { id }; },
    ensureWalletConnectedForTransfer: async (id) => { calls.push(['connect', id]); return { id }; },
  };
  let captured;
  const factory = createAppRuntimeFactory({
    identity: { getNostrSecretKeyBytes: async () => new Uint8Array(32).fill(7) },
    messages: () => messagesStore,
    wallet,
    profile: { lud16: 'me@buho.example' },
    addressBook: { findContactByPubkey: (pk) => (pk === partner ? { id: 'c1', name: 'Pat', other: 1 } : null) },
    notifications: { notifyMessageIfEnabled: async (n) => { calls.push(['notify', n]); return true; } },
    transactionMetadata: { enqueuePendingContactLink: async (link) => { calls.push(['link', link]); } },
  }, {
    getRelayPool: () => ({ ensureRelay: async (url, options) => { calls.push(['relay', url, options]); return {}; } }),
    lnurl: { fetchPayRequest: 'F', requestLnurlInvoice: 'R', verifyPayment: 'V' },
    isLocked: () => true,
    isHidden: () => true,
    formatNotification: () => 'x',
    channelName: 'Messages',
    createChatRuntime: (deps) => { captured = deps; return { stub: true }; },
  });

  assert.deepEqual(factory(me), { stub: true });
  assert.equal(captured.me, me);
  assert.equal(captured.store, messagesStore);
  assert.equal(captured.isLocked(), true);
  assert.equal(captured.isHidden(), true);
  assert.equal(captured.channelName, 'Messages');
  assert.equal((await captured.loadSecretKey())[0], 7);
  assert.equal(captured.getProfileAddress(), 'me@buho.example');
  assert.deepEqual(captured.lnurl, { fetchPayRequest: 'F', requestInvoice: 'R', verifyPayment: 'V' });
  assert.deepEqual(captured.wallets.list().map((w) => w.id), ['s', 'n']);
  assert.equal(captured.wallets.list()[0].lightningAddress, 'me@buho.example');
  assert.deepEqual(captured.wallets.list()[1].methods, ['make_invoice']);
  assert.deepEqual(captured.wallets.getProvider('s'), { id: 's' });
  await captured.wallets.ensureConnected('n');
  assert.deepEqual(captured.contacts.find(partner), { id: 'c1', name: 'Pat' });
  assert.equal(captured.contacts.find('c'.repeat(64)), null);
  assert.equal(await captured.notifications.message({ title: 'T' }), true);
  await captured.linkPayment({ contactId: 'c1', walletId: 's', amountSats: 500, note: 'Pizza' });
  await captured.ensureRelay('wss://r.example', { connectionTimeout: 1 });

  assert.deepEqual(calls, [
    ['getProvider', 's'],
    ['connect', 'n'],
    ['notify', { title: 'T' }],
    ['link', {
      contactId: 'c1', amountSats: 500, walletId: 's', direction: 'incoming',
      source: CHAT_REQUEST_SOURCE, label: 'Pizza', perPayment: true,
    }],
    ['relay', 'wss://r.example', { connectionTimeout: 1 }],
  ]);
});
