/**
 * Private NIP-51 address-book sync tests.
 *
 * The serializer is pure; the encryption is deterministic given a
 * (sk, pk) pair (modulo the NIP-44 nonce); the publish/fetch surface
 * dispatches against an injected pool. Tests cover:
 *
 *   - serializer correctness: only nostr entries, only canonical
 *     fields, deterministic sort
 *   - encryption round-trip: encrypt + decrypt yields original
 *   - decrypt rejects ciphertext encrypted to a different identity
 *   - event builder produces a signed kind:30000 with the right d tag
 *   - fetchAddressBook applies the same correctness gates as
 *     fetchProfile (sig + author + d-tag check, freshness tie-break)
 *   - fetchAddressBook collapses network failures to null
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrAddressBook.spec.js
 */

import { strict as assert } from 'node:assert';
import { finalizeEvent, getPublicKey, nip44, verifyEvent } from 'nostr-core';
import {
  ADDRESS_BOOK_KIND,
  ADDRESS_BOOK_D_TAG,
  DEFAULT_RECOVERY_TIMEOUT_MS,
  buildAddressBookEvent,
  decryptAddressBookContent,
  deriveSelfConversationKey,
  deserializeContactPayload,
  encryptAddressBookContent,
  fetchAddressBook,
  mergeContactPayloads,
  partitionContactPayload,
  publishAddressBook,
  serializeContactPayload,
} from '../nostrAddressBook.js';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE_SECRET = new Uint8Array(32).fill(0x11);
const ALICE_PUBKEY = getPublicKey(ALICE_SECRET);
const BOB_SECRET = new Uint8Array(32).fill(0x22);
const BOB_PUBKEY = getPublicKey(BOB_SECRET);

function entryWith(overrides = {}) {
  return {
    id: 'addr-fix-1',
    name: 'Contact',
    address: 'pay@example.test',
    addressType: 'lightning',
    lightningAddress: 'pay@example.test',
    color: '#3B82F6',
    notes: '',
    isFavorite: false,
    lastUsedAt: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    source: 'nostr',
    nostr_pubkey: 'a'.repeat(64),
    nostr_npub: 'npub1somenpubvalue',
    nostr_event: { kind: 0, id: 'evt-id' },
    nostr_profile: { name: 'Contact', lud16: 'pay@example.test' },
    nostr_relay_hints: ['wss://relay.test'],
    last_synced_at: 1_700_000_000,
    name_locally_edited: false,
    ...overrides,
  };
}

function fakePool({ eventsByRelay = {}, throwError = null, latency = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async querySync(urls, filter, params) {
      calls.push({ urls: [...urls], filter, params });
      if (throwError) throw throwError;
      if (latency) await new Promise((r) => setTimeout(r, latency));
      const merged = [];
      for (const url of urls) {
        const evs = eventsByRelay[url] || [];
        merged.push(...evs);
      }
      return merged;
    },
    async ensureRelay(url) {
      return {
        publish: async (event) => { calls.push({ publish: url, event }); return ['OK', event.id, true, '']; },
      };
    },
  };
}

console.log('nostrAddressBook');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

await test('ADDRESS_BOOK_KIND is 30000 (NIP-51 categorised list)', () => {
  assert.equal(ADDRESS_BOOK_KIND, 30000);
});

await test('ADDRESS_BOOK_D_TAG is the buhogo identifier', () => {
  assert.equal(ADDRESS_BOOK_D_TAG, 'buhogo-address-book');
});

await test('DEFAULT_RECOVERY_TIMEOUT_MS is a sensible upper bound', () => {
  assert.ok(DEFAULT_RECOVERY_TIMEOUT_MS >= 3000);
  assert.ok(DEFAULT_RECOVERY_TIMEOUT_MS <= 15_000);
});

// ---------------------------------------------------------------------------
// serializeContactPayload
// ---------------------------------------------------------------------------

await test('serializeContactPayload: drops non-nostr entries', () => {
  const entries = [
    entryWith({ source: 'manual' }),
    entryWith({ source: undefined }),
  ];
  assert.deepEqual(serializeContactPayload(entries), []);
});

await test('serializeContactPayload: drops entries with malformed pubkey', () => {
  const entries = [
    entryWith({ nostr_pubkey: '' }),
    entryWith({ nostr_pubkey: 'not-hex' }),
    entryWith({ nostr_pubkey: 'a'.repeat(63) }),
  ];
  assert.deepEqual(serializeContactPayload(entries), []);
});

