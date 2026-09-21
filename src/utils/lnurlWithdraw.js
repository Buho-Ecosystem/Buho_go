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
  return {
    tag: 'withdrawRequest', k1, callback, minWithdrawable, maxWithdrawable,
    defaultDescription: params.get('defaultDescription'),
    ...(pinLimit === undefined ? {} : { pinLimit }),
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
  };
}
