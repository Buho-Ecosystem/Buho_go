/**
 * NWC (NIP-47) failures in words a person can act on.
 *
 * Two questions matter, and they are kept apart:
 *   1. What went wrong, and what can be done about it? (nwcErrorText)
 *   2. For a payment: did it fail, or is its outcome simply unknown?
 *      (isUncertainPaymentError) A wallet answering INTERNAL or OTHER, or
 *      not answering at all, has not said "not paid". Treating that as a
 *      failure invites paying twice.
 *
 * Pure: no SDK import. The SDK's timeouts carry the code "INTERNAL" and a
 * message, so they are recognised by message.
 */

/** Codes BuhoGO itself raises around NWC. */
export const NWC_ERROR = Object.freeze({
  NO_ANSWER: 'NWC_NO_ANSWER',
  RELAY_UNREACHABLE: 'NWC_RELAY_UNREACHABLE',
  UNCONFIRMED: 'NWC_PAYMENT_UNCONFIRMED',
  LIMIT_TOO_LOW: 'NWC_LIMIT_TOO_LOW',
  RECEIVE_NOT_ALLOWED: 'NWC_RECEIVE_NOT_ALLOWED',
});

/** Wallet answers that settle a payment as not made. */
const DEFINITE_FAILURES = new Set([
  'PAYMENT_FAILED', 'INSUFFICIENT_BALANCE', 'QUOTA_EXCEEDED', 'RESTRICTED',
  'UNAUTHORIZED', 'RATE_LIMITED', 'NOT_IMPLEMENTED', 'UNSUPPORTED_ENCRYPTION',
  'FEE_LIMIT_EXCEEDED', NWC_ERROR.LIMIT_TOO_LOW, NWC_ERROR.RECEIVE_NOT_ALLOWED,
]);

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * The SDK raises its transport failures with the generic codes INTERNAL or
 * OTHER. Only those are read by message, so an unrelated error that
 * happens to say "timeout" is never taken for an NWC one.
 */
function sdkTransportMessage(error) {
  return error?.code === 'INTERNAL' || error?.code === 'OTHER' ? messageOf(error) : '';
}

/** The wallet has never published its info event: its service is not running there. */
function isMissingWallet(error) {
  return /no info event/i.test(messageOf(error));
}

/** The wallet did not answer: no reply in time, or no wallet behind the relay at all. */
export function isNoAnswer(error) {
  return error?.code === NWC_ERROR.NO_ANSWER || isMissingWallet(error) || /reply timeout/i.test(sdkTransportMessage(error));
}

/** The relay could not be reached or refused the request. */
export function isRelayFailure(error) {
  return error?.code === NWC_ERROR.RELAY_UNREACHABLE || /publish timeout|failed to publish|failed to connect to/i.test(sdkTransportMessage(error));
}

/** Failures that happen before a request leaves: nothing can have been paid. */
function neverSent(error) {
  return isMissingWallet(error) || /failed to publish|failed to connect to/i.test(sdkTransportMessage(error));
}

/**
 * True when a payment's outcome is unknown, not failed: the request may
 * have reached the wallet (no reply, publish not acknowledged) or the
 * wallet's own error was generic. Such a payment is looked up, never sent
 * again on its own. A request that never left is a plain failure.
 */
export function isUncertainPaymentError(error) {
  if (DEFINITE_FAILURES.has(error?.code) || neverSent(error)) return false;
  if (isNoAnswer(error) || isRelayFailure(error)) return true;
  return error?.code === 'INTERNAL' || error?.code === 'OTHER';
}

/** An error with a code, the shape every surface already understands. */
export function nwcError(code, message, extra = {}) {
  return Object.assign(new Error(message || code), { code }, extra);
}

function dayOf(ms, locale) {
  try {
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

/**
 * One sentence with a next step, or null when the error is not about NWC.
 *
 * @param {Error} error
 * @param {Function} t vue-i18n translate
 * @param {{ walletName?: string, locale?: string }} [ctx]
 */
export function nwcErrorText(error, t, { walletName = '', locale } = {}) {
  const wallet = walletName || t('your wallet app');
  switch (error?.code) {
    case 'QUOTA_EXCEEDED':
      return t('This connection has used up its spending limit. Raise it in {wallet}, or wait until it resets.', { wallet });
    case NWC_ERROR.LIMIT_TOO_LOW:
      return error.renewsAt
        ? t('This connection has {amount} sats left until {date}. Raise the limit in {wallet}, or pay less.', { amount: Number(error.remainingSats || 0).toLocaleString(locale), date: dayOf(error.renewsAt, locale), wallet })
        : t('This connection has {amount} sats left. Raise the limit in {wallet}, or pay less.', { amount: Number(error.remainingSats || 0).toLocaleString(locale), wallet });
    case 'RESTRICTED':
      return t('{wallet} does not allow this connection to do that. Change it in {wallet}.', { wallet });
    case NWC_ERROR.RECEIVE_NOT_ALLOWED:
      return t('This connection cannot create invoices. Allow receiving in {wallet}.', { wallet });
    case 'UNAUTHORIZED':
      return t('This connection was removed or has expired. Create a new one in {wallet}.', { wallet });
    case 'RATE_LIMITED':
      return t('Too many requests in a short time. Wait a moment, then try again.');
    case 'NOT_IMPLEMENTED':
      return t('{wallet} cannot do this over Nostr Wallet Connect.', { wallet });
    case 'UNSUPPORTED_ENCRYPTION':
      return t('{wallet} uses an encryption BuhoGO no longer supports. Update {wallet}, then connect again.', { wallet });
    case NWC_ERROR.UNCONFIRMED:
      return t('Not confirmed yet. Check {wallet} before trying again, so you do not pay twice.', { wallet });
    default:
      break;
  }
  if (isNoAnswer(error)) return t('{wallet} did not answer. Make sure it is running, then try again.', { wallet });
  if (isRelayFailure(error)) return t("The connection's relay could not be reached. Check your internet, then try again.");
  return null;
}
