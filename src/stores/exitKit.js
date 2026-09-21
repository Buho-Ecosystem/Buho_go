/**
 * Per-wallet emergency exit kit metadata: when it was last refreshed and
 * checked, what an exit would recover today, where copies live, and
 * whether refreshing has been failing. Small, synchronous, persisted after
 * every change. The kit itself lives in IndexedDB (see utils/kitStorage).
 */

import { defineStore } from 'pinia';

export const EXIT_KIT_STORAGE_KEY = 'buhoGO_exit_kit_v1';

function storage() {
  const candidate = globalThis.localStorage;
  return candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function' ? candidate : null;
}

function load() {
  try {
    const raw = storage()?.getItem(EXIT_KIT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.kits === 'object' && parsed.kits ? parsed.kits : {};
  } catch {
    return {};
  }
}

export const useExitKitStore = defineStore('exitKit', {
  state: () => ({ kits: load(), refreshing: {} }),

  getters: {
    kitFor: (state) => (walletId) => state.kits[walletId] || null,
    isRefreshing: (state) => (walletId) => !!state.refreshing[walletId],
  },

  actions: {
    upsert(walletId, patch) {
      const previous = this.kits[walletId] || { walletId };
      this.kits[walletId] = { ...previous, ...patch, walletId, updatedAt: Date.now() };
      this._persist();
      return this.kits[walletId];
    },

    markFailed(walletId, message) {
      const previous = this.kits[walletId] || { walletId };
      this.upsert(walletId, { failedSince: previous.failedSince || Date.now(), lastError: String(message || 'refresh failed').slice(0, 300) });
    },

    setRefreshing(walletId, value) {
      if (value) this.refreshing[walletId] = true;
      else delete this.refreshing[walletId];
    },

    remove(walletId) {
      delete this.kits[walletId];
      this._persist();
    },

    _persist() {
      try {
        storage()?.setItem(EXIT_KIT_STORAGE_KEY, JSON.stringify({ v: 1, kits: this.kits }));
      } catch (e) {
        console.warn('exit kit metadata not persisted:', e?.message || e);
      }
    },
  },
});
