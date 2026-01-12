/**
 * WalletProvider - Abstract base class for wallet implementations
 *
 * This provides a unified interface for both Spark and NWC wallets.
 * All wallet providers must implement these methods.
 */

export class WalletProvider {
  constructor(walletId, walletData) {
    if (this.constructor === WalletProvider) {
      throw new Error('WalletProvider is an abstract class and cannot be instantiated directly');
    }

    this.walletId = walletId;
    this.walletData = walletData;
    this.isConnected = false;
    this.connectionError = null;
  }

  /**
   * Get the wallet type identifier
   * @returns {string} 'spark' or 'nwc'
   */
  getType() {
    throw new Error('getType() must be implemented by subclass');
  }

  /**
   * Initialize and connect to the wallet
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  /**
   * Disconnect and cleanup wallet connections
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  /**
   * Get wallet balance
   * @returns {Promise<{balance: number, pending?: number}>} Balance in sats
   */
  async getBalance() {
    throw new Error('getBalance() must be implemented by subclass');
  }

  /**
   * Get wallet info (alias, color, pubkey, etc.)
   * @returns {Promise<{alias?: string, color?: string, pubkey?: string, lightningAddress?: string}>}
   */
  async getInfo() {
    throw new Error('getInfo() must be implemented by subclass');
  }

  /**
   * Create a Lightning invoice
   * @param {Object} params
   * @param {number} params.amount - Amount in sats
   * @param {string} [params.description] - Invoice description
   * @param {number} [params.expiry] - Expiry in seconds
   * @returns {Promise<{paymentRequest: string, paymentHash: string, expiresAt?: number}>}
   */
  async createInvoice({ amount, description, expiry }) {
    throw new Error('createInvoice() must be implemented by subclass');
  }

  /**
   * Pay a Lightning invoice
   * @param {Object} params
   * @param {string} params.invoice - Lightning invoice (BOLT11)
   * @param {number} [params.maxFee] - Maximum fee in sats
   * @returns {Promise<{preimage: string, fee?: number, status: string}>}
   */
  async payInvoice({ invoice, maxFee }) {
    throw new Error('payInvoice() must be implemented by subclass');
  }

  /**
   * Look up an invoice by payment hash
   * @param {string} paymentHash
   * @returns {Promise<{paid: boolean, preimage?: string, amount?: number}>}
   */
  async lookupInvoice(paymentHash) {
    throw new Error('lookupInvoice() must be implemented by subclass');
  }

  /**
   * Get transaction history
   * @param {Object} [params]
   * @param {number} [params.limit] - Max number of transactions
   * @param {number} [params.offset] - Offset for pagination
   * @returns {Promise<Array<{id: string, type: string, amount: number, timestamp: number, description?: string, status: string}>>}
   */
  async getTransactions({ limit, offset } = {}) {
    throw new Error('getTransactions() must be implemented by subclass');
  }

  // ==========================================
  // Spark-specific methods (optional for NWC)
  // ==========================================

  /**
   * Check if this is a Spark wallet
   * @returns {boolean}
   */
  isSpark() {
    return false;
  }

  /**
   * Get Spark address (Spark wallets only)
   * @returns {Promise<string|null>}
   */
  async getSparkAddress() {
    return null;
  }

  /**
   * Transfer to Spark address (Spark wallets only)
   * @param {Object} params
   * @param {string} params.sparkAddress - Recipient Spark address (sp1... or tsp1...)
   * @param {number} params.amount - Amount in sats
   * @returns {Promise<{id: string, status: string}>}
   */
  async transferToSparkAddress({ sparkAddress, amount }) {
    throw new Error('Spark-to-Spark transfers are only available for Spark wallets');
  }

  /**
   * Check if a string is a valid Spark address
   * @param {string} address
   * @returns {boolean}
   */
  static isSparkAddress(address) {
    if (!address || typeof address !== 'string') return false;
    const normalized = address.toLowerCase().trim();
    return normalized.startsWith('sp1') || normalized.startsWith('tsp1');
  }

  // ==========================================
  // Utility methods
  // ==========================================

  /**
   * Get connection status
   * @returns {{connected: boolean, error: string|null}}
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      error: this.connectionError
    };
  }

  /**
   * Set connection error
   * @param {Error|string} error
   */
  setError(error) {
    this.connectionError = error instanceof Error ? error.message : error;
    this.isConnected = false;
  }

  /**
   * Clear connection error
   */
  clearError() {
    this.connectionError = null;
  }
}

export default WalletProvider;
