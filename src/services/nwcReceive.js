/**
 * Receiving through Nostr Wallet Connect, one way for every caller: create an
 * invoice on the connected wallet, tell whether it has been paid, and hear
 * about every payment the wallet receives (services/walletWatch).
 *
 * Invoices and lookups talk NIP-47 through the connection's own client
 * (`nwc.client`, the SDK's NWCClient) rather than the WebLN layer on top of
 * it (the payment list below reads WebLN's, which converts to sats). The WebLN
 * methods drop what a receiving screen needs: makeInvoice returns only the
 * invoice text (no payment hash, no expiry) and lookupInvoice expects
 * `{ paymentHash }`, so a plain hash, or `{ payment_hash }`, reaches the
 * wallet as no hash at all.
 *
 * Amounts: NIP-47 speaks millisats; everything returned here is in sats.
 */
import { Invoice } from '@getalby/lightning-tools';
import { NWC_ERROR, nwcError } from '../utils/nwcErrors.js';
import { nwcCapabilities, nwcTransactionRow } from '../utils/nwcWallet.js';
import { checkNWCPaymentStatus } from '../utils/paymentMonitor.js';

/** How many recent incoming payments to scan when the wallet has no lookup. */
const RECENT_INCOMING = 50;

/**
 * How long one lookup_invoice may take. The SDK waits 60 s for that reply;
 * a screen polling every few seconds would stall on a silent wallet.
 */
export const LOOKUP_WAIT_MS = 10000;

function clientOf(nwc) {
  const client = nwc?.client;
  if (!client) throw new Error('Wallet is not connected');
  return client;
}

/** The payment hash and expiry (Unix seconds) written in the invoice itself. */
function decodeInvoice(invoice) {
  try {
    const decoded = new Invoice({ pr: invoice });
    const expiry = decoded.expiryDate instanceof Date ? Math.floor(decoded.expiryDate.getTime() / 1000) : null;
    return { paymentHash: decoded.paymentHash || null, expiresAt: expiry > 0 ? expiry : null };
  } catch {
    return { paymentHash: null, expiresAt: null };
  }
}

