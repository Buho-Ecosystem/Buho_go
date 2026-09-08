/**
 * Breez SDK configuration.
 *
 * Spark wallets run on the Breez SDK Spark implementation. Key derivation
 * follows the Spark purpose path (m/8797555'/{account}'), so wallets
 * created under the previously integrated direct Spark SDK resolve to the
 * identical identity, funds, and history; every connect additionally
 * asserts the derived spark address against the wallet's stored one.
 *
 * Migration record: Plans WIP/breez-spark-migration.md
 */

/**
 * Breez API key, injected at build time and mandatory for mainnet — the
 * SDK refuses to build without one. Local dev: put
 * VITE_BREEZ_API_KEY=... into an untracked .env.local.
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
