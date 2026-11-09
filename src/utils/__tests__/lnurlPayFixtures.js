/**
 * Test helpers for the LNURL-pay request path (utils/lnurlPay.js).
 *
 * invoiceFor() rebuilds a real regtest invoice for a new amount and a fresh
 * time. The checksum is valid, so it decodes like any invoice, but it was
 * never signed for that: it is for tests only and can never be paid.
 */
import { bech32 } from 'bech32';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as lnurlPay from '../lnurlPay.js';

const REGTEST_INVOICE = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
const WORDS = bech32.decode(REGTEST_INVOICE, 4096).words;

// BOLT11 data: a timestamp (7 words), tagged fields, a signature (104 words).
const SIGNATURE = WORDS.slice(-104);
const DESCRIPTION_TAG = 13; // `d`
const DESCRIPTION_HASH_TAG = 23; // `h`
const FIELDS = (() => {
  const fields = [];
  for (let i = 7; i < WORDS.length - 104;) {
    const length = WORDS[i + 1] * 32 + WORDS[i + 2];
    fields.push({ type: WORDS[i], data: WORDS.slice(i + 3, i + 3 + length) });
    i += 3 + length;
  }
  return fields;
})();

/**
 * One time for every invoice in a run, so the same arguments always give the
 * same invoice. The regtest invoice's own expiry (900 s) carries over, so
 * each one expires 15 minutes after it was made.
 */
export const INVOICE_TIME = Math.floor(Date.now() / 1000);

/** SHA-256 of a pay request's metadata, as an invoice's description hash. */
export function metadataHash(metadata) {
  return bytesToHex(sha256(new TextEncoder().encode(metadata)));
}

function timestampWords(seconds) {
  return Array.from({ length: 7 }, (_, i) => Math.floor(seconds / 32 ** (6 - i)) % 32);
}

/**
 * An invoice for `sats`, or for exactly `msat` millisats; 0 gives one with no
 * amount. It carries a plain description, or `descriptionHash` (hex) in its
 * place, and was made at `createdAt` (seconds).
 */
export function invoiceFor(sats, { msat = sats * 1000, descriptionHash = null, createdAt = INVOICE_TIME } = {}) {
  const fields = descriptionHash
    ? [...FIELDS.filter(({ type }) => type !== DESCRIPTION_TAG), { type: DESCRIPTION_HASH_TAG, data: bech32.toWords(hexToBytes(descriptionHash)) }]
    : FIELDS;
  const words = [
    ...timestampWords(createdAt),
    ...fields.flatMap(({ type, data }) => [type, data.length >> 5, data.length & 31, ...data]),
    ...SIGNATURE,
  ];
  // `p` is a tenth of a millisat, so any millisat amount can be written.
  return bech32.encode(msat === 0 ? 'lnbcrt' : `lnbcrt${msat * 10}p`, words, 4096);
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
