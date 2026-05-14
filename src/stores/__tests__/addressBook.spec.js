/**
 * Address book store — schema + Nostr-sourced contact tests.
 *
 * Coverage focuses on the Plan 10 extension surface:
 *   - existing entries continue to load (backward compat — no migration)
 *   - addNostrContact builds the full kind:0 snapshot entry
 *   - addNostrContact enforces lud16-required + dedupe-by-pubkey rules
 *   - refreshContact merges newer events; ignores older ones; never
 *     overwrites a name the user locally edited; tolerates fetch
 *     failures without throwing
 *
 * The legacy add/update/delete paths are smoke-tested only — they were
 * exercised through the live app for months before this extension and
 * have no behavioural change here.
 *
 * Run directly with Node:
 *   node src/stores/__tests__/addressBook.spec.js
 */

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Browser-storage shim — must be set up BEFORE the store imports load,
// since they reference `localStorage` at module level via Pinia.
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
const { finalizeEvent, getPublicKey, nip19 } = await import('nostr-core');
const { useAddressBookStore, CONTACT_SOURCES } = await import('../addressBook.js');

const STORAGE_KEY = 'buhoGO_address_book';

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
  return useAddressBookStore();
}

// ---------------------------------------------------------------------------
// Nostr fixtures
//
// Two deterministic keypairs are enough for every dedupe / wrong-author
// edge case the spec needs. `makeKind0` returns a genuinely signed
// event so the entry's `nostr_event` snapshot is verifiable end-to-end
// (matches what arrives from a real relay).
// ---------------------------------------------------------------------------

const ALICE_SECRET = new Uint8Array(32).fill(0x11);
const ALICE_PUBKEY = getPublicKey(ALICE_SECRET);
const ALICE_NPUB = nip19.npubEncode(ALICE_PUBKEY);

const BOB_SECRET = new Uint8Array(32).fill(0x22);
const BOB_PUBKEY = getPublicKey(BOB_SECRET);
const BOB_NPUB = nip19.npubEncode(BOB_PUBKEY);

function makeKind0(secret, content, createdAt = Math.floor(Date.now() / 1000)) {
  return finalizeEvent({
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
    created_at: createdAt,
  }, secret);
}

console.log('addressBook store');

// ---------------------------------------------------------------------------
// Backward compatibility — existing v1 entries must keep working
// ---------------------------------------------------------------------------

await test('initialize: loads legacy entries without `source` field', async () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([
    {
      id: 'addr-legacy-1',
      name: 'Legacy Lightning',
      address: 'alice@walletofsatoshi.com',
      addressType: 'lightning',
      lightningAddress: 'alice@walletofsatoshi.com',
      color: '#3B82F6',
      notes: '',
      isFavorite: false,
      lastUsedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
  ]));
  setActivePinia(createPinia());
  const store = useAddressBookStore();
  await store.initialize();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].name, 'Legacy Lightning');
  assert.equal(store.entries[0].source, undefined); // no migration touch
});

await test('nostrEntries: empty when only legacy entries exist', async () => {
  const store = freshStore();
  await store.addEntry({
    name: 'Plain',
    address: 'plain@walletofsatoshi.com',
    addressType: 'lightning',
  });
  assert.deepEqual(store.nostrEntries, []);
});

await test('findContactByPubkey: rejects garbage input without throwing', async () => {
  const store = freshStore();
  assert.equal(store.findContactByPubkey(null), null);
  assert.equal(store.findContactByPubkey(''), null);
  assert.equal(store.findContactByPubkey('not-hex'), null);
  assert.equal(store.findContactByPubkey('z'.repeat(64)), null);
});

// ---------------------------------------------------------------------------
// addNostrContact — input validation
// ---------------------------------------------------------------------------

await test('addNostrContact: rejects non-hex pubkey', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'alice@wos.com' });
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: 'not-a-real-pubkey',
      npub: ALICE_NPUB,
      event,
    }),
    /Invalid Nostr pubkey/,
  );
});

