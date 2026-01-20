/**
 * WalletFactory - Creates wallet provider instances
 *
 * Factory pattern for instantiating the correct wallet provider
 * based on wallet type (spark or nwc).
 */

import { SparkWalletProvider } from './SparkWalletProvider';
import { NWCWalletProvider } from './NWCWalletProvider';
import { WalletProvider } from './WalletProvider';

/**
 * Create a wallet provider instance based on wallet type
 * @param {Object} wallet - Wallet configuration object
 * @param {string} wallet.id - Wallet ID
 * @param {string} wallet.type - Wallet type ('spark' or 'nwc')
 * @param {string} [wallet.nwcUrl] - NWC connection URL (for NWC wallets)
 * @param {Object} [wallet.connectionData] - Connection data (for Spark wallets)
 * @returns {WalletProvider} The appropriate wallet provider instance
 */
export function createWalletProvider(wallet) {
  if (!wallet || !wallet.id) {
    throw new Error('Invalid wallet configuration: missing id');
  }

  const type = wallet.type || inferWalletType(wallet);

  switch (type) {
    case 'spark':
      return new SparkWalletProvider(wallet.id, {
        name: wallet.name,
        network: wallet.connectionData?.network || 'MAINNET',
        encryptedMnemonic: wallet.connectionData?.encryptedMnemonic,
        ...wallet
      });

    case 'nwc':
      if (!wallet.nwcUrl) {
        throw new Error('NWC wallet requires nwcUrl');
      }
      return new NWCWalletProvider(wallet.id, {
        name: wallet.name,
        nwcUrl: wallet.nwcUrl,
        metadata: wallet.metadata,
        ...wallet
      });

    default:
      throw new Error(`Unknown wallet type: ${type}`);
  }
}

/**
 * Infer wallet type from wallet data (for backward compatibility)
 * @param {Object} wallet - Wallet object
 * @returns {string} 'spark' or 'nwc'
 */
export function inferWalletType(wallet) {
  if (wallet.type) {
    return wallet.type;
  }

  // Check for Spark-specific properties
  if (wallet.connectionData?.encryptedMnemonic) {
    return 'spark';
  }

  // Check for NWC-specific properties
  if (wallet.nwcUrl) {
    return 'nwc';
  }

  // Default to NWC for backward compatibility
  return 'nwc';
}

/**
 * Check if an address is a Spark address
 * @param {string} address - Address to check
 * @returns {boolean}
 */
export function isSparkAddress(address) {
  return WalletProvider.isSparkAddress(address);
}

/**
 * Parse a payment destination and determine its type
 * @param {string} input - Payment destination (invoice, address, etc.)
 * @returns {Object} Parsed payment info
 */
export function parsePaymentDestination(input) {
  if (!input || typeof input !== 'string') {
    return { type: 'unknown', valid: false };
  }

  let cleaned = input.trim();
  // Strip common URI prefixes (lightning:, bitcoin:, LIGHTNING:, etc.)
  if (cleaned.toLowerCase().startsWith('lightning:')) {
    cleaned = cleaned.substring(10);
  } else if (cleaned.toLowerCase().startsWith('bitcoin:')) {
    cleaned = cleaned.substring(8);
  }

  const normalized = cleaned.toLowerCase();

  // Spark address (zero-fee transfer)
  // New format: spark1 (mainnet), sparkrt1 (regtest), sparkt1 (testnet), sparks1 (signet), sparkl1 (local)
  // Legacy format: sp1 (mainnet), tsp1 (testnet), sprt1 (regtest)
  const sparkNewPrefixes = ['spark1', 'sparkrt1', 'sparkt1', 'sparks1', 'sparkl1'];
  const sparkLegacyPrefixes = ['sp1', 'tsp1', 'sprt1'];
  const isSparkAddr = sparkNewPrefixes.some(p => normalized.startsWith(p)) ||
                      sparkLegacyPrefixes.some(p => normalized.startsWith(p));

  if (isSparkAddr) {
    return {
      type: 'spark_address',
      address: cleaned,
      isZeroFee: true,
      valid: true
    };
  }

  // Lightning invoice (BOLT11): lnbc (mainnet), lntb (testnet), lntbs (signet), lnbcrt (regtest)
  if (normalized.startsWith('lnbc') || normalized.startsWith('lntb') ||
      normalized.startsWith('lntbs') || normalized.startsWith('lnbcrt')) {
    return {
      type: 'lightning_invoice',
      invoice: cleaned,
      valid: true
    };
  }

  // Lightning address
  if (cleaned.includes('@') && cleaned.split('@').length === 2) {
    const [name, domain] = cleaned.split('@');
    if (name.length > 0 && domain.includes('.')) {
      return {
        type: 'lightning_address',
        address: cleaned.toLowerCase(),
        valid: true
      };
    }
  }

  // LNURL (bech32 encoded)
  if (normalized.startsWith('lnurl1')) {
    return {
      type: 'lnurl',
      lnurl: cleaned,
      valid: true
    };
  }

  // Bitcoin on-chain address (not supported by Spark Lightning, but detect it)
  if (normalized.startsWith('bc1') || normalized.startsWith('tb1') ||
      normalized.startsWith('1') || normalized.startsWith('3')) {
    return {
      type: 'bitcoin_address',
      address: cleaned,
      valid: true,
      supported: false,
      message: 'On-chain Bitcoin addresses are not supported. Use Lightning or Spark addresses.'
    };
  }

  return { type: 'unknown', valid: false };
}

/**
 * Wallet type constants
 */
export const WALLET_TYPES = {
  SPARK: 'spark',
  NWC: 'nwc'
};

/**
 * Payment destination type constants
 */
export const PAYMENT_TYPES = {
  SPARK_ADDRESS: 'spark_address',
  LIGHTNING_INVOICE: 'lightning_invoice',
  LIGHTNING_ADDRESS: 'lightning_address',
  LNURL: 'lnurl',
  BITCOIN_ADDRESS: 'bitcoin_address',
  UNKNOWN: 'unknown'
};

export default {
  createWalletProvider,
  inferWalletType,
  isSparkAddress,
  parsePaymentDestination,
  WALLET_TYPES,
  PAYMENT_TYPES
};
