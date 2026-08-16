import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  createTokenDeleteEvent,
  createTokenEvent,
  createWalletEvent,
  getPublicKey,
  parseTokenEvent,
} from 'nostr-core';
import {
  fetchNip60WalletState,
  mergeCashuProofs,
  publishNip60WalletState,
} from '../nostrCashuWallet.js';

const SECRET = Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? 1 : 0));
const OTHER_SECRET = Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? 2 : 0));
const PUBKEY = getPublicKey(SECRET);
const MINT = 'https://mint.example';

function proof(amount, suffix) {
  return {
    id: `keyset-${suffix}`,
    amount,
    secret: `secret-${suffix}`,
    C: `point-${suffix}`,
  };
}

function queryPool(events) {
  return {
    async querySync(_relays, filter) {
      return events.filter((event) => (
        filter.kinds?.includes(event.kind)
        && (!filter.authors || filter.authors.includes(event.pubkey))
      ));
    },
  };
}

test('mergeCashuProofs never double-counts the same bearer proof', () => {
  const first = proof(2, 'a');
  const second = proof(4, 'b');
  assert.deepEqual(mergeCashuProofs([first], [first, second]), [first, second]);
});

test('NIP-60 recovery decrypts the wallet and applies token transitions', async () => {
  const oldEvent = createTokenEvent({ mint: MINT, proofs: [proof(2, 'old')] }, SECRET);
  const currentProof = proof(8, 'current');
  const currentEvent = createTokenEvent({
    mint: MINT,
    proofs: [currentProof],
    del: [oldEvent.id],
  }, SECRET);
  const walletEvent = createWalletEvent({ privkey: 'ab'.repeat(32), mints: [MINT] }, SECRET);

  const state = await fetchNip60WalletState({
    secretKey: SECRET,
    pubkey: PUBKEY,
    // Relay pools may return the same event once per relay. Recovery must not
    // turn transport duplication into extra payment/event counts.
    pool: queryPool([oldEvent, currentEvent, currentEvent, walletEvent, walletEvent]),
    relays: ['wss://relay.example'],
  });

  assert.equal(state.wallet.privkey, 'ab'.repeat(32));
  assert.deepEqual(state.wallet.mints, [MINT]);
  assert.equal(state.tokensByMint.length, 1);
  assert.deepEqual(state.tokensByMint[0].proofs, [currentProof]);
  assert.deepEqual(state.tokensByMint[0].eventIds, [currentEvent.id]);
});

test('NIP-60 recovery honors deletion events and ignores another author', async () => {
  const removed = createTokenEvent({ mint: MINT, proofs: [proof(16, 'removed')] }, SECRET);
  const deletion = createTokenDeleteEvent([removed.id], SECRET);
  const foreign = createTokenEvent({ mint: MINT, proofs: [proof(32, 'foreign')] }, OTHER_SECRET);

  const state = await fetchNip60WalletState({
    secretKey: SECRET,
    pubkey: PUBKEY,
    pool: queryPool([removed, deletion, foreign]),
    relays: ['wss://relay.example'],
  });

  assert.deepEqual(state.tokensByMint, []);
  assert.ok(state.removedEventIds.includes(removed.id));
});

test('publishing a snapshot creates decryptable NIP-60 state before deletion', async () => {
  const published = [];
  const pool = {
    async ensureRelay(relay) {
      return {
        async publish(event) {
          published.push({ relay, event });
        },
      };
    },
  };
  const oldId = '01'.repeat(32);
  const currentProof = proof(64, 'published');

  const result = await publishNip60WalletState({
    secretKey: SECRET,
    mint: MINT,
    proofs: [currentProof],
    previousTokenEventIds: [oldId],
    pool,
    relays: ['wss://one.example', 'wss://two.example'],
    direction: 'in',
    amount: 64,
  });

  assert.equal(result.ok, true);
  assert.equal(result.tokenEventIds.length, 1);
  const tokenEvent = published.find(({ event }) => event.id === result.tokenEventId)?.event;
  assert.ok(tokenEvent, 'token event was published');
  assert.deepEqual(parseTokenEvent(tokenEvent, SECRET), {
    mint: MINT,
    proofs: [currentProof],
    unit: 'sat',
    del: [oldId],
  });
  assert.ok(published.some(({ event }) => event.kind === 5), 'predecessor was deleted');
});

test('a rejected replacement never deletes the last recoverable token event', async () => {
  const publishedKinds = [];
  const pool = {
    async ensureRelay() {
      return {
        async publish(event) {
          publishedKinds.push(event.kind);
          if (event.kind === 7375) throw new Error('relay rejected token');
        },
      };
    },
  };

  const result = await publishNip60WalletState({
    secretKey: SECRET,
    mint: MINT,
    proofs: [proof(128, 'rejected')],
    previousTokenEventIds: ['02'.repeat(32)],
    pool,
    relays: ['wss://relay.example'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TOKEN_PUBLISH_FAILED');
  assert.equal(publishedKinds.includes(5), false, 'old state remains intact');
});
