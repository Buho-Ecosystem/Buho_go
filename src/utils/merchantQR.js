/**
 * Till codes: the QR codes South African shops show at the till, paid with
 * Bitcoin through the provider's Lightning service on cryptoqr.net.
 *
 * The provider takes "the entire QR code payload" as the name of a Lightning
 * address on its domain. So BuhoGO only does three things here:
 *   - recognise that a scan is a till code (never anything the wallet can
 *     pay itself: SendModal asks last);
 *   - encode the code once, exactly as scanned, never decoded or re-cased;
 *   - say the provider's answer in plain words. Which networks it takes is
 *     its call: a code it does not take is refused by it, not guessed here.
 *
 * Pure: no network, no store.
 */

export const SA_RETAIL_SOURCE = 'sa_retail';

const CRYPTOQR_DOMAIN = 'cryptoqr.net';

/** Longer than any till code. */
const MAX_QR_LENGTH = 2048;

/**
 * The till networks the provider names, and how each one's codes look.
 * Whatever matches is sent to the provider as soon as it is scanned, so a
 * word that merely appears in a text proves nothing (a secret key or a
 * token can hold one by chance). Each rule is exact (tillNetwork):
 *   - `account`: an EMV merchant code names its network in a merchant
 *     account (templates 26 to 51), by the reverse domain in sub-tag 00.
 *     Anywhere else in the code (a reference, a name) it names nothing.
 *   - `host`: a web link is the network's when its host is the network's
 *     domain or below it.
 *   - `code`: any other code is one of these shapes, whole.
 * Order matters: Pick n Pay's own Electrum code before Electrum's. Patterns
 * never nest repeats, and text past MAX_QR_LENGTH never reaches them.
 *
 * `name` is shown only when the provider names no store, and only where the
 * code itself names one: a network is not a shop.
 */
const NETWORKS = [
  { id: 'picknpay', name: 'Pick n Pay', account: /^za\.co\.electrum\.picknpay$/i },
  { id: 'ecentric', name: null, account: /^za\.co\.ecentric(?:\.|$)/i },
  { id: 'electrum', name: null, account: /^za\.co\.electrum(?:\.|$)/i },
  { id: 'snapscan', name: null, host: /(?:^|\.)snapscan\.(?:io|co\.za)$/i },
  { id: 'yoyo', name: null, host: /(?:^|\.)(?:wigroup|yoyogroup)\.co$/i },
  {
    id: 'zapper',
    name: null,
    host: /(?:^|\.)(?:zapper\.com|payat\.io|paynow\.netcash\.co\.za|paynow\.sagepay\.co\.za|transactionjunction\.co\.za)$|^\d+\.zap\.pe$/i,
    code: /^(?:.{2}\/.{4}\/.{20}|SK-\d+-\d{23}|\d{20}|CRSTPC-\d+-\d+-\d+-\d+-\d+)$/i,
  },
  { id: 'scantopay', name: null, host: /(?:^|\.)(?:scantopay\.io|oltio\.co\.za)$/i, code: /^\d{10}$/ },
  { id: 'provider', name: null, host: /(?:^|\.)cryptoqr\.net$/i },
];

/**
 * Store logos BuhoGO holds: the store's name as the provider writes it, and
 * the networks the store's own tills use. A logo needs both. Shared networks
 * let any merchant register any name, so a name alone proves no brand.
 */
const STORE_LOGOS = [
  { name: 'pick n pay', logo: '/sa_retailers/picknpay.png', networks: ['picknpay'] },
  { name: 'checkers', logo: '/sa_retailers/checkers.png', networks: ['electrum'] },
  { name: 'shoprite', logo: '/sa_retailers/shoprite.png', networks: ['electrum'] },
  { name: 'woolworths', logo: '/sa_retailers/woolworths.png', networks: ['ecentric'] },
];

/** Longest store name shown; anything longer is cut, never wrapped. */
const MAX_STORE_NAME = 48;

/**
 * Widest range a till payment's pay request may span (the rate moving while
 * the sheet is open) for BuhoGO to fill in the amount.
 */
const TILL_RATE_SPREAD = 0.05;

/** HTTP answers that mean the provider does not know the code. */
const CODE_NOT_FOUND = new Set([400, 404, 410]);

/** The text to match, or null when it cannot be a till code. */
function tillCode(data) {
  if (typeof data !== 'string') return null;
  const code = data.trim();
  return code && code.length <= MAX_QR_LENGTH ? code : null;
}

