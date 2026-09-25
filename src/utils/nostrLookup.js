/**
 * Universal Nostr identifier resolver.
 *
 * The address-book search flow accepts four input shapes from one
 * input field:
 *
 *   1. `npub1…`                  (NIP-19 npub)
 *   2. `nprofile1…`              (NIP-19 nprofile — npub + relay hints)
 *   3. 64-char lowercase hex     (raw pubkey)
 *   4. `name@domain`             (NIP-05)
 *
 * Plus the `nostr:` URI prefix from NIP-21 wrapping any of (1) or (2).
 *
 * Every code path collapses to one normalised shape:
 *
 *   { pubkey, npub, relays, source, nip05? }
 *
 * Typed errors with `.code` mirror the pattern in `nip05.js` so the
 * UI can map failure modes to specific copy without parsing
 * error.message strings.
 */

import { nip19 } from 'nostr-core';
import {
  resolveNip05,
  parseNip05,
  NIP05_ERROR,
} from './nip05.js';

// ----------------------------------------------------------------------------
// Error codes
// ----------------------------------------------------------------------------

export const LOOKUP_ERROR = Object.freeze({
  EMPTY: 'LOOKUP_EMPTY',
  UNRECOGNIZED: 'LOOKUP_UNRECOGNIZED',
  INVALID_NPUB: 'LOOKUP_INVALID_NPUB',
  INVALID_NPROFILE: 'LOOKUP_INVALID_NPROFILE',
  INVALID_HEX: 'LOOKUP_INVALID_HEX',
  CANCELLED: 'LOOKUP_CANCELLED',
  // NIP-05 errors surface as themselves so callers can render them
  // through the existing NIP05_ERROR -> copy mapping; we re-export
  // the catalogue for convenience.
});

function makeError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

// ----------------------------------------------------------------------------
// Classification — pure, synchronous, no network
// ----------------------------------------------------------------------------

const HEX_RE = /^[0-9a-f]{64}$/i;
const NIP21_PREFIX_RE = /^nostr:/i;

/**
 * Classify a string into one of the recognised identifier kinds
 * without performing any network resolution. Used by the search UI
 * to decide whether to debounce (NIP-05 needs a fetch) or resolve
 * instantly (npub / hex). `null` means "I don't know what this is".
 */
export function classifyIdentifier(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(NIP21_PREFIX_RE, '');

  if (HEX_RE.test(stripped)) return 'hex';
  if (/^npub1[0-9a-z]+$/i.test(stripped)) return 'npub';
  if (/^nprofile1[0-9a-z]+$/i.test(stripped)) return 'nprofile';

  // Anything with an `@` AND a dot in the second half looks like a
  // NIP-05. The strict shape check still lives in `parseNip05`; this
  // classifier is intentionally generous so a half-typed handle
  // doesn't fall through to UNRECOGNIZED.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripped)) return 'nip05';

  return null;
}

// ----------------------------------------------------------------------------
// Decoders for each kind
// ----------------------------------------------------------------------------

function decodeNpub(input) {
  const stripped = input.trim().replace(NIP21_PREFIX_RE, '');
  let decoded;
  try {
    decoded = nip19.decode(stripped);
  } catch (err) {
    throw makeError(LOOKUP_ERROR.INVALID_NPUB, 'invalid npub', err);
  }
  if (decoded?.type !== 'npub' || typeof decoded.data !== 'string') {
    throw makeError(LOOKUP_ERROR.INVALID_NPUB, 'invalid npub payload');
  }
  const hex = decoded.data.toLowerCase();
  if (!HEX_RE.test(hex)) {
    throw makeError(LOOKUP_ERROR.INVALID_NPUB, 'npub did not decode to a pubkey');
  }
  return {
    pubkey: hex,
    npub: nip19.npubEncode(hex),
    relays: [],
    source: 'npub',
  };
}

