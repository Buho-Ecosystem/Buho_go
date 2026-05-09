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
import { AUTO_CLAIM_THRESHOLDS } from '../stores/bitcoinPreferences';

/**
 * Spark's `ExitSpeed` is a TypeScript string-enum: `FAST | MEDIUM | SLOW`.
 * The SDK's runtime barrel doesn't currently re-export it (the type is in
 * `.d.ts` only), so importing it from the package fails at module load.
 * Mirror the enum locally — the SDK accepts the raw string values, and we
 * keep parity with the doc'd shape (https://docs.spark.money/wallet-sdk).
 */
const ExitSpeed = Object.freeze({
  FAST: 'FAST',
  MEDIUM: 'MEDIUM',
  SLOW: 'SLOW'
});
import { Invoice } from '@getalby/lightning-tools';
import { fiatRatesService } from '../utils/fiatRates.js';
import { isBitcoinAddress } from '../utils/addressUtils.js';

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
  DEFAULT_MEMPOOL_API: 'https://mempool.space/api'
};

/**
 * Default Spark account numbers per network.
 * These match the Spark SDK defaults — always pass explicitly to avoid
 * breakage if the SDK defaults ever change.
 * Derivation path: m/8797555'/accountNumber'/keyType'
 *
 * Per Spark docs: MAINNET defaults to 1 (legacy compatibility), REGTEST to 0.
 * TESTNET/SIGNET/LOCAL not specified — using 0 (non-mainnet convention).
 */
export const SPARK_ACCOUNT_DEFAULTS = {
  MAINNET: 1,
  TESTNET: 0,
  SIGNET: 0,
  REGTEST: 0,
  LOCAL: 0,
};

