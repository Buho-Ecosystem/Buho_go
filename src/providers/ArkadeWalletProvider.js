/**
 * ArkadeWalletProvider — Arkade backend for BuhoGO.
 *
 * Implements the WalletProvider contract on top of `@arkade-os/sdk` 0.4.x.
 * Covers native ark1↔ark1 transfers and on-chain in both directions
 * (boarding receive + collaborative offboard send via the SDK's Ramps).
 *
 * Lightning is OUT OF SERVICE: it rode Boltz swaps, and the Boltz service
 * behind the retired `@arkade-os/boltz-swap` package is gone. The Lightning
 * methods below throw ARKADE_LN_UNAVAILABLE so any path that slips past the
 * capability gates fails with honest copy. The replacement (Arkade Intents,
 * `@arkade-os/swap` RFQ corridors) is mapped in
 * `Plans WIP/arkade-maintenance-map.md` - send is phase 1, receive is
 * blocked upstream until a solver serves the corridor.
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
import { decryptString } from '../utils/deviceCrypto';
import {
  ARKADE_MAINNET_SERVER,
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
// The retired boltz-swap package's IndexedDB. The package is gone; the name
// stays so deleteStorage() can still clear the residue on old installs.
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

    this._lastRecoveryCheck = 0;
    // Optional callback the store wires up to mirror "a recovery settlement
    // is in flight" into reactive state (subtle wallet-maintenance indicator).
    this._onMaintenance = null;
    // Optional callback the store wires up to react to background wallet
    // activity that changes the balance (restore scan, recovery settlement):
    // refresh, tell the user. `(kind, detail?, error?) => void`.
    this._onSwapActivity = null;
    // Optional callback the store wires up to persist "the one-time HD
    // restore scan finished" onto the wallet's metadata.
    this._onRestoreScanComplete = null;

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

  async disconnect() {
    try {
      if (this._stopIncoming) this._stopIncoming();
    } catch (error) {
      console.warn('[arkade] error stopping incoming-funds listener:', error);
    }
    this._stopIncoming = null;
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
        // `settled` means "anchored on Bitcoin via a batch swap" — but an
        // offchain Arkade transaction (arkTxid set) is final and spendable
        // the moment it exists, so showing it as pending would tell a user
        // their received (and spendable) money hasn't arrived. Only boarding
        // deposits genuinely await something (the settlement that converts
        // them into spendable balance).
        const spendable = tx.settled || Boolean(key.arkTxid);
        return {
          id,
          type: tx.type === 'RECEIVED' ? 'incoming' : 'outgoing',
          amount: Number(tx.amount || 0),
          timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0,
          status: spendable ? 'completed' : 'pending',
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
    // An ark-to-ark send can strand its change below dust, same as a Lightning
    // send. See _recoverChangeAfterSend.
    this._recoverChangeAfterSend();
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
  // Lightning (out of service - Boltz retired)
  // ==========================================

  /**
   * The one error every Lightning entry point throws while the rail is out.
   * Kept as real methods (not deleted) so any path that slips past the
   * capability gates fails with honest, translated copy
   * (userErrors: ARKADE_LN_UNAVAILABLE) instead of a TypeError.
   */
  _lightningUnavailable() {
    const err = new Error('Lightning is temporarily unavailable for Arkade wallets');
    err.code = 'ARKADE_LN_UNAVAILABLE';
    this.setError(err);
    return err;
  }

  /**
   * API-compat stub: callers (auto-withdraw pre-flight, the store's limits
   * mirror) treat null as "no known limits", which skips pre-validation.
   * @returns {Promise<null>}
   */
  async getLightningLimits() {
    return null;
  }

  /** @returns {Promise<null>} see getLightningLimits */
  async getLightningLimitsWhenReady() {
    return null;
  }

  /** Lightning receive is out of service - see the class header. */
  async createInvoice() {
    this._ensureConnected();
    throw this._lightningUnavailable();
  }

  /** Lightning send is out of service - see the class header. */
  async payInvoice() {
    this._ensureConnected();
    throw this._lightningUnavailable();
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
  /**
   * A send is the one event that reliably strands funds: paying 351 out of a
   * 498 sat wallet leaves a 147 sat change VTXO, and per the SDK's balance
   * contract a change output below the dust threshold is NOT counted in
   * `available` (spendable = settled + preconfirmed) but in `recoverable`
   * ("subdust or expired virtual outputs"). The wallet then reads as 0 even
   * though the funds are still ours, until the next recovery pass reclaims
   * them into spendable VTXOs.
   *
   * checkLiveness() runs on every balance refresh but is throttled to six
   * hours, so on its own it can leave the balance looking empty for most of a
   * day. Forcing one pass right after a send closes that window at exactly
   * the moment subdust can appear, without turning the periodic refresh into
   * a settlement storm.
   *
   * Fire and forget: the send already succeeded, and recovery is maintenance.
   */
  _recoverChangeAfterSend() {
    this.checkLiveness({ force: true }).catch((error) => {
      console.warn('[arkade] post-send recovery pass failed:', error?.message || error);
    });
  }

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