function decodeNprofile(input) {
  const stripped = input.trim().replace(NIP21_PREFIX_RE, '');
  let decoded;
  try {
    decoded = nip19.decode(stripped);
  } catch (err) {
    throw makeError(LOOKUP_ERROR.INVALID_NPROFILE, 'invalid nprofile', err);
  }
  if (decoded?.type !== 'nprofile' || !decoded.data || typeof decoded.data.pubkey !== 'string') {
    throw makeError(LOOKUP_ERROR.INVALID_NPROFILE, 'invalid nprofile payload');
  }
  const hex = decoded.data.pubkey.toLowerCase();
  if (!HEX_RE.test(hex)) {
    throw makeError(LOOKUP_ERROR.INVALID_NPROFILE, 'nprofile did not decode to a pubkey');
  }
  const relays = Array.isArray(decoded.data.relays)
    ? decoded.data.relays.filter((r) => typeof r === 'string' && /^wss?:\/\//i.test(r))
    : [];
  return {
    pubkey: hex,
    npub: nip19.npubEncode(hex),
    relays,
    source: 'nprofile',
  };
}

function decodeHex(input) {
  const stripped = input.trim().replace(NIP21_PREFIX_RE, '');
  if (!HEX_RE.test(stripped)) {
    throw makeError(LOOKUP_ERROR.INVALID_HEX, 'not a 64-char hex pubkey');
  }
  const hex = stripped.toLowerCase();
  return {
    pubkey: hex,
    npub: nip19.npubEncode(hex),
    relays: [],
    source: 'hex',
  };
}

async function decodeNip05(input, opts) {
  // parseNip05 throws synchronously on bad shape; resolveNip05 throws
  // on a network/HTTP/lookup failure with its own typed codes. We
  // bubble both up unchanged so the UI's NIP05_ERROR mapping continues
  // to work.
  parseNip05(input.trim()); // validate shape early; resolveNip05 will re-parse.
  const result = await resolveNip05(input.trim().replace(NIP21_PREFIX_RE, ''), opts);
  return {
    pubkey: result.pubkey,
    npub: result.npub,
    relays: result.relays,
    source: 'nip05',
    nip05: input.trim().replace(NIP21_PREFIX_RE, '').toLowerCase(),
  };
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

/**
 * @typedef {{
 *   pubkey: string,
 *   npub:   string,
 *   relays: string[],
 *   source: 'npub' | 'nprofile' | 'hex' | 'nip05',
 *   nip05?: string,
 * }} LookupResult
 */

/**
 * Resolve any supported identifier to a canonical pubkey + relay
 * hints. Only `nip05` performs a network round-trip; everything else
 * is synchronous decode work.
 *
 * @param {string} input
 * @param {{
 *   fetch?:     typeof fetch,
 *   signal?:    AbortSignal,
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<LookupResult>}
 *
 * @throws Error('LOOKUP_EMPTY')           — empty / non-string input
 * @throws Error('LOOKUP_UNRECOGNIZED')    — none of the known shapes matched
 * @throws Error('LOOKUP_INVALID_NPUB')    — npub bech32 broken
 * @throws Error('LOOKUP_INVALID_NPROFILE') — nprofile bech32 broken
 * @throws Error('LOOKUP_INVALID_HEX')     — 64 chars but not hex
 * @throws Error('NIP05_*')                — NIP-05 path: format/network/HTTP/etc.
 */
export async function lookupIdentifier(input, opts = {}) {
  if (typeof input !== 'string') {
    throw makeError(LOOKUP_ERROR.EMPTY, 'identifier must be a string');
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw makeError(LOOKUP_ERROR.EMPTY, 'identifier is empty');
  }

  if (opts.signal?.aborted) {
    throw makeError(LOOKUP_ERROR.CANCELLED, 'lookup cancelled before start');
  }

  const kind = classifyIdentifier(trimmed);
  switch (kind) {
    case 'npub':     return decodeNpub(trimmed);
    case 'nprofile': return decodeNprofile(trimmed);
    case 'hex':      return decodeHex(trimmed);
    case 'nip05':    return decodeNip05(trimmed, opts);
    default:
      throw makeError(
        LOOKUP_ERROR.UNRECOGNIZED,
        'unrecognized Nostr identifier — expected npub, nprofile, hex pubkey, or name@domain',
      );
  }
}

// Re-exported so callers don't need two imports for the typed-error
// catalogues their copy table keys on.
export { NIP05_ERROR };
