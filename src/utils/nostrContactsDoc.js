/**
 * Shared private contacts doc — the ecosystem wire format.
 *
 * The address book syncs through ONE encrypted Nostr event shared by
 * every app in the ecosystem: a NIP-78 `kind:30078` doc with the
 * frozen `d` tag `nostroogle:contacts:v1`, NIP-44 self-encrypted.
 * Signing in to any ecosystem app with the same identity therefore
 * shows the same contact list — that is the whole point.
 *
 * The doc's plaintext is a JSON object:
 *
 *   { contacts: Contact[], labels: string[], labelColors?: {...} }
 *
 * where a Contact is a rich vCard-style record. BuhoGO owns only a
 * small slice of it (name, npub, paymentAddress, starred, trash state,
 * timestamps). EVERYTHING else — other apps' contacts, per-contact
 * fields we don't model, top-level keys we don't know — must
 * round-trip byte-for-byte. Every write is a whole-document replace,
 * so a careless publish here would delete another app's data. The
 * merge in this module is therefore strictly additive: it appends or
 * updates the fields BuhoGO owns and never rebuilds the doc from a
 * schema.
 *
 * Timestamps: the doc uses unix SECONDS (the ecosystem convention);
 * BuhoGO entries use milliseconds. Conversion happens only in here so
 * the store never has to think about it.
 *
 * Encryption: NIP-44 v2 self-encryption, same conversation key as the
 * legacy kind:30000 list (see nostrAddressBook.js, which now exists
 * only as the read-side of the one-time migration).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/78.md
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md
 */

import {
  finalizeEvent,
  nip44,
  nip19,
  verifyEvent,
} from 'nostr-core';
import {
  DEFAULT_RELAYS,
  publishToRelaysEager,
  getRelayPool,
} from './nostrRelays.js';
import { deriveSelfConversationKey } from './nostrAddressBook.js';
import { compareEventFreshness } from './nostrFetch.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** NIP-78 application-specific data kind. */
export const CONTACTS_DOC_KIND = 30078;

/**
 * Frozen ecosystem wire format — every app reads and writes exactly
 * this `d` tag. Never rename it: the identifier predates the current
 * app branding on purpose, and a different string is simply a
 * different (invisible) document.
 */
export const CONTACTS_DOC_D_TAG = 'nostroogle:contacts:v1';

/** NIP-65 relay-list kind, read to publish where the user's other apps look. */
export const RELAY_LIST_KIND = 10002;

/**
 * Publish ceiling for the doc's plaintext. NIP-44 hard-caps a
 * plaintext at 65535 bytes; we refuse earlier so a doc near the limit
 * fails cleanly on our side (keep local state, retry later) instead of
 * deep inside the encryption call. Never truncate to fit — aborting
 * loses nothing, truncating loses someone's contacts.
 */
export const MAX_DOC_PLAINTEXT_BYTES = 60000;

/** Same recovery-fetch ceiling rationale as the legacy list. */
export const DEFAULT_DOC_TIMEOUT_MS = 6000;

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

// ----------------------------------------------------------------------------
// Doc shape helpers
// ----------------------------------------------------------------------------

/**
 * Coerce a parsed plaintext into a workable doc WITHOUT dropping
 * anything: unknown top-level keys and unknown per-contact fields are
 * preserved as-is. Only the two keys BuhoGO must iterate get their
 * types enforced.
 *
 * @param {unknown} parsed
 * @returns {{ contacts: object[], labels: unknown[] } & Record<string, unknown>}
 */
export function normalizeDoc(parsed) {
  const doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ...parsed }
    : {};
  doc.contacts = Array.isArray(doc.contacts)
    ? doc.contacts.filter((c) => c && typeof c === 'object')
    : [];
  doc.labels = Array.isArray(doc.labels) ? doc.labels : [];
  return doc;
}

/** Fresh empty doc for identities that have never synced anywhere. */
export function emptyDoc() {
  return { contacts: [], labels: [] };
}

/**
 * Every contact id in the doc, foreign records included. The store's
 * hard-delete detection needs the full id set: a locally-linked id
 * absent from a genuinely fetched doc means the record was deleted
 * forever in another app.
 *
 * @param {object} doc
 * @returns {Set<string>}
 */
