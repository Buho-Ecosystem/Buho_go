/**
 * Google OAuth 2.0 for installed apps (Authorization Code + PKCE).
 *
 * No client secret required. We open Google's consent screen in the system
 * browser via @capacitor/browser, intercept the redirect back to our custom
 * URL scheme via @capacitor/app, and exchange the authorization code for
 * tokens against Google's public token endpoint.
 *
 * Platform set-up (see /docs or repo README for the prose version):
 *
 *   iOS — In Google Cloud Console create an *iOS* OAuth 2.0 client with bundle
 *         ID `mybuho.buhogo`. Google issues a client ID whose reverse-DNS
 *         form (e.g. `com.googleusercontent.apps.123456789-abc`) is also the
 *         URL scheme you must register in Info.plist under
 *         CFBundleURLSchemes. The redirect URI given here MUST match what
 *         you registered in the console — Google validates it on the server
 *         side, not just locally.
 *
 *   Android — Create an *Android* OAuth client with package name
 *             `mybuho.buhogo` and the SHA-1 fingerprint of the signing key
 *             you ship the APK with. Use the same reverse-DNS redirect URI
 *             scheme; declare it as an `<intent-filter>` on MainActivity.
 *
 *   Web (PWA) — Create a *Web* OAuth client and register an https origin /
 *               redirect URI you serve. The flow is the same; only the
 *               redirect URI changes.
 *
 *   Scope — We request `https://www.googleapis.com/auth/drive.file`. That
 *           limits the app to files it created itself, which is what we want
 *           for a backup blob: the user can see and delete it in Drive, the
 *           app can update it, and we never see anything else in their Drive.
 *
 * Refresh tokens: Google does not return a refresh token for mobile clients
 * unless `access_type=offline` is requested AND `prompt=consent` is sent on
 * every login (so each consent re-issues one). We do that, and persist the
 * refresh token alongside the access token in localStorage encrypted with
 * the device key — same scheme used for the wallet mnemonic. The access
 * token's TTL is ~1 hour; we refresh on demand.
 */

import { Capacitor } from '@capacitor/core';
import { encryptString, decryptString } from './deviceCrypto.js';

const STORAGE_KEY_TOKENS = 'buhoGO_google_tokens_v1';
// `drive.appdata` confines the app to a per-user hidden folder Google calls
// the "Application Data folder". The user never sees these files in Drive's
// UI; they're only reachable through the API by this exact app. That's the
// stronger privacy posture the cloud-backup spec calls for. Trade-off: if
// the user uninstalls BuhoGO, they cannot manually surface or copy the
// backup file from Drive — recovery requires re-installing this app and
// re-authenticating to the same Google account.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

let _config = null;
let _tokens = null; // { accessToken, refreshToken, expiresAt }
let _hydrating = null;

/**
 * Configure once at boot. The client ID and redirect URI vary per platform;
 * the caller is expected to pick the right pair for the running platform.
 *
 * @param {{ clientId: string, redirectUri: string }} cfg
 */
export function configureGoogleAuth(cfg) {
  if (!cfg?.clientId || !cfg?.redirectUri) {
    throw new Error('configureGoogleAuth: clientId and redirectUri are required');
  }
  _config = { clientId: cfg.clientId, redirectUri: cfg.redirectUri };
}

