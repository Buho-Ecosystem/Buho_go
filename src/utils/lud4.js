/**
 * LUD-04 (LNURL-auth) — wire-level helpers.
 *
 * Decodes incoming `lnurl1` (bech32) and `keyauth://` URIs into the shape
 * needed by the auth dialog, and turns a signed challenge into the GET
 * request the service expects on its callback.
 *
 * The crypto lives in `./identityCrypto.js`; this file is purely about
 * parsing strings, fetching URLs, and surfacing errors in a form the UI
 * can show.
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/04.md
 */

import { bech32 } from 'bech32';
import { bytesToHex, hexToBytes } from './identityCrypto.js';

/**
 * Valid LUD-04 actions. `register`, `login`, `link`, `auth` are the only
 * values the spec defines; anything else we treat as `login` so a buggy
 * service can't dead-end us.
 */
export const LUD04_ACTIONS = Object.freeze(['register', 'login', 'link', 'auth']);
const DEFAULT_ACTION = 'login';

/**
 * Decode any of the LUD-04 input forms into a plain HTTPS URL that the
 * caller can fetch (or, for `tag=login`, parse directly).
 *
 * Accepts:
 *   - `lightning:lnurl1...` / `lnurl1...`                (LUD-01 bech32)
 *   - `keyauth://example.com/...?k1=...&tag=login`        (LUD-17 scheme)
 *   - `lnurla://...` and `lnurl://...` (rare aliases — tolerated)
 *
 * @param {string} input
 * @returns {string}      The decoded `https://...` URL.
 * @throws {Error}        If the input is not a recognised LUD-04 carrier.
 */
export function decodeLnurlAuthInput(input) {
  if (typeof input !== 'string') {
    throw new TypeError('LNURL-auth input must be a string');
  }
  let value = input.trim();
  // The `lightning:` BIP-21 wrapper is allowed in front of any LUD-17 URI.
  if (value.toLowerCase().startsWith('lightning:')) {
    value = value.slice('lightning:'.length);
  }

  const lower = value.toLowerCase();

  // LUD-17 schemes simply rewrite the scheme to https://. Anything after is
  // a literal URL — query parameters carry `k1`, `tag`, optional `action`.
  if (lower.startsWith('keyauth://')) {
    return 'https://' + value.slice('keyauth://'.length);
  }
  if (lower.startsWith('lnurla://')) {
    return 'https://' + value.slice('lnurla://'.length);
  }

  // bech32 form — `lnurl1...`. Use the maximum length that vetted LNURLs in
  // the wild can reach (caps at 4096 — the original spec said 1023 but real
  // services routinely exceed that). bech32@2.0 accepts an explicit cap.
  // We require the `1` separator so other LUD-17 schemes (lnurlp://, lnurlw://)
  // don't accidentally match the prefix check.
  if (lower.startsWith('lnurl1')) {
    const decoded = bech32.decode(value, 4096);
    if (decoded.prefix.toLowerCase() !== 'lnurl') {
      throw new Error(`Unexpected bech32 prefix: ${decoded.prefix}`);
    }
    const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  throw new Error('Not a LUD-04 input');
}

/**
 * Parse a decoded HTTPS URL into the structured shape the auth dialog
 * needs: domain, k1, action, plus the full URL preserved for the callback.
 *
 * Throws if any required parameter is missing or malformed — services
 * occasionally hand out incomplete URLs and we'd rather refuse than sign a
 * nonce we can't bind to a domain.
 *
 * @param {string} url
 * @returns {{
 *   url:    URL,
 *   domain: string,
 *   k1:     Uint8Array,
 *   k1Hex:  string,
 *   tag:    string,
 *   action: 'register' | 'login' | 'link' | 'auth',
 * }}
 */
export function parseLud04Url(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('LNURL-auth URL is not a valid URL');
  }

  // LUD-04 is an authentication protocol — the signature is domain-bound,
  // but the callback round-trip itself must run over TLS. A malicious or
  // downgraded `http:` link would let an on-path attacker swap challenges
  // and read the response. No localhost exception: dev environments use
  // HTTPS (self-signed / ngrok / mkcert) the same as production.
  if (parsed.protocol !== 'https:') {
    const err = new Error(`LNURL-auth requires HTTPS (got ${parsed.protocol})`);
    err.code = 'LUD04_INSECURE_SCHEME';
    throw err;
  }

  const params = parsed.searchParams;
  const tag = params.get('tag');
  const k1Hex = params.get('k1');
  const rawAction = params.get('action');

  if (tag !== 'login') {
    throw new Error(`Not a LUD-04 login request (tag=${tag ?? 'none'})`);
  }
  if (!k1Hex) {
    throw new Error('LNURL-auth URL is missing the k1 challenge');
  }

  let k1;
  try {
    k1 = hexToBytes(k1Hex);
  } catch {
    throw new Error('k1 challenge is not valid hex');
  }
  if (k1.length !== 32) {
    throw new Error(`k1 challenge must be 32 bytes, got ${k1.length}`);
  }

  const action = LUD04_ACTIONS.includes(rawAction) ? rawAction : DEFAULT_ACTION;

  return {
    url: parsed,
    domain: parsed.hostname.toLowerCase(),
    k1,
    k1Hex: bytesToHex(k1),
    tag,
    action,
  };
}

/**
 * Convenience: decode an LNURL-auth input string and parse it in one step.
 * @param {string} input
 */
export function parseLud04Input(input) {
  return parseLud04Url(decodeLnurlAuthInput(input));
}

