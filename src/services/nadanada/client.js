/**
 * nadanada (formerly LNVPN) API client — shared HTTP plumbing for the
 * in-app store. nadanada sells no-account privacy products (eSIM data
 * plans, WireGuard VPN) paid with Bitcoin Lightning.
 *
 * This module is intentionally pure of store/Pinia imports so the service
 * layer stays unit-testable. The cross-store wiring (paying the invoice,
 * persisting the order) lives in the shop components, the `nadanadaOrders`
 * store, and ./orders.js.
 *
 * CORS NOTE — nadanada's API sends no `Access-Control-Allow-Origin`, so a
 * browser cannot call it directly. We work around that per runtime:
 *   - Native (iOS/Android): requests go through `CapacitorHttp`, the native
 *     HTTP layer, which is not subject to WebView CORS. We hit the absolute
 *     API URL directly.
 *   - Web: we call a same-origin relative path (`/nadanada-api/...`) that is
 *     reverse-proxied to https://nadanada.me/api/v2. In `quasar dev` this is
 *     handled by the devServer proxy (see quasar.config.js). A production web
 *     build must serve `/nadanada-api` via a reverse proxy (or have nadanada
 *     whitelist the web origin); on native this is not needed.
 *
 * API shape verified against the live v2 endpoints and the machine-readable
 * spec at https://nadanada.me/api/v2/openapi.json (the human `/documentation`
 * page renders client-side and reads as blank to any fetcher). No API key is
 * required for catalog or purchase.
 *
 *   GET  {BASE}/esim/countries
 *   GET  {BASE}/esim/bundles?country=XX | ?region=slug
 *   POST {BASE}/esim/purchase          { bundleName, slug, refCode } -> invoice
 *   POST {BASE}/esim/complete          { paymentHash | checkoutId }  -> { iccid, installationDetails }
 *   GET  {BASE}/esim/{iccid}                                          -> status + usage
 *   POST {BASE}/esim/{iccid}/purchase  { bundleName, slug, refCode } -> invoice (top-up)
 *   POST {BASE}/esim/{iccid}/complete  { paymentHash | checkoutId }  -> { toppedUp }
 *   GET  {BASE}/vpn/countries
 *   POST {BASE}/vpn/request            { duration, refCode }         -> invoice
 *   POST {BASE}/vpn/extend             { publicKey, duration }       -> invoice
 *   POST {BASE}/vpn/config             { paymentHash | checkoutId, country, publicKey, presharedKey } -> .conf text
 *   GET  {BASE}/vpn/status/{publicKey}
 *
 * Every purchase response also carries a `checkoutId`, which every matching
 * complete endpoint accepts in place of the `paymentHash`. Both are persisted
 * as redemption keys (see ./orders.js) — losing them means losing the order,
 * because nadanada has no accounts and no order-by-email lookup.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';

const IS_NATIVE = (() => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
})();

/** Native uses the absolute API (CapacitorHttp bypasses CORS); web uses a
 *  same-origin proxied path to dodge the browser CORS block. */
export const NADANADA_BASE = IS_NATIVE ? 'https://nadanada.me/api/v2' : '/nadanada-api';

/**
 * BuhoGO affiliate referral code, attached to every purchase so the
 * commission accrues to BuhoGO. A single app-wide code — NOT per-user — and
 * intentionally invisible to the user. Earnings are monitored out-of-band via
 * the partner API; the app never surfaces a balance.
 *
 * BuhoGO's real partner code is BUHOGO (nadanada.me?ref=BUHOGO). It is
 * deliberately shipped in the source: it is a public referral tag, not a
 * secret, and it must be present on every purchase or the commission is lost.
 * Do not remove it or make it conditional. If it ever needs to rotate without
 * an app release, add a remote-config override that FALLS BACK to this value.
 */
export const NADANADA_REF_CODE = 'BUHOGO';

/** Network timeout for a single request, passed to the transport. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Wall-clock ceiling for one request, enforced in JS on top of the transport
 * timeout. CapacitorHttp cannot be cancelled mid-flight and its socket
 * timeouts only cover connect + read inactivity, so a slow trickle could
 * otherwise hold a promise open indefinitely and pin the UI on a spinner.
 * This guarantees every request settles.
 */