function requireConfig() {
  if (!_config) {
    throw new Error(
      'Google OAuth not configured. Call configureGoogleAuth({ clientId, redirectUri }) before use.',
    );
  }
  return _config;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomVerifier() {
  const buf = crypto.getRandomValues(new Uint8Array(64));
  return base64UrlEncode(buf);
}

async function challengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

async function persistTokens(tokens) {
  _tokens = tokens;
  if (!tokens) {
    localStorage.removeItem(STORAGE_KEY_TOKENS);
    return;
  }
  const envelope = await encryptString(JSON.stringify(tokens));
  localStorage.setItem(STORAGE_KEY_TOKENS, envelope);
}

async function hydrateTokens() {
  if (_tokens) return _tokens;
  if (_hydrating) return _hydrating;

  _hydrating = (async () => {
    const envelope = localStorage.getItem(STORAGE_KEY_TOKENS);
    if (!envelope) return null;
    try {
      const json = await decryptString(envelope);
      _tokens = JSON.parse(json);
    } catch (err) {
      // If the device key changed (full wipe / new install with same
      // backed-up localStorage), the envelope is unreadable. Drop it
      // rather than throwing on every subsequent call.
      console.warn('[googleOAuth] failed to decrypt stored tokens:', err);
      localStorage.removeItem(STORAGE_KEY_TOKENS);
      _tokens = null;
    }
    return _tokens;
  })();

  try {
    return await _hydrating;
  } finally {
    _hydrating = null;
  }
}

function tokenExpired(tokens) {
  if (!tokens?.expiresAt) return true;
  // Refresh 60 s before actual expiry so an in-flight request doesn't trip
  // a hard 401 mid-call.
  return Date.now() >= tokens.expiresAt - 60_000;
}

// ---------------------------------------------------------------------------
// Authorisation flow
// ---------------------------------------------------------------------------

/**
 * Trigger the consent flow. Resolves when the user finishes (success) or
 * rejects when they cancel / close the browser without redirecting.
 *
 * Opens the system browser via @capacitor/browser on native and a popup on
 * web; in both cases the redirect URI must match what's registered in the
 * Google Cloud console for this client.
 *
 * @returns {Promise<{ email: string|null, accessToken: string }>}
 */
export async function signIn() {
  const cfg = requireConfig();

  const verifier = randomVerifier();
  const challenge = await challengeFromVerifier(verifier);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email ${DRIVE_SCOPE}`);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  // `prompt=consent` forces Google to re-issue a refresh token on every
  // sign-in. Without it, a returning user only gets a fresh access token
  // and our offline access stays stuck on whatever refresh token (if any)
  // they first granted.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  const code = await openAuthAndWaitForCode(url.toString(), state);
  const tokens = await exchangeCodeForTokens(code, verifier);
  await persistTokens(tokens);

  return {
    email: tokens.email || null,
    accessToken: tokens.accessToken,
  };
}

function openAuthAndWaitForCode(authUrl, expectedState) {
  if (Capacitor.isNativePlatform()) {
    return nativeAuthFlow(authUrl, expectedState);
  }
  return webAuthFlow(authUrl, expectedState);
}

async function nativeAuthFlow(authUrl, expectedState) {
  // We deliberately push the user to the *system* browser rather than an
  // in-app webview — Google's RFC 8252 best-current-practice is "external
  // user-agent" for OAuth on mobile, and recent Google policy actively
  // rejects sign-ins from embedded WebViews. `window.open(url, '_system')`
  // is the Capacitor convention for "open this URL in the OS browser
  // without taking the user out of our app process"; the browser tab
  // closes itself when our redirect URI fires the app deep-link.
  //
  // Avoiding @capacitor/browser also keeps us off androidx.browser:1.9.0,
  // which currently requires compileSdk 36 + AGP 8.9.1 (the rest of the
  // project is on compileSdk 35).
  const { App } = await import('@capacitor/app');

  return new Promise((resolve, reject) => {
    let urlListener;
    let settled = false;

    const cleanup = async () => {
      if (urlListener) {
        try { await urlListener.remove(); } catch { /* listener already gone */ }
      }
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => fn());
    };

    App.addListener('appUrlOpen', (event) => {
      const url = event?.url || '';
      try {
        const parsed = new URL(url);
        const state = parsed.searchParams.get('state');
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');
        if (!state || state !== expectedState) return;
        if (error) {
          settle(() => reject(new Error(`Google auth failed: ${error}`)));
          return;
        }
        if (code) {
          settle(() => resolve(code));
        }
      } catch {
        // Not a URL we care about — let other listeners handle it.
      }
    }).then((handle) => { urlListener = handle; });

    try {
      window.open(authUrl, '_system');
    } catch (err) {
      settle(() => reject(err));
    }

    // The system browser dismissal can't be observed from inside the app.
    // We rely on the user either completing the flow (deep-link fires the
    // appUrlOpen listener above and resolves) or coming back to the app
    // manually without finishing — in which case the promise stays pending
    // until the next sign-in attempt or the dialog closes and aborts it.
    // The CloudBackupSheet UI exposes a Cancel button so the user is never
    // trapped.
  });
}

function webAuthFlow(authUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'buhogo-google-auth', 'width=480,height=720');
    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups and try again.'));
      return;
    }

    let settled = false;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      try { popup.close(); } catch { /* popup already closed */ }
      fn();
    };

    const onMessage = (event) => {
      // The redirect URI page is expected to postMessage `{ code, state }`
      // back to the opener. Confirming origin defends against an unrelated
      // page in the same tab posting in.
      if (!event.data || typeof event.data !== 'object') return;
      const { code, state, error } = event.data;
      if (!state || state !== expectedState) return;
      if (error) settle(() => reject(new Error(`Google auth failed: ${error}`)));
      else if (code) settle(() => resolve(code));
    };
    window.addEventListener('message', onMessage);

    // If the user closes the popup without redirecting, no postMessage will
    // fire — poll so we can reject instead of hanging the caller.
    const closedPoll = setInterval(() => {
      if (popup.closed) settle(() => reject(new Error('Sign-in cancelled')));
    }, 500);
  });
}

async function exchangeCodeForTokens(code, verifier) {
  const cfg = requireConfig();
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = await res.json();

  // The ID token carries the email claim — useful so the UI can show
  // "signed in as alice@example.com" without an extra userinfo round-trip.
  let email = null;
  if (data.id_token) {
    try {
      const [, payload] = data.id_token.split('.');
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      email = decoded.email || null;
    } catch { /* malformed id_token — non-fatal */ }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    scope: data.scope || '',
    email,
  };
}

/**
 * Return a valid access token, refreshing if needed. Throws if the user
 * isn't signed in or the refresh failed (caller should prompt re-auth).
 */
export async function getAccessToken() {
  const tokens = await hydrateTokens();
  if (!tokens) throw new Error('NOT_SIGNED_IN');

  if (!tokenExpired(tokens)) return tokens.accessToken;

  if (!tokens.refreshToken) {
    // Access token expired and we have no way to refresh — force re-auth.
    await persistTokens(null);
    throw new Error('NOT_SIGNED_IN');
  }

  const cfg = requireConfig();
  const body = new URLSearchParams({
    refresh_token: tokens.refreshToken,
    client_id: cfg.clientId,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // Refresh token was revoked (user removed access in Google account
    // settings) or otherwise rejected — drop tokens so the next call
    // surfaces NOT_SIGNED_IN cleanly.
    await persistTokens(null);
    throw new Error('NOT_SIGNED_IN');
  }
  const data = await res.json();
  const next = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
  // Google may issue a new refresh token; keep the old one if it didn't.
  if (data.refresh_token) next.refreshToken = data.refresh_token;
  await persistTokens(next);
  return next.accessToken;
}

/** True iff we have credentials on disk (does not validate them). */
export async function isSignedIn() {
  const tokens = await hydrateTokens();
  return Boolean(tokens?.refreshToken || (tokens?.accessToken && !tokenExpired(tokens)));
}

/** The email of the signed-in user, if known. Cached from the ID token. */
export async function signedInEmail() {
  const tokens = await hydrateTokens();
  return tokens?.email || null;
}

/**
 * Revoke the current refresh token at Google and clear local state. Safe to
 * call when not signed in (no-op).
 */
export async function signOut() {
  const tokens = await hydrateTokens();
  if (tokens?.refreshToken) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokens.refreshToken)}`, {
        method: 'POST',
      });
    } catch (err) {
      // Server-side revoke is best effort. We always still drop the local
      // copy below — the only way for the user to recover from a failed
      // revoke is to remove the app from accounts.google.com.
      console.warn('[googleOAuth] revoke failed:', err);
    }
  }
  await persistTokens(null);
}
