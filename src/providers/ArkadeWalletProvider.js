/**
 * ArkadeWalletProvider — Arkade backend for BuhoGO.
 *
 * Implements the WalletProvider contract on top of `@arkade-os/sdk` 0.4.x.
 * Covers the full payment matrix: native ark1↔ark1 transfers, Lightning in
 * both directions (Boltz submarine / reverse swaps via `@arkade-os/boltz-swap`),
 * and on-chain in both directions (boarding receive + collaborative offboard
 * send via the SDK's Ramps).
 *
 * Key facts that shape this provider:
 *   - Identity is the SDK's `MnemonicIdentity` (HD, BIP-86 account template
 *     `m/86'/coinType'/0'/0/*` — see ../utils/arkadeKeys.js). The seed is
 *     stored encrypted in the wallet store (`connectionData.encryptedMnemonic`)
 *     via the shared device key, never in the SDK's own storage.
 *   - The SDK owns background settlement (`settlementConfig`, on by default):
 *     confirmed boarding UTXOs auto-settle into VTXOs, expiring VTXOs
 *     auto-renew, and deprecated-server-signer funds auto-migrate. The only
 *     maintenance this provider still drives itself is the recovery of
 *     swept/subdust VTXOs (`checkLiveness`), which the SDK exposes but does
 *     not run in the background.
 *   - Wallet state lives in per-wallet IndexedDB repositories (public
 *     VTXO/contract/history cache only — no key material). A wallet restored
 *     from seed rebuilds that state with `wallet.restore()` (HD gap scan),
 *     run once in the background; the store persists the done-flag on the
 *     wallet's metadata (`restoreScanDone` / `_onRestoreScanComplete`).
 *   - Balance is read from `WalletBalance.available` (settled + preconfirmed,
 *     both spendable); not-yet-spendable on-chain boarding UTXOs are surfaced
 *     as `pending`.
 *
 * Mirrors the shape of SparkWalletProvider / LNBitsWalletProvider so the store
 * and UI treat all backends uniformly.
 */

import { WalletProvider } from './WalletProvider';
import {
  Wallet,
  ESPLORA_URL,
  Ramps,
  RestArkProvider,
  RestIndexerProvider,
  EsploraProvider,
  IndexedDBWalletRepository,
  IndexedDBContractRepository,
  InMemoryWalletRepository,
  InMemoryContractRepository,
} from '@arkade-os/sdk';
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

// IndexedDB database the boltz-swap package persists pending swaps in (its
// package default). Single-instance: BuhoGO allows exactly one Arkade wallet,
// so it is deleted together with the wallet's own cache on removal.
const BOLTZ_SWAP_DB = 'arkade-boltz-swap';

/** Per-wallet IndexedDB database backing the SDK's repositories. */
const walletDbName = (walletId) => `buhoGO_arkade_${walletId}_v4`;
/** The pre-0.4 storage-adapter database; deleted opportunistically. */
const legacyDbName = (walletId) => `buhoGO_arkade_${walletId}`;

/** Best-effort IndexedDB database deletion (never throws). */
async function deleteDatabase(name) {
  try {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    /* IndexedDB may be unavailable in some WebViews — best-effort only */
  }
}

