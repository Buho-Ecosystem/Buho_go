/**
 * Shared contacts doc — wire format + merge tests.
 *
 * The merge is the dangerous part of the shared doc: every publish is
 * a whole-document replace shared with the user's other apps, so the
 * assertions here are mostly about what the merge must NOT touch —
 * foreign contacts, unknown fields, trash decisions made elsewhere.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrContactsDoc.spec.js
 */

import { strict as assert } from 'node:assert';

const { getPublicKey, nip19, nip44 } = await import('nostr-core');
const {
  CONTACTS_DOC_KIND,
  CONTACTS_DOC_D_TAG,
  MAX_DOC_PLAINTEXT_BYTES,
  normalizeDoc,
  emptyDoc,
  mergeEntriesIntoDoc,
  extractDocContacts,
  buildContactsDocEvent,
} = await import('../nostrContactsDoc.js');
const { deriveSelfConversationKey } = await import('../nostrAddressBook.js');

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

const ALICE_SECRET = new Uint8Array(32).fill(0x11);
const ALICE_PUBKEY = getPublicKey(ALICE_SECRET);
const ALICE_NPUB = nip19.npubEncode(ALICE_PUBKEY);

const BOB_SECRET = new Uint8Array(32).fill(0x22);
const BOB_PUBKEY = getPublicKey(BOB_SECRET);
const BOB_NPUB = nip19.npubEncode(BOB_PUBKEY);

// Timestamps chosen so second-conversion is unambiguous.
const T1_MS = 1_700_000_100_000; // -> 1700000100
const T2_MS = 1_700_000_200_000; // -> 1700000200
const T3_MS = 1_700_000_300_000; // -> 1700000300

function nostrEntry(overrides = {}) {
  return {
    id: 'addr-1',
    name: 'Alice',
    address: 'alice@a.test',
    addressType: 'lightning',
    lightningAddress: 'alice@a.test',
    isFavorite: false,
    createdAt: T1_MS,
    updatedAt: T1_MS,
    source: 'nostr',
    nostr_pubkey: ALICE_PUBKEY,
    nostr_npub: ALICE_NPUB,
    nostr_profile: { nip05: 'alice@a.test', picture: 'https://a.test/p.png' },
    name_locally_edited: false,
    ...overrides,
  };
}

function manualEntry(overrides = {}) {
  return {
    id: 'addr-2',
    name: 'Plain Bob',
    address: 'bob@wallet.test',
    addressType: 'lightning',
    lightningAddress: 'bob@wallet.test',
    isFavorite: false,
    createdAt: T1_MS,
    updatedAt: T1_MS,
    ...overrides,
  };
}

/** A doc as another ecosystem app would publish it. */
function foreignDoc() {
  return {
    contacts: [
      {
        id: 'c-foreign1',
        name: 'Phone Person',
        npub: '',
        phones: [{ label: 'home', value: '+1 555 0100' }],
        emails: [{ label: '', value: 'p@x.test' }],
        customField: 'must-survive',
        labels: ['friends'],
        starred: true,
        trashed: false,
        trashedAt: 0,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
      },
    ],
    labels: ['friends', 'work'],
    labelColors: { friends: 'sage' },
    someFutureKey: { keep: true },
  };
}

console.log('nostrContactsDoc');

await test('constants pin the frozen wire format', () => {
  assert.equal(CONTACTS_DOC_KIND, 30078);
  assert.equal(CONTACTS_DOC_D_TAG, 'nostroogle:contacts:v1');
});

await test('normalizeDoc keeps unknown top-level keys and contact fields', () => {
  const doc = normalizeDoc(foreignDoc());
  assert.equal(doc.someFutureKey.keep, true);
  assert.equal(doc.contacts[0].customField, 'must-survive');
  assert.deepEqual(doc.labelColors, { friends: 'sage' });
});

await test('merge: adds a missing nostr entry with second-precision timestamps', () => {
  const { doc, changed, links } = mergeEntriesIntoDoc({
    doc: emptyDoc(),
    entries: [nostrEntry()],
  });
  assert.equal(changed, true);
  assert.equal(doc.contacts.length, 1);
  const c = doc.contacts[0];
  assert.match(c.id, /^c-[0-9a-f]+$/);
  assert.equal(c.npub, ALICE_NPUB);
  assert.equal(c.name, 'Alice');
  assert.equal(c.nip05, 'alice@a.test');
  assert.equal(c.picture, 'https://a.test/p.png');
  assert.equal(c.starred, false);
  assert.equal(c.createdAt, Math.floor(T1_MS / 1000));
  assert.equal(c.updatedAt, Math.floor(T1_MS / 1000));
  assert.equal(links['addr-1'], c.id);
});

