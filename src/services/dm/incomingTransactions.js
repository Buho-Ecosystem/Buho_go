/**
 * The incoming payments of the user's wallets, reduced to what the chat needs
 * to check a payment claim (`paymentConfirmation.js`).
 *
 * Reads each connected wallet's own history (`provider.getTransactions`), the
 * same source the contact page's "Between you" list uses, and keeps settled
 * incoming transactions only. A wallet that cannot answer (locked, offline,
 * no history API) contributes nothing: the claim then stays what it is, the
 * partner's words.
 *
 * Pure: providers and the normaliser are passed in.
 */

const SECONDS_BOUNDARY = 1e12;

/** A transaction time as unix seconds, whether the wallet reports seconds, milliseconds or a date string. */
function toSeconds(tx) {
  const raw = tx?.settled_at ?? tx?.created_at ?? tx?.timestamp ?? tx?.time;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.floor(raw < SECONDS_BOUNDARY ? raw : raw / 1000);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

/**
 * @param {object} input
 * @param {Array<{ id: string, type?: string }>} input.wallets
 * @param {(walletId: string) => { getTransactions?: Function } | null | undefined} input.getProvider
 * @param {(raw: object, options: { walletType: string }) => object} input.normalizeTx
 * @param {number} [input.limit] History rows asked of each wallet.
 * @returns {Promise<import('./paymentConfirmation.js').IncomingTransaction[]>}
 */
export async function loadIncomingTransactions({ wallets, getProvider, normalizeTx, limit = 50 }) {
  const batches = await Promise.all((wallets ?? []).map(async (wallet) => {
    const provider = getProvider(wallet.id);
    if (typeof provider?.getTransactions !== 'function') return [];
    try {
      const result = await provider.getTransactions({ limit, offset: 0 });
      const rows = Array.isArray(result) ? result : (result?.transactions ?? []);
      const found = [];
      for (const row of rows) {
        const tx = normalizeTx(row, { walletType: wallet.type });
        if (tx.type !== 'incoming' || ['pending', 'failed', 'expired'].includes(tx.status)) continue;
        const settledAt = toSeconds(tx);
        const amountSats = tx.recipientSats || Math.abs(Number(tx.amount) || 0);
        if (settledAt === null || !Number.isSafeInteger(amountSats) || amountSats <= 0) continue;
        found.push({ amountSats, settledAt, paymentHash: tx.paymentHash || null });
      }
      return found;
    } catch {
      return [];
    }
  }));
  return batches.flat();
}