await test('serializeContactPayload: includes only canonical fields + updatedAt', () => {
  const entries = [entryWith({ nostr_pubkey: 'b'.repeat(64) })];
  const payload = serializeContactPayload(entries);
  assert.equal(payload.length, 1);
  const r = payload[0];
  assert.equal(r.pubkey, 'b'.repeat(64));
  assert.deepEqual(r.relays, ['wss://relay.test']);
  assert.equal(r.addedAt, 1_700_000_000);
  assert.equal(r.updatedAt, 1_700_000_000); // LWW clock — always present
  // omitted (no petname since name_locally_edited=false)
  assert.equal(r.petname, undefined);
  assert.equal(r.deleted, undefined);
  // cache fields never travel
  assert.equal(r.nostr_event, undefined);
  assert.equal(r.nostr_profile, undefined);
  assert.equal(r.color, undefined);
});

await test('serializeContactPayload: updatedAt falls back to createdAt when entry has none', () => {
  const entry = entryWith({ nostr_pubkey: 'b'.repeat(64), updatedAt: undefined, createdAt: 12345 });
  const payload = serializeContactPayload([entry]);
  assert.equal(payload[0].updatedAt, 12345);
});

await test('serializeContactPayload: petname appears iff name_locally_edited', () => {
  const a = entryWith({ name_locally_edited: true, name: 'My Friend' });
  const b = entryWith({ name_locally_edited: false, name: 'Other Name', nostr_pubkey: 'b'.repeat(64) });
  const payload = serializeContactPayload([a, b]);
  const aOut = payload.find((p) => p.pubkey === a.nostr_pubkey);
  const bOut = payload.find((p) => p.pubkey === b.nostr_pubkey);
  assert.equal(aOut.petname, 'My Friend');
  assert.equal(bOut.petname, undefined);
});

await test('serializeContactPayload: clamps a hostile-length petname', () => {
  const entry = entryWith({ name_locally_edited: true, name: 'x'.repeat(500) });
  const payload = serializeContactPayload([entry]);
  assert.equal(payload[0].petname.length, 80);
});

await test('serializeContactPayload: strips non-ws:// relay hints', () => {
  const entry = entryWith({
    nostr_relay_hints: ['wss://good.test', 'https://nope.test', '', null, 'ws://insecure.test'],
  });
  const payload = serializeContactPayload([entry]);
  assert.deepEqual(payload[0].relays, ['wss://good.test', 'ws://insecure.test']);
});

await test('serializeContactPayload: emits tombstones for deletions', () => {
  const entries = [entryWith({ nostr_pubkey: 'a'.repeat(64) })];
  const deletions = [{ pubkey: 'd'.repeat(64), deletedAt: 1_700_000_500 }];
  const payload = serializeContactPayload(entries, deletions);
  assert.equal(payload.length, 2);
  const tomb = payload.find((p) => p.pubkey === 'd'.repeat(64));
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.updatedAt, 1_700_000_500);
});

await test('serializeContactPayload: a live entry wins over a same-pubkey tombstone (re-add)', () => {
  // Defensive: addNostrContact purges the tombstone on re-add, but if
  // both somehow coexist the live record must win (no silent loss).
  const pk = 'a'.repeat(64);
  const entries = [entryWith({ nostr_pubkey: pk, updatedAt: 2000 })];
  const deletions = [{ pubkey: pk, deletedAt: 1000 }];
  const payload = serializeContactPayload(entries, deletions);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].deleted, undefined);
});

await test('serializeContactPayload: sorts by pubkey ascending (deterministic)', () => {
  const entries = [
    entryWith({ nostr_pubkey: 'c'.repeat(64) }),
    entryWith({ nostr_pubkey: 'a'.repeat(64) }),
    entryWith({ nostr_pubkey: 'b'.repeat(64) }),
  ];
  const payload = serializeContactPayload(entries);
  assert.deepEqual(payload.map((p) => p.pubkey), [
    'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64),
  ]);
});

await test('serializeContactPayload: tolerates non-array input', () => {
  assert.deepEqual(serializeContactPayload(null), []);
  assert.deepEqual(serializeContactPayload(undefined), []);
  assert.deepEqual(serializeContactPayload('foo'), []);
});

