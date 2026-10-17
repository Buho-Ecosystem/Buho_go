import { computed, onScopeDispose, ref } from 'vue';

/** How many sales may wait at once: a counter, not a ledger. */
export const MAX_PARKED = 6;
const STORAGE_KEY = 'buhoGO_kiosk_parked_sales';
const WATCH_MS = 5000;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function readSaved(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((sale) => sale?.id && sale.invoiceData?.paymentHash && sale.invoiceData?.walletId) : [];
  } catch {
    return [];
  }
}

/**
 * Parked kiosk sales: a sale set aside with its invoice so the register can
 * take the next customer. Parking never stops a sale from being paid, so it
 * never stops it from being watched:
 *
 *  - Every parked sale keeps being checked (settled, never "has a preimage":
 *    `lookup` is the store's lookupInvoiceOnWallet). A paid one leaves the
 *    list and `onPaid` records it, wherever the register is.
 *  - Past its expiry a sale is checked once more (paid just before expiry
 *    still counts), then shown as expired until removed.
 *  - Saved on the device, so a restart keeps every parked sale and its
 *    watch. The invoice text is public data; nothing secret is stored.
 *
 * @param {object} options
 * @param {(walletId: string, paymentHash: string) => Promise<{ paid: boolean }>} options.lookup
 * @param {(sale: object) => void} options.onPaid
 * @param {Storage} [options.storage] localStorage by default
 */
export function useKioskParkedSales({ lookup, onPaid, storage = globalThis.localStorage, watchMs = WATCH_MS }) {
  const sales = ref(readSaved(storage));
  const tick = ref(nowSeconds());
  let timer = null;
  let checking = false;

  function save() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(sales.value)); } catch { /* kept in memory */ }
  }

  const expired = (sale) => {
    const at = Number(sale.invoiceData?.expiresAt);
    return at > 0 && at <= tick.value;
  };

  /** What the list shows: newest first, each with its state. */
  const list = computed(() => [...sales.value]
    .sort((a, b) => b.parkedAt - a.parkedAt)
    .map((sale) => ({ ...sale, status: sale.finalChecked && expired(sale) ? 'expired' : 'waiting' })));
  const count = computed(() => sales.value.length);
  const full = computed(() => sales.value.length >= MAX_PARKED);

  /** Set a sale aside. False when the list is full: nothing is dropped to make room. */
  function park(sale) {
    if (full.value || !sale?.invoiceData?.paymentHash) return false;
    sales.value = [...sales.value, { ...sale, id: sale.id || `${sale.invoiceData.paymentHash.slice(0, 16)}-${Date.now()}`, parkedAt: Date.now(), finalChecked: false }];
    save();
    schedule(true);
    return true;
  }

  /** Take a sale back out (to resume it). */
  function take(id) {
    const sale = sales.value.find((s) => s.id === id);
    if (!sale) return null;
    sales.value = sales.value.filter((s) => s.id !== id);
    save();
    return sale;
  }

  const remove = (id) => { take(id); };

  async function checkAll() {
    if (checking) return;
    checking = true;
    tick.value = nowSeconds();
    try {
      for (const sale of [...sales.value]) {
        if (!sales.value.some((s) => s.id === sale.id)) continue;
        if (sale.finalChecked && expired(sale)) continue;
        const wasExpired = expired(sale);
        let result;
        try {
          result = await lookup(sale.invoiceData.walletId, sale.invoiceData.paymentHash);
        } catch {
          continue; // The wallet did not answer: the next round asks again.
        }
        if (result?.paid) {
          if (!take(sale.id)) continue;
          try {
            onPaid({ ...sale, paidAmount: result.amount });
          } catch (error) {
            console.error('[kiosk] recording a paid parked sale:', error);
          }
          continue;
        }
        if (wasExpired) {
          sales.value = sales.value.map((s) => (s.id === sale.id ? { ...s, finalChecked: true } : s));
          save();
        }
      }
    } finally {
      checking = false;
      tick.value = nowSeconds();
    }
  }

  function schedule(now = false) {
    clearTimeout(timer);
    timer = null;
    if (!sales.value.some((sale) => !(sale.finalChecked && expired(sale)))) return;
    timer = setTimeout(async () => {
      await checkAll();
      schedule();
    }, now ? 0 : watchMs);
  }

  const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') schedule(true); };
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);
  schedule(true);
  onScopeDispose(() => {
    clearTimeout(timer);
    globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
  });

  return { list, count, full, park, take, remove, checkNow: () => schedule(true) };
}
