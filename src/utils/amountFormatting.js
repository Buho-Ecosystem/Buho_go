/**
 * Amount Formatting Utilities
 * Centralized formatting for satoshi amounts
 * Supports BIP-177 (₿) and Legacy (sats) formats
 */

/**
 * Format satoshi amount according to user preference
 * @param {number} amount - Amount in satoshis
 * @param {boolean} useBip177 - Use BIP-177 format (₿) vs legacy (sats)
 * @param {object} options - Additional formatting options
 * @returns {string} Formatted amount string
 */
export function formatSatoshis(amount, useBip177 = true, options = {}) {
  const {
    showSign = false,        // Add +/- prefix
    isPositive = true,       // For sign determination
    useLocaleString = true   // Use thousand separators
  } = options

  const absAmount = Math.abs(amount)
  const formattedNumber = useLocaleString
    ? absAmount.toLocaleString()
    : absAmount.toString()

  if (useBip177) {
    // BIP-177: ₿ 1,234 (with space for consistency and readability)
    const sign = showSign ? (isPositive ? '+' : '-') : ''
    return '₿ ' + sign + formattedNumber
  } else {
    // Legacy: 1,234 sats (space before sats)
    const prefix = showSign ? (isPositive ? '+' : '-') : ''
    return prefix + formattedNumber + ' sats'
  }
}

/**
 * Format satoshis with sign indicator
 * @param {number} amount - Amount in satoshis
 * @param {boolean} useBip177 - Use BIP-177 format (₿) vs legacy (sats)
 * @returns {string} Formatted amount with sign
 */
export function formatSatoshisWithSign(amount, useBip177 = true) {
  return formatSatoshis(amount, useBip177, {
    showSign: true,
    isPositive: amount >= 0
  })
}

/**
 * Format for display in main balance (larger text)
 * @param {number} amount - Amount in satoshis
 * @param {boolean} useBip177 - Use BIP-177 format (₿) vs legacy (sats)
 * @returns {string} Formatted balance
 */
export function formatMainBalance(amount, useBip177 = true) {
  return formatSatoshis(amount, useBip177, { useLocaleString: true })
}

/**
 * Format amount with proper spacing for display
 * @param {number} amount - Amount in satoshis
 * @param {boolean} useBip177 - Use BIP-177 format (₿) vs legacy (sats)
 * @returns {string} Formatted amount
 */
export function formatAmount(amount, useBip177 = true) {
  const absAmount = Math.abs(amount)
  const formattedNumber = absAmount.toLocaleString()

  if (useBip177) {
    // BIP-177: ₿ 1,234 (with space for consistency and readability)
    return '₿ ' + formattedNumber
  } else {
    // Legacy: 1,234 sats (space before sats)
    return formattedNumber + ' sats'
  }
}

/**
 * Format amount with sign prefix (for transactions)
 * @param {number} amount - Amount in satoshis
 * @param {boolean} useBip177 - Use BIP-177 format (₿) vs legacy (sats)
 * @param {string} sign - Sign prefix (+ or -)
 * @returns {string} Formatted amount with sign
 */
export function formatAmountWithPrefix(amount, useBip177 = true, sign = '') {
  const absAmount = Math.abs(amount)
  const formattedNumber = absAmount.toLocaleString()

  if (useBip177) {
    // BIP-177: ₿ +1,234 or ₿ -1,234
    return '₿ ' + sign + formattedNumber
  } else {
    // Legacy: +1,234 sats or -1,234 sats
    return sign + formattedNumber + ' sats'
  }
}
