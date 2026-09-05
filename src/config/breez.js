/**
 * Breez Spark engine configuration.
 *
 * BuhoGO can run its Spark wallets on one of two engines:
 *   - 'direct' — the directly integrated Spark SDK (the default)
 *   - 'breez'  — the Breez SDK with the Spark implementation
 *
 * Both engines derive the identical wallet from the same mnemonic and
 * account number (purpose path m/8797555'/{account}'), so switching engines
 * never changes funds or identity. The switch is device-local, internal, and
 * defaults to 'direct' until Breez parity is proven on-device; there is no
 * user-facing UI for it. Flip from a dev console with:
 *   localStorage.setItem('buhoGO_spark_engine', 'breez')
 * and reconnect (or restart the app).
 *
 * Full migration plan: Plans WIP/breez-spark-migration.md
 */

const ENGINE_STORAGE_KEY = 'buhoGO_spark_engine';

/**
 * Breez API key, injected at build time. Local dev: put
 * VITE_BREEZ_API_KEY=... into an untracked .env.local. Without a key the
 * Breez engine still constructs but mainnet service access may be limited;
 * the direct engine is unaffected.
 */
export const BREEZ_API_KEY = String(import.meta.env?.VITE_BREEZ_API_KEY || '').trim();

/**
 * Domain for Breez-hosted Lightning addresses (user@domain). BuhoGO's
 * domain is CNAME'd to breez.tips and registered with Breez against the
 * API key. Changing this later changes every user's address, so treat it
 * as permanent. (Empty string would fall back to the SDK default domain,
 * breez.tips.)
 */
export const BREEZ_LNURL_DOMAIN = 'btc.mybuho.de';

/**
 * Which engine powers Spark wallets on this device.
 * @returns {'direct'|'breez'}
 */
export function sparkEngine() {
  try {
    return localStorage.getItem(ENGINE_STORAGE_KEY) === 'breez' ? 'breez' : 'direct';
  } catch (e) {
    return 'direct';
  }
}

/**
 * Set the Spark engine for this device. Takes effect on the next connect.
 * Used by the Breez provider's identity-mismatch auto-revert and by dev
 * tooling; never wired to end-user UI while the migration is in progress.
 * @param {'direct'|'breez'} engine
 */
export function setSparkEngine(engine) {
  try {
    if (engine === 'breez') {
      localStorage.setItem(ENGINE_STORAGE_KEY, 'breez');
    } else {
      localStorage.removeItem(ENGINE_STORAGE_KEY);
    }
  } catch (e) {
    // Storage unavailable (private mode) — engine stays 'direct'.
  }
}

export function isBreezEngine() {
  return sparkEngine() === 'breez';
}
