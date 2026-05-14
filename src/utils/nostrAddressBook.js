/**
 * Private NIP-51 address book sync.
 *
 * The address book stores Nostr-sourced contacts locally so the app
 * works offline. But the user expects their contacts to come back
 * when they restore their BuhoGO identity on another device — losing
 * "your people" on every device swap would be a much worse UX than
 * losing transaction metadata. To deliver that promise, we publish
 * the canonical contact list (just pubkeys + relay hints + the
 * user's local petname when they renamed someone) as an encrypted
 * NIP-51 `kind:30000` event with a stable `d` tag.
 *
 * Two things are intentionally NOT synced:
 *
 *   1. The kind:0 snapshot (`nostr_event`, `nostr_profile`). It's
 *      cache, re-fetchable from any relay. Syncing it would only
 *      bloat the payload and risk staleness.
 *   2. Purely local UI metadata (color, isFavorite, notes, manual
 *      contacts without a pubkey). These stay device-local; the
 *      sync layer is for portable identity references only.
 *
 * Encryption: NIP-44 v2 via `nostr-core`. The conversation key is
 * derived from the user's own (sk, pk) pair — i.e. self-encryption,
 * the standard NIP-51 private-list pattern. Only the wallet's owner
 * can decrypt the list, and the relays only see a ciphertext blob.
 *
 * This module is intentionally provider-agnostic: callers inject the
 * relay pool, the secret key (as bytes), and any relay-list override.
 * That makes the unit tests trivial and keeps the production paths
 * — addressBook.syncToNostr / addressBook.recoverFromNostr — thin.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/51.md
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md
 */

import {
  finalizeEvent,
  nip44,
  verifyEvent,
} from 'nostr-core';
import {
  DEFAULT_RELAYS,
  publishToRelaysEager,
  getRelayPool,
} from './nostrRelays.js';
import { compareEventFreshness } from './nostrFetch.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** NIP-51 parameterized-replaceable kind for arbitrary categorised lists. */
export const ADDRESS_BOOK_KIND = 30000;

/**
 * Stable `d` tag identifying this list among all the user's kind:30000
 * events. Forms the (kind, pubkey, d) tuple NIP-01 uses for the
 * replaceable-event identity, so future publishes always overwrite the
 * same list rather than creating siblings.
 */
export const ADDRESS_BOOK_D_TAG = 'buhogo-address-book';

/**
 * Hard ceiling for the fetch-during-recovery round trip. Long enough
 * to absorb a slow first connect on a fresh install; short enough
 * that a flaky relay can't strand the restore wizard.
 */
export const DEFAULT_RECOVERY_TIMEOUT_MS = 6000;

// ----------------------------------------------------------------------------
// Payload shape
// ----------------------------------------------------------------------------

/**
 * @typedef {{
 *   pubkey:   string,          // 64-char lowercase hex
 *   relays?:  string[],        // wss:// / ws:// hints, may be empty
 *   petname?: string,          // present iff user locally renamed the contact
 *   addedAt?: number,          // ms since epoch — preserves original "added" order
 * }} SyncedContact
 */

/**
 * Pick the minimum set of fields we need to rebuild a Nostr-sourced
 * contact on another device. Manual address-book entries (no
 * `nostr_pubkey`) are excluded outright — they aren't portable as a
 * Nostr identity reference.
 *
 *   - `pubkey`  is required; entries without one are dropped
 *   - `relays`  is kept as-is when non-empty so the recovery fetch can
 *               prefer the user's own write set
 *   - `petname` is included only when the local name diverges from
 *               what kind:0 would currently produce (mirrors the
 *               `name_locally_edited` flag from the store)
 *   - `addedAt` is the original `createdAt` so the restored ordering
 *               matches the user's mental model
 *
 * Returned array is sorted by pubkey for deterministic output —
 * identical input always produces identical pre-encryption bytes,
 * which makes the test surface simpler.
 *
 * @param {Array<object>} entries  full addressBook entries (any source)
 * @returns {SyncedContact[]}
 */
