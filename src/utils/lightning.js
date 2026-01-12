/**
 * Lightning Payment Service
 *
 * A service class for handling Lightning Network payments via Nostr Wallet Connect (NWC).
 * Supports Lightning invoices, Lightning addresses, and LNURL-pay.
 *
 * @requires @getalby/sdk - For NWC WebLN provider
 * @requires @getalby/lightning-tools - For Lightning address and invoice handling
 * @requires bech32 - For LNURL decoding
 */

import { NostrWebLNProvider } from '@getalby/sdk';
import { LightningAddress, Invoice } from '@getalby/lightning-tools';
import { bech32 } from 'bech32';

/**
 * Payment type constants for consistent type checking
 */
export const PaymentType = {
  LIGHTNING_INVOICE: 'lightning_invoice',
  LIGHTNING_ADDRESS: 'lightning_address',
  LNURL_PAY: 'lnurl_pay',
};

/**
 * LightningPaymentService handles all Lightning Network payment operations
 * through Nostr Wallet Connect (NWC).
 */
export class LightningPaymentService {
  /**
   * Creates a new LightningPaymentService instance
   * @param {string} nwcConnectionString - The NWC connection URL (nostr+walletconnect://...)
   */
  constructor(nwcConnectionString) {
    if (!nwcConnectionString) {
      throw new Error('NWC connection string is required');
    }

    this.nwc = new NostrWebLNProvider({
      nostrWalletConnectUrl: nwcConnectionString,
    });
    this.enabled = false;
  }

  /**
   * Enables the NWC connection. Must be called before any wallet operations.
   * Safe to call multiple times - will only connect once.
   * @returns {Promise<void>}
   */
  async enable() {
    if (!this.enabled) {
      await this.nwc.enable();
      this.enabled = true;
    }
  }

  /**
   * Closes the NWC connection and cleans up resources
   */
  close() {
    if (this.nwc && typeof this.nwc.close === 'function') {
      this.nwc.close();
    }
    this.enabled = false;
  }

  // ============================================================================
  // Payment Input Detection
  // ============================================================================

  /**
   * Detects if the input is a Lightning address (email-like format)
   * @param {string} input - The input string to check
   * @returns {boolean}
   */
  isLightningAddress(input) {
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return pattern.test(input);
  }

  /**
   * Detects if the input is an LNURL
   * @param {string} input - The input string to check
   * @returns {boolean}
   */
  isLNURL(input) {
    const lower = input.toLowerCase();
    return lower.startsWith('lnurl') || lower.startsWith('lightning:lnurl');
  }

  /**
   * Detects if the input is a Lightning invoice (BOLT11)
   * @param {string} input - The input string to check
   * @returns {boolean}
   */
  isLightningInvoice(input) {
    const lower = input.toLowerCase().replace(/^lightning:/i, '');
    return (
      lower.startsWith('lnbc') ||   // Mainnet
      lower.startsWith('lntb') ||   // Testnet
      lower.startsWith('lnbcrt') || // Regtest
      lower.startsWith('lntbs')     // Signet
    );
  }

