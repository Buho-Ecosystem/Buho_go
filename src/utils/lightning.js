import { webln } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";

export class LightningPaymentService {
  constructor(nwcString) {
    this.nwc = new webln.NostrWebLNProvider({
      nostrWalletConnectUrl: nwcString,
    });
  }

  async enable() {
    await this.nwc.enable();
  }

  // Detect payment type and process accordingly
  async processPaymentInput(input) {
    const cleanInput = input.trim();
    
    // Lightning Address (user@domain.com)
    if (this.isLightningAddress(cleanInput)) {
      return await this.handleLightningAddress(cleanInput);
    }
    
    // LNURL (starts with lnurl or lightning:lnurl)
    if (this.isLNURL(cleanInput)) {
      return await this.handleLNURL(cleanInput);
    }
    
    // Lightning Invoice (starts with lnbc or lightning:lnbc)
    if (this.isLightningInvoice(cleanInput)) {
      return await this.handleLightningInvoice(cleanInput);
    }
    
    throw new Error('Invalid payment format');
  }

  isLightningAddress(input) {
    return input.includes('@') && !input.startsWith('lnurl') && !input.startsWith('lightning:');
  }

  isLNURL(input) {
    return input.toLowerCase().startsWith('lnurl') || input.toLowerCase().startsWith('lightning:lnurl');
  }

  isLightningInvoice(input) {
    return input.toLowerCase().startsWith('lnbc') || input.toLowerCase().startsWith('lightning:lnbc');
  }

  async handleLightningAddress(address) {
    try {
      const ln = new LightningAddress(address);
      await ln.fetch();
      
      return {
        type: 'lightning_address',
        address: address,
        minSendable: ln.minSendable,
        maxSendable: ln.maxSendable,
        commentAllowed: ln.commentAllowed || 0,
        callback: ln.callback,
        metadata: ln.metadata
      };
    } catch (error) {
      throw new Error(`Invalid Lightning Address: ${error.message}`);
    }
  }

  async handleLNURL(lnurl) {
    try {
      // For LNURL-pay, we need to decode and fetch the callback
      const response = await fetch(lnurl);
      const data = await response.json();
      
      if (data.tag === 'payRequest') {
        return {
          type: 'lnurl_pay',
          callback: data.callback,
          minSendable: data.minSendable,
          maxSendable: data.maxSendable,
          commentAllowed: data.commentAllowed || 0,
          metadata: data.metadata
        };
      }
      
      throw new Error('Unsupported LNURL type');
    } catch (error) {
      throw new Error(`Invalid LNURL: ${error.message}`);
    }
  }

  async handleLightningInvoice(invoice) {
    try {
      const cleanInvoice = invoice.replace('lightning:', '');
      const decoded = await this.nwc.decodeInvoice(cleanInvoice);
      
      return {
        type: 'lightning_invoice',
        invoice: cleanInvoice,
        amount: decoded.amount,
        description: decoded.description,
        expiry: decoded.expiry,
        paymentHash: decoded.payment_hash
      };
    } catch (error) {
      throw new Error(`Invalid Lightning Invoice: ${error.message}`);
    }
  }

  async sendPayment(paymentData, amount = null, comment = null) {
    try {
      switch (paymentData.type) {
        case 'lightning_invoice':
          return await this.nwc.sendPayment(paymentData.invoice);
          
        case 'lightning_address':
        case 'lnurl_pay':
          if (!amount) throw new Error('Amount required for LNURL/Lightning Address');
          
          const amountMsat = amount * 1000;
          if (amountMsat < paymentData.minSendable || amountMsat > paymentData.maxSendable) {
            throw new Error(`Amount must be between ${paymentData.minSendable/1000} and ${paymentData.maxSendable/1000} sats`);
          }
          
          const callbackUrl = new URL(paymentData.callback);
          callbackUrl.searchParams.set('amount', amountMsat);
          if (comment && paymentData.commentAllowed > 0) {
            callbackUrl.searchParams.set('comment', comment.substring(0, paymentData.commentAllowed));
          }
          
          const callbackResponse = await fetch(callbackUrl.toString());
          const callbackData = await callbackResponse.json();
          
          if (callbackData.status === 'ERROR') {
            throw new Error(callbackData.reason || 'Payment failed');
          }
          
          return await this.nwc.sendPayment(callbackData.pr);
          
        default:
          throw new Error('Unsupported payment type');
      }
    } catch (error) {
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  async createInvoice(amount, description = '') {
    try {
      return await this.nwc.makeInvoice({
        amount: parseInt(amount),
        description: description || 'BuhoGO Payment'
      });
    } catch (error) {
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  async getBalance() {
    try {
      return await this.nwc.getBalance();
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
}