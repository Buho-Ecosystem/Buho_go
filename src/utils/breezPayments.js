/**
 * Pure mapping layer between Breez SDK Spark models and BuhoGO's wallet
 * contract shapes. Zero imports by design: BreezSparkWalletProvider
 * delegates here, and the unit suite exercises these functions directly
 * without dragging the provider's runtime import chain (stores, fiat-rate
 * service, LNURL helpers) into plain Node.
 *
 * Ground rules encoded here (see Plans WIP/breez-spark-migration.md):
 *  - `Payment.details` is a FLATTENED tagged union: `{type:'lightning',
 *    htlcDetails, invoice, ...}` — variants are narrowed by discriminant,
 *    never accessed as `details.lightning`.
 *  - Send rows are re-grossed (amount + fee) because BuhoGO's normalizer
 *    treats a Spark row's `amount` as the total debited.
 *  - Status sets pass through verbatim: Breez's closed
 *    completed|pending|failed set equals BuhoGO's.
 */

export const BREEZ_PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/**
 * Narrow a Breez Payment's details union. Returns the details object when
 * its `type` is one of the requested variants, else null.
 */
export function detailsArm(payment, ...types) {
  const d = payment?.details;
  if (d && types.includes(d.type)) return d;
  return null;
}

/**
 * Payment hash carried by a lightning- or spark-settled payment. A bolt11
 * invoice can settle over either rail, and both arms carry the HTLC details
 * (required on lightning, optional on spark).
 */
export function paymentHashOf(payment) {
  const arm = detailsArm(payment, 'lightning', 'spark');
  return arm?.htlcDetails?.paymentHash || null;
}

/** Preimage from either settling rail, or null. */
export function preimageOf(payment) {
  const arm = detailsArm(payment, 'lightning', 'spark');
  return arm?.htlcDetails?.preimage || null;
}

const RAW_TYPE_BY_METHOD = Object.freeze({
  lightning: 'LIGHTNING',
  spark: 'SPARK_TRANSFER',
  deposit: 'STATIC_DEPOSIT',
  withdraw: 'WITHDRAWAL',
  token: 'TOKEN',
});

/**
 * Map one Breez Payment onto the transaction-row shape BuhoGO's normalizer
 * and transaction UIs consume (same contract as the direct engine's rows).
 */
export function mapBreezPaymentToTx(payment) {
  const isSend = payment.paymentType === 'send';
  const fee = Math.max(0, Number(payment.fees ?? 0));
  const net = Number(payment.amount ?? 0);
  const d = payment.details;

  let description = '';
  let bolt11 = null;

  if (d?.type === 'lightning') {
    // LNURL-pay / Lightning-address receives carry the human memo in the
    // sender comment; the bolt11 description there is a LUD-06 hash.
    description = d.lnurlReceiveMetadata?.senderComment || d.description || '';
    bolt11 = d.invoice || null;
  } else if (d?.type === 'spark' || d?.type === 'token') {
    description = d.invoiceDetails?.description || '';
  }

  return {
    id: payment.id,
    type: isSend ? 'send' : 'receive',
    // Fee-inclusive gross in BOTH directions - the Spark row contract feeds
    // computeAmounts('spark'), which subtracts the fee to get recipientSats
    // for sends and receives alike. Breez reports the net amount and the fee
    // separately, so the gross is reconstructed here; a net-only amount
    // would have the fee deducted twice downstream.
    amount: net + fee,
    timestamp: Number(payment.timestamp) || null,
    description,
    status: payment.status || BREEZ_PAYMENT_STATUS.COMPLETED,
    fee,
    sparkTransfer: payment.method === 'spark',
    rawType: RAW_TYPE_BY_METHOD[payment.method] || (isSend ? 'SEND' : 'RECEIVE'),
    paymentHash: paymentHashOf(payment),
    preimage: preimageOf(payment),
    bolt11,
    onchainTxId: (d?.type === 'deposit' || d?.type === 'withdraw') ? d.txId : null,
  };
}

/**
 * Map a Breez on-chain SendOnchainFeeQuote onto BuhoGO's withdrawal
 * fee-tier shape: per speed `userFeeSat` is the service fee and
 * `l1BroadcastFeeSat` the network fee.
 */
