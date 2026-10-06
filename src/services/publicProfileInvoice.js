import { isLightningAddress } from '../utils/addressUtils.js';
import { parseLightningInvoice } from '../utils/lightningInvoice.js';
import { lnurlGetJson } from '../utils/lnurlHttp.js';

export class ProfileInvoiceError extends Error {
  constructor(code, values = {}) {
    super(code);
    this.name = 'ProfileInvoiceError';
    this.code = code;
    this.values = values;
  }
}

/** Request an invoice only. This service never opens a wallet or sends money. */
export async function requestProfileInvoice(
  { address, amountSats, comment = '', signal },
  { getJson = lnurlGetJson, decode = parseLightningInvoice, now = Date.now } = {},
) {
  if (!isLightningAddress(address)) throw new ProfileInvoiceError('unavailable');
  const msat = amountSats * 1000;
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0 || !Number.isSafeInteger(msat)) {
    throw new ProfileInvoiceError('amount');
  }
  const [name, domain] = address.trim().split('@');
  const options = { signal, timeoutMs: 15000 };
  const response = await getJson(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`, options);
  const params = response.data;
  if (!response.ok || params?.tag !== 'payRequest' || params.status === 'ERROR') {
    throw new ProfileInvoiceError('unavailable');
  }
  const min = Number(params.minSendable);
  const max = Number(params.maxSendable);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
    throw new ProfileInvoiceError('unavailable');
  }
  if (msat < min) throw new ProfileInvoiceError('minimum', { n: Math.ceil(min / 1000) });
  if (msat > max) throw new ProfileInvoiceError('maximum', { n: Math.floor(max / 1000) });

  let callback;
  try { callback = new URL(params.callback); } catch { throw new ProfileInvoiceError('unavailable'); }
  if (callback.protocol !== 'https:' || callback.username || callback.password) {
    throw new ProfileInvoiceError('unavailable');
  }
  callback.searchParams.set('amount', String(msat));
  // Never inherit an amount currency or a comment supplied in the endpoint URL.
  callback.searchParams.delete('currency');
  callback.searchParams.delete('comment');
  const note = String(comment).trim();
  const allowed = Number.isSafeInteger(params.commentAllowed) && params.commentAllowed > 0
    ? params.commentAllowed : 0;
  const sentComment = note.slice(0, allowed);
  if (sentComment) callback.searchParams.set('comment', sentComment);

  const invoiceResponse = await getJson(callback.toString(), options);
  const data = invoiceResponse.data;
  if (!invoiceResponse.ok || data?.status === 'ERROR' || typeof data?.pr !== 'string') {
    throw new ProfileInvoiceError('unavailable');
  }
  let decoded;
  try { decoded = decode(data.pr); } catch { throw new ProfileInvoiceError('invalid'); }
  if (decoded.amount !== amountSats) throw new ProfileInvoiceError('invalid');
  if (!Number.isFinite(decoded.expiry) || decoded.expiry * 1000 <= now()) {
    throw new ProfileInvoiceError('expired');
  }
  return {
    invoice: decoded.invoice,
    amountSats,
    expiresAt: decoded.expiry * 1000,
    address: address.trim(),
    comment: sentComment,
    noteChanged: sentComment !== note,
  };
}
