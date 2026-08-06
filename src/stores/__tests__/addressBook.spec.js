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
 *   - syncToNostr / recoverFromNostr fetch-merge-publish against the
 *     NIP-51 list so no device clobbers another's writes; deletes
 *     travel as tombstones; identity-only contacts survive recovery
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

// A third identity — only the union-merge tests need it, where the
// local book and the remote list each know a *different* contact.
const CAROL_SECRET = new Uint8Array(32).fill(0x33);
const CAROL_PUBKEY = getPublicKey(CAROL_SECRET);
const CAROL_NPUB = nip19.npubEncode(CAROL_PUBKEY);

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

// --- Trust-boundary hardening (Finding 6) -----------------------------------

await test('addNostrContact: rejects an event with a forged signature', async () => {
  const store = freshStore();
  // Build a genuinely-signed event, then tamper the content with
  // explicit field copies so nostr-core's verifiedSymbol cache does
  // NOT carry over — the signature must actually re-fail.
  const real = makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'alice@a.test' });
  const forged = {
    id: real.id,
    pubkey: real.pubkey,
    kind: real.kind,
    tags: real.tags,
    content: JSON.stringify({ name: 'Mallory', lud16: 'mallory@evil.test' }),
    created_at: real.created_at,
    sig: real.sig,
  };
  await assert.rejects(
    () => store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event: forged }),
    /signature is invalid/,
  );
});

await test('addNostrContact: rejects an oversized event content blob', async () => {
  const store = freshStore();
  // 70 KB of content — well past the 64 KB ceiling. Genuinely signed
  // so it gets past the signature gate and trips the size gate.
  const huge = makeKind0(ALICE_SECRET, {
    name: 'Alice',
    lud16: 'alice@a.test',
    about: 'x'.repeat(70 * 1024),
  });
  await assert.rejects(
    () => store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event: huge }),
    /too large/,
  );
});

await test('addNostrContact: clamps oversized profile fields in the stored snapshot', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, {
    name: 'n'.repeat(500),
    about: 'a'.repeat(5000),
    lud16: 'alice@a.test',
  });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  // name capped at 256, about capped at 2048 — the un-clamped truth
  // still lives in nostr_event.content.
  assert.equal(entry.nostr_profile.name.length, 256);
  assert.equal(entry.nostr_profile.about.length, 2048);
  // Raw event content is untouched — it's the source of record.
  assert.ok(entry.nostr_event.content.length > 5000);
});

await test('addNostrContact: drops unknown profile fields from the stored snapshot', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, {
    name: 'Alice',
    lud16: 'alice@a.test',
    weird_attacker_field: 'z'.repeat(1000),
  });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
  });
  assert.equal(entry.nostr_profile.weird_attacker_field, undefined);
  assert.equal(entry.nostr_profile.name, 'Alice');
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

// --- Identity-only contacts (Finding 4) -------------------------------------

await test('addNostrContact: allowWithoutLightningAddress stores an identity-only contact', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { display_name: 'Alice', about: 'no lud16 here' });
  const entry = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event,
    allowWithoutLightningAddress: true,
  });
  assert.equal(entry.source, CONTACT_SOURCES.NOSTR);
  assert.equal(entry.nostr_pubkey, ALICE_PUBKEY);
  assert.equal(entry.address, '');
  assert.equal(entry.lightningAddress, '');
  assert.equal(entry.name, 'Alice');
  assert.equal(store.isEntryPayable(entry), false);
});

await test('addNostrContact: interactive flow still rejects no-lud16 without the flag', async () => {
  const store = freshStore();
  const event = makeKind0(ALICE_SECRET, { display_name: 'Alice' });
  await assert.rejects(
    () => store.addNostrContact({ pubkey: ALICE_PUBKEY, npub: ALICE_NPUB, event }),
    /does not have a Lightning address/,
  );
});

await test('isEntryPayable: true for a normal nostr contact, false for identity-only', async () => {
  const store = freshStore();
  const payable = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { name: 'Alice', lud16: 'alice@a.test' }),
  });
  const identityOnly = await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob' }),
    allowWithoutLightningAddress: true,
  });
  assert.equal(store.isEntryPayable(payable), true);
  assert.equal(store.isEntryPayable(identityOnly), false);
});

await test('refreshContact: promotes an identity-only contact to payable when lud16 appears', async () => {
  const store = freshStore();
  const t0 = 1_700_000_000;
  const identityOnly = await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice' }, t0),
    allowWithoutLightningAddress: true,
  });
  assert.equal(store.isEntryPayable(identityOnly), false);
  // Alice publishes a newer kind:0 that now carries a lud16.
  const newer = makeKind0(ALICE_SECRET, {
    display_name: 'Alice',
    lud16: 'alice@a.test',
  }, t0 + 60);
  await store.refreshContact(identityOnly.id, { fetcher: async () => newer });
  const after = store.entries.find(e => e.id === identityOnly.id);
  assert.equal(after.address, 'alice@a.test');
  assert.equal(store.isEntryPayable(after), true);
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
// syncToNostr — fetch, reconcile, merge, publish against the shared
// contacts doc (kind:30078, the ecosystem wire format)
// ---------------------------------------------------------------------------

