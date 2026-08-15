/**
 * npub.cash client.
 *
 * Solves the one gap a new BuhoGO user cannot close on their own: they have an
 * identity and a username within seconds, but nothing to be paid at. Spark
 * wallets have no Lightning address at all, so without this the Get paid screen
 * correctly tells them nobody can pay them and the only way out is to go and
 * find a Lightning address somewhere else.
 *
 * npub.cash gives every Nostr key a working Lightning address with no signup:
 * `<npub>@npub.cash` is payable the moment the key exists. Payments are held as
 * ecash by a mint until the owner comes to collect, and in v2 that ecash is
 * locked to the owner's own key, so the service cannot spend it.
 *
 * The address is never shown to anyone. It lives in the `lud16` field of the
 * published profile, and what people actually hand out is `@username`, which
 * resolves through the profile to here. Ugly is fine for machinery nobody types.
 *
 * API shape (verified against the live service, their docs domain is gone):
 *
 *   GET  {BASE}/api/v2/auth/nip98      Authorization: Nostr <base64 kind-27235>
 *                                       -> { data: { token } }        a JWT
 *   GET  {BASE}/api/v2/wallet/quotes   Authorization: Bearer <jwt>
 *                                       -> { data: { quotes: [...] },
 *                                            metadata: { total, limit } }
 *   PUT  {BASE}/api/v2/user/mint       NIP-98 (not the JWT)
 *
 * CORS is open (`access-control-allow-origin: *`), so the web build talks to it
 * directly and the Capacitor build uses the identical path. No proxy needed.
 *
 * This module is deliberately pure: no Pinia, no UI. The store owns state and
 * the sweep; this only speaks HTTP.
 */

import { createHttpAuthEvent, getAuthorizationHeader } from 'nostr-core';

/** v2 API host. The `npub.cash` host serves only the web app. */
export const NPUBCASH_API = 'https://npubx.cash';

/** Domain the addresses live on. Kept separate: the API moved once already. */
export const NPUBCASH_DOMAIN = 'npub.cash';

/** Requests are cheap but the service is someone else's; keep the leash short. */
const REQUEST_TIMEOUT_MS = 12000;

/**
 * JWTs are valid for a while and re-signing on every call would be wasteful,
 * so one is cached per pubkey in memory only. Never persisted: it is a bearer
 * credential and it costs one signature to replace.
 */
const jwtCache = new Map();

/** Refresh a little before the token actually dies, to avoid a race mid-sweep. */
const JWT_EARLY_REFRESH_MS = 60_000;

export class NpubCashError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'NpubCashError';
    this.code = code;
    this.status = status;
  }
}

/** The Lightning address for a key. Payable immediately, no registration. */
export function npubCashAddress(npub) {
  if (typeof npub !== 'string' || !npub.startsWith('npub1')) return '';
  return `${npub}@${NPUBCASH_DOMAIN}`;
}