export function serializeContactPayload(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (!entry || entry.source !== 'nostr') continue;
    const pubkey = typeof entry.nostr_pubkey === 'string'
      ? entry.nostr_pubkey.toLowerCase()
      : '';
    if (!/^[0-9a-f]{64}$/.test(pubkey)) continue;

    const record = { pubkey };

    if (Array.isArray(entry.nostr_relay_hints) && entry.nostr_relay_hints.length > 0) {
      const sanitized = entry.nostr_relay_hints
        .filter((r) => typeof r === 'string' && /^wss?:\/\//i.test(r))
        .map((r) => r.trim());
      if (sanitized.length > 0) record.relays = sanitized;
    }

    if (entry.name_locally_edited && typeof entry.name === 'string' && entry.name.trim()) {
      record.petname = entry.name.trim().slice(0, 80);
    }

    if (Number.isFinite(entry.createdAt)) {
      record.addedAt = entry.createdAt;
    }

    out.push(record);
  }
  out.sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
  return out;
}

/**
 * Defensive parser for an incoming payload (post-decryption). Rejects
 * any row that can't be made into a usable {@link SyncedContact} —
 * one corrupt entry never poisons the whole list.
 *
 * Always returns an array. Throws only when the input is not valid
 * JSON of an array at the root (i.e. the encryption layer succeeded
 * but the plaintext is structurally wrong).
 *
 * @param {string} plaintext  result of decrypting the kind:30000 content
 * @returns {SyncedContact[]}
 */
export function deserializeContactPayload(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const pubkey = typeof raw.pubkey === 'string' ? raw.pubkey.toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(pubkey)) continue;

    const record = { pubkey };

    if (Array.isArray(raw.relays)) {
      const sanitized = raw.relays
        .filter((r) => typeof r === 'string' && /^wss?:\/\//i.test(r))
        .map((r) => r.trim());
      if (sanitized.length > 0) record.relays = sanitized;
    }

    if (typeof raw.petname === 'string' && raw.petname.trim()) {
      record.petname = raw.petname.trim().slice(0, 80);
    }

    if (Number.isFinite(raw.addedAt)) {
      record.addedAt = raw.addedAt;
    }

    out.push(record);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Encryption — NIP-44 v2 self-encryption
// ----------------------------------------------------------------------------

/**
 * Derive the NIP-44 conversation key for self-encryption. Wrapped so
 * tests can stub it deterministically and callers don't have to know
 * about the (sk, pk) symmetry of NIP-51 private lists.
 *
 * @param {Uint8Array} secretKey  user's Nostr secret key (32 bytes)
 * @param {string}     pubkey     user's Nostr public key (64-char hex)
 * @returns {Uint8Array}          opaque conversation-key bytes
 */
export function deriveSelfConversationKey(secretKey, pubkey) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new TypeError('pubkey must be a 64-char hex string');
  }
  return nip44.getConversationKey(secretKey, pubkey.toLowerCase());
}

/**
 * @param {SyncedContact[]} payload
 * @param {Uint8Array}      conversationKey
 * @returns {string}        base64-ish NIP-44 v2 ciphertext
 */
export function encryptAddressBookContent(payload, conversationKey) {
  const plaintext = JSON.stringify(payload || []);
  return nip44.encrypt(plaintext, conversationKey);
}

/**
 * @param {string}     content          ciphertext from kind:30000.content
 * @param {Uint8Array} conversationKey
 * @returns {SyncedContact[]}
 *
 * @throws Error('ADDRESS_BOOK_DECRYPT_FAILED')  when nip44 can't decrypt
 *         — usually because the ciphertext was forged or encrypted
 *         against a different identity than the one we hold.
 */
