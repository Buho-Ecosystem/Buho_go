import { defineStore } from 'pinia'

/**
 * Bitcoin deposit preferences.
 *
 * Per Spark docs static deposits do NOT auto-claim while the wallet is
 * offline — claims must be initiated client-side. We default to
 * auto-claiming as long as the network fee stays "reasonable" (defined
 * by the thresholds below). Above the threshold the user is asked
 * before adding the deposit; below the dust floor we offer to send it
 * back instead of attempting a claim that would be eaten by fees.
 *
 * Thresholds live here rather than scattered through call sites so that
 * one source of truth governs both the classifier (provider) and any
 * future power-user UI we expose.
 */

const STORAGE_KEY = 'buhoGO_bitcoin_preferences'

/**
 * Auto-claim is allowed when BOTH:
 *   - the absolute fee is at or below MAX_FEE_SATS
 *   - the fee is at or below MAX_FEE_RATIO of the deposit amount
 *
 * The absolute cap protects users during fee spikes; the ratio guard
 * protects small deposits from being chewed up by an otherwise
 * "reasonable" flat fee.
 *
 * Deposits below MIN_DEPOSIT_SATS skip auto-claim and surface as
 * "too small" so the user can choose claim-anyway vs send-back.
 */
export const AUTO_CLAIM_THRESHOLDS = Object.freeze({
  MAX_FEE_SATS: 3000,
  MAX_FEE_RATIO: 0.05,
  MIN_DEPOSIT_SATS: 1000
})

/**
 * Cached classification quotes go stale because the SSP's claim fee
 * tracks live network conditions. After this many milliseconds we
 * re-fetch the quote before submitting the claim — typical case is a
 * `needs_approval` toast that the user took a while to act on. 30s is
 * snappy enough that auto-claim doesn't pay it on every sweep, and
 * tight enough that fee drift between approval and claim is small.
 */
export const CLASSIFICATION_FRESHNESS_MS = 30 * 1000

/**
 * Cadence for polling the deposit address for new and confirming UTXOs.
 *
 * 60s strikes a balance between snappy detection (a deposit confirms,
 * the user sees the toast within a minute) and politeness toward the
 * mempool source. Each poll is two HTTP requests (UTXOs + tip height),
 * so 60s ≈ 120 req/hour per active Spark wallet.
 *
 * Tune here, not at the call site, so a future Settings power-user
 * panel can expose it without touching component code.
 */
export const BITCOIN_DEPOSIT_POLL_MS = 60 * 1000

function loadPersisted() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useBitcoinPreferencesStore = defineStore('bitcoinPreferences', {
  state: () => {
    const persisted = loadPersisted()
    return {
      // When true, auto-claim eligible deposits as soon as they reach
      // the SDK-required confirmation count. Surfaced in Settings as
      // "Auto-add Bitcoin deposits".
      autoAddIncomingBitcoin: persisted?.autoAddIncomingBitcoin ?? true
    }
  },

  actions: {
    setAutoAddIncomingBitcoin(value) {
      this.autoAddIncomingBitcoin = !!value
      this._persist()
    },

    _persist() {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            autoAddIncomingBitcoin: this.autoAddIncomingBitcoin
          })
        )
      } catch (error) {
        console.warn('Could not persist bitcoinPreferences:', error.message)
      }
    }
  }
})