/**
 * The fields of an EMV merchant code, or of a template inside one: each a
 * two-digit id, a two-digit length and the value, in order. Null unless they
 * fill the text exactly, each id once.
 */
function emvFields(text) {
  const fields = new Map();
  let at = 0;
  while (at < text.length) {
    const head = text.slice(at, at + 4);
    if (!/^\d{4}$/.test(head)) return null;
    const id = head.slice(0, 2);
    const length = Number(head.slice(2));
    const value = text.slice(at + 4, at + 4 + length);
    if (value.length !== length || fields.has(id)) return null;
    fields.set(id, value);
    at += 4 + length;
  }
  return fields;
}

/** The ids of an EMV code's merchant accounts (templates 26 to 51, sub-tag 00). */
function emvAccountIds(code) {
  const ids = [];
  for (const [id, value] of emvFields(code) || []) {
    const account = id >= '26' && id <= '51' ? emvFields(value)?.get('00') : null;
    if (account) ids.push(account);
  }
  return ids;
}

/**
 * The network a till code belongs to (the rules at NETWORKS), or null when
 * the text cannot be one. Any other link or card (Wi-Fi, contact cards,
 * sign-in codes, mail, phone) and any text with a space in it is never one.
 */
function tillNetwork(code) {
  if (code.startsWith('000201')) {
    const accounts = emvAccountIds(code);
    return NETWORKS.find((n) => n.account && accounts.some((id) => n.account.test(id))) || null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(code)?.[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    let host;
    try {
      host = new URL(code).hostname;
    } catch {
      return null;
    }
    return (host && NETWORKS.find((n) => n.host?.test(host))) || null;
  }
  if (scheme || /\s/.test(code)) return null;
  return NETWORKS.find((n) => n.code?.test(code)) || null;
}

/**
 * The network a till code belongs to, or null when the text is not one:
 * `{ id, displayName }`, the name only where the code names the store. The
 * logo waits for the provider's answer (tillMerchant).
 *
 * @param {unknown} data - the scanned text
 * @returns {{ id: string, displayName: string|null }|null}
 */
export function getMerchantInfo(data) {
  const code = tillCode(data);
  const network = code && tillNetwork(code);
  return network ? { id: network.id, displayName: network.name } : null;
}

/**
 * The code as the name of a Lightning address: percent-encoded once, every
 * character outside letters, digits and `- _ .`, so no path on the way
 * (NWC address checks, URL building) reads or changes it. Never decoded
 * first: the provider decodes exactly once, so `%41` must arrive as `%2541`.
 *
 * @param {string} code
 * @returns {string}
 */
export function encodeTillCode(code) {
  return encodeURIComponent(code).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * A till code as the Lightning address the provider pays, with the network
 * it belongs to and the rand amount printed in it (readEmvAmount), or null
 * when the text is not a till code.
 *
 * @param {unknown} qrContent - the scanned text
 * @returns {{ lightningAddress: string, merchant: object, randAmount: string|null }|null}
 */
export function convertToLightningAddress(qrContent) {
  const merchant = getMerchantInfo(qrContent);
  if (!merchant) return null;
  const code = qrContent.trim();
  return {
    lightningAddress: `${encodeTillCode(code)}@${CRYPTOQR_DOMAIN}`,
    merchant,
    randAmount: readEmvAmount(code),
  };
}

/** CRC-16/CCITT-FALSE, as EMV merchant codes carry it in tag 63. */
function emvCrc(text) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * The rand amount printed in an EMV merchant code, as "1.00", or null.
 *
 * Read only from a code that is whole: every top-level tag (two-digit id,
 * two-digit length, value) fits exactly, the checksum in tag 63 matches, the
 * currency (tag 53) is the rand (710), the amount (tag 54) is a plain
 * positive decimal, and nothing adds to it: a code with a tip or a fee
 * (tag 55) is not the total. Anything else gives null: no amount is better
 * than a wrong one beside the price.
 *
 * @param {unknown} data - the scanned text
 * @returns {string|null}
 */
export function readEmvAmount(data) {
  const code = tillCode(data);
  if (!code || !code.startsWith('000201')) return null;
  const tags = emvFields(code);
  const crc = tags?.get('63');
  // The checksum is the last field and covers everything before its value.
  if (!crc || [...tags.keys()].pop() !== '63' || !/^[0-9A-F]{4}$/i.test(crc)) return null;
  if (emvCrc(code.slice(0, -4)) !== crc.toUpperCase()) return null;
  if (tags.get('53') !== '710' || tags.has('55')) return null;
  const amount = tags.get('54');
  if (!amount || !/^\d{1,10}(?:\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) return null;
  return Number(amount).toFixed(2);
}

/**
 * The store as the confirm sheet shows it: the name the provider gives in
 * its pay request (LUD-06 text), the network's own name only when it gave
 * none, and a logo only for a store BuhoGO holds one for, named by the
 * provider and paid through that store's own network.
 *
 * @param {{ id?: string, displayName?: string|null }|null} network - from getMerchantInfo
 * @param {unknown} providerName - the pay request's text/plain metadata
 * @param {string} fallback - shown when neither names a store
 * @returns {{ id: string|null, displayName: string, logo: string|null }}
 */
export function tillMerchant(network, providerName, fallback) {
  const named = storeName(providerName);
  return {
    id: network?.id || null,
    displayName: named || network?.displayName || fallback,
    logo: named ? storeLogo(named, network?.id) : null,
  };
}

/** The provider's store name as one short line, or null. */
function storeName(value) {
  if (typeof value !== 'string') return null;
  const line = value
    // Control and format characters (zero-width marks, direction overrides)
    // and line breaks: none belongs in a name, and some make a name read as
    // another.
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return null;
  const characters = [...line];
  return characters.length > MAX_STORE_NAME ? `${characters.slice(0, MAX_STORE_NAME - 1).join('').trimEnd()}…` : line;
}

/**
 * The logo for a store: its name, or the name of a branch ("Checkers
 * Hyper"), paid through one of the store's own networks.
 */
function storeLogo(name, networkId) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const store = STORE_LOGOS.find((s) => (key === s.name || key.startsWith(`${s.name} `)) && s.networks.includes(networkId));
  return store ? store.logo : null;
}

/**
 * The amount to fill in for a till payment, in sats, or null. Only a narrow
 * range is the provider's price with the rate moving: its top covers the
 * sale. A wide range is not a price, and an amount printed in the code
 * (which anyone can print) never picks one.
 *
 * @param {unknown} minSendable - msat
 * @param {unknown} maxSendable - msat
 * @returns {number|null}
 */
export function tillPrefillSats(minSendable, maxSendable) {
  if (!Number.isSafeInteger(minSendable) || !Number.isSafeInteger(maxSendable)) return null;
  if (minSendable <= 0 || maxSendable <= minSendable) return null;
  if (maxSendable - minSendable > minSendable * TILL_RATE_SPREAD) return null;
  const sats = Math.floor(maxSendable / 1000);
  return sats * 1000 >= minSendable ? sats : null;
}

/**
 * The provider's own failure codes (its scanner spec). It sends them in its
 * words, sometimes inside a longer technical line; matched as whole words in
 * the first part of the text.
 */
export const MERCHANT_FAILURE = Object.freeze({
  UNKNOWN_CODE: 'UNKNOWN_CODE',
  UNSUPPORTED_QR_CODE: 'UNSUPPORTED_QR_CODE',
  SMART_SHOPPER_SCANNED: 'SMART_SHOPPER_SCANNED',
  AMOUNT_TOO_HIGH: 'AMOUNT_TOO_HIGH',
  REFUND_ADDRESS_REQUIRED: 'REFUND_ADDRESS_REQUIRED',
  INVALID_REFUND_ADDRESS: 'INVALID_REFUND_ADDRESS',
});

const FAILURE_PATTERN = new RegExp(`\\b(${Object.values(MERCHANT_FAILURE).join('|')})\\b`);

/**
 * The provider's failure code in its reason, or null.
 * @param {unknown} reason
 * @returns {string|null}
 */
export function merchantFailureCode(reason) {
  if (typeof reason !== 'string') return null;
  return reason.slice(0, 500).match(FAILURE_PATTERN)?.[1] ?? null;
}

/** A technical line (a request trace, JSON): words that say nothing to a person. */
const TECHNICAL_LINE = /^\s*\[|[{}]/;

/**
 * The provider's refusal of a till code in plain words, or null where its
 * own words say it best. The "Refunds to" row says the refund codes while
 * the sheet is open (utils/refundAddress.js); these words are for when it
 * is not. A technical line with no code BuhoGO knows is a refused code.
 *
 * @param {unknown} reason - the provider's words
 * @param {(key: string) => string} t
 * @returns {string|null}
 */
export function describeMerchantFailure(reason, t) {
  switch (merchantFailureCode(reason)) {
    case MERCHANT_FAILURE.UNKNOWN_CODE:
      return t("This code can't be paid. Ask the cashier for a new one.");
    case MERCHANT_FAILURE.UNSUPPORTED_QR_CODE:
      return t("This store's code isn't supported yet. Pay another way.");
    case MERCHANT_FAILURE.SMART_SHOPPER_SCANNED:
      return t("That's a rewards code. Ask the cashier for the payment QR code.");
    case MERCHANT_FAILURE.AMOUNT_TOO_HIGH:
      return t('This amount is over the limit. Pay another way.');
    case MERCHANT_FAILURE.REFUND_ADDRESS_REQUIRED:
      return t('This store needs a refund address.');
    case MERCHANT_FAILURE.INVALID_REFUND_ADDRESS:
      return t("This address can't receive refunds. Choose another.");
    default:
      return typeof reason === 'string' && TECHNICAL_LINE.test(reason)
        ? t("This code can't be paid. Ask the cashier for a new one.")
        : null;
  }
}

/**
 * What the Send field says when a till code's pay request cannot be read,
 * as `{ reason, attribution }`:
 *   - the provider's refusal: in plain words where there are some, else in
 *     its own words, said as theirs;
 *   - no answer at all (offline, a timeout): the reason already found;
 *   - an HTTP answer that the code is unknown: ask the cashier for a new one;
 *   - any other silence (busy, down): try again, a new code would fail too.
 *
 * @param {{ serviceReason?: string|null, error?: boolean, reason?: string,
 *   attribution?: string|null, httpStatus?: number|null }} info - from the lookup
 * @param {(key: string) => string} t
 * @returns {{ reason: string, attribution: string|null }}
 */
export function describeTillLookupFailure(info, t) {
  const said = typeof info?.serviceReason === 'string' ? info.serviceReason.trim() : '';
  if (said) {
    const plain = describeMerchantFailure(said, t);
    return plain ? { reason: plain, attribution: null } : { reason: info.reason || said, attribution: info.attribution ?? null };
  }
  if (info?.error && info.reason) return { reason: info.reason, attribution: info.attribution ?? null };
  return CODE_NOT_FOUND.has(info?.httpStatus)
    ? { reason: t("This code can't be paid. Ask the cashier for a new one."), attribution: null }
    : { reason: t("The store's payment service isn't answering. Try again in a moment."), attribution: null };
}

/**
 * The business behind every till code. It keeps the refund address a till
 * payment shares, so the confirm sheet names it beside the store (a payment
 * partner is named along with the merchant).
 */
export const MERCHANT_PROVIDER = Object.freeze({ name: 'MoneyBadger' });

/** The provider's domain, or one under it. */
function isProviderHost(hostname) {
  return hostname === CRYPTOQR_DOMAIN || hostname.endsWith(`.${CRYPTOQR_DOMAIN}`);
}

/**
 * True for an https URL on the provider's own host. A till payment shares a
 * refund address by default only when its callback is one of these: a code
 * that only looks like a till code never gets the address unasked.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isMerchantProviderUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const { protocol, hostname, username, password } = new URL(url);
    if (protocol !== 'https:' || username || password) return false;
    return isProviderHost(hostname);
  } catch {
    return false;
  }
}

/**
 * True for a Lightning address on the provider's domain: its name is a till
 * code, wherever the address came from (a scan, a paste, a link).
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isTillAddress(address) {
  if (typeof address !== 'string') return false;
  const text = address.trim();
  const at = text.lastIndexOf('@');
  return at > 0 && isProviderHost(text.slice(at + 1).toLowerCase());
}

/**
 * A Lightning address in the case BuhoGO pays it: all lower case, except a
 * name on the provider's domain. That name is a till code, which the
 * provider reads exactly as printed.
 *
 * @param {string} address - a Lightning address
 * @returns {string}
 */
export function lightningAddressCase(address) {
  const text = String(address).trim();
  const at = text.lastIndexOf('@');
  if (at < 1) return text.toLowerCase();
  const domain = text.slice(at + 1).toLowerCase();
  const name = text.slice(0, at);
  return `${isProviderHost(domain) ? name : name.toLowerCase()}@${domain}`;
}
