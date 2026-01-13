/**
 * NWCWalletProvider - Nostr Wallet Connect implementation
 *
 * Wraps @getalby/sdk NostrWebLNProvider to match the WalletProvider interface.
 * Maintains backward compatibility with existing NWC functionality.
 */

import { WalletProvider } from './WalletProvider';
import { NostrWebLNProvider } from '@getalby/sdk';

export class NWCWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.nwc = null;
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

      this.isConnected = true;
      this.clearError();
    } catch (error) {
      this.setError(error);
      this.nwc = null;
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

    this.nwc = null;
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

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    // Try direct lookupInvoice first (NIP-47)
    try {
      const invoice = await this.nwc.lookupInvoice({
        payment_hash: paymentHash
      });

      if (invoice) {
        const isPaid = invoice.settled || invoice.paid ||
          invoice.state === 'SETTLED' ||
          (typeof invoice.settled_at === 'number' && invoice.settled_at > 0);

        return {
          paid: isPaid,
          preimage: invoice.preimage || null,
          amount: invoice.amount || 0
        };
      }
    } catch (lookupError) {
      // lookupInvoice not supported, try fallback
      console.warn('lookupInvoice not supported, trying fallback:', lookupError.message);
    }

    // Fallback: search in recent transactions
    try {
      const txResponse = await this.nwc.listTransactions({
        limit: 50,
        unpaid: false,
        type: 'incoming'
      });

      if (txResponse?.transactions) {
        const found = txResponse.transactions.find(tx =>
          tx.payment_hash === paymentHash ||
          tx.paymentHash === paymentHash
        );

        if (found) {
          const isPaid = found.settled || found.paid ||
            found.state === 'SETTLED' ||
            (typeof found.settled_at === 'number' && found.settled_at > 0);

          return {
            paid: isPaid,
            preimage: found.preimage || null,
            amount: Math.abs(found.amount || 0)
          };
        }
      }
    } catch (listError) {
      console.warn('listTransactions fallback failed:', listError.message);
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
        timestamp: tx.settled_at || tx.settledAt || tx.created_at || tx.createdAt || Date.now() / 1000,
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
   * Get the underlying NWC instance for direct access
   * @returns {NostrWebLNProvider|null}
   */
  getNWCInstance() {
    return this.nwc;
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