// ---------------------------------------------------------------------------
// deserializeContactPayload
// ---------------------------------------------------------------------------

await test('deserializeContactPayload: round-trip survives a valid payload', () => {
  const entries = [
    entryWith({ name_locally_edited: true, name: 'Alice', nostr_pubkey: 'a'.repeat(64) }),
    entryWith({ nostr_pubkey: 'b'.repeat(64) }),
  ];
  const payload = serializeContactPayload(entries, [{ pubkey: 'c'.repeat(64), deletedAt: 9000 }]);
  const text = JSON.stringify(payload);
  assert.deepEqual(deserializeContactPayload(text), payload);
});

await test('deserializeContactPayload: preserves tombstones', () => {
  const raw = JSON.stringify([
    { pubkey: 'a'.repeat(64), updatedAt: 1 },
    { pubkey: 'b'.repeat(64), deleted: true, updatedAt: 2 },
  ]);
  const out = deserializeContactPayload(raw);
  assert.equal(out.length, 2);
  assert.equal(out[1].deleted, true);
  assert.equal(out[1].updatedAt, 2);
});

await test('deserializeContactPayload: v1 payload (no updatedAt) falls back to addedAt', () => {
  // An address book published by an older build had no updatedAt.
  const raw = JSON.stringify([
    { pubkey: 'a'.repeat(64), addedAt: 555, petname: 'Old', relays: ['wss://x.test'] },
  ]);
  const out = deserializeContactPayload(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].updatedAt, 555); // synthesised from addedAt
  assert.equal(out[0].petname, 'Old');
});

await test('deserializeContactPayload: silently drops malformed rows', () => {
  const raw = JSON.stringify([
    { pubkey: 'a'.repeat(64), updatedAt: 1 },
    { pubkey: 'not-hex' },
    null,
    'oops',
    { pubkey: 'b'.repeat(64), updatedAt: 2, relays: ['wss://x.test'] },
  ]);
  const out = deserializeContactPayload(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].pubkey, 'a'.repeat(64));
  assert.equal(out[1].pubkey, 'b'.repeat(64));
  assert.deepEqual(out[1].relays, ['wss://x.test']);
});

await test('deserializeContactPayload: returns [] for non-JSON / non-array input', () => {
  assert.deepEqual(deserializeContactPayload(''), []);
  assert.deepEqual(deserializeContactPayload('  '), []);
  assert.deepEqual(deserializeContactPayload('not json'), []);
  assert.deepEqual(deserializeContactPayload('{"contacts": []}'), []); // object, not array
});

// ---------------------------------------------------------------------------
// mergeContactPayloads — the core no-data-loss guarantee
// ---------------------------------------------------------------------------

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

await test('mergeContactPayloads: union — a pubkey present in either side survives', () => {
  // Device A has Alice, device B (stale) has Bob. Neither must vanish.
  const deviceA = [{ pubkey: A, updatedAt: 100 }];
  const deviceB = [{ pubkey: B, updatedAt: 200 }];
  const merged = mergeContactPayloads(deviceA, deviceB);
  assert.deepEqual(merged.map((r) => r.pubkey), [A, B]);
});

await test('mergeContactPayloads: higher updatedAt wins the conflicting fields', () => {
  const older = [{ pubkey: A, updatedAt: 100, petname: 'Old name' }];
  const newer = [{ pubkey: A, updatedAt: 200, petname: 'New name' }];
  const merged = mergeContactPayloads(older, newer);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].petname, 'New name');
  assert.equal(merged[0].updatedAt, 200);
});

await test('mergeContactPayloads: a newer tombstone wins over an older live record', () => {
  const live = [{ pubkey: A, updatedAt: 100 }];
  const tomb = [{ pubkey: A, deleted: true, updatedAt: 200 }];
  const merged = mergeContactPayloads(live, tomb);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deleted, true);
});

await test('mergeContactPayloads: a newer live record wins over an older tombstone (re-add)', () => {
  const tomb = [{ pubkey: A, deleted: true, updatedAt: 100 }];
  const live = [{ pubkey: A, updatedAt: 200, petname: 'Back again' }];
  const merged = mergeContactPayloads(tomb, live);
  assert.equal(merged[0].deleted, undefined);
  assert.equal(merged[0].petname, 'Back again');
});

