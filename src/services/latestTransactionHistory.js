/**
 * Home's history read must distinguish an empty wallet from a failed read.
 * The legacy provider getTransactions wrappers for LNbits/NWC swallow errors;
 * use the same strict APIs as the application-owned receipt watch instead.
 * Read only the captured owner: connecting/replacing wallets belongs to the
 * wallet store and invalidates this preview read through its selection guard.
 */
import { listNwcPayments } from './nwcReceive.js';
import { capabilitiesOf } from '../utils/nwcWallet.js';
import { paymentTimeMs } from './recipientPayments.js';

export async function readLatestTransactionHistory({ wallet, walletType, owner }, { limit = 20, receipt = null } = {}) {
  const type = walletType || wallet?.type || 'nwc';
  if (!capabilitiesOf(wallet).history) return { rows: [], unsupported: true };
  if (!owner) throw Object.assign(new Error('Wallet is not connected'), { code: 'NOT_CONNECTED' });
  let result;
  let receiptOrderingUnknown = false;
  if (type === 'nwc') {
    result = await listNwcPayments(owner, { limit, offset: 0 });
  } else if (type === 'lnbits') {
    // LNbits lists an invoice by creation time even when it was paid much
    // later. Its verified lookup exposes updated_at as the settlement time.
    // Reconcile the identified receipt with that lookup so an old invoice
    // paid now cannot disappear behind yesterday's send.
    const hash = receipt?.paymentHash || receipt?.paymentId;
    const [listed, paid] = await Promise.all([
      owner.listPayments({ limit, offset: 0 }),
      hash && typeof owner.getPayment === 'function' ? owner.getPayment(hash) : null,
    ]);
    result = listed;
    if (paid && ['receive', 'incoming'].includes(paid.type) && paid.status === 'completed') {
      const rows = Array.isArray(listed) ? listed : listed?.transactions;
      if (!Array.isArray(rows)) throw new Error('Invalid preview history response');
      const same = row => ['receive', 'incoming'].includes(row.type)
        && (row.id === paid.id || (row.paymentHash && row.paymentHash === paid.paymentHash));
      // Keep the send half of an invoice a wallet paid to itself.
      // The app already knew the receipt at observedAt. An updated_at later
      // than that can be a metadata edit while history was delayed, rather
      // than settlement. Treat its ordering as unknown instead of letting
      // the edit promote the receipt above a send made after observation.
      const afterObservation = !receipt?.settledAt && receipt?.observedAt
        && paid.settled_at && paymentTimeMs(paid) > receipt.observedAt;
      const reconciled = afterObservation ? { ...paid, settled_at: null, receiptTimeIsCreation: true } : paid;
      result = [reconciled, ...rows.filter(row => !same(row))];
      receiptOrderingUnknown = reconciled.receiptTimeIsCreation === true && !receipt?.settledAt;
    }
  } else if (typeof owner.getTransactions === 'function') {
    result = await owner.getTransactions({ limit, offset: 0 });
  } else {
    return { rows: [], unsupported: true };
  }
  const rows = Array.isArray(result) ? result : result?.transactions;
  if (!Array.isArray(rows)) throw new Error('Invalid preview history response');
  if (receipt && !receipt.settledAt) {
    const key = value => /^[a-f\d]{64}$/i.test(String(value)) ? String(value).toLowerCase() : String(value);
    const keys = new Set([receipt.paymentId, receipt.paymentHash, ...(receipt.aliases || [])].filter(Boolean).map(key));
    const matching = rows.find(row => ['receive', 'incoming'].includes(row.type) && row.status === 'completed'
      && [row.id, row.paymentHash, ...(row.aliases || [])].filter(Boolean).some(value => keys.has(key(value))));
    // Lookup may have no own-wallet details, and older NWC services may
    // report settled state without its time. Neither proves creation order
    // is settlement order when a competing send exists.
    receiptOrderingUnknown ||= matching?.receiptTimeIsCreation === true;
  }
  return { ...(receiptOrderingUnknown ? { receiptOrderingUnknown: true } : {}), rows: type === 'arkade' ? rows.map(row => (
    // Arkade has no unpaid invoices: a pending receive in its contract
    // history represents actual boarding funds awaiting settlement.
    row.type === 'incoming' && row.status === 'pending' ? { ...row, fundsPending: true } : row
  )) : rows };
}
