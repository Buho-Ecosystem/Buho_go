/**
 * Blossom avatar upload helper for the BuhoGO profile.
 *
 * Blossom (https://github.com/hzrd149/blossom) is a content-addressed
 * blob store keyed by SHA-256. For our purposes it does one thing:
 * hand it an image, get back a URL we can put in the `picture` field
 * of a kind:0 profile event. The blob is addressed by its hash, so
 * the URL stays valid as long as any Blossom server keeps the file.
 *
 * Wire-level contract (BUD-02 upload):
 *   PUT {server}/upload
 *   Authorization: Nostr <base64(JSON(signedAuthEvent))>
 *   Content-Type:  <file.type>
 *   Body:          raw file bytes
 *
 * The auth event is a regular Nostr event (kind 24242) carrying:
 *   - `t` tag with the action ("upload")
 *   - `expiration` tag (5 min in the future — Blossom servers reject
 *     stale auth to make replay useless)
 *   - `x` tag with the SHA-256 hex of the file we're about to upload —
 *     binds the auth to *this* blob and no other
 *   - `server` tag with the target server URL — binds the auth to a
 *     specific operator, so a token leaked from one host can't be
 *     replayed against another
 *
 * Reference implementation borrowed from the Standup project
 * (`projects/standup/src/services/blossom.service.js`). Trimmed down
 * to a single-server avatar flow because BuhoGO has a different
 * product shape (no media library, one Blossom default, no mirror
 * fan-out). Multi-server support can land later under Plan 09's
 * Phase 3 path without changing this signature.
 *
 * Secret-key handling: this module signs once and never retains the
 * key bytes. The caller owns the lifecycle of the `secretKey`
 * argument and SHOULD `secretKey.fill(0)` once `uploadAvatar`
 * resolves.
 */

import { finalizeEvent } from 'nostr-core';
import { DEFAULT_BLOSSOM_SERVER } from './nostrRelays.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Blossom BUD-01/BUD-02 authorization event kind. */
export const BLOSSOM_AUTH_KIND = 24242;

/**
 * Hard cap on the bytes we'll attempt to upload. 5 MB is generous for
 * an avatar (a 1024×1024 jpeg at sensible quality lands well under
 * 1 MB) and well below the limits public Blossom servers tend to
 * advertise. Refusing oversize files up front saves the user from
 * watching a doomed upload run for 30 seconds before the server
 * rejects it.
 */
export const DEFAULT_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * MIME types we'll send. Anything else is refused at the boundary so
 * a malformed picker can't surprise us with a video, SVG, or HEIC
 * that Blossom servers don't all handle yet.
 */
export const ALLOWED_AVATAR_MIMES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * How long the signed auth token stays valid. Five minutes is the de
 * facto convention across the Blossom client ecosystem — short
 * enough to make replay useless, long enough to absorb slow networks
 * and clock skew between client and server.
 */
export const AUTH_EXPIRATION_SECONDS = 300;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * SHA-256 a byte array and return lowercase hex. Uses Web Crypto so
 * the same code path runs in browsers, Capacitor WebViews, and Node
 * 20+ (no Node-only `crypto` import).
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}  64 lowercase hex chars
 */
async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Build, sign, and base64-encode a Blossom auth event for the given
 * action. Returns the full header value (`Nostr <b64>`) ready to drop
 * into an `Authorization` header.
 *
 * @param {{
 *   action: string,           // 'upload' | 'delete' | 'list'
 *   hash:   string | null,    // sha256 hex of the target blob, when applicable
 *   server: string,           // target server URL (origin)
 *   expiration: number,       // unix seconds
 *   createdAt?: number,       // override for tests
 * }} args
 * @param {Uint8Array} secretKey
 * @returns {string}  full Authorization header value
 */
