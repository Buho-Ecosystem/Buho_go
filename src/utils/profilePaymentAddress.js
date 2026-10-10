import { isLightningAddress } from './addressUtils.js';
import { SPARK_ACCOUNT_ORDER, sparkAccountNumberOf } from './sparkAccounts.js';

/**
 * The profile's default payment address: the oldest Spark wallet that has a
 * Lightning address (creation time, then account order, so a former
 * Business/Personal pair keeps answering with Business). Reads public
 * metadata only; choosing an address never connects a wallet.
 */
export function preferredProfileLightningAddress({ wallets = [], walletInfos = {} } = {}) {
  if (!Array.isArray(wallets)) return null;
  const rank = (wallet) => SPARK_ACCOUNT_ORDER.indexOf(sparkAccountNumberOf(wallet));
  const spark = wallets
    .filter(w => w?.type === 'spark')
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || rank(a) - rank(b));
  for (const wallet of spark) {
    const address = walletInfos?.[wallet.id]?.lightningAddress || wallet.metadata?.lud16;
    if (isLightningAddress(address)) return address.toLowerCase();
  }
  return null;
}
