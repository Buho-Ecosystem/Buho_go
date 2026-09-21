// LUD-08 adds an optional local metadata path. A null result always means
// use the ordinary LUD-03 GET; it never means the request was redeemed.
const REQUIRED = ['tag', 'k1', 'callback', 'minWithdrawable', 'maxWithdrawable', 'defaultDescription'];

function millisats(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function secureEndpoint(value) {
  try {
    const url = new URL(value);
    const onion = /^(?:[a-z2-7]{16}|[a-z2-7]{56})\.onion$/i.test(url.hostname);
    return !url.username && !url.password && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && onion));
  } catch { return false; }
}

/**
 * LUD-14 — validate a `balanceCheck` URL before we ever store or call it.
 *
 * balanceCheck turns a one-shot withdraw QR into a voucher: GET it later and
 * the service answers with a fresh withdrawRequest carrying whatever balance
 * is left. Because the WALLET calls this URL by itself — no user reading a
 * link first — it is pinned to the service that issued the voucher: same
 * transport rules as any other endpoint here (https, or http only for .onion,
 * no credentials, no fragment) AND the same host as the callback. Anything
 * else fails closed and the voucher simply isn't tracked.
 *
 * @param {unknown} balanceCheck
 * @param {unknown} callback  the withdrawRequest callback it arrived with
 * @returns {string|null} the URL to keep, or null
 */
export function validateBalanceCheckUrl(balanceCheck, callback) {
  if (typeof balanceCheck !== 'string' || !balanceCheck) return null;
  if (!secureEndpoint(balanceCheck) || !secureEndpoint(callback)) return null;
  try {
    const url = new URL(balanceCheck);
    if (url.hostname !== new URL(callback).hostname) return null;
    return url.toString();
  } catch { return null; }
}

/** Inspect an already decoded LNURL without IO or changing opaque values.
 * Unlike LNURL-auth, a withdrawal k1 is an arbitrary service-defined string.
 * An empty description is valid; absence is not. */
export function parseFastWithdrawRequest(endpoint) {
  if (!secureEndpoint(endpoint)) return null;
  const params = new URL(endpoint).searchParams;
  if (REQUIRED.some(field => params.getAll(field).length !== 1)) return null;
  if (params.get('tag') !== 'withdrawRequest') return null;
  const k1 = params.get('k1');
  const callback = params.get('callback');
  const minWithdrawable = millisats(params.get('minWithdrawable'));
  const maxWithdrawable = millisats(params.get('maxWithdrawable'));
  if (!k1 || !secureEndpoint(callback) || minWithdrawable === null || maxWithdrawable === null
      || minWithdrawable > maxWithdrawable) return null;

  // Bolt Card's optional PIN threshold must survive the shortcut. If it is
  // ambiguous or malformed, ask the service for authoritative JSON instead.
  let pinLimit;
  if (params.has('pinLimit')) {
    pinLimit = millisats(params.get('pinLimit'));
    if (params.getAll('pinLimit').length !== 1 || pinLimit === null || pinLimit <= 0) return null;
  }
  // LUD-14 is optional metadata, never a reason to reject the fast path: an
  // unusable balanceCheck just means this code isn't trackable as a voucher.
  const balanceCheck = validateBalanceCheckUrl(params.get('balanceCheck'), callback);

  return {
    tag: 'withdrawRequest', k1, callback, minWithdrawable, maxWithdrawable,
    defaultDescription: params.get('defaultDescription'),
    ...(pinLimit === undefined ? {} : { pinLimit }),
    ...(balanceCheck ? { balanceCheck } : {}),
  };
}

/** Both metadata sources feed the same existing Redeem flow. Whole-satoshi
 * invoices must stay within the advertised millisatoshi bounds. In particular,
 * zero is a balance, not a missing field to replace with a large default. */
export function withdrawInfo(data) {
  const minWithdrawable = data.minWithdrawable ?? 1000;
  const maxWithdrawable = data.maxWithdrawable ?? 100000000000;
  const minSats = Math.max(1, Math.ceil(minWithdrawable / 1000));
  const maxSats = Math.floor(maxWithdrawable / 1000);
  const isFixedAmount = minWithdrawable === maxWithdrawable || minSats === maxSats;
  return {
    lnurlType: 'withdrawRequest', k1: data.k1, callback: data.callback,
    minWithdrawable, maxWithdrawable, minSats, maxSats, isFixedAmount,
    fixedAmountSats: isFixedAmount ? maxSats : null,
    defaultDescription: data.defaultDescription || 'Withdrawal',
    pinLimit: Number.isSafeInteger(data.pinLimit) && data.pinLimit > 0 ? data.pinLimit : null,
    // LUD-14: the handle on what is left after this withdrawal, and the
    // balance the service claims right now (millisats, informational — the
    // authoritative number is maxWithdrawable on the next fetch).
    balanceCheck: validateBalanceCheckUrl(data.balanceCheck, data.callback),
    currentBalance: Number.isSafeInteger(data.currentBalance) && data.currentBalance >= 0
      ? data.currentBalance
      : null,
  };
}