function buildAuthHeader(args, secretKey) {
  const tags = [
    ['t', args.action],
    ['expiration', String(args.expiration)],
  ];
  if (args.hash) tags.push(['x', args.hash]);
  if (args.server) tags.push(['server', args.server]);

  const template = {
    kind: BLOSSOM_AUTH_KIND,
    tags,
    content: `Authorize ${args.action}`,
    created_at: Number.isFinite(args.createdAt)
      ? args.createdAt
      : Math.floor(Date.now() / 1000),
  };
  const signed = finalizeEvent(template, secretKey);
  // base64-encode the JSON. `btoa` is universal in browsers; the
  // `Buffer` fallback keeps Node-only tests working.
  const json = JSON.stringify(signed);
  const b64 = typeof globalThis.btoa === 'function'
    ? globalThis.btoa(json)
    : Buffer.from(json, 'utf8').toString('base64');
  return `Nostr ${b64}`;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Upload an avatar image to a Blossom server and return everything
 * the profile editor needs to commit it to the kind:0 event.
 *
 * Validation order is deliberate — every cheap check runs before we
 * read the file or touch the network:
 *   1. file shape (has .size / .type / .arrayBuffer)
 *   2. size cap
 *   3. MIME allowlist
 *   4. read bytes + hash
 *   5. sign auth event
 *   6. PUT to server
 *   7. verify server-reported hash matches what we sent
 *
 * @param {{ size: number, type: string, arrayBuffer: () => Promise<ArrayBuffer> }} file
 * @param {Uint8Array} secretKey  32-byte schnorr secret key
 * @param {{
 *   server?:   string,
 *   maxBytes?: number,
 *   fetch?:    typeof fetch,     // injected for tests
 *   now?:      () => number,     // injected for tests (returns ms)
 * }} [opts]
 * @returns {Promise<{
 *   url:    string,
 *   hash:   string,
 *   mime:   string,
 *   size:   number,
 *   server: string,
 * }>}
 */
export async function uploadAvatar(file, secretKey, opts = {}) {
  // ---- 1. file shape ----
  if (!file || typeof file.arrayBuffer !== 'function'
      || typeof file.size !== 'number' || typeof file.type !== 'string') {
    throw new TypeError('file must be a Blob/File-like object');
  }
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }

  const server = (opts.server ?? DEFAULT_BLOSSOM_SERVER).replace(/\/+$/, '');
  const maxBytes = Number.isFinite(opts.maxBytes)
    ? opts.maxBytes
    : DEFAULT_AVATAR_MAX_BYTES;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();

  if (typeof fetchFn !== 'function') {
    throw new Error('No fetch implementation available');
  }

  // ---- 2. size cap ----
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    const err = new Error(`Image too large (max ${mb} MB)`);
    err.code = 'AVATAR_TOO_LARGE';
    throw err;
  }

  // ---- 3. MIME allowlist ----
  if (!ALLOWED_AVATAR_MIMES.includes(file.type)) {
    const err = new Error(`Unsupported image type: ${file.type || 'unknown'}`);
    err.code = 'AVATAR_UNSUPPORTED_MIME';
    throw err;
  }

  // ---- 4. read bytes + hash ----
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);

  // ---- 5. sign auth event ----
  const expiration = Math.floor(nowMs() / 1000) + AUTH_EXPIRATION_SECONDS;
  const authorization = buildAuthHeader(
    { action: 'upload', hash, server, expiration },
    secretKey,
  );

  // ---- 6. PUT to server ----
  let response;
  try {
    response = await fetchFn(`${server}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': file.type,
      },
      body: bytes,
    });
  } catch (err) {
    const wrapped = new Error(`Network error: ${err.message || err}`);
    wrapped.code = 'AVATAR_NETWORK_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(
      `Upload failed (${response.status}): ${body || response.statusText}`,
    );
    err.code = 'AVATAR_UPLOAD_FAILED';
    err.status = response.status;
    throw err;
  }

  let result;
  try {
    result = await response.json();
  } catch (err) {
    const wrapped = new Error('Server returned non-JSON response');
    wrapped.code = 'AVATAR_BAD_RESPONSE';
    wrapped.cause = err;
    throw wrapped;
  }

  if (!result || typeof result.url !== 'string') {
    const err = new Error('Server response is missing a URL');
    err.code = 'AVATAR_BAD_RESPONSE';
    throw err;
  }

  // ---- 7. hash check ----
  // Blossom servers echo the content hash they computed; if it
  // disagrees with what we sent, treat the upload as failed rather
  // than trust the URL. Cheap insurance against a mid-flight bit
  // flip or a misbehaving server.
  if (typeof result.sha256 === 'string' && result.sha256 !== hash) {
    const err = new Error('Server returned a different file hash');
    err.code = 'AVATAR_HASH_MISMATCH';
    err.expected = hash;
    err.actual = result.sha256;
    throw err;
  }

  return {
    url: result.url,
    hash,
    mime: typeof result.type === 'string' ? result.type : file.type,
    size: typeof result.size === 'number' ? result.size : file.size,
    server,
  };
}

// ----------------------------------------------------------------------------
// Internal: re-exported for tests so the spec can assert on auth-header
// shape without going through a network round-trip.
// ----------------------------------------------------------------------------

export const __testing = Object.freeze({
  sha256Hex,
  buildAuthHeader,
});
