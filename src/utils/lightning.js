import {NostrWebLNProvider} from "@getalby/sdk/webln";
import {LightningAddress} from "@getalby/lightning-tools";
import * as lightningTools from "@getalby/lightning-tools";

export class LightningPaymentService {
  constructor(nwcString) {
    this.nwc = new NostrWebLNProvider({
      nostrWalletConnectUrl: nwcString,
    });
    this.enabled = false;
    this.notificationSubscription = null;
  }

  async enable() {
    if (!this.enabled) {
      await this.nwc.enable();
      this.enabled = true;

      // Set up payment notifications if supported
      await this.setupNotifications();
    }
  }

// Add this method to the LightningPaymentService class in lightning.js

/**
 * Request an invoice from LNURL-pay or Lightning Address
 * @param {Object} paymentData - The payment data from handleLNURL or handleLightningAddress
 * @param {number} amount - Amount in satoshis
 * @param {string} comment - Optional comment
 * @param {Object} payerData - Optional payer data
 * @returns {Promise<Object>} Invoice object
 */
async requestInvoiceFromLNURL(paymentData, amount, comment = null, payerData = null) {
  try {
    // Handle both LNURL and Lightning Address
    if (paymentData.type === 'lightning_address') {
      return await this.requestInvoiceFromLightningAddress(
        paymentData.address,
        amount,
        comment,
        payerData
      );
    }

    if (paymentData.type !== 'lnurl_pay') {
      throw new Error(`Invalid payment type: ${paymentData.type}. Expected lnurl_pay or lightning_address.`);
    }

    const amountMsat = amount * 1000;

    // Validate amount range
    if (amountMsat < paymentData.minSendable || amountMsat > paymentData.maxSendable) {
      const minSats = Math.floor(paymentData.minSendable / 1000);
      const maxSats = Math.floor(paymentData.maxSendable / 1000);
      throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`);
    }

    // Build callback URL
    const callbackUrl = new URL(paymentData.callback);
    callbackUrl.searchParams.set('amount', amountMsat.toString());

    // Add comment if supported and provided
    if (comment && paymentData.commentAllowed > 0) {
      const trimmedComment = comment.substring(0, paymentData.commentAllowed);
      callbackUrl.searchParams.set('comment', trimmedComment);
    }

    // Add payer data if supported and provided
    if (payerData && paymentData.payerData) {
      callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
    }

    // Make request to callback URL with timeout
    const callbackResponse = await Promise.race([
      fetch(callbackUrl.toString()),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('LNURL callback timeout')), 30000)
      )
    ]);

    if (!callbackResponse.ok) {
      throw new Error(`LNURL callback failed: ${callbackResponse.statusText}`);
    }

    const callbackData = await callbackResponse.json();

    if (callbackData.status === 'ERROR') {
      throw new Error(callbackData.reason || 'LNURL payment request failed');
    }

    if (!callbackData.pr) {
      throw new Error('No payment request received from LNURL callback');
    }

    // Return invoice in consistent format
    return {
      payment_request: callbackData.pr,
      payment_hash: null,
      amount: amount,
      description: this.parseMetadataDescription(paymentData.metadata),
      expires_at: null,
      created_at: Math.floor(Date.now() / 1000),
      lnurl_data: paymentData
    };

  } catch (error) {
    console.error('Error requesting invoice from LNURL:', error);
    throw new Error(`Failed to request LNURL invoice: ${error.message}`);
  }
}

  // New: Set up payment notifications
  async setupNotifications() {
    try {
      const info = await this.nwc.getInfo();

      // Check if notifications are supported
      if (info.methods?.includes('subscribeNotifications')) {
        // Subscribe to payment notifications
        this.notificationSubscription = await this.nwc.subscribeNotifications(
          (notification) => {
            this.handleNotification(notification);
          },
          ['payment_received', 'payment_sent']
        );
      }
    } catch (error) {
      console.warn('Could not set up notifications:', error);
    }
  }

  // New: Handle payment notifications
  handleNotification(notification) {
    console.log('Payment notification:', notification);

    // Emit custom events that can be listened to by the UI
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('lightning-payment-notification', {
        detail: notification
      });
      window.dispatchEvent(event);
    }
  }

  // Enhanced: Detect and process different Lightning payment formats
  async processPaymentInput(input) {
    const cleanInput = input.trim();

    // Lightning Address (user@domain.com)
    if (this.isLightningAddress(cleanInput)) {
      return await this.handleLightningAddress(cleanInput);
    }

    // LNURL (starts with lnurl or LNURL)
    if (this.isLNURL(cleanInput)) {
      return await this.handleLNURL(cleanInput);
    }

    // Lightning Invoice (starts with lnbc, lntb, lnbcrt, etc.)
    if (this.isLightningInvoice(cleanInput)) {
      return await this.handleLightningInvoice(cleanInput);
    }

    throw new Error('Invalid Lightning payment format. Please enter a Lightning invoice, LNURL, or Lightning address.');
  }

  isLightningAddress(input) {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input);
  }

  isLNURL(input) {
    const lower = input.toLowerCase();
    return lower.startsWith('lnurl') || lower.startsWith('lightning:lnurl');
  }

  isLightningInvoice(input) {
    const lower = input.toLowerCase();
    const cleanInvoice = lower.replace('lightning:', '');
    return cleanInvoice.startsWith('lnbc') ||
      cleanInvoice.startsWith('lntb') ||
      cleanInvoice.startsWith('lnbcrt') ||
      cleanInvoice.startsWith('lntbrt');
  }

  async handleLightningAddress(address) {
    try {
      const ln = new LightningAddress(address);
      await ln.fetch();

      return {
        type: 'lightning_address',
        address: address,
        minSendable: ln.minSendable || 1000,
        maxSendable: ln.maxSendable || 100000000000,
        commentAllowed: ln.commentAllowed || 0,
        callback: ln.callback,
        metadata: ln.metadata,
        description: `Payment to ${address}`,
        // New: Include additional LNURL-pay features
        payerData: ln.payerData || null,
        nostrPubkey: ln.nostrPubkey || null
      };
    } catch (error) {
      throw new Error(`Invalid Lightning Address: ${error.message}`);
    }
  }

  async handleLNURL(lnurlInput) {
    try {
      const cleanLnurl = lnurlInput.replace(/^lightning:/i, '');
      const {url} = lightningTools.decode(cleanLnurl);

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL request failed');
      }

      if (data.tag === 'payRequest') {
        return {
          type: 'lnurl_pay',
          callback: data.callback,
          minSendable: data.minSendable || 1000,
          maxSendable: data.maxSendable || 100000000000,
          commentAllowed: data.commentAllowed || 0,
          metadata: data.metadata,
          description: this.parseMetadataDescription(data.metadata),
          // New: Include additional LNURL-pay features
          payerData: data.payerData || null,
          nostrPubkey: data.nostrPubkey || null
        };
      }

      throw new Error('Unsupported LNURL type. Only LNURL-pay is supported.');
    } catch (error) {
      console.error('LNURL processing error:', error);
      throw new Error(`Invalid LNURL: ${error.message}`);
    }
  }

  // Enhanced: Better invoice handling using lookupInvoice
  async handleLightningInvoice(invoice) {
    try {
      const cleanInvoice = invoice.replace(/^lightning:/i, '');

      // Try to get invoice details using lookupInvoice
      try {
        const invoiceDetails = await this.nwc.lookupInvoice({
          paymentRequest: cleanInvoice
        });

        return {
          type: 'lightning_invoice',
          invoice: cleanInvoice,
          amount: Math.floor(invoiceDetails.amount / 1000) || 0, // Convert from msat to sat
          description: invoiceDetails.description || 'Lightning payment',
          expiry: invoiceDetails.expires_at,
          paymentHash: invoiceDetails.paymentHash,
          paid: invoiceDetails.paid || false
        };
      } catch (lookupError) {
        // Fallback: return basic invoice info
        console.warn('Could not lookup invoice details:', lookupError);
        return {
          type: 'lightning_invoice',
          invoice: cleanInvoice,
          amount: 0,
          description: 'Lightning invoice',
          expiry: null,
          paymentHash: null,
          paid: false
        };
      }
    } catch (error) {
      throw new Error(`Invalid Lightning Invoice: ${error.message}`);
    }
  }

  parseMetadataDescription(metadata) {
    try {
      if (typeof metadata === 'string') {
        const parsed = JSON.parse(metadata);
        const textEntry = parsed.find(entry => entry[0] === 'text/plain');
        return textEntry ? textEntry[1] : 'LNURL payment';
      }
      return 'LNURL payment';
    } catch {
      return 'LNURL payment';
    }
  }

  // Enhanced: Payment with better error handling and support for payer data
  async sendPayment(paymentData, amount = null, comment = null, payerData = null) {
    try {
      await this.enable();

      switch (paymentData.type) {
        case 'lightning_invoice':
          // Check if invoice is already paid
          if (paymentData.paid) {
            throw new Error('This invoice has already been paid');
          }
          return await this.nwc.sendPayment(paymentData.invoice);

        case 'lightning_address':
        case 'lnurl_pay':
          if (!amount) {
            throw new Error('Amount is required for LNURL and Lightning Address payments');
          }

          const amountMsat = amount * 1000;

          // Validate amount range
          if (amountMsat < paymentData.minSendable || amountMsat > paymentData.maxSendable) {
            const minSats = Math.floor(paymentData.minSendable / 1000);
            const maxSats = Math.floor(paymentData.maxSendable / 1000);
            throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`);
          }

          // Handle Lightning Address payments
          if (paymentData.type === 'lightning_address') {
            const ln = new LightningAddress(paymentData.address);
            await ln.fetch();

            const requestParams = {
              satoshi: amount,
            };

            // Add comment if supported
            if (comment && paymentData.commentAllowed > 0) {
              requestParams.comment = comment.substring(0, paymentData.commentAllowed);
            }

            // Add payer data if supported
            if (payerData && paymentData.payerData) {
              requestParams.payerdata = payerData;
            }

            const invoice = await ln.requestInvoice(requestParams);
            return await this.nwc.sendPayment(invoice.paymentRequest);
          }

          // Handle LNURL-pay
          if (paymentData.type === 'lnurl_pay') {
            const callbackUrl = new URL(paymentData.callback);
            callbackUrl.searchParams.set('amount', amountMsat.toString());

            if (comment && paymentData.commentAllowed > 0) {
              const trimmedComment = comment.substring(0, paymentData.commentAllowed);
              callbackUrl.searchParams.set('comment', trimmedComment);
            }

            // Add payer data if supported
            if (payerData && paymentData.payerData) {
              callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
            }

            // Get invoice from callback with timeout
            const callbackResponse = await Promise.race([
              fetch(callbackUrl.toString()),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Callback timeout')), 30000)
              )
            ]);

            if (!callbackResponse.ok) {
              throw new Error(`Callback request failed: ${callbackResponse.statusText}`);
            }

            const callbackData = await callbackResponse.json();
            if (callbackData.status === 'ERROR') {
              throw new Error(callbackData.reason || 'Payment request failed');
            }

            if (!callbackData.pr) {
              throw new Error('No payment request received from callback');
            }

            return await this.nwc.sendPayment(callbackData.pr);
          }
          break;