await test('merge: adds a missing manual entry keyed by payment address', () => {
  const { doc, links } = mergeEntriesIntoDoc({
    doc: emptyDoc(),
    entries: [manualEntry()],
  });
  assert.equal(doc.contacts.length, 1);
  assert.equal(doc.contacts[0].paymentAddress, 'bob@wallet.test');
  assert.equal(doc.contacts[0].npub, undefined);
  assert.equal(links['addr-2'], doc.contacts[0].id);
});

await test('merge: no-op when the doc already carries the entries (changed=false)', () => {
  const first = mergeEntriesIntoDoc({ doc: emptyDoc(), entries: [nostrEntry(), manualEntry()] });
  const second = mergeEntriesIntoDoc({ doc: first.doc, entries: [nostrEntry(), manualEntry()] });
  assert.equal(second.changed, false);
  assert.deepEqual(second.doc, first.doc);
});

await test('merge: newer entry updates only the owned fields', () => {
  const base = mergeEntriesIntoDoc({ doc: foreignDoc(), entries: [nostrEntry()] }).doc;
  // Simulate another app enriching the same contact.
  const docContact = base.contacts.find((c) => c.npub === ALICE_NPUB);
  docContact.phones = [{ label: '', value: '+49 555' }];
  docContact.notes = 'their private note';

  const renamed = nostrEntry({
    name: 'Alice Renamed',
    name_locally_edited: true,
    isFavorite: true,
    updatedAt: T2_MS,
  });
  const { doc, changed } = mergeEntriesIntoDoc({ doc: base, entries: [renamed] });
  assert.equal(changed, true);
  const after = doc.contacts.find((c) => c.npub === ALICE_NPUB);
  assert.equal(after.name, 'Alice Renamed');
  assert.equal(after.starred, true);
  assert.equal(after.updatedAt, Math.floor(T2_MS / 1000));
  // Untouched: the other app's fields and the foreign contact.
  assert.deepEqual(after.phones, [{ label: '', value: '+49 555' }]);
  assert.equal(after.notes, 'their private note');
  assert.equal(doc.contacts.find((c) => c.id === 'c-foreign1').customField, 'must-survive');
  assert.deepEqual(doc.labels, ['friends', 'work']);
  assert.deepEqual(doc.labelColors, { friends: 'sage' });
  assert.deepEqual(doc.someFutureKey, { keep: true });
});

await test('merge: a profile-derived name never overwrites a doc rename', () => {
  const base = mergeEntriesIntoDoc({ doc: emptyDoc(), entries: [nostrEntry()] }).doc;
  base.contacts[0].name = 'Renamed In Another App';
  // Entry is newer (a profile refresh bumped its clock) but the name
  // is NOT locally edited — the doc's rename must survive.
  const refreshed = nostrEntry({ updatedAt: T2_MS, name_locally_edited: false });
  const { doc } = mergeEntriesIntoDoc({ doc: base, entries: [refreshed] });
  assert.equal(doc.contacts[0].name, 'Renamed In Another App');
});

await test('merge: an older entry does not touch a newer doc contact', () => {
  const base = mergeEntriesIntoDoc({
    doc: emptyDoc(),
    entries: [nostrEntry({ updatedAt: T2_MS, name: 'Doc Name', name_locally_edited: true })],
  }).doc;
  const stale = nostrEntry({ updatedAt: T1_MS, name: 'Stale Name', name_locally_edited: true });
  const { doc, changed } = mergeEntriesIntoDoc({ doc: base, entries: [stale] });
  assert.equal(changed, false);
  assert.equal(doc.contacts[0].name, 'Doc Name');
});

