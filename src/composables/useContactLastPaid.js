/**
 * "Last paid" and Quick pay, dated from the payments History last showed.
 *
 * A payment to a saved contact reports itself when it goes out
 * (addressBook.recordPayment). This catches the rest: a send that was still
 * on its way when it was made and is listed as paid now, a payment made
 * from another app on the same wallet, and every contact paid before this
 * date was kept at all. It reads each wallet's saved list only, so it is
 * instant and makes no request.
 *
 * Runs once the wallets are known (so Quick pay, Send's recent contacts and
 * the launcher shortcut follow real payments from the first screen), and
 * again whenever the address book opens. Not on a kiosk: contacts are no
 * part of taking payments.
 */

import { watch } from 'vue'
import { useAddressBookStore } from '../stores/addressBook'
import { useWalletStore } from '../stores/wallet'
import { useTransactionMetadataStore } from '../stores/transactionMetadata'
import { lastPaidTimes } from '../services/recipientPayments.js'

/** Best effort: the dates simply wait for the next run. */
export async function refreshContactLastPaid() {
  try {
    const walletStore = useWalletStore()
    if (walletStore.kioskEnabled === true || !walletStore.wallets.length) return
    const book = useAddressBookStore()
    const metadata = useTransactionMetadataStore()
    await Promise.all([book.initialize(), metadata.initialize()])
    if (book.isRecovering) return
    const paidAt = lastPaidTimes({
      wallets: walletStore.wallets,
      contacts: book.entries,
      metadataFor: (txId, walletId) => metadata.getMetadataForTransaction(txId, walletId),
    })
    if (paidAt.size) await book.recordPayments(paidAt)
  } catch (error) {
    console.warn('[contacts] could not date the last payments:', error?.message || error)
  }
}

/** App-level: date them once, as soon as the saved wallets are loaded. */
export function useContactLastPaid() {
  const walletStore = useWalletStore()
  const stop = watch(
    () => walletStore.savedStateLoaded === true && walletStore.wallets.length > 0,
    (ready) => {
      if (!ready) return
      stop()
      refreshContactLastPaid()
    },
  )
  if (walletStore.savedStateLoaded === true && walletStore.wallets.length > 0) {
    stop()
    refreshContactLastPaid()
  }
}
