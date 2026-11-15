/**
 * Pay a Bitrefill invoice from one of the user's wallets, and say honestly
 * what became of it.
 *
 * The same wallet branching as the wallet store's internal transfer: connect
 * the chosen wallet on demand, NWC through the proof-checked payWithNwc, every
 * other backend through payInvoice. The payment is then named "Bitrefill" in
 * History, with the order's reference as its note.
 *
 * Paid means settled. A wallet call that returns is not a payment yet: a
 * wallet can answer while the payment is still on its way, or answer that it
 * failed, without throwing. And a wallet call that throws is not always a
 * payment that did not happen. So every result is read (`outcomeOfResult`),
 * and every error is sorted into "certainly not paid" (`isDefiniteRefusal`)
 * or "unknown", which the paying wallet is then asked about
 * (`probeBitrefillPayment`).
 *
 * The caller owns the never-pay-twice ledger (storage.js): it records the
 * attempt before calling this and the outcome after.
 */

import { payWithNwc, provesPayment } from '../nwcPayment.js'
import { NWC_ERROR } from '../../utils/nwcErrors.js'
import { internalTransferTransactionId } from '../../utils/internalTransferDetails.js'
import { useTransactionMetadataStore } from '../../stores/transactionMetadata.js'

export const BITREFILL_TX_LABEL = 'Bitrefill'
export const BITREFILL_PRICE_EXPIRED = 'BITREFILL_PRICE_EXPIRED'
export const BITREFILL_PAYMENT_FAILED = 'BITREFILL_PAYMENT_FAILED'

/**
 * A price this close to its end is not paid any more: connecting a wallet,
 * a wallet app's approval and the route itself all take time, and a payment
 * that arrives after the price ended is refused by the shop.
 */
export const EXPIRY_MARGIN_SECONDS = 15

export const PAY_OUTCOME = Object.freeze({
  /** Settled. */
  PAID: 'paid',
  /** Handed over and still on its way. */
  PENDING: 'pending',
  /** Known not to have been paid. */
  FAILED: 'failed',
  /** Cannot be told. */
  UNKNOWN: 'unknown',
})

/** HTTP answers that refuse a request outright. */
const REFUSAL_STATUSES = Object.freeze([400, 401, 402, 403, 404, 422])

/** Seconds a price can still be paid, the safety margin already taken off. */
export function secondsToPay(expiresAt, nowMs = Date.now()) {
  if (!expiresAt) return Infinity
  return Math.max(0, expiresAt - EXPIRY_MARGIN_SECONDS - Math.floor(nowMs / 1000))
}

/** An error raised before the invoice reached a wallet: nothing was paid. */
function beforeSend(error, code) {
  if (code) error.code = code
  error.beforeSend = true
  return error
}

/**
 * What a wallet's answer says. NWC answers only on proof (payWithNwc), so
 * its answer is a payment. Every other backend reports a status; without
 * one, only a preimage counts as paid.
 */
export function outcomeOfResult(walletType, result) {
  if (walletType === 'nwc') return PAY_OUTCOME.PAID
  const status = String(result?.status || '').toLowerCase()
  if (status === 'failed') return PAY_OUTCOME.FAILED
  if (status === 'completed' || status === 'complete' || status === 'success' || status === 'settled') return PAY_OUTCOME.PAID
  if (status === 'pending') return PAY_OUTCOME.PENDING
  return result?.preimage ? PAY_OUTCOME.PAID : PAY_OUTCOME.PENDING
}

/**
 * True when an error settles the payment as not made, so the invoice may be
 * paid again: it never reached a wallet, the wallet reported it failed, an
 * NWC wallet refused (payWithNwc turns every unknown outcome into
 * UNCONFIRMED after asking the wallet itself), a fee above the shown limit
 * (refused before any money moves), or a server that answered the request
 * with a plain refusal. Everything else is unknown.
 */
export function isDefiniteRefusal(error, walletType) {
  if (!error) return false
  if (error.beforeSend || error.code === BITREFILL_PAYMENT_FAILED) return true
  if (walletType === 'nwc') return error.code !== NWC_ERROR.UNCONFIRMED
  if (error.code === 'LIGHTNING_FEE_ABOVE_LIMIT') return true
  // A server that answered with a plain refusal did not take the request on.
  // A timeout (408) or a server fault says nothing about the payment.
  return walletType === 'lnbits' && REFUSAL_STATUSES.includes(Number(error.status))
}

/**
 * @param {object} walletStore
 * @param {string} walletId
 * @param {string} invoice BOLT11
 * @param {object} [options]
 * @param {number} [options.amountSats]
 * @param {number|null} [options.expiresAt] unix seconds the price ends
 * @param {number|null} [options.maxFeeSats] the fee the sheet showed (Spark)
 * @param {string} [options.note] the order's reference, kept on the payment
 * @returns {Promise<{ outcome: 'paid'|'pending', result: object }>}
 * @throws an Error the caller sorts with `isDefiniteRefusal`
 */
