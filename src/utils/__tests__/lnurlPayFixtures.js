/**
 * Test helpers for the LNURL-pay request path (utils/lnurlPay.js).
 *
 * invoiceFor() re-encodes a real regtest invoice under a new amount. The
 * checksum is valid, so it decodes like any invoice, but it was never signed
 * for that amount: it is for tests only and can never be paid.
 */
import { bech32 } from 'bech32';
import * as lnurlPay from '../lnurlPay.js';

const REGTEST_INVOICE = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
const WORDS = bech32.decode(REGTEST_INVOICE, 4096).words;

/** An invoice for `sats`, or for exactly `msat` millisats; 0 gives one with no amount. */
export function invoiceFor(sats, { msat = sats * 1000 } = {}) {
  // `p` is a tenth of a millisat, so any millisat amount can be written.
  return bech32.encode(msat === 0 ? 'lnbcrt' : `lnbcrt${msat * 10}p`, WORDS, 4096);
}

/** A pay request as a typical service sends it. */
export const PAY_REQUEST = Object.freeze({
  tag: 'payRequest',
  callback: 'https://pay.example/lnurlp/cb/alice',
  minSendable: 1000,
  maxSendable: 100000000,
  metadata: '[["text/plain","Alice"]]',
  commentAllowed: 32,
});

/**
 * A fake LNURL transport: answers in order and records each URL asked for.
 * An answer is `{ ok, status, data }`, as lnurlGetJson resolves, or an Error
 * to reject with, as a transport failure does.
 */
export function fakeService(...answers) {
  const asked = [];
  const get = async (url, options) => {
    asked.push({ url, options });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request: ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { get, asked };
}

export const ok = (data) => ({ ok: true, status: 200, data });
export const failed = (status, data = null) => ({ ok: false, status, data });

/** utils/lnurlPay.js as a component imports it, asking through `get`. */
export function lnurlPayWith(get) {
  return {
    ...lnurlPay,
    fetchPayRequest: (url, options = {}) => lnurlPay.fetchPayRequest(url, { ...options, get }),
    requestPayInvoice: (payRequest, args, options = {}) => lnurlPay.requestPayInvoice(payRequest, args, { ...options, get }),
  };
}