const {
  CONTACTS_DOC_KIND,
  CONTACTS_DOC_D_TAG,
} = await import('../../utils/nostrContactsDoc.js');
const {
  ADDRESS_BOOK_KIND,
  ADDRESS_BOOK_D_TAG,
  deriveSelfConversationKey,
} = await import('../../utils/nostrAddressBook.js');
const { verifyEvent: verifyEv, nip44: nip44mod } = await import('nostr-core');

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
 * Events are filtered by kind so the doc fetch, the legacy-migration
 * fetch, and the NIP-65 fetch each see only what a real relay would
 * return for their filter.
 */
function syncFakePool({ publish = 'ok', events = {}, unreachable = [] } = {}) {
  const calls = { publish: [], query: [] };
  return {
    calls,
    // Rejecting here is how a real pool signals a failed handshake —
    // the reachability probe AND the publish fan-out both go through
    // ensureRelay, so an unreachable relay fails both, like reality.
    async ensureRelay(url) {
      if (unreachable.includes(url)) throw new Error('connect failed');
      return {
        connected: true,
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
      const kinds = Array.isArray(filter?.kinds) ? filter.kinds : null;
      const merged = [];
      for (const url of urls) {
        if (unreachable.includes(url) || !Array.isArray(events[url])) continue;
        for (const ev of events[url]) {
          if (!kinds || kinds.includes(ev.kind)) merged.push(ev);
        }
      }
      return merged;
    },
  };
}

/**
 * Build a signed + NIP-44-self-encrypted contacts doc event, exactly
 * as another ecosystem app (or an earlier session of this one) would
 * have published it.
 */
async function makeRemoteDocEvent(doc, { secret, pubkey, createdAt = 1_700_000_000 } = {}) {
  const { finalizeEvent, nip44 } = await import('nostr-core');
  const key = nip44.getConversationKey(new Uint8Array(secret), pubkey);
  const content = nip44.encrypt(JSON.stringify(doc), key);
  return finalizeEvent({
    kind: CONTACTS_DOC_KIND,
    created_at: createdAt,
    tags: [['d', CONTACTS_DOC_D_TAG], ['client', 'lotus'], ['encrypted', 'nip44']],
    content,
  }, new Uint8Array(secret));
}

/** Legacy kind:30000 list event — only the migration path reads these. */
async function makeLegacyEvent(payload, { secret, pubkey, createdAt = 1_700_000_000 } = {}) {
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

/** Self-decrypt a published doc event back to its plaintext object. */
function decryptDoc(event, secret, pubkey) {
  const key = deriveSelfConversationKey(new Uint8Array(secret), pubkey);
  return JSON.parse(nip44mod.decrypt(event.content, key));
}

const nowSec = () => Math.floor(Date.now() / 1000);

await test('syncToNostr: skipped when identity not bootstrapped', async () => {
  const store = freshStore();
  const result = await store.syncToNostr({ identityStore: { bootstrapped: false } });
  assert.equal(result?.skipped, true);
  assert.equal(result.reason, 'identity-not-bootstrapped');
});

await test('syncToNostr: empty book and no remote doc is a clean no-op', async () => {
  const store = freshStore();
  const pool = syncFakePool();
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.hadRemote, false);
  assert.equal(result.published, false);
  assert.equal(pool.calls.publish.length, 0);
});

await test('syncToNostr: publishes a signed kind:30078 doc with the frozen d tag', async () => {
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
  assert.equal(result.published, true);
  assert.equal(pool.calls.publish.length, 1);
  const sent = pool.calls.publish[0].event;
  assert.equal(sent.kind, CONTACTS_DOC_KIND);
  assert.equal(sent.pubkey, ALICE_PUBKEY);
  assert.deepEqual(sent.tags.find((t) => t[0] === 'd'), ['d', CONTACTS_DOC_D_TAG]);
  assert.equal(verifyEv(sent), true);
});

await test('syncToNostr: a manual contact syncs into the doc as a paymentAddress record', async () => {
  const store = freshStore();
  await store.addEntry({ name: 'Plain', address: 'plain@a.test', addressType: 'lightning' });
  assert.equal(store.syncDirty, true);
  const pool = syncFakePool();
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.equal(doc.contacts.length, 1);
  assert.equal(doc.contacts[0].paymentAddress, 'plain@a.test');
  assert.equal(doc.contacts[0].name, 'Plain');
  // The entry remembers its doc record for stable future matching.
  assert.equal(store.entries[0].doc_contact_id, doc.contacts[0].id);
});

await test('syncToNostr: ciphertext decrypts back to the doc, rename included', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: ALICE_PUBKEY,
    npub: ALICE_NPUB,
    event: makeKind0(ALICE_SECRET, { display_name: 'Alice', lud16: 'a@a.test' }),
  });
  const entry = store.entries[0];
  await store.updateEntry(entry.id, { name: 'Bestie' });

  const pool = syncFakePool();
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.equal(doc.contacts.length, 1);
  assert.equal(doc.contacts[0].npub, ALICE_NPUB);
  assert.equal(doc.contacts[0].name, 'Bestie');
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

