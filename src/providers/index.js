/**
 * Wallet Providers - Unified interface for different wallet types
 */

export { WalletProvider } from './WalletProvider';
export { SparkWalletProvider } from './SparkWalletProvider';
export { NWCWalletProvider } from './NWCWalletProvider';
export { ArkadeWalletProvider } from './ArkadeWalletProvider';
export {
  createWalletProvider,
  inferWalletType,
  isSparkAddress,
  isArkadeAddress,
  parsePaymentDestination,
  WALLET_TYPES,
  PAYMENT_TYPES
} from './WalletFactory';
