/**
 * Lightning address names on an LNbits server (the lnurlp "Pay Links"
 * extension). Mirrors the server's own rule so a bad name is caught before
 * the round trip.
 */

export const USERNAME_PATTERN = /^[a-z0-9_.-]{1,32}$/;

export function isValidUsername(value) {
  return USERNAME_PATTERN.test(String(value || ''));
}

/** A best-effort suggestion from a wallet name; the user stays free to edit it. */
export function suggestUsername(raw) {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 32);
}

/** "shop@legend.lnbits.com" → { user: 'shop', domain: 'legend.lnbits.com' }. */
export function splitAddress(address, fallbackDomain = '') {
  const text = String(address || '');
  const at = text.lastIndexOf('@');
  if (at < 0) return { user: text, domain: fallbackDomain };
  return { user: text.slice(0, at), domain: text.slice(at + 1) || fallbackDomain };
}

/** The LNbits page where extensions are switched on. */
export function extensionsUrl(serverUrl) {
  return `${String(serverUrl || '').replace(/\/+$/, '')}/extensions`;
}

/**
 * What a failed Pay Links request says about the extension. LNbits answers
 * 404 when it is not installed and 403 when it is not enabled for this
 * account: 'off', something a person can fix. Anything else (no network,
 * server error, key refused) says nothing about it: 'unknown'.
 *
 * @param {{ status?: number }} error
 * @returns {'off'|'unknown'}
 */
export function payLinksStatusOf(error) {
  return error?.status === 404 || error?.status === 403 ? 'off' : 'unknown';
}
