/**
 * walletCapabilities — the single source of truth for "can the active
 * wallet pay this destination?".
 *
 * Every surface that gates a destination on the active wallet's rails
 * (Send sheet, confirm sheets, contact flows) answers through here, so
 * the app can never warn in one place and dead-end in another.
 *
 * Destinations collapse to four rails:
 *   - 'spark'     sp1/spark addresses → Spark wallets only
 *   - 'arkade'    ark1 addresses      → Arkade wallets only (different
 *                                       network than Spark)
 *   - 'bitcoin'   on-chain addresses  → Spark (L1 withdraw) or Arkade
 *                                       (Ramps offboard)
 *   - 'lightning' everything else (BOLT11, Lightning Address, LNURL,
 *                 phone payout, BIP21's lightning leg) → every wallet
 *
 * Both live vocabularies are accepted: payment types emitted by the
 * send pipeline ('spark_address', ...) and address-book addressTypes
 * ('spark', ...). Unrecognized types resolve to 'lightning'
 * (permissive) — recognition gates fire before capability gates, so an
 * unknown type here means a new Lightning-rails feature, not a hole.
 *
 * BOLT12 offers are deliberately NOT handled here: no wallet can pay
 * them, and the dedicated unsupported-BOLT12 dialog (wallet store)
 * owns that explanation.
 *
 * Pure and synchronous — no store imports, callers pass the active
 * wallet type — so it stays unit-testable under plain Node.
 */

const KIND_BY_TYPE = {
  spark: 'spark',
  spark_address: 'spark',
  arkade: 'arkade',
  arkade_address: 'arkade',
  bitcoin: 'bitcoin',
  bitcoin_address: 'bitcoin',
}

/**
 * Collapse a payment type or address-book addressType to its rail.
 * @param {string} type
 * @returns {'spark'|'arkade'|'bitcoin'|'lightning'}
 */
export function destinationKind(type) {
  return KIND_BY_TYPE[type] || 'lightning'
}

/**
 * Can a wallet of `walletType` ('spark' | 'arkade' | 'lnbits' | 'nwc')
 * pay a destination of `type`?
 * @param {string} walletType
 * @param {string} type  payment type or addressType
 * @returns {boolean}
 */
export function canWalletPay(walletType, type) {
  const kind = destinationKind(type)
  if (kind === 'spark') return walletType === 'spark'
  if (kind === 'arkade') return walletType === 'arkade'
  if (kind === 'bitcoin') return walletType === 'spark' || walletType === 'arkade'
  // Arkade's Lightning rode Boltz swaps; that service is retired and gone.
  // Gate it here so every surface says so up front instead of dead-ending
  // at send time. Lift when Arkade Intents Lightning ships
  // (Plans WIP/arkade-maintenance-map.md, phase 1).
  if (walletType === 'arkade') return false
  return true
}

/**
 * The one localized "switch wallet" explanation per rail — every
 * surface shows the same words for the same constraint. Empty string
 * for lightning rails (no switch needed).
 * @param {string} type  payment type or addressType
 * @param {(key: string) => string} t  vue-i18n translate
 * @returns {string}
 */
export function walletSwitchHint(type, t) {
  const kind = destinationKind(type)
  if (kind === 'spark') return t('Switch to your Spark wallet to pay this address')
  if (kind === 'arkade') return t('Switch to your Arkade wallet to pay this address')
  if (kind === 'bitcoin') return t('Switch to a Spark or Arkade wallet to send Bitcoin')
  // Only Arkade ever fails the lightning kind (see canWalletPay), so the
  // hint can name it.
  return t('Lightning is temporarily unavailable on Arkade - switch to another wallet')
}
