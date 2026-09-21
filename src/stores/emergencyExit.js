/**
 * Emergency exits in progress, one per wallet, persisted after every change
 * in the ledger idiom (see nadanadaOrders): the record is what keeps a
 * days-long exit recoverable across restarts. Transitions are pure
 * (utils/exitLedger); the driver (services/emergencyExit) applies them.
 */

import { defineStore } from 'pinia';
import { isActive, needsAttention, acknowledge } from '../utils/exitLedger.js';

export const EMERGENCY_EXIT_STORAGE_KEY = 'buhoGO_emergency_exit_v1';

function storage() {
  const candidate = globalThis.localStorage;
  return candidate && typeof candidate.getItem === 'function' ? candidate : null;
}

function load() {
  try {
    const parsed = JSON.parse(storage()?.getItem(EMERGENCY_EXIT_STORAGE_KEY) || 'null');
    return parsed && parsed.exits && typeof parsed.exits === 'object' ? parsed.exits : {};
  } catch {
    return {};
  }
}

export const useEmergencyExitStore = defineStore('emergencyExit', {
  state: () => ({ exits: load() }),

  getters: {
    exitFor: (state) => (walletId) => state.exits[walletId] || null,
    activeExits: (state) => Object.values(state.exits).filter(isActive),
    hasActiveExit: (state) => Object.values(state.exits).some(isActive),
    /** Active, or finished and not yet acknowledged: what the home chip points at. */
    attentionExits: (state) => Object.values(state.exits).filter(needsAttention),
  },

  actions: {
    set(exit) {
      this.exits[exit.walletId] = exit;
      this._persist();
      return exit;
    },
    remove(walletId) {
      delete this.exits[walletId];
      this._persist();
    },
    clear() {
      this.exits = {};
      this._persist();
    },
    /** The receipt was seen; the record stays as history until the next exit replaces it. */
    acknowledge(walletId) {
      const exit = this.exits[walletId];
      if (exit) this.set(acknowledge(exit));
    },
    _persist() {
      try {
        storage()?.setItem(EMERGENCY_EXIT_STORAGE_KEY, JSON.stringify({ v: 1, exits: this.exits }));
      } catch (e) {
        console.warn('emergency exit ledger not persisted:', e?.message || e);
      }
    },
  },
});