export function decryptAddressBookContent(content, conversationKey) {
  let plaintext;
  try {
    plaintext = nip44.decrypt(content, conversationKey);
  } catch (err) {
    const wrapped = new Error('address book ciphertext could not be decrypted');
    wrapped.code = 'ADDRESS_BOOK_DECRYPT_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }
  return deserializeContactPayload(plaintext);
}

// ----------------------------------------------------------------------------
// Event builder
// ----------------------------------------------------------------------------

/**
 * Build, sign, and return the NIP-51 kind:30000 event that carries
 * the encrypted address-book list. Always uses the same `d` tag
 * (`buhogo-address-book`) so each publish replaces the previous
 * snapshot under NIP-01's parameterised-replaceable rule.
 *
 * @param {{
 *   secretKey: Uint8Array,
 *   pubkey:    string,
 *   payload:   SyncedContact[],
 *   createdAt?: number,        // seconds since epoch; defaults to now
 * }} args
 * @returns {import('nostr-core').NostrEvent}
 */
export function buildAddressBookEvent({ secretKey, pubkey, payload, createdAt }) {
  const conversationKey = deriveSelfConversationKey(secretKey, pubkey);
  const content = encryptAddressBookContent(payload, conversationKey);
  const event = finalizeEvent({
    kind: ADDRESS_BOOK_KIND,
    created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
    tags: [['d', ADDRESS_BOOK_D_TAG]],
    content,
  }, secretKey);
  return event;
}

// ----------------------------------------------------------------------------
// Publish / fetch — high-level entry points
// ----------------------------------------------------------------------------

/**
 * Fan out the freshly-signed event to the user's relay set. Returns
 * the raw `{ firstAccept, allSettled }` pair from
 * `publishToRelaysEager` — the store layer is responsible for
 * collapsing that into a UX-facing `{ ok, acceptedRelay, settled }`
 * shape the same way `profileStore.publish` does. Keeping the
 * utility shape-agnostic lets two stores (profile + address book)
 * use the same fan-out helper without enforcing one result format.
 *
 * @param {{
 *   pool?:   import('nostr-core').RelayPool,
 *   relays?: readonly string[],
 *   event:   import('nostr-core').NostrEvent,
 *   timeoutMs?: number,
 * }} args
 * @returns {{
 *   firstAccept: Promise<import('./nostrRelays.js').RelayPublishResult | null>,
 *   allSettled:  Promise<import('./nostrRelays.js').RelayPublishResult[]>,
 * }}
 */
export function publishAddressBook({ pool, relays, event, timeoutMs }) {
  const activePool = pool ?? getRelayPool();
  const urls = Array.isArray(relays) && relays.length > 0 ? relays : DEFAULT_RELAYS;
  return publishToRelaysEager(activePool, [...urls], event, { timeoutMs });
}

/**
 * Fetch the most recent encrypted address-book event for the given
 * pubkey, verify it, decrypt it, and return the parsed contact list.
 *
 * Network / verification / decryption failures all collapse to a
 * single typed-error surface so the recovery UI can show ONE banner
 * regardless of which step failed. Returns `null` when no event was
 * ever published — that is not an error, it is the "fresh wallet"
 * case the recovery flow must also handle.
 *
 * @param {{
 *   pool?:      import('nostr-core').RelayPool,
 *   relays?:    readonly string[],
 *   pubkey:     string,
 *   secretKey:  Uint8Array,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{
 *   contacts: SyncedContact[],
 *   eventCreatedAt: number,
 * } | null>}
 *
 * @throws Error('ADDRESS_BOOK_DECRYPT_FAILED')  ciphertext wasn't for us
 */
export async function fetchAddressBook({ pool, relays, pubkey, secretKey, timeoutMs }) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new TypeError('pubkey must be a 64-char hex string');
  }
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }

  const activePool = pool ?? getRelayPool();
  if (!activePool || typeof activePool.querySync !== 'function') {
    throw new TypeError('pool must implement querySync(urls, filter, params)');
  }

  const urls = Array.isArray(relays) && relays.length > 0 ? relays : DEFAULT_RELAYS;
  const maxWait = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_RECOVERY_TIMEOUT_MS;
  const pubkeyHex = pubkey.toLowerCase();

  let events;
  try {
    events = await activePool.querySync(
      [...urls],
      {
        kinds: [ADDRESS_BOOK_KIND],
        authors: [pubkeyHex],
        '#d': [ADDRESS_BOOK_D_TAG],
        limit: 1,
      },
      { maxWait },
    );
  } catch (err) {
    console.warn('[nostr] fetchAddressBook failed for', pubkeyHex, ':', err);
    return null;
  }

  if (!Array.isArray(events) || events.length === 0) return null;

  // Verification gate — same correctness rules as fetchProfile:
  //   - must be our kind, our pubkey, and the right `d` tag
  //   - signature must verify (defends against relay tampering)
  const valid = events.filter((event) => {
    if (!event || event.kind !== ADDRESS_BOOK_KIND) return false;
    if (event.pubkey !== pubkeyHex) return false;
    const dTag = Array.isArray(event.tags)
      ? event.tags.find((t) => Array.isArray(t) && t[0] === 'd')
      : null;
    if (!dTag || dTag[1] !== ADDRESS_BOOK_D_TAG) return false;
    try {
      return verifyEvent(event) === true;
    } catch {
      return false;
    }
  });
  if (valid.length === 0) return null;

  // NIP-01 replaceable tie-break — newest created_at, lexically lowest id.
  valid.sort(compareEventFreshness);
  const winner = valid[0];

  const conversationKey = deriveSelfConversationKey(secretKey, pubkeyHex);
  const contacts = decryptAddressBookContent(winner.content, conversationKey);

  return {
    contacts,
    eventCreatedAt: winner.created_at,
  };
}