// --- Fetch-reconcile-merge-publish: the no-data-loss guarantee --------------

await test('syncToNostr: merges the remote doc so a contact on either side survives', async () => {
  const store = freshStore();
  // Local knows Bob.
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  // The remote doc (written by another app or device) knows Carol.
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-carol1', name: 'Carol', npub: CAROL_NPUB, createdAt: 1_700_000_000, updatedAt: 1_700_000_000 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const carolProfile = makeKind0(CAROL_SECRET, { name: 'Carol', lud16: 'carol@c.test' });

  const pool = syncFakePool({ events: { 'wss://r.test': [remoteEvent] } });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
    profileFetcher: async (pk) => (pk === CAROL_PUBKEY ? carolProfile : null),
  });

  assert.equal(result.ok, true);
  assert.equal(result.hadRemote, true);
  assert.equal(result.restored, 1); // Carol pulled in from the doc
  assert.equal(store.entries.length, 2);
  assert.ok(store.findContactByPubkey(BOB_PUBKEY));
  assert.ok(store.findContactByPubkey(CAROL_PUBKEY));
  // Carol keeps her doc identity; Bob was appended next to her.
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.equal(doc.contacts.length, 2);
  assert.ok(doc.contacts.some((c) => c.id === 'c-carol1'));
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB));
});

await test('syncToNostr: foreign contacts and labels round-trip untouched', async () => {
  const store = freshStore();
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{
      id: 'c-phoneonly',
      name: 'Phone Person',
      phones: [{ label: '', value: '+1 555 0100' }],
      customField: 'must-survive',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    }],
    labels: ['friends'],
    labelColors: { friends: 'sage' },
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const pool = syncFakePool({ events: { 'wss://r.test': [remoteEvent] } });
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  // The phone-only contact never became a local entry...
  assert.equal(store.entries.length, 1);
  // ...but survived the publish byte-for-byte, labels included.
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  const foreign = doc.contacts.find((c) => c.id === 'c-phoneonly');
  assert.equal(foreign.customField, 'must-survive');
  assert.deepEqual(foreign.phones, [{ label: '', value: '+1 555 0100' }]);
  assert.deepEqual(doc.labels, ['friends']);
  assert.deepEqual(doc.labelColors, { friends: 'sage' });
});

await test('syncToNostr: deleting the last contact publishes it as trashed, never a skip', async () => {
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
  await store.deleteEntry(e.id);

  // The next sync must still publish: the delete travels as
  // `trashed: true` in the doc (recoverable in other apps' trash),
  // otherwise a stale copy resurrects the contact on restore.
  const pool = syncFakePool();
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.equal(doc.contacts.length, 1);
  assert.equal(doc.contacts[0].npub, ALICE_NPUB);
  assert.equal(doc.contacts[0].trashed, true);
  assert.equal(store.entries.length, 0);
});

await test('syncToNostr: a remote trashed contact removes the locally-live copy', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{
      id: 'c-bob1',
      name: 'Bob',
      npub: BOB_NPUB,
      trashed: true,
      trashedAt: nowSec() + 60,
      createdAt: 1_700_000_000,
      updatedAt: nowSec() + 60,
    }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(store.entries.length, 0);
});

await test('syncToNostr: folds the legacy kind:30000 list in exactly once', async () => {
  const store = freshStore();
  const legacyEvent = await makeLegacyEvent(
    [{ pubkey: CAROL_PUBKEY, petname: 'Caz', addedAt: 1_700_000_000 }],
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY },
  );
  const carolProfile = makeKind0(CAROL_SECRET, { name: 'Carol', lud16: 'carol@c.test' });
  const pool = syncFakePool({ events: { 'wss://r.test': [legacyEvent] } });
  assert.equal(store.legacyMigratedAt, null);
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
    profileFetcher: async (pk) => (pk === CAROL_PUBKEY ? carolProfile : null),
  });
  assert.equal(result.ok, true);
  assert.equal(result.hadRemote, true);
  assert.equal(result.restored, 1);
  // The legacy petname migrated as the contact's name.
  assert.equal(store.entries[0].name, 'Caz');
  // The published doc now carries the migrated contact...
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.npub === CAROL_NPUB));
  // ...the published event is the doc, not the legacy list...
  assert.ok(pool.calls.publish.every((p) => p.event.kind === CONTACTS_DOC_KIND));
  // ...and the migration never runs again.
  assert.ok(Number.isFinite(store.legacyMigratedAt));
});

await test('syncToNostr: a manual doc contact from another app becomes a local entry', async () => {
  const store = freshStore();
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{
      id: 'c-shop1',
      name: 'Coffee Shop',
      paymentAddress: 'shop@pay.test',
      starred: true,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.restored, 1);
  assert.equal(store.entries.length, 1);
  const entry = store.entries[0];
  assert.equal(entry.name, 'Coffee Shop');
  assert.equal(entry.address, 'shop@pay.test');
  assert.equal(entry.addressType, 'lightning');
  assert.equal(entry.isFavorite, true);
  assert.equal(entry.doc_contact_id, 'c-shop1');
  assert.equal(store.isEntryPayable(entry), true);
});

