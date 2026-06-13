/**
 * LNbits LNDhub URI parser.
 *
 * LNbits' LNDhub extension exports a wallet as a single URI that already
 * bundles everything BuhoGO asks for in the manual connect form — the
 * server URL and the admin key. It looks like:
 *
 *   lndhub://admin:<key>@https://demo.lnbits.com/lndhub/ext/
 *           └login┘└─key─┘└──────────host────────────────┘
 *
 *   • login — "admin" or "invoice" (tells us which LNbits key follows)
 *   • key   — the LNbits API key (32-char hex)
 *   • host  — the LNbits base URL plus the extension path `/lndhub/ext/`
 *
 * We can't lean on the built-in URL parser here: the host segment carries
 * its OWN `https://` scheme, so `new URL('lndhub://a:b@https://x/…')`
 * mis-splits the authority (it reads the host as `https:`). We parse the
 * string by hand instead.
 *
 * Returns `{ serverUrl, adminKey, login }` for a valid LNbits LNDhub URI,
 * or `null` for anything else — including generic, non-LNbits LndHub
 * servers (e.g. a BlueWallet export), which this provider can't drive
 * through the LNbits REST API anyway.
 */

const LNDHUB_SCHEME = 'lndhub://';

// LNbits' LNDhub extension always lives under this path. Requiring it is
// how we tell an LNbits export apart from a vanilla LndHub server we
// couldn't actually talk to over `/api/v1/...`.
const LNBITS_LNDHUB_PATH = /\/lndhub\/ext\/?$/i;

/**
 * Cheap prefix check — does this string even claim to be an LNDhub URI?
 * Scheme is case-insensitive per RFC 3986.
 */
export function isLndhubUri(value) {
  return (
    typeof value === 'string' &&
    value.trim().toLowerCase().startsWith(LNDHUB_SCHEME)
  );
}

/**
 * Parse an LNbits LNDhub URI into the fields the connect form needs.
 *
 * @param {string} value - the raw `lndhub://…` string (whitespace tolerated)
 * @returns {{serverUrl: string, adminKey: string, login: string}|null}
 *          null when the input isn't a usable LNbits LNDhub URI.
 */
export function parseLndhubUri(value) {
  if (!isLndhubUri(value)) return null;

  // Drop the scheme. Keep original case for the key + host; only the
  // scheme and the login token are case-insensitive.
  const body = value.trim().slice(LNDHUB_SCHEME.length);

  // Split credentials from host on the LAST '@'. The host is a full URL
  // with no userinfo of its own, and LNbits keys are hex, so the final
  // '@' is unambiguously the userinfo separator.
  const at = body.lastIndexOf('@');
  if (at === -1) return null;

  const creds = body.slice(0, at);
  const host = body.slice(at + 1).trim();
  if (!creds || !host) return null;

  // credentials → login:key on the FIRST ':'.
  const colon = creds.indexOf(':');
  if (colon === -1) return null;
  const login = creds.slice(0, colon).trim().toLowerCase();
  const adminKey = creds.slice(colon + 1).trim();
  if (!adminKey) return null;

  // Must be an LNbits LNDhub endpoint, or we can't speak to it.
  if (!LNBITS_LNDHUB_PATH.test(host)) return null;

  // Derive the LNbits base URL by dropping the `/lndhub/ext/` suffix.
  // Stripping the suffix (rather than taking the URL origin) preserves any
  // base path for LNbits instances hosted under a sub-path, e.g.
  // `https://example.com/lnbits/lndhub/ext/` → `https://example.com/lnbits`.
  let serverUrl = host.replace(LNBITS_LNDHUB_PATH, '');

  // Tolerate a host with no scheme (some exporters omit it).
  if (!/^https?:\/\//i.test(serverUrl)) {
    serverUrl = 'https://' + serverUrl;
  }
  // Trim any trailing slash for a clean base URL.
  serverUrl = serverUrl.replace(/\/+$/, '');

  // After stripping the path + scheme there must be an actual host left.
  if (!/^https?:\/\/[^/]+/i.test(serverUrl)) return null;

  return { serverUrl, adminKey, login };
}