/** The answer, or a NO_ANSWER error once `ms` passed (the request itself runs on). */
function withinWait(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(nwcError(NWC_ERROR.NO_ANSWER, 'No answer to the lookup')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const toSats = (msat) => Math.floor(Math.abs(Number(msat) || 0) / 1000);

/**
 * @param {object} nwc NostrWebLNProvider (its `client` is the NIP-47 client)
 * @param {{ amountSats: number, description?: string }} request
 * @returns {Promise<{ paymentRequest: string, paymentHash: string|null, expiresAt: number|null }>}
 *   expiresAt in Unix seconds: the wallet's, else the invoice's own, so a
 *   screen watching it always knows when to stop
 */
export async function makeNwcInvoice(nwc, { amountSats, description = '' }) {
  const tx = await clientOf(nwc).makeInvoice({
    amount: Math.round(amountSats * 1000),
    ...(description ? { description } : {}),
  });
  if (!tx?.invoice) throw new Error('Wallet did not return an invoice');
  const written = decodeInvoice(tx.invoice);
  return {
    paymentRequest: tx.invoice,
    paymentHash: tx.payment_hash || written.paymentHash,
    expiresAt: Number(tx.expires_at) > 0 ? Number(tx.expires_at) : written.expiresAt,
  };
}

/**
 * Whether the invoice for `paymentHash` has been paid, in the shape the
 * payment monitor reads: `{ paid, preimage?, amount? }`.
 *
 * Uses lookup_invoice when the connection may; otherwise, or when the
 * wallet cannot find the invoice (some index invoices only once paid), the
 * recent incoming payments (list_transactions). A connection allowed
 * neither cannot confirm a payment at all and says so.
 *
 * Paid means the record says settled (utils/paymentMonitor
 * checkNWCPaymentStatus); a preimage alone never does, since wallets may
 * return one for an unpaid invoice.
 *
 * @param {object} nwc NostrWebLNProvider
 * @param {string} paymentHash
 * @param {{ methods?: string[] }} [options] the connection's saved grants (wallet.metadata.methods)
 */
export async function lookupNwcInvoice(nwc, paymentHash, { methods } = {}) {
  const client = clientOf(nwc);
  const may = nwcCapabilities(methods);

  if (may.lookup) {
    let tx;
    try {
      tx = await withinWait(client.lookupInvoice({ payment_hash: paymentHash }), LOOKUP_WAIT_MS);
    } catch (error) {
      if (!may.history) {
        // Some wallets only know an invoice once it is paid: not yet.
        if (error?.code === 'NOT_FOUND') return { paid: false };
        throw error;
      }
      // Not found, not implemented, or no answer: the list may still know.
      return fromRecentIncoming(client, paymentHash);
    }
    if (!checkNWCPaymentStatus(tx)) return { paid: false };
    if (typeof tx.state === 'string' && tx.state) return paidFrom(tx);
    // A record without `state` that looks settled cannot always be believed:
    // the LNbits NWC extension sets settled_at (to the creation time) on an
    // incoming invoice its node marked failed when it expired, exactly as on
    // a paid one. Its payment list holds settled payments only, so it
    // decides when the connection may read it.
    if (may.history) {
      try {
        return await fromRecentIncoming(client, paymentHash);
      } catch (error) {
        // Grants never saved: the list was only assumed. Use the expiry rule.
        if (may.known) throw error;
      }
    }
    // Without the list, an invoice that has not expired cannot have failed
    // by expiring. Past expiry a paid and a failed invoice look the same, so
    // say so rather than guess either way (a screen offers to check again).
    const expiresAt = Number(tx.expires_at);
    if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) {
      throw nwcError(NWC_ERROR.RECEIPT_UNKNOWN, 'The wallet cannot tell whether this expired invoice was paid');
    }
    return paidFrom(tx);
  }

  if (may.history) return fromRecentIncoming(client, paymentHash);

  throw nwcError(NWC_ERROR.CONFIRM_NOT_ALLOWED, 'This connection cannot confirm payments');
}

/** A preimage of all zeros is a wallet's placeholder, not proof of anything. */
function realPreimage(preimage) {
  return typeof preimage === 'string' && /[1-9a-f]/i.test(preimage) ? preimage : undefined;
}

function paidFrom(tx) {
  return { paid: true, preimage: realPreimage(tx.preimage), amount: toSats(tx.amount) || undefined };
}

/** The invoice among the recent incoming payments, paid only when settled there. */
async function fromRecentIncoming(client, paymentHash) {
  const { transactions = [] } = await client.listTransactions({ limit: RECENT_INCOMING, unpaid: false, type: 'incoming' }) || {};
  const tx = transactions.find((t) => t?.payment_hash === paymentHash);
  return tx && checkNWCPaymentStatus(tx) ? paidFrom(tx) : { paid: false };
}

// ---- Every payment the wallet receives (services/walletWatch) -----------

/** True when this connection was granted payment_received notifications. */
export function notifiesPayments(wallet) {
  const list = wallet?.metadata?.notifications;
  return Array.isArray(list) && list.includes('payment_received');
}

/**
 * Hear about received payments as the wallet announces them (NWC-02), over
 * the connection's own client and relays. The SDK keeps the subscription:
 * each relay reconnects on its own with backoff, and closing the
 * connection ends it. A notification only says "look now"
 * (`onActivity({ paymentHash })`); the payment is read before it counts.
 *
 * `revive({ returned })` subscribes afresh, so a relay waiting out a long
 * backoff while the app was away is opened now. Without a return it does
 * so only when no relay is connected. The SDK sends no heartbeat, so a
 * socket that died silently is not seen here; the caller's catch-up read
 * covers that.
 *
 * @param {object} nwc NostrWebLNProvider
 * @param {(hint: { paymentHash?: string }) => void} onActivity
 * @returns {Promise<{ stop: () => void, revive: (opts?: { returned?: boolean }) => void }>}
 */
export async function watchNwcPayments(nwc, onActivity) {
  const client = clientOf(nwc);
  let unsubscribe = null;
  let stopped = false;

  const subscribe = async () => {
    const next = await client.subscribeNotifications((notification) => {
      if (stopped) return;
      const hash = String(notification?.notification?.payment_hash || '').toLowerCase();
      onActivity(/^[0-9a-f]{64}$/.test(hash) ? { paymentHash: hash } : {});
    }, ['payment_received']);
    if (stopped) { next(); return; }
    const previous = unsubscribe;
    unsubscribe = next;
    previous?.();
  };

  await subscribe();
  return {
    stop: () => {
      stopped = true;
      const current = unsubscribe;
      unsubscribe = null;
      current?.();
    },
    revive: ({ returned = false } = {}) => {
      if (stopped || (!returned && client.connected)) return;
      subscribe().catch(() => { /* the next revive tries again */ });
    },
  };
}

/**
 * Settled payments of the connection, newest first, as transaction rows.
 * Errors are thrown: an empty list must mean "no payments", never "could
 * not read".
 */
export async function listNwcPayments(nwc, { offset = 0, limit = 50 } = {}) {
  const result = await nwc.listTransactions({ limit, offset, unpaid: false });
  return (result?.transactions || []).map(nwcTransactionRow);
}

/**
 * One payment by its hash, as a transaction row, when the connection may
 * look invoices up; null otherwise or when the wallet does not know it. A
 * record without `state` is not believed on its own (see lookupNwcInvoice):
 * the list read decides those.
 *
 * @param {object} nwc NostrWebLNProvider
 * @param {string} paymentHash
 * @param {{ methods?: string[] }} [options] the connection's saved grants
 */
export async function findNwcPayment(nwc, paymentHash, { methods } = {}) {
  if (!nwcCapabilities(methods).lookup) return null;
  let tx;
  try {
    tx = await withinWait(clientOf(nwc).lookupInvoice({ payment_hash: paymentHash }), LOOKUP_WAIT_MS);
  } catch (error) {
    if (error?.code === 'NOT_FOUND') return null;
    throw error;
  }
  if (!tx || typeof tx.state !== 'string' || !tx.state) return null;
  return nwcTransactionRow({ ...tx, amount: toSats(tx.amount), fees_paid: toSats(tx.fees_paid) });
}