await test('addEntry: marks syncDirty', async () => {
  const store = freshStore();
  assert.equal(store.syncDirty, false);
  await store.addEntry({ name: 'Plain', address: 'p@p.test', addressType: 'lightning' });
  assert.equal(store.syncDirty, true);
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
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(store.syncDirty, false);
  await store.deleteEntry(e.id);
  assert.equal(store.syncDirty, true);
});

await test('deleteEntry: marks syncDirty for a manual entry too', async () => {
  const store = freshStore();
  const manual = await store.addEntry({
    name: 'Plain', address: 'p@p.test', addressType: 'lightning',
  });
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(store.syncDirty, false);
  await store.deleteEntry(manual.id);
  assert.equal(store.syncDirty, true);
  // The tombstone targets the doc record, so the delete can land as
  // trash even though the entry is gone locally.
  assert.ok(store.nostrDeletions.some((d) => d.docId || d.address));
});

await test('updateEntry: a rename marks dirty', async () => {
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

await test('toggleFavorite: marks dirty — starred travels in the doc', async () => {
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
  await store.toggleFavorite(e.id);
  assert.equal(store.syncDirty, true);
});

// ---------------------------------------------------------------------------
// recoverFromNostr — same fetch-reconcile-merge-publish core as
// syncToNostr, framed for the restore flow
// ---------------------------------------------------------------------------

await test('recoverFromNostr: hadRemote=false when relays have no doc', async () => {
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

await test('recoverFromNostr: rebuilds a contact from the doc + fresh kind:0', async () => {
  const store = freshStore();
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: '', npub: BOB_NPUB, createdAt: 1_700_000_000, updatedAt: 1_700_000_000 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const bobProfileEvent = makeKind0(BOB_SECRET, {
    display_name: 'Bob the Builder',
    lud16: 'bob@bob.test',
  });
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
  assert.equal(restored.doc_contact_id, 'c-bob1');
  // The doc's add time was preserved (seconds -> ms).
  assert.equal(restored.createdAt, 1_700_000_000_000);
});

await test('recoverFromNostr: the doc name wins over the profile-derived one', async () => {
  const store = freshStore();
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: 'Bobby', npub: BOB_NPUB, createdAt: 1_700_000_000, updatedAt: 1_700_000_000 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
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

await test('recoverFromNostr: a contact whose kind:0 lacks lud16 restores as identity-only', async () => {
  const store = freshStore();
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: 'Bob', npub: BOB_NPUB, createdAt: 1_700_000_000, updatedAt: 1_700_000_000 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const bobNoLud16 = makeKind0(BOB_SECRET, { name: 'Bob' /* no lud16 */ });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => bobNoLud16,
  });
  // The canonical identity is the pubkey: a contact who currently has
  // no lud16 still comes back — as an identity-only entry, not a drop.
  assert.equal(result.restored, 1);
  assert.equal(result.identityOnly, 1);
  assert.equal(store.entries.length, 1);
  const restored = store.entries[0];
  assert.equal(restored.nostr_pubkey, BOB_PUBKEY);
  assert.equal(restored.address, '');
  assert.equal(store.isEntryPayable(restored), false);
});

await test('recoverFromNostr: an already-local contact is reconciled, not re-fetched', async () => {
  const store = freshStore();
  const existing = await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  assert.equal(existing.name_locally_edited, false);

  // The doc knows the same npub, with an older clock — nothing to converge.
  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: 'Bob', npub: BOB_NPUB, createdAt: 1, updatedAt: 1 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    // A contact already in the book must never trigger a kind:0 re-fetch.
    profileFetcher: async () => { throw new Error('must not refetch'); },
  });
  assert.equal(result.restored, 0);
  assert.equal(result.removed, 0);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].name, 'Bob');
  // Reconcile still remembered the doc link.
  assert.equal(store.entries[0].doc_contact_id, 'c-bob1');
});

await test('recoverFromNostr: a newer doc rename converges onto the local contact', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });

  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: 'My Bobby', npub: BOB_NPUB, createdAt: 1_700_000_000, updatedAt: nowSec() + 60 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => { throw new Error('must not refetch'); },
  });
  assert.equal(result.petnameUpdated, 1);
  assert.equal(store.entries[0].name, 'My Bobby');
  assert.equal(store.entries[0].name_locally_edited, true);
});

await test('recoverFromNostr: a locally-edited name outranks a stale doc name', async () => {
  const store = freshStore();
  const existing = await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  await store.updateEntry(existing.id, { name: 'Local Bob' });
  assert.equal(store.entries[0].name_locally_edited, true);

  const remoteEvent = await makeRemoteDocEvent({
    contacts: [{ id: 'c-bob1', name: 'Remote Bobby', npub: BOB_NPUB, createdAt: 1, updatedAt: 1 }],
    labels: [],
  }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool({ events: { 'wss://r.test': [remoteEvent] } }),
    relays: ['wss://r.test'],
    profileFetcher: async () => { throw new Error('must not refetch'); },
  });
  assert.equal(result.petnameUpdated, 0);
  assert.equal(store.entries[0].name, 'Local Bob');
});

