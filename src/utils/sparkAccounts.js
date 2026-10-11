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
 * Slots are deterministic: a wallet deleted and added again opens the same
 * account, with its history and its reserved Lightning address.
 *
 * Pure module: no store, no SDK. Everything that needs to know which account
 * a wallet is, which one comes next, or whether a scanned account is worth
 * restoring asks here.
 */

/** Allocation order. Its length is the wallet limit. */
export const SPARK_ACCOUNT_ORDER = Object.freeze([1, 2, 3, 4, 5, 0]);
export const MAX_SPARK_WALLETS = SPARK_ACCOUNT_ORDER.length;

const SPARK = 'spark';

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

export function sparkWalletsOf(wallets) {
  return (wallets || []).filter(w => w?.type === SPARK);
}

/** Account numbers already opened by a Spark wallet. */
export function usedSparkAccounts(wallets) {
  return new Set(sparkWalletsOf(wallets).map(sparkAccountNumberOf));
}

/** The account the next added wallet opens, or null when every slot is taken. */
export function nextFreeSparkAccount(wallets) {
  const used = usedSparkAccounts(wallets);
  return SPARK_ACCOUNT_ORDER.find(account => !used.has(account)) ?? null;
}

/** How many more Spark wallets fit. */
export function remainingSparkSlots(wallets) {
  return Math.max(0, MAX_SPARK_WALLETS - sparkWalletsOf(wallets).length);
}

export function canAddSparkWallet(wallets) {
  return remainingSparkSlots(wallets) > 0 && nextFreeSparkAccount(wallets) !== null;
}

/**
 * Whether a scanned account was ever used. Opening an empty account must not
 * manufacture a wallet, so only evidence on the network counts: money, a
 * payment, a deposit waiting to be claimed, or a registered Lightning address
 * (every wallet BuhoGO ever opened registered one).
 */
export function isRestorableAccount(evidence) {
  if (!evidence) return false;
  return Number(evidence.balanceSats) > 0
    || Number(evidence.paymentCount) > 0
    || !!evidence.hasUnclaimedDeposit
    || !!evidence.lightningAddress;
}

/**
 * A scan result is conclusive when the account was synced with the network,
 * or when it already shows evidence (evidence cannot be undone by syncing).
 * An unsynced, empty-looking account is checked again later.
 */
export function isConclusiveScan(evidence) {
  return !!evidence && (evidence.synced === true || isRestorableAccount(evidence));
}

/**
 * A default name that no wallet uses yet: `base`, then `base 2`, `base 3`...
 * Compared case-blind, the same way names are validated.
 */
export function suggestWalletName(base, wallets) {
  const taken = new Set((wallets || []).map(w => String(w?.name || '').trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
