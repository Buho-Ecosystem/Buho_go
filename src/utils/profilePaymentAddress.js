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

/**
 * What the Get paid sheet says while the profile has no payment address.
 * An identity made here is being given one ('setting-up'). One brought from
 * another app has its published profile read first ('checking', or
 * 'unreachable' when too few relays answered) and, with no address on it,
 * is offered one ('offer'): BuhoGO never sets it on its own.
 * @param {{ imported: boolean, profileChecked: boolean, unreachable: boolean, checking: boolean }} state
 * @returns {'setting-up' | 'checking' | 'unreachable' | 'offer'}
 */
export function missingAddressState({ imported, profileChecked, unreachable, checking }) {
  if (!imported) return 'setting-up';
  if (profileChecked) return 'offer';
  return unreachable && !checking ? 'unreachable' : 'checking';
}
