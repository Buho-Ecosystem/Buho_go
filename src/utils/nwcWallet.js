/**
 * What an NWC connection is and what it may do, from what the wallet said
 * about itself (NIP-47 `get_info`). Pure, so every surface answers the same.
 *
 * A connection is granted methods one by one: a "receive only" link has
 * make_invoice but not pay_invoice, a "read only" one may not even share
 * the balance. The app follows those grants instead of failing later.
 */
import { Invoice } from '@getalby/lightning-tools';
import { isLightningAddress } from './addressUtils.js';

/** Older wallets were saved with WebLN method names; read both vocabularies. */
const WEBLN_TO_NIP47 = Object.freeze({
  sendPayment: 'pay_invoice',
  makeInvoice: 'make_invoice',
  getBalance: 'get_balance',
  getInfo: 'get_info',
  lookupInvoice: 'lookup_invoice',
  listTransactions: 'list_transactions',
  keysend: 'pay_keysend',
  signMessage: 'sign_message',
});

/** NIP-47 method names, deduplicated; WebLN names translated, unknown ones dropped. */
export function nip47Methods(methods) {
  const out = new Set();
  for (const m of Array.isArray(methods) ? methods : []) {
    if (typeof m !== 'string' || !m) continue;
    out.add(WEBLN_TO_NIP47[m] || m);
  }
  return [...out];
}

/**
 * The SDK's WebLN getInfo() answers a failed get_info with exactly
 * ['sendPayment'] instead of an error, and earlier versions of BuhoGO saved
 * whatever it returned. That list says nothing about the grants (a real
 * pay-only connection saved then looks the same), so it counts as unknown
 * until the wallet answers again (store.refreshNwcDetails).
 */
function isSdkFallback(methods) {
  return Array.isArray(methods) && methods.length === 1 && methods[0] === 'sendPayment';
}

/**
 * What a connection can do. When the wallet never said (wallets saved
 * before methods were stored), everything is assumed, as before: a guess
 * must never lock someone out of their own money.
 *
 * @param {string[]} methods NIP-47 or WebLN names
 * @returns {{ known: boolean, send: boolean, receive: boolean, balance: boolean, history: boolean, lookup: boolean, limit: boolean }}
 */
export function nwcCapabilities(methods) {
  const list = isSdkFallback(methods) ? [] : nip47Methods(methods);
  if (!list.length) return { known: false, send: true, receive: true, balance: true, history: true, lookup: true, limit: false };
  const has = (m) => list.includes(m);
  return {
    known: true,
    send: has('pay_invoice'),
    receive: has('make_invoice'),
    balance: has('get_balance'),
    history: has('list_transactions'),
    lookup: has('lookup_invoice'),
    limit: has('get_budget'),
  };
}

/** Capabilities of any wallet: NWC follows its grants, every other type can do all. */
export function capabilitiesOf(wallet) {
  if ((wallet?.type || 'nwc') !== 'nwc') return { known: true, send: true, receive: true, balance: true, history: true, lookup: true, limit: false };
  return nwcCapabilities(wallet?.metadata?.methods);
}

/**
 * Characters that show nothing or change how the text around them shows:
 * controls, and every format character (direction marks and overrides,
 * zero-width spaces, word joiners, the soft hyphen, tag characters, the
 * byte order mark), plus the blank letters that draw as empty space (the
 * Hangul fillers, the blank Braille pattern). The joiners U+200C and
 * U+200D stay: scripts and emoji need them. A flag built from tag
 * characters shows as its plain black flag.
 */
const HIDDEN = /(?![\u200C\u200D])[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;

/**
 * Text a wallet says about itself (its alias), fit to show: hidden
 * characters removed, spaces collapsed. A hidden right-to-left override
 * would show the rest of a name reversed, which can make one wallet look
 * like another; blank letters make a name that looks empty.
 */
export function cleanWalletText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim();
}

/** Splits text into characters as a person counts them, where the platform can. */
const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** At most `max` characters, never cutting one (a flag, a family emoji) in half. */
const clip = (text, max) => (graphemes ? Array.from(graphemes.segment(text), (part) => part.segment) : Array.from(text))
  .slice(0, max)
  .join('');