await test('mergeContactPayloads: exact updatedAt tie — live beats tombstone', () => {
  // A same-millisecond add-and-delete keeps the contact: losing a
  // contact is worse than keeping a stale one.
  const live = [{ pubkey: A, updatedAt: 500 }];
  const tomb = [{ pubkey: A, deleted: true, updatedAt: 500 }];
  assert.equal(mergeContactPayloads(live, tomb)[0].deleted, undefined);
  assert.equal(mergeContactPayloads(tomb, live)[0].deleted, undefined);
});

await test('mergeContactPayloads: two live records — addedAt is earliest, relays are unioned', () => {
  const x = [{ pubkey: A, updatedAt: 100, addedAt: 50, relays: ['wss://x.test'] }];
  const y = [{ pubkey: A, updatedAt: 200, addedAt: 999, relays: ['wss://y.test'] }];
  const merged = mergeContactPayloads(x, y);
  assert.equal(merged[0].addedAt, 50);            // earliest add time preserved
  assert.deepEqual(merged[0].relays.sort(), ['wss://x.test', 'wss://y.test']);
  assert.equal(merged[0].petname, undefined);     // winner (y) had no petname
});

await test('mergeContactPayloads: deterministic + sorted regardless of input order', () => {
  const m1 = mergeContactPayloads(
    [{ pubkey: B, updatedAt: 1 }],
    [{ pubkey: A, updatedAt: 1 }],
  );
  const m2 = mergeContactPayloads(
    [{ pubkey: A, updatedAt: 1 }],
    [{ pubkey: B, updatedAt: 1 }],
  );
  assert.deepEqual(m1, m2);
  assert.deepEqual(m1.map((r) => r.pubkey), [A, B]);
});

await test('mergeContactPayloads: tolerates non-array / garbage input', () => {
  assert.deepEqual(mergeContactPayloads(null, undefined), []);
  assert.deepEqual(
    mergeContactPayloads([{ pubkey: 'not-hex' }, null, 'x'], []),
    [],
  );
});

// ---------------------------------------------------------------------------
// partitionContactPayload
// ---------------------------------------------------------------------------

await test('partitionContactPayload: splits live records from tombstoned pubkeys', () => {
  const payload = [
    { pubkey: A, updatedAt: 1 },
    { pubkey: B, deleted: true, updatedAt: 2 },
  ];
  const { live, tombstonedPubkeys } = partitionContactPayload(payload);
  assert.deepEqual(live.map((r) => r.pubkey), [A]);
  assert.equal(tombstonedPubkeys.has(B), true);
  assert.equal(tombstonedPubkeys.has(A), false);
});

await test('partitionContactPayload: tolerates non-array input', () => {
  const { live, tombstonedPubkeys } = partitionContactPayload(null);
  assert.deepEqual(live, []);
  assert.equal(tombstonedPubkeys.size, 0);
});

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

await test('deriveSelfConversationKey: rejects bad secretKey', () => {
  assert.throws(
    () => deriveSelfConversationKey('not-bytes', ALICE_PUBKEY),
    /32-byte/i,
  );
});

await test('deriveSelfConversationKey: rejects bad pubkey', () => {
  assert.throws(
    () => deriveSelfConversationKey(ALICE_SECRET, 'not-hex'),
    /64-char/i,
  );
});

await test('encrypt/decrypt: round-trip yields original payload', () => {
  // Fully-formed records (with updatedAt) survive the round-trip
  // byte-for-byte; a tombstone is carried through too.
  const payload = [
    { pubkey: 'a'.repeat(64), updatedAt: 1_700_000_100, relays: ['wss://r.test'], petname: 'Alice', addedAt: 1_700_000_000 },
    { pubkey: 'b'.repeat(64), updatedAt: 1_700_000_050 },
    { pubkey: 'c'.repeat(64), deleted: true, updatedAt: 1_700_000_200 },
  ];
  const key = deriveSelfConversationKey(ALICE_SECRET, ALICE_PUBKEY);
  const ct = encryptAddressBookContent(payload, key);
  assert.equal(typeof ct, 'string');
  assert.ok(ct.length > 0);
  const pt = decryptAddressBookContent(ct, key);
  assert.deepEqual(pt, payload);
});

