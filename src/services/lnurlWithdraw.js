import { lnurlToUrl } from '../utils/addressUtils.js';
import { lnurlGetJson } from '../utils/lnurlHttp.js';
import { parseFastWithdrawRequest, withdrawInfo } from '../utils/lnurlWithdraw.js';

/** Shared metadata path for wallet redemption and kiosk card acceptance. */
export async function fetchLnurlRequest(input, { signal, get = lnurlGetJson } = {}) {
  const url = lnurlToUrl(input);
  if (!url) throw new Error('Invalid LNURL');
  const inline = parseFastWithdrawRequest(url);
  if (inline) return { url, data: inline };
  const response = await get(url, { timeoutMs: 10000, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  if (!response.data) throw new Error('The server did not respond or the link is no longer valid');
  if (response.data.status === 'ERROR') throw new Error(safeWithdrawError(response.data.reason || 'This link is no longer valid'));
  return { url, data: response.data };
}

export function validateWithdrawRequest(data) {
  const min = data.minWithdrawable;
  const max = data.maxWithdrawable;
  if (!data.k1 || typeof data.k1 !== 'string' || !/^https?:\/\//i.test(data.callback || '') || !lnurlToUrl(data.callback)
      || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min
      || (data.pinLimit != null && (!Number.isSafeInteger(data.pinLimit) || data.pinLimit <= 0))) {
    throw new Error('Invalid withdrawal request');
  }
}

/** Kiosk may receive funds, never follow pay/auth/address-sharing requests. */
export async function fetchWithdrawRequest(input, options) {
  const { url, data } = await fetchLnurlRequest(input, options);
  if (data.tag !== 'withdrawRequest') throw new Error('This card does not support withdrawals.');
  validateWithdrawRequest(data);
  return withdrawInfo(data, { sourceUrl: url });
}

// Card challenges and PINs can be embedded in native transport error URLs.
export function safeWithdrawError(message) {
  return String(message || 'Something went wrong')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[service]')
    .replace(/([?&])(?:pin|k1|p|c)=([^&\s]*)/gi, '$1[redacted]');
}

/** One callback per attempt. Network errors are uncertain, never auto-retried. */
export async function submitWithdrawCallback(request, bolt11, pin = null, { signal, get = lnurlGetJson } = {}) {
  validateWithdrawRequest(request);
  if (signal?.aborted) throw new DOMException('Withdrawal cancelled', 'AbortError');
  const url = new URL(request.callback);
  if (pin && url.protocol !== 'https:') throw new Error('PIN authorization requires a secure connection');
  url.searchParams.set('k1', request.k1);
  url.searchParams.set('pr', bolt11);
  if (pin) url.searchParams.set('pin', pin);
  let response;
  try {
    response = await get(url.toString(), { timeoutMs: 90000, ...(signal ? { signal } : {}) });
  } catch (error) {
    const safe = new Error(safeWithdrawError(error?.message));
    // The shared HTTP transport uses AbortError for its own timeout too.
    // Only caller cancellation should silently dismiss authorization.
    safe.name = error?.name === 'AbortError' && !signal?.aborted
      ? 'TimeoutError' : error?.name || 'Error';
    throw safe;
  }
  if (!response.ok) throw new Error(`Withdraw callback failed: ${response.status}`);
  const data = response.data || {};
  if (data.status === 'ERROR') {
    const reason = safeWithdrawError(data.reason || 'Withdraw service rejected the request');
    const error = new Error(reason);
    if (reason.trim() === 'Invalid PIN') error.code = 'INVALID_PIN';
    else if (/card blocked/i.test(reason) && /pin/i.test(reason)) error.code = 'CARD_BLOCKED';
    throw error;
  }
  return data;
}
