/**
 * Pure routing decisions for incoming Android deep links (issue #301).
 *
 * Lives outside src/boot/deep-links.js so it runs under plain `node`; the
 * boot file pulls in Quasar and Capacitor.
 */

import { classifyIdentifier } from './nostrLookup.js';
import { PROFILE_PATH, profileLinkRoute } from './profileLink.js';

/** A second identical intent inside this window is the same tap, delivered twice. */
export const DEEP_LINK_DEDUPE_MS = 2000;

/**
 * The card route for a link that is about a person rather than a payment.
 *
 *   https://go.mybuho.de/p/…   a shared card link (App Link / intent handoff)
 *   nostr:npub1… / nostr:nprofile1…   NIP-21 identity, e.g. the card QR
 *                                       scanned with the system camera
 *
 * Both open the card, which offers Pay and Save. Treating an identity as a
 * payment (the old behaviour) meant "Save" and "scan to save me" opened a
 * pay sheet, or "Please set up a wallet first" for someone with no wallet.
 *
 * Every other link (lightning:, bitcoin:, nostr:nevent…, …) returns null and
 * keeps its payment handling.
 *
 * @param {string} url
 * @returns {{ path: string, query: Record<string, string> } | null}
 */
export function cardRouteForDeepLink(url) {
  if (!url || typeof url !== 'string') return null;
  const input = url.trim();

  const profileRoute = profileLinkRoute(input);
  if (profileRoute) return profileRoute;

  // Only the NIP-21 form: a deep link always carries a scheme, and a bare
  // key arriving here would be some other app's custom format.
  if (!/^nostr:/i.test(input)) return null;
  const kind = classifyIdentifier(input);
  if (kind !== 'npub' && kind !== 'nprofile') return null;

  const id = input.replace(/^nostr:(\/\/)?/i, '').trim();
  return { path: `${PROFILE_PATH}${encodeURIComponent(id)}`, query: {} };
}

/**
 * Drop a repeat of the same URL delivered within a short window.
 *
 * Cold start can report one intent twice (getLaunchUrl and appUrlOpen). The
 * old guard remembered the last URL forever, so tapping the same card or
 * payment link a second time later did nothing at all.
 *
 * @param {{ windowMs?: number, now?: () => number }} [opts]
 * @returns {(url: string) => boolean} true when the URL should be handled
 */
export function createDeepLinkDeduper({ windowMs = DEEP_LINK_DEDUPE_MS, now = () => Date.now() } = {}) {
  let lastUrl = null;
  let lastAt = -Infinity;
  return function shouldHandle(url) {
    if (!url) return false;
    const at = now();
    if (url === lastUrl && at - lastAt < windowMs) return false;
    lastUrl = url;
    lastAt = at;
    return true;
  };
}
