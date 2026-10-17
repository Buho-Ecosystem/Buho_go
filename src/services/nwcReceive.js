/**
 * Receiving through Nostr Wallet Connect, one way for every caller: create an
 * invoice on the connected wallet, and tell whether it has been paid.
 *
 * Both talk NIP-47 through the connection's own client (`nwc.client`, the
 * SDK's NWCClient) rather than the WebLN layer on top of it. The WebLN
 * methods drop what a receiving screen needs: makeInvoice returns only the
 * invoice text (no payment hash, no expiry) and lookupInvoice expects
 * `{ paymentHash }`, so a plain hash, or `{ payment_hash }`, reaches the
 * wallet as no hash at all.
 *
 * Amounts: NIP-47 speaks millisats; everything returned here is in sats.
 */
import { Invoice } from '@getalby/lightning-tools';
import { NWC_ERROR, nwcError } from '../utils/nwcErrors.js';
import { nwcCapabilities } from '../utils/nwcWallet.js';
import { checkNWCPaymentStatus } from '../utils/paymentMonitor.js';

/** How many recent incoming payments to scan when the wallet has no lookup. */
const RECENT_INCOMING = 50;

function clientOf(nwc) {
  const client = nwc?.client;
  if (!client) throw new Error('Wallet is not connected');
  return client;
}

function paymentHashOf(invoice) {
  try {
    return new Invoice({ pr: invoice }).paymentHash || null;
  } catch {
    return null;
  }
}

const toSats = (msat) => Math.floor(Math.abs(Number(msat) || 0) / 1000);

/**
 * @param {object} nwc NostrWebLNProvider (its `client` is the NIP-47 client)
 * @param {{ amountSats: number, description?: string }} request
 * @returns {Promise<{ paymentRequest: string, paymentHash: string|null, expiresAt: number|null }>}
 *   expiresAt in Unix seconds, when the wallet says
 */
export async function makeNwcInvoice(nwc, { amountSats, description = '' }) {
  const tx = await clientOf(nwc).makeInvoice({
    amount: Math.round(amountSats * 1000),
    ...(description ? { description } : {}),
  });
  if (!tx?.invoice) throw new Error('Wallet did not return an invoice');
  return {
    paymentRequest: tx.invoice,
    paymentHash: tx.payment_hash || paymentHashOf(tx.invoice),
    expiresAt: Number(tx.expires_at) > 0 ? Number(tx.expires_at) : null,
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
 * @param {object} nwc NostrWebLNProvider
 * @param {string} paymentHash
 * @param {{ methods?: string[] }} [options] the connection's saved grants (wallet.metadata.methods)
 */
export async function lookupNwcInvoice(nwc, paymentHash, { methods } = {}) {
  const client = clientOf(nwc);
  const may = nwcCapabilities(methods);

  if (may.lookup) {
    try {
      const tx = await client.lookupInvoice({ payment_hash: paymentHash });
      return checkNWCPaymentStatus(tx)
        ? { paid: true, preimage: tx.preimage || undefined, amount: toSats(tx.amount) || undefined }
        : { paid: false };
    } catch (error) {
      if (!may.history) throw error;
      // Not found, not implemented, or no answer: the list may still know.
    }
  }

  if (may.history) {
    const { transactions = [] } = await client.listTransactions({ limit: RECENT_INCOMING, unpaid: false, type: 'incoming' }) || {};
    const tx = transactions.find((t) => t?.payment_hash === paymentHash);
    return tx && checkNWCPaymentStatus(tx)
      ? { paid: true, preimage: tx.preimage || undefined, amount: toSats(tx.amount) || undefined }
      : { paid: false };
  }

  throw nwcError(NWC_ERROR.CONFIRM_NOT_ALLOWED, 'This connection cannot confirm payments');
}