export class ArkadeWalletProvider extends WalletProvider {
  constructor(walletId, walletData) {
    super(walletId, walletData);

    /** @type {import('@arkade-os/sdk').Wallet | null} */
    this.wallet = null;
    this.network = walletData.network || ARKADE_DEFAULT_NETWORK;
    this.arkServerUrl = walletData.arkServerUrl || ARKADE_MAINNET_SERVER;

    // Lightning is delivered via Boltz swaps (Arkade has no native LN). Built
    // lazily in connect(); ark1 + onchain keep working if this fails to init.
    /** @type {import('@arkade-os/boltz-swap').ArkadeSwaps | null} */
    this.lightningSwaps = null;
    // The in-flight _initLightning() promise. disconnect() awaits it before
    // disposing, so a rapid wallet switch can't strand a live SwapManager
    // (WebSocket + timers) created after teardown already ran.
    this._initLightningPromise = null;
    // Resolved Boltz REST base for direction-specific limit lookups; null on
    // networks where the package default applies (no receive pre-validation).
    this._boltzApiUrl = null;
    // paymentHash -> { pendingSwap, claimed, preimage } for incoming LN swaps.
    this._reverseSwaps = new Map();
    // Boltz swap limits per direction, cached briefly so send/receive (and
    // the auto-withdraw pre-flight) don't refetch per call.
    this._sendLimits = null;
    this._sendLimitsFetchedAt = 0;
    this._receiveLimits = null;
    this._receiveLimitsFetchedAt = 0;
    this._lastRecoveryCheck = 0;
    // Optional callback the store wires up to mirror "a recovery settlement
    // is in flight" into reactive state (subtle wallet-maintenance indicator).
    this._onMaintenance = null;
    // Optional callback the store wires up to react to background swap
    // activity (auto-claimed receives, auto-refunded failures): refresh the
    // balance, tell the user. `(kind, swap, error?) => void`.
    this._onSwapActivity = null;
    // Optional callback the store wires up to persist "the one-time HD
    // restore scan finished" onto the wallet's metadata.
    this._onRestoreScanComplete = null;
    this._swapUnsubscribers = [];

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
   * and any one-shot probe/validation. The caller owns wiping `mnemonic` and
   * MUST `dispose()` the returned wallet when done with it — Wallet.create
   * starts background managers (contract watcher, settlement poll).
   *
   * @param {Object} params
   * @param {string} params.mnemonic
   * @param {string} [params.network] - SDK NetworkName (default mainnet)
   * @param {string} [params.arkServerUrl]
   * @param {string} [params.storageKey] - IndexedDB db name for persistent
   *   state; omit for a throwaway in-memory wallet (probes).
   * @param {boolean} [params.settlement=true] - When false, disables the
   *   SDK's background settlement (boarding auto-settle, VTXO renewal,
   *   signer migration). MUST be false for probe/throwaway wallets: a probe
   *   with settlement enabled can submit real settlement transactions for a
   *   funded seed it is about to discard.
   * @returns {Promise<import('@arkade-os/sdk').Wallet>}
   */
  static async buildWallet({ mnemonic, network, arkServerUrl, storageKey, settlement = true }) {
    const net = network || ARKADE_DEFAULT_NETWORK;
    const identity = arkadeIdentityFromMnemonic(mnemonic, {
      isMainnet: isMainnetNetwork(net),
    });
    const serverUrl = arkServerUrl || ARKADE_MAINNET_SERVER;
    const esploraUrl = ESPLORA_URL[net] || ESPLORA_URL.bitcoin;

    // Repository-backed storage (public chain state only, never keys).
    // Persistent wallets get per-wallet IndexedDB databases; probes get
    // in-memory repositories so they are truly side-effect-free.
    const storage = storageKey
      ? {
          walletRepository: new IndexedDBWalletRepository(storageKey),
          contractRepository: new IndexedDBContractRepository(storageKey),
        }
      : {
          walletRepository: new InMemoryWalletRepository(),
          contractRepository: new InMemoryContractRepository(),
        };

    return Wallet.create({
      identity,
      arkProvider: new RestArkProvider(serverUrl),
      indexerProvider: new RestIndexerProvider(serverUrl),
      onchainProvider: new EsploraProvider(esploraUrl),
      storage,
      // undefined = SDK default (enabled); false = explicitly disabled.
      settlementConfig: settlement ? undefined : false,
    });
  }