await test('addNostrContact: rejects malformed npub', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'alice@wos.com' });
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: ALICE_PUBKEY,
      npub: 'nope',
      event,
    }),
    /Invalid Nostr identifier/,
  );
});

await test('addNostrContact: rejects when event.pubkey mismatches pubkey arg', async () => {
  const store = freshStore();
  // Bob's event paired with Alice's pubkey arg — caller-side mismatch.
  const event = makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@wos.com' });
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: ALICE_PUBKEY,
      npub: ALICE_NPUB,
      event,
    }),
    /Profile event is missing or invalid/,
  );
});

await test('addNostrContact: rejects non-kind-0 events', async () => {
  const store = freshStore();
  const wrongKind = finalizeEvent({
    kind: 1,
    tags: [],
    content: 'hello',
    created_at: Math.floor(Date.now() / 1000),
  }, ALICE_SECRET);
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: ALICE_PUBKEY,
      npub: ALICE_NPUB,
      event: wrongKind,
    }),
    /Profile event is missing or invalid/,
  );
});

await test('addNostrContact: rejects profiles without lud16', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'Alice' /* no lud16 */ });
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: ALICE_PUBKEY,
      npub: ALICE_NPUB,
      event,
    }),
    /does not have a Lightning address/,
  );
});

await test('addNostrContact: rejects malformed lud16 values', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'not-an-email' });
  await assert.rejects(
    () => store.addNostrContact({
      pubkey: ALICE_PUBKEY,
      npub: ALICE_NPUB,
      event,
    }),
    /does not have a Lightning address/,
  );
});

// ---------------------------------------------------------------------------
// addNostrContact — happy path + dedupe
// ---------------------------------------------------------------------------

await test('addNostrContact: persists a full kind:0 snapshot entry', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, {
    display_name: 'Alice Wonder',
    name: 'alicew',
    picture: 'https://example.test/a.png',
    lud16: 'alice@walletofsatoshi.com',
    about: 'satoshi was here',
  }, 1_700_000_000);

  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
    relayHints: ['wss://relay.example.test'],
  });

  assert.equal(entry.source, CONTACT_SOURCES.NOSTR);
  assert.equal(entry.nostr_pubkey, ALICE_PUBKEY);
  assert.equal(entry.nostr_npub, ALICE_NPUB);
  // display_name preferred over name
  assert.equal(entry.name, 'Alice Wonder');
  // address derived strictly from lud16
  assert.equal(entry.address, 'alice@walletofsatoshi.com');
  assert.equal(entry.lightningAddress, 'alice@walletofsatoshi.com');
  assert.equal(entry.addressType, 'lightning');
  // full kind:0 snapshot persisted
  assert.equal(entry.nostr_event.id, event.id);
  assert.equal(entry.nostr_event.created_at, 1_700_000_000);
  assert.equal(entry.nostr_event.sig, event.sig);
  // parsed profile available for the detail view
  assert.equal(entry.nostr_profile.about, 'satoshi was here');
  assert.equal(entry.nostr_profile.picture, 'https://example.test/a.png');
  // relay hints sanitized + kept
  assert.deepEqual(entry.nostr_relay_hints, ['wss://relay.example.test']);
  // override flag starts false
  assert.equal(entry.name_locally_edited, false);
  // last_synced_at populated on add
  assert.equal(typeof entry.last_synced_at, 'number');

  // and the entry is actually in the store + persisted
  assert.equal(store.entries.length, 1);
  const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  assert.equal(persisted[0].nostr_event.id, event.id);
});