const REQUEST_HARD_TIMEOUT_MS = 22000;

/**
 * Statuses that mean "the payment has not settled yet" — expected, and never
 * an error. nadanada documents 402 for this on every complete/config endpoint.
 */
export const PENDING_STATUSES = [402];

/**
 * Statuses that mean "retrying will never help". Bailing out immediately on
 * these is what turns a silent dead end into an actionable message:
 *   400 malformed / unpriceable request
 *   403 this ICCID does not belong to that checkout session
 *   404 checkout session not found for this payment
 *   409 the VPN config for this payment was already generated (one per payment)
 *   422 unprocessable
 */
export const FATAL_STATUSES = [400, 403, 404, 409, 422];

/**
 * Error thrown by every nadanada call. Carries the HTTP `status` and, where
 * the API supplies one, its machine-readable `code` (`PAYMENT_PENDING`,
 * `CONFIG_ALREADY_GENERATED`, `bundle_slug_mismatch`, `invalid_slug`, …).
 * `fatal` marks the errors a retry can never fix.
 */
export class NadanadaError extends Error {
  constructor(message, { status = null, code = null, fatal = false } = {}) {
    super(message || 'nadanada request failed');
    this.name = 'NadanadaError';
    this.status = status;
    this.code = code;
    this.fatal = fatal;
  }
}

/** True when an error should stop a poll instead of being retried. */
export function isFatalError(err) {
  if (!err) return false;
  if (err.fatal === true) return true;
  return FATAL_STATUSES.includes(err.status);
}

/** True when an error is the documented "payment not settled yet" signal. */
export function isPendingError(err) {
  return !!err && PENDING_STATUSES.includes(err.status);
}

/**
 * The shop is native-only, and this is the lock that makes it true.
 *
 * On web the API cannot be reached at all without a reverse proxy (nadanada
 * sends no Access-Control-Allow-Origin), so a web build would show a broken
 * shop that can still be coaxed into creating an invoice. Rather than ship a
 * half-working money path, every invoice-creating call refuses outright.
 *
 * Called by the four functions that can make a payable invoice — purchaseEsim,
 * purchaseEsimTopup, requestVpn, requestVpnExtension. Keep it that way: if a
 * fifth way to spend is ever added, it belongs on this list.
 *
 * Mirrors the money-exit lock in stores/earn.js `_requestPayout()`.
 *
 * @throws {NadanadaError} when not running natively
 */
export function assertNativePurchase() {
  if (IS_NATIVE) return;
  throw new NadanadaError('The shop is only available in the BuhoGO app.', {
    code: 'NATIVE_ONLY',
    fatal: true,
  });
}

/**
 * Attach the affiliate code to a purchase body. Centralised here so no call
 * site can forget it (a missing refCode means a lost commission).
 *
 * @template {object} T
 * @param {T} body
 * @returns {T & { refCode: string }}
 */
export function withRef(body) {
  return { ...body, refCode: NADANADA_REF_CODE };
}

/** Build a full request URL. NADANADA_BASE may be relative on web, so the
 *  query is assembled manually (the URL constructor needs an absolute base). */
