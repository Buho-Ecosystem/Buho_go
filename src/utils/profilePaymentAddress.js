import { isLightningAddress } from './addressUtils.js';

/** The existing profile default: Business Spark, then Personal Spark.
 * Reads public metadata only; choosing an address never connects a wallet. */
export function preferredProfileLightningAddress({ wallets = [], walletInfos = {} } = {}) {
  if (!Array.isArray(wallets)) return null;
  for (const account of [1, 2]) {
    const wallet = wallets.find(w => w?.type === 'spark' && w.connectionData?.accountNumber === account);
    const address = wallet && (walletInfos?.[wallet.id]?.lightningAddress || wallet.metadata?.lud16);
    if (isLightningAddress(address)) return address.toLowerCase();
  }
  return null;
}