await test('decryptAddressBookContent: throws ADDRESS_BOOK_DECRYPT_FAILED when key is wrong', () => {
  const payload = [{ pubkey: 'a'.repeat(64) }];
  const aliceKey = deriveSelfConversationKey(ALICE_SECRET, ALICE_PUBKEY);
  const bobKey = deriveSelfConversationKey(BOB_SECRET, BOB_PUBKEY);
  const ct = encryptAddressBookContent(payload, aliceKey);
  assert.throws(
    () => decryptAddressBookContent(ct, bobKey),
    (err) => err.code === 'ADDRESS_BOOK_DECRYPT_FAILED',
  );
});

// ---------------------------------------------------------------------------
// buildAddressBookEvent
// ---------------------------------------------------------------------------

await test('buildAddressBookEvent: produces a signed kind:30000 with the d tag', () => {
  const payload = [{ pubkey: 'a'.repeat(64), addedAt: 1_700_000_000 }];
  const event = buildAddressBookEvent({
    secretKey: ALICE_SECRET,
    pubkey: ALICE_PUBKEY,
    payload,
    createdAt: 1_770_000_000,
  });
  assert.equal(event.kind, ADDRESS_BOOK_KIND);
  assert.equal(event.pubkey, ALICE_PUBKEY);
  assert.equal(event.created_at, 1_770_000_000);
  const dTag = event.tags.find((t) => t[0] === 'd');
  assert.ok(dTag, 'expected d tag');
  assert.equal(dTag[1], ADDRESS_BOOK_D_TAG);
  assert.ok(typeof event.content === 'string' && event.content.length > 0);
  assert.equal(verifyEvent(event), true);
});

await test('buildAddressBookEvent: content decrypts back to payload', () => {
  const payload = [
    { pubkey: 'a'.repeat(64), updatedAt: 150, petname: 'Alice', addedAt: 100 },
    { pubkey: 'b'.repeat(64), updatedAt: 120 },
  ];
  const event = buildAddressBookEvent({
    secretKey: ALICE_SECRET,
    pubkey: ALICE_PUBKEY,
    payload,
  });
  const key = deriveSelfConversationKey(ALICE_SECRET, ALICE_PUBKEY);
  assert.deepEqual(decryptAddressBookContent(event.content, key), payload);
});

await test('buildAddressBookEvent: defaults createdAt to now when omitted', () => {
  const before = Math.floor(Date.now() / 1000);
  const event = buildAddressBookEvent({
    secretKey: ALICE_SECRET,
    pubkey: ALICE_PUBKEY,
    payload: [],
  });
  const after = Math.floor(Date.now() / 1000);
  assert.ok(event.created_at >= before && event.created_at <= after + 1);
});

// ---------------------------------------------------------------------------
// fetchAddressBook
// ---------------------------------------------------------------------------

function signedAddressBookEventFor(secret, pubkeyHex, payload, createdAt) {
  const conversationKey = nip44.getConversationKey(secret, pubkeyHex);
  const content = nip44.encrypt(JSON.stringify(payload), conversationKey);
  return finalizeEvent({
    kind: ADDRESS_BOOK_KIND,
    created_at: createdAt,
    tags: [['d', ADDRESS_BOOK_D_TAG]],
    content,
  }, secret);
}

await test('fetchAddressBook: rejects non-hex pubkey', async () => {
  await assert.rejects(
    () => fetchAddressBook({ pool: fakePool(), pubkey: 'nope', secretKey: ALICE_SECRET }),
    /64-char/,
  );
});

await test('fetchAddressBook: rejects bad secretKey', async () => {
  await assert.rejects(
    () => fetchAddressBook({ pool: fakePool(), pubkey: ALICE_PUBKEY, secretKey: 'oops' }),
    /32-byte/,
  );
});

await test('fetchAddressBook: returns null when no relay has an event', async () => {
  const pool = fakePool({ eventsByRelay: {} });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result, null);
});

await test('fetchAddressBook: returns null on pool failure (never throws on network)', async () => {
  const pool = fakePool({ throwError: new Error('relay down') });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result, null);
});

await test('fetchAddressBook: decrypts a valid event for our key', async () => {
  const payload = [
    { pubkey: 'a'.repeat(64), updatedAt: 10, relays: ['wss://x.test'], addedAt: 1 },
    { pubkey: 'b'.repeat(64), updatedAt: 20, petname: 'Bob' },
    { pubkey: 'c'.repeat(64), deleted: true, updatedAt: 30 },
  ];
  const event = signedAddressBookEventFor(ALICE_SECRET, ALICE_PUBKEY, payload, 1_770_000_000);
  const pool = fakePool({ eventsByRelay: { 'wss://r.test': [event] } });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.ok(result);
  assert.equal(result.eventCreatedAt, 1_770_000_000);
  assert.deepEqual(result.contacts, payload);
});

