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
 *   1. mint    each paid quote becomes ecash proofs. A quote may be locked to
 *              the identity's Nostr key; only those quotes need a signature.
 *              Until this runs, the money is a promise held by the mint.
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
import { secp256k1 } from '@noble/curves/secp256k1.js';

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

/**
 * Nostr public keys are x-only, while NUT-20 quotes carry a compressed key.
 * The same x coordinate has two possible private-key representations. Give
 * cashu-ts both so it can select the one matching the quote's 02/03 prefix.
 */
function signingKeyCandidates(privkeyHex) {
  const key = String(privkeyHex || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new SweepError('The identity signing key is invalid', 'INVALID_SIGNING_KEY');
  }

  const scalar = BigInt(`0x${key}`);
  const order = secp256k1.Point.Fn.ORDER;
  if (scalar <= 0n || scalar >= order) {
    throw new SweepError('The identity signing key is invalid', 'INVALID_SIGNING_KEY');
  }

  const negated = (order - scalar).toString(16).padStart(64, '0');
  return negated === key ? [key] : [key, negated];
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
export async function mintQuotes({
  quotes,
  privkeyHex,
  mintUrl,
  walletFactory = walletFor,
}) {
  if (!quotes?.length) return { proofs: [], minted: [], failed: [] };
  if (!mintUrl) throw new SweepError('No mint for these payments', 'NO_MINT');

  const wallet = await walletFactory(mintUrl);
  const proofs = [];
  const minted = [];
  const failed = [];

  for (const quote of quotes) {
    try {
      // npub.cash tells us where to find a quote, but the mint is the source
      // of truth for its state, amount and NUT-20 lock. In particular, an
      // unlocked quote must NOT receive a signature: CDK rejects one as
      // invalid, which was the cause of bucket payouts returning HTTP 400.
      const mintQuote = await wallet.checkMintQuoteBolt11(quote.quoteId);
      const state = String(mintQuote?.state || '').toUpperCase();
      if (state !== 'PAID') {
        throw new SweepError(
          state === 'ISSUED' ? 'Payment was already collected' : 'Payment is not ready',
          state === 'ISSUED' ? 'QUOTE_ISSUED' : 'QUOTE_NOT_PAID',
        );
      }

      const amount = Number(mintQuote.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new SweepError('The mint returned an invalid amount', 'INVALID_QUOTE_AMOUNT');
      }

      // NUT-23 defines `expiry` as the deadline for paying the Lightning
      // invoice, not a deadline for redeeming an invoice that is already
      // PAID. cashu-ts currently applies its generic expiry guard during
      // minting, so omit that one field after the state check above.
      const { expiry: _invoicePaymentDeadline, ...redeemableQuote } = mintQuote;
      const config = redeemableQuote.pubkey
        ? { privkey: signingKeyCandidates(privkeyHex) }
        : undefined;
      const got = await wallet.mintProofsBolt11(amount, redeemableQuote, config);
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
export async function pruneSpentProofs({ proofs, mintUrl, requireCheck = false }) {
  if (!proofs?.length || !mintUrl) return proofs || [];
  try {
    const wallet = await walletFor(mintUrl);
    const states = await wallet.checkProofsStates(proofs);
    if (!Array.isArray(states) || states.length !== proofs.length) {
      throw new Error('Mint returned an incomplete proof-state response');
    }
    return proofs.filter((_, i) => states[i]?.state === 'UNSPENT');
  } catch (err) {
    if (requireCheck) {
      throw new SweepError('Could not validate restored proofs', 'PROOF_CHECK_FAILED', err);
    }
    console.warn('[social-bucket] could not check proof states, keeping all', err);
    return proofs;
  }
}
