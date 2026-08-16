/**
 * transactionMetadata store — wallet-scoping tests.
 *
 * Coverage focus (the refactor this guards): metadata records and
 * pending contact links are keyed/scoped per wallet, not by bare
 * transaction id. Tx ids are only unique WITHIN a wallet — both sides of
 * a payment that lives twice in this app (e.g. an internal transfer, or
 * a send from one wallet paying a receive on another that fronts the
 * same node) can share a provider-assigned id. Without wallet scoping, a
 * note/tag/contact/successAction written for one side silently appears
 * on the other, and the pending-link queue can drain a link against
 * whichever wallet's list refreshes first.
 *
 *   - two wallets sharing the same txId keep fully independent records
 *   - a legacy bare-key record (written before scoping existed) is still
 *     readable, and a scoped write creates a composite record alongside
 *     it rather than destroying it
 *   - a pending link is only consumed by the wallet it was queued for
 *     (a legacy link with no walletId still matches anything)
 *   - the amount-proof guard for label/source-only links still holds
 *   - direction matching (incoming vs outgoing) still holds
 *   - getTransactionsWithTag / getTransactionsForContact still work,
 *     now returning { txId, walletId } so a caller can re-scope a
 *     follow-up read/write
 *
 * Run directly with Node:
 *   node src/stores/__tests__/transactionMetadata.spec.js
 */

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Browser-storage shim — must be set up BEFORE the store imports load,
// since they reference `localStorage` at module level via Pinia /
// fiatRatesService's constructor.
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
    this._data.set(key, String(value));
  }
  removeItem(key) {
    this._data.delete(key);
  }
  clear() {
    this._data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { useTransactionMetadataStore } = await import('../transactionMetadata.js');
const { useAddressBookStore } = await import('../addressBook.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

function freshStore() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return useTransactionMetadataStore();
}

/** Minimal normalized-tx fixture, matching what consumePendingContactLinks reads. */
function makeTx(id, { type = 'outgoing', amount = -500, timestamp } = {}) {
  return { id, type, amount, timestamp: timestamp ?? Math.floor(Date.now() / 1000) };
}

console.log('transactionMetadata store');

// ---------------------------------------------------------------------------
// The core bug: two wallets sharing the same txId
// ---------------------------------------------------------------------------

await test('two wallets sharing the same txId keep independent metadata (note, contact, successAction)', async () => {
  const store = freshStore();
  const addressBook = useAddressBookStore();
  const alice = await addressBook.addEntry({
    name: 'Alice',
    address: 'alice@example.test',
    addressType: 'lightning',
  });

  const TX_ID = 'shared-payment-hash-1';

  // Wallet A: note + contact.
  await store.setNoteForTransaction(TX_ID, 'wallet-a', 'Coffee with Alice');
  await store.setContactForTransaction(TX_ID, 'wallet-a', alice.id);

  // Wallet B must see none of it on the exact same bare tx id.
  assert.equal(store.getNoteForTransaction(TX_ID, 'wallet-b'), '');
  assert.equal(store.getMetadataForTransaction(TX_ID, 'wallet-b'), null);
  assert.equal(store.getContactForTransaction(TX_ID, 'wallet-b'), null);

  // Wallet A sees its own writes, resolved all the way to the contact.
  assert.equal(store.getNoteForTransaction(TX_ID, 'wallet-a'), 'Coffee with Alice');
  assert.equal(store.getContactForTransaction(TX_ID, 'wallet-a')?.id, alice.id);

  // Wallet B now writes a successAction on the SAME id — must not leak to
  // A, and must not disturb A's record.
  await store.setSuccessActionForTransaction(TX_ID, 'wallet-b', { message: 'Thanks!' });
  assert.equal(store.getSuccessActionForTransaction(TX_ID, 'wallet-a'), null);
  assert.deepEqual(store.getSuccessActionForTransaction(TX_ID, 'wallet-b'), { message: 'Thanks!' });

  // Wallet A's note/contact are still intact after B's write, and B still
  // has no contact of its own.
  assert.equal(store.getNoteForTransaction(TX_ID, 'wallet-a'), 'Coffee with Alice');
  assert.equal(store.getContactForTransaction(TX_ID, 'wallet-a')?.id, alice.id);
  assert.equal(store.getContactForTransaction(TX_ID, 'wallet-b'), null);
});

await test('two wallets sharing the same txId keep independent tags', async () => {
  const store = freshStore();
  const TX_ID = 'shared-payment-hash-2';

  await store.setTagsForTransaction(TX_ID, 'wallet-a', ['groceries']);
  assert.deepEqual(store.getTagsForTransaction(TX_ID, 'wallet-a'), ['groceries']);
  assert.deepEqual(store.getTagsForTransaction(TX_ID, 'wallet-b'), []);

  await store.addTagToTransaction(TX_ID, 'wallet-b', 'business');
  assert.deepEqual(store.getTagsForTransaction(TX_ID, 'wallet-b'), ['business']);
  // Wallet A's tags are unaffected by wallet B's write to the same txId.
  assert.deepEqual(store.getTagsForTransaction(TX_ID, 'wallet-a'), ['groceries']);
});

// ---------------------------------------------------------------------------
// Legacy bare-key records — no migration, no data loss
// ---------------------------------------------------------------------------

await test('a legacy bare-key record is still readable, and a scoped write creates a composite record without destroying it', async () => {
  const store = freshStore();
  const TX_ID = 'legacy-tx-1';

  // Simulate a record written before wallet-scoping existed: bare txId key.
  store.metadata[TX_ID] = {
    contactId: null,
    customNote: 'Pre-existing legacy note',
    tags: [],
    updatedAt: Date.now(),
  };

  // Readable with no walletId at all (the pre-refactor call-site shape)...
  assert.equal(store.getNoteForTransaction(TX_ID), 'Pre-existing legacy note');
  // ...and readable as a fallback when a walletId IS passed but no
  // composite record exists yet for that wallet.
  assert.equal(store.getNoteForTransaction(TX_ID, 'wallet-a'), 'Pre-existing legacy note');
  assert.equal(store.getMetadataForTransaction(TX_ID, 'wallet-a').customNote, 'Pre-existing legacy note');

  // A scoped write creates a NEW composite record...
  await store.setTagsForTransaction(TX_ID, 'wallet-a', ['groceries']);
  assert.deepEqual(store.metadata[`wallet-a::${TX_ID}`].tags, ['groceries']);

  // ...and the legacy bare-key record is untouched: still present, still
  // carrying its original note. Legacy bare keys are read-only from here
  // on — nothing ever writes to them again.
  assert.ok(store.metadata[TX_ID]);
  assert.equal(store.metadata[TX_ID].customNote, 'Pre-existing legacy note');
  assert.deepEqual(store.metadata[TX_ID].tags, []);
});

await test('getTransactionsWithTag / getTransactionsForContact return { txId, walletId }, for both composite and legacy keys', async () => {
  const store = freshStore();

  // A legacy bare-key record.
  store.metadata['legacy-tx-2'] = {
    contactId: 'contact-1',
    customNote: '',
    tags: ['travel'],
    updatedAt: Date.now(),
  };
  // A wallet-scoped composite record.
  await store.setTagsForTransaction('new-tx-1', 'wallet-a', ['travel']);
  await store.setContactForTransaction('new-tx-1', 'wallet-a', 'contact-1');

  const tagged = store.getTransactionsWithTag('travel');
  assert.equal(tagged.length, 2);
  assert.ok(tagged.some((r) => r.txId === 'legacy-tx-2' && r.walletId === null));
  assert.ok(tagged.some((r) => r.txId === 'new-tx-1' && r.walletId === 'wallet-a'));

  const forContact = store.getTransactionsForContact('contact-1');
  assert.equal(forContact.length, 2);
  assert.ok(forContact.some((r) => r.txId === 'legacy-tx-2' && r.walletId === null));
  assert.ok(forContact.some((r) => r.txId === 'new-tx-1' && r.walletId === 'wallet-a'));
});

// ---------------------------------------------------------------------------
// Writes require a walletId — never throw into a payment path
// ---------------------------------------------------------------------------

await test('a write without a walletId is a no-op, not a throw', async () => {
  const store = freshStore();
  const result = await store.setNoteForTransaction('some-tx', null, 'a note');
  assert.equal(result, null);
  assert.equal(store.getNoteForTransaction('some-tx', null), '');
  assert.equal(Object.keys(store.metadata).length, 0);
});

// ---------------------------------------------------------------------------
// Pending links — scoped consumption
// ---------------------------------------------------------------------------

await test('a pending link queued for wallet A is not consumed by wallet B, and is consumed by wallet A', async () => {
  const store = freshStore();
  await store.enqueuePendingContactLink({
    recipientAddress: 'alice@example.test',
    amountSats: 500,
    walletId: 'wallet-a',
  });

  // Wallet B's own tx list refreshes first — must not steal the link.
  const txOnWalletB = [makeTx('tx-on-b', { amount: -500 })];
  const matchedOnB = await store.consumePendingContactLinks(txOnWalletB, 'wallet-b');
  assert.equal(matchedOnB, 0);
  assert.equal(store.getMetadataForTransaction('tx-on-b', 'wallet-b'), null);

  // Wallet A's own refresh consumes it correctly.
  const txOnWalletA = [makeTx('tx-on-a', { amount: -500 })];
  const matchedOnA = await store.consumePendingContactLinks(txOnWalletA, 'wallet-a');
  assert.equal(matchedOnA, 1);
  assert.equal(
    store.getMetadataForTransaction('tx-on-a', 'wallet-a').recipientAddress,
    'alice@example.test',
  );
});

await test('a contact payment link resolves the saved contact after its outgoing transaction appears', async () => {
  const store = freshStore();
  const addressBook = useAddressBookStore();
  const contact = await addressBook.addEntry({
    name: 'Alice',
    address: 'alice@example.test',
    addressType: 'lightning',
    color: '#d946ef',
  });

  await store.enqueuePendingContactLink({
    contactId: contact.id,
    recipientAddress: contact.address,
    amountSats: 500,
    walletId: 'wallet-a',
  });

  const matched = await store.consumePendingContactLinks(
    [makeTx('contact-payment-tx', { amount: -500 })],
    'wallet-a',
  );

  assert.equal(matched, 1);
  assert.equal(
    store.getContactForTransaction('contact-payment-tx', 'wallet-a')?.id,
    contact.id,
  );
});

await test('a Social Bucket payout keeps the profile avatar on its incoming wallet transaction', async () => {
  const store = freshStore();
  const avatar = {
    kind: 'nostr',
    npub: 'npub1profile',
    picture: 'https://example.test/profile.jpg',
  };

  await store.enqueuePendingContactLink({
    amountSats: 492,
    label: 'Profile payout',
    source: 'social-bucket',
    counterpartyAvatar: avatar,
    perPayment: true,
    direction: 'incoming',
    walletId: 'wallet-a',
  });

  const matched = await store.consumePendingContactLinks(
    [makeTx('social-bucket-payout', { type: 'incoming', amount: 492 })],
    'wallet-a',
  );

  assert.equal(matched, 1);
  assert.equal(store.getLabelForTransaction('social-bucket-payout', 'wallet-a'), 'Profile payout');
  assert.equal(store.getSourceForTransaction('social-bucket-payout', 'wallet-a'), 'social-bucket');
  assert.deepEqual(
    store.getCounterpartyAvatarForTransaction('social-bucket-payout', 'wallet-a'),
    avatar,
  );
});

await test('two same-amount contact payments each retain their contact link', async () => {
  const store = freshStore();
  const addressBook = useAddressBookStore();
  const contact = await addressBook.addEntry({
    name: 'Alice',
    address: 'alice@example.test',
    addressType: 'lightning',
  });

  const link = {
    contactId: contact.id,
    recipientAddress: contact.address,
    amountSats: 500,
    perPayment: true,
    walletId: 'wallet-a',
  };
  await store.enqueuePendingContactLink(link);
  await store.enqueuePendingContactLink(link);
  assert.equal(store.pendingContactLinks.length, 2);

  const matched = await store.consumePendingContactLinks([
    makeTx('contact-payment-tx-1', { amount: -500 }),
    makeTx('contact-payment-tx-2', { amount: -500 }),
  ], 'wallet-a');

  assert.equal(matched, 2);
  assert.equal(store.getContactForTransaction('contact-payment-tx-1', 'wallet-a')?.id, contact.id);
  assert.equal(store.getContactForTransaction('contact-payment-tx-2', 'wallet-a')?.id, contact.id);
});

await test('a legacy pending link with no walletId still matches any wallet (nothing already queued is stranded)', async () => {
  const store = freshStore();
  // A link queued before wallet-scoping existed carries no walletId field
  // at all — push it directly, since the real enqueue path always stamps
  // one now.
  store.pendingContactLinks.push({
    contactId: null,
    recipientAddress: 'legacy@example.test',
    amountSats: 750,
    successAction: null,
    verifyUrl: null,
    label: null,
    source: null,
    counterpartyAvatar: null,
    direction: 'outgoing',
    sentAt: Date.now(),
  });

  const tx = [makeTx('tx-legacy-link', { amount: -750 })];
  const matched = await store.consumePendingContactLinks(tx, 'wallet-any');
  assert.equal(matched, 1);
  assert.equal(
    store.getMetadataForTransaction('tx-legacy-link', 'wallet-any').recipientAddress,
    'legacy@example.test',
  );
});

await test('internal-transfer shape: an outgoing-leg link (fromWalletId) and incoming-leg link (toWalletId) land on the correct wallets only', async () => {
  const store = freshStore();
  // Mirrors wallet.js's transferBetweenWallets: same amount, same instant,
  // opposite directions, opposite wallets — the exact case that motivated
  // this refactor (both legs can share a payment hash/tx id when both
  // wallets live in this app).
  await store.enqueuePendingContactLink({
    label: 'Transfer to Business',
    source: 'internal-transfer',
    amountSats: 300,
    walletId: 'wallet-personal',
  });
  await store.enqueuePendingContactLink({
    label: 'Transfer from Personal',
    source: 'internal-transfer',
    direction: 'incoming',
    amountSats: 300,
    walletId: 'wallet-business',
  });

  // Personal wallet's list refresh only drains its own (outgoing) leg.
  const personalTxs = [makeTx('shared-transfer-id', { type: 'outgoing', amount: -300 })];
  const matchedPersonal = await store.consumePendingContactLinks(personalTxs, 'wallet-personal');
  assert.equal(matchedPersonal, 1);
  assert.equal(
    store.getLabelForTransaction('shared-transfer-id', 'wallet-personal'),
    'Transfer to Business',
  );
  // Business's own record for the SAME bare tx id is untouched.
  assert.equal(store.getLabelForTransaction('shared-transfer-id', 'wallet-business'), null);

  // Business wallet's list refresh (same bare tx id, since both sides of
  // an internal transfer between our own wallets can share one) drains
  // only its own (incoming) leg.
  const businessTxs = [makeTx('shared-transfer-id', { type: 'incoming', amount: 300 })];
  const matchedBusiness = await store.consumePendingContactLinks(businessTxs, 'wallet-business');
  assert.equal(matchedBusiness, 1);
  assert.equal(
    store.getLabelForTransaction('shared-transfer-id', 'wallet-business'),
    'Transfer from Personal',
  );
  // Personal's record is still exactly what it was.
  assert.equal(
    store.getLabelForTransaction('shared-transfer-id', 'wallet-personal'),
    'Transfer to Business',
  );
});

// ---------------------------------------------------------------------------
// Amount-proof guard — label/source-only links have no address to prove
// which tx they belong to, so a match requires an exact amount
// ---------------------------------------------------------------------------

await test('a label/source-only link requires an amount match before stamping (amount-proof guard)', async () => {
  const store = freshStore();
  await store.enqueuePendingContactLink({
    label: 'Transfer to Business',
    source: 'internal-transfer',
    amountSats: 1000,
    walletId: 'wallet-a',
  });

  // A same-window outgoing tx with a DIFFERENT amount must not be
  // stamped — with no address to prove the match, staying silent beats
  // guessing wrong.
  const wrongAmountTx = [makeTx('tx-wrong-amount', { amount: -250 })];
  const matchedWrong = await store.consumePendingContactLinks(wrongAmountTx, 'wallet-a');
  assert.equal(matchedWrong, 0);
  assert.equal(store.getLabelForTransaction('tx-wrong-amount', 'wallet-a'), null);

  // Once the exact-amount tx is present (even alongside the wrong one),
  // only it gets stamped.
  const rightAmountTx = makeTx('tx-right-amount', { amount: -1000 });
  const matched = await store.consumePendingContactLinks([...wrongAmountTx, rightAmountTx], 'wallet-a');
  assert.equal(matched, 1);
  assert.equal(store.getLabelForTransaction('tx-right-amount', 'wallet-a'), 'Transfer to Business');
  assert.equal(store.getLabelForTransaction('tx-wrong-amount', 'wallet-a'), null);
});

await test('an address-bearing link keeps the looser newest-in-window fallback (no amount-proof guard)', async () => {
  const store = freshStore();
  await store.enqueuePendingContactLink({
    recipientAddress: 'bob@example.test',
    amountSats: 999999, // deliberately wrong — proves amount is not a hard filter here
    walletId: 'wallet-a',
  });

  const tx = [makeTx('tx-any-amount', { amount: -42 })];
  const matched = await store.consumePendingContactLinks(tx, 'wallet-a');
  assert.equal(matched, 1);
  assert.equal(
    store.getMetadataForTransaction('tx-any-amount', 'wallet-a').recipientAddress,
    'bob@example.test',
  );
});

// ---------------------------------------------------------------------------
// Direction matching
// ---------------------------------------------------------------------------

await test('an incoming-direction link only matches incoming transactions', async () => {
  const store = freshStore();
  await store.enqueuePendingContactLink({
    label: 'Transfer from Personal',
    source: 'internal-transfer',
    direction: 'incoming',
    amountSats: 300,
    walletId: 'wallet-a',
  });

  const outgoingTx = makeTx('tx-outgoing', { type: 'outgoing', amount: -300 });
  const incomingTx = makeTx('tx-incoming', { type: 'incoming', amount: 300 });

  const matched = await store.consumePendingContactLinks([outgoingTx, incomingTx], 'wallet-a');
  assert.equal(matched, 1);
  assert.equal(store.getLabelForTransaction('tx-outgoing', 'wallet-a'), null);
  assert.equal(store.getLabelForTransaction('tx-incoming', 'wallet-a'), 'Transfer from Personal');
});

await test('a default (outgoing) link only matches outgoing transactions', async () => {
  const store = freshStore();
  await store.enqueuePendingContactLink({
    recipientAddress: 'carol@example.test',
    amountSats: 150,
    walletId: 'wallet-a',
  });

  const incomingTx = makeTx('tx-incoming-2', { type: 'incoming', amount: 150 });
  const outgoingTx = makeTx('tx-outgoing-2', { type: 'outgoing', amount: -150 });

  const matched = await store.consumePendingContactLinks([incomingTx, outgoingTx], 'wallet-a');
  assert.equal(matched, 1);
  assert.equal(store.getMetadataForTransaction('tx-incoming-2', 'wallet-a'), null);
  assert.equal(
    store.getMetadataForTransaction('tx-outgoing-2', 'wallet-a').recipientAddress,
    'carol@example.test',
  );
});

// ---------------------------------------------------------------------------
// Sale breakdown — kiosk point-of-sale snapshot
// ---------------------------------------------------------------------------

await test('a sale breakdown stamps onto the right wallet-scoped key, and is not visible from another wallet with the same txId', async () => {
  const store = freshStore();
  const TX_ID = 'kiosk-sale-1';
  const breakdown = {
    baseSats: 1000,
    tipSats: 100,
    tipPercent: 10,
    roundUp: false,
    discountSats: 0,
    itemCount: 0,
    totalSats: 1100,
  };

  await store.setSaleBreakdownForTransaction(TX_ID, 'wallet-a', breakdown);
  assert.deepEqual(store.getSaleBreakdownForTransaction(TX_ID, 'wallet-a'), breakdown);
  assert.equal(store.getSaleBreakdownForTransaction(TX_ID, 'wallet-b'), null);
  assert.equal(store.getSaleBreakdownForTransaction(TX_ID), null);
});

await test('a sale breakdown is never overwritten once set', async () => {
  const store = freshStore();
  const TX_ID = 'kiosk-sale-2';
  const first = {
    baseSats: 500,
    tipSats: 0,
    tipPercent: null,
    roundUp: false,
    discountSats: 0,
    itemCount: 0,
    totalSats: 500,
  };
  const second = {
    baseSats: 999,
    tipSats: 50,
    tipPercent: 5,
    roundUp: false,
    discountSats: 0,
    itemCount: 3,
    totalSats: 1049,
  };

  await store.setSaleBreakdownForTransaction(TX_ID, 'wallet-a', first);
  await store.setSaleBreakdownForTransaction(TX_ID, 'wallet-a', second);
  assert.deepEqual(store.getSaleBreakdownForTransaction(TX_ID, 'wallet-a'), first);
});

await test('a write without a walletId is a no-op for saleBreakdown too', async () => {
  const store = freshStore();
  const result = await store.setSaleBreakdownForTransaction('some-tx', null, { totalSats: 500 });
  assert.equal(result, null);
  assert.equal(store.getSaleBreakdownForTransaction('some-tx', null), null);
  assert.equal(Object.keys(store.metadata).length, 0);
});

await test('a kiosk sale link carrying label/source/saleBreakdown stamps the breakdown once consumed, scoped to its wallet', async () => {
  const store = freshStore();
  const breakdown = {
    baseSats: 2000,
    tipSats: 200,
    tipPercent: 10,
    roundUp: false,
    discountSats: 0,
    itemCount: 2,
    totalSats: 2200,
  };
  await store.enqueuePendingContactLink({
    label: 'Kiosk sale',
    source: 'kiosk',
    direction: 'incoming',
    amountSats: 2200,
    saleBreakdown: breakdown,
    walletId: 'wallet-kiosk',
  });

  const tx = [makeTx('kiosk-tx-1', { type: 'incoming', amount: 2200 })];
  const matched = await store.consumePendingContactLinks(tx, 'wallet-kiosk');
  assert.equal(matched, 1);
  assert.deepEqual(store.getSaleBreakdownForTransaction('kiosk-tx-1', 'wallet-kiosk'), breakdown);
  // A different wallet reading the exact same bare tx id sees nothing.
  assert.equal(store.getSaleBreakdownForTransaction('kiosk-tx-1', 'wallet-other'), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
// Force-exit: importing the store transitively loads utils/fiatRates.js,
// whose singleton starts a real setInterval background refresh at module
// load (existing app behavior, untouched here). That interval otherwise
// keeps a plain `node` process alive forever, so this suite must exit
// explicitly on both outcomes rather than rely on the event loop draining.
process.exit(failed > 0 ? 1 : 0);
