/**
 * BuhoGO's own payment link: the link a checkout puts behind "BuhoGO" in its
 * list of wallets, so that BuhoGO opens with the payment, whichever wallet
 * the phone would pick for a plain lightning: link.
 *
 *   buhogo://pay?request=<URL-encoded bitcoin:… or lightning:… request>
 *
 * The request is decoded once and then read like a scanned code; the person
 * confirms as for any payment. Lists that build wallet links by prefix
 * (`<wallet>:lightning:<invoice>`) work too: whatever follows `buhogo:` is
 * the request. `buhogo://nwc/…` is the wallet-connection return
 * (utils/nwcPairing.js), not a payment. Format and examples for integrators:
 * docs/PAYMENT_LINKS.md.
 */

const SCHEME = 'buhogo:';
const PAY = 'pay';
const CONNECTION_RETURN = 'nwc';

/**
 * The pay link that opens the app answering to `scheme` with this request:
 * `<scheme>://pay?request=<URL-encoded request>`. BuhoGO's own is
 * payLink('buhogo', request).
 * @param {string} scheme the app's scheme, without the colon
 * @param {string} request a bitcoin:… or lightning:… request
 */
export function payLink(scheme, request) {
  return `${scheme}://${PAY}?request=${encodeURIComponent(String(request).trim())}`;
}

/**
 * What a link carries for BuhoGO to pay.
 *   null                not a BuhoGO payment link (any other link, and the
 *                       wallet-connection return)
 *   { request }         the request it carries
 *   { request: '' }     a BuhoGO payment link without a request BuhoGO can
 *                       read: none, one that was not encoded and came
 *                       apart into several parameters, or another BuhoGO
 *                       link (one wrapper only, never unwrapped twice)
 * @param {unknown} url
 * @returns {{ request: string } | null}
 */
export function readPaymentLink(url) {
  const text = String(url ?? '').trim();
  if (!isBuhoLink(text)) return null;
  const rest = text.slice(SCHEME.length).replace(/^\/\//, '');
  const head = rest.split(/[/?#]/, 1)[0].toLowerCase();
  if (head === CONNECTION_RETURN) return null;
  const request = head === PAY ? requestParam(rest.slice(PAY.length)) : rest.trim();
  return { request: isBuhoLink(request) ? '' : request };
}

function isBuhoLink(text) {
  return text.slice(0, SCHEME.length).toLowerCase() === SCHEME;
}

/** The request of `pay?request=…`, or '' when it is missing or came apart. */
function requestParam(tail) {
  const query = tail.replace(/^\/?\?/, '');
  if (query === tail) return '';
  const params = new URLSearchParams(query);
  // An unencoded bitcoin: request splits at its own "&": "&lightning=…"
  // would arrive as a parameter of the link and the request would lose it.
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== 'request') return '';
  return params.get('request').trim();
}
