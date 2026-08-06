/**
 * Nostr identity pointer — which NIP-06 account is active, published.
 *
 * BuhoGO derives its Nostr key at m/44'/1237'/<account>'/0/0 from the
 * identity seed. "Create another identity" climbs the account index
 * (0 → 1 → 2 → ...) under the SAME 12 words, but the index itself
 * cannot live inside the phrase — so without outside help a fresh
 * restore always lands on account 0 and every other identity the user
 * created becomes invisible. This event is that outside help: a small
 * replaceable pointer, signed by the ACCOUNT-0 key (the only key
 * derivable from the phrase with no external state), that records
 * which account is active plus the roster of accounts in use.
 *
 * Wire shape (kind 30078, parameterised replaceable):
 *   - tags: ['d', 'buhogo:nostr-identity-pointer:v1'],
 *           ['account', '<active index>'],   // public on purpose —
 *           ['client', 'buhogo'],            // other ecosystem apps can
 *           ['encrypted', 'nip44']           // honor it without decrypting
 *   - content: NIP-44 self-encrypted (account-0 conversation key) JSON
 *       { active: number, accounts: [{ i, label?, createdAt? }] }
 *     The roster is what powers the in-app identity switcher and a
 *     full multi-identity restore; only the one-number active index
 *     leaks publicly ("this npub uses account N" — accepted, see the
 *     plan's privacy note).
 *
 * A pointer that exists but whose content we cannot decrypt is still
 * honored via the public tag with a minimal roster — a half-readable
 * pointer must never be worse than no pointer at all.
 *
 * Like its siblings, this module is provider-agnostic: callers inject
 * the pool, relays, and account-0 key material, which keeps the store
 * paths thin and the unit tests network-free.
 *
 * @see Plans WIP/nostr_identity_recovery.md
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
import { deriveSelfConversationKey } from './nostrAddressBook.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** NIP-78 application-specific data — same kind family as the contacts doc. */
export const POINTER_KIND = 30078;

/**
 * Stable `d` tag for the pointer. Namespaced so it can never collide
 * with the ecosystem's other kind:30078 documents.
 */
export const POINTER_D_TAG = 'buhogo:nostr-identity-pointer:v1';

/** Restore must not hang on a dead relay; discovery is best-effort. */
export const DEFAULT_POINTER_TIMEOUT_MS = 4000;

/** Matches BIP-32's hardened threshold — same bound the identity store uses. */
const MAX_ACCOUNT_INDEX = 2 ** 31;

/** Roster labels are display-only; cap them so a hostile blob can't bloat. */
const MAX_LABEL_LENGTH = 40;

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

// ----------------------------------------------------------------------------
// Roster shape
// ----------------------------------------------------------------------------

/**
 * @typedef {{ i: number, label?: string, createdAt?: number }} RosterAccount
 * @typedef {{ active: number, accounts: RosterAccount[] }} PointerPayload
 */

function isValidAccountIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < MAX_ACCOUNT_INDEX;
}

/**
 * Defensive roster normalisation, shared by build and fetch: drops
 * unusable rows, dedupes by index, clamps labels, guarantees account 0
 * and the active account are present, and sorts by index so identical
 * inputs always serialise identically.
 *
 * @param {unknown} accounts
 * @param {number}  active
 * @returns {RosterAccount[]}
 */
export function sanitizeRoster(accounts, active) {
  const byIndex = new Map();
  if (Array.isArray(accounts)) {
    for (const raw of accounts) {
      if (!raw || !isValidAccountIndex(raw.i) || byIndex.has(raw.i)) continue;
      const entry = { i: raw.i };
      if (typeof raw.label === 'string' && raw.label.trim()) {
        entry.label = raw.label.trim().slice(0, MAX_LABEL_LENGTH);
      }
      if (Number.isFinite(raw.createdAt)) entry.createdAt = raw.createdAt;
      byIndex.set(raw.i, entry);
    }
  }
  if (!byIndex.has(0)) byIndex.set(0, { i: 0 });
  if (isValidAccountIndex(active) && !byIndex.has(active)) {
    byIndex.set(active, { i: active });
  }
  return [...byIndex.values()].sort((a, b) => a.i - b.i);
}

// ----------------------------------------------------------------------------
// Event builder
// ----------------------------------------------------------------------------

/**
 * Build and sign the pointer event with the account-0 key.
 *
 * @param {{
 *   secretKey0: Uint8Array,   // account-0 secret key (32 bytes)
 *   pubkey0:    string,       // account-0 x-only pubkey (64-char hex)
 *   active:     number,       // active NIP-06 account index
 *   accounts:   RosterAccount[],
 *   createdAt?: number,       // seconds; defaults to now
 * }} args
 * @returns {import('nostr-core').NostrEvent}
 */
