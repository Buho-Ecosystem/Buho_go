/**
 * BreezSparkWalletProvider - Spark wallet on the Breez SDK engine
 *
 * Drop-in sibling of SparkWalletProvider: it implements the exact same
 * public contract (method names, argument shapes, return shapes, units,
 * status vocabularies, and user-facing error strings) on top of
 * @breeztech/breez-sdk-spark, so every consumer — Wallet.vue orchestration,
 * receive/kiosk monitors, deposit classifier UI, batch send, auto-withdraw,
 * tax report — runs unchanged regardless of the engine WalletFactory picks.
 *
 * Both engines derive the identical wallet: same mnemonic + same account
 * number = same Spark identity, funds, and on-network history (purpose path
 * m/8797555'/{account}'). initializeWithMnemonic() additionally asserts this
 * at runtime against the wallet's stored spark address and auto-reverts the
 * device to the direct engine on any mismatch.
 *
 * Engine-specific notes (full rationale: Plans WIP/breez-spark-migration.md):
 *  - Breez `PaymentDetails` is a flattened tagged union — every read goes
 *    through a discriminant switch on `details.type`, never property access
 *    on a variant name.
 *  - Amounts: Breez reports amount and fees separately; BuhoGO's normalizer
 *    expects fee-inclusive gross on sends, so rows re-add the fee.
 *  - No SDK-side auto-claiming (config bounds it to 0): the app's classifier
 *    remains the only claimer, exactly as with the direct engine.
 *  - Invoice ids are BOLT11 payment hashes (Breez has no receive-request
 *    UUID); status lookups scan listPayments for the hash.
 *  - The instance registry, event fan-out, and churn-surviving caches live
 *    in services/breezSdk.js.
 *
 * Static wallet creation/restore/probing stays on SparkWalletProvider for
 * the duration of the dual-engine phase (identical derivation makes the
 * results engine-independent).
 */

import { WalletProvider } from './WalletProvider.js';
import { AUTO_CLAIM_THRESHOLDS } from '../stores/bitcoinPreferences.js';
import { Invoice } from '@getalby/lightning-tools';
import { parseSuccessAction } from '../utils/successAction.js';
import { validateVerifyUrl } from '../utils/lnurlVerify.js';
import { lnurlGetJson } from '../utils/lnurlHttp.js';
import { buildLnurlPayCallbackUrl } from '../utils/lnurlPay.js';
import { fiatRatesService } from '../utils/fiatRates.js';
import { isBitcoinAddress } from '../utils/addressUtils.js';
import { identityPublicKeyFromSparkAddress } from '../utils/sparkPayment.js';
import { registerRandomLightningAddress } from '../utils/lightningAddressNames.js';
import { setSparkEngine } from '../config/breez.js';
import * as breezSdk from '../services/breezSdk.js';
import {
  BREEZ_PAYMENT_STATUS as PAYMENT_STATUS,
  detailsArm,
  paymentHashOf,
  preimageOf,
  mapBreezPaymentToTx,
  mapWithdrawFeeQuoteToTiers,
  pickBolt11Route,
  claimErrorKind,
  classifyFromMatureQuote,
  withdrawalStatusFromPayment,
} from '../utils/breezPayments.js';

const BITCOIN_L1 = {
  REQUIRED_CONFIRMATIONS: 3,
  DEFAULT_MEMPOOL_API: 'https://mempool.space/api'
};