  /**
   * One-shot, side-effect-free probe: does this recovery phrase have any Arkade
   * activity (spendable/total balance or transaction history) on the given
   * network? Used by the restore flow to tell whether a phrase belongs to an
   * Arkade wallet — so it is never mis-restored as another backend (or vice
   * versa). Uses in-memory storage (ephemeral throwaway wallet, never
   * persisted) and an explicit HD restore scan, since a fresh repository knows
   * nothing until scanned.
   *
   * @param {string} mnemonic
   * @param {{ network?: string, arkServerUrl?: string }} [opts]
   * @returns {Promise<{ hasActivity: boolean, balance: number, txCount: number }>}
   */
  static async probeActivity(mnemonic, { network, arkServerUrl } = {}) {
    // settlement: false — a read-only probe must never auto-settle boarding
    // UTXOs or renew VTXOs on a funded seed it is about to discard.
    const wallet = await ArkadeWalletProvider.buildWallet({
      mnemonic, network, arkServerUrl, settlement: false,
    });
    try {
      await wallet.restore().catch((error) => {
        console.warn('[arkade] probe restore scan failed:', error?.message || error);
      });
      const [balance, history] = await Promise.all([
        wallet.getBalance().catch(() => null),
        wallet.getTransactionHistory().catch(() => []),
      ]);
      const total = Number(balance?.total ?? 0);
      const txCount = (history || []).length;
      return { hasActivity: total > 0 || txCount > 0, balance: total, txCount };
    } finally {
      await wallet.dispose().catch(() => {});
    }
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
        storageKey: walletDbName(this.walletId),
      });
      this.isConnected = true;
      // Everything below is background warm-up: the address and any cached
      // balance are usable now, and none of these may fail the connect (the
      // wallet must come up offline too).
      this._initLightningPromise = this._initLightning();
      void this._restoreScanIfNeeded();
      // If a previous send was interrupted mid-submit (app killed between
      // submit and finalize), finalize it now. No-ops (no server round trip)
      // when nothing was interrupted.
      this.wallet.finalizePendingTxs().then(({ finalized }) => {
        if (finalized?.length) {
          console.info('[arkade] finalized interrupted transactions:', finalized);
        }
      }).catch((error) => {
        console.warn('[arkade] pending-tx finalization failed:', error?.message || error);
      });
      this.clearError();
    } catch (error) {
      this.setError(error);
      throw error;
    } finally {
      mnemonic = null;
    }
  }

  /**
   * One-time HD restore scan for this wallet on this device. Repopulates a
   * fresh per-wallet repository from the indexer: needed after a
   * restore-from-phrase, and after the pre-0.4 storage-schema change (the old
   * adapter cache is unreadable by the new repositories). The store passes
   * `restoreScanDone` (persisted wallet metadata) so regular boots skip the
   * scan, and persists the flag via `_onRestoreScanComplete` when the scan
   * finishes. Best-effort and non-blocking: a failed scan (offline boot,
   * indexer hiccup) leaves the flag unset so the next boot retries, while
   * the wallet stays connected and usable from cached repository state.
   */
  async _restoreScanIfNeeded() {
    if (this.walletData?.restoreScanDone) return;
    try {
      await this.wallet.restore();
      this._onRestoreScanComplete?.();
      // The pre-0.4 cache is unreadable by the new repositories; drop it.
      void deleteDatabase(legacyDbName(this.walletId));
      // Balance may have changed materially (fresh repo just got populated);
      // nudge the store to repaint.
      this._onSwapActivity?.('restore-scan');
    } catch (error) {
      console.warn('[arkade] restore scan failed (will retry next boot):', error?.message || error);
    }
  }

  /**
   * Best-effort init of the Lightning swap layer. Never throws: a Boltz
   * hiccup must not break the core ark1 + balance flow, it just leaves
   * Lightning temporarily unavailable.
   */
  async _initLightning() {
    try {
      // Pin the mainnet Boltz endpoint explicitly (see ARKADE_BOLTZ_API_URL):
      // the docs' dedicated host has a DEAD swap WebSocket, so we use the
      // generic Boltz which serves the same ARK<->BTC pairs with a working WS.
      // Non-mainnet keeps the package default (mutinynet/regtest are correct).
      const apiUrl = isMainnetNetwork(this.network) ? ARKADE_BOLTZ_API_URL : undefined;
      this._boltzApiUrl = apiUrl || null;
      const swapProvider = new BoltzSwapProvider({ network: this.network, apiUrl });
      // create() is the SDK-recommended entry point. It auto-starts the
      // SwapManager (incoming swaps auto-claim, failed outgoing swaps
      // auto-refund) backed by IndexedDbSwapRepository, so pending swaps
      // survive an app restart. It adopts the swapProvider we built, so our
      // endpoint wins.
      this.lightningSwaps = await ArkadeSwaps.create({ wallet: this.wallet, swapProvider });
      await this._subscribeSwapManager();
    } catch (error) {
      console.warn('[arkade] Lightning swaps unavailable (ark1 still works):', error?.message || error);
      this.lightningSwaps = null;
    }
  }

  /**
   * Mirror the autonomous SwapManager's lifecycle events up to the store:
   * a completed reverse swap means funds arrived (refresh the balance, mark
   * the tracked invoice paid); a failed swap means an auto-refund is under
   * way (refresh + tell the user their funds are coming back).
   */
  async _subscribeSwapManager() {
    const mgr = this.lightningSwaps?.getSwapManager?.();
    if (!mgr) return;

    const onCompleted = (swap) => {
      try {
        if (swap?.type === 'reverse') {
          // Reverse swaps are tracked by paymentHash; the manager hands back
          // the swap object, so match on the Boltz swap id.
          for (const [paymentHash, tracked] of this._reverseSwaps) {
            if (tracked.pendingSwap?.id === swap.id) {
              this.markReverseSwapClaimed(paymentHash, { preimage: swap.preimage });
              break;
            }
          }
        }
        this._onSwapActivity?.('completed', swap);
      } catch (error) {
        console.warn('[arkade] swap-completed callback error:', error);
      }
    };
    const onFailed = (swap, error) => {
      try {
        this._onSwapActivity?.('failed', swap, error);
      } catch (cbError) {
        console.warn('[arkade] swap-failed callback error:', cbError);
      }
    };

    await mgr.onSwapCompleted(onCompleted);
    await mgr.onSwapFailed(onFailed);
    this._swapUnsubscribers = [
      () => mgr.offSwapCompleted(onCompleted),
      () => mgr.offSwapFailed(onFailed),
    ];
  }

  async disconnect() {
    try {
      if (this._stopIncoming) this._stopIncoming();
    } catch (error) {
      console.warn('[arkade] error stopping incoming-funds listener:', error);
    }
    this._stopIncoming = null;
    // A rapid wallet switch can land here while _initLightning() is still
    // mid-flight; wait for it to settle so the teardown below disposes the
    // real SwapManager instead of a null that gets replaced moments later.
    try {
      await this._initLightningPromise;
    } catch { /* init already logs its own failures */ }
    this._initLightningPromise = null;
    for (const unsubscribe of this._swapUnsubscribers) {
      try { unsubscribe(); } catch { /* manager may already be gone */ }
    }
    this._swapUnsubscribers = [];
    // Cleanly stop the SwapManager's WebSocket + poll timers before dropping the
    // reference, otherwise they leak across reconnects (boltz-swap "Cleanup").
    try {
      await this.lightningSwaps?.dispose?.();
    } catch (error) {
      console.warn('[arkade] error disposing Lightning swaps:', error?.message || error);
    }
    this.lightningSwaps = null;
    this._reverseSwaps.clear();
    // Tear down the SDK wallet's background machinery (contract watcher,
    // settlement poll, provider streams) — 0.4.x wallets own live resources.
    try {
      await this.wallet?.dispose?.();
    } catch (error) {
      console.warn('[arkade] error disposing wallet:', error?.message || error);
    }
    this.wallet = null;
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
      //   preconfirmed, available, recoverable, pendingRecovery, total, assets }
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
      const arkadeAddress = await this.getArkadeAddress();
      return {
        alias: this.walletData.name || 'Arkade Wallet',
        color: ARKADE_COLOR,
        pubkey: null,
        // No native Lightning endpoint — receiving over LN uses an on-demand
        // reverse swap, so there is no static lud16 to advertise.
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
        // The SDK's `createdAt` is documented as ms-epoch — but normalize by
        // magnitude anyway so a unit change in a future SDK can't shift
        // timestamps by x1000. (ms now ≈ 1.7e12; seconds ≈ 1.7e9; 1e11 cleanly
        // separates them and stays correct for decades.)
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

  /**
   * The wallet's current ark1/tark1 receive address. Under the SDK's HD
   * receive rotation the current address moves forward after funds arrive, so
   * this always reads fresh (a cheap repository read) — retired addresses
   * remain valid receive targets (their contracts stay active and watched),
   * so addresses saved by contacts keep working.
   */
  async getArkadeAddress() {
    this._ensureConnected();
    return this.wallet.getAddress();
  }

  /**
   * Native ark1 → ark1 transfer — instant, near-zero fee fast path (the
   * Arkade analogue of Spark's `transferToSparkAddress`).
   * @param {Object} params
   * @param {string} params.arkadeAddress - Recipient ark1/tark1 address
   * @param {number} params.amount - Amount in sats
   * @returns {Promise<{id: string, status: string}>}
   */
  async transferToArkadeAddress({ arkadeAddress, amount }) {
    this._ensureConnected();
    const txid = await this.wallet.send({ address: arkadeAddress, amount: Math.floor(Number(amount)) });
    return { id: txid, status: 'completed' };
  }

  // ==========================================
  // On-chain ramps (boarding receive / offboard send)
  // ==========================================

  /**
   * On-chain receive: the boarding address. Bitcoin sent here lands as a
   * boarding UTXO (surfaced as `pending` balance) and the SDK's background
   * settlement auto-settles it into a spendable VTXO once confirmed — no
   * manual onboard step.
   * @returns {Promise<string>} a bc1… boarding address
   */
  async getBoardingAddress() {
    this._ensureConnected();
    return this.wallet.getBoardingAddress();
  }

  /**
   * On-chain send: collaboratively exit (offboard) VTXOs to a Bitcoin address
   * via Ramps. This is a batch settlement, so it is subject to the operator's
   * minimum amounts and timing — not instant like ark1/Lightning.
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
   * Lightning swap limits for a direction, cached for 10 minutes.
   *
   * The two directions have independent Boltz limits: `'send'` (submarine,
   * paying out over Lightning) comes from the package's `getLimits()`;
   * `'receive'` (reverse swap, incoming Lightning) is not exposed by the
   * package, so it is read from the same Boltz REST base the swap provider
   * was pinned to. Best-effort: returns null when the fetch fails (or no
   * pinned base exists), in which case pre-validation is skipped and Boltz's
   * own rejection (mapped by _mapSwapError) is the backstop.
   *
   * Public because the auto-withdraw pre-flight also gates on it.
   *
   * @param {'send'|'receive'} [direction]
   * @returns {Promise<{min: number, max: number}|null>}
   */
  async getLightningLimits(direction = 'send') {
    const TTL_MS = 10 * 60 * 1000;
    if (!this.lightningSwaps) return null;
    if (direction === 'receive') {
      if (this._receiveLimits && Date.now() - this._receiveLimitsFetchedAt < TTL_MS) {
        return this._receiveLimits;
      }
      if (!this._boltzApiUrl) return null;
      try {
        const res = await fetch(`${this._boltzApiUrl}/v2/swap/reverse`);
        const pairs = await res.json();
        const limits = pairs?.BTC?.ARK?.limits;
        if (limits?.minimal != null) {
          this._receiveLimits = { min: Number(limits.minimal), max: Number(limits.maximal) };
          this._receiveLimitsFetchedAt = Date.now();
        }
      } catch (error) {
        console.warn('[arkade] could not fetch receive swap limits:', error?.message || error);
      }
      return this._receiveLimits;
    }
    if (this._sendLimits && Date.now() - this._sendLimitsFetchedAt < TTL_MS) {
      return this._sendLimits;
    }
    try {
      this._sendLimits = await this.lightningSwaps.getLimits();
      this._sendLimitsFetchedAt = Date.now();
    } catch (error) {
      console.warn('[arkade] could not fetch send swap limits:', error?.message || error);
    }
    return this._sendLimits;
  }

  /**
   * Pre-flight a swap amount against Boltz's min/max for the given direction
   * so the user gets a friendly, amount-aware error before any swap is
   * created.
   * @param {number} amountSats
   * @param {'send'|'receive'} direction
   */
  async _validateSwapAmount(amountSats, direction) {
    const sats = Math.floor(Number(amountSats) || 0);
    if (sats <= 0) return;
    const limits = await this.getLightningLimits(direction);
    if (!limits) return;
    if (limits.min && sats < limits.min) {
      const err = new Error(`Amount below the Lightning swap minimum (${limits.min} sats)`);
      err.code = 'ARKADE_SWAP_BELOW_MIN';
      err.minSats = Number(limits.min);
      throw err;
    }
    if (limits.max && sats > limits.max) {
      const err = new Error(`Amount above the Lightning swap maximum (${limits.max} sats)`);
      err.code = 'ARKADE_SWAP_ABOVE_MAX';
      err.maxSats = Number(limits.max);
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
      await this._validateSwapAmount(amount, 'receive');
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
      let invoiceSats = 0;
      try {
        invoiceSats = Number(getInvoiceSatoshis(invoice) || 0);
      } catch {
        /* leave 0 if the invoice can't be decoded; Boltz validates anyway */
      }
      await this._validateSwapAmount(invoiceSats, 'send');
      const r = await this.lightningSwaps.sendLightningPayment({ invoice });
      // Swap fee ≈ what left the wallet minus the invoice's own amount.
      let fee = 0;
      const paid = Number(r.amount || 0);
      if (invoiceSats > 0 && paid > 0) fee = Math.max(0, paid - invoiceSats);
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
   * signal is `notifyIncomingFunds` (the autonomous claim lands a VTXO), and
   * the SwapManager's completion event also marks the swap claimed here — so
   * this reports paid once either signal has arrived.
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
   * incoming funds (via notifyIncomingFunds / the SwapManager completion
   * event / balance reconcile). Lets lookupInvoice report completion for any
   * later poller.
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
  // VTXO recovery (Arkade-only — no analog in the other backends)
  // ==========================================

  /**
   * Reclaim swept/subdust VTXOs that have degraded to recoverable-only. The
   * SDK's background settlement handles renewal, boarding settlement and
   * signer migration on its own, but recovery of already-swept outputs stays
   * a manual call — this is it, throttled so a frequent balance refresh
   * doesn't trigger a settlement every time; pass `force` to bypass.
   *
   * Best-effort and non-throwing — a failed maintenance pass must never block
   * the balance/refresh path that calls it.
   *
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<{ recovered: boolean }>}
   */
  async checkLiveness({ force = false } = {}) {
    const out = { recovered: false };
    if (!this.wallet || !this.isConnected) return out;

    const THROTTLE_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    if (!force && now - this._lastRecoveryCheck < THROTTLE_MS) return out;
    this._lastRecoveryCheck = now;

    try {
      const manager = await this.wallet.getVtxoManager();
      const rec = await manager.getRecoverableBalance();
      if (rec && Number(rec.recoverable) > 0) {
        this._notifyMaintenance(true);
        try {
          await manager.recoverVtxos();
          out.recovered = true;
        } finally {
          this._notifyMaintenance(false);
        }
      }
    } catch (error) {
      console.warn('[arkade] VTXO recovery check failed:', error?.message || error);
    }
    return out;
  }

  _notifyMaintenance(active) {
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
    // (_mapSwapError is only called from the swap paths, so name-based
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
   * Best-effort deletion of a wallet's local databases. Call ONLY on
   * permanent wallet removal — NOT from disconnect(), which runs on every
   * wallet switch. The databases hold no seed (that lives encrypted in app
   * state); they cache public VTXO/contract/history data and pending-swap
   * bookkeeping, so a failure here is harmless residue.
   */
  static async deleteStorage(walletId) {
    await deleteDatabase(walletDbName(walletId));
    await deleteDatabase(legacyDbName(walletId));
    // Boltz pending-swap store (package-default name, single Arkade wallet).
    await deleteDatabase(BOLTZ_SWAP_DB);
  }
}

export default ArkadeWalletProvider;
