/**
 * payingWallets - "which of my wallets can pay this, and which one should?"
 *
 * The answer behind the "Pay with" field of the confirm sheet. One pure
 * function turns the wallet store's raw facts (wallets, balances, connection
 * states) plus the payment in front of the user (rail + amount) into an
 * ordered list the UI renders as is, so the sheet, the commit gate and the
 * tests all read the same verdict.
 *
 * A wallet is unusable for exactly one of two stable reasons:
 *   - 'unsupported-destination'  the rail is closed to this wallet type
 *                                (walletCapabilities.canWalletPay: Arkade has
 *                                no Lightning, only Spark pays Spark addresses)
 *   - 'insufficient-balance'     the known balance is below amount + fee
 *                                reserve. Skipped while the amount is unknown
 *                                (an amountless invoice before the user types
 *                                one) and while the balance itself is unknown.
 *
 * Pure and synchronous - no store, Vue or i18n imports (callers pass `t`) -
 * so it runs under plain Node like walletCapabilities.
 */

import { canWalletPay, destinationKind, walletSwitchHint } from './walletCapabilities.js'

/** Stable reason codes. UI copy is derived from these, never the other way. */
export const PAYING_REASON = Object.freeze({
  UNSUPPORTED_DESTINATION: 'unsupported-destination',
  INSUFFICIENT_BALANCE: 'insufficient-balance',
})

/**
 * Fee reserve for surfaces that must not offer a wallet which "has exactly
 * enough": 1 % of the amount, never less than 10 sats. One definition, shared
 * with the username marketplace sheet (Nip05MarketplaceSheet).
 */
export const FEE_RESERVE_RATIO = 0.01
export const FEE_RESERVE_MIN_SATS = 10

/**
 * The conservative fee reserve for an amount (see FEE_RESERVE_RATIO).
 * @param {number} amountSats
 * @returns {number} sats to keep back; 0 when there is no amount yet
 */
export function feeReserveSats(amountSats) {
  const amount = Number(amountSats)
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return Math.max(FEE_RESERVE_MIN_SATS, Math.ceil(amount * FEE_RESERVE_RATIO))
}

/**
 * The fee reserve for the send pipeline: only what is KNOWN to be charged.
 *
 * Spark and Arkade addresses are zero-fee rails, so nothing is held back.
 * Everything else holds back the provider's own fee estimate when there is
 * one. The percentage reserve above is deliberately not used here: it would
 * refuse payments the provider accepts today (a wallet sending almost its
 * whole balance), and the sheet's commit gate reads this same verdict.
 * @param {string} destinationType payment type or address-book addressType
 * @param {number|null} [knownFeeSats] provider estimate, when there is one
 * @returns {number}
 */
export function knownFeeReserveSats(destinationType, knownFeeSats = null) {
  const kind = destinationKind(destinationType)
  if (kind === 'spark' || kind === 'arkade') return 0
  const fee = Number(knownFeeSats)
  return Number.isFinite(fee) && fee > 0 ? Math.ceil(fee) : 0
}

/** A balance is a finite, non-negative number of sats, or unknown (null). */
function normalizeBalance(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.max(0, Math.floor(raw))
}

/**
 * Rank the wallets for one payment.
 *
 * @param {object} input
 * @param {Array<{id: string, name?: string, type?: string}>} input.wallets
 *   the store's wallets, in their stored order
 * @param {string|null} [input.activeWalletId] listed first and flagged `isActive`
 * @param {Object<string, number>} [input.balances] sats by wallet id; a missing
 *   id means the balance is not known yet
 * @param {Object<string, {connected?: boolean, error?: string|null}>} [input.connectionStates]
 * @param {string} [input.destinationType] payment type or addressType; anything
 *   unrecognized is a Lightning destination (walletCapabilities)
 * @param {number} [input.amountSats] 0/unknown skips the balance check
 * @param {number} [input.feeReserve] sats kept back on top of the amount;
 *   defaults to the shared conservative reserve for this amount
 * @returns {Array<{id: string, name: string, type: string, balanceSats: number|null,
 *   isActive: boolean, usable: boolean, reason: string|null, connectionFailed: boolean}>}
 *   `connectionFailed`: the last connection attempt failed. The wallet stays
 *   usable (every send path reconnects on demand); the default pick only
 *   prefers one without that mark.
 *   active wallet first, then the original order
 */
