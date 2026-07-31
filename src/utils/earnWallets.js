/**
 * Wallet eligibility for Learn & Earn rewards.
 *
 * Arkade receives Lightning through a reverse swap. Its incoming minimum is
 * higher than the reward program can pay, so it must never be offered or used
 * as a Learn & Earn payout destination.
 */

const UNSUPPORTED_EARN_PAYOUT_WALLET_TYPES = new Set(['arkade']);

function walletType(wallet) {
  return typeof wallet?.type === 'string' ? wallet.type.toLowerCase() : '';
}

/**
 * Returns whether a wallet can receive a Learn & Earn Lightning payout.
 *
 * @param {unknown} wallet
 * @returns {boolean}
 */
export function isEarnPayoutWallet(wallet) {
  return Boolean(wallet) && !UNSUPPORTED_EARN_PAYOUT_WALLET_TYPES.has(walletType(wallet));
}

/**
 * Filters a wallet collection to Learn & Earn payout destinations.
 *
 * @param {unknown} wallets
 * @returns {Array<object>}
 */
export function getEarnPayoutWallets(wallets) {
  return Array.isArray(wallets) ? wallets.filter(isEarnPayoutWallet) : [];
}

/**
 * Resolves a saved Learn & Earn payout wallet only when it remains eligible.
 * This deliberately returns null for stale Arkade selections rather than
 * silently redirecting a reward to a different wallet.
 *
 * @param {unknown} wallets
 * @param {unknown} walletId
 * @returns {object|null}
 */
export function findEarnPayoutWallet(wallets, walletId) {
  if (typeof walletId !== 'string' || !walletId) return null;
  return getEarnPayoutWallets(wallets).find((wallet) => wallet.id === walletId) || null;
}
