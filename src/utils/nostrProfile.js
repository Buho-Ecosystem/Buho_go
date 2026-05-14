/**
 * Pure event builders for the BuhoGO Nostr profile.
 *
 * Two events fully describe a Nostr identity on the wire:
 *
 *   kind:0  — profile metadata (display name, picture, lud16, …)
 *   kind:10002 — relay list (NIP-65)
 *
 * Both are *replaceable* events: every publish overwrites the previous
 * one for the same pubkey + kind. We never mutate events in place,
 * which is why these helpers are pure: take inputs, return a signed
 * event, do not touch any store.
 *
 * Design notes:
 *
 *   - The kind:0 template is built by hand because NIP-01 leaves the
 *     content shape mostly to clients and we want a tight whitelist
 *     of fields plus an empty-string strip. `nostr-core`'s NIP-24
 *     helpers cover "extended" metadata (gender, pronouns, …) which
 *     we deliberately do not publish from the wallet.
 *
 *   - The kind:10002 template is delegated to `nostr-core`'s
 *     `nip65.createRelayListEventTemplate` so URL normalisation
 *     (trailing slash, lowercase host, etc.) stays consistent with
 *     anything the rest of nostr-core parses. We mark every relay
 *     read+write because the product uses one unified set; we never
 *     emit a one-way marker.
 *
 *   - `created_at` is overridable. Production code lets it default to
 *     "now"; tests pin it so signed-event determinism is checkable.
 *
 *   - No state. Secret-key bytes are accepted, used, and dropped.
 *     The caller is responsible for sourcing and discarding them.
 */

import { finalizeEvent, nip65 } from 'nostr-core';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** NIP-01 profile metadata. */
export const PROFILE_KIND = 0;

/** NIP-65 relay list metadata. */
export const RELAY_LIST_KIND = 10002;

/**
 * Whitelist of fields we publish in the kind:0 `content` JSON.
 *
 * Order matters for `JSON.stringify` output reproducibility, but
 * downstream clients do not care about field order — we keep it
 * stable purely so log lines and snapshot tests stay readable.
 *
 * `lud16` is the Lightning Address (LUD-16). `nip05` is the
 * verified identifier; both are optional and only emitted when set.
 */
export const PROFILE_CONTENT_FIELDS = Object.freeze([
  'name',
  'display_name',
  'about',
  'website',
  'picture',
  'banner',
  'lud16',
  'nip05',
]);

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Drop fields that are missing, non-string, or empty after trim. The
 * resulting object is what gets `JSON.stringify`d into the event
 * content. Returning a plain object (not a `Map`) so callers can
 * inspect it in tests without juggling iterators.
 *
 * @param {Record<string, unknown> | null | undefined} profile
 * @returns {Record<string, string>}
 */
export function normaliseProfileContent(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const out = {};
  for (const field of PROFILE_CONTENT_FIELDS) {
    const raw = profile[field];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out[field] = trimmed;
  }
  return out;
}

function assertSecretKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Build a signed kind:0 profile metadata event.
 *
 * @param {Record<string, unknown>} profile  - Object with any subset of
 *   `PROFILE_CONTENT_FIELDS`. Empty / whitespace-only fields are dropped.
 * @param {Uint8Array} secretKey - 32-byte schnorr secret key (NIP-06).
 * @param {{ createdAt?: number }} [opts]    - Override the event timestamp.
 * @returns {import('nostr-core').VerifiedEvent}
 */
export function buildKind0Event(profile, secretKey, opts = {}) {
  assertSecretKey(secretKey);
  const content = JSON.stringify(normaliseProfileContent(profile));
  const template = {
    kind: PROFILE_KIND,
    tags: [],
    content,
    created_at: Number.isFinite(opts.createdAt) ? opts.createdAt : nowSeconds(),
  };
  return finalizeEvent(template, secretKey);
}

/**
 * Build a signed kind:10002 relay list event (NIP-65).
 *
 * Every URL in `relayUrls` is published as a bidirectional `r` tag.
 * The product uses one unified relay set so we never emit a one-way
 * marker, and downstream parsers will see `read: true, write: true`
 * for every entry.
 *
 * @param {readonly string[]} relayUrls
 * @param {Uint8Array} secretKey
 * @param {{ createdAt?: number }} [opts]
 * @returns {import('nostr-core').VerifiedEvent}
 */
export function buildKind10002Event(relayUrls, secretKey, opts = {}) {
  assertSecretKey(secretKey);
  if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
    throw new TypeError('relayUrls must be a non-empty array');
  }
  const entries = relayUrls.map((url) => ({ url, read: true, write: true }));
  const template = nip65.createRelayListEventTemplate(entries);
  if (Number.isFinite(opts.createdAt)) {
    template.created_at = opts.createdAt;
  }
  return finalizeEvent(template, secretKey);
}
