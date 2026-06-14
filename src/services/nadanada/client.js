/**
 * nadanada (formerly LNVPN) API client — shared HTTP plumbing for the
 * in-app store. nadanada sells no-account privacy products (eSIM data
 * plans, WireGuard VPN) paid with Bitcoin Lightning.
 *
 * This module is intentionally pure of store/Pinia imports so the service
 * layer stays unit-testable. The cross-store wiring (paying the invoice,
 * persisting the purchase) lives in the shop components and the
 * `nadanadaPurchases` store.
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
 * API shape verified against the live v2 endpoints. No API key is required
 * for catalog or purchase.
 *   GET  {BASE}/esim/countries
 *   GET  {BASE}/esim/bundles?country=XX | ?region=slug
 *   POST {BASE}/esim/purchase  { bundleName, slug, refCode } -> invoice
 *   POST {BASE}/esim/complete  { paymentHash }               -> { iccid, installationDetails }
 *   GET  {BASE}/vpn/countries
 *   POST {BASE}/vpn/request    { duration, refCode }         -> invoice
 *   POST {BASE}/vpn/config     { paymentHash, country, publicKey, presharedKey } -> .conf text
 *
 * Docs: https://nadanada.me/api/v2/documentation
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
 * commission accrues to BuhoGO (VPN 15%, eSIM 10%). A single app-wide code —
 * NOT per-user — and intentionally invisible to the user. Earnings are
 * monitored out-of-band via the partner API; the app never surfaces a balance.
 *
 * BuhoGO's real partner code is BUHOGO (nadanada.me?ref=BUHOGO).
 * TODO(ops): move to remote config so it can rotate without an app release.
 */
export const NADANADA_REF_CODE = 'BUHOGO';

/** Network timeout for a single request. */
const REQUEST_TIMEOUT_MS = 15000;

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

function errorMessageFrom(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    try {
      const j = JSON.parse(payload);
      return j.error || j.message || j.detail || payload.slice(0, 200);
    } catch { return payload.slice(0, 200); }
  }
  return payload.error || payload.message || payload.detail || null;
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
    res = await CapacitorHttp.request({
      url,
      method,
      headers: jsonHeaders(!!body),
      data: body || undefined,
      responseType: raw ? 'text' : 'json',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch (e) {
    throw new Error(`nadanada ${method} ${url} failed: ${e?.message || 'network error'}`);
  }

  const status = res.status;
  if (status < 200 || status >= 300) {
    const err = new Error(errorMessageFrom(res.data) || `nadanada ${method} failed: HTTP ${status}`);
    err.status = status;
    throw err;
  }

  if (raw) return typeof res.data === 'string' ? res.data : String(res.data ?? '');

  // CapacitorHttp parses JSON when responseType is 'json'; tolerate a string.
  let data = res.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* leave as-is */ }
  }
  if (data && data.success === false) {
    const err = new Error(data.error || data.message || 'nadanada returned success:false');
    err.status = status;
    throw err;
  }
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
      const err = new Error(errorMessageFrom(text) || `nadanada ${method} ${url} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (raw) return res.text();
    const data = await res.json();
    if (data && data.success === false) {
      const err = new Error(data.error || data.message || `nadanada ${url} returned success:false`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    cleanup();
  }
}

/**
 * Core request. Dispatches to the native or web transport. Throws an Error
 * with `.status` set on any non-2xx (so the poll helpers can special-case 402
 * "payment not confirmed yet") and on a JSON `success:false` envelope.
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

/** GET helper. Returns the parsed envelope; callers pick `.data` themselves
 *  because the action endpoints are flat while the catalog endpoints nest. */
export function nadanadaGet(path, opts = {}) {
  return request('GET', path, opts);
}

/** POST helper. Pass `{ raw: true }` for `/vpn/config`, which returns the
 *  WireGuard config as `text/plain` rather than JSON. */
export function nadanadaPost(path, body, opts = {}) {
  return request('POST', path, { ...opts, body });
}

// ── Polling (settlement / fulfilment) ────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with symmetric +/-20% jitter, capped. Keeps us polite to
 *  the API instead of hammering a fixed interval, and de-synchronises retries. */
function computeBackoff(attempt, baseMs, maxIntervalMs) {
  const base = Math.min(baseMs * Math.pow(1.6, attempt - 1), maxIntervalMs);
  return base * (1 + (Math.random() - 0.5) * 0.4); // [base*0.8, base*1.2)
}

/**
 * Poll a fulfilment step until it succeeds, the deadline passes, or the
 * endpoint fails persistently. nadanada signals "payment not confirmed yet"
 * with HTTP 402, which is expected and never counts as an error here. The poll
 * backs off, honours the invoice expiry (no point polling a dead invoice), is
 * abortable (closing the sheet stops it), and bails out early if a non-402
 * error repeats — so a real outage doesn't get hammered for the full window.
 *
 * @param {(signal?: AbortSignal) => Promise<any>} fn — resolves to a truthy
 *   result on success, or null/false while still pending; may throw (402 ->
 *   pending, other -> counts toward the error bailout).
 * @param {{
 *   signal?: AbortSignal,
 *   deadline?: number,            // epoch ms (invoice expiry) — stop polling after
 *   maxMs?: number,               // hard fallback cap
 *   baseMs?: number,              // first backoff interval
 *   maxIntervalMs?: number,       // backoff ceiling
 *   maxConsecutiveErrors?: number // bail after this many consecutive non-402 errors
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

  let attempt = 0;
  let consecutiveErrors = 0;

  while (Date.now() < stopAt) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const result = await fn(signal);
      if (result != null && result !== false) return result;
      consecutiveErrors = 0; // a clean "still pending" response
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.status === 402) {
        consecutiveErrors = 0; // documented "payment pending" signal
      } else {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) return null;
      }
    }
    attempt += 1;
    const remaining = stopAt - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(computeBackoff(attempt, baseMs, maxIntervalMs), remaining));
  }
  return null;
}