  /**
   * Validates and identifies the payment input type
   * @param {string} input - The payment input to validate
   * @returns {{ valid: boolean, type?: string, error?: string }}
   */
  static validatePaymentInput(input) {
    const cleanInput = (input || '').trim();

    if (!cleanInput) {
      return { valid: false, error: 'Please enter a payment request' };
    }

    // Check Lightning Address
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanInput)) {
      return { valid: true, type: PaymentType.LIGHTNING_ADDRESS };
    }

    // Check LNURL
    const lowerInput = cleanInput.toLowerCase();
    if (lowerInput.startsWith('lnurl') || lowerInput.startsWith('lightning:lnurl')) {
      return { valid: true, type: PaymentType.LNURL_PAY };
    }

    // Check Lightning Invoice
    const invoiceCheck = lowerInput.replace(/^lightning:/i, '');
    if (
      invoiceCheck.startsWith('lnbc') ||
      invoiceCheck.startsWith('lntb') ||
      invoiceCheck.startsWith('lnbcrt') ||
      invoiceCheck.startsWith('lntbs')
    ) {
      return { valid: true, type: PaymentType.LIGHTNING_INVOICE };
    }

    return {
      valid: false,
      error: 'Invalid format. Please enter a Lightning invoice, LNURL, or Lightning address.',
    };
  }

  // ============================================================================
  // Payment Input Processing
  // ============================================================================

  /**
   * Processes any Lightning payment input and returns standardized payment data
   * @param {string} input - The payment input (invoice, LNURL, or Lightning address)
   * @returns {Promise<Object>} Standardized payment data object
   * @throws {Error} If the input format is invalid or processing fails
   */
  async processPaymentInput(input) {
    const cleanInput = (input || '').trim();

    if (this.isLightningAddress(cleanInput)) {
      return this.handleLightningAddress(cleanInput);
    }

    if (this.isLNURL(cleanInput)) {
      return this.handleLNURL(cleanInput);
    }

    if (this.isLightningInvoice(cleanInput)) {
      return this.handleLightningInvoice(cleanInput);
    }

    throw new Error(
      'Invalid Lightning payment format. Please enter a Lightning invoice, LNURL, or Lightning address.'
    );
  }

  /**
   * Processes a Lightning address and fetches payment parameters
   * @param {string} address - The Lightning address (user@domain.com)
   * @returns {Promise<Object>} Payment data with minSendable, maxSendable, etc.
   */
  async handleLightningAddress(address) {
    try {
      const ln = new LightningAddress(address);
      await ln.fetch();

      const lnurlpData = ln.lnurlpData;
      if (!lnurlpData) {
        throw new Error('Failed to fetch Lightning Address data');
      }

      const minSendable = lnurlpData.min || 1000;
      const maxSendable = lnurlpData.max || 100000000000;

      // Detect fixed amount: when min equals max, it's a fixed amount request
      const isFixedAmount = minSendable === maxSendable;
      const fixedAmountSats = isFixedAmount ? Math.floor(minSendable / 1000) : null;

      return {
        type: PaymentType.LIGHTNING_ADDRESS,
        address,
        minSendable,
        maxSendable,
        // Amount range in sats for UI convenience
        minSats: Math.ceil(minSendable / 1000),
        maxSats: Math.floor(maxSendable / 1000),
        // Fixed amount detection
        isFixedAmount,
        fixedAmountSats,
        amount: fixedAmountSats, // Pre-fill amount if fixed
        commentAllowed: lnurlpData.commentAllowed || 0,
        callback: lnurlpData.callback,
        metadata: lnurlpData.metadata,
        description: `Payment to ${address}`,
      };
    } catch (error) {
      const message = error.message || 'Unknown error';
      throw new Error(`Invalid Lightning Address: ${message}`);
    }
  }

  /**
   * Processes an LNURL and fetches payment parameters
   * @param {string} lnurlInput - The LNURL string
   * @returns {Promise<Object>} Payment data with callback, minSendable, maxSendable, etc.
   */
  async handleLNURL(lnurlInput) {
    try {
      const cleanLnurl = lnurlInput.replace(/^lightning:/i, '');
      const url = this.decodeLNURL(cleanLnurl);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`LNURL fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL request failed');
      }

      if (data.tag !== 'payRequest') {
        throw new Error('Unsupported LNURL type. Only LNURL-pay is supported.');
      }

      const minSendable = data.minSendable || 1000;
      const maxSendable = data.maxSendable || 100000000000;

      // Detect fixed amount: when min equals max, it's a fixed amount request
      const isFixedAmount = minSendable === maxSendable;
      const fixedAmountSats = isFixedAmount ? Math.floor(minSendable / 1000) : null;

      return {
        type: PaymentType.LNURL_PAY,
        callback: data.callback,
        minSendable,
        maxSendable,
        // Amount range in sats for UI convenience
        minSats: Math.ceil(minSendable / 1000),
        maxSats: Math.floor(maxSendable / 1000),
        // Fixed amount detection
        isFixedAmount,
        fixedAmountSats,
        amount: fixedAmountSats, // Pre-fill amount if fixed
        commentAllowed: data.commentAllowed || 0,
        metadata: data.metadata,
        description: this.parseMetadataDescription(data.metadata),
      };
    } catch (error) {
      const message = error.message || 'Unknown error';
      throw new Error(`Invalid LNURL: ${message}`);
    }
  }

  /**
   * Processes a Lightning invoice and extracts payment details
   * @param {string} invoice - The BOLT11 invoice string
   * @returns {Promise<Object>} Payment data with amount, description, expiry, etc.
   */
  async handleLightningInvoice(invoice) {
    const cleanInvoice = invoice.replace(/^lightning:/i, '');

    try {
      const decoded = new Invoice({ pr: cleanInvoice });

      return {
        type: PaymentType.LIGHTNING_INVOICE,
        invoice: cleanInvoice,
        amount: decoded.satoshi || 0,
        description: decoded.description || 'Lightning payment',
        expiry: decoded.expiry,
        paymentHash: decoded.paymentHash,
        expiryDate: decoded.expiryDate,
        hasExpired: decoded.hasExpired(),
        createdDate: decoded.createdDate,
      };
    } catch (error) {
      // Fallback for invoices that can't be decoded locally
      // The wallet will still be able to pay them
      console.warn('Invoice decode warning:', error.message);
      return {
        type: PaymentType.LIGHTNING_INVOICE,
        invoice: cleanInvoice,
        amount: 0,
        description: 'Lightning invoice',
        expiry: null,
        paymentHash: null,
        expiryDate: null,
        hasExpired: false,
        createdDate: null,
      };
    }
  }

  // ============================================================================
  // Payment Execution
  // ============================================================================

  /**
   * Sends a payment based on the payment data type
   * @param {Object} paymentData - The payment data from processPaymentInput
   * @param {number} [amount] - Amount in sats (required for LNURL/Lightning Address)
   * @param {string} [comment] - Optional comment for the payment
   * @returns {Promise<Object>} Payment result with preimage
   */
  async sendPayment(paymentData, amount = null, comment = null) {
    await this.enable();

    switch (paymentData.type) {
      case PaymentType.LIGHTNING_INVOICE:
      case 'invoice':
        return this.payInvoice(paymentData.invoice);

      case PaymentType.LIGHTNING_ADDRESS:
        return this.payLightningAddress(paymentData, amount, comment);

      case PaymentType.LNURL_PAY:
      case 'lnurl':
        return this.payLNURL(paymentData, amount, comment);

      default:
        throw new Error(`Unsupported payment type: ${paymentData.type}`);
    }
  }

  /**
   * Pays a Lightning invoice directly
   * @param {string} invoice - The BOLT11 invoice
   * @returns {Promise<Object>} Payment result with preimage
   */
  async payInvoice(invoice) {
    await this.enable();
    return this.nwc.sendPayment(invoice);
  }

  /**
   * Pays a Lightning address
   * @param {Object} paymentData - Payment data with address and limits
   * @param {number} amount - Amount in sats
   * @param {string} [comment] - Optional comment
   * @returns {Promise<Object>} Payment result with preimage
   */
  async payLightningAddress(paymentData, amount, comment) {
    if (!amount || amount <= 0) {
      throw new Error('Amount is required for Lightning Address payments');
    }

    this.validateAmount(amount, paymentData);

    const ln = new LightningAddress(paymentData.address);
    await ln.fetch();

    const invoiceParams = {
      satoshi: amount,
    };

    if (comment && paymentData.commentAllowed > 0) {
      invoiceParams.comment = comment.substring(0, paymentData.commentAllowed);
    }

    const invoiceResponse = await ln.requestInvoice(invoiceParams);
    return this.nwc.sendPayment(invoiceResponse.paymentRequest);
  }

  /**
   * Pays an LNURL-pay request
   * @param {Object} paymentData - Payment data with callback and limits
   * @param {number} amount - Amount in sats
   * @param {string} [comment] - Optional comment
   * @returns {Promise<Object>} Payment result with preimage
   */
  async payLNURL(paymentData, amount, comment) {
    if (!amount || amount <= 0) {
      throw new Error('Amount is required for LNURL payments');
    }

    // Handle raw LNURL that needs decoding
    if (!paymentData.callback && paymentData.data) {
      const decoded = await this.handleLNURL(paymentData.data);
      return this.payLNURL(decoded, amount, comment);
    }

    this.validateAmount(amount, paymentData);

    const amountMsat = amount * 1000;
    const callbackUrl = new URL(paymentData.callback);
    callbackUrl.searchParams.set('amount', amountMsat.toString());

    if (comment && paymentData.commentAllowed > 0) {
      callbackUrl.searchParams.set('comment', comment.substring(0, paymentData.commentAllowed));
    }

    const response = await fetch(callbackUrl.toString());
    if (!response.ok) {
      throw new Error(`LNURL callback failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL payment request failed');
    }

    if (!data.pr) {
      throw new Error('No payment request received from LNURL callback');
    }

    return this.nwc.sendPayment(data.pr);
  }

  // ============================================================================
  // Invoice Creation
  // ============================================================================

  /**
   * Creates a Lightning invoice for receiving payments
   * @param {number} amount - Amount in sats
   * @param {string} [description=''] - Invoice description/memo
   * @param {number} [expiry=3600] - Expiry time in seconds
   * @returns {Promise<Object>} Invoice data with payment_request, payment_hash, etc.
   */
  async createInvoice(amount, description = '', expiry = 3600) {
    await this.enable();

    if (!amount || amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const invoiceRequest = {
      amount: parseInt(amount, 10),
      defaultMemo: description || 'BuhoGO Payment',
    };

    if (expiry && expiry > 0) {
      invoiceRequest.expiry = expiry;
    }

    const invoice = await this.nwc.makeInvoice(invoiceRequest);

    // Normalize response fields (WebLN uses camelCase, we use snake_case)
    return {
      payment_request: invoice.paymentRequest || invoice.payment_request,
      payment_hash: invoice.paymentHash || invoice.payment_hash,
      amount,
      description,
      expires_at: invoice.expiresAt || invoice.expires_at,
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  // ============================================================================
  // Wallet Information
  // ============================================================================

  /**
   * Gets the wallet balance
   * @returns {Promise<Object>} Balance object with balance in sats
   */
  async getBalance() {
    await this.enable();
    return this.nwc.getBalance();
  }

  /**
   * Gets wallet information (alias, pubkey, network, supported methods)
   * @returns {Promise<Object>} Wallet info object
   */
  async getInfo() {
    await this.enable();
    return this.nwc.getInfo();
  }

  /**
   * Lists transaction history
   * @param {Object} [options={}] - Query options
   * @param {number} [options.limit=50] - Maximum number of transactions
   * @param {number} [options.offset=0] - Pagination offset
   * @param {number} [options.from] - Start timestamp (unix seconds)
   * @param {number} [options.until] - End timestamp (unix seconds)
   * @param {string} [options.type] - Filter by type ('incoming' or 'outgoing')
   * @returns {Promise<Object>} Transaction list with transactions array
   */
  async listTransactions(options = {}) {
    await this.enable();

    const queryOptions = {
      limit: 50,
      offset: 0,
      ...options,
    };

    return this.nwc.listTransactions(queryOptions);
  }

  /**
   * Looks up a specific invoice by payment hash or payment request
   * @param {Object} params - Lookup parameters
   * @param {string} [params.paymentHash] - The payment hash to look up
   * @param {string} [params.paymentRequest] - The invoice to look up
   * @returns {Promise<Object>} Invoice/transaction details
   */
  async lookupInvoice(params) {
    await this.enable();
    return this.nwc.lookupInvoice({
      payment_hash: params.paymentHash,
      invoice: params.paymentRequest,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Decodes an LNURL from bech32 format to URL
   * @param {string} lnurl - The bech32-encoded LNURL
   * @returns {string} The decoded URL
   * @throws {Error} If decoding fails
   */
  decodeLNURL(lnurl) {
    try {
      const cleanLnurl = lnurl.toLowerCase().trim();
      const decoded = bech32.decode(cleanLnurl, 2000);
      const bytes = bech32.fromWords(decoded.words);
      return new TextDecoder().decode(new Uint8Array(bytes));
    } catch (error) {
      throw new Error(`Failed to decode LNURL: ${error.message}`);
    }
  }

  /**
   * Parses the description from LNURL metadata
   * @param {string|Array} metadata - The LNURL metadata (JSON string or array)
   * @returns {string} The parsed description
   */
  parseMetadataDescription(metadata) {
    try {
      const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      if (!Array.isArray(parsed)) {
        return 'LNURL payment';
      }
      const textEntry = parsed.find((entry) => entry[0] === 'text/plain');
      return textEntry ? textEntry[1] : 'LNURL payment';
    } catch {
      return 'LNURL payment';
    }
  }

  /**
   * Validates that an amount is within the allowed range
   * @param {number} amount - Amount in sats
   * @param {Object} paymentData - Payment data with minSendable and maxSendable (in msats)
   * @throws {Error} If amount is out of range
   */
  validateAmount(amount, paymentData) {
    const amountMsat = amount * 1000;
    const { minSendable, maxSendable } = paymentData;

    if (amountMsat < minSendable || amountMsat > maxSendable) {
      const minSats = Math.ceil(minSendable / 1000);
      const maxSats = Math.floor(maxSendable / 1000);
      throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`);
    }
  }
}

export default LightningPaymentService;
