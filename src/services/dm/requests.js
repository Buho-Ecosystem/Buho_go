/**
 * Payment requests for the contact chat: the Lightning side (docs/CONTACT_CHAT.md
 * sections 8 and 8a).
 *
 * A request is only a notice. It names an amount and a Lightning address; the
 * invoice is created at the moment the payer taps Pay. So this module has two
 * small jobs and no wallet in it:
 *
 *   1. ASK  - `checkOwnAddress`: before a request is sent, the user's profile
 *      address must answer LNURL-pay and accept the amount.
 *   2. PAY  - `resolveRequesterAddress` and `pullInvoice`: the payer looks up
 *      the requester's CURRENT profile address (falling back to the one signed
 *      inside the request) and pulls an invoice for exactly the amount.
 *
 * Because it only needs the profile address it works the same for Spark,
 * NWC, LNbits and Arkade users. Whether the money arrived is decided by the
 * receiving wallet's own ledger (`paymentConfirmation.js`).
 *
 * Pure service: no Pinia, Vue or i18n. Every collaborator is injected, so the
 * module is unit tested without network. Failures are `DmError`s with stable
 * codes; the UI picks the words. Invoices are never logged (docs section 10).
 */

import { decodeBolt11, parseLightningAddress } from 'nostr-core';
import { parseProfileContent } from '../../utils/nostrFetch.js';
import { DM_ERROR, DmError } from './errors.js';

/** How long the payer waits for the requester's profile before using the address signed in the request. */
export const PROFILE_LOOKUP_TIMEOUT_MS = 3_000;

const MSAT_PER_SAT = 1_000;
const HEX_64 = /^[0-9a-f]{64}$/i;

function fail(code, message, options) {
  throw new DmError(code, message, options);
}

