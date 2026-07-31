/**
 * Nostr read layer for BuhoGO.
 *
 * Counterpart to `nostrRelays.js`: publishing fans out events,
 * fetching queries them back. Built on top of nostr-core's
 * `pool.querySync` so we inherit its EOSE handling + connection
 * reuse for free, but we add the BuhoGO-side correctness rules:
 *
 *   - Signature verification on every event before we return it.
 *     A malicious relay could otherwise serve a forged kind:0 that
 *     would make the UI render the wrong avatar / name / lud16 for
 *     a real pubkey. `verifyEvent` is ~1ms per event; cheap insurance.
 *
 *   - NIP-01 replaceable-event tie-break. When multiple relays
 *     each return their own copy of a kind:0, the spec says:
 *       1. higher `created_at` wins
 *       2. on a tie, lexically lowest `id` wins
 *     Without this, two clients with the same author + timestamp
 *     could disagree on which event is "the" current profile.
 *
 *   - Pool / network failures collapse to `null`, never throw.
 *     The UI never has to wrap `fetchProfile` in a try/catch; an
 *     unreachable relay or a missing profile look the same from
 *     the caller's perspective (no data).
 *
 * Input validation throws synchronously (bad pubkey, missing pool)
 * — those are programming bugs, not user-facing conditions.
 */

import { verifyEvent } from 'nostr-core';
import { DEFAULT_RELAYS, getRelayPool } from './nostrRelays.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** NIP-01 profile metadata event kind. */
export const PROFILE_KIND = 0;

/**
 * Hard ceiling on how long a single profile fetch may take before
 * we treat the result as empty. Used as `maxWait` for
 * `pool.querySync`. Short enough that a slow relay can't strand the
 * UI; long enough to absorb a typical WebSocket round-trip + EOSE.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 4000;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * NIP-01 tie-break for replaceable events. Higher `created_at`
 * wins; on a tie, the lexically lowest `id` is treated as the
 * latest. Exported as a stable sort comparator so address-book
 * sync logic can re-use it on its persisted snapshots.
 */
export function compareEventFreshness(a, b) {
  const dt = (b?.created_at || 0) - (a?.created_at || 0);
  if (dt !== 0) return dt;
  const aid = a?.id || '';
  const bid = b?.id || '';
  if (aid === bid) return 0;
  return aid < bid ? -1 : 1;
}

/**
 * Defensive content parser. NIP-01 says kind:0 `content` is a JSON
 * object but doesn't constrain its shape, so callers can never
 * trust the structure either. We return an empty object on any
 * shape that isn't a plain JSON object — never throw, never null,
 * never an array.
 *
 * @param {{ content?: string } | null | undefined} event
 * @returns {Record<string, unknown>}
 */
