/**
 * NIP-05 identifier resolver for BuhoGO.
 *
 * NIP-05 maps a human-readable `name@domain` identifier onto a Nostr
 * pubkey by fetching `https://<domain>/.well-known/nostr.json?name=<local>`
 * and reading the resulting `{ names: { <local>: <hex pubkey> } }` map.
 * Optionally, the same JSON document carries a `relays` map suggesting
 * where the addressed user posts — we keep those as hints but never
 * treat them as authoritative.
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/05.md
 *
 * nostr-core exposes a `queryNip05` helper too, but it has four
 * correctness gaps for our use-case:
 *
 *   1. No `_@domain` special-case. The spec says when the local part
 *      is `_`, the identifier renders as just `<domain>` — common for
 *      "the root pubkey of this domain" identifiers.
 *   2. The local-part match is case-sensitive in the library; the
 *      spec mandates case-insensitive lookup.
 *   3. No fetch injection — can't unit-test without monkey-patching
 *      `globalThis.fetch`.
 *   4. No AbortSignal threading — can't cancel an in-flight query
 *      when the user keeps typing in a search field.
 *
 * This module wraps the spec directly, fixes those four, and surfaces
 * typed `.code`s on every error so the UI can map failure modes to
 * specific copy (same pattern as `blossomProfileMedia.js`).
 *
 * Stable: the network format is locked by the spec; this surface is
 * the BuhoGO contract every higher-level address-book module depends
 * on. Don't change return shapes without bumping a major version of
 * the consuming store.
 */

import { nip19 } from 'nostr-core';

// ----------------------------------------------------------------------------
// Error codes
//
// Exported as a frozen object so callers can write
// `err.code === NIP05_ERROR.NETWORK` instead of memorising the
// magic-string list. The `.code` property itself stays a plain
// string — matches the convention `blossomProfileMedia.js` uses.
// ----------------------------------------------------------------------------

export const NIP05_ERROR = Object.freeze({
  INVALID_FORMAT: 'NIP05_INVALID_FORMAT',
  NETWORK: 'NIP05_NETWORK_ERROR',
  HTTP: 'NIP05_HTTP_ERROR',
  BAD_RESPONSE: 'NIP05_BAD_RESPONSE',
  NOT_FOUND: 'NIP05_NOT_FOUND',
  PUBKEY_INVALID: 'NIP05_PUBKEY_INVALID',
  CANCELLED: 'NIP05_CANCELLED',
});

/**
 * Internal helper that bundles a typed error code onto an `Error` so
 * callers always get the same shape regardless of where the failure
 * originated. The plain `Error` constructor + `code` property
 * matches the pattern used elsewhere in the codebase.
 *
 * @param {string} code     one of `NIP05_ERROR.*`
 * @param {string} message  human-readable detail (logged; not user-facing)
 * @param {Error}  [cause]  the original error, attached for stack-trace traceability
 * @returns {Error}
 */
function makeError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------

/**
 * Split a NIP-05 identifier into its `{ local, domain }` parts with
 * spec-correct normalisation:
 *
 *   - Surrounding whitespace stripped.
 *   - Bare `<domain>` (no `@`) is accepted and treated as `_@<domain>`.
 *   - Local part is lowercased (NIP-05: "lookups MUST be
 *     case-insensitive on the local part").
 *   - Domain part is lowercased too (DNS is case-insensitive).
 *
 * @param {string} address  e.g. `satoshi@example.com`, `_@example.com`, `example.com`
 * @returns {{ local: string, domain: string }}
 * @throws  Error with `code: NIP05_INVALID_FORMAT` when the input
 *          can't be parsed into a local + domain pair.
 */
export function parseNip05(address) {
  if (typeof address !== 'string') {
    throw makeError(NIP05_ERROR.INVALID_FORMAT, 'address must be a string');
  }
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) {
    throw makeError(NIP05_ERROR.INVALID_FORMAT, 'address is empty');
  }

  // Bare domain → spec treats it as `_@<domain>`. Pre-rewrite here so
  // the rest of the parser only ever sees the `local@domain` form.
  const candidate = trimmed.includes('@') ? trimmed : `_@${trimmed}`;

  const at = candidate.indexOf('@');
  if (at <= 0 || at !== candidate.lastIndexOf('@')) {
    throw makeError(
      NIP05_ERROR.INVALID_FORMAT,
      `expected exactly one '@' in NIP-05 address: ${address}`,
    );
  }

  const local = candidate.slice(0, at);
  const domain = candidate.slice(at + 1);

  // Permissive local-part charset — the spec lists `a-z0-9-_.` and
  // we accept those plus nothing else. Catches obvious typos like
  // `name with spaces@domain.com` without rejecting valid handles.
  if (!/^[a-z0-9._-]+$/.test(local)) {
    throw makeError(
      NIP05_ERROR.INVALID_FORMAT,
      `invalid local part: ${local}`,
    );
  }
  // Domain shape: at least one dot, no whitespace, no `@`. Full DNS
  // validation belongs to the resolver itself — we just reject the
  // obvious junk before paying for a network round-trip.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw makeError(
      NIP05_ERROR.INVALID_FORMAT,
      `invalid domain: ${domain}`,
    );
  }

  return { local, domain };
}

