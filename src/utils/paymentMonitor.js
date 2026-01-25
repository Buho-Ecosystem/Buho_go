/**
 * PaymentMonitor - Utility for monitoring payment status
 *
 * Provides non-spammy payment confirmation checking with exponential backoff.
 * Works with both Spark and NWC wallet providers through the unified interface.
 */

/**
 * Payment status constants
 */
export const PaymentStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  EXPIRED: 'expired',
  ERROR: 'error'
};

/**
 * Default configuration for payment monitoring
 */
const DEFAULT_CONFIG = {
  initialInterval: 1500,     // Start checking after 1.5 seconds
  maxInterval: 6000,         // Max 6 seconds between checks (more real-time feel)
  backoffMultiplier: 1.25,   // Gentle backoff
  maxAttempts: 35,           // Stop after ~3 minutes
  expiryBuffer: 60           // Stop checking 60 seconds before expiry
};

/**
 * PaymentMonitor class
 * Monitors a single invoice for payment confirmation
 */
export class PaymentMonitor {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isMonitoring = false;
    this.currentInterval = this.config.initialInterval;
    this.attemptCount = 0;
    this.timeoutId = null;
    this.invoice = null;
    this.provider = null;
    this.onStatusChange = null;
  }

  /**
   * Start monitoring an invoice for payment
   * @param {Object} params
   * @param {Object} params.invoice - Invoice object with payment_hash and expires_at
   * @param {Object} params.provider - WalletProvider instance (Spark or NWC)
   * @param {Function} params.onStatusChange - Callback: (status, data) => void
   * @returns {Promise<void>}
   */
  async start({ invoice, provider, onStatusChange }) {
    if (this.isMonitoring) {
      this.stop();
    }

    if (!invoice?.payment_hash) {
      throw new Error('Invoice must have a payment_hash');
    }

    if (!provider) {
      throw new Error('Provider is required');
    }

    this.invoice = invoice;
    this.provider = provider;
    this.onStatusChange = onStatusChange || (() => {});
    this.isMonitoring = true;
    this.attemptCount = 0;
    this.currentInterval = this.config.initialInterval;

    // Notify that monitoring has started
    this._notifyStatus(PaymentStatus.PENDING, {
      message: 'Waiting for payment...',
      attempt: 0
    });

    // Start the polling loop
    this._scheduleNextCheck();
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.isMonitoring = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Check if currently monitoring
   * @returns {boolean}
   */
  isActive() {
    return this.isMonitoring;
  }

  /**
   * Schedule the next payment check with exponential backoff
   * @private
   */
  _scheduleNextCheck() {
    if (!this.isMonitoring) return;

    this.timeoutId = setTimeout(() => {
      this._checkPayment();
    }, this.currentInterval);
  }

  /**
   * Check payment status
   * @private
   */
  async _checkPayment() {
    if (!this.isMonitoring) return;

    this.attemptCount++;

    // Check if invoice has expired
    if (this._isExpired()) {
      this._notifyStatus(PaymentStatus.EXPIRED, {
        message: 'Invoice has expired'
      });
      this.stop();
      return;
    }

    // Check if max attempts reached
    if (this.attemptCount >= this.config.maxAttempts) {
      this._notifyStatus(PaymentStatus.ERROR, {
        message: 'Payment monitoring timed out',
        attempt: this.attemptCount
      });
      this.stop();
      return;
    }

    try {
      const result = await this.provider.lookupInvoice(this.invoice.payment_hash);

      if (result.paid) {
        // Payment confirmed
        this._notifyStatus(PaymentStatus.CONFIRMED, {
          message: 'Payment received',
          preimage: result.preimage,
          amount: result.amount || this.invoice.amount,
          attempt: this.attemptCount
        });
        this.stop();
        return;
      }

      // Still pending - notify and schedule next check
      this._notifyStatus(PaymentStatus.PENDING, {
        message: 'Waiting for payment...',
        attempt: this.attemptCount,
        nextCheckIn: Math.round(this.currentInterval / 1000)
      });

      // Apply exponential backoff
      this.currentInterval = Math.min(
        this.currentInterval * this.config.backoffMultiplier,
        this.config.maxInterval
      );

      // Schedule next check
      this._scheduleNextCheck();

    } catch (error) {
      console.warn('Payment check failed:', error.message);

      // Don't stop on transient errors, just continue polling
      this._notifyStatus(PaymentStatus.PENDING, {
        message: 'Checking payment status...',
        attempt: this.attemptCount,
        error: error.message
      });

      // Apply backoff and continue
      this.currentInterval = Math.min(
        this.currentInterval * this.config.backoffMultiplier,
        this.config.maxInterval
      );

      this._scheduleNextCheck();
    }
  }

  /**
   * Check if invoice has expired
   * @private
   * @returns {boolean}
   */
  _isExpired() {
    if (!this.invoice.expires_at) return false;

    const now = Math.floor(Date.now() / 1000);
    const expiryTime = this.invoice.expires_at - this.config.expiryBuffer;

    return now >= expiryTime;
  }

  /**
   * Notify status change
   * @private
   */
  _notifyStatus(status, data = {}) {
    if (this.onStatusChange) {
      this.onStatusChange(status, {
        ...data,
        status,
        paymentHash: this.invoice?.payment_hash
      });
    }
  }
}

/**
 * Factory function to create a payment monitor
 * @param {Object} config - Optional configuration overrides
 * @returns {PaymentMonitor}
 */
export function createPaymentMonitor(config = {}) {
  return new PaymentMonitor(config);
}

export default PaymentMonitor;
