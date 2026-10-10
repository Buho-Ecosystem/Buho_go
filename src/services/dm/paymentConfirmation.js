/**
 * Does the user's OWN wallet confirm an incoming payment the partner announced?
 *
 * An incoming `payment` message never proves anything (docs/CONTACT_CHAT.md
 * section 4): anyone can type "I sent you 50,000 sats". The chat draws such a
 * message as a payment line only when one of the user's own wallets shows
 * money that matches it:
 *
 *   1. The message carries a preimage: some incoming transaction must have a
 *      payment hash equal to sha256(preimage). Exact; no time involved.
 *   2. No preimage (Spark transfers, Arkade, some NWC wallets): an incoming
 *      transaction with the same amount, settled within `windowSeconds` of the
 *      message's time.
 *
 * One transaction confirms at most one message, so a single payment cannot
 * vouch for several claims. Pure: transactions are passed in.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** How far a wallet's settle time may be from the message's claimed time. */
export const CONFIRMATION_WINDOW_SECONDS = 15 * 60;

const HEX_64 = /^[0-9a-f]{64}$/i;

function hashOfPreimage(preimage) {
  if (typeof preimage !== 'string' || !HEX_64.test(preimage)) return null;
  const bytes = Uint8Array.from(preimage.match(/../g), (pair) => Number.parseInt(pair, 16));
  return bytesToHex(sha256(bytes));
}

/**
 * @typedef {object} IncomingTransaction  What the wallets' histories give, reduced to what matters.
 * @property {number} amountSats
 * @property {number} settledAt Unix seconds.
 * @property {string | null} [paymentHash]
 */

/**
 * @param {Array<{ id: string, createdAt: number, payment: { amountSats: number, preimage: string | null } }>} payments
 *   Incoming `payment` messages, oldest first.
 * @param {IncomingTransaction[]} transactions Completed incoming transactions of the user's wallets.
 * @param {{ windowSeconds?: number }} [options]
 * @returns {Set<string>} Ids of the messages the wallets confirm.
 */
export function confirmIncomingPayments(payments, transactions, { windowSeconds = CONFIRMATION_WINDOW_SECONDS } = {}) {
  const confirmed = new Set();
  const used = new Set();
  const txs = Array.isArray(transactions) ? transactions : [];

  const claim = (index) => { used.add(index); return true; };

  // Exact matches first: a preimage match must not lose its transaction to an
  // earlier message that only matched by amount.
  const withProof = [];
  const withoutProof = [];
  for (const message of payments ?? []) {
    const hash = hashOfPreimage(message.payment?.preimage);
    (hash ? withProof : withoutProof).push({ message, hash });
  }

  for (const { message, hash } of withProof) {
    const index = txs.findIndex((tx, i) => !used.has(i) && tx.paymentHash?.toLowerCase() === hash);
    if (index !== -1 && claim(index)) confirmed.add(message.id);
  }

  for (const { message } of withoutProof) {
    const amount = message.payment?.amountSats;
    const index = txs.findIndex((tx, i) => (
      !used.has(i)
      && tx.amountSats === amount
      && Number.isFinite(tx.settledAt)
      && Math.abs(tx.settledAt - message.createdAt) <= windowSeconds
    ));
    if (index !== -1 && claim(index)) confirmed.add(message.id);
  }
  return confirmed;
}
