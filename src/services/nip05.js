/**
 * Usernames: NIP-05 addresses on BuhoGO's own domain.
 *
 * A username is `name@mybuho.de`, registered through the LNbits `nostrnip5`
 * extension and published in the kind:0 `nip05` field of the person's Nostr
 * profile. The published profile is the source of truth for which username a
 * person uses; this module only talks to the name server and formats names.
 *
 * Every name is paid, per year, for 1 to 10 years at a time. The extension's
 * free shape (`name.123456`) is never offered, and a free-shape name found in
 * a profile counts as no username.
 *
 * Pure module, no store imports, so it can be unit-tested with an injected
 * `fetch` and called from boot files and stores alike.
 *
 * Endpoints (all keyless, verified against the live extension):
 *   GET  {BASE}/nostrnip5/api/v1/domain/{DOMAIN_ID}/search?q=…&years=1
 *   POST {BASE}/nostrnip5/api/v1/public/domain/{DOMAIN_ID}/address
 *   GET  {BASE}/nostrnip5/api/v1/domain/{DOMAIN_ID}/payments/{payment_hash}
 *   GET  {BASE}/nostrnip5/api/v1/domain/{DOMAIN_ID}/nostr.json?name=…
 */

// ── Config (mybuho.de domain on the timecatcher LNbits instance) ────────────
export const NIP05_DOMAIN = 'mybuho.de';
const LNBITS_BASE = 'https://timecatcher.lnbits.de';
const DOMAIN_ID = 'ANpwyDeLkZFG5kS8Y9v8bA';
const API_BASE = `${LNBITS_BASE}/nostrnip5/api/v1`;

/**
 * Public mybuho.de prices, in sats per year. The extension computes the real
 * amount server-side (price per year × years) and `searchHandle()` stays
 * authoritative at checkout; this snapshot only powers the Prices table.
 * Verified against the public search endpoint on 2026-09-23.
 */
export const NIP05_PRICE_TIERS = Object.freeze([
  Object.freeze({ id: 'two-to-three', minChars: 2, maxChars: 3, priceSats: 10_000 }),
  Object.freeze({ id: 'four', minChars: 4, maxChars: 4, priceSats: 4_000 }),
  Object.freeze({ id: 'five-to-six', minChars: 5, maxChars: 6, priceSats: 2_000 }),
  Object.freeze({ id: 'seven-plus', minChars: 7, maxChars: null, priceSats: 1_000 }),
]);

/** The extension sells 1 to 10 years at a time (verified live 2026-09-24). */
export const NIP05_MAX_YEARS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const LOOKUP_TIMEOUT_MS = 8000;
/** Polling cadence for "has this payment code been paid yet?". */
const ACTIVATION_POLL_INTERVAL_MS = 2000;
/** Cap for one uninterrupted wait; a claim left pending finishes later. */
const ACTIVATION_POLL_MAX_MS = 90000;
/** How long an availability answer for the home suggestion stays fresh. */
const SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;
/** A display-name slug longer than this is not a friendly suggestion. */
const SLUG_MAX = 20;

/** What the server accepts as a local part (the extension's own rule). */
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
/** The extension's free shape: any local part ending in `.` + six digits. */
const FREE_SHAPE_RE = /\.\d{6}$/;

// ---------------------------------------------------------------------------
// Names and display
// ---------------------------------------------------------------------------

/** Full `name@mybuho.de` address for a local part, or null. */
export function nip05AddressFor(localPart) {
  return localPart ? `${localPart}@${NIP05_DOMAIN}` : null;
}

/** A whole number of years the extension accepts: 1 to 10. */
export function clampYears(value) {
  const years = Math.round(Number(value));
  if (!Number.isFinite(years)) return 1;
  return Math.min(NIP05_MAX_YEARS, Math.max(1, years));
}

/**
 * When a name paid at `paidAt` for `years` ends, by the extension's own rule
 * (activation plus 365 days per year; activation follows the payment).
 */
export function expiresAtFor(paidAt, years) {
  return paidAt + clampYears(years) * 365 * DAY_MS;
}

/** True for the extension's free `name.123456` shape. */
export function isFreeShapeHandle(localPart) {
  return FREE_SHAPE_RE.test(String(localPart || '').trim());
}

