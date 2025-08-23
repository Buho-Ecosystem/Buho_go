import { webln } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";
import { lnurl } from "@getalby/lightning-tools";

export class LightningPaymentService {
  constructor(nwcString) {
    this.nwc = new webln.NostrWebLNProvider({
      nostrWalletConnectUrl: nwcString,
    });
    this.enabled = false;
  }

  async enable() {
    if (!this.enabled) {
      await this.nwc.enable();
      this.enabled = true;
    }
  }

  // Detect and process different Lightning payment formats
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
    // Check for email-like format without protocol prefixes
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input);
  }

  isLNURL(input) {
    const lower = input.toLowerCase();
    return lower.startsWith('lnurl') || lower.startsWith('lightning:lnurl');
  }

  isLightningInvoice(input) {
    const lower = input.toLowerCase();
    // Remove lightning: prefix if present
    const cleanInvoice = lower.replace('lightning:', '');
    // Check for various Lightning invoice prefixes
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
        description: `Payment to ${address}`
      };
    } catch (error) {
      throw new Error(`Invalid Lightning Address: ${error.message}`);
    }
  }

  async handleLNURL(lnurl) {
    try {
      // Clean the LNURL string
      const cleanLnurl = lnurlString.replace(/^lightning:/i, '');
      
      // Decode LNURL using the lightning-tools library
      const { url } = lnurl.decode(cleanLnurl);
      
      // Fetch the LNURL data
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
          description: this.parseMetadataDescription(data.metadata)
        };
      }
      
      throw new Error('Unsupported LNURL type. Only LNURL-pay is supported.');
    } catch (error) {
      console.error('LNURL processing error:', error);
      throw new Error(`Invalid LNURL: ${error.message}`);
    }
  }

  async handleLightningInvoice(invoice) {
    try {
      // Remove lightning: prefix if present
      const cleanInvoice = invoice.replace(/^lightning:/i, '');
      
      // Use NWC to decode the invoice
      const decoded = await this.nwc.getInfo({ invoice: cleanInvoice });
      
      return {
        type: 'lightning_invoice',
        invoice: cleanInvoice,
        amount: decoded.amount || 0,
        description: decoded.description || 'Lightning payment',
        expiry: decoded.expiry,
        paymentHash: decoded.payment_hash,
        destination: decoded.destination
      };
    } catch (error) {
      // Fallback: try to parse basic invoice info
      try {
        return {
          type: 'lightning_invoice',
          invoice: invoice.replace(/^lightning:/i, ''),
          amount: 0, // Will be determined when paying
          description: 'Lightning invoice',
          expiry: null,
          paymentHash: null
        };
      } catch (fallbackError) {
        throw new Error(`Invalid Lightning Invoice: ${error.message}`);
      }
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

  async sendPayment(paymentData, amount = null, comment = null) {
    try {
      await this.enable();

      switch (paymentData.type) {
        case 'lightning_invoice':
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
            
            const invoice = await ln.requestInvoice({
              satoshi: amount,
              comment: comment && paymentData.commentAllowed > 0 ? comment.substring(0, paymentData.commentAllowed) : undefined
            });
            
            return await this.nwc.sendPayment(invoice.paymentRequest);
          }
          
          // Handle LNURL-pay
          if (paymentData.type === 'lnurl_pay') {
            // Build callback URL
            const callbackUrl = new URL(paymentData.callback);
            callbackUrl.searchParams.set('amount', amountMsat.toString());
            
            if (comment && paymentData.commentAllowed > 0) {
              const trimmedComment = comment.substring(0, paymentData.commentAllowed);
              callbackUrl.searchParams.set('comment', trimmedComment);
            }
            
            // Get invoice from callback
            const callbackResponse = await fetch(callbackUrl.toString());
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
            
            // Pay the invoice
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

  async createInvoice(amount, description = '', expiry = 3600) {
    try {
      await this.enable();
      
      const invoiceData = {
        amount: parseInt(amount),
        description: description || 'BuhoGO Payment'
      };
      
      // Add expiry if supported
      if (expiry) {
        invoiceData.expiry = expiry;
      }
      
      const invoice = await this.nwc.makeInvoice(invoiceData);
      
      return {
        payment_request: invoice.payment_request,
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

  // Utility method to validate Lightning payment formats
  static validatePaymentInput(input) {
    const cleanInput = input.trim();
    
    if (!cleanInput) {
      return { valid: false, error: 'Please enter a payment request' };
    }
    
    // Check for Lightning Address
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanInput)) {
      return { valid: true, type: 'lightning_address' };
    }
    
    // Check for LNURL
    if (cleanInput.toLowerCase().startsWith('lnurl')) {
      return { valid: true, type: 'lnurl' };
    }
    
    // Check for Lightning Invoice
    const lower = cleanInput.toLowerCase().replace('lightning:', '');
    if (lower.startsWith('lnbc') || lower.startsWith('lntb') || 
        lower.startsWith('lnbcrt') || lower.startsWith('lntbrt')) {
      return { valid: true, type: 'lightning_invoice' };
    }
    
    return { 
      valid: false, 
      error: 'Invalid format. Please enter a Lightning invoice, LNURL, or Lightning address.' 
    };
  }
}

export default LightningPaymentService;