/**
 * Wallet names: what a person may call a wallet, for every wallet type.
 *
 * Names are how wallets tell apart in every picker (switcher, transfer,
 * kiosk, auto-transfer), so two wallets never share one, compared without
 * regard to case or surrounding space. Pure module.
 */

export const MAX_WALLET_NAME_LENGTH = 32;

/** Trimmed, inner whitespace collapsed to single spaces. */
export function normalizeWalletName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Why a name cannot be used, or null when it can.
 * `exceptId` is the wallet being renamed (keeping its own name is fine).
 * @returns {null|'empty'|'too_long'|'taken'}
 */
export function walletNameProblem(value, wallets, { exceptId = null } = {}) {
  const name = normalizeWalletName(value);
  if (!name) return 'empty';
  if ([...name].length > MAX_WALLET_NAME_LENGTH) return 'too_long';
  const lower = name.toLowerCase();
  const clash = (wallets || []).some(w => w?.id !== exceptId && normalizeWalletName(w?.name).toLowerCase() === lower);
  return clash ? 'taken' : null;
}

/** Thrown by store actions; `code` maps to copy in the UI. */
export class WalletNameError extends Error {
  constructor(problem) {
    super(`Wallet name ${problem}`);
    this.code = `WALLET_NAME_${problem.toUpperCase()}`;
    this.problem = problem;
  }
}

/** The sentence a name field shows for a walletNameProblem code. */
export function walletNameCopy(problem, t) {
  switch (problem) {
    case 'empty': return t('Enter a name for this wallet.');
    case 'too_long': return t('Use at most {max} characters.', { max: MAX_WALLET_NAME_LENGTH });
    case 'taken': return t('Another wallet already has this name.');
    default: return '';
  }
}
