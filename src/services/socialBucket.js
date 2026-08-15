/**
 * Moving money out of the Social Bucket.
 *
 * The bucket is not a wallet and must never grow into one. It is an inbox: money
 * arrives at the identity's address, waits as ecash, and the only thing a user
 * ever does with it is move it to a wallet they already have. Everything here
 * serves that one sentence.
 *
 * The sweep is two mint operations with a Lightning invoice in the middle:
 *
 *   1. mint    each paid quote becomes ecash proofs. The quote is locked to the
 *              identity's Nostr key, so this step needs a signature. Until it
 *              runs, the money is a promise held by npub.cash.
 *   2. melt    the proofs pay a bolt11 invoice created by the destination
 *              BuhoGO wallet, and the sats land where the user actually keeps
 *              money.
 *
 * Proofs are bearer money. Between step 1 and step 2 they exist only in this
 * process, so the caller MUST persist them the moment `mintQuotes` returns and
 * before anything else can fail. The store does exactly that.
 *
 * Fees: a melt reserves more than the invoice amount and refunds the difference
 * as change proofs. That change is real money, so it is returned here and kept
 * for the next sweep rather than abandoned.
 */

import { Wallet } from '@cashu/cashu-ts';

/** Nothing below this is worth a melt: the fee would eat it. */
export const MIN_SWEEP_SATS = 10;

/**
 * How much of the balance to hold back when sizing the invoice, before the mint
 * tells us the real reserve. Two sats plus two percent covers every mainnet
 * mint we have seen; the exact figure is corrected on the next line anyway
 * because the melt quote is checked against the balance before we commit.
 */
function feeBuffer(amount) {
  return Math.max(2, Math.ceil(amount * 0.02));
}

export class SweepError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'SweepError';
    this.code = code;
    this.cause = cause;
  }
}

/** One wallet per mint per sweep. Loading a mint is a network call. */
async function walletFor(mintUrl) {
  const wallet = new Wallet(mintUrl, { unit: 'sat' });
  await wallet.loadMint();
  return wallet;
}

export function sumProofs(proofs) {
  return (proofs || []).reduce((total, p) => total + (Number(p?.amount) || 0), 0);
}

/**
 * Turn paid quotes into proofs.
 *
 * Each quote is minted independently: one failing quote must not strand the
 * others, and a quote that was already minted (a sweep interrupted after the
 * mint but before we persisted) fails on its own without taking the batch down.
 *
 * @returns {Promise<{proofs: Array, minted: Array<string>, failed: Array<{quoteId, reason}>}>}
 */
export async function mintQuotes({ quotes, privkeyHex, mintUrl }) {
  if (!quotes?.length) return { proofs: [], minted: [], failed: [] };
  if (!mintUrl) throw new SweepError('No mint for these payments', 'NO_MINT');

  const wallet = await walletFor(mintUrl);
  const proofs = [];
  const minted = [];
  const failed = [];

  for (const quote of quotes) {
    const amount = Number(quote.amount) || 0;
    if (amount <= 0) continue;
    try {
      const got = await wallet.mintProofsBolt11(amount, quote.quoteId, {
        privkey: privkeyHex,
      });
      proofs.push(...got);
      minted.push(quote.quoteId);
    } catch (err) {
      console.warn('[social-bucket] could not mint quote', quote.quoteId, err);
      failed.push({ quoteId: quote.quoteId, reason: err?.message || 'unknown' });
    }
  }

  return { proofs, minted, failed };
}

/**
 * Pay an invoice with proofs.
 *
 * `createInvoice` is a callback rather than an amount because the invoice can
 * only be written once the spendable amount is known, and that depends on the
 * mint's own fee reserve. We size it, ask the mint, and if the reserve turns out
 * larger than assumed we size it down once and ask again. An unused invoice
 * simply expires.
 *
 * @param {(sats:number) => Promise<string>} createInvoice
 * @returns {Promise<{paid:number, fee:number, change:Array, invoice:string}>}
 */
export async function meltToInvoice({ proofs, mintUrl, privkeyHex, createInvoice }) {
  const available = sumProofs(proofs);
  if (available < MIN_SWEEP_SATS) {
    throw new SweepError('Too little to move', 'TOO_SMALL');
  }

  const wallet = await walletFor(mintUrl);

  let target = available - feeBuffer(available);
  let invoice;
  let meltQuote;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (target < MIN_SWEEP_SATS) {
      throw new SweepError('Fees would eat this', 'FEES_TOO_HIGH');
    }

    invoice = await createInvoice(target);
    if (!invoice) throw new SweepError('The wallet did not give an invoice', 'NO_INVOICE');

    meltQuote = await wallet.createMeltQuoteBolt11(invoice);
    const needed = Number(meltQuote.amount) + Number(meltQuote.fee_reserve || 0);

    if (needed <= available) break;

    // The mint wants more than we guessed. Resize once using its real number
    // rather than guessing again.
    target = available - Number(meltQuote.fee_reserve || 0) - 1;
    meltQuote = null;
  }

  if (!meltQuote) throw new SweepError('Fees would eat this', 'FEES_TOO_HIGH');

  const result = await wallet.meltProofsBolt11(meltQuote, proofs, {
    privkey: privkeyHex,
  });

  const change = result?.change || [];
  return {
    paid: Number(meltQuote.amount) || 0,
    fee: Math.max(0, available - (Number(meltQuote.amount) || 0) - sumProofs(change)),
    change,
    invoice,
  };
}

/**
 * Drop proofs the mint says are already spent.
 *
 * Runs before a sweep so an interrupted previous attempt cannot make the bucket
 * claim a balance that no longer exists. Failure here is not fatal: an
 * unreachable mint means we keep what we have and try again later.
 */
export async function pruneSpentProofs({ proofs, mintUrl }) {
  if (!proofs?.length || !mintUrl) return proofs || [];
  try {
    const wallet = await walletFor(mintUrl);
    const states = await wallet.checkProofsStates(proofs);
    return proofs.filter((_, i) => states[i]?.state === 'UNSPENT');
  } catch (err) {
    console.warn('[social-bucket] could not check proof states, keeping all', err);
    return proofs;
  }
}