await test('recoverFromNostr: publishes the merged doc and clears syncDirty', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  assert.equal(store.syncDirty, true);

  // Recovery is also a publish: it pushes the merged doc back out, so
  // a successful recovery leaves the store in sync — not dirty.
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: syncFakePool(),
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(store.syncDirty, false);
  assert.ok(Number.isFinite(store.lastSyncedAt));
});

// ---------------------------------------------------------------------------
// LNURL contact type
// ---------------------------------------------------------------------------

const LNURL_BECH32 = 'LNURL1DP68GURN8GHJ7A339EKXUCNFW3EJUER99AKXUATJD3CZ7V6JTP5924GV0MDHZ';
const LNURL_LUD17 = 'lnurlp://v1.lnbits.de/lnurlp/3RXhUU';

await test('detectAddressType: recognizes bech32 LNURL and LUD-17 scheme', () => {
  const store = freshStore();
  assert.equal(store.detectAddressType(LNURL_BECH32), 'lnurl');
  assert.equal(store.detectAddressType(LNURL_LUD17), 'lnurl');
});

await test('isValidAddress: validates the lnurl type', () => {
  const store = freshStore();
  assert.equal(store.isValidAddress(LNURL_BECH32, 'lnurl'), true);
  assert.equal(store.isValidAddress('not-an-lnurl', 'lnurl'), false);
});

await test('addEntry: stores an LNURL contact that is payable', async () => {
  const store = freshStore();
  const entry = await store.addEntry({
    name: 'LNbits link',
    address: LNURL_LUD17,
    addressType: 'lnurl',
  });
  assert.equal(entry.addressType, 'lnurl');
  assert.equal(store.getEntryAddressType(entry), 'lnurl');
  assert.equal(store.isEntryPayable(entry), true);
});

// ---------------------------------------------------------------------------
// Sync trust assumptions — the review findings. Every publish is a
// whole-document replace shared with other apps, so these pin down
// when a sync must REFUSE to publish, and which state must never leak
// across identities.
// ---------------------------------------------------------------------------

await test('sync refuses to publish when no relay is provably reachable (no cache)', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const pool = syncFakePool({ unreachable: ['wss://a.test', 'wss://b.test'] });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://a.test', 'wss://b.test'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fetch-failed');
  assert.equal(pool.calls.publish.length, 0);
  assert.equal(store.syncDirty, true);
});

await test('sync refuses the cache-recovery republish without proven absence', async () => {
  const store = freshStore();
  // A previous good sync left a cache for this identity.
  store._saveDocCache({
    pubkey: ALICE_PUBKEY,
    eventId: 'ev-1',
    createdAt: 1_700_000_000,
    doc: { contacts: [{ id: 'c-x', name: 'From cache', npub: BOB_NPUB, updatedAt: 1_700_000_000 }], labels: [] },
  });
  const pool = syncFakePool({ unreachable: ['wss://a.test', 'wss://b.test'] });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://a.test', 'wss://b.test'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fetch-failed');
  assert.equal(pool.calls.publish.length, 0);
});

await test('an identity change drops the previous identity\'s cache, latch, and tombstones', async () => {
  const store = freshStore();
  // Alice syncs against a doc that carries a foreign (vCard-only)
  // passenger another app owns.
  const aliceDoc = {
    contacts: [{ id: 'c-f', name: 'Phone-only person', phones: [{ label: '', value: '+1 555' }] }],
    labels: ['friends'],
  };
  const pool1 = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(aliceDoc, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY })] },
  });
  const first = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: pool1,
    relays: ['wss://r.test'],
  });
  assert.equal(first.ok, true);
  assert.ok(store.legacyMigratedAt, 'legacy latch set for Alice');
  store.nostrDeletions = [{ pubkey: BOB_PUBKEY, deletedAt: Date.now() }];
  await store._persistSyncMeta();

  // A local contact exists when Carol signs in on the same device.
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });

  const pool2 = syncFakePool();
  const second = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: CAROL_PUBKEY, secret: CAROL_SECRET }),
    pool: pool2,
    relays: ['wss://r.test'],
  });
  assert.equal(second.ok, true);
  assert.equal(second.published, true);
  // Carol's doc is her own: it carries the local entry, never Alice's
  // cached doc with the foreign passenger, and no stale tombstones.
  const doc = decryptDoc(pool2.calls.publish[0].event, CAROL_SECRET, CAROL_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB));
  assert.ok(!doc.contacts.some((c) => c.id === 'c-f'));
  assert.ok(!doc.contacts.some((c) => c.trashed));
});

