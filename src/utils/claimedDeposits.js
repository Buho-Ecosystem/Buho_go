/**
 * Persistent registry of L1 deposit outputs this device has already claimed.
 *
 * Exists to make the double-claim impossible by construction: an instantly
 * claimed (0-conf) deposit still shows up in the SDK's pending list until
 * its confirmations catch up, so without a durable marker the 3-conf
 * handler would submit the same UTXO a second time. The in-flight guard
 * (`isDepositClaimInFlight`) only covers a single session and a single
 * moment; this registry covers restarts and the whole confirmation window.
 *
 * Entries are outpoints (`txid:vout`): one transaction can carry several
 * deposits — to one wallet or to both halves of the Spark pair — and each
 * is claimed on its own. Entries written before that change are bare txids;
 * they are still honoured and cover every output of their transaction,
 * which errs on the side of never double-claiming.
 *
 * Storage is injected so the logic is unit-testable in plain Node. The
 * registry never throws: a broken or full storage degrades to in-memory
 * tracking for the session, which still prevents the double claim while
 * the app stays open.
 */

export const CLAIMED_DEPOSITS_STORAGE_KEY = 'buhoGO_claimed_deposit_txids_v1';

const DEFAULT_MAX_ENTRIES = 200;

/**
 * @param {object} [opts]
 * @param {{getItem(k:string):string|null, setItem(k:string,v:string):void}} [opts.storage]
 *        Web-Storage-shaped backend. Omit for a pure in-memory registry.
 * @param {string} [opts.key]
 * @param {number} [opts.maxEntries]  FIFO cap; oldest txids fall off first.
 *        Far above any realistic number of deposits still inside their
 *        confirmation window, so eviction can never resurrect a live claim.
 * @returns {{ has(txId:string, vout?:number):boolean, add(txId:string, vout?:number):void, size():number }}
 */
export function createClaimedDepositRegistry({
  storage = null,
  key = CLAIMED_DEPOSITS_STORAGE_KEY,
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  let order = [];
  const seen = new Set();

  // Hydrate once; corrupt or unreadable state starts empty rather than
  // blocking claims forever.
  if (storage) {
    try {
      const raw = storage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        for (const txId of parsed) {
          if (typeof txId === 'string' && txId && !seen.has(txId)) {
            seen.add(txId);
            order.push(txId);
          }
        }
      }
    } catch {
      /* start empty */
    }
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(order));
    } catch {
      /* in-memory tracking still protects this session */
    }
  }

  const outpoint = (txId, vout) => `${txId}:${Number(vout) || 0}`;

  return {
    has(txId, vout = 0) {
      if (typeof txId !== 'string' || txId === '') return false;
      return seen.has(outpoint(txId, vout)) || seen.has(txId);
    },

    add(txId, vout = 0) {
      if (typeof txId !== 'string' || txId === '') return;
      const key = outpoint(txId, vout);
      if (seen.has(key)) return;
      seen.add(key);
      order.push(key);
      while (order.length > maxEntries) {
        const evicted = order.shift();
        seen.delete(evicted);
      }
      persist();
    },

    size() {
      return order.length;
    },
  };
}
