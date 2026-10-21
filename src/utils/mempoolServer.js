/**
 * Mempool servers for exchange rates: the default, the fallback, and how a
 * server address the user typed becomes an API URL. Pure, so it is shared
 * by the rate service and the Settings sheet and tested on its own.
 */

// Used unless the user picks their own server.
export const MEMPOOL_DEFAULT_URL = 'https://mempool.space/api/v1';

// Asked when the chosen Mempool server fails. Not offered in Settings.
export const MEMPOOL_FALLBACK_URL = 'https://mempool.emzy.de/api/v1';

// Servers that were once offered in Settings and no longer exist. A saved
// choice of one goes back to the default.
export const RETIRED_MEMPOOL_URLS = ['https://mempool.blocktrainer.de/api/v1'];

/**
 * The API URL for a server address as typed: "node.example.com",
 * "https://node.example.com/" and "https://node.example.com/api/v1" all
 * give "https://node.example.com/api/v1". https:// is assumed when no
 * scheme is given; http:// stays allowed for a server on the local network.
 * Returns null when the text is not a server address.
 */
export function normalizeMempoolUrl(input) {
  let text = String(input || '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname || url.search || url.hash || url.username || url.password) return null;
  // A host needs a dot (example.com) unless it is localhost or an IPv6 literal.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) return null;

  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/api')) path += '/v1';
  else if (!path.endsWith('/api/v1')) path += '/api/v1';
  return `${url.protocol}//${url.host}${path}`;
}

/** What the user sees for a server: its address without scheme or API path. */
export function mempoolServerLabel(apiUrl) {
  if (!apiUrl) return 'mempool.space';
  try {
    const url = new URL(apiUrl);
    const path = url.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
    return `${url.host}${path}`;
  } catch {
    return apiUrl;
  }
}
