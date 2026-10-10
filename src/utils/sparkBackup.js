/**
 * The Spark part of the Drive backup: which wallets the recovery phrase
 * covers on this device, so a restore brings them back exactly, names
 * included.
 *
 * Payload shape (inside the encrypted envelope, payload v2, additive):
 *   spark: {
 *     mnemonic, network,
 *     accounts: [{ accountNumber, name, lud16, sparkAddress }, ...],
 *   }
 * Older apps ignore `accounts` and restore the phrase as before. Backups
 * written before the field existed are read through their exit kits, which
 * have always carried each wallet's account number.
 *
 * Pure module. Everything read from a payload is checked: a backup is our
 * own encrypted file, but nothing in it may reach the store unvalidated.
 */

import { isSparkAccountNumber, sparkAccountNumberOf, SPARK_ACCOUNT_ORDER, MAX_SPARK_WALLETS } from './sparkAccounts.js';
import { normalizeWalletName, MAX_WALLET_NAME_LENGTH } from './walletNames.js';
import { isLightningAddress } from './addressUtils.js';

const NETWORKS = new Set(['MAINNET', 'REGTEST']);

/** The wallet list a backup carries, in allocation order. */
export function sparkAccountsForBackup(wallets) {
  return (wallets || [])
    .filter(w => w?.type === 'spark')
    .map(w => ({
      accountNumber: sparkAccountNumberOf(w),
      name: normalizeWalletName(w.name),
      lud16: isLightningAddress(w.metadata?.lud16) ? w.metadata.lud16 : null,
      sparkAddress: typeof w.metadata?.sparkAddress === 'string' ? w.metadata.sparkAddress : null,
    }))
    .sort((a, b) => SPARK_ACCOUNT_ORDER.indexOf(a.accountNumber) - SPARK_ACCOUNT_ORDER.indexOf(b.accountNumber));
}

/** The backed-up network, or MAINNET when missing or unknown. */
export function sparkNetworkFromBackup(spark) {
  const network = String(spark?.network || 'MAINNET').toUpperCase();
  return NETWORKS.has(network) ? network : 'MAINNET';
}

/**
 * The wallets a payload lists, validated: `spark.accounts` when present,
 * else the accounts its exit kits name (no names), else empty (the restore
 * then finds the accounts by scanning).
 * @returns {{accountNumber: number, name: string}[]}
 */
export function sparkAccountsFromBackup(payload) {
  const listed = Array.isArray(payload?.spark?.accounts) ? payload.spark.accounts : null;
  const source = listed || (Array.isArray(payload?.exitKits) ? payload.exitKits : []);
  const seen = new Set();
  const accounts = [];
  for (const entry of source) {
    const accountNumber = entry?.accountNumber;
    if (!isSparkAccountNumber(accountNumber) || seen.has(accountNumber)) continue;
    seen.add(accountNumber);
    const name = listed && typeof entry.name === 'string' ? normalizeWalletName(entry.name) : '';
    accounts.push({ accountNumber, name: [...name].length <= MAX_WALLET_NAME_LENGTH ? name : '' });
  }
  return accounts
    .sort((a, b) => SPARK_ACCOUNT_ORDER.indexOf(a.accountNumber) - SPARK_ACCOUNT_ORDER.indexOf(b.accountNumber))
    .slice(0, MAX_SPARK_WALLETS);
}