export async function payBitrefillInvoice(walletStore, walletId, invoice, { amountSats = 0, expiresAt = null, maxFeeSats = null, note = '' } = {}) {
  const wallet = walletStore.wallets.find((w) => w.id === walletId)
  if (!wallet) throw beforeSend(new Error('Wallet not found'))
  const type = wallet.type || 'nwc'

  let provider
  try {
    provider = await walletStore.ensureWalletConnectedForTransfer(walletId)
  } catch (error) {
    throw beforeSend(error)
  }
  // Connecting a wallet can outlast the price shown on the confirmation sheet.
  if (secondsToPay(expiresAt) <= 0) {
    throw beforeSend(new Error('The price ran out.'), BITREFILL_PRICE_EXPIRED)
  }

  let result
  if (type === 'nwc') {
    result = await payWithNwc(provider, invoice, walletStore.nwcPayOptions(walletId))
  } else if (type === 'spark') {
    // The same route the fee quote was made for, capped at the quote.
    result = await provider.payInvoice({ invoice, preferSpark: true, ...(typeof maxFeeSats === 'number' ? { maxFee: maxFeeSats } : {}) })
  } else {
    result = await provider.payInvoice({ invoice })
  }

  const outcome = outcomeOfResult(type, result)
  if (outcome === PAY_OUTCOME.FAILED) {
    throw Object.assign(new Error('Payment failed'), { code: BITREFILL_PAYMENT_FAILED })
  }

  // Naming the payment and refreshing the balance must never turn a paid
  // invoice into an error.
  try {
    const metadata = useTransactionMetadataStore()
    const txId = internalTransferTransactionId(type, result, invoice)
    if (txId) {
      await metadata.setLabelForTransaction(txId, walletId, BITREFILL_TX_LABEL)
      if (note) await metadata.setNoteForTransaction(txId, walletId, note)
    } else {
      await metadata.enqueuePendingContactLink({ label: BITREFILL_TX_LABEL, amountSats, walletId })
    }
  } catch (err) {
    console.warn('[bitrefill] could not label the payment:', err)
  }
  try { walletStore.refreshWalletData?.(walletId)?.catch?.(() => {}) } catch { /* the payment's outcome stands */ }

  return { outcome, result }
}

function outcomeOfRow(row) {
  if (!row) return PAY_OUTCOME.UNKNOWN
  const status = String(row.status || '').toLowerCase()
  if (status === 'completed') return PAY_OUTCOME.PAID
  if (status === 'failed') return PAY_OUTCOME.FAILED
  return PAY_OUTCOME.PENDING
}

/**
 * Ask the paying wallet what became of a payment, by the invoice's payment
 * hash. Never throws: a wallet that cannot be asked, or does not know the
 * payment, answers UNKNOWN, and an unknown payment stays blocked.
 *
 * @returns {Promise<'paid'|'pending'|'failed'|'unknown'>}
 */
export async function probeBitrefillPayment(walletStore, walletId, paymentHash) {
  const hash = String(paymentHash || '').toLowerCase()
  const wallet = walletStore.wallets.find((w) => w.id === walletId)
  if (!hash || !wallet) return PAY_OUTCOME.UNKNOWN
  const type = wallet.type || 'nwc'
  try {
    const provider = await walletStore.ensureWalletConnectedForTransfer(walletId)
    if (type === 'nwc') {
      const client = provider?.client
      if (typeof client?.lookupInvoice !== 'function') return PAY_OUTCOME.UNKNOWN
      const tx = await client.lookupInvoice({ payment_hash: hash })
      if (tx?.state === 'failed') return PAY_OUTCOME.FAILED
      if (tx?.state === 'settled' || Number(tx?.settled_at) > 0 || await provesPayment(tx?.preimage, hash)) return PAY_OUTCOME.PAID
      return tx ? PAY_OUTCOME.PENDING : PAY_OUTCOME.UNKNOWN
    }
    const sent = (row) => row?.type === 'send' && String(row.paymentHash || '').toLowerCase() === hash
    if (typeof provider.getPayment === 'function') {
      const row = await provider.getPayment(hash)
      return outcomeOfRow(sent(row) ? row : null)
    }
    const rows = await provider.getTransactions({ limit: 50 })
    return outcomeOfRow((rows || []).find(sent) || null)
  } catch {
    return PAY_OUTCOME.UNKNOWN
  }
}

/**
 * What became of a payment whose wallet call threw. In order:
 *
 *   - it never reached a wallet: not paid
 *   - the shop saw the money within its wait: paid, whatever the wallet said
 *   - the wallet refused it outright: not paid
 *   - NWC could not tell (it asked the wallet itself already): unknown
 *   - anything else: what the paying wallet's own records say
 *
 * Only FAILED frees the invoice for another attempt.
 *
 * @param {Error} error
 * @param {object} context
 * @param {object} context.walletStore
 * @param {string} context.walletId
 * @param {string} context.walletType
 * @param {string} context.paymentHash
 * @param {() => Promise<boolean>} context.shopSawPayment resolves true when
 *   the widget reported the invoice paid
 * @returns {Promise<'paid'|'pending'|'failed'|'unknown'>}
 */
export async function outcomeAfterError(error, { walletStore, walletId, walletType, paymentHash, shopSawPayment }) {
  if (error?.beforeSend) return PAY_OUTCOME.FAILED
  if (await shopSawPayment()) return PAY_OUTCOME.PAID
  if (isDefiniteRefusal(error, walletType)) return PAY_OUTCOME.FAILED
  if (walletType === 'nwc') return PAY_OUTCOME.UNKNOWN
  return probeBitrefillPayment(walletStore, walletId, paymentHash)
}
