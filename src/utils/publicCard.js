/**
 * Pure helpers for the public card page (issue #301).
 *
 * Kept free of Vue, Quasar and Capacitor so they run under plain `node`:
 * the page itself boots the whole wallet, which a unit test cannot.
 */

import { BUHOGO_HOME, KEY_PARAM, PROFILE_PATH, PUBLIC_WEB_ORIGIN, isKey } from './profileLink.js';

/** Must match `applicationId` in src-capacitor/android/app/build.gradle. */
export const APP_PACKAGE = 'mybuho.buhogo';

/**
 * The canonical https link for a card, as the App Link filter expects it.
 *
 * Always on the production origin, whatever origin the page is served from:
 * the Android filter only claims go.mybuho.de/p/, so an intent pointing at a
 * preview or localhost host would match nothing.
 *
 * @param {string} slug  the `:id` route param (already decoded)
 * @param {string} [key] optional fallback key (`k`)
 */
export function cardUrl(slug, key = '') {
  const value = String(slug || '').trim();
  if (!value) return '';
  const url = `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}${encodeURIComponent(value)}`;
  const k = String(key || '').trim();
  if (!k || !isKey(k) || k === value) return url;
  return `${url}?${KEY_PARAM}=${encodeURIComponent(k)}`;
}

/**
 * An Android intent link that opens a card in BuhoGO.
 *
 * Chrome resolves `intent://` with an explicit package straight to the app
 * when it is installed, which works even while App Link verification is
 * still failing (the assetlinks fingerprints). When BuhoGO is not installed,
 * Chrome follows `S.browser_fallback_url` instead, so the tap never dead-ends.
 *
 * @param {string} httpsUrl  the card link, e.g. from `cardUrl`
 * @param {{ fallbackUrl?: string, packageName?: string }} [opts]
 * @returns {string} intent URL, or '' for anything that is not an https/http URL
 */
export function buildAppHandoffUrl(httpsUrl, { fallbackUrl = BUHOGO_HOME, packageName = APP_PACKAGE } = {}) {
  let url;
  try {
    url = new URL(String(httpsUrl || '').trim());
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';

  const scheme = url.protocol.slice(0, -1);
  const parts = [`scheme=${scheme}`, `package=${packageName}`];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;${parts.join(';')};end`;
}

/**
 * True on an Android browser, where an intent link can hand off to the app.
 * iOS and desktop browsers ignore `intent://` (it is a dead tap there).
 *
 * @param {string} userAgent
 */
export function isAndroidBrowser(userAgent) {
  return /\bAndroid\b/i.test(String(userAgent || ''));
}

/**
 * Is the visitor the owner of this card?
 *
 * Compared on the hex pubkey first (both nprofile and npub links resolve to
 * it), then on the npub as a fallback for an identity that only kept that.
 *
 * @param {{ pubkey?: string, npub?: string }} card  the resolved card
 * @param {{ nostrPubkeyHex?: string|null, nostrNpub?: string|null }} identity
 */
export function isOwnCard(card, identity) {
  const lower = (v) => String(v || '').trim().toLowerCase();
  const cardHex = lower(card?.pubkey);
  const ownHex = lower(identity?.nostrPubkeyHex);
  if (cardHex && ownHex) return cardHex === ownHex;
  const cardNpub = lower(card?.npub);
  const ownNpub = lower(identity?.nostrNpub);
  return !!cardNpub && cardNpub === ownNpub;
}

/**
 * The clean `/p/…` address for a hash-routed card URL.
 *
 * The router lives in the hash, so after the index.html shim a visitor sees
 * `go.mybuho.de/#/p/npub…`. That is what they copy, and an App Link can never
 * match it (its path is `/`). Returns the path to put in the address bar, or
 * '' when the hash is not a card route.
 *
 * @param {string} hash  `window.location.hash`
 */
export function cleanCardAddress(hash) {
  const value = String(hash || '');
  if (!value.startsWith(`#${PROFILE_PATH}`)) return '';
  const path = value.slice(1);
  const slug = path.slice(PROFILE_PATH.length).split(/[?#]/)[0];
  return slug ? path : '';
}

/**
 * The hash form for a clean card address, which is what the router reads.
 * Used to put the address back before navigating away or going back to it.
 *
 * @param {string} pathname  `window.location.pathname`
 * @param {string} search    `window.location.search`
 * @param {string} hash      `window.location.hash`
 * @returns {string} `/#/p/…`, or '' when no restore is needed
 */
export function hashCardAddress(pathname, search, hash) {
  const path = String(pathname || '');
  if (!path.startsWith(PROFILE_PATH) || hash) return '';
  return `/#${path}${search || ''}`;
}