        default:
          throw new Error('Unsupported payment type');
      }
    } catch (error) {
      console.error('Payment error:', error);
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  // Enhanced: Invoice creation with better options
  async createInvoice(amount, description = '', expiry = 3600, metadata = null) {
    try {
      await this.enable();

      const invoiceData = {
        amount: parseInt(amount),
        defaultMemo: description || 'BuhoGO Payment'
      };

      // Add expiry if supported (note: WebLN interface may not support expiry directly)
      if (expiry) {
        invoiceData.expiry = expiry;
      }

      // Add metadata if provided
      if (metadata) {
        invoiceData.metadata = metadata;
      }

      const invoice = await this.nwc.makeInvoice(invoiceData);

      return {
        payment_request: invoice.paymentRequest,
        payment_hash: invoice.payment_hash,
        amount: amount,
        description: description,
        expires_at: invoice.expires_at,
        created_at: Math.floor(Date.now() / 1000)
      };
    } catch (error) {
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  async getBalance() {
    try {
      await this.enable();
      return await this.nwc.getBalance();
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async getInfo() {
    try {
      await this.enable();
      return await this.nwc.getInfo();
    } catch (error) {
      throw new Error(`Failed to get wallet info: ${error.message}`);
    }
  }

  async listTransactions(options = {}) {
    try {
      await this.enable();
      const defaultOptions = {
        limit: 50,
        offset: 0,
        ...options
      };
      return await this.nwc.listTransactions(defaultOptions);
    } catch (error) {
      throw new Error(`Failed to list transactions: ${error.message}`);
    }
  }

  // New: Sign message capability
  async signMessage(message) {
    try {
      await this.enable();
      return await this.nwc.signMessage(message);
    } catch (error) {
      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }

  // New: Keysend payment capability
  async sendKeysend({destination, amount, customRecords = {}, memo = ''}) {
    try {
      await this.enable();

      const keysendArgs = {
        destination: destination,
        amount: amount.toString(),
        customRecords: customRecords
      };

      if (memo) {
        keysendArgs.customRecords = {
          ...customRecords,
          '34349334': memo // Standard memo record
        };
      }

      return await this.nwc.keysend(keysendArgs);
    } catch (error) {
      throw new Error(`Keysend payment failed: ${error.message}`);
    }
  }

  // New: Multi-payment capability
  async sendMultiPayment(paymentRequests) {
    try {
      await this.enable();

      // Check if wallet supports multi-payments
      const info = await this.nwc.getInfo();
      if (info.methods?.includes('sendMultiPayment')) {
        return await this.nwc.sendMultiPayment(paymentRequests);
      } else {
        // Fallback: send payments sequentially
        const results = [];
        for (const paymentRequest of paymentRequests) {
          try {
            const result = await this.nwc.sendPayment(paymentRequest);
            results.push({paymentRequest, ...result});
          } catch (error) {
            results.push({paymentRequest, error: error.message});
          }
        }
        return {payments: results, errors: []};
      }
    } catch (error) {
      throw new Error(`Multi-payment failed: ${error.message}`);
    }
  }

  // New: Check if specific capability is supported
  async isCapabilitySupported(capability) {
    try {
      const info = await this.nwc.getInfo();
      return info.methods?.includes(capability) || false;
    } catch (error) {
      return false;
    }
  }

  // Enhanced: Close connection and cleanup
  close() {
    if (this.notificationSubscription) {
      try {
        this.notificationSubscription();
        this.notificationSubscription = null;
      } catch (error) {
        console.warn('Error cleaning up notification subscription:', error);
      }
    }

    if (this.nwc && typeof this.nwc.close === 'function') {
      this.nwc.close();
    }

    this.enabled = false;
  }

  // Enhanced validation with more detailed error messages
  static validatePaymentInput(input) {
    const cleanInput = input.trim();
    if (!cleanInput) {
      return {valid: false, error: 'Please enter a payment request'};
    }

    // Check for Lightning Address
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanInput)) {
      return {valid: true, type: 'lightning_address', description: 'Lightning Address'};
    }

    // Check for LNURL
    if (cleanInput.toLowerCase().startsWith('lnurl')) {
      return {valid: true, type: 'lnurl', description: 'LNURL Payment'};
    }

    // Check for Lightning Invoice
    const lower = cleanInput.toLowerCase().replace('lightning:', '');
    if (lower.startsWith('lnbc') || lower.startsWith('lntb') ||
      lower.startsWith('lnbcrt') || lower.startsWith('lntbrt')) {
      return {valid: true, type: 'lightning_invoice', description: 'Lightning Invoice'};
    }

    // Check for Bitcoin address (not supported but provide helpful error)
    if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(cleanInput) ||
      /^bc1[a-z0-9]{39,59}$/.test(cleanInput)) {
      return {
        valid: false,
        error: 'Bitcoin addresses are not supported. Please use a Lightning invoice, LNURL, or Lightning address.'
      };
    }

    return {
      valid: false,
      error: 'Invalid format. Please enter a Lightning invoice (lnbc...), LNURL (lnurl...), or Lightning address (user@domain.com).'
    };
  }

  // New: Utility method to format amounts
  static formatAmount(amountSats, currency = 'sats') {
    switch (currency.toLowerCase()) {
      case 'btc':
        return (amountSats / 100000000).toFixed(8) + ' BTC';
      case 'mbtc':
        return (amountSats / 100000).toFixed(5) + ' mBTC';
      case 'sats':
      default:
        return amountSats.toLocaleString() + ' sats';
    }
  }

  // New: Utility method to parse amounts
  static parseAmount(amountString, currency = 'sats') {
    const amount = parseFloat(amountString);
    if (isNaN(amount)) {
      throw new Error('Invalid amount');
    }

    switch (currency.toLowerCase()) {
      case 'btc':
        return Math.floor(amount * 100000000);
      case 'mbtc':
        return Math.floor(amount * 100000);
      case 'sats':
      default:
        return Math.floor(amount);
    }
  }
}

export default LightningPaymentService;