export class BreezSparkWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    this.sdk = walletData?._testSdk || null;
    this.mnemonic = null;
    this.sparkAddress = null;
    this.network = walletData.network || 'MAINNET';
    this.accountNumber = walletData.accountNumber ?? (this.network === 'MAINNET' ? 1 : 0);

    this.isSyncing = false;
    this.syncReason = null;

    this._identityPubkey = null;
    this._lightningAddress = null;
    this._cachedL1Address = null;
    this._eventUnsubscribers = new Set();
    // invoice -> { prepareResponse, at } (fee estimate reused by the send)
    this._preparedSends = new Map();
  }

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

  static calculateRecommendedFee(amountSats) {
    return Math.max(5, Math.ceil(amountSats * 0.0017));
  }

  static _utf8ByteLength(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).length;
    }
    return unescape(encodeURIComponent(str)).length;
  }

  static _truncateMemoToBytes(str, maxBytes = 120) {
    if (!str) return str;
    if (typeof TextEncoder !== 'undefined') {
      const encoder = new TextEncoder();
      if (encoder.encode(str).length <= maxBytes) return str;
      let lo = 0, hi = str.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return str.slice(0, lo);
    }
    while (unescape(encodeURIComponent(str)).length > maxBytes) {
      str = str.slice(0, -1);
    }
    return str;
  }

  static isTransientTransportError(err) {
    const msg = String(err?.message || err || '');
    return /Transport error|Load failed|Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
  }

  async _withTransportRetry(operation, { attempts = 3, baseDelayMs = 300 } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        const isLast = i === attempts - 1;
        if (isLast || !BreezSparkWalletProvider.isTransientTransportError(err)) {
          throw err;
        }
        const delay = baseDelayMs * Math.pow(3, i);
        console.warn(`Breez transport error (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, err.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

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
      console.warn('Invoice decode failed, assuming fixed amount:', error.message);
      return { amount: null, isZeroAmount: false };
    }
  }

  // ==========================================
  // Connection lifecycle
  // ==========================================

  /**
   * Connect this wallet on the Breez engine. Same contract as the direct
   * provider: resolves `true`, sets isConnected, caches the spark address.
   * The registry in breezSdk dedupes live instances per wallet, so calling
   * this repeatedly (startup, switch, poll, self-heal) reuses one SDK.
   */
  async initializeWithMnemonic(mnemonic, { forceReinit = false } = {}) {
    try {
      if (!this.sdk || forceReinit) {
        const entry = await breezSdk.acquire(this.walletId, {
          mnemonic,
          accountNumber: this.accountNumber,
          network: this.network,
          forceReinit,
        });
        this.sdk = entry.sdk;
      }
      // Deliberately NOT retained: every reconnect path re-decrypts the
      // phrase, and provider objects can be replaced without disconnect -
      // holding the plaintext here would only widen its lifetime.
      this.mnemonic = null;

      const info = await this.sdk.getInfo({});
      this._identityPubkey = info?.identityPubkey || null;

      await this._assertSameIdentity();

      this.sparkAddress = await this._resolveSparkAddress();
      this.isConnected = true;
      this.connectionError = null;

      // Best-effort nicety, never a connect gate. The Lightning-address
      // cache fills through the store's ensureLightningAddress step after
      // the connect completes.
      this._armPrivacyMode();

      return true;
    } catch (error) {
      this.isConnected = false;
      this.setError(error);
      throw error;
    }
  }

  /**
   * Both engines must land on the same wallet. The stored spark address (or
   * its identity pubkey) is the direct engine's ground truth; if the Breez
   * instance reports a different identity, connecting would show a stranger's
   * wallet — refuse, and flip the device back to the proven engine.
   */
  async _assertSameIdentity() {
    const expected = this.walletData?.metadata?.sparkAddress
      || this.walletData?.expectedSparkAddress
      || null;
    if (!expected || !this._identityPubkey) return;

    let expectedPubkey = null;
    try {
      expectedPubkey = identityPublicKeyFromSparkAddress(expected);
    } catch (e) {
      return; // Unparseable stored address — nothing to assert against.
    }
    if (!expectedPubkey) return;

    const got = String(this._identityPubkey).toLowerCase();
    if (String(expectedPubkey).toLowerCase() !== got) {
      setSparkEngine('direct');
      await breezSdk.release(this.walletId);
      this.sdk = null;
      const err = new Error(
        'Wallet engine mismatch detected — reverted to the standard engine. Please reconnect.'
      );
      err.code = 'BREEZ_IDENTITY_MISMATCH';
      throw err;
    }
  }

  async _resolveSparkAddress() {
    const response = await this.sdk.receivePayment({
      paymentMethod: { type: 'sparkAddress' }
    });
    return response?.paymentRequest || null;
  }

  _armPrivacyMode() {
    try {
      this.sdk.updateUserSettings({ sparkPrivateModeEnabled: true }).catch((e) => {
        console.warn('Could not enable Spark privacy mode:', e?.message || e);
      });
    } catch (e) {
      console.warn('Could not enable Spark privacy mode:', e?.message || e);
    }
  }

  /**
   * Make sure this wallet holds a Lightning address, assigning one when
   * needed. The rule is that every Spark wallet on this engine has one.
   *
   * Resolution order:
   *   1. The server already has an address for this identity — keep it.
   *      (Registrations are server-side per pubkey, so restored wallets
   *      find their old address here and nothing is overwritten.)
   *   2. The server confirms NONE, but this wallet is on record as having
   *      held one (`previousAddress`) — re-register that exact username.
   *      The server reserves a released name for the pubkey that released
   *      it, so asking for it back restores the wallet precisely; if the
   *      name has since moved on, the request is refused and a fresh name
   *      is minted, which is the right answer in that case.
   *   3. Mint a random {adjective}{animal}{digits} name, retrying on
   *      collision.
   *
   * Throws when the server LOOKUP fails: registering blind could orphan an
   * address that actually exists. Callers retry on the next connect.
   *
   * @param {Object} [options]
   * @param {string|null} [options.previousAddress] - last address this
   *   wallet is known to have held (user@domain or bare username)
   * @returns {Promise<string>} the wallet's address (kept, reclaimed, or new)
   */
  async ensureLightningAddress({ previousAddress = null } = {}) {
    this._ensureConnected();

    let info;
    try {
      info = await this.sdk.getLightningAddress();
    } catch (error) {
      throw new Error('Lightning address lookup failed — skipped auto-registration');
    }
    if (info?.lightningAddress) {
      this._lightningAddress = info.lightningAddress;
      return info.lightningAddress;
    }

    const previousUsername = previousAddress
      ? String(previousAddress).trim().split('@')[0]
      : '';
    if (previousUsername) {
      try {
        const reclaimed = await this.sdk.registerLightningAddress({ username: previousUsername });
        if (reclaimed?.lightningAddress) {
          this._lightningAddress = reclaimed.lightningAddress;
          return reclaimed.lightningAddress;
        }
      } catch (err) {
        console.warn('Could not reclaim the previous Lightning address:', err?.message || err);
      }
    }

    return registerRandomLightningAddress(this);
  }

  async connect() {
    if (!this.sdk) {
      throw new Error(
        'Spark wallet requires mnemonic to connect. Use initializeWithMnemonic()'
      );
    }
  }

  async disconnect() {
    for (const unsub of this._eventUnsubscribers) {
      try { unsub(); } catch (e) { /* ignore */ }
    }
    this._eventUnsubscribers.clear();
    this._preparedSends.clear();

    await breezSdk.release(this.walletId);

    this.sdk = null;
    this.mnemonic = null;
    this.sparkAddress = null;
    this._identityPubkey = null;
    this._lightningAddress = null;
    this._cachedL1Address = null;
    this.isConnected = false;
  }

  enablePrivacyMode() {
    if (this.sdk) this._armPrivacyMode();
  }

  _ensureConnected() {
    if (!this.sdk || !this.isConnected) {
      throw new Error('Spark wallet is not connected');
    }
  }

  // ==========================================
  // Balance + info
  // ==========================================

  /**
   * Authoritative balance — money decisions (auto-withdraw, Use-all, spend
   * checks) read this. Asks the SDK to sync first, bounded so a slow sync
   * degrades to the local number instead of hanging the caller.
   */
  async getBalance() {
    this._ensureConnected();

    try {
      let info;
      try {
        // The synced read can outlive the race on a slow sync; keep its
        // rejection handled so losing the race never surfaces as an
        // unhandled promise rejection.
        const synced = this.sdk.getInfo({ ensureSynced: true });
        synced.catch(() => {});
        info = await Promise.race([
          synced,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('breez sync timeout')), 15000)
          ),
        ]);
      } catch (e) {
        info = await this.sdk.getInfo({});
      }

      return {
        balance: Number(info?.balanceSats ?? 0),
        // The direct SDK's `incoming` (pending Spark transfers) has no Breez
        // equivalent — transfers are claimed automatically; deposits surface
        // through the dedicated deposit flow, not here.
        pending: 0,
        tokenBalances: []
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Local (unsynced) balance read — display use only; spend/max logic must
   * keep reading getBalance(). Same shape.
   */
  async getCachedBalance() {
    this._ensureConnected();

    try {
      const info = await this.sdk.getInfo({});
      return {
        balance: Number(info?.balanceSats ?? 0),
        pending: 0,
        tokenBalances: []
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
        pubkey: this._identityPubkey,
        lightningAddress: this._lightningAddress,
        sparkAddress,
        type: 'spark'
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getSparkAddress() {
    this._ensureConnected();
    if (this.sparkAddress) return this.sparkAddress;
    this.sparkAddress = await this._resolveSparkAddress();
    return this.sparkAddress;
  }

  // ==========================================
  // Lightning address (Breez engine feature)
  // ==========================================

  /** Cached user@domain, or null when none is registered / domain dormant. */
  getLightningAddressSync() {
    return this._lightningAddress;
  }

  async getLightningAddress() {
    this._ensureConnected();
    try {
      const info = await this.sdk.getLightningAddress();
      this._lightningAddress = info?.lightningAddress || null;
      return info || null;
    } catch (error) {
      return null;
    }
  }

  async checkLightningAddressAvailable(username) {
    this._ensureConnected();
    return this.sdk.checkLightningAddressAvailable({ username });
  }

  async registerLightningAddress(username, description = undefined) {
    this._ensureConnected();
    const info = await this.sdk.registerLightningAddress({ username, description });
    this._lightningAddress = info?.lightningAddress || null;
    return info;
  }

  async deleteLightningAddress() {
    this._ensureConnected();
    await this.sdk.deleteLightningAddress();
    this._lightningAddress = null;
  }

  // ==========================================
  // Lightning receive
  // ==========================================

  async createInvoice({
    amount,
    description,
    includeSparkAddress,
    includeSparkInvoice = false,
    descriptionHash = null
  }) {
    this._ensureConnected();

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
    if (descriptionHash) {
      // The Breez receive API has no description-hash field; refusing loudly
      // beats minting an invoice that doesn't match what the caller asked for.
      throw new Error('createInvoice: descriptionHash is not supported on this engine');
    }

    const memo = BreezSparkWalletProvider._truncateMemoToBytes(description || '');
    const amountSats = Number(amount) > 0 ? Math.round(Number(amount)) : undefined;

    try {
      const response = await this._withTransportRetry(() =>
        this.sdk.receivePayment({
          paymentMethod: {
            type: 'bolt11Invoice',
            description: memo,
            amountSats,
          }
        })
      );

      const paymentRequest = response?.paymentRequest;
      if (!paymentRequest) {
        throw new Error('Invalid invoice response from Spark wallet');
      }

      let paymentHash = null;
      let expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      try {
        const decoded = new Invoice({ pr: paymentRequest });
        paymentHash = decoded.paymentHash || null;
        if (decoded.expiryDate instanceof Date) {
          expiresAt = Math.floor(decoded.expiryDate.getTime() / 1000);
        }
      } catch (e) {
        console.warn('Could not decode minted invoice:', e?.message || e);
      }

      if (paymentHash) {
        breezSdk.rememberInvoice(paymentHash, {
          expiresAt,
          createdAt: Math.floor(Date.now() / 1000),
        });
      }

      return {
        paymentRequest,
        paymentHash,
        // Breez has no receive-request UUID; the payment hash is the stable
        // identifier every status lookup on this engine accepts.
        id: paymentHash,
        expiresAt
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  /**
   * Find the receive payment for an invoice id (payment hash). A bolt11
   * invoice can settle over Lightning OR as a direct Spark transfer, so both
   * detail arms are checked. Scans newest-first with paging.
   */
  async _findReceiveByHash(paymentHash, { maxPages = 3, pageSize = 100 } = {}) {
    const record = breezSdk.getInvoiceRecord(paymentHash);
    // Without a record (foreign restart, pre-persistence invoice) bound the
    // scan to the last 24h - the maximum invoice lifetime this engine mints -
    // instead of walking the whole history every poll tick.
    const fromTimestamp = record?.createdAt
      ? record.createdAt - 60
      : Math.floor(Date.now() / 1000) - 24 * 60 * 60;

    for (let page = 0; page < maxPages; page++) {
      const response = await this.sdk.listPayments({
        typeFilter: ['receive'],
        fromTimestamp,
        offset: page * pageSize,
        limit: pageSize,
        sortAscending: false,
      });
      const payments = response?.payments || [];
      const match = payments.find((p) => paymentHashOf(p) === paymentHash);
      if (match) return match;
      if (payments.length < pageSize) return null;
    }
    return null;
  }

  async getLightningReceiveStatus(invoiceId) {
    this._ensureConnected();

    try {
      const payment = await this._findReceiveByHash(invoiceId);
      const record = breezSdk.getInvoiceRecord(invoiceId);
      const isExpired = !!(record?.expiresAt && Math.floor(Date.now() / 1000) > record.expiresAt);

      if (!payment) {
        return {
          id: invoiceId,
          status: isExpired ? 'expired' : PAYMENT_STATUS.PENDING,
          isPaid: false,
          isExpired,
          amount: 0,
          amountReceived: 0,
          preimage: null
        };
      }

      const arm = detailsArm(payment, 'lightning', 'spark');
      const isPaid = payment.status === PAYMENT_STATUS.COMPLETED;
      return {
        id: invoiceId,
        status: payment.status,
        isPaid,
        isExpired: !isPaid && isExpired,
        amount: Number(payment.amount),
        amountReceived: isPaid ? Number(payment.amount) : 0,
        preimage: arm?.htlcDetails?.preimage || null
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async lookupInvoice(paymentHash) {
    this._ensureConnected();

    try {
      const isHash = /^[0-9a-f]{64}$/i.test(String(paymentHash || ''));
      let payment = null;

      if (isHash) {
        payment = await this._findReceiveByHash(paymentHash);
      } else if (paymentHash) {
        try {
          const response = await this.sdk.getPayment({ paymentId: paymentHash });
          payment = response?.payment || null;
        } catch (e) {
          payment = null;
        }
      }

      if (!payment || payment.status !== PAYMENT_STATUS.COMPLETED) {
        return { paid: false, preimage: null, amount: 0 };
      }
      const arm = detailsArm(payment, 'lightning', 'spark');
      return {
        paid: true,
        preimage: arm?.htlcDetails?.preimage || null,
        amount: Number(payment.amount)
      };
    } catch (error) {
      // Transport/connection failures must PROPAGATE - PaymentMonitor bails
      // out after consecutive throws, and a swallowed error would keep a
      // dead wallet "waiting for payment" for the full poll budget.
      if (BreezSparkWalletProvider.isTransientTransportError(error)
        || String(error?.message || '').includes('not connected')) {
        this.setError(error);
        throw error;
      }
      return { paid: false, preimage: null, amount: 0 };
    }
  }

  async waitForInvoicePayment(invoiceId, options = {}) {
    const {
      intervalMs = 3000,
      timeoutMs = 300000,
      onStatusChange = null
    } = options;

    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
      const status = await this.getLightningReceiveStatus(invoiceId);
      if (onStatusChange && status.status !== lastStatus) {
        onStatusChange(status);
        lastStatus = status.status;
      }
      if (status.isPaid || status.isExpired) return status;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('Invoice payment check timed out');
  }

  // ==========================================
  // Lightning send
  // ==========================================

  /**
   * Prepare a send for a raw payment request (bolt11 / spark address /
   * spark invoice / bitcoin address). Cached briefly per input so the
   * fee-estimate → pay sequence costs one SDK prepare, not two.
   */
  async _prepareSend(input, { amountSats = null, fresh = false } = {}) {
    const key = `${input}::${amountSats ?? ''}`;
    if (!fresh) {
      const cached = this._preparedSends.get(key);
      if (cached && Date.now() - cached.at < 30000) {
        return cached.prepareResponse;
      }
    }

    const doPrepare = () => this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input },
      amount: amountSats != null ? BigInt(Math.round(amountSats)) : undefined,
    });

    let prepareResponse;
    try {
      prepareResponse = await doPrepare();
    } catch (error) {
      // "Failed to select leaves" = the wallet is mid-optimization; a sync
      // then one retry resolves it. Prepare moves no funds — safe to retry.
      if (String(error?.message || '').toLowerCase().includes('failed to select leaves')) {
        try { await this.sdk.syncWallet({}); } catch (e) { /* best-effort */ }
        prepareResponse = await doPrepare();
      } else {
        throw error;
      }
    }

    this._preparedSends.set(key, { prepareResponse, at: Date.now() });
    if (this._preparedSends.size > 12) {
      const oldest = this._preparedSends.keys().next().value;
      this._preparedSends.delete(oldest);
    }
    return prepareResponse;
  }

  /**
   * Drop cached prepares for an input once a send consumed them - a retry
   * of the same destination must go through a fresh prepare, never re-submit
   * an already-spent prepare response.
   */
  _consumePrepared(input) {
    for (const key of this._preparedSends.keys()) {
      if (key.startsWith(`${input}::`)) this._preparedSends.delete(key);
    }
  }

  async getLightningSendFeeEstimate(invoice, amountSats = null) {
    this._ensureConnected();

    const cleanInvoice = String(invoice || '').replace(/^lightning:/i, '');
    try {
      const decoded = BreezSparkWalletProvider.decodeInvoiceAmount(cleanInvoice);
      const prep = await this._prepareSend(cleanInvoice, {
        amountSats: decoded.isZeroAmount ? amountSats : null,
      });
      const pm = prep?.paymentMethod;
      if (pm?.type !== 'bolt11Invoice') {
        throw new Error('Not a Lightning invoice');
      }
      // Estimate with the SAME route selection payInvoice will make - every
      // in-app Spark send passes preferSpark, and this estimate flows back
      // in as payInvoice's fee cap, so a cheaper-rail estimate against a
      // preferred-rail send would refuse payable invoices.
      const { routeFee } = pickBolt11Route({
        sparkTransferFeeSats: pm.sparkTransferFeeSats,
        lightningFeeSats: pm.lightningFeeSats,
        preferSpark: true,
      });
      return { estimatedFeeSats: routeFee, invoice: cleanInvoice };
    } catch (error) {
      // Same fallback chain as the direct engine: for a zero-amount invoice
      // with no amount hint, assume 10k sats so the percentage floor never
      // produces a 5-sat cap that blocks the eventual send.
      const fallbackAmount = BreezSparkWalletProvider.decodeInvoiceAmount(cleanInvoice).amount
        || amountSats
        || 10000;
      return {
        estimatedFeeSats: BreezSparkWalletProvider.calculateRecommendedFee(fallbackAmount),
        invoice: cleanInvoice,
        isEstimated: true
      };
    }
  }

  async payInvoice({
    invoice,
    maxFee = null,
    preferSpark = false,
    amountSats = null,
    awaitCompletion = true,
    completionTimeoutMs = 60000
  }) {
    this._ensureConnected();

    const cleanInvoice = String(invoice || '').replace(/^lightning:/i, '');

    try {
      const decoded = BreezSparkWalletProvider.decodeInvoiceAmount(cleanInvoice);
      const prep = await this._prepareSend(cleanInvoice, {
        amountSats: decoded.isZeroAmount ? amountSats : null,
      });
      const pm = prep?.paymentMethod;
      if (pm?.type !== 'bolt11Invoice') {
        throw new Error('Not a Lightning invoice');
      }

      const { useSpark, routeFee } = pickBolt11Route({
        sparkTransferFeeSats: pm.sparkTransferFeeSats,
        lightningFeeSats: pm.lightningFeeSats,
        preferSpark,
      });

      // The engine has no SDK-side fee cap; enforce the caller's cap against
      // the quoted route fee before any funds move. The cap carries the same
      // +5 sat headroom the direct engine bakes into its default, so a quote
      // refreshed between estimate and send doesn't refuse over rounding.
      const feeCap = typeof maxFee === 'number' ? maxFee + 5 : routeFee + 5;
      if (routeFee > feeCap) {
        throw new Error(
          `Lightning payment failed: fee ${routeFee} sats exceeds the ${feeCap} sats limit`
        );
      }

      const sendResponse = await this.sdk.sendPayment({
        prepareResponse: prep,
        options: {
          type: 'bolt11Invoice',
          preferSpark: useSpark,
          completionTimeoutSecs: awaitCompletion
            ? Math.max(1, Math.round(completionTimeoutMs / 1000))
            : 1,
        },
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : undefined,
      });

      this._consumePrepared(cleanInvoice);

      const payment = sendResponse?.payment;
      if (!payment) {
        throw new Error('Lightning payment failed');
      }
      if (payment.status === PAYMENT_STATUS.FAILED) {
        throw new Error('Lightning payment failed');
      }

      return {
        id: payment.id || null,
        preimage: preimageOf(payment),
        fee: Number(payment.fees ?? 0),
        status: payment.status === PAYMENT_STATUS.COMPLETED
          ? PAYMENT_STATUS.COMPLETED
          : PAYMENT_STATUS.PENDING
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getLightningSendStatus(paymentId) {
    this._ensureConnected();

    try {
      const response = await this.sdk.getPayment({ paymentId });
      const payment = response?.payment;
      if (!payment) {
        return { id: paymentId, status: PAYMENT_STATUS.PENDING, amount: 0, fee: 0, preimage: null, isComplete: false, isFailed: false };
      }
      const arm = detailsArm(payment, 'lightning', 'spark');
      return {
        id: payment.id,
        status: payment.status,
        amount: Number(payment.amount ?? 0),
        fee: Number(payment.fees ?? 0),
        preimage: arm?.htlcDetails?.preimage || null,
        isComplete: payment.status === PAYMENT_STATUS.COMPLETED,
        isFailed: payment.status === PAYMENT_STATUS.FAILED
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async waitForPaymentCompletion(paymentId, { intervalMs = 3000, timeoutMs = 60000, onStatusChange = null } = {}) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.getLightningSendStatus(paymentId);
      if (onStatusChange && result.status !== lastStatus) {
        onStatusChange(result);
        lastStatus = result.status;
      }
      if (result.isComplete || result.isFailed) return result;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('Payment status check timed out');
  }

  async payLightningAddress(lightningAddress, amountSats, comment = '', payout = null) {
    this._ensureConnected();

    try {
      const [username, domain] = lightningAddress.split('@');
      if (!username || !domain) {
        throw new Error('Invalid Lightning address format');
      }

      const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      const response = await lnurlGetJson(lnurlEndpoint);

      if (!response.ok) {
        throw new Error('Failed to fetch Lightning address info');
      }

      const lnurlData = response.data;
      if (!lnurlData || lnurlData.status === 'ERROR') {
        throw new Error(lnurlData?.reason || 'Failed to fetch Lightning address info');
      }

      if (!(payout && payout.code && payout.amount > 0)) {
        const minSendable = Math.ceil((lnurlData.minSendable || 1000) / 1000);
        const maxSendable = Math.floor((lnurlData.maxSendable || 100000000000) / 1000);
        if (amountSats < minSendable || amountSats > maxSendable) {
          throw new Error(`Amount must be between ${minSendable} and ${maxSendable} sats`);
        }
      }
      const callbackUrl = buildLnurlPayCallbackUrl({
        callback: lnurlData.callback,
        amountSats,
        payout,
        comment,
        commentAllowed: lnurlData.commentAllowed,
      });

      const invoiceResponse = await lnurlGetJson(callbackUrl);
      if (!invoiceResponse.ok) {
        throw new Error('Failed to get invoice from Lightning address');
      }

      const invoiceData = invoiceResponse.data;

      if (!invoiceData || invoiceData.status === 'ERROR') {
        throw new Error(invoiceData?.reason || 'Failed to get invoice');
      }
      if (!invoiceData.pr) {
        throw new Error('No payment request received from Lightning address');
      }

      // Invoice already carries the amount — passing amountSats would be
      // rejected (zero-amount invoices only).
      const result = await this.payInvoice({
        invoice: invoiceData.pr,
        preferSpark: true
      });

      return {
        ...result,
        lightningAddress: lightningAddress,
        successAction: parseSuccessAction(invoiceData.successAction, lnurlData.callback),
        verify: validateVerifyUrl(invoiceData.verify, lnurlData.callback),
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Spark-native transfers
  // ==========================================

  async transferToSparkAddress(sparkAddress, amount) {
    this._ensureConnected();

    if (!WalletProvider.isSparkAddress(sparkAddress)) {
      throw new Error('Invalid Spark address');
    }
    const amountSats = Number(amount);
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      throw new Error('Invalid transfer amount');
    }

    try {
      const prep = await this._prepareSend(sparkAddress, {
        amountSats,
        fresh: true,
      });
      if (prep?.paymentMethod?.type !== 'sparkAddress') {
        throw new Error('Invalid Spark address');
      }

      const sendResponse = await this.sdk.sendPayment({
        prepareResponse: prep,
        options: { type: 'sparkAddress' },
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : undefined,
      });

      this._consumePrepared(sparkAddress);

      const payment = sendResponse?.payment;
      if (!payment || payment.status === PAYMENT_STATUS.FAILED) {
        throw new Error('Spark transfer failed');
      }
      return {
        id: payment.id || null,
        status: payment.status || PAYMENT_STATUS.COMPLETED
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async createSparkInvoice({ amountSats = null, memo = '', expirySeconds = 3600 } = {}) {
    this._ensureConnected();

    const expiryTime = Math.floor(Date.now() / 1000) + expirySeconds;
    const response = await this.sdk.receivePayment({
      paymentMethod: {
        type: 'sparkInvoice',
        // The WASM binding requires the field to exist; null = amountless.
        amount: amountSats != null ? String(Math.round(amountSats)) : null,
        description: memo || undefined,
        expiryTime,
      }
    });

    return {
      invoice: response?.paymentRequest || null,
      amountSats: amountSats != null ? Math.round(amountSats) : null,
      memo,
      expiresAt: new Date(expiryTime * 1000).toISOString()
    };
  }

  async fulfillSparkInvoice(invoice, { amountSats = null } = {}) {
    this._ensureConnected();

    try {
      const prep = await this._prepareSend(invoice, {
        amountSats: amountSats != null ? Number(amountSats) : null,
        fresh: true,
      });
      const pm = prep?.paymentMethod;
      if (pm?.type !== 'sparkInvoice') {
        throw new Error('Not a valid Spark invoice');
      }
      // WASM serde round-trip quirk: an absent optional amount comes back as
      // a missing key, but re-submitting the prepare response requires the
      // key to exist (null = none). Harmless once fixed upstream.
      if (pm.sparkInvoiceDetails && pm.sparkInvoiceDetails.amount === undefined) {
        pm.sparkInvoiceDetails.amount = null;
      }

      const sendResponse = await this.sdk.sendPayment({
        prepareResponse: prep,
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : undefined,
      });

      this._consumePrepared(invoice);

      const payment = sendResponse?.payment;
      if (!payment) {
        throw new Error('Spark invoice payment did not complete');
      }
      if (payment.status === PAYMENT_STATUS.FAILED) {
        throw new Error('Spark invoice payment failed');
      }
      return {
        id: payment.id || null,
        status: payment.status || PAYMENT_STATUS.COMPLETED
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async querySparkInvoiceStatus(invoice) {
    this._ensureConnected();

    try {
      const response = await this.sdk.listPayments({ limit: 100, sortAscending: false });
      const payments = response?.payments || [];
      const match = payments.find((p) => {
        const arm = detailsArm(p, 'spark');
        return arm?.invoiceDetails?.invoice === invoice;
      });
      if (!match) return 'NOT_FOUND';
      if (match.status === PAYMENT_STATUS.COMPLETED) return 'FINALIZED';
      return 'PENDING';
    } catch (error) {
      return 'UNRECOGNIZED';
    }
  }

  // ==========================================
  // Transaction history
  // ==========================================

  async getTransactions({ limit = 50, offset = 0 } = {}) {
    this._ensureConnected();

    try {
      const response = await this._withTransportRetry(() =>
        this.sdk.listPayments({ offset, limit, sortAscending: false })
      );
      return (response?.payments || []).map((p) => mapBreezPaymentToTx(p));
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Events
  // ==========================================

  /**
   * Incoming-payment notifications. Fires the callback only for settled
   * receives (the closest analogue of the direct SDK's `transfer:claimed`);
   * outgoing payments and deposit bookkeeping events never reach it.
   */
  onPaymentReceived(callback) {
    this._ensureConnected();

    const unsub = breezSdk.subscribe(this.walletId, (event) => {
      if (event?.type !== 'paymentSucceeded') return;
      const payment = event.payment;
      if (!payment || payment.paymentType !== 'receive') return;

      Promise.resolve()
        .then(async () => {
          let balance = 0;
          try {
            const info = await this.sdk.getInfo({});
            balance = Number(info?.balanceSats ?? 0);
          } catch (e) { /* balance is best-effort in the callback */ }
          callback(payment.id, balance);
        })
        .catch((e) => console.warn('onPaymentReceived callback failed:', e?.message || e));
    });

    this._eventUnsubscribers.add(unsub);
    return () => {
      this._eventUnsubscribers.delete(unsub);
      unsub();
    };
  }

  onConnectionChange(onConnect, onDisconnect) {
    // The Breez engine exposes no stream-connection events; the registry
    // rebuilds dead instances on demand instead. Contract-compatible no-op.
    return () => {};
  }

  // ==========================================
  // L1 deposits
  // ==========================================

  async getL1DepositAddress() {
    this._ensureConnected();

    if (this._cachedL1Address) {
      return this._cachedL1Address;
    }

    try {
      const response = await this.sdk.receivePayment({
        paymentMethod: { type: 'bitcoinAddress' }
      });
      const address = response?.paymentRequest;
      if (!address) {
        throw new Error('No deposit address available');
      }
      this._cachedL1Address = address;
      return address;
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getPendingDeposits() {
    this._ensureConnected();

    const address = await this.getL1DepositAddress();

    let utxos = null;
    let usedBaseUrl = null;
    let lastError = null;

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

    if (utxos === null) {
      console.error('[L1 Deposit] Failed to fetch UTXOs from mempool API:', lastError?.message || 'Unknown error');
      return [];
    }

    if (utxos.length === 0) {
      return [];
    }

    let currentHeight = 0;
    try {
      const heightResponse = await fetch(`${usedBaseUrl}/blocks/tip/height`);
      if (heightResponse.ok) {
        currentHeight = await heightResponse.json();
      }
    } catch (e) {
      console.warn('[L1 Deposit] Could not fetch block height, confirmations may be inaccurate');
    }

    const requiredConfirmations = BITCOIN_L1.REQUIRED_CONFIRMATIONS;
    return utxos.map(utxo => {
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
  }

  /**
   * Fee quote for claiming a deposit. The engine returns both a mature and
   * (when offered) an instant quote in one call; this surfaces the mature
   * leg in the direct-engine shape and carries feeSats for the claim call.
   */
  async getClaimFeeQuote(txId, outputIndex = 0) {
    this._ensureConnected();

    try {
      const quote = await this.sdk.fetchClaimDepositQuote({ txid: txId, vout: outputIndex });
      const mature = quote?.mature;
      if (!mature) {
        throw new Error('No claim quote available');
      }
      return {
        creditAmountSats: Number(mature.creditAmountSats || 0),
        feeSats: Number(mature.feeSats || 0),
        signature: null,
        transactionId: txId,
        outputIndex
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async classifyConfirmedDeposit(deposit) {
    if (!deposit?.txId || !deposit?.confirmed) {
      throw new Error('classifyConfirmedDeposit requires a confirmed deposit');
    }

    const depositAmountSats = Number(deposit.amount || 0);

    if (depositAmountSats < AUTO_CLAIM_THRESHOLDS.MIN_DEPOSIT_SATS) {
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

    const { category, feeSats, feeRatio } = classifyFromMatureQuote({
      depositAmountSats,
      quote,
      thresholds: AUTO_CLAIM_THRESHOLDS,
    });

    return { category, quote, feeSats, feeRatio, classifiedAt: Date.now() };
  }

  async refreshClassificationQuote(deposit, previousClassification) {
    if (!previousClassification?.quote) return previousClassification;

    try {
      const quote = await this.getClaimFeeQuote(deposit.txId, deposit.outputIndex || 0);
      const { feeSats, feeRatio } = classifyFromMatureQuote({
        depositAmountSats: Number(deposit.amount || 0),
        quote,
        thresholds: AUTO_CLAIM_THRESHOLDS,
      });

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

  async classifyUnconfirmedDeposit(deposit) {
    if (!deposit?.txId || deposit.confirmed) {
      throw new Error('classifyUnconfirmedDeposit requires an unconfirmed deposit');
    }

    let quote;
    try {
      quote = await this.sdk.fetchClaimDepositQuote({
        txid: deposit.txId,
        vout: deposit.outputIndex || 0,
      });
    } catch (error) {
      return { category: 'quote_failed', quote: null, plan: null, creditSats: 0, feeSats: 0, classifiedAt: Date.now(), error };
    }

    const instant = quote?.instant;
    if (!instant) {
      return { category: 'no_instant_plan', quote: null, plan: null, creditSats: 0, feeSats: 0, classifiedAt: Date.now() };
    }

    const creditSats = Number(instant.creditAmountSats || 0);
    const feeSats = Number(instant.feeSats || 0);

    return {
      category: 'instant',
      quote: { transactionId: deposit.txId, outputIndex: deposit.outputIndex || 0, creditAmountSats: creditSats, feeSats },
      plan: instant,
      creditSats,
      feeSats,
      classifiedAt: Date.now(),
    };
  }

  async claimInstantDeposit(txId, quote, plan, outputIndex = 0) {
    this._ensureConnected();

    this.setSyncing(true, 'claiming_deposit');
    try {
      const feeSats = Number(plan?.feeSats ?? quote?.feeSats ?? 0);
      const result = await this.sdk.claimDeposit({
        txid: txId,
        vout: outputIndex,
        maxFee: { type: 'fixed', amount: feeSats },
      });
      // The response's payment is optional; callers durably mark the txid
      // claimed on our success, so a resolve WITHOUT an executed claim must
      // fail loudly - the 0-conf path degrades to the 3-conf flow, never to
      // a deposit silently excluded from every claim path.
      if (!result?.payment) {
        throw new Error('Instant claim was not accepted');
      }
      return { success: true, claimId: result.payment.id || null };
    } finally {
      this.setSyncing(false);
    }
  }

  async claimDeposit(txId, quoteData, outputIndex = 0) {
    this._ensureConnected();

    const creditAmountSats = Number(quoteData?.creditAmountSats || 0);
    const maxFeeSats = Number(
      quoteData?.feeSats != null ? quoteData.feeSats : Math.max(0, Number(quoteData?.amount || 0) - creditAmountSats)
    );

    this.setSyncing(true, 'claiming_deposit');

    try {
      const result = await this.sdk.claimDeposit({
        txid: txId,
        vout: outputIndex,
        maxFee: { type: 'fixed', amount: maxFeeSats },
      });

      this.setSyncing(false);
      // A mature claim that resolves without a payment object is treated as
      // still processing (the SDK finishes it on sync), mirroring the
      // TRANSFER_LOCKED semantics - success either way, so the claimed
      // registry records the txid and the user isn't re-prompted.
      if (!result?.payment) {
        return {
          success: true,
          processing: true,
          message: 'Claim is being processed. Your balance will update shortly.',
          amount: creditAmountSats,
          transferId: null
        };
      }
      return {
        success: true,
        amount: creditAmountSats,
        transferId: result.payment.id || null
      };
    } catch (error) {
      this.setSyncing(false);

      const kind = claimErrorKind(error?.message);
      // A claim already running (or already done) is a race, not a failure —
      // callers must still record the txid as claimed.
      if (kind === 'processing') {
        console.log('Claim already in progress, will complete shortly');
        return {
          success: true,
          processing: true,
          message: 'Claim is being processed. Your balance will update shortly.',
          amount: creditAmountSats,
          transferId: null
        };
      }
      if (kind === 'too_small') {
        throw new Error('Deposit too small to claim — the fee would exceed the amount.');
      }
      if (kind === 'confirmations') {
        throw new Error('Deposit needs more confirmations. Please wait.');
      }
      if (kind === 'fee_changed') {
        throw new Error('Claim fee has changed. Please try again.');
      }
      this.setError(error);
      throw error;
    }
  }

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
      const result = await this.sdk.refundDeposit({
        txid: txId,
        vout: outputIndex,
        destinationAddress: resolvedAddress,
        fee: { type: 'rate', satPerVbyte: Math.ceil(resolvedFee) },
      });

      return {
        success: true,
        txId: result?.txId || null,
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

  // ==========================================
  // L1 withdrawals
  // ==========================================

  async getWithdrawalFeeQuote(amountSats, destinationAddress) {
    this._ensureConnected();

    if (!this._isValidBitcoinAddress(destinationAddress)) {
      throw new Error('Invalid Bitcoin address');
    }

    let prep;
    try {
      prep = await this._prepareSend(destinationAddress, {
        amountSats: Number(amountSats),
        fresh: true,
      });
    } catch (error) {
      // Quoting here is a real send-prepare, so it CAN fail for a balance
      // the direct engine's pure SSP quote never checks. While the user is
      // still typing an amount that is a "no quote yet", not a payment
      // error dialog.
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('insufficient') || msg.includes('balance')) {
        throw new Error('No withdrawal fee quote available right now. Please try again.');
      }
      this.setError(error);
      throw error;
    }

    const pm = prep?.paymentMethod;
    const feeQuote = pm?.type === 'bitcoinAddress' ? pm.feeQuote : null;
    if (!feeQuote) {
      throw new Error('No withdrawal fee quote available right now. Please try again.');
    }

    breezSdk.rememberWithdrawQuote(this.walletId, feeQuote.id, {
      prepareResponse: prep,
      amountSats: Number(amountSats),
      destinationAddress,
      expiresAt: feeQuote.expiresAt,
    });

    return mapWithdrawFeeQuoteToTiers(feeQuote);
  }

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
      let prep = breezSdk.getWithdrawQuote(this.walletId, feeQuoteId)?.prepareResponse || null;

      // A provider replacement between quote and confirm loses nothing: the
      // request itself carries everything needed to re-prepare.
      if (!prep || deductFeeFromWithdrawalAmount) {
        const request = {
          paymentRequest: { type: 'input', input: destinationAddress },
          amount: BigInt(Math.round(amountSats)),
        };
        if (deductFeeFromWithdrawalAmount) {
          request.feePolicy = 'feesIncluded';
        }
        prep = await this.sdk.prepareSendPayment(request);
      }

      if (prep?.paymentMethod?.type !== 'bitcoinAddress') {
        const err = new Error('No withdrawal fee quote available right now. Please try again.');
        err.code = 'BREEZ_NO_QUOTE';
        throw err;
      }

      const speedKey = String(speed || 'medium').toLowerCase();
      const confirmationSpeed = speedKey === 'fast' ? 'fast' : speedKey === 'slow' ? 'slow' : 'medium';

      // The fee lock the contract promises: the UI showed feeAmountSats for
      // the chosen speed; if the live quote now charges more, refuse instead
      // of silently debiting the higher figure (the SSP can reprice between
      // quote and confirm).
      const speedQuote = confirmationSpeed === 'fast'
        ? prep.paymentMethod.feeQuote?.speedFast
        : confirmationSpeed === 'slow'
          ? prep.paymentMethod.feeQuote?.speedSlow
          : prep.paymentMethod.feeQuote?.speedMedium;
      const liveFee = Number(speedQuote?.userFeeSat || 0) + Number(speedQuote?.l1BroadcastFeeSat || 0);
      if (liveFee > feeAmountSats) {
        const err = new Error('Fee quote expired. Please try again.');
        err.code = 'BREEZ_FEE_DRIFT';
        throw err;
      }

      const sendResponse = await this.sdk.sendPayment({
        prepareResponse: prep,
        options: { type: 'bitcoinAddress', confirmationSpeed },
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : undefined,
      });

      const payment = sendResponse?.payment;
      if (!payment?.id) {
        throw new Error('Withdrawal failed — SSP did not return a request ID');
      }

      return {
        requestId: payment.id,
        status: payment.status === PAYMENT_STATUS.COMPLETED
          ? 'completed'
          : payment.status === PAYMENT_STATUS.FAILED ? 'failed' : 'pending',
        amount: amountSats
      };
    } catch (error) {
      if (error?.code === 'BREEZ_NO_QUOTE' || error?.code === 'BREEZ_FEE_DRIFT') {
        throw error; // already user-facing; don't let the substring mapper rewrite it
      }
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

  async getWithdrawalStatus(requestId) {
    this._ensureConnected();

    try {
      let payment = null;
      try {
        const response = await this.sdk.getPayment({ paymentId: requestId });
        payment = response?.payment || null;
      } catch (e) {
        payment = null;
      }

      // Broadcast-with-txid is terminal-for-UX: funds have left, the tx is
      // verifiable on mempool — same rule as the direct engine.
      return withdrawalStatusFromPayment(payment, requestId);
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

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

  // ==========================================
  // Mempool helpers (engine-independent)
  // ==========================================

  _isValidBitcoinAddress(address) {
    return isBitcoinAddress(address);
  }

  getMempoolExplorerUrl() {
    const apiUrl = fiatRatesService.getApiUrl();
    return apiUrl.replace(/\/api\/v1\/?$/, '');
  }

  async _deriveSenderAddress(txId) {
    for (const baseUrl of this._mempoolBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/tx/${txId}`);
        if (!response.ok) continue;
        const tx = await response.json();
        const senderAddress = tx?.vin?.[0]?.prevout?.scriptpubkey_address;
        if (senderAddress) return senderAddress;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

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

    return 5;
  }

  _mempoolBaseUrls() {
    const customUrl = fiatRatesService.getApiUrl().replace(/\/+$/, '').replace(/\/v1$/, '');
    const fallbackUrl = BITCOIN_L1.DEFAULT_MEMPOOL_API;
    return customUrl !== fallbackUrl ? [customUrl, fallbackUrl] : [fallbackUrl];
  }
}