/**
 * A domain in its ASCII form, lowercased. International domains come back
 * as punycode, so a lookalike letter from another alphabet never equals
 * `mybuho.de`. Returns '' for anything that is not a valid host name.
 */
function asciiDomain(domain) {
  const value = String(domain || '').trim();
  if (!value || /[\s/?#@]/.test(value)) return '';
  try {
    return new URL(`https://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Split a NIP-05 value into its parts.
 *
 * @param {string} value e.g. `maria@mybuho.de`
 * @returns {{ local: string, domain: string, ours: boolean } | null}
 */
export function splitNip05(value) {
  const raw = String(value || '').trim();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return null;
  const local = raw.slice(0, at).toLowerCase();
  const domain = asciiDomain(raw.slice(at + 1));
  if (!domain) return null;
  return { local, domain, ours: domain === NIP05_DOMAIN };
}

/**
 * The person's own username (the local part) when a NIP-05 value is a paid
 * name on our domain; '' for anything else. This is the one rule that
 * decides "does this profile have a Buho username".
 */
export function ownUsernameFrom(nip05) {
  const parts = splitNip05(nip05);
  if (!parts || !parts.ours) return '';
  if (parts.local === '_' || isFreeShapeHandle(parts.local)) return '';
  return LOCAL_PART_RE.test(parts.local) ? parts.local : '';
}

/**
 * How a NIP-05 value is written on screen: always the full address, with
 * the domain, as the Nostr Design Guide shows it. `_@domain` is the domain
 * itself (NIP-05). A free-shape name on our domain is never shown.
 *
 * @returns {{ text: string, local: string, domain: string } | null}
 *   `local` and `domain` let a view emphasise the domain; `local` is '' for
 *   a `_@domain` address.
 */
export function formatUsername(nip05) {
  const parts = splitNip05(nip05);
  if (!parts) return null;
  if (parts.ours && isFreeShapeHandle(parts.local)) return null;
  if (parts.local === '_') return { text: parts.domain, local: '', domain: parts.domain };
  return { text: `${parts.local}@${parts.domain}`, local: parts.local, domain: parts.domain };
}

/**
 * Fold a string to the plain letters a username allows: accents removed,
 * `ß` as `ss`, lowercase. Other characters are left alone so the validator
 * can say what is wrong with them.
 */
function foldLetters(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss');
}

/**
 * Clean what a person types or pastes into the username field, as they type:
 * a leading `@`, a trailing `@mybuho.de`, spaces, capitals and accents are
 * handled quietly, so only characters that can never work produce a hint.
 */
export function normaliseUsernameInput(raw) {
  let value = foldLetters(raw).replace(/\s+/g, '');
  value = value.replace(/^@+/, '');
  const suffix = `@${NIP05_DOMAIN}`;
  if (value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return value;
}

/**
 * Slug of a display name, used to pre-fill the claim field and for the home
 * suggestion. `[a-z0-9]` only, at most 20 characters; '' when fewer than two
 * usable characters remain (for example a name in a non-Latin script).
 */
export function deriveNameSlug({ name } = {}) {
  const slug = foldLetters(name).replace(/[^a-z0-9]+/g, '').slice(0, SLUG_MAX);
  return slug.length >= 2 ? slug : '';
}

/**
 * Alternatives built from a display name, for when the typed name is taken.
 * The caller checks which are available and shows at most two. A single-word
 * name has no natural variant, so it yields only itself: no chip beats a
 * made-up one.
 *
 * @param {string} displayName
 * @param {string} [taken] the name that came back taken, never suggested
 * @returns {string[]}
 */
export function suggestUsernames(displayName, taken = '') {
  const words = foldLetters(displayName).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const first = words[0];
  const last = words[words.length - 1];
  const candidates = words.length === 1
    ? [first]
    : [first, `${first}${last}`, `${first}.${last[0]}`, `${first}_${last}`];
  const excluded = String(taken || '').toLowerCase();
  return [...new Set(candidates)].filter((value) => (
    value !== excluded
    && isLikelyAvailableLocalPart(value).ok
    && !isFreeShapeHandle(value)
  ));
}

/**
 * Expand the `@maria` shorthand someone may type into Send or People into
 * `maria@mybuho.de`. Anything else comes back unchanged.
 */
export function expandUsername(input) {
  const value = String(input || '').trim();
  const match = /^@([a-z0-9][a-z0-9._-]{0,62})$/i.exec(value);
  return match ? `${match[1].toLowerCase()}@${NIP05_DOMAIN}` : value;
}

/**
 * A username typed or pasted into Send or People, as its full address:
 * `@maria` or `maria@mybuho.de` becomes `maria@mybuho.de`. '' for anything
 * that is not a paid-shape name on our domain, so every other `name@domain`
 * keeps its usual handling.
 */
export function usernameAddressFromInput(input) {
  return nip05AddressFor(ownUsernameFrom(expandUsername(input))) || '';
}

/**
 * Client-side shape check for a name before any network round-trip. The
 * server is the authority on availability and price.
 *
 * Reasons: 'empty' | 'too-short' | 'too-long' | 'invalid-chars'
 *
 * @param {string} localPart
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isLikelyAvailableLocalPart(localPart) {
  const value = String(localPart || '').trim().toLowerCase();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length < 2) return { ok: false, reason: 'too-short' };
  if (value.length > 63) return { ok: false, reason: 'too-long' };
  if (!LOCAL_PART_RE.test(value)) return { ok: false, reason: 'invalid-chars' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * `fetch` with a timeout that also honours a caller's AbortSignal. The
 * caller's abort surfaces as an AbortError; the timeout as a plain Error.
 */
async function fetchWithTimeout(url, init = {}, { signal, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function httpError(message, status) {
  const err = new Error(`${message}: HTTP ${status}`);
  err.status = status;
  return err;
}

/**
 * Availability and price for a local part. With the default one year the
 * price is the price per year.
 *
 * @param {{ query: string, years?: number, signal?: AbortSignal }} input
 * @returns {Promise<{ identifier: string, available: boolean, priceSats: number|null, currency: string|null, raw: object }>}
 */
export async function searchHandle({ query, years = 1, signal } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return { identifier: '', available: false, priceSats: null, currency: null, raw: {} };
  }

  const url = new URL(`${API_BASE}/domain/${DOMAIN_ID}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('years', String(years));

  const res = await fetchWithTimeout(url.toString(), { method: 'GET' }, { signal });
  if (!res.ok) throw httpError('nip05 search failed', res.status);
  const data = await res.json();

  // A taken name comes back with `available: false` or the reserved flag;
  // an available paid name comes back with a price.
  const reserved = data.reserved === true || data.is_reserved === true;
  const taken = data.available === false || reserved;
  const priceSats = Number.isFinite(data.price_in_sats) ? data.price_in_sats
    : Number.isFinite(data?.price?.sats) ? data.price.sats
    : null;
  return {
    identifier: typeof data.identifier === 'string' ? data.identifier : q,
    available: !taken,
    priceSats,
    currency: typeof data.currency === 'string' ? data.currency : null,
    raw: data,
  };
}

/**
 * Create a pending name bound to the pubkey and get the payment code for it,
 * for `years` (1 to 10). The name only becomes active once the invoice is
 * paid; the invoice asks for the price per year × years.
 *
 * @param {{ localPart: string, pubkeyHex: string, years?: number }} input
 * @returns {Promise<{ addressId: string|null, handle: string, invoice: string, paymentHash: string, rotationSecret: string|null }>}
 * @throws with `err.status` set on a non-2xx, so the UI can tell "taken"
 *   (409/400) from "server unreachable"
 */
export async function requestPaidHandle({ localPart, pubkeyHex, years = 1 }) {
  if (!localPart) throw new Error('nip05 paid: local_part required');
  if (!pubkeyHex) throw new Error('nip05 paid: pubkey required');

  const res = await fetchWithTimeout(`${API_BASE}/public/domain/${DOMAIN_ID}/address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain_id: DOMAIN_ID,
      local_part: localPart,
      pubkey: pubkeyHex,
      years: clampYears(years),
      create_invoice: true,
    }),
  });
  if (!res.ok) throw httpError('nip05 paid request failed', res.status);
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
  };
}

/**
 * One check of whether a payment code has been paid.
 *
 * @returns {Promise<boolean|null>} true / false, or null when the server
 *   could not be asked (a transient 404 right after creation counts as false)
 */
export async function checkPaid({ paymentHash, signal } = {}) {
  if (!paymentHash) throw new Error('nip05 check: payment_hash required');
  const url = `${API_BASE}/domain/${DOMAIN_ID}/payments/${encodeURIComponent(paymentHash)}`;
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, { signal, timeoutMs: LOOKUP_TIMEOUT_MS });
    if (!res.ok) return res.status === 404 ? false : null;
    const data = await res.json();
    return data.paid === true;
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return null;
  }
}

/**
 * Poll until a payment code is paid, or give up after `maxMs`. Works the same
 * for a payment made in the app and one made from any other wallet: the
 * server is asked, not the wallet.
 *
 * @returns {Promise<{ paid: boolean }>}
 * @throws AbortError when `signal` aborts
 */
export async function waitForActivation({
  paymentHash,
  signal,
  intervalMs = ACTIVATION_POLL_INTERVAL_MS,
  maxMs = ACTIVATION_POLL_MAX_MS,
} = {}) {
  if (!paymentHash) throw new Error('nip05 wait: payment_hash required');
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const paid = await checkPaid({ paymentHash, signal });
    if (paid === true) return { paid: true };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
  return { paid: false };
}

/**
 * Who `localPart@mybuho.de` points at right now. Asked of the extension
 * directly rather than of `mybuho.de`, so the app does not depend on the
 * domain's front server for its own checks.
 *
 * @returns {Promise<string|null>} the owner's hex pubkey (lowercase), ''
 *   when the name is not active for anyone (never bought, or bought but not
 *   activated yet), or null when the server could not be asked
 */
export async function lookupOwner(localPart, { signal, fetch: fetchImpl } = {}) {
  const local = String(localPart || '').trim().toLowerCase();
  if (!local) return '';
  try {
    const res = await fetchWithTimeout(ownDomainLookupUrl(local), { method: 'GET' }, {
      signal,
      timeoutMs: LOOKUP_TIMEOUT_MS,
      fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const names = data && typeof data.names === 'object' ? data.names : null;
    if (!names) return null;
    return String(names[local] || '').toLowerCase();
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return null;
  }
}

/**
 * The ownership check: does `localPart@mybuho.de` point at this key now?
 *
 * @returns {Promise<boolean|null>} true / false, or null when it could not be
 *   answered. Callers treat null as "ask again later", never as "not yours".
 */
export async function isMine(localPart, pubkeyHex, options = {}) {
  const key = String(pubkeyHex || '').trim().toLowerCase();
  if (!String(localPart || '').trim() || !key) return false;
  const owner = await lookupOwner(localPart, options);
  return owner === null ? null : owner === key;
}

/** Where BuhoGO resolves a name on its own domain (see `isMine`). */
export function ownDomainLookupUrl(localPart) {
  return `${API_BASE}/domain/${DOMAIN_ID}/nostr.json?name=${encodeURIComponent(String(localPart || '').toLowerCase())}`;
}

const suggestionCache = new Map();

/**
 * Whether the slug of a display name is available, for the calm "maria@…
 * is available" line on the home tab and in Edit profile. One search per
 * slug per day, cached in memory; never throws.
 *
 * @returns {Promise<{ slug: string, available: boolean } | null>} null when
 *   there is no usable slug or the answer is unknown (offline, server error)
 */
export async function suggestUsernameFor(displayName, { now = Date.now(), search = searchHandle } = {}) {
  const slug = deriveNameSlug({ name: displayName });
  if (!slug) return null;
  const cached = suggestionCache.get(slug);
  if (cached && now - cached.at < SUGGESTION_TTL_MS) return cached.value;
  try {
    const result = await search({ query: slug });
    const value = { slug, available: !!result.available && Number(result.priceSats) > 0 };
    suggestionCache.set(slug, { at: now, value });
    return value;
  } catch {
    return null;
  }
}

/** Test helper: forget cached suggestions. */
export function clearSuggestionCache() {
  suggestionCache.clear();
}