await test('a no-op sync never re-stamps a newer cache with the older fetched clock', async () => {
  const store = freshStore();
  const doc = {
    contacts: [{ id: 'c-f', name: 'Foreign', phones: [{ label: '', value: '+1 555' }] }],
    labels: [],
  };
  // Cache holds our own newer publish; the relay still serves an old copy.
  store._saveDocCache({ pubkey: ALICE_PUBKEY, eventId: 'ev-new', createdAt: 5_000_000_000, doc });
  const pool = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(doc, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: 1_700_000_000 })] },
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, false);
  const cached = JSON.parse(globalThis.localStorage.getItem('buhoGO_shared_contacts_doc_v1'));
  assert.equal(cached.createdAt, 5_000_000_000);
});

await test('a mutation made mid-sync survives the dirty-flag clear', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const pool = syncFakePool();
  // Simulate a contact edit landing while the sync is in flight: the
  // doc fetch is the first await inside _runSync.
  const origQuery = pool.querySync.bind(pool);
  let injected = false;
  pool.querySync = async (...args) => {
    if (!injected) {
      injected = true;
      await store._markSyncDirty();
    }
    return origQuery(...args);
  };
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(store.syncDirty, true, 'mid-sync dirt must survive the clear');
});

await test('a tombstone older than a doc re-add does not block the import', async () => {
  const store = freshStore();
  // Deleted here long ago; re-added in another app afterwards.
  store.nostrDeletions = [{ pubkey: BOB_PUBKEY, deletedAt: 1_000_000 }];
  const doc = {
    contacts: [{ id: 'c-b', name: 'Bob again', npub: BOB_NPUB, updatedAt: nowSec() }],
    labels: [],
  };
  const pool = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(doc, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: nowSec() })] },
  });
  const result = await store.recoverFromNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
    profileFetcher: async () => makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.restored, 1);
  assert.ok(store.findContactByPubkey(BOB_PUBKEY));
});

await test('a legacy contact with no fetchable kind:0 still reaches the doc, and migration latches', async () => {
  const store = freshStore();
  const legacy = await makeLegacyEvent(
    [{ pubkey: BOB_PUBKEY, petname: 'Old friend', updatedAt: 1_700_000_000_000, addedAt: 1_600_000_000_000 }],
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY },
  );
  const pool = syncFakePool({ events: { 'wss://r.test': [legacy] } });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
    profileFetcher: async () => null, // Bob's profile is gone from relays
  });
  assert.equal(result.ok, true);
  assert.equal(result.deferred, 1);
  assert.equal(result.published, true);
  const doc = decryptDoc(pool.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  const bob = doc.contacts.find((c) => c.npub === BOB_NPUB);
  assert.ok(bob, 'the legacy contact must be in the published doc');
  assert.equal(bob.name, 'Old friend');
  assert.ok(store.legacyMigratedAt, 'migration latches: the doc now carries the contact');
});

await test('the legacy latch waits when absence of the legacy event is unproven', async () => {
  const store = freshStore();
  const docEvent = await makeRemoteDocEvent(
    { contacts: [], labels: [] },
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY },
  );
  // Two relays configured, only one reachable: the doc still arrives,
  // but an empty legacy read could just mean the dead relay held it.
  const pool = syncFakePool({
    events: { 'wss://a.test': [docEvent] },
    unreachable: ['wss://b.test'],
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://a.test', 'wss://b.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(store.legacyMigratedAt, null, 'latch must wait for a conclusive legacy read');
});

await test('a doc-linked entry missing from a fetched doc is a hard delete, not a re-add', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  // A previous sync linked this entry to a doc record that another
  // app has since deleted forever.
  store.entries.splice(0, 1, { ...store.entries[0], doc_contact_id: 'c-gone' });
  const doc = {
    contacts: [{ id: 'c-f', name: 'Foreign', phones: [{ label: '', value: '+1 555' }] }],
    labels: [],
  };
  const pool = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(doc, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY })] },
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(store.entries.length, 0, 'the hard-deleted contact must not survive locally');
  assert.equal(pool.calls.publish.length, 0, 'and must not be re-appended to the doc');
});

await test('a hard delete is never inferred from the cache winning as base', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  store.entries.splice(0, 1, { ...store.entries[0], doc_contact_id: 'c-mine' });
  // Our own newer publish (with the record) has not reached this
  // relay yet; the relay still serves an older doc without it.
  store._saveDocCache({
    pubkey: ALICE_PUBKEY,
    eventId: 'ev-new',
    createdAt: 5_000_000_000,
    doc: { contacts: [{ id: 'c-mine', name: 'Bob', npub: BOB_NPUB, updatedAt: 4_999_999_000 }], labels: [] },
  });
  const pool = syncFakePool({
    events: {
      'wss://r.test': [await makeRemoteDocEvent({ contacts: [], labels: [] }, { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: 1_700_000_000 })],
    },
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(store.entries.length, 1, 'absence from a stale relay copy proves nothing');
});

await test('the publish rebases onto an edit that landed during the sync window', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const docV1 = await makeRemoteDocEvent(
    { contacts: [], labels: [] },
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: 1_700_000_000 },
  );
  // While our reconcile ran, another app saved a contact.
  const docV2 = await makeRemoteDocEvent(
    { contacts: [{ id: 'c-window', name: 'Added in the window', emails: [{ label: '', value: 'w@x.test' }] }], labels: [] },
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: 1_700_000_500 },
  );
  const pool = syncFakePool();
  let docFetches = 0;
  const origQuery = pool.querySync.bind(pool);
  pool.querySync = async (urls, filter, params) => {
    if (Array.isArray(filter?.kinds) && filter.kinds.includes(CONTACTS_DOC_KIND)) {
      docFetches += 1;
      return docFetches === 1 ? [docV1] : [docV2];
    }
    return origQuery(urls, filter, params);
  };
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(docFetches, 2, 'one rebase re-fetch before the publish');
  const published = pool.calls.publish[0].event;
  assert.ok(published.created_at > 1_700_000_500, 'clock must beat the window edit');
  const doc = decryptDoc(published, ALICE_SECRET, ALICE_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.id === 'c-window'), 'the window edit survives');
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB), 'and so does our contact');
});

