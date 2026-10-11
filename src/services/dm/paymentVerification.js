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
 * The host alone proves little: a shared service (getalby.com, ...) hosts
 * many accounts, and a payer could pay an invoice of their OWN account there
 * and send that verify URL. So the invoice must also belong to the
 * requester's address: its description hash is the hash of that address's
 * LNURL-pay metadata (LUD-06), which differs per account. And it must be
 * newer than the request, so an older payment cannot be passed off for it.
 *
 * Pure: the LNURL calls and the timer are injected.
 */

import { decodeBolt11, parseLightningAddress } from 'nostr-core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { hashOfPreimage } from './paymentConfirmation.js';

/** How long a verify URL may take to answer. */
export const VERIFY_TIMEOUT_MS = 5_000;

const MSAT_PER_SAT = 1_000;

/** Clock difference tolerated between the invoice issuer and the requester's phone. */
const CLOCK_SKEW_SECONDS = 5 * 60;

/** The LNURL-pay endpoint of an address (LUD-16). */
function payEndpointOf(address) {
  const { name, domain } = parseLightningAddress(address.trim());
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

/** sha256 of the metadata string, hex: what an invoice of this address commits to. */
function metadataHash(metadata) {
  return bytesToHex(sha256(new TextEncoder().encode(metadata)));
}

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
 * @param {number} options.notBefore When the request was made (unix seconds): an older invoice does not count.
 * @param {Set<string>} options.usedHashes Payment hashes that settled a request already.
 * @param {(verifyUrl: string, callback: string) => Promise<object>} options.verifyPayment nostr-core `verifyPayment`.
 * @param {(url: string) => Promise<{ metadata: string }>} options.fetchPayRequest nostr-core `fetchPayRequest`.
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 * @returns {Promise<{ address: string, paymentHash: string } | null>} Null: not (yet) verified. Never throws.
 */
export async function verifyPaymentViaAddress({
  verifyUrl, addresses, amountSats, notBefore, usedHashes, verifyPayment, fetchPayRequest, setTimer, clearTimer,
}) {
  try {
    const url = new URL(verifyUrl);
    if (url.protocol !== 'https:') return null;
    const onHost = addresses.filter((candidate) => {
      const origin = originOf(candidate);
      return origin !== null && new URL(origin).hostname === url.hostname;
    });
    if (onHost.length === 0) return null;

    const answer = await withTimeout(verifyPayment(url.toString(), originOf(onHost[0])), VERIFY_TIMEOUT_MS, setTimer, clearTimer);
    if (answer?.settled !== true) return null;
    const invoice = decodeBolt11(answer.pr);
    if (invoice.network !== 'mainnet' || !(invoice.amountMsat >= amountSats * MSAT_PER_SAT)) return null;
    if (!(invoice.timestamp >= notBefore - CLOCK_SKEW_SECONDS)) return null;
    const paymentHash = invoice.paymentHash?.toLowerCase();
    if (!paymentHash || usedHashes.has(paymentHash)) return null;
    if (answer.preimage && hashOfPreimage(answer.preimage) !== paymentHash) return null;

    // Whose invoice is it? Only one of the requester's own addresses counts.
    const committed = invoice.descriptionHash?.toLowerCase();
    if (!committed) return null;
    for (const address of onHost) {
      const payRequest = await withTimeout(fetchPayRequest(payEndpointOf(address)), VERIFY_TIMEOUT_MS, setTimer, clearTimer);
      if (typeof payRequest?.metadata === 'string' && metadataHash(payRequest.metadata) === committed) {
        return { address: address.trim().toLowerCase(), paymentHash };
      }
    }
    return null;
  } catch {
    return null;
  }
}
