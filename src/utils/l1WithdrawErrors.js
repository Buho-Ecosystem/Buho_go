/**
 * l1WithdrawErrors — map raw Spark SDK / network errors from the on-chain
 * withdrawal flow (fee quote + submission) to short, user-readable copy.
 *
 * Categories are derived from substring matches on the error message —
 * when nothing matches we fall back to a friendly generic so we never
 * leak stack-trace fragments to users. Shared by the on-chain fee panel
 * (quote errors) and the wallet page (submission errors) so both stages
 * of the same flow speak identically.
 *
 * Pure and synchronous — callers pass `t` (vue-i18n translate), so this
 * stays unit-testable under plain Node.
 *
 * @param {unknown} error
 * @param {(key: string) => string} t
 * @returns {{ title: string, description: string }}
 */
export function describeL1WithdrawError(error, t) {
  const errorStr = error?.message || error?.toString() || ''
  const errorLower = errorStr.toLowerCase()

  if (errorLower.includes('exceeds available balance') ||
      errorLower.includes('insufficient') ||
      errorLower.includes('not enough')) {
    return {
      title: t('Not enough funds'),
      description: t('The amount plus fees exceeds your balance. Try a smaller amount.')
    }
  }
  if (errorLower.includes('minimum') || errorLower.includes('too small') || errorLower.includes('dust')) {
    return {
      title: t('Amount too small'),
      description: t('Please enter a larger amount to cover network fees.')
    }
  }
  if (errorLower.includes('invalid address') || errorLower.includes('address')) {
    return {
      title: t('Invalid address'),
      description: t('The Bitcoin address appears to be invalid.')
    }
  }
  if (errorLower.includes('network') || errorLower.includes('timeout') ||
      errorLower.includes('connection') || errorLower.includes('fetch')) {
    return {
      title: t('Connection problem'),
      description: t('Please check your internet and try again.')
    }
  }
  if (errorLower.includes('expired') || errorLower.includes('quote')) {
    return {
      title: t('Please try again'),
      description: t("The fee estimate expired. We'll get a fresh one.")
    }
  }
  if (errorLower.includes('not unlocked') || errorLower.includes('enter your pin') || errorLower.includes('pin')) {
    return {
      title: t('Wallet locked'),
      description: t('Please enter your PIN to unlock the wallet.')
    }
  }
  if (errorLower.includes('not supported') || errorLower.includes('provider') ||
      errorLower.includes('not connected') || errorLower.includes('wallet')) {
    return {
      title: t('Wallet not ready'),
      description: t('Please make sure your wallet is unlocked.')
    }
  }
  return {
    title: t('Something went wrong'),
    description: t('Please try again in a moment.')
  }
}