await test('addNostrContact: display-name fallback chain', async () => {
  const store = freshStore();
  // No display_name → falls through to `name`.
  const event = makeKind0(ALICE_SECRET, { name: 'plainname', lud16: 'a@a.test' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  assert.equal(entry.name, 'plainname');
});

await test('addNostrContact: falls back to shortened npub when name is missing', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { lud16: 'a@a.test' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  assert.ok(entry.name.startsWith('npub1'));
  assert.ok(entry.name.endsWith('…'));
});

await test('addNostrContact: strips non-ws:// relay hints', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
    relayHints: [
      'wss://good.test',
      'https://not-a-relay.test',
      '',
      null,
      'ws://insecure-but-allowed.test',
    ],
  });
  assert.deepEqual(entry.nostr_relay_hints, [
    'wss://good.test',
    'ws://insecure-but-allowed.test',
  ]);
});

await test('addNostrContact: rejects duplicate pubkey', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  await store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event });
  // Same pubkey, different lud16 — still a duplicate.
  const event2 = makeKind0(ALICE_SECRET, { name: 'A-renamed', lud16: 'a2@a.test' });
  await assert.rejects(
    () => store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event: event2 }),
    /already in your address book/,
  );
});

await test('addNostrContact: rejects when lud16 collides with an existing manual entry', async () => {
  const store = freshStore();
  await store.addEntry({
    name: 'Plain',
    address: 'shared@shared.test',
    addressType: 'lightning',
  });
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'shared@shared.test' });
  await assert.rejects(
    () => store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event }),
    /Lightning address already exists/,
  );
});

await test('addNostrContact: getter nostrEntries returns only nostr-sourced entries', async () => {
  const store = freshStore();
  await store.addEntry({
    name: 'Manual',
    address: 'manual@m.test',
    addressType: 'lightning',
  });
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  await store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event });
  assert.equal(store.entries.length, 2);
  assert.equal(store.nostrEntries.length, 1);
  assert.equal(store.nostrEntries[0].nostr_pubkey, ALICE_PUBKEY);
});

await test('findContactByPubkey: returns the matching nostr entry', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  await store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event });
  const hit = store.findContactByPubkey(ALICE_PUBKEY.toUpperCase());
  assert.ok(hit);
  assert.equal(hit.nostr_pubkey, ALICE_PUBKEY);
});

// ---------------------------------------------------------------------------
// refreshContact
// ---------------------------------------------------------------------------

await test('refreshContact: throws when the id does not exist', async () => {
  const store = freshStore();
  await assert.rejects(() => store.refreshContact('nope'), /Entry not found/);
});

await test('refreshContact: no-op for manual contacts', async () => {
  const store = freshStore();
  const manual = await store.addEntry({
    name: 'Manual',
    address: 'manual@m.test',
    addressType: 'lightning',
  });
  const result = await store.refreshContact(manual.id, {
    fetcher: async () => { throw new Error('must not call fetcher'); },
  });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'not-a-nostr-contact');
});

await test('refreshContact: updates address + name when a newer event arrives', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const initial = makeKind0(ALICE_SECRET, {
    display_name: 'Alice v1',
    lud16: 'old@a.test',
  }, t0);
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: initial,
    relayHints: ['wss://relay.a.test'],
  });

  const newer = makeKind0(ALICE_SECRET, {
    display_name: 'Alice v2',
    picture: 'https://example.test/v2.png',
    lud16: 'new@a.test',
  }, t0 + 60);

  let receivedRelays = null;
  const result = await store.refreshContact(entry.id, {
    fetcher: async (pubkey, opts) => {
      receivedRelays = opts?.relays;
      return newer;
    },
  });

  assert.equal(result.updated, true);
  assert.equal(result.reason, 'synced');
  // Refresh consulted the stored relay hints, not the global defaults.
  assert.deepEqual(receivedRelays, ['wss://relay.a.test']);
  const after = store.entries.find(e => e.id === entry.id);
  assert.equal(after.name, 'Alice v2');
  assert.equal(after.address, 'new@a.test');
  assert.equal(after.lightningAddress, 'new@a.test');
  assert.equal(after.nostr_profile.picture, 'https://example.test/v2.png');
  assert.equal(after.nostr_event.id, newer.id);
  assert.ok(after.last_synced_at >= after.createdAt);
});

