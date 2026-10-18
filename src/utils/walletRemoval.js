/**
 * Taking a wallet off this phone: whether it may go now, and what to say.
 * Pure: the store enforces the verdict, the screens word it.
 *
 * BuhoGO never deletes a wallet; it is an interface to wallets that live on
 * their own network or service. What leaves this phone depends on the kind:
 *
 *   - On this phone (Spark, Arkade): BuhoGO holds the recovery phrase. The
 *     wallet is *removed from this phone*; its phrase brings it back.
 *   - Connected (NWC, LNbits): BuhoGO holds only a connection. The wallet is
 *     *disconnected*; it and its money stay where they live.
 *
 * Rules for a wallet on this phone:
 *   - nothing is removed while an emergency exit or an incoming on-chain
 *     deposit is under way (both need the wallet's databases);
 *   - Spark wallets share one phrase. One that is not the last goes only
 *     once the network has just confirmed it empty: a saved or unknown
 *     balance proves nothing, and once its account leaves no other check
 *     would ever look at it again;
 *   - the last Spark wallet, and an Arkade wallet (its own phrase), take
 *     their phrase off this phone. They go once that phrase is backed up;
 *     an Arkade wallet just confirmed empty may also go without one.
 */

export const WALLET_KIND = Object.freeze({ ON_PHONE: 'on_phone', CONNECTED: 'connected' });

const ON_PHONE_TYPES = ['spark', 'arkade'];

/** 'on_phone' when this phone holds the wallet's recovery phrase, else 'connected'. */
export function walletKind(wallet) {
  return ON_PHONE_TYPES.includes(wallet?.type) ? WALLET_KIND.ON_PHONE : WALLET_KIND.CONNECTED;
}

/**
 * @param {object} input
 * @param {object} input.wallet             the wallet entry
 * @param {number} input.sparkWalletCount   Spark wallets on the device, this one included
 * @param {{known: boolean, value: number, fresh?: boolean}} input.balance
 *   `fresh`: the value was verified with the network moments ago
 * @param {boolean} input.hasPendingDeposit an on-chain deposit is waiting to be claimed
 * @param {boolean} input.hasActiveExit     an emergency exit is under way
 * @param {boolean} input.backedUp          this wallet's recovery phrase is confirmed backed up
 * @returns {{ allowed: boolean, blockers: string[], notes: string[] }}
 *   blockers: 'exit_in_progress' | 'deposit_pending' | 'has_balance' | 'balance_unverified' | 'needs_backup'
 *   notes:    'phrase_leaves' (the recovery phrase leaves this phone with it)
 */
