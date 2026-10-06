import assert from 'node:assert/strict'
import { isPayoutsPaused, PAYOUTS_PAUSED_ERRORS } from '../earnPayoutErrors.js'

// An empty reward wallet surfaces as payout_failed: that is a paused service,
// so the player keeps the sats and sees "come back later", not a failure.
assert.equal(isPayoutsPaused('payout_failed'), true)
assert.equal(isPayoutsPaused('payouts_paused'), true)
assert.equal(isPayoutsPaused('service_unavailable'), true)

// Rule answers keep their own copy.
for (const code of ['cooldown', 'daily_budget', 'ip_cap', 'lifetime_cap', 'invalid_invoice', '', null, undefined]) {
  assert.equal(isPayoutsPaused(code), false, String(code))
}
assert.ok(PAYOUTS_PAUSED_ERRORS.size >= 3)
console.log('earnPayoutErrors.spec: ok')
