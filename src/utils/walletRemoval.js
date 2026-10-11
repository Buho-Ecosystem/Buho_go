/**
 * Whether a wallet may be removed from this device, and what the person has
 * to hear first. Pure: the store enforces the verdict, the UI words it.
 *
 * Spark wallets share one recovery phrase, so a removed wallet's account
 * comes back when a wallet is added again, but only while the phrase is on
 * this device or backed up. The rules:
 *   - nothing is removed while an emergency exit or an incoming on-chain
 *     deposit is under way (both need this wallet's databases);
 *   - a wallet that is not the last one goes only once the network has just
 *     confirmed it empty. A saved or unknown balance proves nothing: money
 *     may have arrived since, and once the phrase leaves the device no other
 *     check would ever look at this account again;
 *   - the last Spark wallet takes the phrase off this device, so it goes
 *     only once the phrase is backed up, whatever its balance. Its address
 *     keeps receiving, and every removed account still belongs to the phrase.
 */

/**
 * @param {object} input
 * @param {object} input.wallet             the wallet entry
 * @param {number} input.sparkWalletCount   Spark wallets on the device, this one included
 * @param {{known: boolean, value: number, fresh?: boolean}} input.balance
 *   `fresh`: the value was verified with the network moments ago
 * @param {boolean} input.hasPendingDeposit an on-chain deposit is waiting to be claimed
 * @param {boolean} input.hasActiveExit     an emergency exit is under way
 * @param {boolean} input.backedUp          the recovery phrase is confirmed backed up
 * @returns {{ allowed: boolean, blockers: string[], notes: string[] }}
 *   blockers: 'exit_in_progress' | 'deposit_pending' | 'has_balance' | 'balance_unverified' | 'needs_backup'
 *   notes:    'last_spark_wallet'
 */
export function removalCheck({ wallet, sparkWalletCount = 0, balance = { known: false, value: 0 }, hasPendingDeposit = false, hasActiveExit = false, backedUp = false }) {
  const blockers = [];
  const notes = [];
  if (wallet?.type !== 'spark') return { allowed: true, blockers, notes };

  const last = sparkWalletCount <= 1;
  if (last) notes.push('last_spark_wallet');

  if (hasActiveExit) blockers.push('exit_in_progress');
  if (hasPendingDeposit) blockers.push('deposit_pending');
  if (last) {
    if (!backedUp) blockers.push('needs_backup');
  } else if (balance.known && balance.value > 0) {
    blockers.push('has_balance');
  } else if (!(balance.known && balance.fresh === true)) {
    blockers.push('balance_unverified');
  }

  return { allowed: blockers.length === 0, blockers, notes };
}

/** Thrown by the store when a removal is refused; `blockers` drive the copy. */
export class WalletRemovalError extends Error {
  constructor(blockers) {
    super(`Wallet cannot be removed: ${blockers.join(', ')}`);
    this.code = 'WALLET_REMOVAL_BLOCKED';
    this.blockers = blockers;
  }
}

// Most pressing first: one reason is shown at a time.
const BLOCKER_ORDER = ['exit_in_progress', 'deposit_pending', 'needs_backup', 'has_balance', 'balance_unverified'];

/**
 * What to tell the person about removing `wallet`, from a removalCheck
 * verdict. `t` is the i18n translate function; `formatAmount` formats sats.
 *
 * @returns {{ blocked: true, title: string, message: string, action: null|'backup'|'move_funds', actionLabel?: string }
 *         | { blocked: false, title: string, message: string, confirmLabel: string }}
 */
export function removalCopy({ check, wallet, t, formatAmount = (sats) => `${sats} sats`, balanceSats = 0 }) {
  const name = wallet?.name || t('Wallet');
  const blocker = BLOCKER_ORDER.find(code => check.blockers.includes(code));
  switch (blocker) {
    case 'exit_in_progress':
      return { blocked: true, action: null, title: t('Emergency exit in progress'), message: t('{name} can be removed once its emergency exit has finished.', { name }) };
    case 'deposit_pending':
      return { blocked: true, action: null, title: t('Bitcoin is on its way'), message: t('A Bitcoin deposit to {name} is waiting to be added. Add it to the wallet or send it back first, then remove the wallet.', { name }) };
    case 'needs_backup':
      return { blocked: true, action: 'backup', actionLabel: t('Back up now'), title: t('Back up your recovery phrase first'), message: t('This is your last Spark wallet. Removing it takes the recovery phrase off this phone, and only the phrase can bring the money back.') };
    case 'has_balance':
      return { blocked: true, action: 'move_funds', actionLabel: t('Move funds'), title: t('Move the money first'), message: t('{name} still holds {amount}. Move it to another wallet first, then remove this one.', { name, amount: formatAmount(balanceSats) }) };
    case 'balance_unverified':
      return { blocked: true, action: null, title: t('Balance not checked'), message: t('{name} can be removed once its balance shows it is empty. Check your connection and try again.', { name }) };
    default:
      break;
  }

  if (wallet?.type !== 'spark') {
    return { blocked: false, title: t('Remove Wallet'), confirmLabel: t('Remove Wallet'), message: t('Are you sure you want to remove "{name}"? This action cannot be undone.', { name }) };
  }
  const kitNote = t('The last saved exit kit stays on this phone in case you add the wallet again with the same recovery phrase.');
  if (check.notes.includes('last_spark_wallet')) {
    return {
      blocked: false,
      title: t('Remove Spark from this phone?'),
      confirmLabel: t('Remove'),
      message: `${t('This removes your last Spark wallet and its recovery phrase from this phone. You can restore it any time with your recovery phrase.')} ${kitNote}`,
    };
  }
  return {
    blocked: false,
    title: t('Remove {name}?', { name }),
    confirmLabel: t('Remove'),
    message: t('{name} disappears from this phone. It stays part of your recovery phrase, so adding a Spark wallet later brings it back.', { name }),
  };
}
