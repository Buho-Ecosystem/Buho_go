/**
 * payAgain — which payments can be made again, and to where.
 *
 * Pay again never pays: it hands a past recipient back to the one send
 * pipeline with the last amount suggested, and the payment ends on the slide.
 * Only the record the main send flow wrote at send time is repeated
 * (Wallet.vue `payAgainRecordFor`), stamped on a payment only when it carries
 * an id the send returned (transactionMetadata `consumePendingContactLinks`).
 * Other stamps can be matched by time or guessed and are never read here; the
 * LUD-11 reusable pay link is the one older fallback, without an amount.
 */

import { isArkadeAddress, isLightningAddress, isLnurl, isSparkAddress } from './addressUtils.js';

/** Destination kinds Pay again may repeat, with the check each address must pass. */
const KINDS = {
  lightning: isLightningAddress,
  lnurl: isLnurl,
  spark: isSparkAddress,
  arkade: isArkadeAddress,
};

/** A recipient currency code, as LUD-21 names it. */
export const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * True for a wallet type that sends an amount in the recipient's currency as
 * such (LUD-21); an NWC wallet pays the sat estimate only.
 * @param {string|null} walletType
 */
export function sendsPayoutAmount(walletType) {
  return walletType === 'spark' || walletType === 'arkade' || walletType === 'lnbits';
}

/**
 * Normalize a Pay again record, or null when it is not one.
 *
 * @param {unknown} raw  `{ address, addressType, amountSats?, payout? }`
 * @returns {{ address: string, addressType: string, amountSats: number|null,
 *   payout: { code: string, amount: number }|null }|null}
 */
export function payAgainRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const address = typeof raw.address === 'string' ? raw.address.trim() : '';
  const check = Object.hasOwn(KINDS, raw.addressType) ? KINDS[raw.addressType] : null;
  if (!address || !check || !check(address)) return null;
  const sats = Number(raw.amountSats);
  const amount = Number(raw.payout?.amount);
  return {
    address,
    addressType: raw.addressType,
    amountSats: Number.isSafeInteger(sats) && sats > 0 ? sats : null,
    payout: CURRENCY_CODE.test(raw.payout?.code || '') && Number.isFinite(amount) && amount > 0
      ? { code: raw.payout.code, amount }
      : null,
  };
}

/**
 * The ids a send's payment shows up under in the wallet's history (its id,
 * payment hash or preimage, as the provider reports them), from the send's
 * result. A record is stamped only on a payment that carries one of them.
 *
 * @param {unknown} values
 * @returns {string[]}
 */
export function payAgainProof(values) {
  if (!Array.isArray(values)) return [];
  // Hashes and preimages are hex, which providers spell in either case.
  return [...new Set(values.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().toLowerCase()))];
}

/**
 * True when a history transaction is the payment a send's proof names.
 *
 * @param {object|null} tx
 * @param {string[]} proof  from payAgainProof
 * @returns {boolean}
 */
export function provesPayment(tx, proof) {
  if (!tx || !Array.isArray(proof) || proof.length === 0) return false;
  return [tx.id, tx.paymentHash, tx.payment_hash, tx.preimage]
    .some((v) => typeof v === 'string' && v && proof.includes(v.toLowerCase()));
}

/**
 * What Pay again would pay for a transaction, or null when it offers none.
 *
 * Only a completed outgoing payment qualifies: a receive has no recipient
 * of ours, and a pending or failed one has not been paid yet.
 *
 * `withPayLink` also accepts the older LUD-11 pay link, which Transaction
 * Details has always offered. It can be stamped by time alone, so History's
 * swipe, on every row, leaves it out.
 *
 * @param {{ tx: object|null, metadata: object|null, withPayLink?: boolean }} input
 * @returns {ReturnType<typeof payAgainRecord>}
 */
export function payAgainTarget({ tx, metadata, withPayLink = false } = {}) {
  if (!tx || tx.type !== 'outgoing') return null;
  if ((tx.status || 'completed') !== 'completed') return null;
  const recorded = payAgainRecord(metadata?.payAgain);
  if (recorded || !withPayLink) return recorded;
  // Before the record: a reusable LUD-11 pay link, without an amount.
  return payAgainRecord({ address: metadata?.payLink, addressType: 'lnurl' });
}
