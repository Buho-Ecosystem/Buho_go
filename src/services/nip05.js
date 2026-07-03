/**
 * NIP-05 service — register a BuhoGO identity's Nostr pubkey under a
 * `name@mybuho.de` handle, via the LNbits `nostrnip5` extension.
 *
 * We use the extension's *public* (keyless) signup endpoint with the
 * free-tier naming convention: a local-part ending in `.` + exactly six
 * digits (`is_free_identifier`) is created active and free, with no payment
 * and no API key. The six digits double as automatic collision resolution.
 *
 * This module is intentionally pure — no store/Pinia imports — so it can be
 * unit-tested and called from the boot orchestrator. The cross-store wiring
 * (persisting the handle, seeding the profile field) lives in `boot/nip05.js`.
 *
 * Endpoint + response shape verified against the live extension:
 *   POST {BASE}/nostrnip5/api/v1/public/domain/{DOMAIN_ID}/address
 *   body  { domain_id, local_part, pubkey, create_invoice:false }
 *   201   { local_part, pubkey, active:true, is_free:true, rotation_secret, … }
 */

import { deriveMemorableSlug } from './nip05Names.js';

// ── Config (mybuho.de domain on the timecatcher LNbits instance) ────────────
export const NIP05_DOMAIN = 'mybuho.de';
const LNBITS_BASE = 'https://timecatcher.lnbits.de';
const DOMAIN_ID = 'ANpwyDeLkZFG5kS8Y9v8bA';

// Free-tier handles must be `<base>.<6 digits>`; keep the base short and safe.
const BASE_MAX = 20;
const REGISTER_ATTEMPTS = 4; // retries with a fresh suffix on collision/error
const REQUEST_TIMEOUT_MS = 12000;

/** Polling cadence for the post-payment "is this address active yet?" check. */
const ACTIVATION_POLL_INTERVAL_MS = 2000;
/** Hard cap on activation polling — the invoice is short-lived anyway. */
const ACTIVATION_POLL_MAX_MS = 90000;
/** A year in milliseconds — used to compute a fallback expiry when the
 *  server response doesn't include `expires_at` (which happens on the
 *  paid path because activation runs server-side after the invoice
 *  settles and our initial POST response predates it). */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** Allowed shape of a user-chosen local-part (premium OR free fallback). */
const PREMIUM_LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** Full `name@mybuho.de` address for a stored local-part. */
export function nip05AddressFor(localPart) {
  return localPart ? `${localPart}@${NIP05_DOMAIN}` : null;
}

/**
 * Normalise the extension's `expires_at` field into epoch ms.
 *
 * The server returns ISO-8601 on the free path (activation runs
 * synchronously) and `null` on the paid path (activation runs after
 * the invoice settles, our POST response predates it). In the null
 * case we fall back to "now + N years" — the server will set its own
 * expiry within a few seconds of activation; this client-side value is
 * good to that resolution.
 *
 * @param {string|number|null|undefined} raw — value from `expires_at`
 * @param {number} years — years requested (defaults to 1)
 * @returns {number} epoch ms
 */
export function normaliseExpiresAt(raw, years = 1) {
  if (typeof raw === 'string' && raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Some servers return seconds; if the value is suspiciously small
    // for an ms timestamp (year < 2200), assume it's seconds and lift.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  return Date.now() + Math.max(1, years) * ONE_YEAR_MS;
}

/**
 * Slugify a human profile name into a NIP-05-safe local-part base.
 *
 * Output is `[a-z0-9]`, ≤ 20 chars — the lowest-common-denominator that any
 * NIP-05 server accepts. Returns `''` when there's no usable name (fewer than
 * two slug characters), so callers can choose their own fallback: the
 * marketplace leaves the premium input blank, while `deriveBaseSlug` swaps in
 * a memorable word pair.
 *
 * @param {{ name?: string }} input
 * @returns {string} the slug, or '' when there's no usable name
 */
export function deriveNameSlug({ name } = {}) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, BASE_MAX);
  return slug.length >= 2 ? slug : '';
}

/**
 * Derive the base (suffix-less) local-part for a new *free* handle. Prefers a
 * slug of the user's profile name; falls back to a deterministic, memorable
 * `{adjective}{animal}` slug derived from the npub (e.g. `bravefox`) so every
 * identity gets a recognizable handle even before a profile name is set.
 *
 * Always returns a non-empty, registerable base. The `.NNNNNN` free suffix is
 * appended at register time, not here.
 *
 * @param {{ name?: string, npub?: string }} input
 * @returns {string}
 */
export function deriveBaseSlug({ name, npub } = {}) {
  return deriveNameSlug({ name }) || deriveMemorableSlug(npub);
}

/** Random 6-digit string (zero-padded) — the free-identifier marker. */
function freeSuffix() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

