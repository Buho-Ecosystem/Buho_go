/**
 * Does the requester's own Lightning address vouch for a payment? (LUD-21)
 *
 * The ledger check (`paymentConfirmation.js`) only sees wallets inside the app.
 * When a request was paid to an address whose wallet lives elsewhere (Alby,
 * Wallet of Satoshi...), the payer's `payment` message may carry the `verify`
 * URL its invoice came with. The requester asks that URL whether the invoice is
 * settled.
 *
 * The URL comes from the payer, so it is untrusted: it is fetched only when
 * `https:` and on the host of a Lightning address the REQUESTER named
 * (the one signed into the request, or the current profile address). Nothing
 * else is ever requested. The answer counts only when the invoice is settled,
 * mainnet, for at least the requested amount, its preimage (if given) matches,
 * and the payment hash did not already settle another request.
 *
 * Pure: the LNURL call and the timer are injected.
 */

import { decodeBolt11, parseLightningAddress } from 'nostr-core';
import { hashOfPreimage } from './paymentConfirmation.js';

/** How long a verify URL may take to answer. */
export const VERIFY_TIMEOUT_MS = 5_000;

const MSAT_PER_SAT = 1_000;

/** The `https://<domain>/` of an address, or null when it is none. */
function originOf(address) {
  try {
    return typeof address === 'string' ? `https://${parseLightningAddress(address.trim()).domain}/` : null;
  } catch {
    return null;
  }
}

/** Run `promise`, giving up after `timeoutMs`. */
function withTimeout(promise, timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout) {
  let handle;
  const timeout = new Promise((_, reject) => { handle = setTimer(() => reject(new Error('timeout')), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimer(handle));
}

/**
 * @param {object} options
 * @param {string} options.verifyUrl The payer's claim (untrusted).
 * @param {Array<string | null | undefined>} options.addresses Lightning addresses of the requester.
 * @param {number} options.amountSats Requested amount.
 * @param {Set<string>} options.usedHashes Payment hashes that settled a request already.
 * @param {(verifyUrl: string, callback: string) => Promise<object>} options.verifyPayment nostr-core `verifyPayment`.
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 * @returns {Promise<{ address: string, paymentHash: string } | null>} Null: not (yet) verified. Never throws.
 */
export async function verifyPaymentViaAddress({
  verifyUrl, addresses, amountSats, usedHashes, verifyPayment, setTimer, clearTimer,
}) {
  try {
    const url = new URL(verifyUrl);
    if (url.protocol !== 'https:') return null;
    const address = addresses.find((candidate) => {
      const origin = originOf(candidate);
      return origin !== null && new URL(origin).hostname === url.hostname;
    });
    if (!address) return null;

    const answer = await withTimeout(verifyPayment(url.toString(), originOf(address)), VERIFY_TIMEOUT_MS, setTimer, clearTimer);
    if (answer?.settled !== true) return null;
    const invoice = decodeBolt11(answer.pr);
    if (invoice.network !== 'mainnet' || !(invoice.amountMsat >= amountSats * MSAT_PER_SAT)) return null;
    const paymentHash = invoice.paymentHash?.toLowerCase();
    if (!paymentHash || usedHashes.has(paymentHash)) return null;
    if (answer.preimage && hashOfPreimage(answer.preimage) !== paymentHash) return null;
    return { address: address.trim().toLowerCase(), paymentHash };
  } catch {
    return null;
  }
}