/** True if an address points at npub.cash, so we can tell ours from a user's own. */
export function isNpubCashAddress(address) {
  if (typeof address !== 'string') return false;
  return address.trim().toLowerCase().endsWith(`@${NPUBCASH_DOMAIN}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new NpubCashError(`${label} timed out`, 'TIMEOUT')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the NIP-98 Authorization header for one exact request.
 *
 * The server validates the `u` and `method` tags against the request it
 * actually received, so the URL has to match byte for byte, query string
 * included. `nostr-core` already implements this; nothing to hand-roll.
 */
function nip98Header(url, method, secretKey) {
  const event = createHttpAuthEvent({ url, method }, secretKey);
  return getAuthorizationHeader(event);
}

/**
 * Exchange a signature for a JWT.
 *
 * @param {Uint8Array} secretKey  the identity's Nostr secret key bytes
 * @param {string} pubkeyHex      used only as the cache key
 */
export async function getAuthToken(secretKey, pubkeyHex, opts = {}) {
  const base = opts.baseUrl || NPUBCASH_API;
  const cacheKey = `${base}:${pubkeyHex}`;

  const cached = jwtCache.get(cacheKey);
  if (cached && cached.expiresAt - JWT_EARLY_REFRESH_MS > Date.now()) {
    return cached.token;
  }

  const url = `${base}/api/v2/auth/nip98`;
  const res = await withTimeout(
    fetch(url, { headers: { Authorization: nip98Header(url, 'GET', secretKey) } }),
    REQUEST_TIMEOUT_MS,
    'auth',
  );

  if (!res.ok) {
    throw new NpubCashError('Could not sign in to npub.cash', 'AUTH_FAILED', res.status);
  }

  const body = await res.json().catch(() => null);
  const token = body?.data?.token || body?.token;
  if (!token) {
    throw new NpubCashError('npub.cash returned no token', 'AUTH_NO_TOKEN', res.status);
  }

  jwtCache.set(cacheKey, { token, expiresAt: jwtExpiry(token) });
  return token;
}

/**
 * Read the expiry out of the JWT payload so we refresh on the server's schedule
 * rather than a guess of our own. A token we cannot parse is treated as
 * short-lived, which costs one extra signature at worst.
 */
function jwtExpiry(token) {
  try {
    const [, payload] = token.split('.');
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isFinite(json?.exp)) return json.exp * 1000;
  } catch {
    // Opaque token; fall through.
  }
  return Date.now() + 5 * 60_000;
}

/** Drop a cached token, so the next call re-signs. Used after a 401. */
export function forgetAuthToken(pubkeyHex, opts = {}) {
  jwtCache.delete(`${opts.baseUrl || NPUBCASH_API}:${pubkeyHex}`);
}

/**
 * Every payment the address has ever received, newest first.
 *
 * A quote is one incoming payment. `state === 'PAID'` means the money arrived
 * and the ecash is waiting; the client mints it by presenting the quote id and
 * a signature. `since` and the offset paging keep this cheap on repeat calls.
 *
 * @returns {Promise<Array<{quoteId, amount, unit, createdAt, paidAt, expiresAt,
 *                          mintUrl, request, state, locked}>>}
 */
export async function fetchQuotes({ secretKey, pubkeyHex, since = 0, baseUrl } = {}) {
  const base = baseUrl || NPUBCASH_API;
  const token = await getAuthToken(secretKey, pubkeyHex, { baseUrl: base });

  const collected = [];
  let offset = 0;

  // Bounded: the service pages at 50 and a personal address will not have
  // thousands of payments, but a runaway loop against someone else's server is
  // not a failure mode worth risking.
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${base}/api/v2/wallet/quotes`);
    if (since) url.searchParams.set('since', String(since));
    if (offset) url.searchParams.set('offset', String(offset));

    const res = await withTimeout(
      fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }),
      REQUEST_TIMEOUT_MS,
      'quotes',
    );

    if (res.status === 401) {
      forgetAuthToken(pubkeyHex, { baseUrl: base });
      throw new NpubCashError('npub.cash rejected the session', 'AUTH_EXPIRED', 401);
    }
    if (!res.ok) {
      throw new NpubCashError('Could not read npub.cash', 'QUOTES_FAILED', res.status);
    }

    const body = await res.json().catch(() => null);
    const quotes = body?.data?.quotes;
    if (!Array.isArray(quotes)) break;

    collected.push(...quotes);

    const total = Number(body?.metadata?.total ?? collected.length);
    offset += quotes.length;
    if (quotes.length === 0 || offset >= total) break;
  }

  return collected;
}

/**
 * Pin which mint holds the ecash.
 *
 * Not called by default. Choosing a mint means choosing who holds a user's
 * money until they sweep it, and BuhoGO has not vetted one, so we accept
 * whatever npub.cash uses and read the mint back off each quote. Exposed
 * because the day we do vet one, this is the whole change.
 */
export async function setMintUrl({ secretKey, mintUrl, baseUrl } = {}) {
  const base = baseUrl || NPUBCASH_API;
  const url = `${base}/api/v2/user/mint`;

  const res = await withTimeout(
    fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: nip98Header(url, 'PUT', secretKey),
      },
      body: JSON.stringify({ mintUrl }),
    }),
    REQUEST_TIMEOUT_MS,
    'set mint',
  );

  if (!res.ok) {
    throw new NpubCashError('Could not set the mint', 'MINT_SET_FAILED', res.status);
  }
  return true;
}