export function buildPointerEvent({ secretKey0, pubkey0, active, accounts, createdAt }) {
  if (!isValidAccountIndex(active)) {
    throw new TypeError('active must be a valid NIP-06 account index');
  }
  const roster = sanitizeRoster(accounts, active);
  const payload = { active, accounts: roster };
  const conversationKey = deriveSelfConversationKey(secretKey0, pubkey0);
  const content = nip44.encrypt(JSON.stringify(payload), conversationKey);
  return finalizeEvent({
    kind: POINTER_KIND,
    created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
    tags: [
      ['d', POINTER_D_TAG],
      ['account', String(active)],
      ['client', 'buhogo'],
      ['encrypted', 'nip44'],
    ],
    content,
  }, secretKey0);
}

// ----------------------------------------------------------------------------
// Fetch
// ----------------------------------------------------------------------------

/**
 * Fetch the newest pointer for an identity's account-0 key.
 *
 * Returns `null` when no pointer was ever published — that is the
 * normal "never created another identity" case, and the caller's safe
 * fallback is account 0 (today's behavior). Unlike the contacts doc,
 * a missed pointer is recoverable (the user can switch manually), so
 * a single pooled query is enough — no per-relay absence proof here.
 *
 * When the event validates but its content will not decrypt (an
 * ecosystem app published a plaintext-tag-only pointer, or the blob
 * is damaged), the public `account` tag still wins with a minimal
 * roster: honoring half a pointer beats ignoring it.
 *
 * @param {{
 *   pool?:      any,
 *   relays?:    readonly string[],
 *   pubkey0:    string,
 *   secretKey0: Uint8Array,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{
 *   active:         number,
 *   accounts:       RosterAccount[],
 *   eventCreatedAt: number,
 *   decrypted:      boolean,
 * } | null>}
 */
export async function fetchPointer({ pool, relays, pubkey0, secretKey0, timeoutMs }) {
  if (typeof pubkey0 !== 'string' || !HEX_PUBKEY_RE.test(pubkey0.toLowerCase())) {
    throw new TypeError('pubkey0 must be a 64-char hex string');
  }
  if (!(secretKey0 instanceof Uint8Array) || secretKey0.length !== 32) {
    throw new TypeError('secretKey0 must be a 32-byte Uint8Array');
  }

  const activePool = pool ?? getRelayPool();
  const urls = Array.isArray(relays) && relays.length > 0 ? [...relays] : [...DEFAULT_RELAYS];
  const maxWait = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_POINTER_TIMEOUT_MS;
  const pubkeyHex = pubkey0.toLowerCase();

  let events;
  try {
    events = await activePool.querySync(urls, {
      kinds: [POINTER_KIND],
      authors: [pubkeyHex],
      '#d': [POINTER_D_TAG],
      limit: 1,
    }, { maxWait });
  } catch (err) {
    console.warn('[nostr] fetchPointer failed for', pubkeyHex, ':', err);
    return null;
  }
  if (!Array.isArray(events) || events.length === 0) return null;

  const valid = events.filter((event) => {
    if (!event || event.kind !== POINTER_KIND) return false;
    if (event.pubkey !== pubkeyHex) return false;
    const dTag = Array.isArray(event.tags)
      ? event.tags.find((t) => Array.isArray(t) && t[0] === 'd')
      : null;
    if (!dTag || dTag[1] !== POINTER_D_TAG) return false;
    try {
      return verifyEvent(event) === true;
    } catch {
      return false;
    }
  });
  if (valid.length === 0) return null;

  valid.sort(compareEventFreshness);
  const winner = valid[0];

  const accountTag = (winner.tags || []).find(
    (t) => Array.isArray(t) && t[0] === 'account',
  );
  const tagActive = accountTag ? Number.parseInt(accountTag[1], 10) : NaN;

  // Preferred source of truth: the encrypted roster.
  try {
    const conversationKey = deriveSelfConversationKey(secretKey0, pubkeyHex);
    const payload = JSON.parse(nip44.decrypt(winner.content, conversationKey));
    if (payload && isValidAccountIndex(payload.active)) {
      return {
        active: payload.active,
        accounts: sanitizeRoster(payload.accounts, payload.active),
        eventCreatedAt: winner.created_at,
        decrypted: true,
      };
    }
  } catch {
    // Fall through to the public tag below.
  }

  if (!isValidAccountIndex(tagActive)) return null;
  return {
    active: tagActive,
    accounts: sanitizeRoster([], tagActive),
    eventCreatedAt: winner.created_at,
    decrypted: false,
  };
}

// ----------------------------------------------------------------------------
// Publish
// ----------------------------------------------------------------------------

/**
 * Fan the signed pointer out to the relay set. Same shape-agnostic
 * `{ firstAccept, allSettled }` contract as the doc/profile helpers.
 */
export function publishPointer({ pool, relays, event, timeoutMs }) {
  const activePool = pool ?? getRelayPool();
  const urls = Array.isArray(relays) && relays.length > 0 ? relays : DEFAULT_RELAYS;
  return publishToRelaysEager(activePool, [...urls], event, { timeoutMs });
}