await test('fetchAddressBook: rejects an event whose author does not match the requested pubkey', async () => {
  const payload = [{ pubkey: 'a'.repeat(64) }];
  // Bob signs an event but we ask for Alice's list — even if the
  // ciphertext happened to decrypt, the author gate stops it cold.
  const event = signedAddressBookEventFor(BOB_SECRET, BOB_PUBKEY, payload, 1_770_000_000);
  const pool = fakePool({ eventsByRelay: { 'wss://r.test': [event] } });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result, null);
});

await test('fetchAddressBook: rejects an event without the buhogo d tag', async () => {
  // Sign a real event but with a different d tag — the gate must
  // reject it so cross-app NIP-51 lists don't leak through.
  const payload = [{ pubkey: 'a'.repeat(64) }];
  const conversationKey = nip44.getConversationKey(ALICE_SECRET, ALICE_PUBKEY);
  const content = nip44.encrypt(JSON.stringify(payload), conversationKey);
  const event = finalizeEvent({
    kind: ADDRESS_BOOK_KIND,
    created_at: 1_770_000_000,
    tags: [['d', 'some-other-list']],
    content,
  }, ALICE_SECRET);
  const pool = fakePool({ eventsByRelay: { 'wss://r.test': [event] } });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result, null);
});

await test('fetchAddressBook: applies NIP-01 tie-break (newer wins)', async () => {
  const older = signedAddressBookEventFor(ALICE_SECRET, ALICE_PUBKEY, [{ pubkey: 'a'.repeat(64) }], 100);
  const newer = signedAddressBookEventFor(ALICE_SECRET, ALICE_PUBKEY, [{ pubkey: 'b'.repeat(64) }], 200);
  const pool = fakePool({
    eventsByRelay: {
      'wss://r1.test': [older],
      'wss://r2.test': [newer],
    },
  });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r1.test', 'wss://r2.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result.eventCreatedAt, 200);
  assert.equal(result.contacts[0].pubkey, 'b'.repeat(64));
});

await test('fetchAddressBook: rejects forged content (sig mismatch)', async () => {
  // Build a valid event, then corrupt its content. Spread won't
  // carry over nostr-core's verifiedSymbol cache when we explicitly
  // override the `content` field — the sig fails verification.
  const real = signedAddressBookEventFor(ALICE_SECRET, ALICE_PUBKEY, [{ pubkey: 'a'.repeat(64) }], 100);
  const forged = {
    id: real.id,
    pubkey: real.pubkey,
    kind: real.kind,
    tags: real.tags,
    content: 'tampered-base64',
    created_at: real.created_at,
    sig: real.sig,
  };
  const pool = fakePool({ eventsByRelay: { 'wss://r.test': [forged] } });
  const result = await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result, null);
});

await test('fetchAddressBook: threads timeoutMs into the pool call', async () => {
  const pool = fakePool();
  await fetchAddressBook({
    pool,
    relays: ['wss://r.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
    timeoutMs: 1234,
  });
  assert.equal(pool.calls[0].params.maxWait, 1234);
});

// ---------------------------------------------------------------------------
// publishAddressBook — surface check
// ---------------------------------------------------------------------------

await test('publishAddressBook: hands the event off through publishToRelaysEager', async () => {
  const pool = fakePool();
  const event = buildAddressBookEvent({
    secretKey: ALICE_SECRET,
    pubkey: ALICE_PUBKEY,
    payload: [{ pubkey: 'a'.repeat(64) }],
  });
  // Returns the raw eager-fanout pair; the store wraps it.
  const r = publishAddressBook({
    pool,
    relays: ['wss://r.test'],
    event,
    timeoutMs: 2000,
  });
  assert.ok(r);
  assert.ok(typeof r.firstAccept?.then === 'function');
  assert.ok(typeof r.allSettled?.then === 'function');
  const accepted = await r.firstAccept;
  assert.ok(accepted && accepted.ok === true, 'first-accept resolves');
  assert.equal(accepted.relay, 'wss://r.test');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