export function collectDocContactIds(doc) {
  const ids = new Set();
  for (const contact of normalizeDoc(doc).contacts) {
    const id = normStr(contact.id);
    if (id) ids.add(id);
  }
  return ids;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toSeconds(ms) {
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * Doc contact ids follow the ecosystem convention (`c-` + random hex)
 * so records BuhoGO creates are indistinguishable from native ones.
 */
function newDocContactId() {
  const hex = () => Math.random().toString(16).slice(2, 10);
  return `c-${hex()}${hex().slice(0, 4)}`;
}

function normStr(value) {
  return typeof value === 'string' ? value : '';
}

// ----------------------------------------------------------------------------
// Merge — local entries into the doc (the only write path)
// ----------------------------------------------------------------------------

/**
 * Merge the local address book into a doc. Pure: the input doc is
 * cloned, never mutated. Strictly additive — the fields BuhoGO owns
 * are written, nothing else is touched, and a contact is never
 * un-trashed (trash is a user decision made in another app; syncing
 * must respect it, and a deliberate re-add arrives as a NEW record
 * with a newer timestamp instead).
 *
 * Field ownership per doc contact:
 *   - on create:  id, name, npub/paymentAddress, nip05, picture,
 *                 starred, createdAt, updatedAt
 *   - on update:  name (only when the user renamed the contact
 *                 locally — a kind:0 display name must never clobber
 *                 a rename made in another app), starred, updatedAt;
 *                 plus paymentAddress for manual entries.
 *     nip05/picture are seeded once and then left alone: another app
 *     may have set a custom contact photo, which a profile snapshot
 *     must not overwrite.
 *
 * An update only happens when the local entry's clock is strictly
 * newer than the doc contact's — otherwise the doc wins and the
 * store's reconcile step adopts its values locally instead.
 *
 * @param {{
 *   doc:       object,                      // normalized doc (see normalizeDoc)
 *   entries:   object[],                    // full addressBook entries
 *   deletions: Array<{ pubkey?: string, docId?: string, address?: string,
 *                      deletedAt: number }>,
 *   nowMs?:    number,
 * }} args
 * `extraNostrRecords` carries contacts that must reach the doc even
 * though no local entry exists for them yet — a legacy contact whose
 * kind:0 is currently unfetchable. The doc is the durable home; the
 * local import catches up on a later sync. Records whose npub is
 * already in the doc (live or trashed) are skipped.
 *
 * @returns {{
 *   doc:     object,                        // merged clone
 *   changed: boolean,                       // any mutation happened
 *   links:   Record<string, string>,        // entry.id -> doc contact id
 * }}
 */
export function mergeEntriesIntoDoc({
  doc,
  entries,
  deletions = [],
  extraNostrRecords = [],
  nowMs = Date.now(),
}) {
  const merged = normalizeDoc(clone(doc));
  const links = {};
  let changed = false;

  const byNpub = new Map();
  const byAddress = new Map();
  const byId = new Map();
  for (const contact of merged.contacts) {
    const npub = normStr(contact.npub).toLowerCase();
    if (npub) {
      const list = byNpub.get(npub) || [];
      list.push(contact);
      byNpub.set(npub, list);
    }
    // Address matching exists for identity-less records only. A doc
    // contact that carries an npub is someone's nostr-identity
    // contact — a same-address manual entry or an address tombstone
    // must never rename, re-star, or trash it through this index.
    const address = normStr(contact.paymentAddress).toLowerCase();
    if (address && !npub) {
      const list = byAddress.get(address) || [];
      list.push(contact);
      byAddress.set(address, list);
    }
    if (normStr(contact.id)) byId.set(contact.id, contact);
  }

  // Prefer a live match; a trashed one only matters for the
  // never-un-trash rule (see below).
  const pickMatch = (candidates) => {
    if (!candidates || candidates.length === 0) return null;
    return candidates.find((c) => !c.trashed) || candidates[0];
  };

  const nowSec = toSeconds(nowMs);

  const appendContact = (entry, identityFields) => {
    const record = {
      id: newDocContactId(),
      name: normStr(entry.name).slice(0, 80),
      ...identityFields,
      starred: !!entry.isFavorite,
      createdAt: toSeconds(entry.createdAt) || nowSec,
      updatedAt: toSeconds(entry.updatedAt) || nowSec,
    };
    merged.contacts.push(record);
    changed = true;
    return record;
  };

  const updateContact = (contact, entry, extra = {}) => {
    const entrySec = toSeconds(entry.updatedAt);
    if (!(entrySec > (Number.isFinite(contact.updatedAt) ? contact.updatedAt : 0))) return;
    let touched = false;
    const assign = (key, value) => {
      if (value !== undefined && contact[key] !== value) {
        contact[key] = value;
        touched = true;
      }
    };
    // A rename made in BuhoGO travels; a profile-derived name does not
    // overwrite what another app calls this person.
    if (entry.source === 'nostr' ? entry.name_locally_edited : true) {
      assign('name', normStr(entry.name).slice(0, 80));
    }
    assign('starred', !!entry.isFavorite);
    for (const [key, value] of Object.entries(extra)) assign(key, value);
    if (touched) {
      contact.updatedAt = entrySec;
      changed = true;
    }
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.id !== 'string') continue;

    if (entry.source === 'nostr') {
      const npub = normStr(entry.nostr_npub).toLowerCase();
      if (!/^npub1[0-9a-z]+$/.test(npub)) continue;
      const match = pickMatch(byNpub.get(npub));
      if (!match) {
        const profile = entry.nostr_profile || {};
        links[entry.id] = appendContact(entry, {
          npub: normStr(entry.nostr_npub),
          nip05: normStr(profile.nip05),
          picture: normStr(profile.picture),
        }).id;
      } else if (match.trashed) {
        // Trashed in another app. A strictly-newer local entry means
        // the user re-added the person after that trash — a fresh
        // record with the new clock. Otherwise the trash stands and
        // the reconcile step removes the local entry.
        if (toSeconds(entry.updatedAt) > (match.updatedAt || 0)) {
          const profile = entry.nostr_profile || {};
          links[entry.id] = appendContact(entry, {
            npub: normStr(entry.nostr_npub),
            nip05: normStr(profile.nip05),
            picture: normStr(profile.picture),
          }).id;
        }
      } else {
        links[entry.id] = normStr(match.id);
        updateContact(match, entry);
      }
      continue;
    }

    // Manual entry (no source / 'manual'): identified by its payment
    // address, or by the doc contact it is already linked to.
    const address = normStr(entry.address || entry.lightningAddress).trim();
    if (!address) continue;
    const linked = normStr(entry.doc_contact_id) && byId.get(entry.doc_contact_id);
    const match = linked || pickMatch(byAddress.get(address.toLowerCase()));
    if (!match) {
      links[entry.id] = appendContact(entry, { paymentAddress: address }).id;
    } else if (match.trashed) {
      if (toSeconds(entry.updatedAt) > (match.updatedAt || 0)) {
        links[entry.id] = appendContact(entry, { paymentAddress: address }).id;
      }
    } else {
      links[entry.id] = normStr(match.id);
      updateContact(match, entry, { paymentAddress: address });
    }
  }

  for (const rec of Array.isArray(extraNostrRecords) ? extraNostrRecords : []) {
    const pubkey = normStr(rec.pubkey).toLowerCase();
    if (!HEX_PUBKEY_RE.test(pubkey)) continue;
    let npub = '';
    try {
      npub = nip19.npubEncode(pubkey);
    } catch {
      continue;
    }
    if (byNpub.has(npub.toLowerCase())) continue;
    const record = {
      id: newDocContactId(),
      name: (normStr(rec.name).trim() || `${npub.slice(0, 12)}…`).slice(0, 80),
      npub,
      starred: !!rec.starred,
      createdAt: toSeconds(rec.addedAt) || nowSec,
      updatedAt: toSeconds(rec.updatedAt || rec.addedAt) || nowSec,
    };
    merged.contacts.push(record);
    byNpub.set(npub.toLowerCase(), [record]);
    changed = true;
  }

  // Deletes travel as trash, the ecosystem's recoverable soft-delete —
  // never as removal from the doc, which another app could not tell
  // apart from a stale write.
  for (const del of Array.isArray(deletions) ? deletions : []) {
    if (!del || !Number.isFinite(del.deletedAt)) continue;
    const delSec = toSeconds(del.deletedAt);
    let target = null;
    if (typeof del.docId === 'string' && byId.has(del.docId)) {
      target = byId.get(del.docId);
    } else if (typeof del.pubkey === 'string' && HEX_PUBKEY_RE.test(del.pubkey)) {
      let npub = '';
      try {
        npub = nip19.npubEncode(del.pubkey).toLowerCase();
      } catch {
        npub = '';
      }
      target = npub ? pickMatch(byNpub.get(npub)) : null;
    } else if (typeof del.address === 'string' && del.address) {
      target = pickMatch(byAddress.get(del.address.toLowerCase()));
    }
    if (!target || target.trashed) continue;
    // `>=`: the doc clock is whole seconds, so a delete issued moments
    // after the write it targets often lands in the same second — the
    // trash must still win that tie or the delete silently no-ops.
    if (delSec >= (Number.isFinite(target.updatedAt) ? target.updatedAt : 0)) {
      target.trashed = true;
      target.trashedAt = delSec;
      target.updatedAt = delSec;
      changed = true;
    }
  }

  return { doc: merged, changed, links };
}

// ----------------------------------------------------------------------------
// Extract — the doc contacts BuhoGO can represent locally
// ----------------------------------------------------------------------------

/**
 * Categorize the doc's contacts for the store's reconcile step.
 * Contacts with neither an npub nor a payment address are another
 * app's vCard-only records (a phone number, an email) — BuhoGO can't
 * do anything with them, so they stay untouched passengers in the doc
 * and are not returned here.
 *
 * @param {object} doc  normalized doc
 * @returns {{
 *   nostr:  Array<{ docId: string, npub: string, pubkey: string, name: string,
 *                   starred: boolean, trashed: boolean,
 *                   updatedAtMs: number, createdAtMs: number }>,
 *   manual: Array<{ docId: string, name: string, paymentAddress: string,
 *                   starred: boolean, trashed: boolean,
 *                   updatedAtMs: number, createdAtMs: number }>,
 * }}
 */
export function extractDocContacts(doc) {
  const nostr = [];
  const manual = [];
  for (const contact of normalizeDoc(doc).contacts) {
    const base = {
      docId: normStr(contact.id),
      name: normStr(contact.name),
      starred: !!contact.starred,
      trashed: !!contact.trashed,
      updatedAtMs: (Number.isFinite(contact.updatedAt) ? contact.updatedAt : 0) * 1000,
      createdAtMs: (Number.isFinite(contact.createdAt) ? contact.createdAt : 0) * 1000,
    };

    const npub = normStr(contact.npub);
    if (npub) {
      let pubkey = '';
      try {
        const decoded = nip19.decode(npub);
        if (decoded.type === 'npub' && typeof decoded.data === 'string') {
          pubkey = decoded.data.toLowerCase();
        }
      } catch {
        pubkey = '';
      }
      // An undecodable npub is treated as foreign data: preserved in
      // the doc, unusable locally.
      if (HEX_PUBKEY_RE.test(pubkey)) {
        nostr.push({ ...base, npub, pubkey });
      }
      continue;
    }

    const paymentAddress = normStr(contact.paymentAddress).trim();
    if (paymentAddress) {
      manual.push({ ...base, paymentAddress });
    }
  }
  return { nostr, manual };
}

// ----------------------------------------------------------------------------
// Event build / publish / fetch
// ----------------------------------------------------------------------------

/**
 * Build and sign the kind:30078 event carrying the encrypted doc.
 *
 * @param {{
 *   secretKey:  Uint8Array,
 *   pubkey:     string,
 *   doc:        object,
 *   createdAt?: number,     // seconds; the caller owns the replaceable clock
 * }} args
 * @throws Error with code 'CONTACTS_DOC_TOO_LARGE' when the plaintext
 *         exceeds MAX_DOC_PLAINTEXT_BYTES — the caller keeps its dirty
 *         state and retries later; nothing is truncated.
 */
export function buildContactsDocEvent({ secretKey, pubkey, doc, createdAt }) {
  const plaintext = JSON.stringify(doc);
  const bytes = new TextEncoder().encode(plaintext).length;
  if (bytes > MAX_DOC_PLAINTEXT_BYTES) {
    const err = new Error(`contacts doc plaintext is ${bytes} bytes (max ${MAX_DOC_PLAINTEXT_BYTES})`);
    err.code = 'CONTACTS_DOC_TOO_LARGE';
    throw err;
  }
  const conversationKey = deriveSelfConversationKey(secretKey, pubkey);
  const content = nip44.encrypt(plaintext, conversationKey);
  return finalizeEvent({
    kind: CONTACTS_DOC_KIND,
    created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
    tags: [
      ['d', CONTACTS_DOC_D_TAG],
      ['client', 'buhogo'],
      ['encrypted', 'nip44'],
    ],
    content,
  }, secretKey);
}

/**
 * Fan the signed doc event out to the relay set. Same shape-agnostic
 * contract as the profile/legacy publish helpers.
 */
export function publishContactsDoc({ pool, relays, event, timeoutMs }) {
  const activePool = pool ?? getRelayPool();
  const urls = Array.isArray(relays) && relays.length > 0 ? relays : DEFAULT_RELAYS;
  return publishToRelaysEager(activePool, [...urls], event, { timeoutMs });
}

/**
 * Query one relay with a provable reachability outcome.
 *
 * nostr-core's `querySync` alone cannot provide one: a socket that
 * never connects resolves `[]` exactly like a connected relay with no
 * matching events, and treating that as "reached, empty" is how a
 * network blackout turns into publishing a fresh doc over the real
 * one. `ensureRelay` rejects on a failed handshake, so connect-then-
 * query makes `null` mean "not reached" while an array means "this
 * relay really answered". An empty answer from a socket that died
 * mid-query proves nothing and is demoted to "not reached" as well.
 *
 * A pool without `ensureRelay` cannot prove a connection, so it can
 * never prove absence either — events still count, emptiness doesn't.
 *
 * @returns {Promise<object[] | null>}  events, or null when unreached
 */
async function queryOneRelay(pool, url, filter, maxWait) {
  if (typeof pool.ensureRelay !== 'function') {
    const events = await pool.querySync([url], filter, { maxWait });
    return Array.isArray(events) && events.length > 0 ? events : null;
  }
  let relay;
  try {
    relay = await pool.ensureRelay(url, { connectionTimeout: maxWait });
  } catch {
    return null;
  }
  // The pool synthesizes EOSE after the relay's own eoseTimeout
  // (default well under our window) — a connected-but-slow relay
  // would answer [] and count as reached. Give it the full window.
  if (relay) relay.eoseTimeout = maxWait;
  const events = await pool.querySync([url], filter, { maxWait });
  if (!Array.isArray(events)) return null;
  if (events.length === 0 && relay && relay.connected === false) return null;
  return events;
}

/**
 * Fetch the newest shared contacts doc for the given identity.
 *
 * Relays are queried INDIVIDUALLY (not as one pooled query) because
 * the caller must be able to distinguish "no doc exists" from "no
 * relay answered". A replaceable event that exists but sits on a relay
 * we couldn't reach must never be treated as absent — publishing a
 * fresh doc over it would delete the user's contacts in every app.
 * `reachedRelays` counts relays whose socket provably connected (see
 * `queryOneRelay`); the caller decides how many are enough to trust
 * an empty result.
 *
 * @param {{
 *   pool?:      any,
 *   relays?:    readonly string[],
 *   pubkey:     string,
 *   secretKey:  Uint8Array,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{
 *   found:         boolean,
 *   doc:           object | null,   // normalized when found
 *   event:         object | null,
 *   reachedRelays: number,
 * }>}
 * @throws Error with code 'CONTACTS_DOC_DECRYPT_FAILED' when the
 *         newest valid event cannot be decrypted or parsed — the
 *         caller must NOT publish over a doc it cannot read.
 */
export async function fetchContactsDoc({ pool, relays, pubkey, secretKey, timeoutMs }) {
  if (typeof pubkey !== 'string' || !HEX_PUBKEY_RE.test(pubkey.toLowerCase())) {
    throw new TypeError('pubkey must be a 64-char hex string');
  }
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }
  const activePool = pool ?? getRelayPool();
  const urls = Array.isArray(relays) && relays.length > 0 ? [...relays] : [...DEFAULT_RELAYS];
  const maxWait = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_DOC_TIMEOUT_MS;
  const pubkeyHex = pubkey.toLowerCase();

  const filter = {
    kinds: [CONTACTS_DOC_KIND],
    authors: [pubkeyHex],
    '#d': [CONTACTS_DOC_D_TAG],
    limit: 1,
  };

  const perRelay = await Promise.allSettled(
    urls.map((url) => queryOneRelay(activePool, url, filter, maxWait)),
  );

  let reachedRelays = 0;
  const candidates = [];
  for (const outcome of perRelay) {
    if (outcome.status !== 'fulfilled' || !Array.isArray(outcome.value)) continue;
    reachedRelays += 1;
    candidates.push(...outcome.value);
  }

  const valid = candidates.filter((event) => {
    if (!event || event.kind !== CONTACTS_DOC_KIND) return false;
    if (event.pubkey !== pubkeyHex) return false;
    const dTag = Array.isArray(event.tags)
      ? event.tags.find((t) => Array.isArray(t) && t[0] === 'd')
      : null;
    if (!dTag || dTag[1] !== CONTACTS_DOC_D_TAG) return false;
    try {
      return verifyEvent(event) === true;
    } catch {
      return false;
    }
  });

  if (valid.length === 0) {
    return { found: false, doc: null, event: null, reachedRelays };
  }

  valid.sort(compareEventFreshness);
  const winner = valid[0];

  let doc;
  try {
    const conversationKey = deriveSelfConversationKey(secretKey, pubkeyHex);
    doc = normalizeDoc(JSON.parse(nip44.decrypt(winner.content, conversationKey)));
  } catch (err) {
    const wrapped = new Error('contacts doc could not be decrypted');
    wrapped.code = 'CONTACTS_DOC_DECRYPT_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  return { found: true, doc, event: winner, reachedRelays };
}

/**
 * Best-effort read of the user's own NIP-65 write relays, so the doc
 * lands where their other apps look for it (they resolve NIP-65
 * first). Returns [] on any failure — the caller always unions with
 * DEFAULT_RELAYS, so a miss here just narrows discovery, never breaks
 * the sync.
 *
 * @returns {Promise<string[]>}
 */
export async function fetchOwnWriteRelays({ pool, relays, pubkey, timeoutMs } = {}) {
  try {
    if (typeof pubkey !== 'string' || !HEX_PUBKEY_RE.test(pubkey.toLowerCase())) return [];
    const activePool = pool ?? getRelayPool();
    const urls = Array.isArray(relays) && relays.length > 0 ? [...relays] : [...DEFAULT_RELAYS];
    const maxWait = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_DOC_TIMEOUT_MS;
    const pubkeyHex = pubkey.toLowerCase();

    const events = await activePool.querySync(urls, {
      kinds: [RELAY_LIST_KIND],
      authors: [pubkeyHex],
      limit: 1,
    }, { maxWait });
    if (!Array.isArray(events) || events.length === 0) return [];

    const valid = events.filter((event) => {
      if (!event || event.kind !== RELAY_LIST_KIND || event.pubkey !== pubkeyHex) return false;
      try {
        return verifyEvent(event) === true;
      } catch {
        return false;
      }
    });
    if (valid.length === 0) return [];
    valid.sort(compareEventFreshness);

    const out = [];
    for (const tag of valid[0].tags || []) {
      if (!Array.isArray(tag) || tag[0] !== 'r') continue;
      const url = typeof tag[1] === 'string' ? tag[1].trim() : '';
      const marker = tag[2];
      if (!/^wss?:\/\//i.test(url)) continue;
      if (marker === undefined || marker === 'write') out.push(url);
    }
    return out;
  } catch {
    return [];
  }
}
