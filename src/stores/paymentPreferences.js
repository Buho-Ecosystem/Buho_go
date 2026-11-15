import { defineStore } from 'pinia'

/**
 * The wallet contact payments start with. This device preference is separate
 * from the wallet shown on Home and from any explicit choice for one payment.
 *
 * Keep an unavailable/deleted id until the person replaces it or chooses
 * Automatic: forgetting it here could silently choose another paying wallet.
 * No wallet balances, credentials or payment destinations are persisted.
 */
export const PAYMENT_PREFERENCES_KEY = 'buhoGO_payment_preferences'

function validWalletId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
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

    /** An optional prompt must stay out of the way even if storage is full. */
    dismissPrompt() {
      this.initialize()
      this.promptDismissed = true
      return persist(snapshot(this.preferredWalletId, true))
    },
  },
})
