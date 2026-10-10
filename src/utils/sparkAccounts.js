/**
 * Spark account slots: the single source of truth for how Spark wallets map
 * onto the one recovery phrase.
 *
 * Every Spark wallet is the same phrase opened at a different Breez account
 * number (`SdkBuilder.withAccountNumber`). Six slots exist, accounts 0..5.
 * New wallets take the lowest free slot in `SPARK_ACCOUNT_ORDER`: account 1
 * first (the SDK's mainnet default, what every install has used since the
 * pair), account 0 last (older restores already sit there, so it stays a
 * normal slot rather than a special case).
 *
 * Pure module: no store, no SDK. Everything that needs to know which account
 * a wallet is, or which one comes next, asks here.
 */

/** Allocation order. Its length is the wallet limit. */
export const SPARK_ACCOUNT_ORDER = Object.freeze([1, 2, 3, 4, 5, 0]);
export const MAX_SPARK_WALLETS = SPARK_ACCOUNT_ORDER.length;

/** True for an account number a Spark wallet may use. */
export function isSparkAccountNumber(value) {
  return Number.isInteger(value) && SPARK_ACCOUNT_ORDER.includes(value);
}

/**
 * The account a wallet entry opens. Entries written before account numbers
 * were stored fall back to the SDK default the provider uses: 1 on mainnet,
 * 0 on regtest.
 */
export function sparkAccountNumberOf(wallet) {
  const stored = wallet?.connectionData?.accountNumber;
  if (Number.isInteger(stored)) return stored;
  const network = String(wallet?.connectionData?.network || 'MAINNET').toUpperCase();
  return network === 'MAINNET' ? 1 : 0;
}
