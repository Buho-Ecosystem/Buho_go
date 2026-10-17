/**
 * After a request failed to reach its server: is the phone offline, does
 * its network have no internet, or is only that service down? Asked only
 * after something failed: a payment, or a Spark check (#381).
 *
 * A probe is a bare HEAD request to a host that belongs to no wallet
 * service, so a wallet outage cannot fail it: no credentials, no referrer,
 * no cached answer. Any host answering means the internet works, so one
 * host being down never reads as "no internet". The hosts sit with
 * different providers; the third is a CDN trace endpoint, because a
 * Bitcoin explorer may hold plain browser requests open. HTTPS keeps a
 * sign-in page on public Wi-Fi from answering for any of them.
 */
export const PROBE_URLS = ['https://go.mybuho.de/', 'https://mempool.space/', 'https://www.cloudflare.com/cdn-cgi/trace'];
export const PROBE_TIMEOUT_MS = 3000;

/**
 * @param {object} [options]
 * @param {boolean} [options.online]  the browser's network flag (false: no network at all)
 * @param {Function} [options.request] fetch, replaceable in tests
 * @returns {Promise<'offline'|'no-internet'|'service'>}
 */
export async function diagnoseConnection({
  online = globalThis.navigator?.onLine,
  request = (url, init) => fetch(url, init),
} = {}) {
  if (online === false) return 'offline';
  try {
    await Promise.any(PROBE_URLS.map((url) => probe(url, request)));
    return 'service';
  } catch {
    return 'no-internet';
  }
}

function probe(url, request) {
  // AbortController, not AbortSignal.timeout: iOS 15 lacks the latter.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  return request(url, {
    method: 'HEAD',
    mode: 'no-cors',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}