await test('a refused publish never links appended records into the unpublished doc', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const docEvent = await makeRemoteDocEvent(
    { contacts: [], labels: [] },
    { secret: ALICE_SECRET, pubkey: ALICE_PUBKEY, createdAt: 1_700_000_000 },
  );
  const failing = syncFakePool({ publish: 'fail', events: { 'wss://r.test': [docEvent] } });
  const first = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: failing,
    relays: ['wss://r.test'],
  });
  assert.equal(first.ok, false);
  assert.ok(!store.entries[0].doc_contact_id, 'no link into a doc that never left the device');

  // The retry must publish the contact, not hard-delete it because a
  // stale link's id is absent from the real doc.
  const retry = syncFakePool({ events: { 'wss://r.test': [docEvent] } });
  const second = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: retry,
    relays: ['wss://r.test'],
  });
  assert.equal(second.ok, true);
  assert.equal(store.entries.length, 1, 'the contact survives the retry');
  const doc = decryptDoc(retry.calls.publish[0].event, ALICE_SECRET, ALICE_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB));
});

await test('an identity switch unlinks entries so they re-append into the new identity\'s doc', async () => {
  const store = freshStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  // Alice's sync publishes and links the entry into HER doc.
  const pool1 = syncFakePool();
  await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET }),
    pool: pool1,
    relays: ['wss://r.test'],
  });
  assert.ok(store.entries[0].doc_contact_id, 'linked under Alice');

  // Carol signs in on the same device; her own doc exists on relays.
  const carolDoc = {
    contacts: [{ id: 'c-carols', name: 'Carols friend', emails: [{ label: '', value: 'f@x.test' }] }],
    labels: [],
  };
  const pool2 = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(carolDoc, { secret: CAROL_SECRET, pubkey: CAROL_PUBKEY })] },
  });
  const result = await store.syncToNostr({
    identityStore: fakeIdentity({ pubkey: CAROL_PUBKEY, secret: CAROL_SECRET }),
    pool: pool2,
    relays: ['wss://r.test'],
  });
  assert.equal(result.ok, true);
  assert.ok(store.findContactByPubkey(BOB_PUBKEY), 'the carried-over contact survives the switch');
  const doc = decryptDoc(pool2.calls.publish[0].event, CAROL_SECRET, CAROL_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB), 'and lands in the new identity\'s doc');
  assert.ok(doc.contacts.some((c) => c.id === 'c-carols'), 'alongside its existing records');
});

await test('a delete made while the book is already dirty survives an app kill', async () => {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  const store = useAddressBookStore();
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  assert.equal(store.syncDirty, true, 'precondition: already dirty when the delete happens');
  await store.deleteEntry(store.entries[0].id);

  // App kill before any sync: a fresh store over the same storage
  // must still know about the delete, or the next sync re-imports.
  setActivePinia(createPinia());
  const reloaded = useAddressBookStore();
  await reloaded.initialize();
  assert.ok(reloaded.nostrDeletions.some((d) => d.pubkey === BOB_PUBKEY));
});

// ---------------------------------------------------------------------------
// switchContactsIdentity — the Change-identity sheet's orchestration
// ---------------------------------------------------------------------------

const DAVE_SECRET = new Uint8Array(32).fill(0x44);
const DAVE_PUBKEY = getPublicKey(DAVE_SECRET);
const DAVE_NPUB = nip19.npubEncode(DAVE_PUBKEY);

/**
 * A mutable identity fake: switchContactsIdentity holds ONE store
 * reference across the whole flow while the real identity store
 * mutates in place, so the fake must flip the same way.
 */
function mutableIdentity({ pubkey, secret }) {
  const identity = {
    bootstrapped: true,
    nostrPubkeyHex: pubkey,
    _secret: secret,
    async getNostrSecretKeyBytes() { return new Uint8Array(this._secret); },
    switchTo({ pubkey: p, secret: s }) {
      this.nostrPubkeyHex = p;
      this._secret = s;
    },
  };
  return identity;
}