async function postAddress(localPart, pubkeyHex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${LNBITS_BASE}/nostrnip5/api/v1/public/domain/${DOMAIN_ID}/address`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: DOMAIN_ID,
          local_part: localPart,
          pubkey: pubkeyHex,
          create_invoice: false,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const err = new Error(`nip05 register failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Client-side shape check for a user-chosen name. The server is the
 * authority on availability + pricing; this just catches obvious mistakes
 * before the user pays a network round-trip for a "400 invalid format"
 * response. The constraints mirror what the extension's
 * `local_part.normalize()` accepts.
 *
 * Notes:
 *   - `.NNNNNN` shapes are intentionally allowed. The marketplace sheet
 *     routes those through the free registration path (see `onContinue`),
 *     so a typed-or-tapped free fallback never accidentally falls into
 *     the paid pipeline.
 *
 * Reasons returned:
 *   - 'empty'         — nothing entered
 *   - 'too-short'     — fewer than 2 chars
 *   - 'too-long'      — more than 63 chars (DNS label limit)
 *   - 'invalid-chars' — outside `[a-z0-9._-]` or starts/ends with `.-_`
 *
 * @param {string} localPart
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isLikelyAvailableLocalPart(localPart) {
  const value = String(localPart || '').trim().toLowerCase();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length < 2) return { ok: false, reason: 'too-short' };
  if (value.length > 63) return { ok: false, reason: 'too-long' };
  if (!PREMIUM_LOCAL_PART_RE.test(value)) return { ok: false, reason: 'invalid-chars' };
  return { ok: true };
}

/**
 * Look up an identifier on the domain: availability + computed price + the
 * extension's suggested free fallback (`<base>.NNNNNN`) the UI can offer in
 * one tap when the premium name is taken.
 *
 * Response is normalised so the UI never has to defend against missing
 * fields. Price is returned as a number of sats (the extension exposes it
 * under `price_in_sats` on `AddressStatus`; we tolerate the legacy
 * `price.sats` shape too).
 *
 * @param {{ query: string, years?: number, signal?: AbortSignal }} input
 * @returns {Promise<{
 *   identifier: string,
 *   available: boolean,
 *   priceSats: number|null,
 *   currency: string|null,
 *   freeIdentifierNumber: string|null,
 *   raw: object,
 * }>}
 */
