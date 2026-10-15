/**
 * Does the user's OWN wallet confirm an incoming payment the partner announced?
 *
 * An incoming `payment` message never proves anything (docs/CONTACT_CHAT.md
 * section 4): anyone can type "I sent you 50,000 sats". The chat draws such a
 * message as a payment line, or a request as paid, only when one of the
 * user's own wallets shows money that matches it:
 *
 *   1. The message carries a preimage: some incoming transaction must have a
 *      payment hash equal to sha256(preimage).
 *   2. No preimage (Spark transfers, Arkade, some NWC wallets): an incoming
 *      transaction of exactly the expected amount, settled within
 *      `windowSeconds` of the message's time.
 *
 * Whatever the sender writes is untrusted, the time included. So a claim
 * about a request (`notBefore`: when it was made) never matches money that
 * came in before the request existed, a claim dated in the future matches
 * nothing, and a transaction is used once: never twice in one call, never
 * one listed in `consumed` (it settled something before). Pure: transactions
 * are passed in.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** How far a wallet's settle time may be from the message's claimed time. */
export const CONFIRMATION_WINDOW_SECONDS = 15 * 60;

/** Clock difference tolerated between the two phones. */
const CLOCK_SKEW_SECONDS = 5 * 60;

const HEX_64 = /^[0-9a-f]{64}$/i;

export function hashOfPreimage(preimage) {
  if (typeof preimage !== 'string' || !HEX_64.test(preimage)) return null;
  const bytes = Uint8Array.from(preimage.match(/../g), (pair) => Number.parseInt(pair, 16));
  return bytesToHex(sha256(bytes));
}

/**
 * @typedef {object} IncomingTransaction  What the wallets' histories give, reduced to what matters.
 * @property {number} amountSats
 * @property {number} settledAt Unix seconds.
 * @property {string | null} [paymentHash]
 * @property {string | null} [walletId] The wallet whose history shows it.
 * @property {string | null} [id] The wallet's own id for it.
 */

/**
 * A transaction's identity across runs: its payment hash, else wallet and id.
 * Null when it has neither (it can then only be told apart within one call).
 * @param {IncomingTransaction} tx
 */
export function transactionKey(tx) {
  if (tx?.paymentHash) return tx.paymentHash.toLowerCase();
  return tx?.walletId && tx?.id ? `${tx.walletId}:${tx.id}` : null;
}

/**
 * Which transaction confirms which claim.
 *
 * @param {Array<{ id: string, createdAt: number, payment: { amountSats: number, preimage: string | null },
 *   notBefore?: number }>} payments Incoming payment claims. `payment.amountSats` is the amount the
 *   transaction must have (for a request: the requested amount); `notBefore` the time it may not predate.
 * @param {IncomingTransaction[]} transactions Completed incoming transactions of the user's wallets.
 * @param {{ windowSeconds?: number, consumed?: Set<string>, nowSeconds?: number }} [options]
 *   `consumed`: keys (`transactionKey`) of transactions that settled something already.
 * @returns {Map<string, IncomingTransaction>} Claim id -> the transaction that confirms it.
 */
export function matchIncomingPayments(payments, transactions, {
  windowSeconds = CONFIRMATION_WINDOW_SECONDS,
  consumed = new Set(),
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const confirmed = new Map();
  const used = new Set();
  // Two connections can expose the same underlying Lightning wallet. Its
  // payment hash identifies one receipt, even if both histories list it.
  const usedKeys = new Set([...consumed].map(key => typeof key === 'string' && HEX_64.test(key) ? key.toLowerCase() : key));
  const txs = Array.isArray(transactions) ? transactions : [];
  const free = (tx, i) => !used.has(i) && !usedKeys.has(transactionKey(tx));
  const use = (index, message) => {
    used.add(index);
    const tx = txs[index], key = transactionKey(tx);
    if (key) usedKeys.add(key);
    confirmed.set(message.id, tx);
  };
  const inTime = (tx, message) => Number.isFinite(tx.settledAt)
    && !(tx.settledAt < (message.notBefore ?? -Infinity) - CLOCK_SKEW_SECONDS);

  // Exact matches first: a preimage match must not lose its transaction to an
  // earlier message that only matched by amount. Future-dated claims match nothing.
  const withProof = [];
  const withoutProof = [];
  for (const message of payments ?? []) {
    if (!(message.createdAt <= nowSeconds + CLOCK_SKEW_SECONDS)) continue;
    const preimageHash = hashOfPreimage(message.payment?.preimage);
    const suppliedHash = typeof message.payment?.paymentHash === 'string' && HEX_64.test(message.payment.paymentHash)
      ? message.payment.paymentHash.toLowerCase() : null;
    // A preimage and explicit hash that disagree prove nothing.
    if (preimageHash && suppliedHash && preimageHash !== suppliedHash) continue;
    const hash = preimageHash || suppliedHash;
    if (message.requireProof && !hash) continue;
    (hash ? withProof : withoutProof).push({ message, hash });
  }

  for (const { message, hash } of withProof) {
    const index = txs.findIndex((tx, i) => free(tx, i) && tx.paymentHash?.toLowerCase() === hash && inTime(tx, message));
    if (index !== -1) use(index, message);
  }

  for (const { message } of withoutProof) {
    const amount = message.payment?.amountSats;
    const index = txs.findIndex((tx, i) => (
      free(tx, i)
      && tx.amountSats === amount
      && inTime(tx, message)
      && Math.abs(tx.settledAt - message.createdAt) <= windowSeconds
    ));
    if (index !== -1) use(index, message);
  }
  return confirmed;
}

/**
 * @param {Parameters<typeof matchIncomingPayments>[0]} payments
 * @param {IncomingTransaction[]} transactions
 * @param {{ windowSeconds?: number }} [options]
 * @returns {Set<string>} Ids of the messages the wallets confirm.
 */
export function confirmIncomingPayments(payments, transactions, options) {
  return new Set(matchIncomingPayments(payments, transactions, options).keys());
}