export function parseProfileContent(event) {
  if (!event || typeof event.content !== 'string') return {};
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * The BuhoGO correctness gate for a fetched profile event:
 *   - must be a kind:0 (a relay could mis-route)
 *   - author must be one we asked for (defends against forged events
 *     pointing at the wrong pubkey)
 *   - signature must verify (defends against relay tampering)
 *
 * @param {object|null} event
 * @param {Set<string>} allowedAuthors  lowercase hex pubkeys
 * @returns {boolean}
 */
function isTrustworthyProfile(event, allowedAuthors) {
  if (!event || event.kind !== PROFILE_KIND) return false;
  if (typeof event.pubkey !== 'string' || !allowedAuthors.has(event.pubkey)) return false;
  try {
    return verifyEvent(event) === true;
  } catch {
    return false;
  }
}

/**
 * Validate + normalize a list of pubkeys, dropping duplicates.
 *
 * @param {readonly string[]} pubkeys
 * @returns {string[]} lowercase hex, unique, order preserved
 * @throws TypeError on a non-array or any invalid entry (caller bug)
 */
function normalizePubkeys(pubkeys) {
  if (!Array.isArray(pubkeys)) {
    throw new TypeError('pubkeys must be an array of 64-char hex strings');
  }
  const seen = new Set();
  for (const pubkey of pubkeys) {
    if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new TypeError('pubkeys must be an array of 64-char hex strings');
    }
    seen.add(pubkey.toLowerCase());
  }
  return [...seen];
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * How many authors may ride in a single REQ. Relays cap filter sizes,
 * so a long zap list is split across a few queries rather than one
 * oversized filter that a relay might reject outright.
 */
export const MAX_AUTHORS_PER_QUERY = 40;

/**
 * Fetch the current kind:0 for MANY pubkeys using one REQ per chunk of
 * authors, instead of one REQ per person.
 *
 * A transaction list showing fifty zaps would otherwise open fifty
 * subscriptions against every relay in the pool for what a single filter
 * can answer. Same correctness rules as `fetchProfile` (signature
 * verified, author matched, NIP-01 tie-break per author), same
 * never-throws-on-network contract.
 *
 * No `limit` is sent: kind:0 is replaceable, so a compliant relay holds
 * exactly one per author, and the per-author tie-break below settles any
 * duplicates that arrive from different relays.
 *
 * @param {readonly string[]} pubkeys  64-char hex, duplicates tolerated
 * @param {{
 *   pool?:      import('nostr-core').RelayPool,
 *   relays?:    readonly string[],
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<Map<string, import('nostr-core').NostrEvent>>}
 *   keyed by lowercase hex pubkey; absent when that person has no
 *   verifiable profile (or nothing answered in time)
 *
 * @throws TypeError on an invalid pubkey list or an unusable pool
 *         (caller bug — distinguished from "couldn't fetch").
 */
export async function fetchProfiles(pubkeys, opts = {}) {
  const authors = normalizePubkeys(pubkeys);
  const pool = opts.pool ?? getRelayPool();
  const relays = Array.isArray(opts.relays) && opts.relays.length > 0
    ? opts.relays
    : DEFAULT_RELAYS;
  const maxWait = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_FETCH_TIMEOUT_MS;

  if (!pool || typeof pool.querySync !== 'function') {
    throw new TypeError('pool must implement querySync(urls, filter, params)');
  }

  const result = new Map();
  if (authors.length === 0) return result;

  const allowed = new Set(authors);
  const chunks = [];
  for (let i = 0; i < authors.length; i += MAX_AUTHORS_PER_QUERY) {
    chunks.push(authors.slice(i, i + MAX_AUTHORS_PER_QUERY));
  }

  // Chunks run concurrently: they are independent queries, and one slow
  // relay shouldn't serialize the rest behind it.
  const settled = await Promise.all(chunks.map(async (chunk) => {
    try {
      return await pool.querySync(
        [...relays],
        { kinds: [PROFILE_KIND], authors: chunk },
        { maxWait },
      );
    } catch (err) {
      // Same contract as fetchProfile: logged, never thrown. A failed
      // chunk simply contributes no profiles.
      console.warn('[nostr] fetchProfiles failed for', chunk.length, 'authors:', err);
      return [];
    }
  }));

  const byAuthor = new Map();
  for (const events of settled) {
    if (!Array.isArray(events)) continue;
    for (const event of events) {
      if (!isTrustworthyProfile(event, allowed)) continue;
      const list = byAuthor.get(event.pubkey);
      if (list) list.push(event);
      else byAuthor.set(event.pubkey, [event]);
    }
  }

  for (const [pubkey, events] of byAuthor) {
    events.sort(compareEventFreshness);
    result.set(pubkey, events[0]);
  }
  return result;
}

/**
 * Fetch the most recent kind:0 (profile metadata) event for a
 * given pubkey from one or more relays.
 *
 *   - Verifies the signature on every returned event; rejects any
 *     event whose author doesn't match the requested pubkey.
 *   - Resolves the NIP-01 replaceable-event tie-break to pick
 *     exactly one "current" event.
 *   - Never throws on a network or relay failure — returns `null`
 *     so the UI can treat "no profile" and "unreachable" the same
 *     way without try/catch noise.
 *
 * @param {string} pubkey  64-char lowercase hex
 * @param {{
 *   pool?:      import('nostr-core').RelayPool,
 *   relays?:    readonly string[],
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<import('nostr-core').NostrEvent | null>}
 *
 * @throws TypeError when pubkey isn't a valid 64-char hex string
 *         (caller bug — distinguished from "couldn't fetch").
 */
export async function fetchProfile(pubkey, opts = {}) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new TypeError('pubkey must be a 64-char lowercase hex string');
  }
  const pubkeyHex = pubkey.toLowerCase();
  const pool = opts.pool ?? getRelayPool();
  const relays = Array.isArray(opts.relays) && opts.relays.length > 0
    ? opts.relays
    : DEFAULT_RELAYS;
  const maxWait = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_FETCH_TIMEOUT_MS;

  if (!pool || typeof pool.querySync !== 'function') {
    throw new TypeError('pool must implement querySync(urls, filter, params)');
  }

  let events;
  try {
    events = await pool.querySync(
      [...relays],
      { kinds: [PROFILE_KIND], authors: [pubkeyHex], limit: 1 },
      { maxWait },
    );
  } catch (err) {
    // Pool-level failures are logged for diagnostics but never
    // surface to the caller — empty result is the only signal.
    console.warn('[nostr] fetchProfile failed for', pubkeyHex, ':', err);
    return null;
  }

  if (!Array.isArray(events) || events.length === 0) return null;

  // Same correctness gate the batched path uses: kind:0, author we
  // asked for, signature verifies.
  const allowed = new Set([pubkeyHex]);
  const valid = events.filter((event) => isTrustworthyProfile(event, allowed));

  if (valid.length === 0) return null;

  // NIP-01 tie-break: newest created_at; lexically lowest id on tie.
  valid.sort(compareEventFreshness);
  return valid[0];
}