export class SparkWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.wallet = null;
    this.mnemonic = null;
    this.sparkAddress = null;
    this.network = walletData.network || 'MAINNET';
    this.accountNumber = walletData.accountNumber ?? SPARK_ACCOUNT_DEFAULTS[this.network];

    // Sync state tracking for UI feedback
    this.isSyncing = false;
    this.syncReason = null;
  }

  /**
   * Set syncing state for UI feedback
   * @param {boolean} syncing - Whether wallet is currently syncing
   * @param {string|null} reason - Reason for sync (e.g., 'claiming_deposit')
   */
  setSyncing(syncing, reason = null) {
    this.isSyncing = syncing;
    this.syncReason = reason;
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
   * Calculate fallback max routing fee for Lightning payments.
   * Only used when getLightningSendFeeEstimate() fails — the SDK estimate
   * is always preferred when available.
   *
   * Per Spark docs (https://docs.spark.money/wallet-sdk/lightning/withdraw):
   * "set the maximum routing fee to whichever is greater: 5 sats (minimum)
   * or 17 bps × transaction amount (0.17%)".
   *
   * @param {number} amountSats - Payment amount in satoshis
   * @returns {number} Recommended max fee in satoshis
   */
  static calculateRecommendedFee(amountSats) {
    return Math.max(5, Math.ceil(amountSats * 0.0017));
  }

  /**
   * UTF-8 byte length of a string. Used for the 120-byte memo cap that
   * Spark enforces on Lightning invoice memos.
   */
  static _utf8ByteLength(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).length;
    }
    // Defensive fallback for non-browser test runners that lack TextEncoder.
    return unescape(encodeURIComponent(str)).length;
  }

  /**
   * Normalize the SDK's `expiresAt` into a Unix-seconds integer.
   *
   * The Spark SDK has surfaced this as either an ISO-8601 string or a
   * numeric millisecond timestamp depending on version. We accept both,
   * and fall back to a 24h-from-now estimate (the documented default
   * invoice lifetime) when the SDK omits the field.
   */
  static _coerceExpiresAt(value) {
    const FALLBACK_SECONDS = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    if (value == null) return FALLBACK_SECONDS;

    if (typeof value === 'number') {
      // Heuristic: values < 1e12 look like seconds; larger are milliseconds.
      return value < 1e12 ? Math.floor(value) : Math.floor(value / 1000);
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    }

    return FALLBACK_SECONDS;
  }

  /**
   * Detect transient transport errors from the Spark SDK / gRPC-Web layer.
   * These indicate the request never reached (or got a response from) the SO
   * federation — typically a browser fetch failure ("Load failed" on Safari,
   * "Failed to fetch" on Chromium) or a gRPC transport fault. Safe to retry
   * for idempotent operations only.
   */
  static isTransientTransportError(err) {
    const msg = String(err?.message || err || '');
    return /Transport error|Load failed|Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
  }

  /**
   * Retry an idempotent SDK call on transient transport errors.
   * Non-transport errors bubble up immediately.
   */
  async _withTransportRetry(operation, { attempts = 3, baseDelayMs = 300 } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        const isLast = i === attempts - 1;
        if (isLast || !SparkWalletProvider.isTransientTransportError(err)) {
          throw err;
        }
        const delay = baseDelayMs * Math.pow(3, i); // 300ms, 900ms
        console.warn(`Spark transport error (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, err.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
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
        accountNumber: this.accountNumber,
        options: { network: this.network }
      });

      this.wallet = result.wallet;
      this.isConnected = true;
      this.clearError();

      // Cache Spark address
      this.sparkAddress = await this.wallet.getSparkAddress();

      // Enable privacy mode — hides address and transactions from Sparkscan and public APIs
      this.enablePrivacyMode();

      return true;
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Create a new wallet with fresh mnemonic
   * @param {string} network - Network to use
   * @param {number} [accountNumber] - Account derivation index (default per network)
   * @returns {Promise<{wallet: SparkWallet, mnemonic: string}>}
   */
  static async createNewWallet(network = 'MAINNET', accountNumber) {
    const account = accountNumber ?? SPARK_ACCOUNT_DEFAULTS[network];
    try {
      const result = await SparkWallet.initialize({
        mnemonicOrSeed: undefined, // Generate new mnemonic
        accountNumber: account,
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
   * Probe a mnemonic + account derivation for existing on-chain activity.
   *
   * Used by the restore flow to detect pre-v1.6.0 mainnet wallets, which
   * lived on accountNumber = 0 before the Spark SDK changed its mainnet
   * default to 1 for backwards compatibility. A detected legacy account is
   * mapped to the Personal slot during restore so funds remain accessible.
   *
   * The wallet connection is always torn down before returning so the
   * probe is side-effect-free.
   *
   * @param {string} mnemonic
   * @param {string} network
   * @param {number} accountNumber
   * @returns {Promise<{ hasActivity: boolean, balance: number, transferCount: number }>}
   */
  static async probeAccountActivity(mnemonic, network, accountNumber) {
    let wallet = null;
    try {
      const { wallet: probeWallet } = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        accountNumber,
        options: { network },
      });
      wallet = probeWallet;

      const [{ balance }, transfersResult] = await Promise.all([
        wallet.getBalance(),
        wallet.getTransfers(1, 0),
      ]);

      const balanceSats = Number(balance || 0);
      const transferCount = (transfersResult?.transfers || []).length;

      return {
        hasActivity: balanceSats > 0 || transferCount > 0,
        balance: balanceSats,
        transferCount,
      };
    } finally {
      if (wallet) {
        try {
          wallet.cleanupConnections();
        } catch (err) {
          console.warn('probeAccountActivity: cleanup failed', err);
        }
      }
    }
  }

  /**
   * Restore wallet from existing mnemonic (for validation during restore)
   * @param {string} mnemonic
   * @param {string} network
   * @param {number} [accountNumber] - Account derivation index (default per network)
   * @returns {Promise<SparkWallet>}
   */
  static async restoreWallet(mnemonic, network = 'MAINNET', accountNumber) {
    const account = accountNumber ?? SPARK_ACCOUNT_DEFAULTS[network];
    try {
      const result = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        accountNumber: account,
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
    // Clear any cached identity-derived data so a future reconnect on
    // the same provider instance can't leak the previous wallet's
    // address into a new session.
    this._cachedL1Address = null;
  }

  /**
   * Enable privacy mode — hides wallet address, balance, and transaction history
   * from Sparkscan and public API queries. Runs in the background so it doesn't
   * block wallet initialization.
   */
  enablePrivacyMode() {
    if (!this.wallet) return;

    this.wallet.setPrivacyEnabled(true).catch((error) => {
      console.warn('Could not enable privacy mode:', error.message);
    });
  }

  async getBalance() {
    this._ensureConnected();

    try {
      // Spark SDK ≥ 0.7 returns
      //   { balance, satsBalance: { available, owned, incoming }, tokenBalances }
      // The top-level `balance` field is deprecated and slated for removal in
      // 0.8 — read from `satsBalance.available` and fall back to the legacy
      // field so an unexpected SDK shape never causes a hard failure here.
      const result = await this.wallet.getBalance();
      const available = result?.satsBalance?.available ?? result?.balance ?? 0n;

      return {
        balance: Number(available), // Convert from bigint to number
        pending: Number(result?.satsBalance?.incoming ?? 0n),
        tokenBalances: result?.tokenBalances || []
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
   * Create a Lightning invoice for receiving payments.
   *
   * Per Spark docs (https://docs.spark.money/wallet-sdk/lightning/deposit):
   *   - `memo` is capped at 120 bytes (UTF-8) and is mutually exclusive
   *     with `descriptionHash`.
   *   - `includeSparkAddress` (fallback field) and `includeSparkInvoice`
   *     (routing hints) are mutually exclusive — pick one or neither.
   *   - The actual expiry comes from the SDK in `result.invoice.expiresAt`;
   *     the SDK does not accept a caller-supplied expiry.
   *
   * @param {Object} options
   * @param {number} options.amount - Amount in satoshis (0 for zero-amount invoices)
   * @param {string} [options.description] - Optional memo (≤ 120 bytes UTF-8)
   * @param {boolean} [options.includeSparkAddress=true] - Embed Spark address in BOLT11 fallback field
   * @param {boolean} [options.includeSparkInvoice=false] - Embed Spark invoice in BOLT11 routing hints (newer; preferred for Spark-aware payers)
   * @param {string} [options.descriptionHash] - Hash of a longer description (LNURL/UMA); cannot be combined with `description`
   * @returns {Promise<{paymentRequest: string, paymentHash: string, id: string, expiresAt: number}>}
   */
  async createInvoice({
    amount,
    description,
    includeSparkAddress,
    includeSparkInvoice = false,
    descriptionHash = null
  }) {
    this._ensureConnected();

    // Mutual exclusion only fires when the caller explicitly opts into
    // both. We leave `includeSparkAddress` unset by default so the natural
    // call `createInvoice({ amount, includeSparkInvoice: true })` works
    // without forcing every caller to also pass `includeSparkAddress: false`.
    if (includeSparkAddress === true && includeSparkInvoice === true) {
      throw new Error(
        'createInvoice: includeSparkAddress and includeSparkInvoice are mutually exclusive'
      );
    }
    if (description && descriptionHash) {
      throw new Error(
        'createInvoice: description and descriptionHash are mutually exclusive'
      );
    }

    // Default to embedding the Spark address (zero-fee Spark transfers when
    // a Spark-aware payer scans the BOLT11) unless the caller picked the
    // newer routing-hints variant or explicitly opted out.
    const useSparkAddress = includeSparkAddress ?? !includeSparkInvoice;

    const invoiceParams = {
      amountSats: amount,
      includeSparkAddress: useSparkAddress,
      includeSparkInvoice
    };

    if (descriptionHash) {
      invoiceParams.descriptionHash = descriptionHash;
    } else if (description) {
      // Spark caps memos at 120 UTF-8 bytes — fail fast with a clear error
      // instead of letting the SDK surface a generic validation failure.
      const memoBytes = SparkWalletProvider._utf8ByteLength(description);
      if (memoBytes > 120) {
        throw new Error(
          `Invoice memo too long: ${memoBytes} bytes (max 120). Shorten the description.`
        );
      }
      invoiceParams.memo = description;
    }

    try {
      const result = await this._withTransportRetry(
        () => this.wallet.createLightningInvoice(invoiceParams)
      );

      // Spark SDK returns LightningReceiveRequest:
      // { id, invoice: { encodedInvoice, paymentHash, expiresAt, ... }, status, ... }
      const invoiceString = result.invoice?.encodedInvoice;

      if (!invoiceString || typeof invoiceString !== 'string') {
        console.error('Unexpected invoice response from Spark SDK:', result);
        throw new Error('Invalid invoice response from Spark wallet');
      }

      return {
        paymentRequest: invoiceString,
        paymentHash: result.invoice?.paymentHash || null,
        id: result.id, // Invoice ID for monitoring with getLightningReceiveRequest()
        expiresAt: SparkWalletProvider._coerceExpiresAt(result.invoice?.expiresAt)
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Pay a Lightning invoice.
   *
   * The Spark SDK's `payLightningInvoice` returns as soon as the payment is
   * accepted for routing — the response status is often still PENDING. Per
   * Spark docs the `transfer:claimed` event does NOT fire for outgoing
   * payments, so we poll `getLightningSendRequest` until the payment reaches
   * a terminal state (COMPLETED or FAILED). This guarantees callers receive
   * a final status and an accurate preimage/fee, never a transient PENDING
   * that silently flips to FAILED later.
   *
   * Set `awaitCompletion: false` for fire-and-forget callers that handle
   * polling themselves.
   *
   * @param {Object} options
   * @param {string} options.invoice - BOLT11-encoded Lightning invoice
   * @param {number} [options.maxFee] - Max fee in sats (defaults to SDK estimate + buffer)
   * @param {boolean} [options.preferSpark=false] - Use Spark transfer if invoice carries a Spark address
   * @param {number} [options.amountSats] - Amount for zero-amount invoices (auto-detected)
   * @param {boolean} [options.awaitCompletion=true] - Poll until terminal status
   * @param {number} [options.completionTimeoutMs=60000] - Max time to wait before returning PENDING
   * @returns {Promise<{id: string|null, preimage: string|null, fee: number, status: string}>}
   */
  async payInvoice({
    invoice,
    maxFee,
    preferSpark = false,
    amountSats = null,
    awaitCompletion = true,
    completionTimeoutMs = 60000
  }) {
    this._ensureConnected();

    try {
      // Decode invoice to check if it's a zero-amount invoice
      // This prevents errors from passing amountSats to fixed-amount invoices
      const invoiceInfo = SparkWalletProvider.decodeInvoiceAmount(invoice);
      const invoiceAmount = invoiceInfo.amount || amountSats || 10000; // Fallback for fee calculation

      // Use provided maxFee or get estimate from Spark SDK
      // Following Spark docs: getLightningSendFeeEstimate() + small buffer
      let effectiveMaxFee = maxFee;

      if (!effectiveMaxFee) {
        try {
          const feeEstimate = await this.getLightningSendFeeEstimate(invoice, amountSats);
          // Spark docs recommend: SDK estimate + a small buffer.
          effectiveMaxFee = feeEstimate.estimatedFeeSats + 5;
        } catch (error) {
          console.warn('Spark fee estimation failed:', error.message);
          // Doc-aligned fallback: max(5 sats, 17 bps).
          effectiveMaxFee = SparkWalletProvider.calculateRecommendedFee(invoiceAmount);
        }
      }

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
      return await this._finalizeOutgoingPayment(payment, {
        awaitCompletion,
        completionTimeoutMs
      });
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Resolve an outgoing Lightning payment to a terminal status.
   *
   * Behaviour by initial SDK response:
   *   - COMPLETED → return immediately.
   *   - FAILED    → throw (so callers' existing try/catch handles it).
   *   - PENDING   → poll `getLightningSendRequest`. A subsequent FAILED
   *                 throws; COMPLETED returns; a polling timeout returns
   *                 with status PENDING so the UI can show "still routing"
   *                 without falsely claiming success.
   *
   * Skips polling entirely when the caller opts out via `awaitCompletion`
   * or when there is no payment ID (synchronous Spark-direct transfers).
   *
   * @private
   */
  async _finalizeOutgoingPayment(payment, { awaitCompletion, completionTimeoutMs }) {
    const initialStatus = this._normalizePaymentStatus(payment.status);

    if (initialStatus === PAYMENT_STATUS.FAILED) {
      throw new Error('Lightning payment failed');
    }

    const skipPolling =
      !awaitCompletion ||
      initialStatus === PAYMENT_STATUS.COMPLETED ||
      !payment.id;

    if (skipPolling) {
      return {
        id: payment.id || null,
        preimage: payment.preimage || null,
        fee: payment.feeSats || 0,
        status: initialStatus
      };
    }

    let final;
    try {
      final = await this.waitForPaymentCompletion(payment.id, {
        timeoutMs: completionTimeoutMs
      });
    } catch (error) {
      // Timeout is the only error path here — surface as PENDING, not failure.
      console.warn(
        'Spark Lightning payment did not settle within timeout, returning pending:',
        error.message
      );
      return {
        id: payment.id,
        preimage: payment.preimage || null,
        fee: payment.feeSats || 0,
        status: PAYMENT_STATUS.PENDING
      };
    }

    if (final.status === PAYMENT_STATUS.FAILED) {
      throw new Error('Lightning payment failed');
    }

    return {
      id: final.id,
      preimage: final.preimage,
      fee: final.fee,
      status: final.status
    };
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

      // SDK returns fee as direct number (per Spark docs)
      const feeSats = typeof estimate === 'number' ? estimate : (estimate?.feeSats || estimate?.estimatedFeeSats || 0);

      return {
        estimatedFeeSats: feeSats,
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

    // The SSP API's getLightningReceiveRequest expects a request ID (UUID),
    // not a payment hash. A 64-char hex string is a payment hash — calling
    // the SSP endpoint with one fails GraphQL ID validation, so we skip
    // straight to the transfer-list scan in that case.
    const isPaymentHash = typeof paymentHash === 'string' && /^[0-9a-f]{64}$/i.test(paymentHash);

    try {
      if (!isPaymentHash) {
        const receiveRequest = await this.wallet.getLightningReceiveRequest(paymentHash);

        if (receiveRequest) {
          const status = String(receiveRequest.status || '').toUpperCase();
          return {
            paid: status.includes('COMPLETED') || status.includes('CLAIMED'),
            preimage: receiveRequest.preimage || null,
            amount: Number(receiveRequest.amount || receiveRequest.invoice?.amountSats || 0)
          };
        }
      }

      // Search recent transfers by payment hash
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
        description: this._decodeBase64Memo(transfer.userRequest?.invoice?.memo) || '',
        status: this._normalizeStatus(transfer.status),
        fee: Number(transfer.feeSats || transfer.fees || transfer.fee || 0),
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
   * Decode base64-encoded memo from Spark SDK.
   * Returns the original string if it's not valid base64.
   */
  _decodeBase64Memo(memo) {
    if (!memo) return '';
    try {
      const decoded = atob(memo);
      // Verify it decoded to printable text (not binary garbage)
      if (/^[\x20-\x7E\xA0-\xFF]*$/.test(decoded) && decoded.length > 0) {
        return decoded;
      }
      return memo;
    } catch {
      return memo;
    }
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

    let utxos = null;
    let usedBaseUrl = null;
    let lastError = null;

    // Try each configured mempool source until one succeeds.
    for (const baseUrl of this._mempoolBaseUrls()) {
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
   * Classify a confirmed Bitcoin deposit for auto-claim handling.
   *
   * Pure: no UI side effects, no claim attempt — fetches the quote and
   * returns a category the orchestration layer (Wallet.vue) acts on.
   *
   * Categories:
   *   - 'eligible'       — auto-claim is safe; fee within thresholds.
   *   - 'needs_approval' — fee exceeds threshold; user should confirm.
   *   - 'too_small'      — deposit below dust floor; offer to send back.
   *   - 'quote_failed'   — quote lookup failed; treat as manual.
   *
   * The returned `quote` is reused by the eventual claim call so we
   * don't pay for two SSP roundtrips per deposit. `classifiedAt` lets
   * callers detect stale quotes (e.g. when the user takes minutes to
   * approve a `needs_approval` prompt) and refetch via
   * {@link refreshClassificationQuote} before claiming.
   *
   * @param {Object} deposit - One entry from getPendingDeposits()
   * @returns {Promise<{
   *   category: 'eligible' | 'needs_approval' | 'too_small' | 'quote_failed',
   *   quote: object|null,
   *   feeSats: number,
   *   feeRatio: number,
   *   classifiedAt: number,
   *   error?: Error
   * }>}
   */
  async classifyConfirmedDeposit(deposit) {
    if (!deposit?.txId || !deposit?.confirmed) {
      throw new Error('classifyConfirmedDeposit requires a confirmed deposit');
    }

    const depositAmountSats = Number(deposit.amount || 0);

    if (depositAmountSats < AUTO_CLAIM_THRESHOLDS.MIN_DEPOSIT_SATS) {
      // Don't even bother with a quote — the deposit is below the floor
      // where auto-claim makes sense. The orchestrator surfaces this as
      // "tiny deposit" so the user can choose to send back.
      return {
        category: 'too_small',
        quote: null,
        feeSats: 0,
        feeRatio: 0,
        classifiedAt: Date.now()
      };
    }

    let quote;
    try {
      quote = await this.getClaimFeeQuote(deposit.txId, deposit.outputIndex || 0);
    } catch (error) {
      return {
        category: 'quote_failed',
        quote: null,
        feeSats: 0,
        feeRatio: 0,
        classifiedAt: Date.now(),
        error
      };
    }

    const creditAmountSats = Number(quote?.creditAmountSats || 0);
    const feeSats = Math.max(0, depositAmountSats - creditAmountSats);
    const feeRatio = depositAmountSats > 0 ? feeSats / depositAmountSats : 1;

    const withinAbsoluteCap = feeSats <= AUTO_CLAIM_THRESHOLDS.MAX_FEE_SATS;
    const withinRelativeCap = feeRatio <= AUTO_CLAIM_THRESHOLDS.MAX_FEE_RATIO;

    return {
      category: withinAbsoluteCap && withinRelativeCap ? 'eligible' : 'needs_approval',
      quote,
      feeSats,
      feeRatio,
      classifiedAt: Date.now()
    };
  }

  /**
   * Refresh a stale classification's quote without re-running the
   * threshold logic. Returns a new classification object with the same
   * `category` but an up-to-date `quote`, `feeSats`, `feeRatio`, and
   * `classifiedAt`. Falls back to the original classification on error
   * so callers can attempt the optimistic claim either way.
   *
   * Used by the orchestration layer when a `needs_approval` notification
   * sat in the user's tray for longer than the freshness window
   * (`CLASSIFICATION_FRESHNESS_MS`) before they tapped Add to wallet.
   */
  async refreshClassificationQuote(deposit, previousClassification) {
    if (!previousClassification?.quote) return previousClassification;

    try {
      const quote = await this.getClaimFeeQuote(deposit.txId, deposit.outputIndex || 0);
      const depositAmountSats = Number(deposit.amount || 0);
      const creditAmountSats = Number(quote?.creditAmountSats || 0);
      const feeSats = Math.max(0, depositAmountSats - creditAmountSats);
      const feeRatio = depositAmountSats > 0 ? feeSats / depositAmountSats : 1;

      return {
        ...previousClassification,
        quote,
        feeSats,
        feeRatio,
        classifiedAt: Date.now()
      };
    } catch (error) {
      console.warn('Could not refresh claim quote, using prior:', error?.message || error);
      return previousClassification;
    }
  }

  /**
   * Claim a Bitcoin deposit using quote data.
   *
   * The SDK's `claimStaticDeposit` returns `{ transferId } | null` — it does
   * NOT echo back the credited amount. Source the amount from the quote
   * (which the caller already has) and surface the transferId for tracking.
   *
   * @param {string} txId - Transaction ID of the deposit
   * @param {object} quoteData - Quote data from getClaimFeeQuote()
   * @param {number} [outputIndex=0]
   * @returns {Promise<{success: boolean, amount: number, transferId: string|null, processing?: boolean, message?: string}>}
   */
  async claimDeposit(txId, quoteData, outputIndex = 0) {
    this._ensureConnected();

    const creditAmountSats = Number(quoteData?.creditAmountSats || 0);

    this.setSyncing(true, 'claiming_deposit');

    try {
      const result = await this.wallet.claimStaticDeposit({
        transactionId: txId,
        outputIndex,
        creditAmountSats,
        sspSignature: quoteData.signature
      });

      this.setSyncing(false);
      return {
        success: true,
        amount: creditAmountSats,
        transferId: result?.transferId || null
      };
    } catch (error) {
      this.setSyncing(false);
      const errorMsg = String(error?.message || '').toLowerCase();

      // TRANSFER_LOCKED means the claim is already being processed by a
      // concurrent background stream — not a failure, just a race we
      // surface as "in progress".
      if (errorMsg.includes('transfer_locked') || (errorMsg.includes('leaf') && errorMsg.includes('locked'))) {
        console.log('Claim already in progress (TRANSFER_LOCKED), will complete shortly');
        return {
          success: true,
          processing: true,
          message: 'Claim is being processed. Your balance will update shortly.',
          amount: creditAmountSats,
          transferId: null
        };
      }

      // Friendly error mapping. Order matters: dust check first because
      // its message contains the word "fee".
      if (errorMsg.includes('dust') || errorMsg.includes('less than the dust')) {
        throw new Error('Deposit too small to claim — the fee would exceed the amount.');
      }
      if (errorMsg.includes('confirm')) {
        throw new Error('Deposit needs more confirmations. Please wait.');
      }
      if (errorMsg.includes('fee')) {
        throw new Error('Claim fee has changed. Please try again.');
      }
      this.setError(error);
      throw error;
    }
  }

  /**
   * Get a fee quote for an L1 (on-chain) Bitcoin withdrawal.
   *
   * Returns the SDK-authoritative breakdown for all three exit speeds. Per
   * Spark docs (https://docs.spark.money/wallet-sdk/lightning/withdraw-l1)
   * we surface the SSP's own `userFee*` and `l1BroadcastFee*` values — we
   * do not derive the network fee from third-party mempool data, because
   * the SSP batches and broadcasts the actual transaction and its number
   * is what the user is charged.
   *
   * @param {number} amountSats - Amount to withdraw in satoshis
   * @param {string} destinationAddress - Bitcoin address to withdraw to
   * @returns {Promise<{
   *   slow:    {serviceFee: number, networkFee: number, totalFee: number, feeQuoteId: string, timeEstimate: string},
   *   medium:  {serviceFee: number, networkFee: number, totalFee: number, feeQuoteId: string, timeEstimate: string},
   *   fast:    {serviceFee: number, networkFee: number, totalFee: number, feeQuoteId: string, timeEstimate: string},
   *   expiresAt: number
   * }>}
   */
  async getWithdrawalFeeQuote(amountSats, destinationAddress) {
    this._ensureConnected();

    if (!this._isValidBitcoinAddress(destinationAddress)) {
      throw new Error('Invalid Bitcoin address');
    }

    let quote;
    try {
      quote = await this.wallet.getWithdrawalFeeQuote({
        amountSats,
        withdrawalAddress: destinationAddress
      });
    } catch (error) {
      this.setError(error);
      throw error;
    }

    if (!quote) {
      throw new Error('No withdrawal fee quote available right now. Please try again.');
    }

    return {
      slow: SparkWalletProvider._buildL1FeeTier(quote, 'Slow', '~1 hour'),
      medium: SparkWalletProvider._buildL1FeeTier(quote, 'Medium', '~30 min'),
      fast: SparkWalletProvider._buildL1FeeTier(quote, 'Fast', 'Next block'),
      expiresAt: SparkWalletProvider._coerceExpiresAt(quote.expiresAt)
    };
  }

  /**
   * Build a single fee tier from a CoopExitFeeQuote.
   *
   * Reads the per-speed `userFee*` (Spark service fee) and `l1BroadcastFee*`
   * (on-chain broadcast fee) currency amounts and sums them into a total
   * that matches what the SSP will charge when this quote is used.
   *
   * @private
   */
  static _buildL1FeeTier(quote, suffix, timeEstimate) {
    const userFee = Number(quote[`userFee${suffix}`]?.originalValue || 0);
    const networkFee = Number(quote[`l1BroadcastFee${suffix}`]?.originalValue || 0);
    return {
      serviceFee: userFee,
      networkFee,
      totalFee: userFee + networkFee,
      feeQuoteId: quote.id,
      timeEstimate
    };
  }

  /**
   * Map our 'slow' | 'medium' | 'fast' speed key to the SDK's ExitSpeed enum.
   * Defaults to MEDIUM for unknown inputs to fail safe rather than reject.
   */
  static _toExitSpeed(speed) {
    const key = String(speed || '').toUpperCase();
    if (key === 'FAST' || key === ExitSpeed.FAST) return ExitSpeed.FAST;
    if (key === 'SLOW' || key === ExitSpeed.SLOW) return ExitSpeed.SLOW;
    return ExitSpeed.MEDIUM;
  }

  /**
   * Withdraw to an L1 Bitcoin address (cooperative exit).
   *
   * Per Spark docs, the SDK's `withdraw()` requires:
   *   - `onchainAddress` (the destination)
   *   - `exitSpeed` from the {@link ExitSpeed} enum
   *   - `feeQuoteId` from a prior `getWithdrawalFeeQuote()`
   *   - `feeAmountSats` — the locked-in total (`userFee*` + `l1BroadcastFee*`)
   *     for the selected speed. Without this the SSP can recompute fees and
   *     the user may be charged a different amount than what the UI showed.
   *   - `deductFeeFromWithdrawalAmount` — we send `false` so callers can
   *     reason about "amount sent" and "fee paid" as independent numbers
   *     (the doc default of `true` would silently shrink the recipient's
   *     received amount by the fee).
   *
   * @param {Object} options
   * @param {number} options.amountSats - Amount to withdraw in satoshis
   * @param {string} options.destinationAddress - Bitcoin address to withdraw to
   * @param {string} [options.speed='medium'] - 'slow' | 'medium' | 'fast'
   * @param {string} options.feeQuoteId - Fee quote ID from getWithdrawalFeeQuote()
   * @param {number} options.feeAmountSats - Total fee in sats for the chosen speed
   * @param {boolean} [options.deductFeeFromWithdrawalAmount=false] - If true, the SSP subtracts the fee from `amountSats` instead of charging it on top
   * @returns {Promise<{requestId: string, status: string, amount: number}>}
   */
  async withdrawToL1({
    amountSats,
    destinationAddress,
    speed = 'medium',
    feeQuoteId,
    feeAmountSats,
    deductFeeFromWithdrawalAmount = false
  }) {
    this._ensureConnected();

    if (!this._isValidBitcoinAddress(destinationAddress)) {
      throw new Error('Invalid Bitcoin address');
    }
    if (!feeQuoteId) {
      throw new Error('Missing feeQuoteId — call getWithdrawalFeeQuote() first');
    }
    if (typeof feeAmountSats !== 'number' || feeAmountSats < 0) {
      throw new Error('Missing or invalid feeAmountSats');
    }

    try {
      const result = await this.wallet.withdraw({
        onchainAddress: destinationAddress,
        exitSpeed: SparkWalletProvider._toExitSpeed(speed),
        amountSats,
        feeQuoteId,
        feeAmountSats,
        deductFeeFromWithdrawalAmount
      });

      if (!result?.id) {
        throw new Error('Withdrawal failed — SSP did not return a request ID');
      }

      return {
        requestId: result.id,
        status: SparkWalletProvider._normalizeCoopExitStatus(result.status),
        amount: amountSats
      };
    } catch (error) {
      // Friendlier copy for the two errors users hit most often.
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('balance') || msg.includes('insufficient')) {
        throw new Error('Insufficient balance for this withdrawal');
      }
      if (msg.includes('quote') || msg.includes('expired')) {
        throw new Error('Fee quote expired. Please try again.');
      }
      this.setError(error);
      throw error;
    }
  }

  /**
   * Check the status of an L1 withdrawal request.
   *
   * @param {string} requestId - Withdrawal request ID from withdrawToL1()
   * @returns {Promise<{
   *   id: string,
   *   status: 'pending' | 'broadcasting' | 'completed' | 'failed' | 'expired',
   *   rawStatus: string|null,
   *   txId: string|null,
   *   isComplete: boolean,
   *   isFailed: boolean
   * }>}
   */
  async getWithdrawalStatus(requestId) {
    this._ensureConnected();

    try {
      const request = await this.wallet.getCoopExitRequest(requestId);
      if (!request) {
        return {
          id: requestId,
          status: 'pending',
          rawStatus: null,
          txId: null,
          isComplete: false,
          isFailed: false
        };
      }

      const status = SparkWalletProvider._normalizeCoopExitStatus(request.status);
      const txId = request.coopExitTxid || null;
      // Treat "broadcast with txid" as terminal-for-UX. The SSP doesn't
      // promote to SUCCEEDED until N on-chain confirmations, which often
      // takes >30 min and would loop the spinner toast past our timeout.
      // From the user's perspective the funds have left and the tx is
      // verifiable on mempool — that's success enough to dismiss the
      // spinner and show "Bitcoin sent" with a tap-to-view link.
      const isBroadcastedWithTx = status === 'broadcasting' && !!txId;
      return {
        id: request.id,
        status,
        rawStatus: request.status || null,
        txId,
        isComplete: status === 'completed' || isBroadcastedWithTx,
        isFailed: status === 'failed' || status === 'expired'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Poll an L1 withdrawal until it reaches a terminal state.
   *
   * Spark docs explicitly note that withdrawals don't emit events, so
   * polling is the recommended monitoring strategy. Resolves with the
   * final status object once `isComplete` or `isFailed` is true; rejects
   * on timeout so callers can surface "still settling" UX.
   *
   * @param {string} requestId
   * @param {Object} [options]
   * @param {number} [options.intervalMs=15000] - Poll interval (default 15s)
   * @param {number} [options.timeoutMs=1800000] - Max wait (default 30min)
   * @param {Function} [options.onStatusChange] - Callback fired on each distinct status transition
   * @returns {Promise<Object>}
   */
  async waitForWithdrawalCompletion(requestId, options = {}) {
    const {
      intervalMs = 15000,
      timeoutMs = 30 * 60 * 1000,
      onStatusChange = null
    } = options;

    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.getWithdrawalStatus(requestId);

      if (onStatusChange && result.status !== lastStatus) {
        onStatusChange(result);
        lastStatus = result.status;
      }

      if (result.isComplete || result.isFailed) {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Withdrawal status check timed out');
  }

  /**
   * Map the SDK's SparkCoopExitRequestStatus enum onto a small set of UI
   * states. Done as exact-match (with a lowercase fallback) so we never
   * silently misclassify a status the way substring matching could.
   */
  static _normalizeCoopExitStatus(status) {
    if (!status) return 'pending';
    const upper = String(status).toUpperCase();
    switch (upper) {
      case 'SUCCEEDED':
        return 'completed';
      case 'FAILED':
        return 'failed';
      case 'EXPIRED':
        return 'expired';
      case 'TX_BROADCASTED':
      case 'WAITING_ON_TX_CONFIRMATIONS':
        return 'broadcasting';
      case 'INITIATED':
      case 'INBOUND_TRANSFER_CHECKED':
      case 'TX_SIGNED':
      default:
        return 'pending';
    }
  }

  /**
   * Validate Bitcoin address format
   * Supports mainnet (bc1, 1, 3) and testnet (tb1, m, n, 2)
   */
  _isValidBitcoinAddress(address) {
    return isBitcoinAddress(address);
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
   * Refund a Bitcoin deposit back to a destination address.
   *
   * Per Spark docs, `refundAndBroadcastStaticDeposit` requires:
   *   - `depositTransactionId` (the original deposit txid)
   *   - `destinationAddress` (where the refund goes)
   *   - `satsPerVbyteFee` (fee rate for the refund tx)
   *
   * For the "send back to the original sender" UX we auto-derive the
   * destination from the deposit transaction's first input via the
   * mempool API. Callers can override either field — useful for an
   * "advanced" UI that lets the user pick their own destination or fee.
   *
   * Returns the broadcast transaction id (a hex string per the SDK).
   *
   * @param {Object} options
   * @param {string} options.txId - Deposit transaction ID
   * @param {number} [options.outputIndex=0]
   * @param {string} [options.destinationAddress] - Override destination; defaults to the deposit tx's first input address
   * @param {number} [options.satsPerVbyteFee] - Override fee rate (sat/vB); defaults to mempool's recommended halfHourFee
   * @returns {Promise<{success: boolean, txId: string|null, destinationAddress: string, satsPerVbyteFee: number}>}
   */
  async refundDeposit({ txId, outputIndex = 0, destinationAddress, satsPerVbyteFee } = {}) {
    this._ensureConnected();

    if (!txId) {
      throw new Error('Refund requires a deposit transaction ID');
    }

    const [resolvedAddress, resolvedFee] = await Promise.all([
      destinationAddress
        ? Promise.resolve(destinationAddress)
        : this._deriveSenderAddress(txId),
      satsPerVbyteFee != null
        ? Promise.resolve(satsPerVbyteFee)
        : this._fetchRecommendedFeeRate('halfHour')
    ]);

    if (!resolvedAddress) {
      throw new Error(
        'Could not determine refund destination. Provide an address manually.'
      );
    }
    if (!this._isValidBitcoinAddress(resolvedAddress)) {
      throw new Error('Refund destination is not a valid Bitcoin address');
    }
    if (!Number.isFinite(resolvedFee) || resolvedFee < 1) {
      throw new Error('Could not determine a valid refund fee rate');
    }

    try {
      const broadcastedTxId = await this.wallet.refundAndBroadcastStaticDeposit({
        depositTransactionId: txId,
        outputIndex,
        destinationAddress: resolvedAddress,
        satsPerVbyteFee: Math.ceil(resolvedFee)
      });

      return {
        success: true,
        txId: typeof broadcastedTxId === 'string' ? broadcastedTxId : null,
        destinationAddress: resolvedAddress,
        satsPerVbyteFee: Math.ceil(resolvedFee)
      };
    } catch (error) {
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('not found')) {
        throw new Error('Deposit not found or already claimed');
      }
      if (msg.includes('confirm')) {
        throw new Error('Deposit needs more confirmations');
      }
      this.setError(error);
      throw error;
    }
  }

  /**
   * Look up a Bitcoin transaction via the mempool API and return the
   * address of its first input (the closest analogue to "the sender").
   * Returns `null` if the lookup fails or the address can't be parsed —
   * callers must handle that case (e.g. by asking the user to enter one).
   *
   * @private
   */
  async _deriveSenderAddress(txId) {
    for (const baseUrl of this._mempoolBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/tx/${txId}`);
        if (!response.ok) continue;
        const tx = await response.json();
        const senderAddress = tx?.vin?.[0]?.prevout?.scriptpubkey_address;
        if (senderAddress) return senderAddress;
      } catch (e) {
        // Try the next base URL.
        continue;
      }
    }
    return null;
  }

  /**
   * Fetch a recommended sat/vB fee rate from the mempool API. Used as a
   * default when callers don't pass an explicit `satsPerVbyteFee` to
   * `refundDeposit`. Falls back to a conservative 5 sat/vB if every
   * configured mempool source is unreachable.
   *
   * @private
   */
  async _fetchRecommendedFeeRate(tier = 'halfHour') {
    const tierKey = {
      fastest: 'fastestFee',
      halfHour: 'halfHourFee',
      hour: 'hourFee'
    }[tier] || 'halfHourFee';

    for (const baseUrl of this._mempoolBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/v1/fees/recommended`);
        if (!response.ok) continue;
        const fees = await response.json();
        const rate = Number(fees?.[tierKey]);
        if (Number.isFinite(rate) && rate >= 1) return rate;
      } catch (e) {
        continue;
      }
    }

    return 5; // Conservative fallback; reasonable for non-urgent refunds.
  }

  /**
   * Mempool base URLs to try, in priority order. Honors the user's
   * configured mempool endpoint and falls back to mempool.space.
   *
   * @private
   */
  _mempoolBaseUrls() {
    const customUrl = fiatRatesService.getApiUrl().replace(/\/+$/, '').replace(/\/v1$/, '');
    const fallbackUrl = BITCOIN_L1.DEFAULT_MEMPOOL_API;
    return customUrl !== fallbackUrl ? [customUrl, fallbackUrl] : [fallbackUrl];
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
