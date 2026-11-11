/**
 * Cashu proofs as BuhoGO keeps them: plain objects whose `amount` is a whole
 * number of sats.
 *
 * cashu-ts 4 hands out proofs whose amount is an `Amount` object, and
 * `Amount` turns into text when written as JSON ("8", not 8). NIP-60 wants
 * a number, and so do other wallets reading the same Nostr backup. So every
 * proof is made plain where it enters the app (the mint, the disk, the
 * relays), and everything after that point (merging, sums, storage,
 * backups) sees one shape. cashu-ts accepts plain proofs back as they are.
 */

import { Amount } from '@cashu/cashu-ts';

/** One proof made plain, or null when it is not a usable proof. */
export function plainProof(proof) {
  if (!proof || typeof proof !== 'object') return null;
  const { id, secret, C } = proof;
  if (typeof id !== 'string' || typeof secret !== 'string' || typeof C !== 'string') return null;
  let amount;
  try {
    // Accepts a number, a decimal string and an Amount (also one that went
    // through structuredClone); throws on anything else or past 2^53.
    amount = Amount.from(proof.amount).toNumber();
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return { ...proof, amount };
}

/** Proofs made plain; anything that is not a usable proof is left out. */
export function plainProofs(proofs) {
  if (!Array.isArray(proofs)) return [];
  return proofs.map(plainProof).filter(Boolean);
}
