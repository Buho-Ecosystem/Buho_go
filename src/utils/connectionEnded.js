/**
 * A connected wallet whose other side ended the connection. Asking again
 * changes nothing; only a new connection, made in that wallet, does. So the
 * app says so once, plainly, instead of "No reply" and another retry.
 *
 * - NWC: UNAUTHORIZED. The wallet does not know this connection any more
 *   (removed in the wallet app, or expired).
 * - LNbits: 404 "Wallet not found". The key no longer opens a wallet on
 *   that server (the wallet was deleted, or its keys were reset).
 *
 * Pure.
 *
 * @param {string} walletType  'nwc' | 'lnbits' | ...
 * @param {unknown} error
 */
export function isConnectionEnded(walletType, error) {
  if (!error || typeof error !== 'object') return false;
  if (walletType === 'nwc') return error.code === 'UNAUTHORIZED';
  if (walletType === 'lnbits') return error.status === 404 && /wallet not found/i.test(String(error.message || ''));
  return false;
}