export function mapWithdrawFeeQuoteToTiers(feeQuote) {
  const tier = (speedQuote, timeEstimate) => {
    const serviceFee = Number(speedQuote?.userFeeSat || 0);
    const networkFee = Number(speedQuote?.l1BroadcastFeeSat || 0);
    return {
      serviceFee,
      networkFee,
      totalFee: serviceFee + networkFee,
      feeQuoteId: feeQuote.id,
      timeEstimate,
    };
  };
  return {
    slow: tier(feeQuote.speedSlow, '~1 hour'),
    medium: tier(feeQuote.speedMedium, '~30 min'),
    fast: tier(feeQuote.speedFast, 'Next block'),
    expiresAt: Number(feeQuote.expiresAt || 0),
  };
}

/**
 * Route choice for a bolt11 send: take the embedded Spark rail when it is
 * available and either explicitly preferred or at least as cheap.
 * @returns {{useSpark: boolean, routeFee: number}}
 */
export function pickBolt11Route({ sparkTransferFeeSats, lightningFeeSats, preferSpark = false }) {
  const sparkFee = sparkTransferFeeSats != null ? Number(sparkTransferFeeSats) : null;
  const lnFee = Number(lightningFeeSats ?? 0);
  const useSpark = sparkFee != null && (preferSpark || sparkFee <= lnFee);
  return { useSpark, routeFee: useSpark ? sparkFee : lnFee };
}

/**
 * Triage a claimDeposit error message.
 * @returns {'processing'|'too_small'|'confirmations'|'fee_changed'|null}
 *   'processing' — the claim is already running or already done; callers
 *   must treat it as success and record the txid as claimed.
 */
export function claimErrorKind(message) {
  const msg = String(message || '').toLowerCase();
  if (
    msg.includes('claim already in progress') ||
    msg.includes('already claimed') ||
    msg.includes('transfer_locked') ||
    (msg.includes('leaf') && msg.includes('locked'))
  ) {
    return 'processing';
  }
  if (msg.includes('dust') || msg.includes('not enough to cover')) {
    return 'too_small';
  }
  if (msg.includes('confirm')) {
    return 'confirmations';
  }
  if (msg.includes('fee')) {
    return 'fee_changed';
  }
  return null;
}

/**
 * Deposit classification from a mature claim quote — same thresholds and
 * categories as the direct engine's classifier.
 */
export function classifyFromMatureQuote({ depositAmountSats, quote, thresholds }) {
  const amount = Number(depositAmountSats || 0);
  const feeSats = Number(quote?.feeSats) > 0
    ? Number(quote.feeSats)
    : Math.max(0, amount - Number(quote?.creditAmountSats || 0));
  const feeRatio = amount > 0 ? feeSats / amount : 1;

  // 'too_small' is decided by the caller's MIN_DEPOSIT_SATS floor before a
  // quote is ever fetched; a quoted fee at or above the amount classifies as
  // needs_approval (ratio > cap), matching the direct engine's categories -
  // the approval sheet is where the user learns the fee eats the deposit.
  const withinAbsoluteCap = feeSats <= thresholds.MAX_FEE_SATS;
  const withinRelativeCap = feeRatio <= thresholds.MAX_FEE_RATIO;
  return {
    category: withinAbsoluteCap && withinRelativeCap ? 'eligible' : 'needs_approval',
    feeSats,
    feeRatio,
  };
}

/**
 * Withdrawal status from a Breez Payment. Breez has three payment statuses;
 * 'broadcasting' is synthesized from pending + a known txid, and broadcast
 * with txid is terminal-for-UX (same rule as the direct engine).
 */
export function withdrawalStatusFromPayment(payment, requestId) {
  if (!payment) {
    return {
      id: requestId,
      status: 'pending',
      rawStatus: null,
      txId: null,
      isComplete: false,
      isFailed: false,
    };
  }

  const withdrawArm = detailsArm(payment, 'withdraw');
  const txId = withdrawArm?.txId || null;
  const status = payment.status === BREEZ_PAYMENT_STATUS.COMPLETED
    ? 'completed'
    : payment.status === BREEZ_PAYMENT_STATUS.FAILED
      ? 'failed'
      : txId ? 'broadcasting' : 'pending';

  return {
    id: payment.id,
    status,
    rawStatus: payment.status || null,
    txId,
    isComplete: status === 'completed' || (status === 'broadcasting' && !!txId),
    isFailed: status === 'failed',
  };
}