export function removalCheck({ wallet, sparkWalletCount = 0, balance = { known: false, value: 0 }, hasPendingDeposit = false, hasActiveExit = false, backedUp = false }) {
  const blockers = [];
  const notes = [];
  if (walletKind(wallet) === WALLET_KIND.CONNECTED) return { allowed: true, blockers, notes };

  const freshZero = balance.known && balance.fresh === true && balance.value === 0;
  if (wallet.type === 'arkade') {
    notes.push('phrase_leaves');
    if (!backedUp && !freshZero) blockers.push('needs_backup');
    return { allowed: blockers.length === 0, blockers, notes };
  }

  const last = sparkWalletCount <= 1;
  if (last) notes.push('phrase_leaves');
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

const firstBlocker = (check) => BLOCKER_ORDER.find((code) => check.blockers.includes(code));

/**
 * Why a removal cannot run yet, as a short label for a row ('' when nothing
 * blocks it, or when the answer needs a fresh balance first: that is checked
 * on tap).
 */
export function removalBlockerLabel(check, t) {
  switch (firstBlocker(check)) {
    case 'exit_in_progress': return t('Emergency exit in progress');
    case 'deposit_pending': return t('Bitcoin is on its way');
    case 'needs_backup': return t('Back up first');
    case 'has_balance': return t('Move the money first');
    default: return '';
  }
}

/** The alert for a refused removal: one reason, and the step that unblocks it. */
function blockedCopy(blocker, { name, t, amount, hasMoney }) {
  switch (blocker) {
    case 'exit_in_progress':
      return { title: t('Emergency exit in progress'), message: t('Remove {name} once it has finished.', { name }), action: null };
    case 'deposit_pending':
      return { title: t('Bitcoin is on its way'), message: t('Add or return the deposit to {name} first.', { name }), action: null };
    case 'needs_backup':
      return {
        title: t('Back up {name} first', { name }),
        message: hasMoney ? t('It holds {amount}.', { amount }) : t('Only its recovery phrase brings it back.'),
        action: 'backup',
        actionLabel: t('Back up now'),
      };
    case 'has_balance':
      return { title: t('Move the money first'), message: t('{name} holds {amount}.', { name, amount }), action: 'move_funds', actionLabel: t('Move funds') };
    default:
      return { title: t('Balance not checked'), message: t('Check your connection and try again.'), action: null };
  }
}

const kioskLine = (isKioskWallet, t) => (isKioskWallet ? ` ${t('The kiosk stops taking payments.')}` : '');

/**
 * What to tell the person about taking `wallet` off this phone, from a
 * removalCheck verdict.
 *
 * @returns {{ blocked: true, title: string, message: string, action: null|'backup'|'move_funds', actionLabel?: string }
 *         | { blocked: false, title: string, message: string, confirmLabel: string, typed: boolean, doneMessage: string }}
 *   `typed`: the person types the confirmation phrase, because a recovery phrase leaves this phone
 */
export function removalCopy({ check, wallet, t, formatAmount = (sats) => `${sats} sats`, balanceSats = 0, isKioskWallet = false }) {
  const name = wallet?.name || t('Wallet');
  const blocker = firstBlocker(check);
  if (blocker) {
    return { blocked: true, ...blockedCopy(blocker, { name, t, amount: formatAmount(balanceSats), hasMoney: balanceSats > 0 }) };
  }

  const kiosk = kioskLine(isKioskWallet, t);
  if (walletKind(wallet) === WALLET_KIND.CONNECTED) {
    return {
      blocked: false,
      title: t('Disconnect {name}?', { name }),
      message: t('Your money stays in {name}.', { name }) + kiosk,
      confirmLabel: t('Disconnect'),
      typed: false,
      doneMessage: t('{name} disconnected', { name }),
    };
  }
  const phraseLeaves = check.notes.includes('phrase_leaves');
  return {
    blocked: false,
    title: t('Remove {name} from this phone?', { name }),
    message: (phraseLeaves ? t('Its recovery phrase leaves too.') : t('Your recovery phrase brings it back.')) + kiosk,
    confirmLabel: t('Remove'),
    typed: phraseLeaves,
    doneMessage: t('{name} removed from this phone', { name }),
  };
}

/** Every Spark wallet, and their shared phrase, off this phone (Danger Zone). */
export function sparkRemovalCopy({ check, t, formatAmount = (sats) => `${sats} sats`, balanceSats = 0, includesKioskWallet = false }) {
  const blocker = firstBlocker(check);
  if (blocker) {
    return { blocked: true, ...blockedCopy(blocker, { name: 'Spark', t, amount: formatAmount(balanceSats), hasMoney: balanceSats > 0 }) };
  }
  return {
    blocked: false,
    title: t('Remove Spark from this phone?'),
    message: t('Its recovery phrase leaves too.') + kioskLine(includesKioskWallet, t),
    confirmLabel: t('Remove'),
    typed: true,
    doneMessage: t('Spark removed from this phone'),
  };
}

/**
 * Every connected wallet off this phone (Danger Zone). `listNames` joins
 * names in the person's language ("Alby Hub and Kitty").
 */
export function disconnectAllCopy({ wallets, t, listNames, includesKioskWallet = false }) {
  if (wallets.length === 1) {
    return removalCopy({ check: { blockers: [], notes: [] }, wallet: wallets[0], t, isKioskWallet: includesKioskWallet });
  }
  const count = wallets.length;
  return {
    blocked: false,
    title: t('Disconnect {count} wallets?', { count }),
    message: t('Your money stays in {names}.', { names: listNames(wallets.map((w) => w.name)) }) + kioskLine(includesKioskWallet, t),
    confirmLabel: t('Disconnect'),
    typed: false,
    doneMessage: t('{count} wallets disconnected', { count }),
  };
}
