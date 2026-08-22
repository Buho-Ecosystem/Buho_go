/**
 * txMessage - the one place that decides what human text a transaction
 * carries, and which strings only look like text.
 *
 * Three surfaces answer the same question about every payment: the
 * transaction list, the home-screen preview, and Transaction Details.
 * Before this module each answered it separately, which is how the list
 * came to hide a placeholder while Details still printed it, and how
 * "description", "memo" and "comment" ended up presented to the user as
 * three different facts when they are one.
 *
 * Two ideas live here:
 *
 *   - A *placeholder* is a description no human wrote. BuhoGO stamps
 *     "BuhoGO Payment" on any invoice the user leaves undescribed
 *     (ReceiveModal.vue, LNBitsWalletProvider, NWCWalletProvider,
 *     utils/lightning.js), and "Lightning transaction" arrives the same
 *     way from elsewhere. Rendering either one tells the user nothing
 *     while looking exactly like it told them something.
 *
 *   - A *message* is what someone actually attached to the payment: the
 *     payer's LUD-12 comment when the rails carried one, otherwise the
 *     invoice description. Comments outrank descriptions because a
 *     comment is always deliberate, whereas a description is often just
 *     whatever the receiving app filled in.
 *
 * The grouping composable already refuses to group on the generic memo
 * (useTransactionGrouping.js, extractStableCounterparty). This module is
 * that same judgement, made available to everything that renders.
 *
 * Pure and synchronous. No store, no i18n, no provider knowledge - a
 * caller that needs to layer its own rules on top (zaps, Learn & Earn
 * rewards, kiosk sales) does so around these helpers, not inside them.
 */

/**
 * Default invoice descriptions written by BuhoGO or a provider on the
 * user's behalf. Compared case-insensitively after trimming, because the
 * same string reaches us from several code paths and from providers that
 * round-trip it through their own storage.
 */
const PLACEHOLDER_DESCRIPTIONS = new Set([
  'buhogo payment',
  'lightning transaction'
]);

/**
 * Does this description carry no information for the user?
 *
 * True for empty text and for the defaults above. Callers can therefore
 * treat "nothing was written" and "a placeholder was written" the same
 * way, which is the whole point: to the reader they are identical.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlaceholderDescription(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return PLACEHOLDER_DESCRIPTIONS.has(text.toLowerCase());
}

/**
 * The transaction's description, or '' when there is nothing worth
 * showing. Reads `description` first and falls back to `memo`; the
 * normalizer sets one from the other when a provider sends only one, so
 * the two are the same field seen from different providers.
 *
 * @param {object|null|undefined} tx - canonical transaction (see txNormalizer)
 * @returns {string}
 */
export function getTxDescription(tx) {
  if (!tx) return '';
  const text = String(tx.description || tx.memo || '').trim();
  return isPlaceholderDescription(text) ? '' : text;
}

/**
 * The human message riding on a transaction, or '' when there is none.
 *
 * Never invents text: a payment with only a placeholder description
 * returns '' so the caller can say something honest and generic instead
 * of echoing our own filler back at the user.
 *
 * @param {object|null|undefined} tx - canonical transaction (see txNormalizer)
 * @returns {string}
 */
export function getTxMessage(tx) {
  if (!tx) return '';
  const comment = String(tx.comment || '').trim();
  if (comment) return comment;
  return getTxDescription(tx);
}

export { PLACEHOLDER_DESCRIPTIONS };
