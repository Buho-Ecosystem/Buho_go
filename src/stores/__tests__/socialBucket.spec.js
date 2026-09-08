/** Social Bucket ownership and NIP-60 integration tests. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { useSocialBucketStore } = await import('../socialBucket.js');

const PROFILE_A = 'a'.repeat(64);
const PROFILE_B = 'b'.repeat(64);
const MINT = 'https://mint.example';

function proof(amount, suffix) {
  return {
    id: `keyset-${suffix}`,
    amount,
    secret: `secret-${suffix}`,
    C: `point-${suffix}`,
  };
}

function freshStore() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return useSocialBucketStore();
}

function fakeIdentity(pubkey) {
  return {
    bootstrapped: true,
    nostrPubkeyHex: pubkey,
    async getNostrSecretKeyBytes() {
      return Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? 1 : 0));
    },
  };
}

test('legacy bucket storage migrates once to the active Nostr profile', async () => {
  const store = freshStore();
  await store.hydrate();
  store.mintUrl = MINT;
  store.heldProofs = [proof(21, 'legacy')];
  store.heldPaymentCount = 1;
  await store._persistProofs();
  store._persistMeta();

  assert.ok(localStorage.getItem('buhoGO_social_bucket_v1'));
  await store.hydrate({ pubkey: PROFILE_A });

  assert.equal(store.ownerPubkey, PROFILE_A);
  assert.equal(store.heldSats, 21);
  assert.equal(localStorage.getItem('buhoGO_social_bucket_v1'), null);
  assert.ok(localStorage.getItem(`buhoGO_social_bucket_v1:${PROFILE_A}`));
});

test('a failed legacy migration keeps the original bearer proofs retryable', async () => {
  const store = freshStore();
  await store.hydrate();
  store.mintUrl = MINT;
  store.heldProofs = [proof(17, 'migration-retry')];
  await store._persistProofs();
  store._persistMeta();

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const failingKey = `buhoGO_social_bucket_proofs_v1:${PROFILE_A}`;
  localStorage.setItem = (key, value) => {
    if (key === failingKey) throw new Error('simulated quota failure');
    originalSetItem(key, value);
  };
  await assert.rejects(
    () => store.hydrate({ pubkey: PROFILE_A }),
    /simulated quota failure/,
  );
  localStorage.setItem = originalSetItem;

  assert.ok(localStorage.getItem('buhoGO_social_bucket_proofs_v1'));
  assert.equal(localStorage.getItem(`buhoGO_social_bucket_v1:${PROFILE_A}`), null);

  await store.hydrate({ pubkey: PROFILE_A });
  assert.equal(store.heldSats, 17);
  assert.equal(localStorage.getItem('buhoGO_social_bucket_proofs_v1'), null);
});

test('switching Nostr profiles never shares local Cashu proofs', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.mintUrl = MINT;
  store.heldProofs = [proof(8, 'profile-a')];
  store.heldPaymentCount = 1;
  await store._persistProofs();
  store._persistMeta();

  await store.hydrate({ pubkey: PROFILE_B });
  assert.equal(store.ownerPubkey, PROFILE_B);
  assert.deepEqual(store.heldProofs, []);
  assert.equal(store.heldSats, 0);

  store.mintUrl = MINT;
  store.heldProofs = [proof(13, 'profile-b')];
  await store._persistProofs();
  store._persistMeta();

  await store.hydrate({ pubkey: PROFILE_A });
  assert.equal(store.heldSats, 8);
  assert.equal(store.heldProofs[0].secret, 'secret-profile-a');

  await store.hydrate({ pubkey: PROFILE_B });
  assert.equal(store.heldSats, 13);
  assert.equal(store.heldProofs[0].secret, 'secret-profile-b');
});

test('profile switching is blocked while a payout owns the proof state', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.isSweeping = true;

  await assert.rejects(
    () => store.hydrate({ pubkey: PROFILE_B }),
    (err) => err?.code === 'SOCIAL_BUCKET_BUSY',
  );
  assert.equal(store.ownerPubkey, PROFILE_A);
});

test('reset removes only the active profile bucket', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.mintUrl = MINT;
  store.heldProofs = [proof(5, 'kept')];
  await store._persistProofs();
  store._persistMeta();

  await store.hydrate({ pubkey: PROFILE_B });
  store.mintUrl = MINT;
  store.heldProofs = [proof(3, 'removed')];
  await store._persistProofs();
  store._persistMeta();
  store.reset();

  await store.hydrate({ pubkey: PROFILE_A });
  assert.equal(store.heldSats, 5);
  await store.hydrate({ pubkey: PROFILE_B });
  assert.equal(store.heldSats, 0);
});

test('validated NIP-60 proofs become a payout-ready profile balance', async () => {
  const store = freshStore();
  const recovered = proof(34, 'recovered');
  await store.hydrate({ pubkey: PROFILE_A });

  await store._restoreNip60State({
    wallet: { privkey: 'c'.repeat(64), mints: [MINT] },
    tokensByMint: [{
      mint: MINT,
      proofs: [recovered],
      eventIds: ['d'.repeat(64)],
    }],
  }, MINT, {
    validateProofs: async ({ proofs }) => proofs,
  });

  assert.equal(store.ownerPubkey, PROFILE_A);
  assert.equal(store.mintUrl, MINT);
  assert.equal(store.heldSats, 34);
  assert.equal(store.paymentCount, 1);
  assert.deepEqual(store.nip60TokenEventIds, ['d'.repeat(64)]);

  // A fresh Pinia instance represents an app restart on the same device.
  setActivePinia(createPinia());
  const reloaded = useSocialBucketStore();
  await reloaded.hydrate({ pubkey: PROFILE_A });
  assert.equal(reloaded.heldSats, 34);
  assert.equal(reloaded.nip60Wallet.privkey, 'c'.repeat(64));
});

test('a late sync from the previous profile cannot overwrite the active one', async () => {
  const store = freshStore();
  let resolveProfileA;
  const delayedQuotes = new Promise((resolve) => { resolveProfileA = resolve; });
  const emptyNip60 = async () => ({ wallet: null, tokensByMint: [] });

  const syncA = store.sync({
    identityStore: fakeIdentity(PROFILE_A),
    quoteFetcher: async () => delayedQuotes,
    nip60Fetcher: emptyNip60,
  });

  // Let profile A enter its network wait before profile B becomes active.
  await Promise.resolve();
  await store.sync({
    identityStore: fakeIdentity(PROFILE_B),
    quoteFetcher: async () => [{
      quoteId: 'profile-b-payment',
      amount: 9,
      state: 'PAID',
      mintUrl: MINT,
    }],
    nip60Fetcher: emptyNip60,
  });

  resolveProfileA([{
    quoteId: 'late-profile-a-payment',
    amount: 100,
    state: 'PAID',
    mintUrl: MINT,
  }]);
  await syncA;

  assert.equal(store.ownerPubkey, PROFILE_B);
  assert.deepEqual(store.waitingQuotes.map((quote) => quote.quoteId), ['profile-b-payment']);
  assert.equal(store.waitingSats, 9);
});

test('the home badge quiets after a look and returns for new money', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.waitingQuotes = [{ quoteId: 'zap-1', amount: 21, state: 'PAID', mintUrl: MINT }];

  assert.equal(store.hasUnseenPayments, true);
  store.markPaymentsSeen();
  assert.equal(store.hasUnseenPayments, false);

  store.waitingQuotes = [
    ...store.waitingQuotes,
    { quoteId: 'zap-2', amount: 5, state: 'PAID', mintUrl: MINT },
  ];
  assert.equal(store.hasUnseenPayments, true);
});

test('the acknowledgement survives a restart', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.heldPaymentCount = 2;
  store.markPaymentsSeen();

  // Same storage, fresh process.
  setActivePinia(createPinia());
  const reborn = useSocialBucketStore();
  await reborn.hydrate({ pubkey: PROFILE_A });
  reborn.heldPaymentCount = 2;
  assert.equal(reborn.hasUnseenPayments, false);

  reborn.heldPaymentCount = 3;
  assert.equal(reborn.hasUnseenPayments, true);
});

test('one profile looking never quiets another profile badge', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.heldPaymentCount = 1;
  store.markPaymentsSeen();
  assert.equal(store.hasUnseenPayments, false);

  await store.hydrate({ pubkey: PROFILE_B });
  store.heldPaymentCount = 1;
  assert.equal(store.hasUnseenPayments, true);
});

test('money arriving after a drain badges again despite equal counts', async () => {
  const store = freshStore();
  await store.hydrate({ pubkey: PROFILE_A });
  store.heldPaymentCount = 1;
  store.collectedQuoteIds = ['zap-1'];
  store.markPaymentsSeen();
  assert.equal(store.hasUnseenPayments, false);

  // Sweep drains the bucket; nothing to show, nothing unseen.
  store.heldPaymentCount = 0;
  assert.equal(store.hasUnseenPayments, false);

  // The next zap mints into the same held count as before the sweep. The
  // collected-id component of the signature is what keeps this visible.
  store.heldPaymentCount = 1;
  store.collectedQuoteIds = ['zap-1', 'zap-2'];
  assert.equal(store.hasUnseenPayments, true);
});
