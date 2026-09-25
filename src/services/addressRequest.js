import { lnurlGetJson } from '../utils/lnurlHttp.js';
import { addressRequestError, parseAddressRequest, validateAddressRequestDetails, addressSubmissionUrl } from '../utils/lud23.js';

// No redirects: consent names one recipient. Native HTTP and browser fetch
// both enforce this before a second host can receive the approved address.
const OPTIONS = Object.freeze({ timeoutMs: 15000, disableRedirects: true });

export async function resolveAddressRequest(input, { get = lnurlGetJson, signal } = {}) {
  const initial = parseAddressRequest(input);
  if (initial.request) return initial.request;
  let response;
  try { response = await get(initial.url, { ...OPTIONS, signal }); }
  catch { throw addressRequestError('ADDRESS_REQUEST_UNREACHABLE'); }
  if (!response.ok) throw addressRequestError('ADDRESS_REQUEST_UNREACHABLE');
  if (response.data?.status === 'ERROR') throw addressRequestError('ADDRESS_REQUEST_REJECTED');
  return validateAddressRequestDetails(response.data, initial);
}

export async function submitAddressRequest(request, address, { get = lnurlGetJson } = {}) {
  const url = addressSubmissionUrl(request, address);
  // Once the call is dispatched, a timeout, redirect, CORS error or unreadable
  // body cannot establish that the service did not receive it. Never replay.
  try {
    const response = await get(url, OPTIONS);
    if (response.ok && response.data?.status === 'OK') return 'confirmed';
    if (response.ok && response.data?.status === 'ERROR') return 'rejected';
  } catch { /* Outcome remains unknown. Never expose a URL-bearing error. */ }
  return 'unknown';
}
