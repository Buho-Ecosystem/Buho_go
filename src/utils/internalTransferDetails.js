import { Invoice } from '@getalby/lightning-tools';

// Spark IDs identify SDK payments; Lightning wallets identify the payment
// by its hash. A preimage is a proof, never a transaction ID.
export function internalTransferTransactionId(walletType, paymentResult, invoice) {
  if (walletType === 'spark') return paymentResult?.id || null;
  const hash = paymentResult?.paymentHash || paymentResult?.payment_hash;
  if (hash) return hash;
  if (invoice) {
    try { return new Invoice({ pr: invoice }).paymentHash || null; }
    catch { /* A missing optional link must not turn a paid transfer into failure. */ }
  }
  return paymentResult?.id || null;
}

export function internalTransferDetailsRoute(transactionId, walletId) {
  if (!transactionId || !walletId) return null;
  return {
    path: `/transaction/${encodeURIComponent(transactionId)}`,
    query: { wallet: walletId },
  };
}
