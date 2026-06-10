/**
 * ArkadeWalletProvider — Ark L2 backend for BuhoGO.
 *
 * Implements the WalletProvider contract on top of `@arkade-os/sdk`. This
 * file covers the onboarding + core-state surface (connect, balance, address,
 * info, native ark1→ark1 transfer, history). Lightning (Boltz swaps), onchain
 * ramps and VTXO liveness are deliberately out of scope here and land in
 * later phases — see ARKADE_INTEGRATION_PLAN.md §10–§12.
 *
 * Key facts that shape this provider:
 *   - Identity is a raw-key `SingleKey`; BuhoGO owns mnemonic → key derivation
 *     (see ../utils/arkadeKeys.js). The seed is stored encrypted in the wallet
 *     store (`connectionData.encryptedMnemonic`) via the shared device key,
 *     never in the SDK's own storage.
 *   - The SDK rebuilds wallet state from the Ark/indexer/esplora providers on
 *     every `Wallet.create`, so the wallet survives a restart from the seed
 *     alone. We still pass an `IndexedDBStorageAdapter` (per the integration
 *     plan, D8) so the SDK can cache between sessions.
 *   - Balance is read from `WalletBalance.available` (settled + preconfirmed,
 *     both spendable); only not-yet-spendable on-chain boarding UTXOs are
 *     surfaced as `pending`.
 *
 * Mirrors the shape of SparkWalletProvider / LNBitsWalletProvider so the store
 * and UI treat all backends uniformly.
 */

import { WalletProvider } from './WalletProvider';
import { Wallet, ESPLORA_URL, VtxoManager, Ramps } from '@arkade-os/sdk';
import { IndexedDBStorageAdapter } from '@arkade-os/sdk/adapters/indexedDB';
import {
  ArkadeSwaps,
  BoltzSwapProvider,
  SwapError,
  getInvoiceSatoshis,
} from '@arkade-os/boltz-swap';
import { decryptString } from '../utils/deviceCrypto';
import {
  ARKADE_MAINNET_SERVER,
  ARKADE_BOLTZ_API_URL,
  ARKADE_DEFAULT_NETWORK,
  isMainnetNetwork,
  generateArkadeMnemonic,
  isValidArkadeMnemonic,
  arkadeIdentityFromMnemonic,
} from '../utils/arkadeKeys';

// Arkade brand accent (light-mode orange). Matches the Spark `#15DE72` /
// LNbits `#FF1FE1` convention for `getInfo().color`.
const ARKADE_COLOR = '#F14317';

