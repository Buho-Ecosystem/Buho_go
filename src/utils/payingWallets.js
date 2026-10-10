/**
 * payingWallets - "which of my wallets can pay this, and which one should?"
 *
 * The answer behind the "Pay with" field of the confirm sheet. One pure
 * function turns the wallet store's raw facts (wallets, balances, connection
 * states) plus the payment in front of the user (rail + amount) into an
 * ordered list the UI renders as is, so the sheet, the commit gate and the
 * tests all read the same verdict.
 *
 * A wallet is unusable for exactly one of three stable reasons:
 *   - 'unsupported-destination'  the rail is closed to this wallet type
 *                                (walletCapabilities.canWalletPay: Arkade has
 *                                no Lightning, only Spark pays Spark addresses)
 *   - 'unavailable'              the last connection attempt failed. A wallet
 *                                that simply is not connected yet is NOT
 *                                unavailable: every send path connects on
 *                                demand, so it stays usable.
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
  UNAVAILABLE: 'unavailable',
})

/**
 * Fee reserve for surfaces that must not offer a wallet which "has exactly
 * enough": 1 % of the amount, never less than 10 sats. One definition, shared
 * with the Nip05 marketplace sheet.
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
 *   isActive: boolean, usable: boolean, reason: string|null}>}
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
      } else if (state && !state.connected && state.error) {
        reason = PAYING_REASON.UNAVAILABLE
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
      }
    })

  // Stable partition: the active wallet leads, everything else keeps its order.
  return [...entries.filter((w) => w.isActive), ...entries.filter((w) => !w.isActive)]
}

/**
 * The wallet a payment starts with: the active wallet when it can pay, else
 * the first wallet that can, else the active one (so the sheet can still say
 * why nothing works). Null for an empty list, or when nothing is active and
 * nothing is usable.
 * @param {ReturnType<typeof listPayingWallets>} list
 */
export function pickDefaultPayingWallet(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const active = list.find((wallet) => wallet.isActive) || null
  if (active?.usable) return active
  return list.find((wallet) => wallet.usable) || active
}

/**
 * Short reason shown in the "Pay with" rows. The unsupported-destination copy
 * names the rail, because "Lightning unavailable" on a Spark-address payment
 * would be wrong.
 * @param {string|null} reason one of PAYING_REASON
 * @param {string} destinationType payment type or addressType
 * @param {(key: string) => string} t vue-i18n translate
 * @returns {string} '' for a usable wallet
 */
export function payingWalletReasonText(reason, destinationType, t) {
  switch (reason) {
    case PAYING_REASON.UNSUPPORTED_DESTINATION: {
      const kind = destinationKind(destinationType)
      if (kind === 'spark') return t('Spark wallets only')
      if (kind === 'arkade') return t('Arkade wallets only')
      if (kind === 'bitcoin') return t('Spark or Arkade only')
      return t('Lightning unavailable')
    }
    case PAYING_REASON.INSUFFICIENT_BALANCE:
      return t('Not enough balance')
    case PAYING_REASON.UNAVAILABLE:
      return t('Unavailable')
    default:
      return ''
  }
}

/**
 * The sentence for the sheet's warning banner (the existing walletHint slot)
 * when the selected wallet is blocked. A rail problem keeps the shared
 * switch-wallet words every other surface uses.
 * @param {{name?: string, reason: string|null}|null} wallet the list entry
 * @param {string} destinationType payment type or addressType
 * @param {(key: string, params?: object) => string} t vue-i18n translate
 * @returns {string} '' when nothing blocks
 */
export function payingWalletHint(wallet, destinationType, t) {
  switch (wallet?.reason) {
    case PAYING_REASON.UNSUPPORTED_DESTINATION:
      return walletSwitchHint(destinationType, t)
    case PAYING_REASON.INSUFFICIENT_BALANCE:
      return t('Not enough balance in {wallet} - choose another wallet or send less', { wallet: wallet.name || t('Wallet') })
    case PAYING_REASON.UNAVAILABLE:
      return t('{wallet} is unavailable right now - choose another wallet', { wallet: wallet.name || t('Wallet') })
    default:
      return ''
  }
}