await test('switchContactsIdentity (start fresh): flushes the old book, then swaps to the new identity\'s', async () => {
  const store = freshStore();
  const identity = mutableIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET });

  // Alice has one unpublished contact (dirty) and Carol already owns
  // a doc of her own on the relay.
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const carolDoc = {
    contacts: [{
      id: 'c-carol1', name: 'Carol Friend', npub: DAVE_NPUB,
      createdAt: 1_700_000_000, updatedAt: 1_700_000_000,
    }],
    labels: ['work'],
  };
  const pool = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(carolDoc, { secret: CAROL_SECRET, pubkey: CAROL_PUBKEY })] },
  });

  const result = await store.switchContactsIdentity({
    identityStore: identity,
    changeIdentity: async () => identity.switchTo({ pubkey: CAROL_PUBKEY, secret: CAROL_SECRET }),
    keepContacts: false,
    pool,
    relays: ['wss://r.test'],
    profileFetcher: async (pk) => (pk === DAVE_PUBKEY
      ? makeKind0(DAVE_SECRET, { name: 'Dave', lud16: 'dave@dave.test' })
      : null),
  });

  assert.equal(result.ok, true);
  // The pre-switch flush published Bob under ALICE's key.
  const aliceEvents = pool.calls.publish.filter((p) => p.event.pubkey === ALICE_PUBKEY);
  assert.ok(aliceEvents.length > 0, 'outgoing identity flushed first');
  assert.ok(decryptDoc(aliceEvents[0].event, ALICE_SECRET, ALICE_PUBKEY)
    .contacts.some((c) => c.npub === BOB_NPUB));
  // The local book now belongs to Carol: her contact, not Alice's.
  assert.ok(store.entries.some((e) => e.nostr_npub === DAVE_NPUB), 'Carol\'s contact imported');
  assert.ok(!store.entries.some((e) => e.nostr_npub === BOB_NPUB), 'Alice\'s contact gone locally');
  // (syncDirty may be set here: reconcile-imports mark the book dirty
  // like every recovery does, and the driver's follow-up sync no-ops.)
  // Nothing of Alice's was published under Carol's key.
  for (const p of pool.calls.publish.filter((x) => x.event.pubkey === CAROL_PUBKEY)) {
    assert.ok(!decryptDoc(p.event, CAROL_SECRET, CAROL_PUBKEY).contacts.some((c) => c.npub === BOB_NPUB));
  }
});

await test('switchContactsIdentity (bring along): the carried book publishes under the new key as a union', async () => {
  const store = freshStore();
  const identity = mutableIdentity({ pubkey: ALICE_PUBKEY, secret: ALICE_SECRET });

  // Alice's contact is synced and doc-linked; Carol's doc already
  // holds her own record that must survive the union.
  await store.addNostrContact({
    pubkey: BOB_PUBKEY,
    npub: BOB_NPUB,
    event: makeKind0(BOB_SECRET, { name: 'Bob', lud16: 'bob@bob.test' }),
  });
  const pool1 = syncFakePool();
  const first = await store.syncToNostr({ identityStore: identity, pool: pool1, relays: ['wss://r.test'] });
  assert.equal(first.ok, true);
  const linked = store.entries.find((e) => e.nostr_npub === BOB_NPUB);
  assert.ok(linked.doc_contact_id, 'entry linked into Alice\'s doc');

  const carolDoc = {
    contacts: [{
      id: 'c-carol1', name: 'Carol Friend', npub: DAVE_NPUB,
      createdAt: 1_700_000_000, updatedAt: 1_700_000_000,
    }],
    labels: [],
  };
  const pool2 = syncFakePool({
    events: { 'wss://r.test': [await makeRemoteDocEvent(carolDoc, { secret: CAROL_SECRET, pubkey: CAROL_PUBKEY })] },
  });

  const result = await store.switchContactsIdentity({
    identityStore: identity,
    changeIdentity: async () => identity.switchTo({ pubkey: CAROL_PUBKEY, secret: CAROL_SECRET }),
    keepContacts: true,
    pool: pool2,
    relays: ['wss://r.test'],
    profileFetcher: async (pk) => (pk === DAVE_PUBKEY
      ? makeKind0(DAVE_SECRET, { name: 'Dave', lud16: 'dave@dave.test' })
      : null),
  });

  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  // Bob survived the switch and landed in CAROL's doc alongside her
  // own record — a union, not a replace.
  assert.ok(store.entries.some((e) => e.nostr_npub === BOB_NPUB));
  const published = pool2.calls.publish.find((p) => p.event.pubkey === CAROL_PUBKEY);
  const doc = decryptDoc(published.event, CAROL_SECRET, CAROL_PUBKEY);
  assert.ok(doc.contacts.some((c) => c.npub === BOB_NPUB), 'carried contact published');
  assert.ok(doc.contacts.some((c) => c.id === 'c-carol1'), 'existing record survived');
  // The entry was re-linked into the NEW doc, not left pointing at
  // Alice's (whose id would read as a hard delete next sync).
  const relinked = store.entries.find((e) => e.nostr_npub === BOB_NPUB);
  assert.notEqual(relinked.doc_contact_id, linked.doc_contact_id);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
