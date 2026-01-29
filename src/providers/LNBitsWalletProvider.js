/**
 * LNBitsWalletProvider - LNBits direct API implementation
 *
 * Connects directly to an LNBits server using wallet ID and admin key.
 * LNBits is a multi-wallet system where each user can have multiple wallets.
 * Each wallet is identified by a unique wallet ID and has its own admin/invoice keys.
 *
 * Required connection data:
 * - serverUrl: The LNBits server URL (e.g., https://legend.lnbits.com)
 * - walletId: The LNBits wallet ID (32-char hex string)
 * - adminKey: The admin API key for full wallet access
 *
 * API Endpoints used:
 * - GET  /api/v1/wallet - Get wallet info and balance
 * - POST /api/v1/payments - Create invoice (out: false) or pay invoice (out: true)
 * - GET  /api/v1/payments/<hash> - Check payment status
 * - GET  /api/v1/payments - List payments
 * - POST /api/v1/payments/decode - Decode invoice
 */

import { WalletProvider } from './WalletProvider';

export class LNBitsWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.serverUrl = walletData.serverUrl;
    this.lnbitsWalletId = walletData.walletId; // LNBits internal wallet ID
    this.adminKey = walletData.adminKey;
    this.metadata = walletData.metadata || {};
    this.walletInfo = null;
  }

  getType() {
    return 'lnbits';
  }

  isSpark() {
    return false;
  }

  /**
   * Make authenticated API request to LNBits
   */
  async _apiRequest(endpoint, options = {}) {
    const url = `${this.serverUrl}${endpoint}`;
    const headers = {
      'X-Api-Key': this.adminKey,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.message || errorText;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}`;
        }
        throw new Error(`LNBits API error: ${errorMessage}`);
      }

      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to reach LNBits server');
      }
      throw error;
    }
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      // Validate connection by fetching wallet info
      const walletInfo = await this._apiRequest('/api/v1/wallet');

      if (!walletInfo || typeof walletInfo.balance === 'undefined') {
        throw new Error('Invalid response from LNBits server');
      }

      this.walletInfo = walletInfo;
      this.isConnected = true;
      this.clearError();
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async disconnect() {
    this.isConnected = false;
    this.walletInfo = null;
  }

  async getBalance() {
    this._ensureConnected();

    try {
      const walletInfo = await this._apiRequest('/api/v1/wallet');

      // LNBits returns balance in millisats, convert to sats
      const balanceMsats = walletInfo.balance || 0;
      const balanceSats = Math.floor(balanceMsats / 1000);

      return {
        balance: balanceSats,
        pending: 0
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getInfo() {
    this._ensureConnected();

    try {
      const walletInfo = await this._apiRequest('/api/v1/wallet');
      this.walletInfo = walletInfo;

      return {
        alias: walletInfo.name || this.walletData.name || 'LNBits Wallet',
        color: '#FF1FE1', // LNBits magenta
        pubkey: null,
        lightningAddress: null,
        network: 'mainnet',
        type: 'lnbits',
        walletId: walletInfo.id
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async createInvoice({ amount, description, expiry = 3600 }) {
    this._ensureConnected();

    try {
      const payload = {
        out: false,
        amount: amount,
        memo: description || 'BuhoGO Payment',
        expiry: expiry
      };

      const response = await this._apiRequest('/api/v1/payments', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!response || !response.payment_request) {
        throw new Error('Invalid invoice response from LNBits');
      }

      return {
        paymentRequest: response.payment_request,
        paymentHash: response.payment_hash,
        expiresAt: null // LNBits doesn't return expiry timestamp directly
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async payInvoice({ invoice, maxFee }) {
    this._ensureConnected();

    try {
      const payload = {
        out: true,
        bolt11: invoice
      };

      const response = await this._apiRequest('/api/v1/payments', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!response) {
        throw new Error('Payment failed: No response from LNBits');
      }

      // Check payment status
      const paymentHash = response.payment_hash;
      let status = 'pending';
      let preimage = response.preimage || null;
      let fee = 0;

      // Try to get payment details for more info
      try {
        const paymentDetails = await this._apiRequest(`/api/v1/payments/${paymentHash}`);
        if (paymentDetails) {
          // LNBits uses status string: "pending", "success", "failed"
          status = this._parsePaymentStatus(paymentDetails.status, paymentDetails.pending);
          preimage = paymentDetails.preimage || preimage;
          fee = paymentDetails.fee ? Math.floor(Math.abs(paymentDetails.fee) / 1000) : 0;
        }
      } catch (e) {
        // If we can't get details, check if payment response indicates success
        if (response.preimage) {
          status = 'completed';
        }
      }

      return {
        preimage: preimage,
        fee: fee,
        status: status,
        paymentHash: paymentHash
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    try {
      const response = await this._apiRequest(`/api/v1/payments/${paymentHash}`);

      if (!response) {
        return { paid: false };
      }

      // LNBits uses status string: "pending", "success", "failed"
      const status = this._parsePaymentStatus(response.status, response.pending);
      const isPaid = status === 'completed';

      return {
        paid: isPaid,
        preimage: response.preimage || null,
        amount: response.amount ? Math.floor(Math.abs(response.amount) / 1000) : 0
      };
    } catch (error) {
      // Payment not found or error - assume not paid
      console.warn('lookupInvoice error:', error.message);
      return { paid: false };
    }
  }

  async getTransactions({ limit = 50, offset = 0 } = {}) {
    this._ensureConnected();

    try {
      // LNBits payments endpoint with pagination
      const response = await this._apiRequest(`/api/v1/payments?limit=${limit}&offset=${offset}`);

      if (!response || !Array.isArray(response)) {
        return [];
      }

      return response.map(tx => ({
        id: tx.payment_hash || tx.checking_id,
        type: tx.amount > 0 ? 'receive' : 'send',
        amount: Math.floor(Math.abs(tx.amount) / 1000), // Convert msats to sats
        timestamp: this._parseTimestamp(tx.time || tx.created_at),
        description: tx.memo || '',
        status: this._parsePaymentStatus(tx.status, tx.pending),
        fee: tx.fee ? Math.floor(Math.abs(tx.fee) / 1000) : 0
      }));
    } catch (error) {
      console.warn('getTransactions error:', error.message);
      return [];
    }
  }

  /**
   * Parse LNBits timestamp to Unix seconds
   * LNBits can return time as:
   * - Unix timestamp in seconds (integer)
   * - Unix timestamp in milliseconds (integer)
   * - Unix timestamp in microseconds (integer) - common in Python
   * - ISO datetime string
   * - Numeric string
   *
   * Returns: Unix timestamp in seconds (to match other providers)
   */
  _parseTimestamp(time) {
    if (!time) return null;

    // If it's a string, try to parse it
    if (typeof time === 'string') {
      // Check if it's a numeric string
      const numValue = Number(time);
      if (!isNaN(numValue) && time.trim() !== '') {
        return this._parseTimestamp(numValue);
      }

      // Try parsing as ISO datetime string
      const parsed = Date.parse(time);
      if (!isNaN(parsed)) {
        // Date.parse returns milliseconds, convert to seconds
        return Math.floor(parsed / 1000);
      }

      return null;
    }

    // If it's a number, determine the unit and convert to seconds
    if (typeof time === 'number') {
      // Thresholds for year 2100 in different units
      const MAX_SECONDS = 4102444800;           // Year 2100 in seconds
      const MAX_MILLISECONDS = 4102444800000;   // Year 2100 in milliseconds
      const MAX_MICROSECONDS = 4102444800000000; // Year 2100 in microseconds

      // Sanity check: timestamp should be positive
      if (time <= 0) return null;

      // If in seconds range (reasonable timestamps: 1970-2100)
      if (time < MAX_SECONDS) {
        return Math.floor(time);
      }

      // If in milliseconds range - convert to seconds
      if (time < MAX_MILLISECONDS) {
        return Math.floor(time / 1000);
      }

      // If in microseconds range (common in Python/LNBits) - convert to seconds
      if (time < MAX_MICROSECONDS) {
        return Math.floor(time / 1000000);
      }

      // If in nanoseconds range - convert to seconds
      return Math.floor(time / 1000000000);
    }

    // If it's a Date object - convert to seconds
    if (time instanceof Date) {
      return Math.floor(time.getTime() / 1000);
    }

    return null;
  }

  /**
   * Parse LNBits payment status
   * LNBits returns status as string: "pending", "success", "failed"
   * Some older versions may return a boolean 'pending' field
   */
  _parsePaymentStatus(status, pendingFallback) {
    // Handle string status (current LNBits format)
    if (typeof status === 'string') {
      const statusLower = status.toLowerCase();
      if (statusLower === 'success' || statusLower === 'completed') {
        return 'completed';
      }
      if (statusLower === 'failed') {
        return 'failed';
      }
      return 'pending';
    }

    // Fallback to boolean pending field (older format)
    if (typeof pendingFallback === 'boolean') {
      return pendingFallback ? 'pending' : 'completed';
    }

    return 'completed';
  }

  /**
   * Decode a Lightning invoice
   * @param {string} invoice - BOLT11 invoice
   * @returns {Promise<Object>} Decoded invoice data
   */
  async decodeInvoice(invoice) {
    this._ensureConnected();

    try {
      const response = await this._apiRequest('/api/v1/payments/decode', {
        method: 'POST',
        body: JSON.stringify({ data: invoice })
      });

      return response;
    } catch (error) {
      console.warn('decodeInvoice error:', error.message);
      throw error;
    }
  }

  /**
   * Validate LNBits connection credentials
   * @param {string} serverUrl - LNBits server URL
   * @param {string} walletId - Wallet ID
   * @param {string} adminKey - Admin API key
   * @returns {Promise<Object>} Wallet info if valid
   */
  static async validateCredentials(serverUrl, walletId, adminKey) {
    // Normalize server URL
    let normalizedUrl = serverUrl.trim();
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    // Ensure HTTPS (except for localhost)
    if (!normalizedUrl.startsWith('http://localhost') &&
        !normalizedUrl.startsWith('https://')) {
      if (normalizedUrl.startsWith('http://')) {
        normalizedUrl = normalizedUrl.replace('http://', 'https://');
      } else {
        normalizedUrl = 'https://' + normalizedUrl;
      }
    }

    try {
      const response = await fetch(`${normalizedUrl}/api/v1/wallet`, {
        headers: {
          'X-Api-Key': adminKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key');
        } else if (response.status === 404) {
          throw new Error('LNBits API not found at this URL');
        }
        throw new Error(`Server returned ${response.status}`);
      }

      const walletInfo = await response.json();

      if (typeof walletInfo.balance === 'undefined') {
        throw new Error('Invalid response from server');
      }

      // Verify wallet ID matches
      if (walletId && walletInfo.id !== walletId) {
        throw new Error(`Wallet ID mismatch. Expected ${walletId}, got ${walletInfo.id}. The admin key belongs to a different wallet.`);
      }

      return {
        valid: true,
        serverUrl: normalizedUrl,
        walletInfo: {
          name: walletInfo.name || 'LNBits Wallet',
          balance: Math.floor(walletInfo.balance / 1000),
          id: walletInfo.id
        }
      };
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Unable to reach server. Check the URL and try again.');
      }
      throw error;
    }
  }

  // ==========================================
  // Private helper methods
  // ==========================================

  _ensureConnected() {
    if (!this.isConnected) {
      throw new Error('LNBits wallet is not connected');
    }
  }
}

export default LNBitsWalletProvider;
