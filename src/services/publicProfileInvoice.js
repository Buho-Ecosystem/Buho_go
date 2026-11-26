import { isLightningAddress } from '../utils/addressUtils.js';
import { parseLightningInvoice } from '../utils/lightningInvoice.js';
import { lnurlGetJson } from '../utils/lnurlHttp.js';
import { lightningAddressSpellings } from '../utils/merchantQR.js';

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
  const options = { signal, timeoutMs: 15000 };
  // As written, then in lower case when its service does not know that
  // spelling (utils/merchantQR). No answer at all is not asked again.
  let params = null;
  for (const spelling of lightningAddressSpellings(address)) {
    const at = spelling.lastIndexOf('@');
    const response = await getJson(`https://${spelling.slice(at + 1)}/.well-known/lnurlp/${encodeURIComponent(spelling.slice(0, at))}`, options);
    if (response.ok && response.data?.tag === 'payRequest' && response.data.status !== 'ERROR') {
      params = response.data;
      break;
    }
  }
  if (!params) throw new ProfileInvoiceError('unavailable');
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
  // To the thousandth: a fraction off is another amount than the one asked for.
  if (decoded.amountMsat !== msat) throw new ProfileInvoiceError('invalid');
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