await test('refreshContact: preserves user-edited name on sync', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const initial = makeKind0(ALICE_SECRET, {
    display_name: 'Alice v1',
    lud16: 'old@a.test',
  }, t0);
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: initial,
  });

  // User renames Alice locally.
  await store.updateEntry(entry.id, { name: 'My friend Alice' });

  const newer = makeKind0(ALICE_SECRET, {
    display_name: 'Alice v2',
    lud16: 'new@a.test',
  }, t0 + 60);

  const result = await store.refreshContact(entry.id, { fetcher: async () => newer });
  assert.equal(result.updated, true);
  const after = store.entries.find(e => e.id === entry.id);
  // Address still syncs.
  assert.equal(after.address, 'new@a.test');
  // Name stays locally edited.
  assert.equal(after.name, 'My friend Alice');
  assert.equal(after.name_locally_edited, true);
});

await test('refreshContact: renaming back to derived value clears the override flag', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const initial = makeKind0(ALICE_SECRET, {
    display_name: 'Alice v1',
    lud16: 'old@a.test',
  }, t0);
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: initial,
  });
  // User edits then restores.
  await store.updateEntry(entry.id, { name: 'Friend' });
  await store.updateEntry(entry.id, { name: 'Alice v1' });
  const after = store.entries.find(e => e.id === entry.id);
  assert.equal(after.name_locally_edited, false);
});

await test('refreshContact: keeps last-known address when the new profile drops lud16', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const initial = makeKind0(ALICE_SECRET, {
    display_name: 'Alice',
    lud16: 'pay@a.test',
  }, t0);
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: initial,
  });
  const newer = makeKind0(ALICE_SECRET, {
    display_name: 'Alice (no lud16)',
    about: 'going offline',
  }, t0 + 60);
  await store.refreshContact(entry.id, { fetcher: async () => newer });
  const after = store.entries.find(e => e.id === entry.id);
  // Address survives the drop so the user can still attempt payment.
  assert.equal(after.address, 'pay@a.test');
  // But the snapshot reflects reality.
  assert.equal(after.nostr_profile.lud16, undefined);
});

await test('refreshContact: older event is ignored but last_synced_at bumps', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const initial = makeKind0(ALICE_SECRET, {
    display_name: 'Alice',
    lud16: 'pay@a.test',
  }, t0);
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: initial,
  });
  const olderEvent = makeKind0(ALICE_SECRET, {
    display_name: 'old',
    lud16: 'old@a.test',
  }, t0 - 60);
  const beforeSync = store.entries.find(e => e.id === entry.id).last_synced_at;
  // Ensure the clock can advance before we re-sync.
  await new Promise((r) => setTimeout(r, 2));
  const result = await store.refreshContact(entry.id, { fetcher: async () => olderEvent });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'not-newer');
  const after = store.entries.find(e => e.id === entry.id);
  // Content untouched.
  assert.equal(after.name, 'Alice');
  assert.equal(after.address, 'pay@a.test');
  // last_synced_at still advanced so the UI can show "checked Xs ago".
  assert.ok(after.last_synced_at >= beforeSync);
});

await test('refreshContact: fetcher returning null is a graceful no-op', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  const result = await store.refreshContact(entry.id, { fetcher: async () => null });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'no-event');
});

await test('refreshContact: fetch errors collapse to a typed result, not a throw', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  const boom = new Error('relay timeout');
  const result = await store.refreshContact(entry.id, {
    fetcher: async () => { throw boom; },
  });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'fetch-error');
  assert.equal(result.error, boom);
});

// ---------------------------------------------------------------------------
// Cross-cut: dedupe + persistence after a roundtrip
// ---------------------------------------------------------------------------

await test('addNostrContact + reload: entry survives a localStorage roundtrip', async () => {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  const first = useAddressBookStore();
  const event = makeKind0(ALICE_SECRET, {
    display_name: 'Alice',
    lud16: 'alice@a.test',
  });
  await first.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });

  // Simulate page reload: same storage backend, new Pinia instance.
  setActivePinia(createPinia());
  const second = useAddressBookStore();
  await second.initialize();
  assert.equal(second.entries.length, 1);
  const entry = second.entries[0];
  assert.equal(entry.source, CONTACT_SOURCES.NOSTR);
  assert.equal(entry.nostr_pubkey, ALICE_PUBKEY);
  assert.equal(entry.nostr_event.sig, event.sig);
});

