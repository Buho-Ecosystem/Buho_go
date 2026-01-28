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
import { Invoice } from '@getalby/lightning-tools';
import { fiatRatesService } from '../utils/fiatRates.js';

/**
 * Payment status constants matching SDK statuses
 */
const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Bitcoin L1 constants
 */
const BITCOIN_L1 = {
  // Number of confirmations required before a deposit can be claimed
  REQUIRED_CONFIRMATIONS: 3,
  // Minimum deposit amount in satoshis
  MIN_DEPOSIT_SATS: 500,
  // Default mempool API fallback
  DEFAULT_MEMPOOL_API: 'https://mempool.space/api',
  // Typical withdrawal transaction size in vBytes
  // P2WPKH input (~68 vB) + P2WPKH output (~31 vB) + overhead (~10 vB) ≈ 110 vB
  // Adding buffer for potential change output: ~140 vB typical
  TYPICAL_TX_VBYTES: 140
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
   * Calculate recommended max fee for Lightning payments
   * Uses a generous margin to account for routing fees
   * @param {number} amountSats - Payment amount in satoshis
   * @returns {number} Recommended max fee in satoshis
   */
  static calculateRecommendedFee(amountSats) {
    const minFee = 10; // Minimum 10 sats
    const percentFee = Math.ceil(amountSats * 0.01); // 1% of amount
    return Math.max(minFee, percentFee);
  }

  /**
   * Decode a BOLT11 invoice and extract its amount
   * Returns null if invoice has no amount (zero-amount invoice)
   * @param {string} invoice - BOLT11 encoded invoice
   * @returns {{ amount: number|null, isZeroAmount: boolean }}
   */
  static decodeInvoiceAmount(invoice) {
    try {
      const cleanInvoice = invoice.replace(/^lightning:/i, '');
      const decoded = new Invoice({ pr: cleanInvoice });
      const amount = decoded.satoshi || 0;
      return {
        amount: amount > 0 ? amount : null,
        isZeroAmount: amount === 0
      };
    } catch (error) {
      // If decoding fails, assume it has an amount to be safe
      // (passing amountSats for a fixed-amount invoice causes errors)
      console.warn('Invoice decode failed, assuming fixed amount:', error.message);
      return { amount: null, isZeroAmount: false };
    }
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
   * @param {number} [options.amountSats] - Amount for zero-amount invoices (auto-detected, only used if invoice has no amount)
   * @returns {Promise<{id: string, preimage: string, fee: number, status: string}>}
   */
  async payInvoice({ invoice, maxFee, preferSpark = false, amountSats = null }) {
    this._ensureConnected();

    try {
      // Decode invoice to check if it's a zero-amount invoice
      // This prevents errors from passing amountSats to fixed-amount invoices
      const invoiceInfo = SparkWalletProvider.decodeInvoiceAmount(invoice);
      const invoiceAmount = invoiceInfo.amount || amountSats || 10000;

      // Get actual fee estimate from SDK first
      let effectiveMaxFee = maxFee;

      if (!effectiveMaxFee) {
        try {
          const feeEstimate = await this.getLightningSendFeeEstimate(invoice, amountSats);
          // Use estimated fee + 50% buffer to ensure payment succeeds
          effectiveMaxFee = Math.ceil(feeEstimate.estimatedFeeSats * 1.5);
        } catch {
          // Fallback to calculated fee if estimate fails
          effectiveMaxFee = SparkWalletProvider.calculateRecommendedFee(invoiceAmount);
        }
      }

      // Ensure minimum fee of 10 sats
      effectiveMaxFee = Math.max(effectiveMaxFee, 10);

      // Build payment parameters
      const paymentParams = {
        invoice: invoice,
        maxFeeSats: effectiveMaxFee,
        preferSpark: preferSpark
      };

      // ONLY add amount for verified zero-amount invoices
      // Passing amountSatsToSend for fixed-amount invoices causes SDK error
      if (invoiceInfo.isZeroAmount && amountSats && amountSats > 0) {
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
   * @param {number} [amountSats] - Amount in sats (required for zero-amount invoices)
   * @returns {Promise<{estimatedFeeSats: number, invoice: string}>}
   */
  async getLightningSendFeeEstimate(invoice, amountSats = null) {
    this._ensureConnected();

    try {
      // Build estimate params
      const estimateParams = { encodedInvoice: invoice };

      // Add amount for zero-amount invoices (required by SDK)
      if (amountSats && amountSats > 0) {
        estimateParams.amountSats = amountSats;
      }

      const estimate = await this.wallet.getLightningSendFeeEstimate(estimateParams);

      return {
        estimatedFeeSats: estimate?.feeSats || estimate?.estimatedFeeSats || 0,
        invoice: invoice
      };
    } catch (error) {
      // If fee estimation fails, return a calculated estimate based on recommendation
      console.warn('Fee estimation failed, using calculated estimate:', error.message);

      // Decode invoice to get actual amount for better fallback
      const invoiceInfo = SparkWalletProvider.decodeInvoiceAmount(invoice);
      const fallbackAmount = invoiceInfo.amount || amountSats || 10000;
      const fallbackFee = SparkWalletProvider.calculateRecommendedFee(fallbackAmount);

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
      // Use & if callback already has query params, otherwise use ?
      const separator = lnurlData.callback.includes('?') ? '&' : '?';
      let callbackUrl = `${lnurlData.callback}${separator}amount=${amountMs}`;

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

      // Pay the invoice - DO NOT pass amountSats because LNURL invoices
      // already have the amount encoded. Passing it causes SDK error:
      // "User can only specify amountSatsToSend for 0 amount lightning invoice"
      const result = await this.payInvoice({
        invoice: invoiceData.pr,
        // amountSats intentionally omitted - invoice already has amount
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
  // L1 Bitcoin Methods (Deposits & Withdrawals)
  // ==========================================

  /**
   * Get static Bitcoin deposit address (reusable P2TR address)
   * This address can be used multiple times to receive on-chain Bitcoin
   * @returns {Promise<string>} Bitcoin deposit address (bc1p...)
   */
  async getL1DepositAddress() {
    this._ensureConnected();

    // Return cached address if available
    if (this._cachedL1Address) {
      return this._cachedL1Address;
    }

    try {
      this._cachedL1Address = await this.wallet.getStaticDepositAddress();
      return this._cachedL1Address;
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Get pending Bitcoin deposits at the deposit address
   * Returns UTXOs that can be claimed once confirmed
   * @returns {Promise<Array<{txId: string, outputIndex: number, amount: number, confirmations: number, confirmed: boolean}>>}
   * @throws {Error} If unable to fetch from any mempool API
   */
  async getPendingDeposits() {
    this._ensureConnected();

    const address = await this.getL1DepositAddress();

    // Determine API URLs to try
    const customUrl = fiatRatesService.getApiUrl().replace(/\/+$/, '').replace(/\/v1$/, '');
    const fallbackUrl = BITCOIN_L1.DEFAULT_MEMPOOL_API;
    const urlsToTry = customUrl !== fallbackUrl
      ? [customUrl, fallbackUrl]
      : [fallbackUrl];

    let utxos = null;
    let usedBaseUrl = null;
    let lastError = null;

    // Try each URL until one succeeds
    for (const baseUrl of urlsToTry) {
      try {
        const response = await fetch(`${baseUrl}/address/${address}/utxo`);
        if (response.ok) {
          utxos = await response.json();
          usedBaseUrl = baseUrl;
          break;
        }
      } catch (e) {
        lastError = e;
      }
    }

    // If all APIs failed, log error but return empty (graceful degradation)
    if (utxos === null) {
      console.error('[L1 Deposit] Failed to fetch UTXOs from mempool API:', lastError?.message || 'Unknown error');
      // Return empty array rather than throwing to avoid breaking UI
      return [];
    }

    // No deposits found (this is different from API error)
    if (utxos.length === 0) {
      return [];
    }

    // Get current block height for confirmation calculation
    let currentHeight = 0;
    try {
      const heightResponse = await fetch(`${usedBaseUrl}/blocks/tip/height`);
      if (heightResponse.ok) {
        currentHeight = await heightResponse.json();
      }
    } catch (e) {
      console.warn('[L1 Deposit] Could not fetch block height, confirmations may be inaccurate');
    }

    // Map to deposit format with proper confirmation status
    const requiredConfirmations = BITCOIN_L1.REQUIRED_CONFIRMATIONS;
    const deposits = utxos.map(utxo => {
      let confirmations = 0;
      if (utxo.status?.confirmed && utxo.status?.block_height && currentHeight) {
        confirmations = currentHeight - utxo.status.block_height + 1;
      }

      return {
        txId: utxo.txid,
        outputIndex: utxo.vout,
        amount: utxo.value,
        confirmations,
        confirmed: confirmations >= requiredConfirmations
      };
    });

    return deposits;
  }

  /**
   * Get fee quote for claiming a Bitcoin deposit (Step 1 of two-step claiming)
   * Call this before claimDeposit() to show user the fee
   * @param {string} txId - Transaction ID of the deposit
   * @param {number} outputIndex - Output index (default 0)
   * @returns {Promise<{feeAmount: number, feeQuoteId: string, expiresAt: number}>}
   */
  async getClaimFeeQuote(txId, outputIndex = 0) {
    this._ensureConnected();

    try {
      // SDK: getClaimStaticDepositQuote(transactionId, outputIndex)
      // Returns: { transactionId, outputIndex, network, creditAmountSats, signature }
      const quote = await this.wallet.getClaimStaticDepositQuote(txId, outputIndex);

      return {
        creditAmountSats: Number(quote.creditAmountSats || 0),
        signature: quote.signature, // This is the sspSignature needed for claiming
        transactionId: quote.transactionId,
        outputIndex: quote.outputIndex
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Claim a Bitcoin deposit using quote data
   * @param {string} txId - Transaction ID of the deposit
   * @param {object} quoteData - Quote data from getClaimFeeQuote()
   * @param {number} outputIndex - Output index (default 0)
   * @returns {Promise<{success: boolean, amount: number}>}
   */
  async claimDeposit(txId, quoteData, outputIndex = 0) {
    this._ensureConnected();

    try {
      // SDK: claimStaticDeposit({ transactionId, creditAmountSats, sspSignature, outputIndex })
      const result = await this.wallet.claimStaticDeposit({
        transactionId: txId,
        outputIndex: outputIndex,
        creditAmountSats: quoteData.creditAmountSats,
        sspSignature: quoteData.signature
      });

      return {
        success: true,
        amount: Number(result.creditAmountSats || result.amount || 0)
      };
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';

      // TRANSFER_LOCKED means the claim is already being processed (race condition with background stream)
      // This is not a failure - the claim will complete successfully
      if (errorMsg.includes('transfer_locked') || errorMsg.includes('leaf') && errorMsg.includes('locked')) {
        console.log('Claim already in progress (TRANSFER_LOCKED), will complete shortly');
        return {
          success: true,
          processing: true,
          amount: Number(quoteData.creditAmountSats || 0)
        };
      }

      // Provide friendly error messages
      if (errorMsg.includes('fee')) {
        throw new Error('Claim fee has changed. Please try again.');
      }
      if (errorMsg.includes('confirm')) {
        throw new Error('Deposit needs more confirmations. Please wait.');
      }
      this.setError(error);
      throw error;
    }
  }

  /**
   * Fetch recommended fee rates from mempool.space API
   * @returns {Promise<{fastestFee: number, halfHourFee: number, hourFee: number, economyFee: number, minimumFee: number}>}
   */
  async _fetchMempoolFeeRates() {
    const apiUrl = fiatRatesService.getApiUrl();
    // Handle both /api/v1 and /api formats
    const baseUrl = apiUrl.replace(/\/v1$/, '');

    try {
      const response = await fetch(`${baseUrl}/v1/fees/recommended`);
      if (!response.ok) {
        throw new Error(`Mempool API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('Failed to fetch mempool fees, using fallback:', error.message);
      // Fallback to default mempool.space if custom API fails
      if (apiUrl !== 'https://mempool.space/api/v1') {
        const fallbackResponse = await fetch('https://mempool.space/api/v1/fees/recommended');
        if (fallbackResponse.ok) {
          return await fallbackResponse.json();
        }
      }
      throw error;
    }
  }

  /**
   * Get fee quote for L1 Bitcoin withdrawal
   * Returns fees for slow/medium/fast speeds with breakdown
   * Fetches real-time fee rates from mempool.space API
   * @param {number} amountSats - Amount to withdraw in satoshis
   * @param {string} destinationAddress - Bitcoin address to withdraw to
   * @returns {Promise<{slow: Object, medium: Object, fast: Object, expiresAt: number}>}
   */
  async getWithdrawalFeeQuote(amountSats, destinationAddress) {
    this._ensureConnected();

    if (!this._isValidBitcoinAddress(destinationAddress)) {
      throw new Error('Invalid Bitcoin address');
    }

    try {
      // Fetch both Spark quote and mempool fee rates in parallel
      const [quote, mempoolFees] = await Promise.all([
        this.wallet.getWithdrawalFeeQuote({
          amountSats: amountSats,
          withdrawalAddress: destinationAddress
        }),
        this._fetchMempoolFeeRates()
      ]);

      // Calculate network fees based on mempool fee rates
      // Fee = fee_rate (sat/vB) * transaction_size (vB)
      const txSize = BITCOIN_L1.TYPICAL_TX_VBYTES;
      const networkFees = {
        slow: Math.ceil(mempoolFees.hourFee * txSize),
        medium: Math.ceil(mempoolFees.halfHourFee * txSize),
        fast: Math.ceil(mempoolFees.fastestFee * txSize)
      };

      // Build user-friendly fee structure with breakdown
      const buildFeeInfo = (speedQuote, networkFee, timeEstimate, feeRate) => ({
        serviceFee: Number(speedQuote?.userFee || 0),
        networkFee: networkFee,
        totalFee: Number(speedQuote?.userFee || 0) + networkFee,
        feeQuoteId: quote.feeQuoteId || quote.id,
        timeEstimate: timeEstimate,
        feeRate: feeRate // sat/vB for display
      });

      return {
        slow: buildFeeInfo(quote.slow, networkFees.slow, '~1 hour', mempoolFees.hourFee),
        medium: buildFeeInfo(quote.medium, networkFees.medium, '~30 min', mempoolFees.halfHourFee),
        fast: buildFeeInfo(quote.fast, networkFees.fast, 'Next block', mempoolFees.fastestFee),
        expiresAt: quote.expiry ? Math.floor(new Date(quote.expiry).getTime() / 1000) : Date.now() / 1000 + 60
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Withdraw to L1 Bitcoin address
   * @param {Object} options - Withdrawal options
   * @param {number} options.amountSats - Amount to withdraw in satoshis
   * @param {string} options.destinationAddress - Bitcoin address to withdraw to
   * @param {string} options.speed - Speed: 'SLOW', 'MEDIUM', or 'FAST'
   * @param {string} options.feeQuoteId - Fee quote ID from getWithdrawalFeeQuote()
   * @returns {Promise<{requestId: string, status: string, amount: number}>}
   */
  async withdrawToL1({ amountSats, destinationAddress, speed = 'MEDIUM', feeQuoteId }) {
    this._ensureConnected();

    if (!this._isValidBitcoinAddress(destinationAddress)) {
      throw new Error('Invalid Bitcoin address');
    }

    try {
      const result = await this.wallet.withdraw({
        amountSats: amountSats,
        withdrawalAddress: destinationAddress,
        speed: speed.toUpperCase(),
        feeQuoteId: feeQuoteId
      });

      return {
        requestId: result.id,
        status: 'pending',
        amount: amountSats
      };
    } catch (error) {
      // Provide friendly error messages
      if (error.message?.toLowerCase().includes('balance')) {
        throw new Error('Insufficient balance for this withdrawal');
      }
      if (error.message?.toLowerCase().includes('quote')) {
        throw new Error('Fee quote expired. Please try again.');
      }
      this.setError(error);
      throw error;
    }
  }

  /**
   * Check withdrawal status
   * @param {string} requestId - Withdrawal request ID from withdrawToL1()
   * @returns {Promise<{id: string, status: string, txId: string|null, completedAt: number|null}>}
   */
  async getWithdrawalStatus(requestId) {
    this._ensureConnected();

    try {
      const request = await this.wallet.getCoopExitRequest(requestId);

      return {
        id: request.id,
        status: this._normalizeWithdrawalStatus(request.status),
        txId: request.l1TxId || null,
        completedAt: request.completedAt ? Math.floor(new Date(request.completedAt).getTime() / 1000) : null
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Normalize withdrawal status to user-friendly format
   */
  _normalizeWithdrawalStatus(status) {
    if (!status) return 'pending';
    const statusStr = String(status).toUpperCase();

    if (statusStr.includes('COMPLETED') || statusStr.includes('FINALIZED')) {
      return 'completed';
    }
    if (statusStr.includes('FAILED') || statusStr.includes('ERROR')) {
      return 'failed';
    }
    if (statusStr.includes('BROADCAST')) {
      return 'broadcasting';
    }
    return 'pending';
  }

  /**
   * Validate Bitcoin address format
   * Supports mainnet (bc1, 1, 3) and testnet (tb1, m, n, 2)
   */
  _isValidBitcoinAddress(address) {
    if (!address || typeof address !== 'string') return false;

    // Mainnet: bc1 (bech32), 1 (P2PKH), 3 (P2SH)
    // Testnet: tb1 (bech32), m/n (P2PKH), 2 (P2SH)
    const mainnetRegex = /^(bc1[a-zA-HJ-NP-Z0-9]{39,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
    const testnetRegex = /^(tb1[a-zA-HJ-NP-Z0-9]{39,62}|[mn2][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

    return mainnetRegex.test(address) || testnetRegex.test(address);
  }

  /**
   * Get the user's configured mempool explorer URL
   * Uses fiatRatesService which stores custom mempool URL from Settings
   * @returns {string} Base URL like https://mempool.space
   */
  getMempoolExplorerUrl() {
    const apiUrl = fiatRatesService.getApiUrl(); // e.g. https://mempool.space/api/v1
    // Strip /api/v1 suffix to get base URL
    return apiUrl.replace(/\/api\/v1\/?$/, '');
  }

  /**
   * Refund a deposit back to the original sender
   * Use when claim fee is too high relative to deposit amount
   *
   * UI: Exposed via TransactionHistory.vue claim dialog "Return to sender" option
   *
   * @param {string} txId - Transaction ID of the deposit
   * @param {number} outputIndex - Output index (default 0)
   * @returns {Promise<{success: boolean, txId: string|null}>}
   */
  async refundDeposit(txId, outputIndex = 0) {
    this._ensureConnected();

    try {
      const result = await this.wallet.refundAndBroadcastStaticDeposit({
        transactionId: txId,
        outputIndex: outputIndex
      });

      return {
        success: true,
        txId: result.l1TxId || result.txId || null
      };
    } catch (error) {
      // Provide friendly error messages
      if (error.message?.toLowerCase().includes('not found')) {
        throw new Error('Deposit not found or already claimed');
      }
      if (error.message?.toLowerCase().includes('confirm')) {
        throw new Error('Deposit needs more confirmations');
      }
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
