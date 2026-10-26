/**
 * unseenReceipts store: what each wallet received since the user last
 * looked at it, so the Switch Wallet sheet and Manage Wallets can say so
 * until they do. IncomingPaymentHost feeds it from every receipt the
 * wallet store reports and clears a wallet when it becomes active or one
 * of its payments is opened. The rules and the saved shape are in
 * utils/unseenReceipts.js.
 */

import { defineStore } from 'pinia';
import {
  addUnseenReceipt,
  clearUnseenReceipts,
  pruneUnseenReceipts,
  readUnseenReceipts,
  writeUnseenReceipts,
} from '../utils/unseenReceipts.js';

export const useUnseenReceiptsStore = defineStore('unseenReceipts', {
  state: () => ({
    /** walletId -> { sats, count, since } */
    entries: readUnseenReceipts(),
  }),

  getters: {
    /** This wallet's unseen receipts, or null when the user has looked at it. */
    forWallet: (state) => (walletId) => state.entries[walletId] || null,
  },

  actions: {
    /** A receipt the user has not looked at (utils/unseenReceipts.js isUnseenReceipt). */
    add(receipt, now = Date.now()) {
      this.commit(addUnseenReceipt(this.entries, receipt, now));
    },

    /** The user looked at this wallet: its receipts are no longer news. */
    markSeen(walletId) {
      this.commit(clearUnseenReceipts(this.entries, walletId));
    },

    /** Forget stale entries and wallets that left this phone. */
    prune(walletIds, now = Date.now()) {
      this.commit(pruneUnseenReceipts(this.entries, { now, walletIds }));
    },

    commit(next) {
      if (next === this.entries) return;
      this.entries = next;
      writeUnseenReceipts(next);
    },
  },
});