export class ArkadeWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    /** @type {import('@arkade-os/sdk').Wallet | null} */
    this.wallet = null;
    this.arkadeAddress = null;
    this.network = walletData.network || ARKADE_DEFAULT_NETWORK;
    this.arkServerUrl = walletData.arkServerUrl || ARKADE_MAINNET_SERVER;

    // Lightning is delivered via Boltz swaps (Arkade has no native LN). Built
    // lazily in connect(); ark1 + onchain keep working if this fails to init.
    /** @type {import('@arkade-os/boltz-swap').ArkadeSwaps | null} */
    this.lightningSwaps = null;
    /** @type {import('@arkade-os/sdk').VtxoManager | null} */
    this.vtxoManager = null;
    // paymentHash -> { pendingSwap, claimed, preimage } for incoming LN swaps.
    this._reverseSwaps = new Map();
    this._lastLivenessCheck = 0;
    // True while an actual VTXO renew/recover settlement is in flight, so the
    // UI can show a subtle "wallet maintenance" indicator. `_onMaintenance` is
    // an optional callback the store wires up to mirror this into reactive state.
    this.isMaintaining = false;
    this._onMaintenance = null;

    // Stop handle for the notifyIncomingFunds subscription; tracked here so
    // disconnect() can always tear it down.
    this._stopIncoming = null;
  }

  getType() {
    return 'arkade';
  }

  isArkade() {
    return true;
  }

  // ==========================================
  // Static helpers (onboarding)
  // ==========================================

  /** Fresh 12-word recovery phrase for the create flow. */
  static generateMnemonic() {
    return generateArkadeMnemonic();
  }

  /** BIP-39 word list + checksum validation for the restore flow. */
  static isValidMnemonic(mnemonic) {
    return isValidArkadeMnemonic(mnemonic);
  }

  /**
   * Build a live SDK Wallet from a plaintext mnemonic. Shared by connect()
   * and any one-shot probe/validation. The caller owns wiping `mnemonic`.
   *
   * @param {Object} params
   * @param {string} params.mnemonic
   * @param {string} [params.network] - SDK NetworkName (default mainnet)
   * @param {string} [params.arkServerUrl]
   * @param {string} [params.storageKey] - IndexedDB db name; omit to skip cache
   * @returns {Promise<import('@arkade-os/sdk').Wallet>}
   */
  static async buildWallet({ mnemonic, network, arkServerUrl, storageKey }) {
    const net = network || ARKADE_DEFAULT_NETWORK;
    const identity = arkadeIdentityFromMnemonic(mnemonic, {
      isMainnet: isMainnetNetwork(net),
    });

    const config = {
      identity,
      arkServerUrl: arkServerUrl || ARKADE_MAINNET_SERVER,
      esploraUrl: ESPLORA_URL[net] || ESPLORA_URL.bitcoin,
    };

    // Persistent cache for the SDK's repositories. Best-effort: if IndexedDB
    // is unavailable (rare WebView edge cases) the wallet still works, it just
    // rebuilds state from the providers each session.
    if (storageKey) {
      try {
        config.storage = new IndexedDBStorageAdapter(storageKey);
      } catch (error) {
        console.warn('[arkade] IndexedDB storage unavailable, continuing without cache:', error?.message || error);
      }
    }

    return Wallet.create(config);
  }

  /**
   * One-shot, side-effect-free probe: does this recovery phrase have any Arkade
   * activity (spendable/total balance or transaction history) on the given
   * network? Used by the restore flow to tell whether a phrase belongs to an
   * Arkade wallet — so it is never mis-restored as another backend (or vice
   * versa). No storage adapter is attached: this is an ephemeral throwaway
   * wallet, never persisted.
   *
   * @param {string} mnemonic
   * @param {{ network?: string, arkServerUrl?: string }} [opts]
   * @returns {Promise<{ hasActivity: boolean, balance: number, txCount: number }>}
   */
  static async probeActivity(mnemonic, { network, arkServerUrl } = {}) {
    const wallet = await ArkadeWalletProvider.buildWallet({ mnemonic, network, arkServerUrl });
    const [balance, history] = await Promise.all([
      wallet.getBalance().catch(() => null),
      wallet.getTransactionHistory().catch(() => []),
    ]);
    const total = Number(balance?.total ?? 0);
    const txCount = (history || []).length;
    return { hasActivity: total > 0 || txCount > 0, balance: total, txCount };
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async connect() {
    if (this.wallet) {
      this.isConnected = true;
      return;
    }

    const encrypted = this.walletData?.encryptedMnemonic;
    if (!encrypted) {
      throw new Error('Arkade wallet requires an encrypted recovery phrase to connect');
    }

    // Decrypt with the shared device key. Kept in a local that we drop in
    // `finally` so the plaintext seed doesn't linger on the instance.
    let mnemonic = await decryptString(encrypted);
    try {
      this.wallet = await ArkadeWalletProvider.buildWallet({
        mnemonic,
        network: this.network,
        arkServerUrl: this.arkServerUrl,
        storageKey: `buhoGO_arkade_${this.walletId}`,
      });
      this.arkadeAddress = await this.wallet.getAddress();
      this.isConnected = true;
      // Fire-and-forget: ark1 + balance are ready now; LN swaps warm up in the
      // background and the method swallows its own errors (never rejects).
      void this._initLightningAndLiveness();
      this.clearError();
    } catch (error) {
      this.setError(error);
      throw error;
    } finally {
      mnemonic = null;
    }
  }

  /**
   * Best-effort init of the Lightning swap manager and the VTXO liveness
   * helper. Never throws: a Boltz/indexer hiccup must not break the core
   * ark1 + balance flow, it just leaves Lightning temporarily unavailable.
   */
  async _initLightningAndLiveness() {
    try {
      // Pin the mainnet Boltz endpoint explicitly (see ARKADE_BOLTZ_API_URL):
      // the docs' dedicated host has a DEAD swap WebSocket, so we use the
      // generic Boltz which serves the same ARK<->BTC pairs with a working WS.
      // Non-mainnet keeps the package default (mutinynet/regtest are correct).
      const apiUrl = isMainnetNetwork(this.network) ? ARKADE_BOLTZ_API_URL : undefined;
      const swapProvider = new BoltzSwapProvider({ network: this.network, apiUrl });
      // create() is the SDK-recommended entry point. It auto-starts the
      // SwapManager (incoming swaps auto-claim, failed outgoing swaps
      // auto-refund) backed by IndexedDbSwapRepository, so pending swaps survive
      // an app restart. It adopts the swapProvider we built, so our endpoint
      // wins. Run non-blocking from connect(): a Boltz hiccup must not delay or
      // break the core ark1 + balance flow — it just leaves LN unavailable.
      this.lightningSwaps = await ArkadeSwaps.create({ wallet: this.wallet, swapProvider });
    } catch (error) {
      console.warn('[arkade] Lightning swaps unavailable (ark1 still works):', error?.message || error);
      this.lightningSwaps = null;
    }
    try {
      this.vtxoManager = new VtxoManager(this.wallet);
    } catch (error) {
      console.warn('[arkade] VTXO liveness manager unavailable:', error?.message || error);
      this.vtxoManager = null;
    }
  }

  async disconnect() {
    try {
      if (this._stopIncoming) this._stopIncoming();
    } catch (error) {
      console.warn('[arkade] error stopping incoming-funds listener:', error);
    }
    this._stopIncoming = null;
    // Cleanly stop the SwapManager's WebSocket + poll timers before dropping the
    // reference, otherwise they leak across reconnects (boltz-swap "Cleanup").
    try {
      await this.lightningSwaps?.dispose?.();
    } catch (error) {
      console.warn('[arkade] error disposing Lightning swaps:', error?.message || error);
    }
    this.lightningSwaps = null;
    this.vtxoManager = null;
    this._reverseSwaps.clear();
    // The 0.3.x SDK Wallet holds no sockets we must explicitly close; dropping
    // references is enough.
    this.wallet = null;
    this.arkadeAddress = null;
    this.isConnected = false;
  }

  _ensureConnected() {
    if (!this.wallet || !this.isConnected) {
      throw new Error('Arkade wallet is not connected');
    }
  }

  // ==========================================
  // Read operations
  // ==========================================

  async getBalance() {
    this._ensureConnected();
    try {
      // WalletBalance = { boarding:{confirmed,unconfirmed,total}, settled,
      //                   preconfirmed, available, recoverable, total }
      const b = await this.wallet.getBalance();
      const available = Number(b?.available ?? 0);
      // `available` already = settled + preconfirmed (preconfirmed VTXOs ARE
      // spendable), so `pending` must be on-chain boarding UTXOs only — adding
      // preconfirmed here would double-count it against the balance.
      const pending = Number(b?.boarding?.total ?? 0);

      return {
        balance: available,
        pending,
        recoverable: Number(b?.recoverable ?? 0),
        settled: Number(b?.settled ?? 0),
        total: Number(b?.total ?? available),
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getInfo() {
    this._ensureConnected();
    try {
      const arkadeAddress = this.arkadeAddress || await this.getArkadeAddress();
      return {
        alias: this.walletData.name || 'Arkade Wallet',
        color: ARKADE_COLOR,
        pubkey: null,
        // No native Lightning endpoint — receiving over LN uses an on-demand
        // reverse swap (later phase), so there is no static lud16 to advertise.
        lightningAddress: null,
        arkadeAddress,
        type: 'arkade',
      };
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async getTransactions() {
    this._ensureConnected();
    try {
      const history = await this.wallet.getTransactionHistory();
      return (history || []).map((tx) => {
        const key = tx.key || {};
        const id = key.arkTxid || key.commitmentTxid || key.boardingTxid || '';
        // BuhoGO's tx list (and the LNbits/NWC providers) speak unix SECONDS.
        // The SDK's `createdAt` is documented as unix seconds but the 0.3.x
        // build actually emits a Date / ms-epoch — so detect the magnitude and
        // normalize either form to seconds. (ms now ≈ 1.7e12; seconds ≈ 1.7e9;
        // 1e11 cleanly separates them and stays correct for decades.)
        const raw = tx.createdAt ? Number(tx.createdAt) : 0;
        const timestamp = raw >= 1e11 ? Math.round(raw / 1000) : Math.round(raw);
        return {
          id,
          type: tx.type === 'RECEIVED' ? 'incoming' : 'outgoing',
          amount: Number(tx.amount || 0),
          timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0,
          status: tx.settled ? 'completed' : 'pending',
          description: '',
        };
      });
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Arkade-specific (mirror Spark fast-path block)
  // ==========================================

  /** The wallet's ark1/tark1 receive address. */
  async getArkadeAddress() {
    this._ensureConnected();
    if (this.arkadeAddress) return this.arkadeAddress;
    this.arkadeAddress = await this.wallet.getAddress();
    return this.arkadeAddress;
  }

  /**
   * Native ark1 → ark1 transfer — instant, near-zero fee fast path (the Ark
   * analogue of Spark's `transferToSparkAddress`).
   * @param {Object} params
   * @param {string} params.arkadeAddress - Recipient ark1/tark1 address
   * @param {number} params.amount - Amount in sats
   * @returns {Promise<{id: string, status: string}>}
   */
  async transferToArkadeAddress({ arkadeAddress, amount }) {
    this._ensureConnected();
    const txid = await this.wallet.sendBitcoin({ address: arkadeAddress, amount });
    return { id: txid, status: 'completed' };
  }

  // ==========================================
  // On-chain ramps (boarding receive / offboard send)
  // ==========================================

  /**
   * On-chain receive: the boarding address. Bitcoin sent here lands as a
   * boarding UTXO and settles into the wallet (as a VTXO) after on-chain
   * confirmation — surfaced as `pending` balance until then.
   * @returns {Promise<string>} a bc1… boarding address
   */
  async getBoardingAddress() {
    this._ensureConnected();
    return this.wallet.getBoardingAddress();
  }

  /**
   * On-chain send: collaboratively exit (offboard) VTXOs to a Bitcoin address
   * via Ramps. This is a batch settlement, so it is subject to the Ark
   * server's minimum amounts and timing — not instant like ark1/Lightning.
   * @param {Object} params
   * @param {string} params.bitcoinAddress - destination bc1… address
   * @param {number} params.amount - amount in sats
   * @returns {Promise<{id: string, status: string}>}
   */
  async offboardToBitcoin({ bitcoinAddress, amount }) {
    this._ensureConnected();
    const sats = Math.floor(Number(amount) || 0);
    const info = await this.wallet.arkProvider.getInfo();
    // A collaborative exit is subject to the server's dust / output minimums.
    // Surface a friendly floor BEFORE Ramps rejects with a raw SDK error.
    const floor = Math.max(
      Number(info?.dust || 0),
      Number(info?.utxoMinAmount || 0),
      Number(info?.vtxoMinAmount || 0)
    );
    if (floor > 0 && sats < floor) {
      const err = new Error(`Amount below the on-chain minimum (${floor} sats)`);
      err.code = 'ARKADE_OFFBOARD_BELOW_MIN';
      err.minSats = floor;
      throw err;
    }
    try {
      const txid = await new Ramps(this.wallet).offboard(
        bitcoinAddress,
        info.fees,
        BigInt(sats)
      );
      return { id: txid, status: 'completed' };
    } catch (error) {
      if (!error.code) error.code = 'ARKADE_OFFBOARD_FAILED';
      this.setError(error);
      throw error;
    }
  }

  // ==========================================
  // Lightning (Boltz swaps)
  // ==========================================

  _ensureLightning() {
    if (!this.lightningSwaps) {
      const err = new Error('Lightning is temporarily unavailable for this wallet');
      err.code = 'ARKADE_LN_UNAVAILABLE';
      throw err;
    }
  }

  /**
   * Receive over Lightning: create a Boltz reverse swap and hand back the
   * BOLT11 invoice. When the payer pays, the autonomous SwapManager claims the
   * VHTLC into a VTXO — which surfaces through `notifyIncomingFunds` exactly
   * like a native ark1 receipt, so the receive UI needs no special-casing.
   *
   * Note: the on-chain amount the wallet ends up with (`amountReceivable`) is
   * the invoice amount minus the Boltz reverse-swap fee.
   *
   * @returns {Promise<{paymentRequest: string, paymentHash: string|null, id: string|null, expiresAt: number|null, amountReceivable: number}>}
   */
  async createInvoice({ amount, description } = {}) {
    this._ensureConnected();
    this._ensureLightning();
    try {
      const r = await this.lightningSwaps.createLightningInvoice({
        amount,
        description: description || undefined,
      });
      if (r.paymentHash) {
        this._reverseSwaps.set(r.paymentHash, {
          pendingSwap: r.pendingSwap,
          claimed: false,
          preimage: null,
        });
      }
      return {
        paymentRequest: r.invoice,
        paymentHash: r.paymentHash || null,
        id: r.paymentHash || null,
        expiresAt: r.expiry ? Number(r.expiry) : null,
        amountReceivable: Number(r.amount ?? amount ?? 0),
      };
    } catch (error) {
      throw this._mapSwapError(error);
    }
  }

  /**
   * Send over Lightning: pay a BOLT11 invoice via a Boltz submarine swap. The
   * SDK creates the swap, sends the VHTLC, waits for settlement, and
   * auto-refunds on failure before throwing — so a thrown error means the
   * outgoing funds are being returned, not lost.
   *
   * `maxFee` from the unified contract is informational here: the swap fee is
   * fixed by the Boltz quote (shown to the user on the confirm sheet) rather
   * than a routing budget we can cap.
   *
   * @returns {Promise<{preimage: string|null, txid: string|null, fee: number, status: string}>}
   */
  async payInvoice({ invoice } = {}) {
    this._ensureConnected();
    this._ensureLightning();
    try {
      const r = await this.lightningSwaps.sendLightningPayment({ invoice });
      // Swap fee ≈ what left the wallet minus the invoice's own amount.
      let fee = 0;
      try {
        const invoiceSats = Number(getInvoiceSatoshis(invoice) || 0);
        const paid = Number(r.amount || 0);
        if (invoiceSats > 0 && paid > 0) fee = Math.max(0, paid - invoiceSats);
      } catch {
        /* leave fee 0 if the invoice can't be decoded */
      }
      return {
        preimage: r.preimage || null,
        txid: r.txid || null,
        fee,
        status: 'completed',
      };
    } catch (error) {
      throw this._mapSwapError(error);
    }
  }

  /**
   * Look up an incoming Lightning payment by hash. Arkade's primary receive
   * signal is `notifyIncomingFunds` (the autonomous claim lands a VTXO), so
   * this is a best-effort fallback used by monitors: it reports paid once the
   * receive flow has reconciled the matching reverse swap.
   * @param {string} paymentHash
   * @returns {Promise<{paid: boolean, preimage?: string|null, amount?: number}>}
   */
  async lookupInvoice(paymentHash) {
    this._ensureConnected();
    const tracked = this._reverseSwaps.get(paymentHash);
    if (tracked?.claimed) {
      return { paid: true, preimage: tracked.preimage || null };
    }
    return { paid: false };
  }

  /**
   * Mark a tracked reverse swap as claimed once the receive flow confirms the
   * incoming funds (via notifyIncomingFunds / balance reconcile). Lets
   * lookupInvoice report completion for any later poller.
   */
  markReverseSwapClaimed(paymentHash, { preimage } = {}) {
    const tracked = this._reverseSwaps.get(paymentHash);
    if (tracked) {
      tracked.claimed = true;
      if (preimage) tracked.preimage = preimage;
    }
  }

  /**
   * Subscribe to incoming funds (native ark1 receipts AND claimed Lightning
   * reverse swaps both land as VTXOs here). Returns/stores a stop handle that
   * disconnect() also tears down.
   * @param {(funds: any) => void} callback
   * @returns {Promise<() => void>}
   */
  async startIncomingFundsListener(callback) {
    this._ensureConnected();
    if (this._stopIncoming) {
      try { this._stopIncoming(); } catch { /* ignore */ }
      this._stopIncoming = null;
    }
    this._stopIncoming = await this.wallet.notifyIncomingFunds((funds) => {
      try {
        callback(funds);
      } catch (error) {
        console.warn('[arkade] incoming-funds callback error:', error);
      }
    });
    return this._stopIncoming;
  }

  // ==========================================
  // VTXO liveness (Arkade-only — no analog in the other backends)
  // ==========================================

  /**
   * Keep VTXOs alive: renew any nearing expiry and reclaim any that have
   * degraded to recoverable-only. Throttled so a frequent balance refresh
   * doesn't trigger a settlement every time; pass `force` to bypass.
   *
   * Best-effort and non-throwing — a failed maintenance pass must never block
   * the balance/refresh path that calls it.
   *
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<{ renewed: boolean, recovered: boolean }>}
   */
  async checkLiveness({ force = false } = {}) {
    const out = { renewed: false, recovered: false };
    if (!this.vtxoManager || !this.isConnected) return out;

    // VTXO expiry threshold is on the order of days; a 6-hour throttle is
    // plenty and keeps settlements rare.
    const THROTTLE_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    if (!force && now - this._lastLivenessCheck < THROTTLE_MS) return out;
    this._lastLivenessCheck = now;

    let didWork = false;
    const beginWork = () => {
      if (!didWork) {
        didWork = true;
        this._setMaintaining(true);
      }
    };

    try {
      const expiring = await this.vtxoManager.getExpiringVtxos();
      if (Array.isArray(expiring) && expiring.length > 0) {
        beginWork();
        await this.vtxoManager.renewVtxos();
        out.renewed = true;
      }
    } catch (error) {
      console.warn('[arkade] VTXO renewal check failed:', error?.message || error);
    }

    try {
      const rec = await this.vtxoManager.getRecoverableBalance();
      if (rec && Number(rec.recoverable) > 0) {
        beginWork();
        await this.vtxoManager.recoverVtxos();
        out.recovered = true;
      }
    } catch (error) {
      console.warn('[arkade] VTXO recovery check failed:', error?.message || error);
    }

    if (didWork) this._setMaintaining(false);
    return out;
  }

  _setMaintaining(active) {
    this.isMaintaining = active;
    try {
      this._onMaintenance?.(active);
    } catch (error) {
      console.warn('[arkade] maintenance callback failed:', error);
    }
  }

  /**
   * Preserve Boltz recovery flags (isRefundable / isClaimable / pendingSwap)
   * and tag a stable code so userErrors.js can render a friendly, actionable
   * message for each swap failure mode.
   */
  _mapSwapError(error) {
    // Most Boltz swap errors extend SwapError, but NetworkError extends plain
    // Error — tag it by name too so a connectivity failure gets the friendly
    // "couldn't reach Lightning" copy instead of a raw fetch error.
    // (_mapSwapError is only called from the swap-send path, so name-based
    // tagging is safe here.)
    if (error instanceof SwapError || error?.name === 'NetworkError') {
      // Use error.name (a string literal each SwapError subclass sets, e.g.
      // 'InvoiceExpiredError') NOT error.constructor.name — the latter is
      // mangled by the production minifier (becomes 'o'/'t') and is the inner
      // binding name '_QuoteRejectedError' even unminified, so the userErrors
      // switch would miss every specific case and only hit the generic arm.
      error.code = error.code || `ARKADE_SWAP_${error.name || 'ERROR'}`;
    }
    this.setError(error);
    return error;
  }

  /**
   * Best-effort deletion of a wallet's IndexedDB cache. Call ONLY on permanent
   * wallet removal — NOT from disconnect(), which runs on every wallet switch.
   * The db holds no seed (that lives encrypted in app state); it only caches
   * public VTXO/address/history data, so a failure here is harmless residue.
   */
  static async deleteStorage(walletId) {
    try {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(`buhoGO_arkade_${walletId}`);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    } catch {
      /* IndexedDB may be unavailable in some WebViews — best-effort only */
    }
  }
}

export default ArkadeWalletProvider;