await test('merge: never un-trashes; a newer entry re-adds as a fresh record', () => {
  const base = mergeEntriesIntoDoc({ doc: emptyDoc(), entries: [nostrEntry()] }).doc;
  base.contacts[0].trashed = true;
  base.contacts[0].trashedAt = Math.floor(T2_MS / 1000);
  base.contacts[0].updatedAt = Math.floor(T2_MS / 1000);

  // Entry older than the trash: nothing happens.
  const stale = mergeEntriesIntoDoc({ doc: base, entries: [nostrEntry({ updatedAt: T1_MS })] });
  assert.equal(stale.changed, false);
  assert.equal(stale.doc.contacts.length, 1);
  assert.equal(stale.doc.contacts[0].trashed, true);

  // Entry newer than the trash: deliberate re-add, new record, the
  // trashed one stays exactly as the other app left it.
  const readd = mergeEntriesIntoDoc({ doc: base, entries: [nostrEntry({ updatedAt: T3_MS })] });
  assert.equal(readd.changed, true);
  assert.equal(readd.doc.contacts.length, 2);
  assert.equal(readd.doc.contacts[0].trashed, true);
  assert.equal(readd.doc.contacts[1].npub, ALICE_NPUB);
  assert.equal(readd.doc.contacts[1].trashed, undefined);
});

await test('merge: a tombstone trashes the matching contact (ties included)', () => {
  const base = mergeEntriesIntoDoc({ doc: emptyDoc(), entries: [nostrEntry(), manualEntry()] }).doc;
  const { doc, changed } = mergeEntriesIntoDoc({
    doc: base,
    entries: [],
    deletions: [
      { pubkey: ALICE_PUBKEY, deletedAt: T1_MS }, // same second as the write
      { address: 'bob@wallet.test', deletedAt: T2_MS },
    ],
  });
  assert.equal(changed, true);
  const alice = doc.contacts.find((c) => c.npub === ALICE_NPUB);
  assert.equal(alice.trashed, true);
  assert.equal(alice.trashedAt, Math.floor(T1_MS / 1000));
  const bob = doc.contacts.find((c) => c.paymentAddress === 'bob@wallet.test');
  assert.equal(bob.trashed, true);
});

await test('merge: a tombstone never targets an already-trashed or foreign-only contact', () => {
  const doc = foreignDoc();
  const { changed } = mergeEntriesIntoDoc({
    doc,
    entries: [],
    deletions: [{ address: 'nothere@x.test', deletedAt: T3_MS }],
  });
  assert.equal(changed, false);
});

await test('merge: input doc is not mutated', () => {
  const input = foreignDoc();
  const snapshot = JSON.stringify(input);
  mergeEntriesIntoDoc({ doc: input, entries: [nostrEntry()], deletions: [] });
  assert.equal(JSON.stringify(input), snapshot);
});

await test('extractDocContacts: categorizes nostr vs manual, skips foreign', () => {
  const base = mergeEntriesIntoDoc({ doc: foreignDoc(), entries: [nostrEntry(), manualEntry()] }).doc;
  const { nostr, manual } = extractDocContacts(base);
  assert.equal(nostr.length, 1);
  assert.equal(nostr[0].pubkey, ALICE_PUBKEY);
  assert.equal(nostr[0].npub, ALICE_NPUB);
  assert.equal(nostr[0].updatedAtMs, Math.floor(T1_MS / 1000) * 1000);
  assert.equal(manual.length, 1);
  assert.equal(manual[0].paymentAddress, 'bob@wallet.test');
  // The phone-only foreign contact is nobody's to touch.
  assert.equal(nostr.concat(manual).some((c) => c.docId === 'c-foreign1'), false);
});

await test('extractDocContacts: an undecodable npub is treated as foreign', () => {
  const doc = { contacts: [{ id: 'c-x', name: 'Broken', npub: 'npub1notvalid', updatedAt: 1 }], labels: [] };
  const { nostr, manual } = extractDocContacts(doc);
  assert.equal(nostr.length, 0);
  assert.equal(manual.length, 0);
});

await test('buildContactsDocEvent: signs kind 30078 with the frozen d tag', () => {
  const doc = mergeEntriesIntoDoc({ doc: emptyDoc(), entries: [nostrEntry()] }).doc;
  const event = buildContactsDocEvent({
    secretKey: ALICE_SECRET,
    pubkey: ALICE_PUBKEY,
    doc,
    createdAt: 1_700_000_500,
  });
  assert.equal(event.kind, CONTACTS_DOC_KIND);
  assert.equal(event.created_at, 1_700_000_500);
  assert.deepEqual(event.tags.find((t) => t[0] === 'd'), ['d', CONTACTS_DOC_D_TAG]);
  assert.deepEqual(event.tags.find((t) => t[0] === 'client'), ['client', 'buhogo']);
  assert.deepEqual(event.tags.find((t) => t[0] === 'encrypted'), ['encrypted', 'nip44']);

  // Round-trip: self-decrypt yields the exact doc.
  const key = deriveSelfConversationKey(ALICE_SECRET, ALICE_PUBKEY);
  const roundTripped = JSON.parse(nip44.decrypt(event.content, key));
  assert.deepEqual(roundTripped, doc);
});

