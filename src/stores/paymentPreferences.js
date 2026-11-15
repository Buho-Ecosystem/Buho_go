import { defineStore } from 'pinia'

/**
 * The wallet contact payments start with. This device preference is separate
 * from the wallet shown on Home and from any explicit choice for one payment.
 *
 * A wallet that left this phone cannot stay the default: the preference goes
 * back to Automatic and the offer may be made once more (`forgetMissing`).
 * No wallet balances, credentials or payment destinations are persisted.
 */
export const PAYMENT_PREFERENCES_KEY = 'buhoGO_payment_preferences'

function validWalletId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

/**
 * The ids of the wallets on this phone, once that is known for sure: null
 * while saved wallets are unread or could not be read, so an unreadable
 * store is never mistaken for "the wallet was removed".
 */
export function settledWalletIds(walletStore) {
  if (!walletStore?.hydrated || walletStore.savedStateLoaded === false) return null
  return (walletStore.wallets || []).map(wallet => wallet.id)
}

function snapshot(preferredWalletId, promptDismissed) {
  return { version: 1, preferredWalletId, promptDismissed }
}

function persist(value) {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(PAYMENT_PREFERENCES_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const usePaymentPreferencesStore = defineStore('paymentPreferences', {
  state: () => ({
    preferredWalletId: null,
    promptDismissed: false,
    initialized: false,
  }),

  getters: {
    shouldPrompt: state => state.initialized && !state.preferredWalletId && !state.promptDismissed,
  },

  actions: {
    /** Synchronous and idempotent, so a payment never waits for this preference. */
    initialize() {
      if (this.initialized) return
      try {
        const saved = JSON.parse(localStorage.getItem(PAYMENT_PREFERENCES_KEY) || 'null')
        if (saved && saved.version === 1
          && (saved.preferredWalletId === null || validWalletId(saved.preferredWalletId))) {
          this.preferredWalletId = saved.preferredWalletId
          this.promptDismissed = saved.promptDismissed === true
        }
      } catch {
        // An unreadable preference cannot prevent payments or opening Settings.
      }
      this.initialized = true
    },

    /**
     * Save an explicit preference, or null for Automatic. A failed write keeps
     * the previous answer, so the UI never claims a setting was saved when it
     * will be lost on restart. Returns a result for inline feedback.
     */
    setPreferred(walletId) {
      this.initialize()
      if (walletId !== null && !validWalletId(walletId)) return false
      if (!persist(snapshot(walletId, true))) return false
      this.preferredWalletId = walletId
      this.promptDismissed = true
      return true
    },

    /**
     * The default wallet was removed from this phone or disconnected: back to
     * Automatic, and the offer may be made again. A failed write is repeated
     * at the next start, when the id is still not among the wallets.
     * @param {string[]|null} walletIds `settledWalletIds`; null changes nothing.
     * @returns {boolean} true when a preference was cleared
     */
    forgetMissing(walletIds) {
      this.initialize()
      if (!Array.isArray(walletIds) || !this.preferredWalletId || walletIds.includes(this.preferredWalletId)) return false
      this.preferredWalletId = null
      this.promptDismissed = false
      persist(snapshot(null, false))
      return true
    },

    /** An optional prompt must stay out of the way even if storage is full. */
    dismissPrompt() {
      this.initialize()
      this.promptDismissed = true
      return persist(snapshot(this.preferredWalletId, true))
    },
  },
})
