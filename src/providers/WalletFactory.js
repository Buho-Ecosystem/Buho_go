/**
 * WalletFactory - Creates wallet provider instances
 *
 * Factory pattern for instantiating the correct wallet provider
 * based on wallet type (spark or nwc).
 */

import { SparkWalletProvider } from './SparkWalletProvider';
import { NWCWalletProvider } from './NWCWalletProvider';
import { LNBitsWalletProvider } from './LNBitsWalletProvider';
import { WalletProvider } from './WalletProvider';
import { parseBip21, selectBip21Destination } from '../utils/bip21';
import {
  isSparkAddress,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
} from '../utils/addressUtils';

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
        accountNumber: wallet.connectionData?.accountNumber,
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

    case 'lnbits':
      if (!wallet.connectionData?.serverUrl || !wallet.connectionData?.adminKey) {
        throw new Error('LNBits wallet requires serverUrl and adminKey');
      }
      if (!wallet.connectionData?.walletId) {
        throw new Error('LNBits wallet requires walletId');
      }
      return new LNBitsWalletProvider(wallet.id, {
        name: wallet.name,
        serverUrl: wallet.connectionData.serverUrl,
        walletId: wallet.connectionData.walletId,
        adminKey: wallet.connectionData.adminKey,
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

  // Check for LNBits-specific properties
  if (wallet.connectionData?.serverUrl && wallet.connectionData?.walletId && wallet.connectionData?.adminKey) {
    return 'lnbits';
  }

  // Check for NWC-specific properties
  if (wallet.nwcUrl) {
    return 'nwc';
  }

  // Default to NWC for backward compatibility
  return 'nwc';
}

// `isSparkAddress` is re-exported from addressUtils below — no wrapper needed.
export { isSparkAddress } from '../utils/addressUtils';

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

  // BIP21 (bitcoin:<addr>?amount=...&lightning=lnbc...) needs structured
  // parsing — a naive prefix strip would leave the query string glued to the
  // address. We resolve to the preferred inner destination (LN > on-chain)
  // and let the existing prefix-based branches below handle the result.
  let bip21 = null;
  const bip21Parsed = parseBip21(cleaned);
  if (bip21Parsed) {
    bip21 = bip21Parsed;
    const destination = selectBip21Destination(bip21Parsed);
    if (!destination) {
      return { type: 'unknown', valid: false, bip21 };
    }
    cleaned = destination.value;
  } else if (cleaned.toLowerCase().startsWith('lightning:')) {
    cleaned = cleaned.substring(10);
  }

  // Attach BIP21 metadata (amount, label, message, ...) to every result so
  // downstream UI can prefill where useful.
  const withBip21 = (result) => (bip21 ? { ...result, bip21 } : result);

  if (isSparkAddress(cleaned)) {
    return withBip21({
      type: 'spark_address',
      address: cleaned,
      isZeroFee: true,
      valid: true,
    });
  }

  if (isLightningInvoice(cleaned)) {
    return withBip21({
      type: 'lightning_invoice',
      invoice: cleaned,
      valid: true,
    });
  }

  // Lightning address (user@domain) — cheap structural check; full regex
  // validation lives in addressUtils.isLightningAddress when needed.
  if (cleaned.includes('@') && cleaned.split('@').length === 2) {
    const [name, domain] = cleaned.split('@');
    if (name.length > 0 && domain.includes('.')) {
      return withBip21({
        type: 'lightning_address',
        address: cleaned.toLowerCase(),
        valid: true,
      });
    }
  }

  if (isLnurl(cleaned)) {
    return withBip21({
      type: 'lnurl',
      lnurl: cleaned,
      valid: true,
    });
  }

  // Bitcoin on-chain (only Spark wallets can pay these; UI layer decides).
  if (isBitcoinAddress(cleaned)) {
    return withBip21({
      type: 'bitcoin_address',
      address: cleaned,
      valid: true,
    });
  }

  return withBip21({ type: 'unknown', valid: false });
}

/**
 * Wallet type constants
 */
export const WALLET_TYPES = {
  SPARK: 'spark',
  NWC: 'nwc',
  LNBITS: 'lnbits'
};

/**
 * Payment destination type constants
 */
export const PAYMENT_TYPES = {
  SPARK_ADDRESS: 'spark_address',
  LIGHTNING_INVOICE: 'lightning_invoice',
  LIGHTNING_ADDRESS: 'lightning_address',
  LNURL: 'lnurl',
  LNURL_WITHDRAW: 'lnurl_withdraw',
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
