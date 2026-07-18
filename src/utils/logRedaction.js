/**
 * Log-safe rendering of payment inputs.
 *
 * Raw NFC / deep-link payloads must never reach the console (and thereby
 * Android logcat): Bolt Card URLs carry one-time card-authentication
 * parameters, invoices and LNURLs leak amount and destination metadata.
 * Reducing the input to its scheme plus length is enough to debug routing
 * without exposing content.
 */

/**
 * @param {unknown} input - raw payment destination (URI, invoice, address)
 * @returns {string} e.g. "lnurlw:…(142 chars)" — never the payload itself
 */
export function redactPaymentInput(input) {
  if (typeof input !== 'string' || input.trim().length === 0) return '(empty)'

  const trimmed = input.trim()
  const colon = trimmed.indexOf(':')
  // No scheme (bech32 LNURL/invoice, Lightning address): a short prefix like
  // "lnurl1" or "lnbc" identifies the format without revealing the payload.
  const label = colon > 0 ? trimmed.slice(0, colon) : trimmed.slice(0, 6)
  return `${label}:…(${trimmed.length} chars)`
}