// ----------------------------------------------------------------------------
// Resolver
// ----------------------------------------------------------------------------

/**
 * @typedef {{
 *   pubkey: string,
 *   npub:   string,
 *   relays: string[],
 * }} Nip05Resolution
 */

/**
 * Hard ceiling on how long we'll wait for the `/.well-known/nostr.json`
 * fetch. Short enough that a flaky DNS or hung TLS handshake doesn't
 * leave a search field spinning forever, long enough to absorb the
 * normal 200–800ms round-trip + TLS warm-up.
 */
export const DEFAULT_RESOLVE_TIMEOUT_MS = 5000;

/**
 * Resolve a NIP-05 identifier to the addressed pubkey + relay hints.
 *
 * @param {string} address
 * @param {{
 *   fetch?:     typeof fetch,       // injected for tests
 *   signal?:    AbortSignal,        // for cancellable typeahead
 *   timeoutMs?: number,
 * }} [opts]
 * @returns {Promise<Nip05Resolution>}
 *
 * Failure modes (all throw `Error` with a typed `.code`):
 *   - `NIP05_INVALID_FORMAT`  — input couldn't be parsed
 *   - `NIP05_CANCELLED`       — the AbortSignal fired
 *   - `NIP05_NETWORK_ERROR`   — fetch rejected (DNS, TLS, offline)
 *   - `NIP05_HTTP_ERROR`      — server responded with non-2xx
 *   - `NIP05_BAD_RESPONSE`    — JSON missing or malformed
 *   - `NIP05_NOT_FOUND`       — local part not in `names` map
 *   - `NIP05_PUBKEY_INVALID`  — server returned a non-hex pubkey
 */
export async function resolveNip05(address, opts = {}) {
  const { local, domain } = parseNip05(address);
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_RESOLVE_TIMEOUT_MS;

  if (typeof fetchFn !== 'function') {
    throw makeError(
      NIP05_ERROR.NETWORK,
      'no fetch implementation available on this platform',
    );
  }

  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;

  // Wire up an internal timeout + the caller's AbortSignal under one
  // controller so a typeahead can `controller.abort()` from outside
  // without losing the timeout guarantee.
  const controller = new AbortController();
  const externalAbort = opts.signal;
  const onExternalAbort = () => controller.abort(externalAbort?.reason);
  if (externalAbort) {
    if (externalAbort.aborted) controller.abort(externalAbort.reason);
    else externalAbort.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  let response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      // Distinguish caller cancellation from internal timeout. The
      // external signal's `aborted` flag survives our own abort, so
      // checking it first is reliable.
      if (externalAbort?.aborted) {
        throw makeError(NIP05_ERROR.CANCELLED, 'lookup cancelled', err);
      }
      throw makeError(NIP05_ERROR.NETWORK, `lookup timed out after ${timeoutMs}ms`, err);
    }
    throw makeError(
      NIP05_ERROR.NETWORK,
      `could not reach ${domain}: ${err?.message || err}`,
      err,
    );
  } finally {
    clearTimeout(timer);
    if (externalAbort) externalAbort.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    throw makeError(
      NIP05_ERROR.HTTP,
      `${domain} responded with HTTP ${response.status}`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw makeError(
      NIP05_ERROR.BAD_RESPONSE,
      `${domain} returned non-JSON response`,
      err,
    );
  }

  const names = body && typeof body === 'object' ? body.names : null;
  if (!names || typeof names !== 'object') {
    throw makeError(
      NIP05_ERROR.BAD_RESPONSE,
      `${domain} response is missing a "names" object`,
    );
  }

  // Case-insensitive lookup per spec. Most servers store the local
  // part exactly as registered, but the matcher is required to be
  // case-insensitive both ways.
  const matched = Object.keys(names).find((key) => key.toLowerCase() === local);
  const pubkey = matched ? names[matched] : undefined;
  if (typeof pubkey !== 'string' || pubkey.length === 0) {
    throw makeError(
      NIP05_ERROR.NOT_FOUND,
      `"${local}" is not registered at ${domain}`,
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw makeError(
      NIP05_ERROR.PUBKEY_INVALID,
      `${domain} returned an invalid pubkey for "${local}"`,
    );
  }
  const pubkeyHex = pubkey.toLowerCase();

  // Optional relay hints. Spec: `relays` is an OBJECT keyed by hex
  // pubkey whose value is a list of recommended relay URLs. Treat
  // anything malformed as "no hints" rather than failing the whole
  // resolution — the kind:0 fetch can still succeed against our
  // default relay set.
  const relayMap = body.relays && typeof body.relays === 'object' ? body.relays : null;
  const rawRelays = relayMap?.[pubkeyHex];
  const relays = Array.isArray(rawRelays)
    ? rawRelays.filter((r) => typeof r === 'string' && /^wss?:\/\//i.test(r))
    : [];

  return {
    pubkey: pubkeyHex,
    npub: nip19.npubEncode(pubkeyHex),
    relays,
  };
}