await test('buildContactsDocEvent: refuses an over-sized doc instead of truncating', () => {
  const doc = emptyDoc();
  doc.contacts.push({ id: 'c-big', name: 'x'.repeat(MAX_DOC_PLAINTEXT_BYTES), npub: BOB_NPUB, updatedAt: 1 });
  assert.throws(
    () => buildContactsDocEvent({ secretKey: BOB_SECRET, pubkey: BOB_PUBKEY, doc }),
    (err) => err.code === 'CONTACTS_DOC_TOO_LARGE',
  );
});

await test('merge: extraNostrRecords land in the doc, existing npubs are skipped', () => {
  const doc = emptyDoc();
  doc.contacts.push({ id: 'c-bob', name: 'Bob', npub: BOB_NPUB, updatedAt: 1700000000 });
  const { doc: merged, changed } = mergeEntriesIntoDoc({
    doc,
    entries: [],
    extraNostrRecords: [
      { pubkey: ALICE_PUBKEY, name: 'Alice (legacy)', addedAt: T1_MS, updatedAt: T2_MS },
      { pubkey: BOB_PUBKEY, name: 'must be skipped' },
    ],
  });
  assert.equal(changed, true);
  assert.equal(merged.contacts.length, 2);
  const alice = merged.contacts.find((c) => c.npub === ALICE_NPUB);
  assert.equal(alice.name, 'Alice (legacy)');
  assert.equal(alice.createdAt, 1_700_000_100);
  assert.equal(alice.updatedAt, 1_700_000_200);
  const bob = merged.contacts.find((c) => c.npub === BOB_NPUB);
  assert.equal(bob.name, 'Bob');
});

await test('merge: an extra record without a petname gets the short-npub fallback name', () => {
  const { doc: merged } = mergeEntriesIntoDoc({
    doc: emptyDoc(),
    entries: [],
    extraNostrRecords: [{ pubkey: ALICE_PUBKEY, name: '' }],
  });
  assert.equal(merged.contacts.length, 1);
  assert.ok(merged.contacts[0].name.startsWith(ALICE_NPUB.slice(0, 12)));
});

// ---------------------------------------------------------------------------
// fetchContactsDoc — provable reachability. `querySync` alone resolves
// [] for a dead socket exactly like for a connected-but-empty relay,
// so "reached" must come from the connection handshake, never from a
// resolved promise.
// ---------------------------------------------------------------------------

const { fetchContactsDoc } = await import('../nostrContactsDoc.js');

function reachabilityPool({ unreachable = [], events = {} } = {}) {
  return {
    async ensureRelay(url) {
      if (unreachable.includes(url)) throw new Error('connect failed');
      return { connected: true };
    },
    async querySync(urls, _filter) {
      const out = [];
      for (const url of urls) out.push(...(events[url] || []));
      return out;
    },
  };
}

await test('fetchContactsDoc: a relay whose handshake fails is not "reached"', async () => {
  const result = await fetchContactsDoc({
    pool: reachabilityPool({ unreachable: ['wss://a.test', 'wss://b.test'] }),
    relays: ['wss://a.test', 'wss://b.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result.found, false);
  assert.equal(result.reachedRelays, 0);
});

await test('fetchContactsDoc: a connected relay with zero events IS "reached"', async () => {
  const result = await fetchContactsDoc({
    pool: reachabilityPool({ unreachable: ['wss://a.test'] }),
    relays: ['wss://a.test', 'wss://b.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result.found, false);
  assert.equal(result.reachedRelays, 1);
});

await test('fetchContactsDoc: a pool without ensureRelay can never prove absence', async () => {
  const result = await fetchContactsDoc({
    pool: { async querySync() { return []; } },
    relays: ['wss://a.test', 'wss://b.test'],
    pubkey: ALICE_PUBKEY,
    secretKey: ALICE_SECRET,
  });
  assert.equal(result.found, false);
  assert.equal(result.reachedRelays, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