/**
 * Test whether an arbitrary string looks like a LUD-04 carrier without
 * paying the cost of bech32 decoding. Used by the scanner dispatch.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function looksLikeLud04(input) {
  if (typeof input !== 'string') return false;
  let v = input.trim().toLowerCase();
  if (v.startsWith('lightning:')) v = v.slice('lightning:'.length);
  if (v.startsWith('keyauth://') || v.startsWith('lnurla://')) return true;
  // bech32 lnurl1 might be pay/withdraw/channel — we can only tell after
  // decoding. Return `maybe` so the dispatcher fully decodes once.
  return v.startsWith('lnurl1');
}

/**
 * Build the LUD-04 callback URL with the user's signature and public key
 * appended to the existing query string. The service decides login vs
 * register vs link vs auth — we just send the proof.
 *
 * @param {URL}        originalUrl - The decoded URL from parseLud04Url
 * @param {Uint8Array} sigDer      - DER-encoded ECDSA signature
 * @param {Uint8Array} linkingPub  - Compressed secp256k1 public key (33 bytes)
 * @returns {string}               - Absolute URL ready to fetch
 */
export function buildLud04Callback(originalUrl, sigDer, linkingPub) {
  const url = new URL(originalUrl.toString());
  url.searchParams.set('sig', bytesToHex(sigDer));
  url.searchParams.set('key', bytesToHex(linkingPub));
  return url.toString();
}

/**
 * GET the LUD-04 callback with the proof in the query string and parse
 * the spec-defined `{status: "OK" | "ERROR", reason?: string}` envelope.
 *
 * Transport selection:
 *
 *   - Native (Capacitor iOS/Android): we route through `CapacitorHttp`,
 *     which uses the platform's native HTTP stack and bypasses CORS
 *     entirely. This is the production path and is what makes BuhoGO
 *     compatible with the long tail of LUD-04 services (Bitrefill,
 *     stacker.news, ...) that do not set `Access-Control-Allow-Origin`.
 *
 *   - Web (dev or PWA): the browser enforces CORS. Most LNURL-auth
 *     services do not opt into cross-origin reads, so a "successful"
 *     login on the server side will still surface as
 *     `TypeError: Failed to fetch` in JS. We detect that exact shape
 *     and report a soft failure with a `corsBlocked` flag so the UI
 *     can explain it honestly ("we sent the login — your browser
 *     wouldn't let us read the confirmation; check the site to see
 *     if you're signed in").
 *
 * @param {string} callbackUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, corsBlocked?: boolean }>}
 */
export async function submitLud04Callback(callbackUrl, { timeoutMs = 15000 } = {}) {
  // Lazy-import to avoid pulling Capacitor into web-only test environments
  // (the unit tests run under plain Node).
  let CapacitorHttp = null;
  let isNative = false;
  try {
    // eslint-disable-next-line import/no-unresolved
    const cap = await import('@capacitor/core');
    if (cap?.Capacitor?.isNativePlatform?.()) {
      isNative = true;
      CapacitorHttp = cap.CapacitorHttp;
    }
  } catch {
    // Not running inside Capacitor — fine, fall through to fetch.
  }

  if (isNative && CapacitorHttp) {
    return submitViaCapacitorHttp(CapacitorHttp, callbackUrl, timeoutMs);
  }
  return submitViaBrowserFetch(callbackUrl, timeoutMs);
}

async function submitViaCapacitorHttp(CapacitorHttp, callbackUrl, timeoutMs) {
  try {
    const response = await Promise.race([
      CapacitorHttp.get({
        url: callbackUrl,
        headers: { Accept: 'application/json' },
        // The plugin auto-parses JSON responses; `responseType: 'json'` is
        // not strictly required but makes the intent explicit.
        responseType: 'json',
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(makeAbortError()), timeoutMs),
      ),
    ]);

    return interpretEnvelope(response?.data, response?.status);
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'The site did not respond in time' };
    }
    return { ok: false, reason: err?.message || 'Could not reach the site' };
  }
}

async function submitViaBrowserFetch(callbackUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(callbackUrl, {
      method: 'GET',
      signal: controller.signal,
      // Some LNURL services blow up on `Accept: text/html` defaults; pin
      // it explicitly so we always get the JSON envelope they're meant to
      // return.
      headers: { Accept: 'application/json' },
    });

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: `Server returned ${response.status} ${response.statusText}` };
    }

    return interpretEnvelope(body, response.status);
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'The site did not respond in time' };
    }
    // Distinguish CORS rejection from a real network failure. Chromium and
    // Firefox both surface CORS-blocked responses as a TypeError with
    // exactly "Failed to fetch" as the message; Safari uses "Load
    // failed". We can't tell here whether the server actually accepted
    // the login, but it usually did — the server-side verify ran before
    // the browser refused to expose the response body. The UI takes the
    // hint and shows an honest "we couldn't confirm" message.
    if (err instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(err.message || '')) {
      // `corsBlocked` lets the UI treat this as a soft success: in this
      // case the server already saw the GET (and almost certainly
      // accepted the signature) — the browser merely refused to expose
      // the response body to JS. We surface no user-facing reason here;
      // the dialog renders a localized "you're probably signed in"
      // success state when it sees this flag.
      return {
        ok: false,
        corsBlocked: true,
      };
    }
    return { ok: false, reason: err.message || 'Could not reach the site' };
  } finally {
    clearTimeout(timer);
  }
}

function interpretEnvelope(body, httpStatus) {
  if (body?.status === 'OK') return { ok: true };
  if (body?.status === 'ERROR') {
    return { ok: false, reason: body.reason || 'The site rejected the login' };
  }
  if (typeof httpStatus === 'number' && (httpStatus < 200 || httpStatus >= 300)) {
    return { ok: false, reason: `Server returned ${httpStatus}` };
  }
  return { ok: false, reason: 'Unexpected response from the site' };
}

function makeAbortError() {
  const err = new Error('Request timed out');
  err.name = 'AbortError';
  return err;
}
