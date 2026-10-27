/**
 * What an NWC connection is and what it may do, from what the wallet said
 * about itself (NIP-47 `get_info`). Pure, so every surface answers the same.
 *
 * A connection is granted methods one by one: a "receive only" link has
 * make_invoice but not pay_invoice, a "read only" one may not even share
 * the balance. The app follows those grants instead of failing later.
 */

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
 * The name to suggest for a new connection: what the wallet calls itself,
 * else the name in its Lightning address, else a plain fallback. Wallets
 * that answer with a placeholder ("N/A", "Unknown") get no say.
 */
export function suggestedWalletName({ alias, lud16 } = {}, fallback = 'Lightning wallet') {
  const name = String(alias || '').trim();
  if (name && !/^(n\/a|unknown|null|undefined|-+)$/i.test(name)) return name.slice(0, 40);
  const user = String(lud16 || '').split('@')[0].trim();
  if (user) return user.slice(0, 40);
  return fallback;
}

/**
 * An existing wallet that is the same wallet as a new connection: same
 * node or account (`get_info` pubkey) or the same Lightning address. A new
 * connection string to the same wallet is a different text, so comparing
 * strings alone misses it.
 *
 * @param {Array} wallets the store's wallets
 * @param {{ nodePubkey?: string, lud16?: string, connectionPubkey?: string }} probe
 * @returns {object|null}
 */
export function findSameWallet(wallets, { nodePubkey, lud16, connectionPubkey } = {}) {
  const node = String(nodePubkey || '').toLowerCase();
  const address = String(lud16 || '').toLowerCase();
  const connection = String(connectionPubkey || '').toLowerCase();
  for (const w of Array.isArray(wallets) ? wallets : []) {
    if ((w?.type || 'nwc') !== 'nwc') continue;
    const meta = w.metadata || {};
    if (connection && String(meta.walletPubkey || '').toLowerCase() === connection) return w;
    if (node && String(meta.pubkey || '').toLowerCase() === node) return w;
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

/**
 * One NIP-47 transaction, amounts already in sats (the SDK's WebLN layer
 * converts them), as the app's transaction row. The raw record is spread
 * first so nothing it carries (a description_hash, a field a later SDK
 * adds) is lost; the canonical names go on top.
 */
export function nwcTransactionRow(tx) {
  return {
    ...tx,
    id: tx.payment_hash || tx.paymentHash || tx.id,
    // NIP-47 states the direction itself, and its `amount` is UNSIGNED.
    // Falling back to `amount > 0` therefore matched every row, including
    // sends, and reported a spent bitcoin as income.
    type: tx.type === 'outgoing' ? 'send' : 'receive',
    amount: Math.abs(tx.amount || 0),
    timestamp: tx.settled_at || tx.settledAt || tx.created_at || tx.createdAt || null,
    created_at: tx.created_at || tx.createdAt || null,
    settled_at: tx.settled_at || tx.settledAt || null,
    description: tx.description || tx.memo || '',
    // There is no `settled` boolean on the record (see the SDK's
    // Nip47Transaction type): `state` decides, `settled_at` for a service
    // that omits it.
    status: resolveNwcStatus(tx),
    fee: tx.fees_paid || tx.feesPaid || 0,
    paymentHash: tx.payment_hash || tx.paymentHash || null,
    preimage: tx.preimage || null,
    bolt11: tx.invoice || tx.bolt11 || tx.payment_request || null,
    descriptionHash: tx.description_hash || tx.descriptionHash || null,
  };
}
