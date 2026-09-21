import { bech32 } from 'bech32';

// LUD-23 is an address disclosure, never a payment or sign-in. Keep its
// recognition independent of payment normalization (which can alter URLs).
const MAX_INPUT = 16384;
const TAG = 'addressRequest';
const FIELDS = ['tag', 'k1', 'callback', 'description'];

export function addressRequestError(code) {
  return Object.assign(new Error(code), { code });
}

function invalid() { throw addressRequestError('ADDRESS_REQUEST_INVALID'); }

function carrier(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_INPUT) invalid();
  let value = input.trim().replace(/^(lightning|lnurl):/i, '');
  if (/^lnurl1/i.test(value)) {
    const decoded = bech32.decode(value, MAX_INPUT);
    if (decoded.prefix !== 'lnurl') invalid();
    value = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bech32.fromWords(decoded.words)));
  }
  if (/^addressRequest\?/i.test(value)) {
    return { direct: true, params: new URLSearchParams(value.slice(value.indexOf('?') + 1)) };
  }
  const url = new URL(value);
  return { direct: false, params: url.searchParams, url };
}

/** Recognition consumes even malformed requests, so they cannot fall through
 * to a payment endpoint. Full validation happens only on intentional use. */
export function isAddressRequest(input) {
  try {
    const { direct, params } = carrier(input);
    return direct || params.getAll('tag').some(tag => tag.toLowerCase() === TAG.toLowerCase());
  } catch { return false; }
}

export function validateAddressRequestUrl(value) {
  let url;
  try { url = new URL(value); } catch { invalid(); }
  if (url.username || url.password || url.hash || !url.hostname) invalid();
  const onion = /^(?:[a-z2-7]{16}|[a-z2-7]{56})\.onion$/i.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && onion)) {
    throw addressRequestError('ADDRESS_REQUEST_INSECURE');
  }
  return url;
}

function challenge(value) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) invalid();
  return value;
}

function details(data) {
  if (!data || data.tag !== TAG) invalid();
  const k1 = challenge(data.k1);
  if (typeof data.callback !== 'string' || data.callback.length > MAX_INPUT) invalid();
  const callback = validateAddressRequestUrl(data.callback);
  if (typeof data.description !== 'string' || !data.description.trim()
      || data.description.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.description)) invalid();
  // Duplicate values are ambiguous across server frameworks. Existing single
  // k1/address values are replaced when building the approved submission.
  for (const name of ['k1', 'address']) if (callback.searchParams.getAll(name).length > 1) invalid();
  return Object.freeze({ tag: TAG, k1, callback: callback.href, domain: callback.host, description: data.description.trim() });
}

export function parseAddressRequest(input) {
  try {
    const { direct, params, url } = carrier(input);
    for (const field of FIELDS) if (params.getAll(field).length > 1) invalid();
    if ((!direct && params.get('tag') !== TAG) || (direct && params.has('tag') && params.get('tag') !== TAG)) invalid();
    const k1 = challenge(params.get('k1'));
    if (!direct) validateAddressRequestUrl(url.href);
    if (params.has('callback')) return { request: details({ ...Object.fromEntries(params), tag: TAG, k1 }), url: null, k1 };
    if (direct) invalid();
    return { request: null, url: url.href, k1 };
  } catch (error) {
    if (error.code?.startsWith('ADDRESS_REQUEST_')) throw error;
    invalid();
  }
}

export function validateAddressRequestDetails(data, initial) {
  const request = details(data);
  if (request.k1 !== initial.k1) invalid();
  return request;
}

export function isShareableLightningAddress(value) {
  return typeof value === 'string' && value.length <= 320
    && /^[a-z0-9_.+\-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

export function addressSubmissionUrl(request, address) {
  const validated = details(request);
  if (!isShareableLightningAddress(address)) throw addressRequestError('ADDRESS_REQUEST_ADDRESS_INVALID');
  const url = new URL(validated.callback);
  url.searchParams.set('k1', validated.k1);
  url.searchParams.set('address', address);
  return url.href;
}

/** Payment-only callers must never fetch an inline sharing callback. */
export function assertPaymentInput(input) {
  if (isAddressRequest(input)) throw addressRequestError('ADDRESS_REQUEST_NOT_PAYMENT');
}
