/**
 * SparkWalletProvider - Spark wallet implementation
 *
 * Uses @buildonspark/spark-sdk for self-custodial Bitcoin Lightning.
 * Supports both Lightning payments and zero-fee Spark-to-Spark transfers.
 *
 * Features:
 * - Lightning invoice payments with fee estimation
 * - Zero-fee Spark-to-Spark transfers
 * - Lightning address payments (LNURL-pay)
 * - Zero-amount invoice support
 * - preferSpark option for auto-detecting Spark addresses in invoices
 * - Real-time payment notifications via events
 */

import { WalletProvider } from './WalletProvider';
import { SparkWallet } from '@buildonspark/spark-sdk';

/**
 * Payment status constants matching SDK statuses
 */
const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

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

  // ==========================================
  // Static utility methods
  // ==========================================

  /**
   * Calculate recommended fee based on Spark documentation
   * Recommendation: max(5 sats, 17 bps × amount)
   * @param {number} amountSats - Payment amount in satoshis
   * @returns {number} Recommended max fee in satoshis
   */
  static calculateRecommendedFee(amountSats) {
    const minFee = 5;
    const bpsFee = Math.ceil(amountSats * 0.0017); // 17 basis points = 0.17%
    return Math.max(minFee, bpsFee);
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

  /**
   * Create a Lightning invoice for receiving payments
   *
   * @param {Object} options - Invoice options
   * @param {number} options.amount - Amount in satoshis (use 0 for zero-amount invoices)
   * @param {string} [options.description] - Invoice memo/description
   * @param {number} [options.expiry=3600] - Invoice expiry in seconds
   * @param {boolean} [options.includeSparkAddress=true] - Embed Spark address in invoice for zero-fee transfers
   * @param {string} [options.descriptionHash] - Hash of description (for LNURL/UMA, cannot use with description)
   * @returns {Promise<{paymentRequest: string, paymentHash: string, id: string, expiresAt: number}>}
   */
  async createInvoice({ amount, description, expiry = 3600, includeSparkAddress = true, descriptionHash = null }) {
    this._ensureConnected();

    try {
      // Build invoice parameters
      const invoiceParams = {
        amountSats: amount,
        includeSparkAddress: includeSparkAddress
      };

      // Use descriptionHash OR memo, not both (SDK constraint)
      if (descriptionHash) {
        invoiceParams.descriptionHash = descriptionHash;
      } else {
        invoiceParams.memo = description || 'BuhoGO Payment';
      }

      const result = await this.wallet.createLightningInvoice(invoiceParams);

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
        paymentHash: result.invoice?.paymentHash || null,
        id: result.id, // Invoice ID for monitoring with getLightningReceiveRequest()
        expiresAt: Math.floor(Date.now() / 1000) + expiry
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Pay a Lightning invoice
   *
   * @param {Object} options - Payment options
   * @param {string} options.invoice - BOLT11 encoded Lightning invoice
   * @param {number} [options.maxFee] - Maximum fee in sats (defaults to recommended fee)
   * @param {boolean} [options.preferSpark=false] - When true, uses Spark transfer if invoice contains Spark address
   * @param {number} [options.amountSats] - Amount for zero-amount invoices (ignored for fixed-amount invoices)
   * @returns {Promise<{id: string, preimage: string, fee: number, status: string}>}
   */
  async payInvoice({ invoice, maxFee, preferSpark = false, amountSats = null }) {
    this._ensureConnected();

    try {
      // Calculate recommended fee if not provided
      // Use amountSats if provided (for zero-amount invoices), otherwise use a sensible default
      const feeAmount = amountSats || 10000; // Default to 10k sats for fee calculation if unknown
      const effectiveMaxFee = maxFee ?? SparkWalletProvider.calculateRecommendedFee(feeAmount);

      // Build payment parameters
      const paymentParams = {
        invoice: invoice,
        maxFeeSats: effectiveMaxFee,
        preferSpark: preferSpark
      };

      // Add amount for zero-amount invoices
      if (amountSats && amountSats > 0) {
        paymentParams.amountSatsToSend = amountSats;
      }

      const payment = await this.wallet.payLightningInvoice(paymentParams);

      return {
        id: payment.id || null,
        preimage: payment.preimage,
        fee: payment.feeSats || 0,
        status: this._normalizePaymentStatus(payment.status)
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Get fee estimate for a Lightning invoice before paying
   * Useful for showing users the expected fee before confirming payment
   *
   * @param {string} invoice - BOLT11 encoded Lightning invoice
   * @returns {Promise<{estimatedFeeSats: number, invoice: string}>}
   */
  async getLightningSendFeeEstimate(invoice) {
    this._ensureConnected();

    try {
      const estimate = await this.wallet.getLightningSendFeeEstimate({
        encodedInvoice: invoice
      });

      return {
        estimatedFeeSats: estimate?.feeSats || estimate?.estimatedFeeSats || 0,
        invoice: invoice
      };
    } catch (error) {
      // If fee estimation fails, return a calculated estimate based on recommendation
      // This provides a fallback rather than failing completely
      console.warn('Fee estimation failed, using calculated estimate:', error.message);

      // Try to decode invoice amount for better estimate (fallback to default)
      const fallbackFee = SparkWalletProvider.calculateRecommendedFee(10000);

      return {
        estimatedFeeSats: fallbackFee,
        invoice: invoice,
        isEstimated: true
      };
    }
  }

  /**
   * Get the status of an outgoing Lightning payment
   * Use this to monitor payment progress after calling payInvoice()
   *
   * Note: The 'transfer:claimed' event does NOT fire for outgoing payments.
   * Use this method to poll for outgoing payment status.
   *
   * @param {string} paymentId - The payment ID returned from payInvoice()
   * @returns {Promise<{id: string, status: string, amount: number, fee: number, preimage: string|null, isComplete: boolean, isFailed: boolean}>}
   */
  async getLightningSendStatus(paymentId) {
    this._ensureConnected();

    try {
      const sendRequest = await this.wallet.getLightningSendRequest(paymentId);

      const status = this._normalizePaymentStatus(sendRequest.status);

      return {
        id: sendRequest.id,
        status: status,
        amount: sendRequest.amountSats || 0,
        fee: sendRequest.feeSats || 0,
        preimage: sendRequest.preimage || null,
        isComplete: status === PAYMENT_STATUS.COMPLETED,
        isFailed: status === PAYMENT_STATUS.FAILED
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Poll for outgoing payment completion
   * Convenience method that polls getLightningSendStatus until complete or failed
   *
   * @param {string} paymentId - The payment ID to monitor
   * @param {Object} options - Polling options
   * @param {number} [options.intervalMs=3000] - Polling interval in milliseconds
   * @param {number} [options.timeoutMs=60000] - Maximum time to wait in milliseconds
   * @param {Function} [options.onStatusChange] - Callback for status updates
   * @returns {Promise<{id: string, status: string, amount: number, fee: number, preimage: string|null}>}
   */
  async waitForPaymentCompletion(paymentId, options = {}) {
    const {
      intervalMs = 3000,
      timeoutMs = 60000,
      onStatusChange = null
    } = options;

    const startTime = Date.now();
    let lastStatus = null;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getLightningSendStatus(paymentId);

      // Notify on status change
      if (onStatusChange && status.status !== lastStatus) {
        onStatusChange(status);
        lastStatus = status.status;
      }

      // Return if complete or failed
      if (status.isComplete || status.isFailed) {
        return status;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Payment status check timed out');
  }

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    try {
      // Try to get the specific Lightning receive request first
      const receiveRequest = await this.wallet.getLightningReceiveRequest(paymentHash);

      if (receiveRequest) {
        const status = String(receiveRequest.status || '').toUpperCase();
        return {
          paid: status.includes('COMPLETED') || status.includes('CLAIMED'),
          preimage: receiveRequest.preimage || null,
          amount: Number(receiveRequest.amount || receiveRequest.invoice?.amountSats || 0)
        };
      }

      // Fallback: search in recent transfers
      const result = await this.wallet.getTransfers(100, 0);
      const transferList = result.transfers || [];

      const found = transferList.find(t =>
        t.id === paymentHash ||
        t.paymentHash === paymentHash ||
        t.invoice?.paymentHash === paymentHash
      );

      if (found) {
        const status = String(found.status || '').toUpperCase();
        return {
          paid: status.includes('COMPLETED') || status.includes('CLAIMED'),
          preimage: found.preimage || null,
          amount: Number(found.totalValue || found.amount || 0)
        };
      }

      return { paid: false };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Get detailed status of an incoming Lightning payment/invoice
   * Use the invoice ID returned from createInvoice()
   *
   * @param {string} invoiceId - The invoice ID (e.g., "SparkLightningReceiveRequest:...")
   * @returns {Promise<{id: string, status: string, isPaid: boolean, isExpired: boolean, amount: number, amountReceived: number}>}
   */
  async getLightningReceiveStatus(invoiceId) {
    this._ensureConnected();

    try {
      const receiveRequest = await this.wallet.getLightningReceiveRequest(invoiceId);

      const status = String(receiveRequest.status || '').toUpperCase();
      const isPaid = status.includes('COMPLETED') || status.includes('CLAIMED');
      const isExpired = status.includes('EXPIRED');

      return {
        id: receiveRequest.id,
        status: this._normalizePaymentStatus(receiveRequest.status),
        isPaid: isPaid,
        isExpired: isExpired,
        amount: Number(receiveRequest.amount || receiveRequest.invoice?.amountSats || 0),
        amountReceived: Number(receiveRequest.amountReceived || 0),
        preimage: receiveRequest.preimage || null
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Wait for an incoming Lightning payment to be received
   * Polls getLightningReceiveStatus until paid or expired
   *
   * @param {string} invoiceId - The invoice ID to monitor
   * @param {Object} options - Polling options
   * @param {number} [options.intervalMs=3000] - Polling interval in milliseconds
   * @param {number} [options.timeoutMs=300000] - Maximum wait time (default 5 minutes)
   * @param {Function} [options.onStatusChange] - Callback for status updates
   * @returns {Promise<{id: string, status: string, isPaid: boolean, amount: number}>}
   */
  async waitForInvoicePayment(invoiceId, options = {}) {
    const {
      intervalMs = 3000,
      timeoutMs = 300000,
      onStatusChange = null
    } = options;

    const startTime = Date.now();
    let lastStatus = null;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getLightningReceiveStatus(invoiceId);

      // Notify on status change
      if (onStatusChange && status.status !== lastStatus) {
        onStatusChange(status);
        lastStatus = status.status;
      }

      // Return if paid or expired
      if (status.isPaid || status.isExpired) {
        return status;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Invoice payment check timed out');
  }

  async getTransactions({ limit = 50, offset = 0 } = {}) {
    this._ensureConnected();

    try {
      // Spark SDK getTransfers returns { transfers: WalletTransfer[], offset: number }
      const result = await this.wallet.getTransfers(limit, offset);
      const transferList = result.transfers || [];

      return transferList.map(transfer => ({
        id: transfer.id,
        type: this._mapTransferType(transfer),
        amount: Number(transfer.totalValue || transfer.amount || 0),
        timestamp: this._parseTimestamp(transfer.createdTime || transfer.updatedTime),
        description: transfer.memo || transfer.description || '',
        status: this._normalizeStatus(transfer.status),
        fee: Number(transfer.fee || 0),
        // Determine if this is a Spark-to-Spark transfer (zero fee) vs Lightning
        sparkTransfer: this._isSparkTransfer(transfer),
        // Keep original transfer data for debugging
        rawType: transfer.type || transfer.transferDirection
      }));
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Parse timestamp from various formats the SDK might return
   */
  _parseTimestamp(timestamp) {
    if (!timestamp) return null;

    // Already a Unix timestamp (number)
    if (typeof timestamp === 'number') {
      // If it's in milliseconds, convert to seconds
      return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    }

    // Date object or ISO string
    const date = new Date(timestamp);
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Normalize status to lowercase string (for transactions)
   */
  _normalizeStatus(status) {
    if (!status) return PAYMENT_STATUS.COMPLETED;
    const statusStr = String(status).toLowerCase();
    // Map SDK statuses to simple statuses
    if (statusStr.includes('completed') || statusStr.includes('finalized') || statusStr.includes('claimed')) {
      return PAYMENT_STATUS.COMPLETED;
    }
    if (statusStr.includes('pending') || statusStr.includes('waiting')) {
      return PAYMENT_STATUS.PENDING;
    }
    if (statusStr.includes('failed') || statusStr.includes('expired')) {
      return PAYMENT_STATUS.FAILED;
    }
    return statusStr;
  }

  /**
   * Normalize payment status from SDK format
   * SDK uses: TRANSFER_COMPLETED, TRANSFER_FAILED, TRANSFER_PENDING, etc.
   */
  _normalizePaymentStatus(status) {
    if (!status) return PAYMENT_STATUS.PENDING;
    const statusStr = String(status).toUpperCase();

    if (statusStr.includes('COMPLETED') || statusStr.includes('FINALIZED') || statusStr.includes('SUCCESS')) {
      return PAYMENT_STATUS.COMPLETED;
    }
    if (statusStr.includes('FAILED') || statusStr.includes('ERROR') || statusStr.includes('EXPIRED')) {
      return PAYMENT_STATUS.FAILED;
    }
    // Default to pending for any other status
    return PAYMENT_STATUS.PENDING;
  }

  /**
   * Determine if transfer is Spark-to-Spark (not Lightning)
   */
  _isSparkTransfer(transfer) {
    // Check explicit type field first
    if (transfer.type) {
      const typeStr = String(transfer.type).toUpperCase();
      return typeStr.includes('SPARK') && !typeStr.includes('LIGHTNING');
    }
    // If no type but has transferDirection, assume Spark transfer
    if (transfer.transferDirection) {
      return true;
    }
    return false;
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

      // Pay the invoice with smart fee calculation based on amount
      const result = await this.payInvoice({
        invoice: invoiceData.pr,
        maxFee: SparkWalletProvider.calculateRecommendedFee(amountSats),
        preferSpark: true // Prefer Spark transfer if recipient has Spark address
      });

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
  // Event-based payment notifications
  // ==========================================

  /**
   * Subscribe to incoming payment events (real-time, no polling)
   * Uses Spark SDK's EventEmitter for instant notifications
   * @param {Function} callback - (transferId: string, newBalance: number) => void
   * @returns {Function} Unsubscribe function
   */
  onPaymentReceived(callback) {
    this._ensureConnected();

    const handler = (transferId, updatedBalance) => {
      callback(transferId, Number(updatedBalance));
    };

    this.wallet.on('transfer:claimed', handler);

    // Return unsubscribe function
    return () => {
      if (this.wallet) {
        this.wallet.off('transfer:claimed', handler);
      }
    };
  }

  /**
   * Subscribe to connection status changes
   * @param {Function} onConnect - () => void
   * @param {Function} onDisconnect - (reason: string) => void
   * @returns {Function} Unsubscribe function
   */
  onConnectionChange(onConnect, onDisconnect) {
    this._ensureConnected();

    if (onConnect) {
      this.wallet.on('stream:connected', onConnect);
    }
    if (onDisconnect) {
      this.wallet.on('stream:disconnected', onDisconnect);
    }

    return () => {
      if (this.wallet) {
        if (onConnect) this.wallet.off('stream:connected', onConnect);
        if (onDisconnect) this.wallet.off('stream:disconnected', onDisconnect);
      }
    };
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