/** A Lightning address, trimmed and lowercased; null when it is none. */
function normalizeAddress(address) {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim().toLowerCase();
  try {
    parseLightningAddress(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function requireSats(amountSats) {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'amountSats must be a positive integer');
  }
}

/**
 * Decode and check an invoice a Lightning address returned: mainnet, amount
 * equal to the request to the msat, not expired yet.
 * @returns {string} The invoice, trimmed.
 */
function validateInvoice(bolt11, amountSats, nowSec) {
  if (typeof bolt11 !== 'string' || bolt11.trim() === '') {
    fail(DM_ERROR.INVALID_INVOICE, 'no invoice was returned');
  }
  let invoice;
  try {
    invoice = decodeBolt11(bolt11.trim());
  } catch (cause) {
    return fail(DM_ERROR.INVALID_INVOICE, 'invoice does not decode', { cause });
  }
  if (invoice.network !== 'mainnet') fail(DM_ERROR.INVALID_INVOICE, 'invoice is not a mainnet invoice');
  if (invoice.amountMsat !== amountSats * MSAT_PER_SAT) {
    fail(DM_ERROR.INVALID_INVOICE, 'invoice amount does not match the request');
  }
  if (!HEX_64.test(invoice.paymentHash || '')) fail(DM_ERROR.INVALID_INVOICE, 'invoice has no payment hash');
  if (invoice.expiresAt <= nowSec) fail(DM_ERROR.INVALID_INVOICE, 'invoice is already expired');
  return invoice.paymentRequest;
}

/**
 * The LUD-21 `verify` URL of an LNURL-pay answer, only when it is `https:` and on
 * the callback's host (nostr-core `validateVerifyUrl` rule). Else null: the
 * payment is then simply not verifiable by the requester.
 */
function sameHostVerifyUrl(verifyUrl, callbackUrl) {
  if (typeof verifyUrl !== 'string' || typeof callbackUrl !== 'string') return null;
  try {
    const verify = new URL(verifyUrl);
    const callback = new URL(callbackUrl);
    const sameHost = verify.hostname.toLowerCase() === callback.hostname.toLowerCase();
    return verify.protocol === 'https:' && sameHost ? verify.toString() : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {() => string|null|undefined} deps.getProfileAddress  The user's profile `lud16`.
 * @param {(pubkey: string, options: { timeoutMs: number }) => Promise<object|null>} deps.fetchProfile
 *   `nostrFetch.fetchProfile`: the newest signed kind 0 of a person, or null.
 * @param {{ fetchPayRequest: Function, requestInvoice: Function }} deps.lnurl
 *   nostr-core's `fetchPayRequest` and `requestLnurlInvoice`.
 * @param {() => number} [deps.now]  Milliseconds.
 */
export function createRequestService({
  getProfileAddress,
  fetchProfile,
  lnurl,
  now = () => Date.now(),
} = {}) {
  for (const [name, dep] of Object.entries({ getProfileAddress, fetchProfile })) {
    if (typeof dep !== 'function') fail(DM_ERROR.INVALID_ARGUMENT, `${name} is required`);
  }
  if (!lnurl || ['fetchPayRequest', 'requestInvoice'].some((k) => typeof lnurl[k] !== 'function')) {
    fail(DM_ERROR.INVALID_ARGUMENT, 'lnurl needs fetchPayRequest and requestInvoice');
  }

  /**
   * The LNURL-pay answer of an address, checked to accept `amountSats`.
   * Anything that goes wrong before the range check is `unreachable`.
   */
  async function loadPayRequest(address, amountSats, unreachable) {
    requireSats(amountSats);
    let payRequest;
    try {
      const { name, domain } = parseLightningAddress(address);
      payRequest = await lnurl.fetchPayRequest(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`);
    } catch (cause) {
      return fail(unreachable, 'the Lightning address did not answer', { cause });
    }
    const amountMsat = amountSats * MSAT_PER_SAT;
    if (!(amountMsat >= payRequest?.minSendable && amountMsat <= payRequest?.maxSendable)) {
      fail(DM_ERROR.AMOUNT_OUT_OF_RANGE, 'the amount is outside what the Lightning address accepts');
    }
    return payRequest;
  }

  /**
   * Before sending a request: the user's profile address exists, answers
   * LNURL-pay and accepts the amount. Nothing is created or sent.
   *
   * @param {number} amountSats
   * @returns {Promise<string>} The address the request will name.
   * @throws {DmError} NO_PAYMENT_ADDRESS, PAYMENT_ADDRESS_UNREACHABLE, AMOUNT_OUT_OF_RANGE, INVALID_ARGUMENT
   */
  async function checkOwnAddress(amountSats) {
    const address = normalizeAddress(getProfileAddress());
    if (!address) fail(DM_ERROR.NO_PAYMENT_ADDRESS, 'the profile has no Lightning address');
    await loadPayRequest(address, amountSats, DM_ERROR.PAYMENT_ADDRESS_UNREACHABLE);
    return address;
  }

  /**
   * Payer side: where the requester gets paid TODAY. Their current signed
   * profile (kind 0) wins, so an address they changed after sending the request
   * is followed by new and old open requests alike. When the profile cannot be
   * fetched or names no usable address, the address signed inside the request
   * is used. Never contact data: a saved address could be stale or edited.
   *
   * @param {string} pubkey The requester.
   * @param {string} signedAddress The `lud16` of the request.
   * @returns {Promise<string>}
   */
  async function resolveRequesterAddress(pubkey, signedAddress) {
    try {
      const event = await fetchProfile(pubkey, { timeoutMs: PROFILE_LOOKUP_TIMEOUT_MS });
      const current = normalizeAddress(parseProfileContent(event).lud16);
      if (current) return current;
    } catch {
      /* no profile to ask: the signed address below is the answer */
    }
    return signedAddress;
  }

  /**
   * Payer side: an invoice from the requester's Lightning address (LNURL-pay)
   * for exactly the requested amount.
   *
   * Validated before it is handed on: the amount lies within the address's
   * min/maxSendable, the invoice decodes, is mainnet, is for exactly
   * `amountSats` and is not yet expired. The LUD-21 verify URL comes along when
   * it is `https:` on the callback's host. No LUD-12 comment is sent: the
   * requester's wallet would show it as the payment's message, and the
   * request is matched by the payment itself (paymentConfirmation.js).
   *
   * @param {object} options
   * @param {string} options.lud16 Where to ask (`resolveRequesterAddress`).
   * @param {number} options.amountSats The requested amount, whole sats.
   * @returns {Promise<{ bolt11: string, verifyUrl: string | null }>} The BOLT-11 invoice and its LUD-21 verify URL.
   * @throws {DmError} INVALID_ARGUMENT, AMOUNT_OUT_OF_RANGE, INVOICE_FETCH_FAILED
   */
  async function pullInvoice({ lud16, amountSats } = {}) {
    const payRequest = await loadPayRequest(lud16, amountSats, DM_ERROR.INVOICE_FETCH_FAILED);
    let response;
    try {
      response = await lnurl.requestInvoice(payRequest, amountSats * MSAT_PER_SAT);
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_FETCH_FAILED, 'the Lightning address did not issue an invoice', { cause });
    }
    try {
      const bolt11 = validateInvoice(response?.pr, amountSats, Math.floor(now() / 1000));
      return { bolt11, verifyUrl: sameHostVerifyUrl(response.verify, payRequest.callback) };
    } catch (cause) {
      return fail(DM_ERROR.INVOICE_FETCH_FAILED, 'the Lightning address issued an invalid invoice', { cause });
    }
  }

  return { checkOwnAddress, resolveRequesterAddress, pullInvoice };
}
