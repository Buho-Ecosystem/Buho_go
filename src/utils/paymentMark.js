/**
 * Which payment logo an address gets (components/PaymentMark.vue draws it).
 * A pay link is paid over Lightning, so it shares the Lightning mark.
 */

import { contactAddressType } from './contactAddress.js'

const KINDS = new Set(['lightning', 'bitcoin', 'spark', 'arkade'])

/**
 * @param {string} [addressType]  the stored kind, when known
 * @param {string} [address]      read when no kind is stored
 * @returns {'lightning'|'bitcoin'|'spark'|'arkade'|null}
 */
export function paymentMarkKind(addressType, address) {
  const type = addressType || contactAddressType(address)
  if (type === 'lnurl') return 'lightning'
  return KINDS.has(type) ? type : null
}
