/**
 * Public profile links.
 *
 * When someone hands out their card in person the code on the back is enough:
 * both phones have BuhoGO and the `nostr:` URI does the rest. A link is the
 * opposite situation. It lands in a chat, and whoever opens it very likely
 * has no BuhoGO, no Nostr client, and no idea what an npub is. Handing that
 * person a raw `nostr:` URI or a third-party viewer is a dead end.
 *
 * So a shared link points at a page BuhoGO owns, which can meet the visitor
 * where they are: show who this is, let them pay, and offer the app if they
 * want to keep the person as a contact.
 *
 * Shape:
 *
 *     https://go.mybuho.de/p/maria?k=npub1…
 *
 * The username leads because it is readable and sayable, and because it
 * survives a key change. Resolving it needs NIP-05, which is a network call
 * to the username's domain and can fail: the domain can be down, or slow, or
 * the record can be gone. The key rides along in `k` purely as the fallback,
 * so the page still resolves when the lookup does not. A link is forever, and
 * a link that only works while a server is healthy is not.
 */

import { NIP05_DOMAIN } from '../services/nip05.js';

/** Where the web build is deployed. Shared links must be absolute. */
export const PUBLIC_WEB_ORIGIN = 'https://go.mybuho.de';

/**
 * Where to send someone who does not have BuhoGO yet.
 *
 * Deliberately the home page rather than the web build: it lists every way to
 * get the app, and a visitor on a phone almost certainly wants the Android
 * one rather than to be dropped straight into a browser wallet.
 */
export const BUHOGO_HOME = 'https://home.mybuho.de/buhogo';

/** Path prefix for the public profile page, also matched by the index.html shim. */
export const PROFILE_PATH = '/p/';

/** Query parameter carrying the fallback key. */
export const KEY_PARAM = 'k';

/**
 * Build the shareable link for a card.
 *
 * @param {{ username?: string, nip05?: string, npub?: string }} card
 * @returns {string} absolute URL, or '' when there is nothing to point at
 */
export function buildProfileLink({ username, nip05, npub } = {}) {
  const slug = profileSlug({ username, nip05, npub });
  if (!slug) return '';

  const url = `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}${slug}`;

  // The key is only worth appending when the slug is something else, which
  // is the case that can fail. A link that already carries the key needs no
  // fallback to itself.
  const carriesKey = npub && slug === encodeURIComponent(npub);
  if (!npub || carriesKey) return url;

  return `${url}?${KEY_PARAM}=${encodeURIComponent(npub)}`;
}

/**
 * The identifier that goes in the URL.
 *
 * A username on the BuhoGO domain is shortened to its local part; anything
 * else keeps its full form so the page can resolve it.
 */
export function profileSlug({ username, nip05, npub } = {}) {
  if (username) return encodeURIComponent(username);

  if (nip05) {
    const [local, domain] = String(nip05).split('@');
    if (local && domain && domain.toLowerCase() === NIP05_DOMAIN) {
      return encodeURIComponent(local);
    }
    return encodeURIComponent(nip05);
  }

  return npub ? encodeURIComponent(npub) : '';
}

/**
 * Inverse of the above, used by the page itself.
 *
 * Three shapes arrive here:
 *   npub1… / nprofile1…  a key, resolved without a network call
 *   name@domain          a full NIP-05 address, resolved over the network
 *   name                 a BuhoGO username, completed to name@mybuho.de
 *
 * @param {string} raw the `:id` route param
 * @returns {string} an identifier `lookupIdentifier` understands
 */
export function expandProfileSlug(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (isKey(value)) return value;
  if (value.includes('@')) return value.toLowerCase();
  return `${value.toLowerCase()}@${NIP05_DOMAIN}`;
}

/** True for the identifier forms that resolve locally, with no server involved. */
export function isKey(value) {
  return /^(npub1|nprofile1)/i.test(String(value || '').trim());
}
