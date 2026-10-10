/**
 * Whether a wallet may be removed from this device, and what the person has
 * to hear first. Pure: the store enforces the verdict, the UI words it.
 *
 * Spark wallets share one recovery phrase, so removing one that is not the
 * last never loses money: adding a wallet again opens the same account. The
 * rules still keep money visible:
 *   - nothing is removed while an emergency exit or an incoming on-chain
 *     deposit is under way (both need this wallet's databases);
 *   - a wallet holding money is emptied first (Move funds), unless it is the
 *     last Spark wallet;
 *   - the last Spark wallet takes the phrase off this device, so it may only
 *     go once the phrase is backed up, unless it is known to be empty.
 */

/**
 * @param {object} input
 * @param {object} input.wallet             the wallet entry
 * @param {number} input.sparkWalletCount   Spark wallets on the device, this one included
 * @param {{known: boolean, value: number}} input.balance
 * @param {boolean} input.hasPendingDeposit an on-chain deposit is waiting to be claimed
 * @param {boolean} input.hasActiveExit     an emergency exit is under way
 * @param {boolean} input.backedUp          the recovery phrase is confirmed backed up
 * @returns {{ allowed: boolean, blockers: string[], notes: string[] }}
 *   blockers: 'exit_in_progress' | 'deposit_pending' | 'has_balance' | 'needs_backup'
 *   notes:    'last_spark_wallet' | 'balance_unknown'
 */
export function removalCheck({ wallet, sparkWalletCount = 0, balance = { known: false, value: 0 }, hasPendingDeposit = false, hasActiveExit = false, backedUp = false }) {
  const blockers = [];
  const notes = [];
  if (wallet?.type !== 'spark') return { allowed: true, blockers, notes };

  const last = sparkWalletCount <= 1;
  const empty = balance.known && !(balance.value > 0);
  if (last) notes.push('last_spark_wallet');
  if (!balance.known) notes.push('balance_unknown');

  if (hasActiveExit) blockers.push('exit_in_progress');
  if (hasPendingDeposit) blockers.push('deposit_pending');
  if (!last && balance.known && balance.value > 0) blockers.push('has_balance');
  if (last && !empty && !backedUp) blockers.push('needs_backup');

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
const BLOCKER_ORDER = ['exit_in_progress', 'deposit_pending', 'needs_backup', 'has_balance'];

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
    default:
      break;
  }

  if (wallet?.type !== 'spark') {
    return { blocked: false, title: t('Remove Wallet'), confirmLabel: t('Remove Wallet'), message: t('Are you sure you want to remove "{name}"? This action cannot be undone.', { name }) };
  }
  const kitNote = t('The last saved exit kit stays on this phone in case you add the wallet again with the same words.');
  if (check.notes.includes('last_spark_wallet')) {
    return {
      blocked: false,
      title: t('Remove Spark from this phone?'),
      confirmLabel: t('Remove'),
      message: `${t('This removes your last Spark wallet and its recovery phrase from this phone. You can restore it any time with your recovery phrase.')} ${kitNote}`,
    };
  }
  const unknown = check.notes.includes('balance_unknown')
    ? ` ${t('Its balance could not be checked right now. Any money in it stays with your recovery phrase.')}`
    : '';
  return {
    blocked: false,
    title: t('Remove {name}?', { name }),
    confirmLabel: t('Remove'),
    message: `${t('It disappears from this phone. Your recovery phrase still covers it, so it can come back when you add wallets again.')}${unknown}`,
  };
}