/**
 * A Lightning address a wallet gives about itself (in its connection
 * string or get_info), or null when it is not one. Only plain address
 * characters pass, so nothing hidden reaches the address Settings shows.
 */
export function walletAddressOf(value) {
  const address = String(value ?? '').trim();
  return isLightningAddress(address) ? address : null;
}

/**
 * The name to suggest for a new connection: what the wallet calls itself,
 * else the name in its Lightning address, else a plain fallback. Wallets
 * that answer with a placeholder ("N/A", "Unknown") get no say.
 */
export function suggestedWalletName({ alias, lud16 } = {}, fallback = 'Lightning wallet') {
  const name = cleanWalletText(alias);
  if (name && !/^(n\/a|unknown|null|undefined|-+)$/i.test(name)) return clip(name, 40);
  const user = cleanWalletText(String(lud16 || '').split('@')[0]);
  if (user) return clip(user, 40);
  return fallback;
}

/**
 * The wallet's own key from `get_info` (NIP-47: the node's public key),
 * lower-cased, or '' when it gave none. A secp256k1 key is 33 bytes
 * compressed or 32 x-only, in hex. Anything else is a placeholder ("N/A",
 * "Unknown", an empty field) from a wallet without a node of its own, and
 * two wallets that say the same placeholder are not the same wallet.
 */
export function walletKeyOf(value) {
  const key = String(value || '').trim().toLowerCase();
  return /^(?:0[23])?[0-9a-f]{64}$/.test(key) ? key : '';
}

/**
 * An existing wallet that is the same wallet as a new connection: same
 * node or account (`get_info` pubkey, when it is a real key) or the same
 * Lightning address. A new connection string to the same wallet is a
 * different text, so comparing strings alone misses it.
 *
 * @param {Array} wallets the store's wallets
 * @param {{ nodePubkey?: string, lud16?: string, connectionPubkey?: string }} probe
 * @returns {object|null}
 */
export function findSameWallet(wallets, { nodePubkey, lud16, connectionPubkey } = {}) {
  const node = walletKeyOf(nodePubkey);
  const address = String(lud16 || '').toLowerCase();
  const connection = String(connectionPubkey || '').toLowerCase();
  for (const w of Array.isArray(wallets) ? wallets : []) {
    if ((w?.type || 'nwc') !== 'nwc') continue;
    const meta = w.metadata || {};
    if (connection && String(meta.walletPubkey || '').toLowerCase() === connection) return w;
    if (node && walletKeyOf(meta.pubkey) === node) return w;
    if (address && String(meta.lud16 || '').toLowerCase() === address) return w;
  }
  return null;
}

/**
 * A spending limit from `get_budget` (NWC-13), in sats. An empty answer
 * means the connection has no limit, which is not the same as zero.
 *
 * @param {{ used_budget?: number, total_budget?: number, renews_at?: number, renewal_period?: string }} raw msat
 * @returns {{ totalSats: number, usedSats: number, remainingSats: number, renewsAt: number|null, period: string|null }|null}
 */
export function spendingLimitFrom(raw) {
  const total = Number(raw?.total_budget);
  if (!raw || !Number.isFinite(total) || total <= 0) return null;
  const used = Math.max(0, Number(raw.used_budget) || 0);
  const totalSats = Math.floor(total / 1000);
  const usedSats = Math.ceil(used / 1000);
  return {
    totalSats,
    usedSats,
    remainingSats: Math.max(0, totalSats - usedSats),
    renewsAt: Number(raw.renews_at) > 0 ? Number(raw.renews_at) * 1000 : null,
    period: raw.renewal_period && raw.renewal_period !== 'never' ? raw.renewal_period : null,
  };
}

/** The relay a connection talks through, as a host for display. */
export function relayHost(nwcUrl) {
  const match = /[?&]relay=([^&]+)/.exec(String(nwcUrl || ''));
  if (!match) return '';
  try {
    return new URL(decodeURIComponent(match[1]).replace(/^ws/i, 'http')).host;
  } catch {
    return '';
  }
}

