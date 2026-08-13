/**
 * HTTP transport for LNURL rails: lightning-address metadata
 * (.well-known/lnurlp), LNURL-pay invoice callbacks, LNURL-withdraw
 * callbacks, and LUD-21 verify polling.
 *
 * Why this exists: a large share of LNURL services never send
 * `Access-Control-Allow-Origin`, and some (pay.wave.space) actively 403
 * any request that carries an `Origin` header at all. The webview's
 * fetch always sends `Origin: https://localhost` on device, so those
 * services are unreachable from a plain fetch. On native we therefore
 * route through the `CapacitorHttp` plugin (the platform HTTP stack:
 * no Origin header, no CORS). On web we fall back to the browser fetch
 * and stay subject to each server's CORS policy, as any web wallet is.
 *
 * Deliberately NOT the global `CapacitorHttp.enabled` fetch patch: that
 * patch corrupts the Spark SDK's binary gRPC bodies and breaks the
 * Lightspark SSP auth handshake (see the history of
 * src-capacitor/capacitor.config.json), so it must stay off. This module
 * never touches window.fetch; it makes explicit plugin calls, which work
 * regardless of the `enabled` flag. Same pattern as utils/lud4.js.
 *
 * Kept dependency-light (lazy Capacitor import, no framework imports) so
 * it can be unit-tested under plain Node like the other utils.
 */

/** Cached '@capacitor/core' import; null when not running inside Capacitor. */
let capacitorModulePromise = null;

function loadCapacitor() {
  if (!capacitorModulePromise) {
    capacitorModulePromise = import('@capacitor/core').catch(() => null);
  }
  return capacitorModulePromise;
}

function makeAbortError(message) {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/**
 * Normalize a CapacitorHttp response into the minimal fetch-Response
 * surface the LNURL call sites use ({ ok, status, json() }). The plugin
 * auto-parses JSON bodies; when a service mislabels its content type the
 * body arrives as a string, so json() parses it the way Response.json()
 * would (and, like it, throws on an empty or non-JSON body).
 */
function wrapNativeResponse(response) {
  const status = Number(response?.status) || 0;
  const body = response?.data;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body && typeof body === 'object') return body;
      if (typeof body === 'string' && body.trim()) return JSON.parse(body);
      throw new Error('Empty or non-JSON response');
    },
  };
}

async function nativeGet(CapacitorHttp, url, { signal, timeoutMs } = {}) {
  if (signal?.aborted) throw makeAbortError('The request was aborted');

  // Always bound the native socket: the plugin can't cancel an in-flight
  // request, so without a read timeout a hung server would hold the
  // connection (and its thread) open indefinitely even after the JS side
  // gave up. Callers with their own budget pass timeoutMs; signal-only
  // callers (pollVerify) get the 30s default.
  const socketTimeoutMs = timeoutMs > 0 ? timeoutMs : 30000;
  const options = {
    url,
    headers: { Accept: 'application/json' },
    responseType: 'json',
    connectTimeout: socketTimeoutMs,
    readTimeout: socketTimeoutMs,
  };

  const request = CapacitorHttp.get(options);
  if (!signal) return wrapNativeResponse(await request);

  // The plugin can't cancel an in-flight native request, so honor the
  // signal by racing it: the caller gets a prompt AbortError and the
  // idempotent GET is left to finish (or time out) on its own.
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(makeAbortError('The request was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return wrapNativeResponse(await Promise.race([request, aborted]));
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * fetch-compatible GET for LNURL endpoints: native HTTP stack on device,
 * browser fetch on web. Resolves to a Response-like object ({ ok, status,
 * json() }); rejects on network failure or abort, like fetch. Suitable as
 * a `fetchImpl` for pollVerify.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]  timeoutMs
 *   only bounds the native socket; on web, timeouts belong to the caller's
 *   signal (see lnurlGetJson).
 */
export async function lnurlFetch(url, opts = {}) {
  const cap = await loadCapacitor();
  if (cap?.Capacitor?.isNativePlatform?.() && cap.CapacitorHttp) {
    return nativeGet(cap.CapacitorHttp, url, opts);
  }
  return fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

/**
 * GET an LNURL endpoint and read its JSON body, bounded by a timeout.
 *
 * Mirrors the call sites' historical `fetch` + `response.json()` pair:
 * HTTP error statuses resolve (ok: false) so each caller keeps its own
 * error copy; only transport failures reject. An unreadable body yields
 * `data: null` rather than a parse throw, so callers guard `!data`.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: object|null }>}
 * @throws {Error} network failure, or an AbortError-named 'The server did
 *   not respond in time' on timeout
 */
export async function lnurlGetJson(url, { timeoutMs = 30000 } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await lnurlFetch(url, {
      ...(controller ? { signal: controller.signal } : {}),
      timeoutMs,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (data && typeof data !== 'object') data = null;
    return { ok: !!response.ok, status: Number(response.status) || 0, data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeAbortError('The server did not respond in time');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
