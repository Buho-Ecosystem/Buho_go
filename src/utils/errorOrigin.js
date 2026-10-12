/**
 * errorOrigin - who wrote an error's text.
 *
 * The payment error dialog quotes a reason under "Reported by the
 * recipient" (or the service, the destination wallet...) only when another
 * party really sent it: an LNURL server's `status: "ERROR"` reason (LUD-06).
 * Every other text is shown without a label, so a wallet's own refusal or a
 * message BuhoGO wrote is never put in someone else's mouth
 * (userErrors.buildPaymentError).
 */

const COUNTERPARTY = 'counterparty';

/**
 * An Error carrying the reason another party sent, marked as theirs. Without
 * a usable reason it carries `fallback`, which is BuhoGO's own text and not
 * marked.
 * @param {unknown} reason the server's `reason` field
 * @param {string} fallback our text when it gave none
 * @returns {Error}
 */
export function counterpartyError(reason, fallback) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  const error = new Error(text || fallback);
  if (text) error.origin = COUNTERPARTY;
  return error;
}

/** True for an error whose text another party wrote (see counterpartyError). */
export function isCounterpartyError(error) {
  return Boolean(error && typeof error === 'object' && error.origin === COUNTERPARTY);
}

/** Keep the mark when an error is rebuilt (to scrub or translate its text). */
export function keepOrigin(from, to) {
  if (isCounterpartyError(from)) to.origin = COUNTERPARTY;
  return to;
}