// ---------------------------------------------------------------------------
// syncToNostr — pushes the contact list to the user's NIP-51 event
// ---------------------------------------------------------------------------

const {
  ADDRESS_BOOK_KIND,
  ADDRESS_BOOK_D_TAG,
  deriveSelfConversationKey,
  decryptAddressBookContent,
} = await import('../../utils/nostrAddressBook.js');
const { verifyEvent: verifyEv } = await import('nostr-core');

/**
 * Minimal identity-store stub. The real store reads the encrypted
 * mnemonic + derives via NIP-06; for unit tests we hand the secret
 * key in directly so the sync path stays pure and synchronous.
 */
function fakeIdentity({ pubkey, secret }) {
  return {
    bootstrapped: true,
    nostrPubkeyHex: pubkey,
    async getNostrSecretKeyBytes() { return new Uint8Array(secret); },
  };
}

/**
 * Fake pool that records every publish/query, returns a configurable
 * verdict per relay for publish, and serves canned events for query.
 */
function syncFakePool({ publish = 'ok', events = {} } = {}) {
  const calls = { publish: [], query: [] };
  return {
    calls,
    async ensureRelay(url) {
      return {
        publish: async (event) => {
          calls.publish.push({ url, event });
          if (publish === 'ok') return ['OK', event.id, true, ''];
          // publishOneRelay collapses every relay failure to ok:false
          // by treating the publish promise's rejection as the signal.
          if (publish === 'fail') throw new Error('relay rejected');
          throw new Error('hang');
        },
      };
    },
    async querySync(urls, filter, params) {
      calls.query.push({ urls: [...urls], filter, params });
      const merged = [];
      for (const url of urls) {
        if (Array.isArray(events[url])) merged.push(...events[url]);
      }
      return merged;
    },
  };
}

await test('syncToNostr: skipped when identity not bootstrapped', async () => {
  const store = freshStore();
  const result = await store.syncToNostr({ identityStore: { bootstrapped: false } });
  assert.equal(result?.skipped, true);
  assert.equal(result.reason, 'identity-not-bootstrapped');
});

await test('syncToNostr: skipped when there are no nostr-sourced contacts', async () => {
  const store = freshStore();
  await store.addEntry({ name: 'Plain', address: 'plain@a.test', addressType: 'lightning' });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
  });
  assert.equal(result?.skipped, true);
  assert.equal(result.reason, 'no-nostr-contacts');
});

await test('syncToNostr: publishes a signed kind:30000 with the buhogo d tag', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice', lud16: 'a@a.test' }),
  });
  const pool = syncFakePool();
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedRelay, 'wss://r.test');
  assert.equal(result.contactsPublished, 1);
  // The actual event hit the publish call.
  assert.equal(pool.calls.publish.length, 1);
  const sent = pool.calls.publish[0].event;
  assert.equal(sent.kind, ADDRESS_BOOK_KIND);
  assert.equal(sent.pubkey, ALICE_PUBKEY);
  const dTag = sent.tags.find((t) => t[0] === 'd');
  assert.equal(dTag[1], ADDRESS_BOOK_D_TAG);
  assert.equal(verifyEv(sent), true);
});

await test('syncToNostr: ciphertext decrypts back to exactly the synced payload', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice', lud16: 'a@a.test' }),
    relayHints: ['wss://hint.test'],
  });
  // Locally rename so petname propagates.
  const entry = store.entries[0];
  await store.updateEntry(entry.id, { name: 'Bestie' });

  const pool = syncFakePool();
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  const sent = pool.calls.publish[0].event;
  const key = deriveSelfConversationKey(new Uint8Array(ALICE_SECRET), ALICE_PUBKEY);
  const payload = decryptAddressBookContent(sent.content, key);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].pubkey, ALICE_PUBKEY);
  assert.deepEqual(payload[0].relays, ['wss://hint.test']);
  assert.equal(payload[0].petname, 'Bestie');
});

