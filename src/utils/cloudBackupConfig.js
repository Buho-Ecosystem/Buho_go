/**
 * Per-platform Google OAuth client IDs.
 *
 * Each platform needs its own OAuth client in the Google Cloud Console
 * because the redirect-URI rules are different:
 *
 *   iOS      — "iOS" client. Redirect URI is the reverse-DNS form of the
 *              client ID with `:/oauth2redirect` suffix. The matching
 *              URL scheme MUST be declared in src-capacitor/ios/App/App/Info.plist
 *              under CFBundleURLSchemes.
 *
 *   Android  — "Android" client tied to package name + signing-cert SHA-1.
 *              Same reverse-DNS redirect URI; declare the scheme in the
 *              manifest as an <intent-filter> on MainActivity.
 *
 *   Web      — "Web" client. Redirect URI must be a real HTTPS URL you
 *              control. The PWA build of this app should serve a small
 *              static page at that URL whose only job is to postMessage
 *              { code, state } back to window.opener (see /public/oauth.html
 *              if/when you ship the PWA build).
 *
 * Values are read from Vite env vars so they can differ between dev and
 * production without touching code. Set them in `.env.local` (gitignored)
 * for local builds and through your CI environment for releases.
 *
 *   VITE_GOOGLE_OAUTH_IOS_CLIENT_ID
 *   VITE_GOOGLE_OAUTH_IOS_REDIRECT_URI
 *   VITE_GOOGLE_OAUTH_ANDROID_CLIENT_ID
 *   VITE_GOOGLE_OAUTH_ANDROID_REDIRECT_URI
 *   VITE_GOOGLE_OAUTH_WEB_CLIENT_ID
 *   VITE_GOOGLE_OAUTH_WEB_REDIRECT_URI
 *
 * If a platform's variables are missing the cloud-backup feature will be
 * disabled in the UI rather than crashing — `isCloudBackupConfigured()`
 * surfaces that to call sites.
 */

import { Capacitor } from '@capacitor/core';

function envValue(key) {
  // Quasar/Vite exposes env vars on import.meta.env at build time. We read
  // through a helper so the lookup is centralised — if the project ever
  // moves to a different env-injection mechanism it changes here only.
  try {
    return import.meta.env?.[key] || '';
  } catch {
    return '';
  }
}

function resolveConfig() {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') {
    return {
      clientId: envValue('VITE_GOOGLE_OAUTH_IOS_CLIENT_ID'),
      redirectUri: envValue('VITE_GOOGLE_OAUTH_IOS_REDIRECT_URI'),
    };
  }
  if (platform === 'android') {
    return {
      clientId: envValue('VITE_GOOGLE_OAUTH_ANDROID_CLIENT_ID'),
      redirectUri: envValue('VITE_GOOGLE_OAUTH_ANDROID_REDIRECT_URI'),
    };
  }
  return {
    clientId: envValue('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID'),
    redirectUri: envValue('VITE_GOOGLE_OAUTH_WEB_REDIRECT_URI'),
  };
}

export function getCloudBackupConfig() {
  return resolveConfig();
}

export function isCloudBackupConfigured() {
  const { clientId, redirectUri } = resolveConfig();
  return Boolean(clientId && redirectUri);
}
