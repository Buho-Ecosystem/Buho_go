/**
 * Amount Formatting Utilities
 * Centralized formatting for satoshi amounts
 * Supports BIP-177 (₿) and Legacy (sats) formats
 */

// Between a number and its unit, so the two never break apart at a line end.
const NBSP = ' '

/**
 * The digits of a whole-number Bitcoin amount ("₿ 2,408", "2,408 sats"):
 * grouped as the device does, and never with a decimal part. Amounts are
 * whole before they are shown: a request that names a fraction is rounded
 * up where it is decoded (utils/lightningInvoice.js).
 */
const wholeDigits = (amount) => amount.toLocaleString(undefined, { maximumFractionDigits: 0 })

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
    ? wholeDigits(absAmount)
    : absAmount.toString()

  if (useBip177) {
    // BIP-177: ₿ 1,234 (with space for consistency and readability)
    const sign = showSign ? (isPositive ? '+' : '-') : ''
    return '₿' + NBSP + sign + formattedNumber
  } else {
    // Legacy: 1,234 sats (space before sats)
    const prefix = showSign ? (isPositive ? '+' : '-') : ''
    return prefix + formattedNumber + NBSP + 'sats'
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
  const formattedNumber = wholeDigits(absAmount)

  if (useBip177) {
    // BIP-177: ₿ 1,234 (with space for consistency and readability)
    return '₿' + NBSP + formattedNumber
  } else {
    // Legacy: 1,234 sats (space before sats)
    return formattedNumber + NBSP + 'sats'
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
  const formattedNumber = wholeDigits(absAmount)

  if (useBip177) {
    // BIP-177: ₿ +1,234 or ₿ -1,234
    return '₿' + NBSP + sign + formattedNumber
  } else {
    // Legacy: +1,234 sats or -1,234 sats
    return sign + formattedNumber + NBSP + 'sats'
  }
}

/**
 * The digits a fiat currency is written with (2 for EUR, 0 for JPY).
 * @param {string} code - ISO 4217 code
 * @returns {number}
 */
export function fiatDecimals(code) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code || 'USD' }).resolvedOptions().maximumFractionDigits
  } catch {
    return 2
  }
}

/**
 * One payment amount as number and unit, in the device's number format: the
 * same source the balance, the paid screen, the receipt and History use.
 *
 * The denomination says what the amount is shown in:
 *   { kind: 'sats', bip177 }                     whole Bitcoin units (₿ or sats)
 *   { kind: 'btc' }                              BTC with all eight digits
 *   { kind: 'fiat', code, rate, decimals }       rate = currency per BTC
 *   { kind: 'local', code, multiplier, decimals } multiplier = millisats per unit
 * A converted amount is marked `approximate`.
 *
 * @param {number} sats
 * @param {object} [denomination]
 * @param {object} [options]
 * @param {string} [options.locale] - Only for tests; the device's when omitted.
 * @returns {{ number: string, unit: string, approximate?: boolean }}
 */
export function paymentAmountParts(sats, denomination = {}, { locale } = {}) {
  const { kind = 'sats', code, rate, multiplier, decimals = 0, bip177 = true } = denomination
  const number = (value, digits = 0) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  // A converted amount below the last shown digit never pretends to be zero.
  const small = (value, digits) => value > 0 && value < 10 ** -digits ? `<${NBSP}${number(10 ** -digits, digits)}` : number(value, digits)
  if (kind === 'btc') {
    // Keep all eight satoshi digits exact, including the largest supported
    // integer. Dividing a Number first can round its final satoshi away.
    if (!Number.isSafeInteger(sats)) return { number: number(NaN, 8), unit: 'BTC' }
    const exact = BigInt(sats)
    const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.'
    const fraction = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 8, maximumFractionDigits: 0 }).format(exact % 100000000n)
    return { number: `${number(exact / 100000000n)}${decimal}${fraction}`, unit: 'BTC' }
  }
  if (kind === 'local' && multiplier > 0) return { number: small(sats * 1000 / multiplier, decimals), unit: code, approximate: true }
  if (kind === 'fiat' && rate > 0) return { number: small(sats * rate / 100000000, decimals), unit: code, approximate: true }
  return { number: number(sats), unit: bip177 ? '₿' : 'sats' }
}

/**
 * A payment amount on one line: "₿ 2,407", "2,407 sats", "0.00002407 BTC" or
 * "≈ 1.87 EUR". Number and unit never break apart at a line end.
 */
export function formatPaymentAmount(sats, denomination, options) {
  const { number, unit, approximate } = paymentAmountParts(sats, denomination, options)
  const value = unit === '₿' ? `₿${NBSP}${number}` : `${number}${NBSP}${unit}`
  return approximate ? `≈${NBSP}${value}` : value
}

/**
 * A fiat value with its symbol, in the device's number format: "€1,87" on a
 * German phone, "€1.87" on an English one.
 */
export function formatFiatAmount(value, code, { symbol, locale } = {}) {
  const digits = fiatDecimals(code)
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  return `${symbol ?? `${code} `}${number}`
}
