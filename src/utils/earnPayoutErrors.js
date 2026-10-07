/**
 * Server answers that mean "the reward wallet cannot pay right now" (it is
 * empty or payouts are switched off), not "this claim is wrong". The earned
 * sats stay pending and the player is told to come back, never shown a
 * payment-failure dialog for a problem on our side.
 */
export const PAYOUTS_PAUSED_ERRORS = new Set([
  'payout_failed',
  'payouts_paused',
  'not_accepting',
  'insufficient_funds',
  'insufficient_balance',
  'funding_unavailable',
  'service_unavailable',
])

export function isPayoutsPaused(error) {
  return PAYOUTS_PAUSED_ERRORS.has(String(error || ''))
}
