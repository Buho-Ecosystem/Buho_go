/**
 * NWCWalletProvider - Nostr Wallet Connect implementation
 *
 * Wraps @getalby/sdk NostrWebLNProvider to match the WalletProvider interface.
 * Maintains backward compatibility with existing NWC functionality.
 *
 * Features:
 * - Real-time payment notifications via subscribeNotifications (Alby SDK v7)
 * - Polling fallback for wallets that don't support notifications
 * - Comprehensive payment status detection
 */

import { WalletProvider } from './WalletProvider';
import { NostrWebLNProvider, NWCClient } from '@getalby/sdk';

export class NWCWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.nwc = null;
    this.nwcClient = null; // For notification subscriptions
    this.nwcUrl = walletData.nwcUrl;
    this.metadata = walletData.metadata || {};
  }

  getType() {
    return 'nwc';
  }

  isSpark() {
    return false;
  }

  async connect() {
    if (this.nwc && this.isConnected) {
      return;
    }

    try {
      this.nwc = new NostrWebLNProvider({
        nostrWalletConnectUrl: this.nwcUrl,
      });

      // Enable with retry logic
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        try {
          await this.nwc.enable();
          break;
        } catch (error) {
          lastError = error;
          retries--;
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      if (retries === 0 && lastError) {
        throw lastError;
      }

      // Also create NWCClient for notification subscriptions (Alby SDK v7)
      try {
        this.nwcClient = new NWCClient({
          nostrWalletConnectUrl: this.nwcUrl
        });
      } catch (e) {
        // NWCClient is optional - notifications won't work but polling will
        console.warn('NWCClient creation failed (notifications unavailable):', e.message);
        this.nwcClient = null;
      }

      this.isConnected = true;
      this.clearError();
    } catch (error) {
      this.setError(error);
      this.nwc = null;
      this.nwcClient = null;
      throw error;
    }
  }

  async disconnect() {
    if (this.nwc) {
      try {
        if (typeof this.nwc.close === 'function') {
          this.nwc.close();
        }
      } catch (error) {
        console.warn('Error closing NWC connection:', error);
      }
    }

    if (this.nwcClient) {
      try {
        if (typeof this.nwcClient.close === 'function') {
          this.nwcClient.close();
        }
      } catch (error) {
        console.warn('Error closing NWCClient:', error);
      }
    }

    this.nwc = null;
    this.nwcClient = null;
    this.isConnected = false;
  }

  async getBalance() {
    this._ensureConnected();

    try {
      const response = await this.nwc.getBalance();

      return {
        balance: response.balance || 0,
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
      const info = await this.nwc.getInfo();

      // Extract lightning address from NWC URL if not in info
      let lightningAddress = info.lud16 || this.metadata.lud16;
      if (!lightningAddress && this.nwcUrl) {
        try {
          const url = new URL(this.nwcUrl.replace('nostr+walletconnect://', 'http://'));
          const lud16 = url.searchParams.get('lud16');
          if (lud16 && lud16 !== 'null') {
            lightningAddress = lud16;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      return {
        alias: info.alias || this.walletData.name || 'NWC Wallet',
        color: info.color || '#15DE72',
        pubkey: info.pubkey || null,
        lightningAddress: lightningAddress,
        methods: info.methods || [],
        network: info.network || 'mainnet',
        type: 'nwc'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async createInvoice({ amount, description, expiry = 3600 }) {
    this._ensureConnected();

    try {
      const invoice = await this.nwc.makeInvoice({
        amount: amount,
        description: description || 'BuhoGO Payment',
        expiry: expiry
      });

      const paymentRequest = invoice.paymentRequest || invoice.payment_request;
      if (!paymentRequest) {
        throw new Error('Invalid invoice: missing payment request');
      }

      return {
        paymentRequest: paymentRequest,
        paymentHash: invoice.payment_hash || invoice.paymentHash,
        expiresAt: invoice.expires_at || invoice.expiresAt
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async payInvoice({ invoice, maxFee }) {
    this._ensureConnected();

    try {
      const payment = await this.nwc.sendPayment(invoice);

      return {
        preimage: payment.preimage,
        fee: payment.fees_paid || payment.feesPaid || 0,
        status: 'completed'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Check if a payment/invoice record indicates payment was received
   * Handles various response formats from different NWC wallet implementations
   * @param {Object} record - Invoice or transaction record
   * @returns {boolean}
   * @private
   */
  _checkIfPaid(record) {
    if (!record) return false;

    // Alby SDK v7 uses 'state' field with lowercase values
    if (record.state === 'settled') return true;
    if (record.state === 'SETTLED') return true;

    // Legacy/fallback checks for different wallet implementations
    if (record.settled === true) return true;
    if (record.paid === true) return true;

    // Status field variants
    if (record.status === 'SETTLED' || record.status === 'settled') return true;
    if (record.status === 'complete' || record.status === 'completed') return true;

    // settled_at timestamp (camelCase and snake_case)
    if (typeof record.settled_at === 'number' && record.settled_at > 0) return true;
    if (typeof record.settledAt === 'number' && record.settledAt > 0) return true;

    // Preimage presence indicates payment was received
    if (record.preimage && record.preimage.length > 0) return true;

    return false;
  }

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    // Try direct lookupInvoice first (NIP-47)
    try {
      const invoice = await this.nwc.lookupInvoice({
        payment_hash: paymentHash
      });

      if (invoice) {
        return {
          paid: this._checkIfPaid(invoice),
          preimage: invoice.preimage || null,
          amount: invoice.amount || 0
        };
      }
    } catch (lookupError) {
      // lookupInvoice not supported, try fallback
      console.warn('lookupInvoice not supported, trying fallback:', lookupError.message);
    }

    // Fallback: search in recent transactions with retry
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const txResponse = await this.nwc.listTransactions({
          limit: 100,
          unpaid: false,
          type: 'incoming'
        });

        if (txResponse?.transactions) {
          const found = txResponse.transactions.find(tx =>
            tx.payment_hash === paymentHash ||
            tx.paymentHash === paymentHash
          );

          if (found) {
            return {
              paid: this._checkIfPaid(found),
              preimage: found.preimage || null,
              amount: Math.abs(found.amount || 0)
            };
          }
        }
      } catch (listError) {
        console.warn(`listTransactions attempt ${attempt + 1} failed:`, listError.message);
      }

      // Wait before retry (but not on last attempt)
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Could not determine payment status
    return { paid: false };
  }

  async getTransactions({ limit = 50, offset = 0 } = {}) {
    this._ensureConnected();

    try {
      // NWC may have limited transaction history support
      const transactions = await this.nwc.listTransactions({
        from: offset,
        until: offset + limit,
        limit: limit,
        unpaid: false,
        type: undefined
      });

      if (!transactions || !Array.isArray(transactions.transactions)) {
        return [];
      }

      return transactions.transactions.map(tx => ({
        id: tx.payment_hash || tx.paymentHash || tx.id,
        type: tx.type === 'incoming' || tx.amount > 0 ? 'receive' : 'send',
        amount: Math.abs(tx.amount || 0),
        timestamp: tx.settled_at || tx.settledAt || tx.created_at || tx.createdAt || null,
        description: tx.description || tx.memo || '',
        status: tx.settled ? 'completed' : 'pending',
        fee: tx.fees_paid || tx.feesPaid || 0
      }));
    } catch (error) {
      // Many NWC wallets don't support listTransactions
      console.warn('listTransactions not supported or failed:', error);
      return [];
    }
  }

  // ==========================================
  // NWC-specific methods
  // ==========================================

  /**
   * Subscribe to payment notifications (real-time, no polling needed)
   * Uses Alby SDK v7 built-in subscribeNotifications
   *
   * @param {Function} callback - Called with payment info: { paymentHash, amount, preimage, state, settledAt }
   * @returns {Promise<Function>} Unsubscribe function
   * @throws {Error} If NWCClient is not available
   */
  async subscribeToPaymentNotifications(callback) {
    if (!this.nwcClient) {
      throw new Error('NWCClient not available for notifications');
    }

    const unsubscribe = await this.nwcClient.subscribeNotifications(
      (notification) => {
        // Only handle payment_received notifications
        if (notification.notification_type === 'payment_received') {
          const tx = notification.notification;
          callback({
            paymentHash: tx.payment_hash,
            amount: tx.amount,
            settledAt: tx.settled_at,
            preimage: tx.preimage,
            state: tx.state,
            invoice: tx.invoice
          });
        }
      },
      ['payment_received'] // Filter to only payment_received notifications
    );

    return unsubscribe;
  }

  /**
   * Check if the connected wallet supports real-time notifications
   * @returns {Promise<boolean>}
   */
  async supportsNotifications() {
    if (!this.nwcClient) return false;

    try {
      const info = await this.nwcClient.getInfo();
      // Check if notifications array exists and has items
      return Array.isArray(info.notifications) && info.notifications.length > 0;
    } catch (error) {
      console.warn('Could not check notification support:', error.message);
      return false;
    }
  }

  /**
   * Get the underlying NWC instance for direct access
   * @returns {NostrWebLNProvider|null}
   */
  getNWCInstance() {
    return this.nwc;
  }

  /**
   * Get the NWCClient instance (for notifications)
   * @returns {NWCClient|null}
   */
  getNWCClient() {
    return this.nwcClient;
  }

  /**
   * Get supported NIP-47 methods
   * @returns {Promise<string[]>}
   */
  async getSupportedMethods() {
    this._ensureConnected();

    try {
      const info = await this.nwc.getInfo();
      return info.methods || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if a specific method is supported
   * @param {string} method - NIP-47 method name
   * @returns {Promise<boolean>}
   */
  async supportsMethod(method) {
    const methods = await this.getSupportedMethods();
    return methods.includes(method);
  }

  // ==========================================
  // Private helper methods
  // ==========================================

  _ensureConnected() {
    if (!this.nwc || !this.isConnected) {
      throw new Error('NWC wallet is not connected');
    }
  }
}

export default NWCWalletProvider;
