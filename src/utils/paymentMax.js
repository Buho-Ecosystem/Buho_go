import { unquotedFeeLimitSats } from './payingWallets.js'

/** Largest amount whose entire enforced fee allowance fits the known balance.
 * The caller must recheck the balance and prepare/review the actual payment.
 * No bound is inferred for a connection whose wallet controls its own fees.
 */
export function boundedPaymentMax(balanceSats, { walletType, destinationType, recipientMax = Infinity } = {}) {
  if (!Number.isSafeInteger(balanceSats) || balanceSats <= 0 || walletType !== 'spark') return null
  if (!['lightning_address', 'lnurl', 'spark_address'].includes(destinationType)) return null
  let low = 0, high = Math.min(balanceSats, Number.isSafeInteger(recipientMax) ? recipientMax : balanceSats)
  while (low < high) {
    const candidate = low + Math.ceil((high - low) / 2)
    if (candidate + unquotedFeeLimitSats(candidate) <= balanceSats) low = candidate
    else high = candidate - 1
  }
  return low
}