await test('syncToNostr: clears syncDirty + bumps lastSyncedAt on success', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice', lud16: 'a@a.test' }),
  });
  assert.equal(store.syncDirty, true);
  assert.equal(store.lastSyncedAt, null);
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(store.syncDirty, false);
  assert.ok(Number.isFinite(store.lastSyncedAt));
});

await test('syncToNostr: every-relay-rejects yields ok:false + records error code', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice', lud16: 'a@a.test' }),
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ publish: 'fail' }),
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, false);
  assert.equal(store.lastSyncError, 'ALL_RELAYS_REJECTED');
  assert.equal(store.syncDirty, true); // unchanged — caller may retry
});

await test('addNostrContact: marks syncDirty', async () => {
  const store = freshStore();
  assert.equal(store.syncDirty, false);
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' }),
  });
  assert.equal(store.syncDirty, true);
});

await test('deleteEntry: marks syncDirty for a nostr entry', async () => {
  const store = freshStore();
  const e = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' }),
  });
  // First sync to clear dirty
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(store.syncDirty, false);
  await store.deleteEntry(e.id);
  assert.equal(store.syncDirty, true);
});

await test('deleteEntry: does NOT mark syncDirty for a manual entry', async () => {
  const store = freshStore();
  const manual = await store.addEntry({
    name: 'Plain', address: 'p@p.test', addressType: 'lightning',
  });
  // Add then sync a nostr contact so dirty starts false.
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'A', lud16: 'a@a.test' }),
  });
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  await store.deleteEntry(manual.id);
  assert.equal(store.syncDirty, false);
});

await test('updateEntry: petname flip on a nostr entry marks dirty', async () => {
  const store = freshStore();
  const e = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'a@a.test' }),
  });
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(store.syncDirty, false);
  // Rename → name_locally_edited flips → dirty
  await store.updateEntry(e.id, { name: 'Buddy' });
  assert.equal(store.syncDirty, true);
});

await test('updateEntry: a notes-only change does NOT mark dirty', async () => {
  const store = freshStore();
  const e = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'a@a.test' }),
  });
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  await store.updateEntry(e.id, { notes: 'lunch buddy' });
  assert.equal(store.syncDirty, false);
});

// ---------------------------------------------------------------------------
// recoverFromNostr
// ---------------------------------------------------------------------------

function buildRemoteAddressBookEvent(payload, { secret, pubkey, createdAt = 1_700_000_000 } = {}) {
  const { finalizeEvent, nip44 } = require('nostr-core'); // dynamic import would force async
  const key = nip44.getConversationKey(new Uint8Array(secret), pubkey);
  const content = nip44.encrypt(JSON.stringify(payload), key);
  return finalizeEvent({
    kind: ADDRESS_BOOK_KIND,
    created_at: createdAt,
    tags: [['d', ADDRESS_BOOK_D_TAG]],
    content,
  }, new Uint8Array(secret));
}

// Have to use dynamic import because Node ESM doesn't support require —
// re-do the helper async-style.
async function makeRemoteEvent(payload, { secret, pubkey, createdAt = 1_700_000_000 } = {}) {
  const { finalizeEvent, nip44 } = await import('nostr-core');
  const key = nip44.getConversationKey(new Uint8Array(secret), pubkey);
  const content = nip44.encrypt(JSON.stringify(payload), key);
  return finalizeEvent({
    kind: ADDRESS_BOOK_KIND,
    created_at: createdAt,
    tags: [['d', ADDRESS_BOOK_D_TAG]],
    content,
  }, new Uint8Array(secret));
}

await test('recoverFromNostr: hadRemote=false when relays have no list', async () => {
  const store = freshStore();
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.hadRemote, false);
  assert.equal(result.restored, 0);
});

