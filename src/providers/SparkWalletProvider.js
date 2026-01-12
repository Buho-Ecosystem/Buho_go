/**
 * SparkWalletProvider - Spark wallet implementation
 *
 * Uses @buildonspark/spark-sdk for self-custodial Bitcoin Lightning.
 * Supports both Lightning payments and zero-fee Spark-to-Spark transfers.
 */

import { WalletProvider } from './WalletProvider';
import { SparkWallet } from '@buildonspark/spark-sdk';

export class SparkWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.wallet = null;
    this.mnemonic = null;
    this.sparkAddress = null;
    this.network = walletData.network || 'MAINNET';
  }

  getType() {
    return 'spark';
  }

  isSpark() {
    return true;
  }

  /**
   * Initialize wallet with mnemonic (after PIN decryption)
   * @param {string} mnemonic - Space-separated mnemonic words
   */
  async initializeWithMnemonic(mnemonic) {
    try {
      this.mnemonic = mnemonic;

      const result = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network: this.network }
      });

      this.wallet = result.wallet;
      this.isConnected = true;
      this.clearError();

      // Cache Spark address
      this.sparkAddress = await this.wallet.getSparkAddress();

      return true;
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Create a new wallet with fresh mnemonic
   * @returns {Promise<{wallet: SparkWallet, mnemonic: string}>}
   */
  static async createNewWallet(network = 'MAINNET') {
    try {
      const result = await SparkWallet.initialize({
        mnemonicOrSeed: undefined, // Generate new mnemonic
        options: { network }
      });

      return {
        wallet: result.wallet,
        mnemonic: result.mnemonic
      };
    } catch (error) {
      console.error('Failed to create Spark wallet:', error);
      throw error;
    }
  }

  /**
   * Restore wallet from existing mnemonic (for validation during restore)
   * @param {string} mnemonic
   * @param {string} network
   * @returns {Promise<SparkWallet>}
   */
  static async restoreWallet(mnemonic, network = 'MAINNET') {
    try {
      const result = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network }
      });

      return result.wallet;
    } catch (error) {
      console.error('Failed to restore Spark wallet:', error);
      throw error;
    }
  }

  async connect() {
    if (this.wallet) {
      this.isConnected = true;
      return;
    }

    // Wallet needs to be initialized with mnemonic first
    throw new Error('Spark wallet requires mnemonic to connect. Use initializeWithMnemonic()');
  }

  async disconnect() {
    if (this.wallet) {
      try {
        this.wallet.cleanupConnections();
      } catch (error) {
        console.warn('Error cleaning up Spark connections:', error);
      }
    }

    this.wallet = null;
    this.mnemonic = null;
    this.isConnected = false;
  }

  async getBalance() {
    this._ensureConnected();

    try {
      const { balance, tokenBalances } = await this.wallet.getBalance();

      return {
        balance: Number(balance), // Convert from bigint to number
        pending: 0,
        tokenBalances: tokenBalances || []
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getInfo() {
    this._ensureConnected();

    try {
      const sparkAddress = await this.getSparkAddress();

      return {
        alias: this.walletData.name || 'Spark Wallet',
        color: '#15DE72',
        pubkey: null, // Spark uses different key derivation
        lightningAddress: null, // Spark doesn't have Lightning addresses
        sparkAddress: sparkAddress,
        type: 'spark'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async createInvoice({ amount, description, expiry = 3600 }) {
    this._ensureConnected();

    try {
      const result = await this.wallet.createLightningInvoice({
        amountSats: amount,
        memo: description || 'BuhoGO Payment',
        expirySeconds: expiry
      });

      // Spark SDK returns LightningReceiveRequest:
      // { id, invoice: { encodedInvoice, paymentHash, ... }, status, ... }
      // See: https://docs.spark.money/llms-full.txt
      const invoiceString = result.invoice?.encodedInvoice;

      if (!invoiceString || typeof invoiceString !== 'string') {
        console.error('Unexpected invoice response from Spark SDK:', result);
        throw new Error('Invalid invoice response from Spark wallet');
      }

      return {
        paymentRequest: invoiceString,
        paymentHash: result.invoice?.paymentHash || result.id || null,
        expiresAt: Math.floor(Date.now() / 1000) + expiry
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async payInvoice({ invoice, maxFee = 10 }) {
    this._ensureConnected();

    try {
      const payment = await this.wallet.payLightningInvoice({
        invoice: invoice,
        maxFeeSats: maxFee
      });

      return {
        preimage: payment.preimage,
        fee: payment.feeSats || 0,
        status: payment.status || 'completed'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    try {
      // Spark SDK getTransfers returns { transfers: WalletTransfer[], offset: number }
      const result = await this.wallet.getTransfers({ limit: 100, offset: 0 });
      const transferList = result.transfers || [];

      const found = transferList.find(t => t.id === paymentHash);

      if (found) {
        return {
          paid: found.status === 'COMPLETED',
          preimage: found.preimage || null,
          amount: Number(found.totalValue || 0)
        };
      }

      return { paid: false };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getTransactions({ limit = 50, offset = 0 } = {}) {
    this._ensureConnected();

    try {
      // Spark SDK getTransfers returns { transfers: WalletTransfer[], offset: number }
      const result = await this.wallet.getTransfers({ limit, offset });
      const transferList = result.transfers || [];

      return transferList.map(transfer => ({
        id: transfer.id,
        type: this._mapTransferType(transfer),
        amount: Number(transfer.totalValue || 0),
        timestamp: new Date(transfer.createdAt).getTime() / 1000,
        description: transfer.memo || '',
        status: transfer.status?.toLowerCase() || 'completed',
        fee: 0, // Spark transfers don't have explicit fees
        sparkTransfer: transfer.transferDirection === 'OUTGOING' || transfer.transferDirection === 'INCOMING'
      }));
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Spark-specific methods
  // ==========================================

  async getSparkAddress() {
    this._ensureConnected();

    if (this.sparkAddress) {
      return this.sparkAddress;
    }

    try {
      this.sparkAddress = await this.wallet.getSparkAddress();
      return this.sparkAddress;
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Transfer to a Spark address (zero-fee Spark-to-Spark)
   * @param {string} sparkAddress - Recipient Spark address
   * @param {number} amount - Amount in sats
   */
  async transferToSparkAddress(sparkAddress, amount) {
    this._ensureConnected();

    if (!WalletProvider.isSparkAddress(sparkAddress)) {
      throw new Error('Invalid Spark address');
    }

    try {
      const transfer = await this.wallet.transfer({
        receiverSparkAddress: sparkAddress,
        amountSats: amount
      });

      return {
        id: transfer.id,
        status: transfer.status || 'completed'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Pay a Lightning address from Spark wallet
   * Fetches invoice from LNURL and pays it
   * @param {string} lightningAddress - Lightning address (user@domain.com)
   * @param {number} amountSats - Amount in sats
   * @param {string} comment - Optional comment
   */
  async payLightningAddress(lightningAddress, amountSats, comment = '') {
    this._ensureConnected();

    try {
      // Parse Lightning address to get LNURL endpoint
      const [username, domain] = lightningAddress.split('@');
      if (!username || !domain) {
        throw new Error('Invalid Lightning address format');
      }

      // Fetch LNURL-pay endpoint
      const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      const response = await fetch(lnurlEndpoint);

      if (!response.ok) {
        throw new Error('Failed to fetch Lightning address info');
      }

      const lnurlData = await response.json();

      // Validate amount is within bounds
      const minSendable = Math.ceil((lnurlData.minSendable || 1000) / 1000);
      const maxSendable = Math.floor((lnurlData.maxSendable || 100000000000) / 1000);

      if (amountSats < minSendable || amountSats > maxSendable) {
        throw new Error(`Amount must be between ${minSendable} and ${maxSendable} sats`);
      }

      // Request invoice
      const amountMs = amountSats * 1000;
      let callbackUrl = `${lnurlData.callback}?amount=${amountMs}`;

      if (comment && lnurlData.commentAllowed > 0) {
        const truncatedComment = comment.substring(0, lnurlData.commentAllowed);
        callbackUrl += `&comment=${encodeURIComponent(truncatedComment)}`;
      }

      const invoiceResponse = await fetch(callbackUrl);
      if (!invoiceResponse.ok) {
        throw new Error('Failed to get invoice from Lightning address');
      }

      const invoiceData = await invoiceResponse.json();

      if (invoiceData.status === 'ERROR') {
        throw new Error(invoiceData.reason || 'Failed to get invoice');
      }

      // Pay the invoice
      const result = await this.payInvoice({ invoice: invoiceData.pr });

      return {
        ...result,
        lightningAddress: lightningAddress
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Private helper methods
  // ==========================================

  _ensureConnected() {
    if (!this.wallet || !this.isConnected) {
      throw new Error('Spark wallet is not connected');
    }
  }

  _mapTransferType(transfer) {
    // Spark SDK uses transferDirection: 'OUTGOING' | 'INCOMING'
    if (transfer.transferDirection === 'INCOMING') {
      return 'receive';
    }
    if (transfer.transferDirection === 'OUTGOING') {
      return 'send';
    }
    // Fallback for legacy format
    if (transfer.type) {
      switch (transfer.type) {
        case 'LIGHTNING_RECEIVE':
        case 'SPARK_RECEIVE':
          return 'receive';
        case 'LIGHTNING_SEND':
        case 'SPARK_SEND':
        case 'SPARK_TRANSFER':
          return 'send';
      }
    }
    return transfer.totalValue > 0 ? 'receive' : 'send';
  }
}

export default SparkWalletProvider;