/**
 * The settlement state of one NIP-47 transaction record.
 *
 * NIP-47 reports `state`: settled | pending | failed | accepted. "accepted"
 * means a hold invoice the recipient has taken but not settled, so the money
 * has not moved and it is not completed. A service that predates `state` is
 * read from `settled_at` instead, which is set only once it has.
 */
export function resolveNwcStatus(tx) {
  const state = String(tx?.state || '').toLowerCase();
  if (state === 'settled') return 'completed';
  if (state === 'failed') return 'failed';
  if (state) return 'pending';
  return tx?.settled_at || tx?.settledAt ? 'completed' : 'pending';
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * What a BOLT11 invoice says about itself: its payment hash (lower-case
 * hex, or null), amount in sats (0 when it names none) and expiry in unix
 * seconds (or null). Null when it is not a readable invoice. The one place
 * NWC code decodes an invoice.
 */
export function readInvoice(invoice) {
  if (typeof invoice !== 'string' || !invoice) return null;
  try {
    const decoded = new Invoice({ pr: invoice });
    const hash = String(decoded.paymentHash || '').toLowerCase();
    const expiresAt = decoded.expiryDate instanceof Date ? Math.floor(decoded.expiryDate.getTime() / 1000) : 0;
    return {
      paymentHash: HASH.test(hash) ? hash : null,
      amountSats: Number(decoded.satoshi) || 0,
      expiresAt: expiresAt > 0 ? expiresAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * The payment hash of a NIP-47 transaction record (a list or lookup row, a
 * make_invoice answer, a notification). The invoice decides: the receiver
 * signed it, and the hash is written in it. The record's own `payment_hash`
 * counts only when there is no readable invoice. A wallet that fills the
 * field wrongly would otherwise list one payment under two ids, its own and
 * the invoice's, and the app would announce it twice.
 *
 * @returns {string|null} lower-case hex
 */
export function nwcPaymentHash(tx) {
  const fromInvoice = readInvoice(tx?.invoice || tx?.bolt11 || tx?.payment_request || tx?.paymentRequest)?.paymentHash;
  if (fromInvoice) return fromInvoice;
  const claimed = String(tx?.payment_hash || tx?.paymentHash || '').toLowerCase();
  return HASH.test(claimed) ? claimed : null;
}

/**
 * One NIP-47 transaction, amounts already in sats (the SDK's WebLN layer
 * converts them), as the app's transaction row. The raw record is spread
 * first so nothing it carries (a description_hash, a field a later SDK
 * adds) is lost; the canonical names go on top.
 */
export function nwcTransactionRow(tx) {
  // The invoice's hash, else the record's own id even when it is not a
  // hash: a row must keep an id to be announced at all.
  const paymentHash = nwcPaymentHash(tx) || tx.payment_hash || tx.paymentHash || null;
  return {
    ...tx,
    id: paymentHash || tx.id,
    // NIP-47 states the direction itself, and its `amount` is UNSIGNED.
    // Falling back to `amount > 0` therefore matched every row, including
    // sends, and reported a spent bitcoin as income.
    type: tx.type === 'outgoing' ? 'send' : 'receive',
    amount: Math.abs(tx.amount || 0),
    // NWC's incoming amount is already credited (Alby Hub's isolated
    // balance sums incoming amount_msat without subtracting fee_msat).
    recipientSats: Math.abs(tx.amount || 0),
    timestamp: tx.settled_at || tx.settledAt || tx.created_at || tx.createdAt || null,
    created_at: tx.created_at || tx.createdAt || null,
    settled_at: tx.settled_at || tx.settledAt || null,
    receiptTimeIsCreation: !(tx.settled_at || tx.settledAt),
    description: tx.description || tx.memo || '',
    // There is no `settled` boolean on the record (see the SDK's
    // Nip47Transaction type): `state` decides, `settled_at` for a service
    // that omits it.
    status: resolveNwcStatus(tx),
    fee: tx.fees_paid || tx.feesPaid || 0,
    paymentHash,
    payment_hash: paymentHash,
    preimage: tx.preimage || null,
    bolt11: tx.invoice || tx.bolt11 || tx.payment_request || null,
    descriptionHash: tx.description_hash || tx.descriptionHash || null,
  };
}