await test('recoverFromNostr: rebuilds a contact from the remote list + fresh kind:0', async () => {
  const store = freshStore();
  const remoteList = [
    { pubkey: BOB_PUBKEY, relays: ['wss://bob-hint.test'], addedAt: 1_700_000_000 },
  ];
  const remoteEvent = await makeRemoteEvent(remoteList, {
    secret: ALICE_SECRET, pubkey: ALICE_PUBKEY,
  });
  const bobProfileEvent = makeKind0(BOB_SECRET, {
    display_name: 'Bob the Builder',
    lud16: 'bob@bob.test',
  });
  // Inject a fake fetchProfile that returns Bob's kind:0.
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async (pk) => (pk === BOB_PUBKEY ? bobProfileEvent : null),
  });
  assert.equal(result.ok, true);
  assert.equal(result.hadRemote, true);
  assert.equal(result.restored, 1);
  assert.equal(store.entries.length, 1);
  const restored = store.entries[0];
  assert.equal(restored.source, CONTACT_SOURCES.NOSTR);
  assert.equal(restored.nostr_pubkey, BOB_PUBKEY);
  assert.equal(restored.address, 'bob@bob.test');
  // addedAt was preserved
  assert.equal(restored.createdAt, 1_700_000_000);
});

await test('recoverFromNostr: applies the synced petname when restoring', async () => {
  const store = freshStore();
  const remoteList = [
    { pubkey: BOB_PUBKEY, petname: 'Bobby' },
  ];
  const remoteEvent = await makeRemoteEvent(remoteList, {
    secret: ALICE_SECRET, pubkey: ALICE_PUBKEY,
  });
  const bobProfileEvent = makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' });
  await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => bobProfileEvent,
  });
  assert.equal(store.entries[0].name, 'Bobby');
  assert.equal(store.entries[0].name_locally_edited, true);
});

await test('recoverFromNostr: counts unpayable contacts whose kind:0 lacks lud16', async () => {
  const store = freshStore();
  const remoteList = [{ pubkey: BOB_PUBKEY }];
  const remoteEvent = await makeRemoteEvent(remoteList, {
    secret: ALICE_SECRET, pubkey: ALICE_PUBKEY,
  });
  const bobNoLud16 = makeKind0(BOB_SECRET, { name: 'Bob' /* no lud16 */ });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => bobNoLud16,
  });
  assert.equal(result.restored, 0);
  assert.equal(result.unpayable, 1);
  assert.equal(store.entries.length, 0);
});

await test('recoverFromNostr: skips contacts already in the local book + merges synced petname when local name isnt edited', async () => {
  const store = freshStore();
  const existing = await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  assert.equal(existing.name_locally_edited, false);

  const remoteList = [{ pubkey: BOB_PUBKEY, petname: 'My Bobby' }];
  const remoteEvent = await makeRemoteEvent(remoteList, {
    secret: ALICE_SECRET, pubkey: ALICE_PUBKEY,
  });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => { throw new Error('must not refetch'); },
  });
  assert.equal(result.skipped, 1);
  // Synced petname adopted because we hadn't locally edited.
  assert.equal(store.entries[0].name, 'My Bobby');
  assert.equal(store.entries[0].name_locally_edited, true);
});

await test('recoverFromNostr: keeps local name when user has already locally edited', async () => {
  const store = freshStore();
  const existing = await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  await store.updateEntry(existing.id, { name: 'Local Bob' });
  assert.equal(store.entries[0].name_locally_edited, true);

  const remoteList = [{ pubkey: BOB_PUBKEY, petname: 'Remote Bobby' }];
  const remoteEvent = await makeRemoteEvent(remoteList, {
    secret: ALICE_SECRET, pubkey: ALICE_PUBKEY,
  });
  await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => { throw new Error('must not refetch'); },
  });
  assert.equal(store.entries[0].name, 'Local Bob');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
