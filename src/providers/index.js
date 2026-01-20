/**
 * Wallet Providers - Unified interface for different wallet types
 */

export { WalletProvider } from './WalletProvider';
export { SparkWalletProvider } from './SparkWalletProvider';
export { NWCWalletProvider } from './NWCWalletProvider';
export {
  createWalletProvider,
  inferWalletType,
  isSparkAddress,
  parsePaymentDestination,
  WALLET_TYPES,
  PAYMENT_TYPES
} from './WalletFactory';
