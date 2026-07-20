/**
 * Learn & Earn tx branding.
 *
 * The memos are a wire contract with wallet history: they are baked into
 * BOLT11 invoices that outlive any app version, so a rename silently
 * un-brands every reward a user has already claimed. These tests pin the
 * exact strings on purpose.
 */
import assert from 'node:assert/strict'
import {
  EARN_BRAND,
  earnPayoutMemo,
  earnRewardKind,
  isEarnRewardTx,
} from '../earnBrand.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`)
    failed++
  }
}

test('memos are the exact strings embedded in past invoices', () => {
  assert.equal(earnPayoutMemo('claim'), 'BuhoGO Learn & Earn reward')
  assert.equal(earnPayoutMemo('bonus'), 'BuhoGO Learn & Earn completion bonus')
})

test('an unknown kind falls back to the regular reward memo', () => {
  assert.equal(earnPayoutMemo(undefined), 'BuhoGO Learn & Earn reward')
  assert.equal(earnPayoutMemo('jackpot'), 'BuhoGO Learn & Earn reward')
})

test('brand points at the logo served from /public', () => {
  assert.equal(EARN_BRAND.logo, '/buho_logo_grey.svg')
})

test('an incoming reward is recognised by description or memo', () => {
  assert.equal(earnRewardKind({ type: 'incoming', description: earnPayoutMemo('claim') }), 'claim')
  assert.equal(earnRewardKind({ type: 'incoming', memo: earnPayoutMemo('bonus') }), 'bonus')
  assert.equal(isEarnRewardTx({ type: 'incoming', description: earnPayoutMemo('claim') }), true)
})

test('surrounding whitespace and casing do not break the match', () => {
  assert.equal(earnRewardKind({ type: 'incoming', description: '  BuhoGO Learn & Earn reward  ' }), 'claim')
  assert.equal(earnRewardKind({ type: 'incoming', description: 'buhogo learn & earn reward' }), 'claim')
})

test('a tx with no type still matches, so unnormalised rows brand too', () => {
  assert.equal(earnRewardKind({ description: earnPayoutMemo('claim') }), 'claim')
})

test('an outgoing payment echoing the memo is never branded as earned', () => {
  assert.equal(earnRewardKind({ type: 'outgoing', description: earnPayoutMemo('claim') }), null)
  assert.equal(isEarnRewardTx({ type: 'outgoing', memo: earnPayoutMemo('bonus') }), false)
})

test('unrelated, empty and malformed transactions are not branded', () => {
  assert.equal(earnRewardKind({ type: 'incoming', description: 'Coffee' }), null)
  assert.equal(earnRewardKind({ type: 'incoming', description: '' }), null)
  assert.equal(earnRewardKind({ type: 'incoming' }), null)
  assert.equal(earnRewardKind(null), null)
  assert.equal(earnRewardKind(undefined), null)
  assert.equal(isEarnRewardTx(null), false)
})

test('a merely similar memo does not collide', () => {
  assert.equal(earnRewardKind({ type: 'incoming', description: 'BuhoGO Learn & Earn' }), null)
  assert.equal(earnRewardKind({ type: 'incoming', description: 'Learn & Earn reward' }), null)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
