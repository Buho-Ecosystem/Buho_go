/**
 * Social Bucket addresses: the npub.cash domain and how to recognise an
 * address on it. Kept apart from services/npubCash.js (which talks to the
 * service and needs the Nostr library) so pure code can tell a bucket
 * address from a person's own without loading either.
 */

/** Domain the addresses live on. Kept separate: the API moved once already. */
export const NPUBCASH_DOMAIN = 'npub.cash';

/** True if an address points at npub.cash, so we can tell ours from a user's own. */
export function isNpubCashAddress(address) {
  if (typeof address !== 'string') return false;
  return address.trim().toLowerCase().endsWith(`@${NPUBCASH_DOMAIN}`);
}
