/**
 * Paying through Nostr Wallet Connect, one way for every caller.
 *
 * A payment counts as made only on proof: the preimage the wallet returns
 * must hash to the invoice's payment hash. Some wallets (often ones running
 * on a phone, woken by a push) answer before a payment is final, or with
 * an empty preimage, or not in time at all. Those outcomes are unknown, not
 * failed: the invoice is looked up a few times, and if it still cannot be
 * told the person is asked to check their wallet. A payment is never sent
 * a second time on its own.
 *
 * Callers keep the old shape: `{ preimage }` on success, an Error with a
 * `code` otherwise (utils/nwcErrors explains it).
 */
import { Invoice } from '@getalby/lightning-tools';
import { NWC_ERROR, isUncertainPaymentError, nwcError } from '../utils/nwcErrors.js';
import { spendingLimitFrom } from '../utils/nwcWallet.js';

/** Waits between lookups of an unconfirmed payment, half a minute in all. */
export const LOOKUP_DELAYS_MS = Object.freeze([2000, 5000, 8000, 15000]);

/**
 * How long one lookup may take. The SDK waits 60 s for a lookup_invoice
 * reply; a wallet that is silent would stretch the check to five minutes.
 * 10 s, like the SDK's other reads, keeps the whole check near 70 s.
 */
export const LOOKUP_WAIT_MS = 10000;

async function sha256Hex(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when `preimage` proves payment of `paymentHash`. */
export async function provesPayment(preimage, paymentHash) {
  const p = String(preimage || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(p) || !paymentHash) return false;
  return (await sha256Hex(p)) === String(paymentHash).toLowerCase();
}

function decode(invoice) {
  try {
    const decoded = new Invoice({ pr: invoice });
    return { paymentHash: decoded.paymentHash, amountSats: Number(decoded.satoshi) || 0 };
  } catch {
    return { paymentHash: null, amountSats: 0 };
  }
}

/**
 * @param {object} nwc NostrWebLNProvider (its `client` is the NIP-47 client)
 * @param {string} invoice BOLT11
 * @param {object} [options]
 * @param {{ remainingSats: number, renewsAt?: number|null }|null} [options.limit]
 *   the connection's spending limit as last read, when the wallet shares
 *   it: a payment above it is stopped here, with the reason, once the
 *   wallet confirms the limit still stands
 * @param {number[]} [options.lookupDelays]
 * @param {number} [options.lookupWait] longest wait for one lookup's answer
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {(invoice: string) => { paymentHash: string|null, amountSats: number }} [options.decodeInvoice]
 * @returns {Promise<{ preimage: string }>}
 */
export async function payWithNwc(nwc, invoice, {
  limit = null,
  lookupDelays = LOOKUP_DELAYS_MS,
  lookupWait = LOOKUP_WAIT_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  decodeInvoice = decode,
} = {}) {
  const { paymentHash, amountSats } = decodeInvoice(invoice);

  if (limit && amountSats > 0 && amountSats > limit.remainingSats) {
    const current = await currentLimit(nwc, limit);
    if (current && amountSats > current.remainingSats) {
      throw nwcError(NWC_ERROR.LIMIT_TOO_LOW, 'Above the connection spending limit', {
        remainingSats: current.remainingSats,
        renewsAt: current.renewsAt || null,
      });
    }
  }

  let answer = null;
  try {
    answer = await nwc.sendPayment(invoice);
  } catch (error) {
    if (!paymentHash || !isUncertainPaymentError(error)) throw error;
  }

  if (answer && (!paymentHash || await provesPayment(answer.preimage, paymentHash))) {
    return { preimage: answer.preimage };
  }
  return confirmByLookup(nwc, paymentHash, { lookupDelays, lookupWait, sleep });
}

/**
 * The limit as the wallet sees it now. The one passed in may be old: the
 * person may have raised it in their wallet, which is exactly what the
 * error asks them to do. Without an answer the last known limit stands.
 */
async function currentLimit(nwc, known) {
  const client = nwc?.client;
  if (!client || typeof client.getBudget !== 'function') return known;
  try {
    return spendingLimitFrom(await client.getBudget());
  } catch {
    return known;
  }
}

/** The answer, or a NO_ANSWER error once `ms` passed (the request itself runs on). */
function withinWait(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(nwcError(NWC_ERROR.NO_ANSWER, 'No answer to the lookup')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Ask the wallet about a payment whose outcome is unknown. Settled with a
 * proving preimage: paid. Marked failed: not paid. Anything else after the
 * last try: NWC_PAYMENT_UNCONFIRMED, so the person checks before paying again.
 * A record the wallet marks settled is its confirmation too.
 */
async function confirmByLookup(nwc, paymentHash, { lookupDelays, lookupWait, sleep }) {
  const client = nwc?.client;
  if (client && typeof client.lookupInvoice === 'function') {
    for (const delay of lookupDelays) {
      await sleep(delay);
      let tx;
      try {
        tx = await withinWait(client.lookupInvoice({ payment_hash: paymentHash }), lookupWait);
      } catch (error) {
        if (error?.code === 'NOT_IMPLEMENTED' || error?.code === 'RESTRICTED') break;
        continue; // NOT_FOUND or no answer yet: the wallet may still be paying
      }
      if (tx?.state === 'failed') throw nwcError('PAYMENT_FAILED', 'Payment failed');
      if (await provesPayment(tx?.preimage, paymentHash)) return { preimage: tx.preimage };
      // The wallet's own record says settled: that is its confirmation,
      // even from wallets that keep the preimage to themselves.
      if (tx?.state === 'settled' || Number(tx?.settled_at) > 0) return { preimage: tx.preimage || '' };
    }
  }
  throw nwcError(NWC_ERROR.UNCONFIRMED, 'Payment not confirmed', { paymentHash });
}