export function listPayingWallets({
  wallets,
  activeWalletId = null,
  balances = {},
  connectionStates = {},
  destinationType = 'lightning',
  amountSats = 0,
  feeReserve,
} = {}) {
  const amount = Number.isFinite(Number(amountSats)) ? Math.max(0, Math.floor(Number(amountSats))) : 0
  // Only a real number overrides the default (Number.isFinite does not coerce
  // null / undefined / strings into 0).
  const reserve = Number.isFinite(feeReserve) && feeReserve >= 0
    ? Math.ceil(feeReserve)
    : feeReserveSats(amount)

  const entries = (Array.isArray(wallets) ? wallets : [])
    .filter((wallet) => wallet && wallet.id)
    .map((wallet) => {
      // Wallets saved before the `type` field existed were NWC (inferWalletType).
      const type = wallet.type || 'nwc'
      const balanceSats = normalizeBalance(balances?.[wallet.id])
      const state = connectionStates?.[wallet.id]

      let reason = null
      if (!canWalletPay(type, destinationType)) {
        reason = PAYING_REASON.UNSUPPORTED_DESTINATION
      } else if (amount > 0 && balanceSats !== null && balanceSats < amount + reserve) {
        reason = PAYING_REASON.INSUFFICIENT_BALANCE
      }

      return {
        id: wallet.id,
        name: wallet.name || '',
        type,
        balanceSats,
        isActive: wallet.id === activeWalletId,
        usable: reason === null,
        reason,
        connectionFailed: Boolean(state && !state.connected && state.error),
      }
    })

  // Stable partition: the active wallet leads, everything else keeps its order.
  return [...entries.filter((w) => w.isActive), ...entries.filter((w) => !w.isActive)]
}

/**
 * The wallet a payment starts with: the active wallet when it can pay, else
 * the first wallet that can, else the active one (so the sheet can still say
 * why nothing works). A wallet whose last connection failed is passed over
 * while another can pay, and taken when none can. Null for an empty list, or
 * when nothing is active and nothing is usable.
 * @param {ReturnType<typeof listPayingWallets>} list
 */
export function pickDefaultPayingWallet(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const active = list.find((wallet) => wallet.isActive) || null
  const healthy = (wallet) => wallet?.usable && !wallet.connectionFailed
  if (healthy(active)) return active
  return list.find(healthy) || (active?.usable ? active : null) || list.find((wallet) => wallet.usable) || active
}

/**
 * Short reason shown in the "Pay with" rows, in plain words: the payment
 * screen says "Bitcoin payment", never the rail, so neither does this.
 * @param {string|null} reason one of PAYING_REASON
 * @param {(key: string) => string} t vue-i18n translate
 * @returns {string} '' for a usable wallet
 */
export function payingWalletReasonText(reason, t) {
  switch (reason) {
    case PAYING_REASON.UNSUPPORTED_DESTINATION:
      return t("Can't pay this")
    case PAYING_REASON.INSUFFICIENT_BALANCE:
      return t('Not enough balance')
    default:
      return ''
  }
}

/**
 * The sentence for the sheet's warning banner (the existing walletHint slot)
 * when the selected wallet is blocked. A rail problem keeps the shared
 * switch-wallet words every other surface uses; another wallet is only
 * suggested when there is one that can pay.
 * @param {{name?: string, reason: string|null}|null} wallet the list entry
 * @param {string} destinationType payment type or addressType
 * @param {(key: string, params?: object) => string} t vue-i18n translate
 * @param {{ hasAlternative?: boolean }} [options]
 * @returns {string} '' when nothing blocks
 */
export function payingWalletHint(wallet, destinationType, t, { hasAlternative = true } = {}) {
  const name = wallet?.name || t('Wallet')
  switch (wallet?.reason) {
    case PAYING_REASON.UNSUPPORTED_DESTINATION:
      return walletSwitchHint(destinationType, t)
    case PAYING_REASON.INSUFFICIENT_BALANCE:
      return hasAlternative
        ? t('Not enough balance in {wallet}. Choose another wallet or send less.', { wallet: name })
        : t('Not enough balance in {wallet}.', { wallet: name })
    default:
      return ''
  }
}