function buildUrl(path, params) {
  let url = `${NADANADA_BASE}${path}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    const s = q.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

function jsonHeaders(hasBody) {
  return hasBody
    ? { 'Content-Type': 'application/json', Accept: 'application/json' }
    : { Accept: 'application/json' };
}

/** Parse an error payload (string or object) into `{ message, code }`. */
function errorInfoFrom(payload) {
  if (payload == null) return { message: null, code: null };
  let obj = payload;
  if (typeof payload === 'string') {
    try {
      obj = JSON.parse(payload);
    } catch {
      return { message: payload.slice(0, 200) || null, code: null };
    }
  }
  if (!obj || typeof obj !== 'object') return { message: null, code: null };
  return {
    message: obj.error || obj.message || obj.detail || null,
    code: typeof obj.code === 'string' ? obj.code : null,
  };
}

function httpError(payload, { status, method, url }) {
  const { message, code } = errorInfoFrom(payload);
  return new NadanadaError(
    message || `nadanada ${method} ${url} failed: HTTP ${status}`,
    { status, code, fatal: FATAL_STATUSES.includes(status) },
  );
}

/**
 * Race a promise against a wall-clock timer so it always settles. The losing
 * promise keeps running to completion; its result is discarded.
 */
function withHardTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new NadanadaError(`${label} timed out`, { code: 'TIMEOUT' })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Native transport (CapacitorHttp; no CORS, no AbortSignal) ────────────────

async function nativeRequest(method, url, { body, raw, signal }) {
  // CapacitorHttp cannot cancel a request mid-flight, so we honour the signal
  // by not issuing a request once it is aborted. The poll loop also checks the
  // signal between attempts, so at most one in-flight request outlives an abort
  // (its result is simply discarded).
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let res;
  try {
    res = await withHardTimeout(
      CapacitorHttp.request({
        url,
        method,
        headers: jsonHeaders(!!body),
        data: body || undefined,
        responseType: raw ? 'text' : 'json',
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS,
      }),
      REQUEST_HARD_TIMEOUT_MS,
      `nadanada ${method} ${url}`,
    );
  } catch (e) {
    if (e instanceof NadanadaError) throw e;
    throw new NadanadaError(`nadanada ${method} ${url} failed: ${e?.message || 'network error'}`);
  }

  const status = res.status;
  if (status < 200 || status >= 300) throw httpError(res.data, { status, method, url });

  if (raw) return typeof res.data === 'string' ? res.data : String(res.data ?? '');

  // CapacitorHttp parses JSON when responseType is 'json'; tolerate a string.
  let data = res.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* leave as-is */ }
  }
  if (data && data.success === false) throw httpError(data, { status, method, url });
  return data;
}

// ── Web transport (fetch; relies on the same-origin proxy) ───────────────────

function linkedController(signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  };
  return { controller, cleanup };
}

async function webRequest(method, url, { body, signal, raw }) {
  const { controller, cleanup } = linkedController(signal);
  try {
    const res = await fetch(url, {
      method,
      headers: jsonHeaders(!!body),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch { /* ignore */ }
      throw httpError(text, { status: res.status, method, url });
    }
    if (raw) return res.text();
    const data = await res.json();
    if (data && data.success === false) throw httpError(data, { status: res.status, method, url });
    return data;
  } finally {
    cleanup();
  }
}

/**
 * Core request. Dispatches to the native or web transport. Throws a
 * `NadanadaError` with `.status` / `.code` / `.fatal` on any non-2xx (so the
 * poll helpers can special-case 402 "payment not confirmed yet" and stop dead
 * on 404/409) and on a JSON `success:false` envelope.
 *
 * @param {string} method
 * @param {string} path — path under NADANADA_BASE, e.g. '/esim/purchase'
 * @param {{ params?: Record<string,string|number>, body?: object, signal?: AbortSignal, raw?: boolean }} [opts]
 */
function request(method, path, { params, body, signal, raw = false } = {}) {
  const url = buildUrl(path, params);
  return IS_NATIVE
    ? nativeRequest(method, url, { body, raw, signal })
    : webRequest(method, url, { body, signal, raw });
}

/** GET helper. Returns the parsed envelope; callers unwrap `.data` themselves. */
export function nadanadaGet(path, opts = {}) {
  return request('GET', path, opts);
}

/** POST helper. Pass `{ raw: true }` for `/vpn/config`, which returns the
 *  WireGuard config as `text/plain` rather than JSON. */
export function nadanadaPost(path, body, opts = {}) {
  return request('POST', path, { ...opts, body });
}

// ── Polling (settlement / fulfilment) ────────────────────────────────────────

/** Abortable sleep, so an abort ends the poll promptly instead of at the next
 *  loop turn. Resolves (never rejects) — the loop re-checks the signal. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Exponential backoff with symmetric +/-20% jitter, capped. Keeps us polite to
 *  the API instead of hammering a fixed interval, and de-synchronises retries. */
function computeBackoff(attempt, baseMs, maxIntervalMs) {
  const base = Math.min(baseMs * Math.pow(1.6, attempt - 1), maxIntervalMs);
  return base * (1 + (Math.random() - 0.5) * 0.4); // [base*0.8, base*1.2)
}

/**
 * Poll a fulfilment step until it succeeds, the deadline passes, or the
 * endpoint fails in a way retrying cannot fix.
 *
 * Three outcomes, and every caller must handle all three:
 *   - resolves with the truthy result     -> fulfilled
 *   - resolves with `null`                -> not yet; try again later
 *   - throws a fatal `NadanadaError`      -> will never work; tell the user
 *
 * nadanada signals "payment not confirmed yet" with HTTP 402, which is
 * expected and never counts as an error. 404 (unknown checkout session) and
 * 409 (VPN config already generated) are terminal and rethrown immediately
 * rather than being buried under a reassuring "still waiting" message.
 *
 * The whole poll is raced against `maxMs`, so it always settles even if a
 * single request hangs — CapacitorHttp cannot be cancelled, and a poll that
 * only checks its budget between attempts can otherwise pin the UI forever.
 *
 * @param {(signal?: AbortSignal) => Promise<any>} fn — resolves to a truthy
 *   result on success, or null/false while still pending; may throw (402 ->
 *   pending, fatal -> rethrown, other -> counts toward the error bailout).
 * @param {{
 *   signal?: AbortSignal,
 *   deadline?: number,            // epoch ms (invoice expiry) — stop polling after
 *   maxMs?: number,               // hard fallback cap
 *   baseMs?: number,              // first backoff interval
 *   maxIntervalMs?: number,       // backoff ceiling
 *   maxConsecutiveErrors?: number // bail after this many consecutive soft errors
 * }} [opts]
 * @returns {Promise<any|null>} the truthy result, or null on timeout/bailout
 */
export async function pollWhilePending(fn, {
  signal,
  deadline,
  maxMs = 180000,
  baseMs = 2000,
  maxIntervalMs = 6000,
  maxConsecutiveErrors = 6,
} = {}) {
  const start = Date.now();
  const hardStop = start + maxMs;
  const stopAt = (Number.isFinite(deadline) && deadline > start) ? Math.min(deadline, hardStop) : hardStop;
  const budget = Math.max(0, stopAt - start);

  // Internal controller so the wall-clock race can stop the loop, chained to
  // the caller's signal.
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  if (signal) {
    if (signal.aborted) inner.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const cleanup = () => signal?.removeEventListener('abort', onOuterAbort);

  const loop = async () => {
    let attempt = 0;
    let consecutiveErrors = 0;

    while (Date.now() < stopAt) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (inner.signal.aborted && !signal?.aborted) return null; // wall-clock cap won
      try {
        const result = await fn(inner.signal);
        if (result != null && result !== false) return result;
        consecutiveErrors = 0; // a clean "still pending" response
      } catch (err) {
        if (err?.name === 'AbortError') {
          if (signal?.aborted) throw err;
          return null; // our own wall-clock abort
        }
        if (isFatalError(err)) throw err;          // never going to work — surface it
        if (isPendingError(err)) consecutiveErrors = 0; // documented "payment pending"
        else {
          consecutiveErrors += 1;
          if (consecutiveErrors >= maxConsecutiveErrors) return null;
        }
      }
      attempt += 1;
      const remaining = stopAt - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(computeBackoff(attempt, baseMs, maxIntervalMs), remaining), inner.signal);
    }
    return null;
  };

  // The wall-clock arm resolves to null; it never rejects, so a hung request
  // degrades to "not yet" rather than to an error the user cannot act on.
  const wallClock = new Promise((resolve) => {
    const timer = setTimeout(() => { inner.abort(); resolve(null); }, budget + 250);
    inner.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });

  try {
    return await Promise.race([loop(), wallClock]);
  } finally {
    inner.abort();
    cleanup();
  }
}