export async function searchHandle({ query, years = 1, signal } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return {
      identifier: '',
      available: false,
      priceSats: null,
      currency: null,
      freeIdentifierNumber: null,
      raw: {},
    };
  }

  const url = new URL(`${LNBITS_BASE}/nostrnip5/api/v1/domain/${DOMAIN_ID}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('years', String(years));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`nip05 search failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    // The server returns `available` only on free-shape inputs; for premium
    // shapes it returns a price. Both branches imply availability — a "taken"
    // result comes back with neither (or with the `reserved` flag). Be
    // permissive: derive availability from the inverse of every "not free"
    // signal we know about.
    const reserved = data.reserved === true || data.is_reserved === true;
    const taken = data.available === false || reserved;
    const priceSats =
      Number.isFinite(data.price_in_sats) ? data.price_in_sats
      : Number.isFinite(data?.price?.sats) ? data.price.sats
      : null;
    return {
      identifier: typeof data.identifier === 'string' ? data.identifier : q,
      available: !taken,
      priceSats,
      currency: typeof data.currency === 'string' ? data.currency : null,
      freeIdentifierNumber:
        typeof data.free_identifier_number === 'string' ? data.free_identifier_number : null,
      raw: data,
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Request a premium (paid) handle: creates a pending address bound to the
 * pubkey and returns a Lightning invoice the user must pay before activation.
 *
 * The address is NOT live until the invoice settles; clients then call
 * `waitForActivation` (or do their own polling) against the returned
 * `paymentHash`. `rotationSecret` is the keyless management token we'll
 * persist so the user can manage the handle later without an LNbits account.
 *
 * @param {{ localPart: string, pubkeyHex: string, years?: number }} input
 * @returns {Promise<{
 *   addressId: string|null,
 *   handle: string,
 *   invoice: string,
 *   paymentHash: string,
 *   rotationSecret: string|null,
 * }>}
 * @throws if the create call returns a non-2xx, with `err.status` set so the
 *   UI can distinguish "taken" (409/400) from "server unreachable."
 */
export async function requestPaidHandle({ localPart, pubkeyHex, years = 1 }) {
  if (!localPart) throw new Error('nip05 paid: local_part required');
  if (!pubkeyHex) throw new Error('nip05 paid: pubkey required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${LNBITS_BASE}/nostrnip5/api/v1/public/domain/${DOMAIN_ID}/address`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: DOMAIN_ID,
          local_part: localPart,
          pubkey: pubkeyHex,
          years,
          create_invoice: true,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const err = new Error(`nip05 paid request failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (!data.payment_request || !data.payment_hash) {
      throw new Error('nip05 paid request: server did not return an invoice');
    }
    return {
      addressId: data.id || null,
      handle: data.local_part || localPart,
      invoice: data.payment_request,
      paymentHash: data.payment_hash,
      rotationSecret: data.rotation_secret || null,
      // Renewal feature disabled: the upstream extension doesn't enforce
      // `expires_at` (crud.py's active-address lookup ignores it) AND has
      // no keyless renewal endpoint. Names work indefinitely once active,
      // so surfacing an expiry would be misleading. Re-enable when the
      // extension gains a renewal route.
      // expiresAt: normaliseExpiresAt(data.expires_at, years),
      // years,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll the extension's payment-status endpoint until the invoice for a
 * premium signup settles (and the address is therefore activated server-
 * side). Resolves with `{ paid: true }` on success, `{ paid: false }` if
 * the cap is hit without confirmation. Caller is responsible for surfacing
 * a "still pending — try again" hint in the latter case.
 *
 * @param {{
 *   paymentHash: string,
 *   signal?: AbortSignal,
 *   intervalMs?: number,
 *   maxMs?: number,
 * }} input
 * @returns {Promise<{ paid: boolean }>}
 */
export async function waitForActivation({
  paymentHash,
  signal,
  intervalMs = ACTIVATION_POLL_INTERVAL_MS,
  maxMs = ACTIVATION_POLL_MAX_MS,
} = {}) {
  if (!paymentHash) throw new Error('nip05 wait: payment_hash required');

  const url = `${LNBITS_BASE}/nostrnip5/api/v1/domain/${DOMAIN_ID}/payments/${encodeURIComponent(paymentHash)}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxMs) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, { method: 'GET', signal });
      if (res.ok) {
        const data = await res.json();
        if (data.paid === true) return { paid: true };
      }
      // Non-2xx is treated as "not yet" — the extension returns 404 briefly
      // after invoice creation while the payment row settles. Don't break
      // the loop on transient errors; the maxMs cap handles persistent ones.
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Network blips: just keep polling until the cap.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { paid: false };
}

/**
 * Register a *specific* free `<base>.NNNNNN` handle the user has explicitly
 * chosen (e.g. by tapping the "Take satoshi.482913 for free" chip in the
 * marketplace sheet). Unlike `registerFreeHandle`, we do NOT retry with a
 * different suffix on collision — the suffix is part of the user's choice,
 * so a 409 here means "that exact name is taken, surface the error."
 *
 * @param {{ localPart: string, pubkeyHex: string }} input
 * @returns {Promise<{ handle: string, rotationSecret: string|null, addressId: string|null }>}
 */
export async function registerExactFreeHandle({ localPart, pubkeyHex }) {
  if (!localPart) throw new Error('nip05 free: local_part required');
  if (!pubkeyHex) throw new Error('nip05 free: pubkey required');
  const data = await postAddress(localPart, pubkeyHex);
  return {
    handle: data.local_part || localPart,
    rotationSecret: data.rotation_secret || null,
    addressId: data.id || null,
    // Renewal feature disabled — see `requestPaidHandle` for context.
    // expiresAt: normaliseExpiresAt(data.expires_at, 1),
    // years: 1,
  };
}

/**
 * Register a free `<baseSlug>.<6 digits>@mybuho.de` handle for the given
 * pubkey. Retries with a fresh suffix if the name is taken (or a transient
 * error occurs), then gives up.
 *
 * @param {{ baseSlug: string, pubkeyHex: string }} input
 * @returns {Promise<{ handle: string, rotationSecret: string|null, addressId: string|null }>}
 * @throws if every attempt fails (caller treats as "retry next launch").
 */
export async function registerFreeHandle({ baseSlug, pubkeyHex }) {
  if (!pubkeyHex) throw new Error('nip05 register: pubkey required');
  const base = baseSlug || 'buho';

  let lastErr;
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt++) {
    const localPart = `${base}.${freeSuffix()}`;
    try {
      const data = await postAddress(localPart, pubkeyHex);
      return {
        handle: data.local_part || localPart,
        rotationSecret: data.rotation_secret || null,
        addressId: data.id || null,
        // Renewal feature disabled — see `requestPaidHandle` for context.
        // expiresAt: normaliseExpiresAt(data.expires_at, 1),
        // years: 1,
      };
    } catch (err) {
      lastErr = err;
      // A 409/400 is almost always a suffix collision — retry with a new one.
      // Any other failure also retries (cheap) before we finally surface it.
    }
  }
  throw lastErr || new Error('nip05 register: exhausted attempts');
}
