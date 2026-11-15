/**
 * paymentOutcome - a payment that was handed to a wallet has three ends,
 * not two: paid, not paid, and "nobody has said yet".
 *
 * The third is not a failure. The request may have reached the wallet's
 * service before the connection dropped, the wait ran out, or an error came
 * back that names no reason: the payment may still go through. Such a
 * payment is thrown as PAYMENT_UNCONFIRMED by every provider, so every
 * surface says the same thing (check History before paying again) and none
 * offers a retry that could pay twice. NWC raises its own code for the same
 * state (utils/nwcErrors NWC_ERROR.UNCONFIRMED).
 *
 * Pure: no imports, so providers, stores and pages can all read it.
 */

/**
 * How a send ended. Read in one place (outcomeOfResult / outcomeOfError),
 * for every kind of wallet; every surface acts on this and nothing else.
 */
export const PAYMENT_OUTCOME = Object.freeze({
  // The wallet says the payment is paid.
  SETTLED: 'settled',
  // The wallet has the payment and it is still on its way.
  PENDING: 'pending',
  // The payment was not made: refused before it left, or the wallet said so.
  FAILED: 'failed',
  // The payment was handed over and nobody has said how it ended.
  UNKNOWN: 'unknown',
});

/** The payment was handed to the wallet and its outcome is not known. */
export const PAYMENT_UNCONFIRMED = 'PAYMENT_UNCONFIRMED';

/** The wallet itself said the payment was not made. */
export const PAYMENT_FAILED = 'PAYMENT_FAILED';

/**
 * How long a send waits for the wallet's word before the app stops waiting:
 * the wait a Spark Lightning payment has always had for its completion.
 * Past it a payment is unconfirmed, never failed.
 */
export const PAYMENT_COMPLETION_TIMEOUT_MS = 60000;

/**
 * How long one look at a payment's record may take (an NWC lookup, LNbits'
 * record of a payment just made). A wallet that stays silent must not hold
 * a payment's result back; without an answer the earlier word stands.
 */
export const PAYMENT_LOOKUP_WAIT_MS = 10000;

function messageOf(cause) {
  if (!cause) return '';
  return typeof cause === 'string' ? cause : String(cause.message || cause);
}

/**
 * The error for a payment whose outcome is unknown. It keeps the cause's
 * own text for the technical details, and whatever identifies the payment
 * (`paymentHash`, `id`) so it can be found again.
 * @param {Error|string} [cause]
 * @param {object} [extra]
 */
export function unconfirmedPayment(cause, extra = {}) {
  const error = new Error(messageOf(cause) || 'Payment not confirmed');
  return Object.assign(error, extra, { code: PAYMENT_UNCONFIRMED, cause: cause || null });
}

/** True for a payment whose outcome is unknown, whichever wallet said so. */
export function isUnconfirmedPayment(error) {
  const code = error && typeof error === 'object' ? error.code : null;
  return code === PAYMENT_UNCONFIRMED || code === 'NWC_PAYMENT_UNCONFIRMED';
}

/**
 * The outcome a provider's result stands for. Providers return the
 * completed / pending / failed vocabulary; one that returns no status
 * returns only on proof of payment (an NWC wallet's preimage). Only the
 * wallet's own "completed" is a paid payment, only its "failed" is a
 * failure, and anything else it returned is still on its way.
 */
export function outcomeOfResult(result) {
  const status = result && typeof result === 'object' ? result.status : null;
  if (status === 'completed' || status === undefined || status === null) return PAYMENT_OUTCOME.SETTLED;
  return status === 'failed' ? PAYMENT_OUTCOME.FAILED : PAYMENT_OUTCOME.PENDING;
}

/** The outcome an error from a send stands for: unknown when nobody has said, else not made. */
export function outcomeOfError(error) {
  return isUnconfirmedPayment(error) ? PAYMENT_OUTCOME.UNKNOWN : PAYMENT_OUTCOME.FAILED;
}

/**
 * Stop before a pay call when the phone has no network at all: nothing can
 * be sent, so this is a plain failure and never an unknown outcome. Only
 * the browser's "offline" is believed; its "online" proves nothing.
 */
export function assertOnline(online = globalThis.navigator?.onLine) {
  if (online !== false) return;
  throw Object.assign(new Error('Failed to fetch'), { neverSent: true });
}

/**
 * `work`, or PAYMENT_UNCONFIRMED once `ms` have passed. The work itself runs
 * on: the wallet may still make the payment, which is why a wait that ran
 * out is never reported as a failure.
 * @param {Promise} work  the pay call, already dispatched
 * @param {number} [ms]
 * @param {object} [extra]  what identifies the payment, kept on the error
 */
export function withinPaymentDeadline(work, ms = PAYMENT_COMPLETION_TIMEOUT_MS, extra = {}) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(unconfirmedPayment('No answer from the wallet in time', extra)), ms);
  });
  return Promise.race([Promise.resolve(work), late]).finally(() => clearTimeout(timer));
}
