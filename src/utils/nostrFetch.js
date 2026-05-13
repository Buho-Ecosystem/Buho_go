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

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

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

  // Reject anything that doesn't pass the BuhoGO correctness gate:
  //   - must be a kind:0 (relay could mis-route)
  //   - author must match the request (defends against forged events
  //     pointing at the wrong pubkey)
  //   - signature must verify (defends against relay tampering)
  const valid = events.filter((event) => {
    if (!event || event.kind !== PROFILE_KIND) return false;
    if (event.pubkey !== pubkeyHex) return false;
    try {
      return verifyEvent(event) === true;
    } catch {
      return false;
    }
  });

  if (valid.length === 0) return null;

  // NIP-01 tie-break: newest created_at; lexically lowest id on tie.
  valid.sort(compareEventFreshness);
  return valid[0];
}
