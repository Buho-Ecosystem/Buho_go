import { boot } from 'quasar/wrappers';
import { useWalletStore } from 'stores/wallet';
import { useKioskMerchantStore } from 'stores/kioskMerchant';
import { useTransactionMetadataStore } from 'stores/transactionMetadata';
import { useKioskPayments } from '../composables/useKioskPayments.js';

/** Transaction annotations are best effort; the durable itemized register is authoritative. */
export async function annotateKioskReceipt(metadata, order, attempt, lookupResult) {
  const txId = lookupResult?.transactionId || lookupResult?.id;
  // A request hash is not necessarily the history ID. Never guess by amount or time.
  if (!txId || !attempt?.walletId) return;
  await metadata.setSourceForTransaction(txId, attempt.walletId, 'kiosk');
  if (order.label) await metadata.setLabelForTransaction(txId, attempt.walletId, order.label);
  await metadata.setSaleBreakdownForTransaction(txId, attempt.walletId, {
    baseSats: order.baseSats, tipSats: order.tipSats + order.roundUpSats,
    tipPercent: order.tipPercent || null, roundUp: order.roundUpSats > 0,
    discountSats: 0, itemCount: order.items.reduce((sum, item) => sum + item.qty, 0), totalSats: order.totalSats,
  });
}

export default boot(() => {
  const metadata = useTransactionMetadataStore();
  const runtime = useKioskPayments({ merchant: useKioskMerchantStore(), walletStore: useWalletStore() });
  const unsubscribe = runtime.subscribePaid((order, attempt, lookupResult) => annotateKioskReceipt(metadata, order, attempt, lookupResult));
  if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe(); runtime.dispose(); });
});
