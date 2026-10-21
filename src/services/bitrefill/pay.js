/**
 * Pay a Bitrefill invoice from one of the user's wallets.
 *
 * The same wallet branching as the wallet store's internal transfer: connect
 * the chosen wallet on demand, NWC through the proof-checked payWithNwc, every
 * other backend through payInvoice({ invoice }). The payment is then named
 * "Bitrefill" in History.
 *
 * The caller owns the never-pay-twice ledger (storage.js): it records the
 * attempt before calling this and the outcome after.
 */

import { payWithNwc } from '../nwcPayment.js'
import { internalTransferTransactionId } from '../../utils/internalTransferDetails.js'
import { useTransactionMetadataStore } from '../../stores/transactionMetadata.js'

export const BITREFILL_TX_LABEL = 'Bitrefill'

export async function payBitrefillInvoice(walletStore, walletId, invoice, { amountSats = 0 } = {}) {
  const wallet = walletStore.wallets.find((w) => w.id === walletId)
  if (!wallet) throw new Error('Wallet not found')
  const type = wallet.type || 'nwc'

  const provider = await walletStore.ensureWalletConnectedForTransfer(walletId)
  const result = type === 'nwc'
    ? await payWithNwc(provider, invoice, { limit: walletStore.nwcLimitFor(walletId) })
    : await provider.payInvoice({ invoice })

  // Naming the payment and refreshing the balance must never turn a paid
  // invoice into an error.
  try {
    const metadata = useTransactionMetadataStore()
    const txId = internalTransferTransactionId(type, result, invoice)
    if (txId) await metadata.setLabelForTransaction(txId, walletId, BITREFILL_TX_LABEL)
    else await metadata.enqueuePendingContactLink({ label: BITREFILL_TX_LABEL, amountSats, walletId })
  } catch (err) {
    console.warn('[bitrefill] could not label the payment:', err)
  }
  walletStore.refreshWalletData?.(walletId)?.catch?.(() => {})

  return result
}
