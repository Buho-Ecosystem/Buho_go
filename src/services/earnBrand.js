/**
 * Learn & Earn reward branding for the transaction list and details view.
 *
 * A reward arrives as an ordinary incoming Lightning payment with no
 * counterparty Lightning address, so there is nothing for the usual contact
 * or wallet-brand avatar chain to match on. What we do control is the
 * invoice memo: the earn store bakes one of the stable strings below into
 * every reward invoice it creates, and the wallet keeps that memo in its
 * history.
 *
 * The memos are deliberately untranslated. They are embedded in a BOLT11
 * invoice at claim time and live in wallet history forever, so translating
 * them would mean a user who switched language later stopped matching their
 * own past rewards. The UI localises the label it shows on top of the memo;
 * the memo itself is the durable anchor.
 *
 * Matching on the memo (rather than persisting per-tx metadata) keeps the
 * branding working on every backend with zero bookkeeping, including history
 * that was synced onto a fresh install where no local metadata exists.
 *
 * This module owns the strings and is dependency-free on purpose: the earn
 * store imports it, not the other way round, so the tx list never pulls the
 * quiz JSON into its chunk.
 */

const CLAIM_MEMO = 'BuhoGO Learn & Earn reward'
const BONUS_MEMO = 'BuhoGO Learn & Earn completion bonus'

/**
 * Memo to embed in a reward invoice. `kind` matches the payout kind sent to
 * the earn API ('claim' | 'bonus').
 */
export function earnPayoutMemo(kind) {
  return kind === 'bonus' ? BONUS_MEMO : CLAIM_MEMO
}

/** Row/hero branding for a Learn & Earn reward. */
export const EARN_BRAND = Object.freeze({
  name: 'Learn & Earn',
  // Served from /public at the app root, so a plain absolute URL string with
  // no bundler import, matching how the other Buho logos are referenced.
  logo: '/buho_logo_grey.svg',
})

/**
 * Which kind of reward a transaction is, or null when it is not one.
 * Returns 'claim' | 'bonus' | null.
 */
export function earnRewardKind(tx) {
  if (!tx) return null

  // Rewards are always incoming. Guard so an outgoing payment that happens to
  // echo the memo back (a self-send, a refund) is not branded as earned.
  if (tx.type && tx.type !== 'incoming') return null

  const memo = String(tx.description || tx.memo || '').trim().toLowerCase()
  if (!memo) return null

  if (memo === BONUS_MEMO.toLowerCase()) return 'bonus'
  if (memo === CLAIM_MEMO.toLowerCase()) return 'claim'
  return null
}

/** True when this transaction is a Learn & Earn reward payout. */
export function isEarnRewardTx(tx) {
  return earnRewardKind(tx) !== null
}
