/**
 * User-Friendly Error Messages
 *
 * Maps technical errors to user-friendly messages.
 * NEVER show technical terms to users like:
 * - SDK, API, provider, mnemonic, UTXO, LNURL, BOLT, etc.
 *
 * All messages should be understandable by non-technical users.
 */

/**
 * Map a technical error to a user-friendly message
 * @param {Error|string} error - The error object or message
 * @param {string} context - Context: 'payment', 'receive', 'claim', 'withdraw', 'general'
 * @param {Function} $t - Translation function (optional)
 * @returns {{ title: string, description: string }}
 */
export function getUserFriendlyError(error, context = 'general', $t = null) {
  const t = $t || ((s) => s); // Use translation function or passthrough
  const errorStr = error?.message || error?.toString() || '';
  const errorLower = errorStr.toLowerCase();

  // === Balance/Amount Issues ===
  if (errorLower.includes('insufficient') ||
      errorLower.includes('not enough') ||
      errorLower.includes('exceeds') ||
      errorLower.includes('balance')) {
    return {
      title: t('Not enough funds'),
      description: t('Please check your balance and try a smaller amount.')
    };
  }

  // === Invalid Amount ===
  if (errorLower.includes('invalid amount') ||
      errorLower.includes('amount must be')) {
    return {
      title: t('Invalid amount'),
      description: t('Please enter a valid amount.')
    };
  }

  // === Address Issues ===
  if (errorLower.includes('invalid address') ||
      errorLower.includes('address')) {
    return {
      title: t('Invalid address'),
      description: t('Please check the address and try again.')
    };
  }

  // === Invoice Issues ===
  if (errorLower.includes('invoice') ||
      errorLower.includes('expired')) {
    return {
      title: t('Payment request expired'),
      description: t('Please request a new payment link.')
    };
  }

  // === Network/Connection Issues ===
  if (errorLower.includes('network') ||
      errorLower.includes('timeout') ||
      errorLower.includes('connection') ||
      errorLower.includes('fetch') ||
      errorLower.includes('offline')) {
    return {
      title: t('Connection problem'),
      description: t('Please check your internet and try again.')
    };
  }

  // === Wallet Locked / PIN Required ===
  if (errorLower.includes('not unlocked') ||
      errorLower.includes('pin') ||
      errorLower.includes('locked')) {
    return {
      title: t('Wallet locked'),
      description: t('Please unlock your wallet to continue.')
    };
  }

  // === Wallet Not Ready ===
  if (errorLower.includes('not connected') ||
      errorLower.includes('provider') ||
      errorLower.includes('not supported')) {
    return {
      title: t('Wallet not ready'),
      description: t('Please make sure your wallet is set up correctly.')
    };
  }

  // === Deposit Not Ready (Bitcoin L1) ===
  if (errorLower.includes('confirmation') ||
      errorLower.includes('not confirmed') ||
      errorLower.includes('pending')) {
    return {
      title: t('Still confirming'),
      description: t('Please wait a few more minutes.')
    };
  }

  // === Deposit Not Found (Bitcoin L1) ===
  if (errorLower.includes('not found') ||
      errorLower.includes('already claimed') ||
      errorLower.includes('utxo')) {
    return {
      title: t('Not available'),
      description: t('This may have already been processed.')
    };
  }

  // === Fee Issues ===
  if (errorLower.includes('fee') ||
      errorLower.includes('maxfee')) {
    return {
      title: t('Fee issue'),
      description: t('Please try again with a different amount.')
    };
  }

  // === Context-Specific Fallbacks ===
  const fallbacks = {
    payment: {
      title: t('Payment failed'),
      description: t('Please try again.')
    },
    receive: {
      title: t('Couldn\'t create invoice'),
      description: t('Please try again.')
    },
    claim: {
      title: t('Couldn\'t complete'),
      description: t('Please try again.')
    },
    withdraw: {
      title: t('Withdrawal failed'),
      description: t('Please try again.')
    },
    general: {
      title: t('Something went wrong'),
      description: t('Please try again.')
    }
  };

  return fallbacks[context] || fallbacks.general;
}

/**
 * Get a simple user-friendly message (title only)
 * @param {Error|string} error - The error object or message
 * @param {string} context - Context for the error
 * @param {Function} $t - Translation function
 * @returns {string}
 */
export function getUserFriendlyErrorMessage(error, context = 'general', $t = null) {
  const result = getUserFriendlyError(error, context, $t);
  return result.title;
}

export default { getUserFriendlyError, getUserFriendlyErrorMessage };
