/**
 * The wiring of the chat runtime onto the app's stores, with fake stores.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/appRuntime.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey } from 'nostr-core';
import { CHAT_REQUEST_SOURCE, createAppRuntimeFactory } from '../appRuntime.js';

test('the factory maps every runtime dependency onto the right store call', async () => {
  const me = 'a'.repeat(64);
  const partner = 'b'.repeat(64);
  const calls = [];
  const messagesStore = { scope: me };
  const wallet = {
    wallets: [{ id: 's', type: 'spark' }],
    getProvider: (id) => { calls.push(['getProvider', id]); return { getTransactions: async () => [] }; },
  };
  let captured;
  const factory = createAppRuntimeFactory({
    identity: { identityCapabilities: { kind: 'derived', rawKey: true }, getNostrSecretKeyBytes: async () => new Uint8Array(32).fill(7) },
    messages: () => messagesStore,
    wallet,
    profile: { lud16: 'me@buho.example' },
    addressBook: { findContactByPubkey: (pk) => (pk === partner ? { id: 'c1', name: 'Pat', other: 1 } : null) },
    notifications: { notifyMessageIfEnabled: async (n) => { calls.push(['notify', n]); return true; } },
    transactionMetadata: { enqueuePendingContactLink: async (link) => { calls.push(['link', link]); } },
  }, {
    getRelayPool: () => ({ ensureRelay: async (url, options) => { calls.push(['relay', url, options]); return {}; } }),
    lnurl: { fetchPayRequest: 'F', requestLnurlInvoice: 'R', verifyPayment: 'V' },
    fetchProfile: 'P',
    normalizeTx: (raw) => ({ type: 'incoming', status: 'completed', amount: raw.amount, paymentHash: raw.hash, settled_at: raw.at }),
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
  assert.equal(captured.fetchProfile, 'P');
  assert.deepEqual(captured.lnurl, { fetchPayRequest: 'F', requestInvoice: 'R', verifyPayment: 'V' });
  assert.deepEqual(await captured.loadIncomingTransactions(), []);
  assert.deepEqual(captured.contacts.find(partner), { id: 'c1', name: 'Pat' });
  assert.equal(captured.contacts.find('c'.repeat(64)), null);
  assert.equal(await captured.notifications.message({ title: 'T' }), true);
  await captured.linkPayment({ contactId: 'c1', walletId: 's', amountSats: 500, note: 'Pizza' });
  await captured.ensureRelay('wss://r.example', { connectionTimeout: 1 });

  assert.deepEqual(calls, [
    ['getProvider', 's'],
    ['notify', { title: 'T' }],
    ['link', {
      contactId: 'c1', amountSats: 500, walletId: 's', direction: 'incoming',
      source: CHAT_REQUEST_SOURCE, label: 'Pizza', perPayment: true,
    }],
    ['relay', 'wss://r.example', { connectionTimeout: 1 }],
  ]);
});

test('an identity that signs in another app gets its signer app, pinned to that identity', async () => {
  const me = 'a'.repeat(64);
  const lease = { signer: 'remote signer' };
  const identity = {
    identityCapabilities: { kind: 'nip46', rawKey: false, needsApproval: true },
    nostrPubkeyHex: me,
    acquireSigner: async () => lease,
    getNostrSecretKeyBytes: async () => { throw new Error('no key on this phone'); },
  };
  let captured;
  const factory = createAppRuntimeFactory({
    identity,
    messages: () => ({ scope: me }),
    wallet: { wallets: [] },
    profile: {},
    addressBook: { findContactByPubkey: () => null },
    notifications: {},
    transactionMetadata: {},
  }, {
    getRelayPool: () => ({}),
    lnurl: {},
    createChatRuntime: (deps) => { captured = deps; return {}; },
  });

  factory(me);
  assert.equal(captured.loadSecretKey, undefined, 'never asks for key bytes');
  assert.equal(captured.signerApp.maxParallel, 3);
  assert.equal(await captured.signerApp.acquire(), lease);

  // Another identity is in use now: this runtime's signer must not be asked.
  identity.nostrPubkeyHex = 'b'.repeat(64);
  await assert.rejects(captured.signerApp.acquire(), (err) => err.code === 'NO_IDENTITY');

  identity.identityCapabilities = { kind: 'nip07', rawKey: false, needsApproval: true };
  factory(me);
  assert.equal(captured.signerApp.maxParallel, 1, 'an extension asks the person per request: one at a time');
});
