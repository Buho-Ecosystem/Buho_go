import { preferredProfileLightningAddress as preferredProfileAddress } from '../utils/profilePaymentAddress.js';
/**
 * Wallet Store
 *
 * Pinia store for managing multiple Lightning wallets.
 * Supports both NWC (Nostr Wallet Connect) and Spark (self-custodial) wallets.
 */

import { defineStore } from 'pinia';
import { NostrWebLNProvider } from '@getalby/sdk';
import { fiatRatesService } from '../utils/fiatRates.js';
import { SELECTABLE_FIAT_CURRENCIES } from '../utils/fiatCurrencies.js';
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider';
import { ArkadeWalletProvider } from '../providers/ArkadeWalletProvider';
import { ARKADE_MAINNET_SERVER, ARKADE_DEFAULT_NETWORK } from '../utils/arkadeKeys';
import { createWalletProvider, inferWalletType, WALLET_TYPES } from '../providers/WalletFactory';
import {
  deleteWalletStorage as deleteBreezStorage,
  deleteAllStorage as deleteAllBreezStorage,
  probeAccountActivity as probeSparkAccountActivity,
} from '../services/breezSdk';
import { useAutoWithdrawStore } from './autoWithdraw';
import { useNotificationsStore } from './notifications';
import { formatAmount } from '../utils/amountFormatting.js';
import { internalTransferTransactionId } from '../utils/internalTransferDetails.js';
import { paymentHashOf, sdkProvesUnclaimed } from '../utils/breezPayments.js';
import { Invoice } from '@getalby/lightning-tools';
import {
  emptyBalanceState,
  hydrateBalanceState,
  nextBalanceState,
  describeBalance,
  summarizeTotal,
} from '../utils/balanceState.js';
import { sparkLifecycle, forgetSparkWallet } from '../services/sparkLifecycleApp.js';
import { scanSparkAccounts } from '../services/sparkAccountScan.js';
import {
  SPARK_ACCOUNT_ORDER,
  MAX_SPARK_WALLETS,
  isSparkAccountNumber,
  sparkAccountNumberOf,
  usedSparkAccounts,
  nextFreeSparkAccount,
  remainingSparkSlots as freeSparkSlots,
  canAddSparkWallet as sparkSlotAvailable,
  suggestWalletName,
} from '../utils/sparkAccounts.js';
import { migrateSparkWallets as migrateToSparkModel, SPARK_MODEL_VERSION } from '../utils/sparkWalletMigration.js';
import { normalizeWalletName, walletNameProblem, WalletNameError } from '../utils/walletNames.js';
import { removalCheck, WalletRemovalError } from '../utils/walletRemoval.js';
import { registerRandomLightningAddress } from '../utils/lightningAddressNames.js';

/** One output of one deposit transaction: `${txId}:${vout}` (vout defaults to 0). */
export function depositClaimKey(txId, outputIndex) {
  return `${txId}:${Number(outputIndex) || 0}`;
}

/** walletId → the last balance noticeIncomingPayment saw for it this session. */
const observedBalance = new Map();
// Shared by page ticks and store refreshes; the newest request owns its result.
const balanceReads = new Map();
// walletId -> { epoch, promise }: one store-level Spark connection attempt.
const sparkConnects = new Map();
// walletId -> bumped on disconnect, rebuild and removal. Work started under
// an older epoch must not publish providers, balances or info afterwards.
const walletEpochs = new Map();
// Wallets being removed right now: nothing may connect them meanwhile, or a
// reconnect could publish a live engine over the storage being deleted.
const removingWallets = new Set();
// Wallets being added right now: no save writes them before the add's own
// save does (_saveAddedWallets). An add that fails or is refused then leaves
// nothing on disk, and nothing outside the add (the profile, another window)
// takes a wallet for saved that may still be undone.
const addingWallets = new Set();
const epochOf = (walletId) => walletEpochs.get(walletId) || 0;

// Spark membership changes (create, restore, add, discover, remove) run one
// at a time, so two of them can never claim the same account.
let sparkMembershipChain = Promise.resolve();
function serializeSparkMembership(task) {
  const run = sparkMembershipChain.catch(() => {}).then(task);
  sparkMembershipChain = run;
  return run;
}
// Bumped whenever the last Spark wallet leaves the device: discovery started
// for one phrase must not add wallets after another phrase arrived.
let sparkPhraseEpoch = 0;
let sparkDiscoveryRun = null;
let sparkDiscoveryRerun = false;
// walletId -> in-flight Lightning address assignment: one at a time per
// wallet, so two registrations can never race to different names.
const lnAddressEnsures = new Map();
// Wallets whose Lightning address is being moved right now: the SDK's own
// change events for them are expected and must not trigger a reassignment.
const lnAddressMoves = new Set();
// Starts on which a restore keeps looking for unchecked accounts.
const MAX_DISCOVERY_ATTEMPTS = 5;
// Spark entries the multi-wallet migration could not keep (another phrase,
// a duplicate account). Nothing is ever deleted silently: a wallet on
// another phrase stays reachable in Manage Wallets, where its words can be
// shown and written down (a duplicate account needs nothing: its account is
// already on the list).
const SPARK_SET_ASIDE_KEY = 'buhoGO_spark_set_aside_v1';

/** Set-aside wallets on another recovery phrase: [{ id, name, encryptedMnemonic }]. */
function setAsideOtherPhrases() {
  try {
    return JSON.parse(localStorage.getItem(SPARK_SET_ASIDE_KEY) || '[]')
      .filter((entry) => entry?.reason === 'other_phrase' && entry.wallet?.connectionData?.encryptedMnemonic)
      .map(({ wallet }) => ({ id: wallet.id, name: wallet.name || '', encryptedMnemonic: wallet.connectionData.encryptedMnemonic }));
  } catch {
    return [];
  }
}

/** Store entries the migration could not keep. False when they could not be stored. */
function setAsideSparkWallets(entries) {
  try {
    const existing = JSON.parse(localStorage.getItem(SPARK_SET_ASIDE_KEY) || '[]');
    const known = new Set(existing.map((entry) => entry?.wallet?.id));
    const additions = entries
      .filter(({ wallet }) => !known.has(wallet.id))
      .map(({ wallet, reason }) => ({ reason, at: Date.now(), wallet }));
    localStorage.setItem(SPARK_SET_ASIDE_KEY, JSON.stringify([...existing, ...additions]));
    console.warn(`[wallet-store] set aside ${additions.length} Spark wallet entr${additions.length === 1 ? 'y' : 'ies'}:`, additions.map((a) => a.reason));
    return true;
  } catch (error) {
    console.error('[wallet-store] Spark entries could not be set aside, keeping them:', error?.message || error);
    return false;
  }
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireMnemonic(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') throw codedError('SPARK_MNEMONIC_REQUIRED', 'Mnemonic is required');
}

function translate(key, values) {
  try {
    return i18n.global.t(key, values);
  } catch {
    return key;
  }
}

/** Accounts a backup listed, valid and unique, in allocation order. */
function normalizeListedAccounts(accounts) {
  const seen = new Set();
  return (Array.isArray(accounts) ? accounts : [])
    .filter((entry) => isSparkAccountNumber(entry?.accountNumber) && !seen.has(entry.accountNumber) && seen.add(entry.accountNumber))
    .map((entry) => ({ accountNumber: entry.accountNumber, name: typeof entry.name === 'string' ? entry.name : '' }))
    .sort((a, b) => SPARK_ACCOUNT_ORDER.indexOf(a.accountNumber) - SPARK_ACCOUNT_ORDER.indexOf(b.accountNumber))
    .slice(0, MAX_SPARK_WALLETS);
}

/** A persisted discovery plan, or null when it is missing or malformed. */
function validDiscoveryPlan(plan) {
  if (!plan || !Array.isArray(plan.pending)) return null;
  const pending = plan.pending.filter(isSparkAccountNumber);
  if (!pending.length) return null;
  const names = plan.names && typeof plan.names === 'object' ? plan.names : {};
  return { pending, attempts: Number(plan.attempts) || 0, names };
}
import { useTransactionMetadataStore } from './transactionMetadata';
import { isLightningAddress } from '../utils/addressUtils.js';
import { createClaimedDepositRegistry } from '../utils/claimedDeposits.js';
import { exitKitService, clearExitData } from '../services/exitKit.js';
import { useExitKitStore } from './exitKit';
import { useEmergencyExitStore } from './emergencyExit';
import { isActive as isActiveExit } from '../utils/exitLedger.js';
import { isWalletBackedUp } from '../utils/backupStatus.js';
import {
  buildPaymentError,
  getUnsupportedBolt12OfferCopy,
  getUnsupportedSilentPaymentCopy,
  getUserFriendlyError,
  getUserFriendlyErrorMessage,
} from '../utils/userErrors';
import * as deviceCrypto from '../utils/deviceCrypto';
import { clearCachedTransactions } from '../utils/txCache.js';
import { i18n } from '../boot/i18n';
import { canWalletPay } from '../utils/walletCapabilities.js';
import {
  setScreenPrivacyEnabled as nativeSetScreenPrivacyEnabled,
  isScreenPrivacyEnabled as nativeIsScreenPrivacyEnabled,
} from '../utils/secureScreen';

/**
 * Storage keys for persistence
 */
const STORAGE_KEYS = {
  WALLET_STORE: 'buhoGO_wallet_store',
  LEGACY_STATE: 'buhoGO_wallet_state',
  DEVICE_KEY: 'buhoGO_device_key',
  // Prefix for a saved wallet state that could not be read. It is kept
  // under this prefix plus a unique suffix, never deleted, so the
  // encrypted phrases it may hold can still be recovered by hand.
  UNREADABLE_WALLET_STORE: 'buhoGO_wallet_store_unreadable',
};
const BALANCE_SCHEMA_VERSION = 1;

/**
 * Move a saved wallet state that is not JSON to its own key (see
 * UNREADABLE_WALLET_STORE), so the store starts empty and the person can
 * restore. Throws when it cannot be kept: nothing may then be saved over it.
 */
function setAsideUnreadableState(raw) {
  const base = `${STORAGE_KEYS.UNREADABLE_WALLET_STORE}_${Date.now()}`;
  let key = base;
  for (let n = 2; localStorage.getItem(key) !== null; n += 1) key = `${base}_${n}`;
  localStorage.setItem(key, raw);
  localStorage.removeItem(STORAGE_KEYS.WALLET_STORE);
  console.warn(`[wallet-store] The saved wallets could not be read; kept as ${key}`);
}

/**
 * The wallet entries saved right now. This store only ever writes JSON it
 * built, so a value it cannot read was written elsewhere: it counts as a
 * conflict, and nothing is saved over it.
 */
function savedWalletsOnDisk() {
  const raw = localStorage.getItem(STORAGE_KEYS.WALLET_STORE);
  if (!raw) return [];
  try {
    const wallets = JSON.parse(raw)?.wallets;
    if (wallets == null) return [];
    if (Array.isArray(wallets)) return wallets;
  } catch { /* unreadable: refused below */ }
  throw codedError('WALLET_STATE_CONFLICT', 'The saved wallets were changed elsewhere and cannot be read; nothing was saved');
}

// Durable double-claim guard for L1 deposits. Module-level rather than
// Pinia state: membership answers point-in-time questions and must
// survive restarts, not drive reactivity.
const claimedDepositRegistry = createClaimedDepositRegistry({
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
});
// When this session recorded each claim. A claim made moments ago can meet
// an SDK record read just before the claim landed; such a mark is never
// reconsidered until this window has passed.
const recentDepositClaims = new Map();
const CLAIM_MARK_SETTLE_MS = 10 * 60 * 1000;

/**
 * Thin adapter exposing the device-key crypto under the historical
 * `CryptoUtils.encryptMnemonic` / `decryptMnemonic` shape so the rest of
 * this 2.5k-line file doesn't churn. New code should import the shared
 * helpers from `utils/deviceCrypto` directly.
 */
const CryptoUtils = {
  encryptMnemonic: deviceCrypto.encryptString,
  decryptMnemonic: deviceCrypto.decryptString,
  migrateFromPin: deviceCrypto.migrateFromPin,
  isOldPinFormat: deviceCrypto.isOldPinFormat,
};

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    // Wallet list
    wallets: [],
    activeWalletId: null,

    // Connection states (keyed by wallet ID)
    connectionStates: {},

    // Wallet providers (keyed by wallet ID) - runtime only, not persisted
    providers: {},

    // Wallet data (keyed by wallet ID)
    // The one balance record (value + provenance + freshness). Numeric
    // compatibility getters and every screen derive from it.
    balanceStates: {},
    // Spark lifecycle health per wallet (services/sparkLifecycle.js):
    // { health, lastSyncAt, error, failures }. Connection status stays in
    // connectionStates; this is whether the connection is actually useful.
    sparkHealthStates: {},
    // Unclaimed on-chain deposits per Spark wallet, discovered by the
    // lifecycle for every wallet regardless of selection.
    pendingDepositsByWallet: {},
    // The most recent detected receipt { walletId, amountSats, at }, for
    // in-app surfaces; system notifications are posted by the lifecycle.
    lastReceipt: null,
    // Funds the wallet holds but cannot spend yet, keyed by wallet ID:
    // { pending, recoverable }. Arkade is the only backend that reports a
    // split today (boarding UTXOs awaiting confirmation, and subdust or
    // swept VTXOs awaiting a recovery pass). We keep it because `balances`
    // alone is the SPENDABLE figure: without this, a send that leaves
    // subdust change makes the wallet read as empty and the funds look lost.
    balanceDetails: {},
    walletInfos: {},

    // User preferences
    preferredFiatCurrency: 'USD',
    defaultDisplayCurrency: 'bitcoin', // 'bitcoin' or 'fiat' — what the balance shows on app open
    denominationCurrency: 'sats',
    useBip177Format: true, // BIP-177 (₿) vs Legacy (sats) format
    /**
     * Privacy mode for amounts. When true, every balance / running
     * total displayed in the UI substitutes a fixed-length bullet
     * placeholder (`••••`) instead of the actual number. Per-payment
     * amounts shown inside action flows (send, withdraw, payment
     * confirm) are *not* affected — those are tied to a specific
     * action the user is taking right now, not "your funds at rest".
     * Persisted so the preference survives reloads / restarts.
     */
    balanceHidden: false,

    // Exchange rates (BTC price in each currency)
    exchangeRates: {},
    exchangeRatesAvailable: false,
    exchangeRatesLastUpdate: null,
    exchangeRatesError: null,

    // Seed backup tracking
    hasBackedUp: false,
    backupDismissedUntil: null, // timestamp when banner dismissal expires

    // Biometric lock
    biometricsEnabled: false,

    // Screen-capture protection (Android FLAG_SECURE). Mirrors the
    // value persisted by SecureScreenPlugin's SharedPreferences,
    // which MainActivity reads on cold start before the WebView
    // loads. The Pinia copy exists so the Settings toggle is
    // reactive; the boot file `secure-screen.js` reconciles this
    // with the native source of truth on app start and propagates
    // user toggles back down through the plugin. Default mirrors
    // the native default — off until the user opts in.
    privacyScreenEnabled: false,

    // Global payment-error dialog state. A single global instance lives
    // in App.vue; any page or store funnels failures here via
    // showPaymentError() instead of building its own toast.
    paymentError: {
      visible: false,
      title: '',
      reason: '',
      reasonSource: null,        // 'upstream' | 'passthrough' | 'curated' | 'fallback'
      reasonAttribution: null,   // set when reasonSource === 'upstream'
      technical: null,
    },

    // Spark multi-wallet model (utils/sparkWalletMigration.js). A fresh
    // install starts on the current model; older saves migrate once.
    sparkModelVersion: SPARK_MODEL_VERSION,
    // Restore: Spark accounts still to check, persisted so an interrupted
    // restore resumes. { pending: number[], attempts, names: {account: name} }
    sparkDiscovery: null,
    // Runtime only: a discovery pass is running / what the last pass found
    // ({ count, unchecked, at }: wallets added, accounts given up on), for
    // the in-app notice.
    sparkDiscoveryRunning: false,
    sparkDiscoveryFound: null,

    // Migration: true if existing wallets still use old PIN encryption
    needsPinMigration: false,

    // Kiosk Mode
    kioskEnabled: false,
    kioskPin: '',
    kioskOwnerAccess: false, // true = merchant unlocked, false = locked to POS
    kioskWalletId: null, // which wallet receives kiosk payments

    // Kiosk — Tipping
    kioskTipEnabled: false,
    kioskTipValues: [5, 10, 20], // tip percentages
    kioskRoundUpEnabled: false,

    // Kiosk — Display
    kioskDisplayCurrency: 'sats', // 'sats' | 'fiat'

    // UI states
    isLoading: false,
    isConnecting: false,
    walletSwitching: false,
    // True while an Arkade wallet is renewing/recovering VTXOs in the
    // background (drives the subtle "wallet maintenance" indicator).
    arkadeMaintaining: false,
    // Boltz swap min/max for the active Arkade wallet, mirrored from the
    // provider once Lightning warms up so amount UIs can bound entry
    // synchronously. Null until known; shape {min, max} in sats.

    // Buffered payment intent from a boot-time deep link / NFC scan.
    // Boot files (deep-links.js, nfc.js) write here when a payment URI arrives
    // before Wallet.vue has mounted. Wallet.vue's watcher (with immediate: true)
    // drains and clears this on mount, so the intent is never lost to the race
    // between Capacitor's getLaunchUrl resolution and Vue's component lifecycle.
    pendingDeepLink: null,

    // Error tracking
    lastError: null,

    // Runtime-only initialization guards. These are not persisted; they
    // prevent boot flows (deep links, Wallet.vue) from racing each other
    // into duplicate store hydration / auto-connect work on cold start.
    isInitialized: false,
    // Loading has settled, read or failed: screens can paint while
    // connections and syncs continue in the background.
    hydrated: false,
    _initializePromise: null,

    // What a save may write (runtime only; see persistState). The saved
    // state is in memory (read, or nothing was saved): only this permits
    // saving, because a save replaces everything on disk. A failed read
    // leaves it false for the session.
    savedStateLoaded: false,
    // Ids of the wallets on disk as this store last read or wrote them. A
    // save may drop one of these (the person removed it), never a saved
    // wallet this store has not seen (another window added it).
    _savedWalletIds: [],
    // Saved entries this version cannot use (a missing secret, a type it
    // does not know): off the wallet list, but written back by every save.
    _unusableWallets: [],

    // Bitcoin L1 deposit-claim coordination.
    //
    // Two flows can claim the same UTXO concurrently: the silent auto-claim
    // in Wallet.vue and the manual "Add to Wallet" sheet in
    // L1BitcoinReceive.vue. Whichever lands second gets a misleading SDK
    // error ("needs more confirmations") because the UTXO is already gone.
    //
    // We mark a txId here the moment any flow starts a claim and clear it
    // when the flow finishes (success OR error). The UI uses
    // `isDepositClaimInFlight(txId)` to lock the manual button while
    // auto-claim is running, and the auto-claim path checks the same flag
    // before submitting a duplicate.
    //
    // Stored as a plain object map (not a Set) for Pinia reactivity.
    inFlightDepositClaims: {},

    // Bumped after a deposit claim completes so subscribed components
    // (L1BitcoinReceive) can refresh their pending-deposit list immediately
    // instead of waiting for the next 30s poll tick. Counter, not boolean,
    // so each completion triggers a fresh watcher fire.
    depositsRefreshSignal: 0,
    lastDepositsRefreshWalletId: null,
  }),

  getters: {
    // Compatibility view for existing consumers, derived from the same state.
    balances: (state) => Object.fromEntries(Object.entries(state.balanceStates)
      .filter(([, balance]) => balance.value != null)
      .map(([id, balance]) => [id, balance.value])),

    /**
     * Currently active wallet object
     */
    activeWallet: (state) => {
      return state.wallets.find((w) => w.id === state.activeWalletId) || null;
    },

    /**
     * Balance of the active wallet in sats
     */
    activeBalance: (state) => {
      return state.balanceStates[state.activeWalletId]?.value ?? 0;
    },

    /**
     * Total of every configured wallet's known balance in sats (saved
     * last-known values included). Whether that total is complete and
     * verified is `totalBalanceInfo`; never present this alone as exact.
     */
    totalBalance: (state) => {
      return summarizeTotal(state.wallets.map((w) => w.id), state.balanceStates).total;
    },

    /** { total, complete, stale, outdated, refreshing, unknownIds, staleIds } across all wallets. */
    totalBalanceInfo: (state) => {
      return summarizeTotal(state.wallets.map((w) => w.id), state.balanceStates);
    },

    /**
     * What every surface shows for one wallet: { known, value, status
     * ('unknown'|'loading'|'fresh'|'stale'|'error'), stale, refreshing,
     * source, verifiedAt, error }.
     */
    balanceStateFor: (state) => (walletId) => describeBalance(state.balanceStates[walletId]),

    /**
     * List of currently connected wallets
     */
    connectedWallets: (state) => {
      return state.wallets.filter((w) => state.connectionStates[w.id]?.connected);
    },

    /**
     * The default wallet (first wallet or explicitly marked)
     */
    defaultWallet: (state) => {
      return state.wallets.find((w) => w.isDefault) || state.wallets[0] || null;
    },

    /**
     * Wallets sorted by: active first, then default, then by last used
     */
    sortedWallets: (state) => {
      return [...state.wallets].sort((a, b) => {
        if (a.id === state.activeWalletId) return -1;
        if (b.id === state.activeWalletId) return 1;
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return (b.lastUsed || 0) - (a.lastUsed || 0);
      });
    },

    /**
     * Check if any wallet is connected
     */
    hasConnectedWallet: (state) => {
      return Object.values(state.connectionStates).some((s) => s?.connected);
    },

    /**
     * An amount in the person's fiat currency, formatted ('' while no rate is
     * known). Every wallet list shows it next to the Bitcoin figure, so the
     * conversion is always in view.
     */
    fiatValueOf: (state) => (sats) => {
      const currency = state.preferredFiatCurrency || 'USD';
      const rate = Number(state.exchangeRates?.[currency.toLowerCase()]);
      const amount = Number(sats);
      if (!(rate > 0) || !Number.isFinite(amount)) return '';
      return fiatRatesService.formatFiatAmount((amount / 100000000) * rate, currency);
    },

    /**
     * Check if fiat conversion is available
     */
    canShowFiat: (state) => {
      return state.exchangeRatesAvailable && Object.keys(state.exchangeRates).length > 0;
    },

    /**
     * Lightning address of the active wallet (user@domain), if any.
     *
     * Resolution order (wallet-type agnostic):
     *   1. `wallet.metadata.lud16` — the canonical storage slot, set by any flow
     *      that configures a lightning address (NWC lud16 param, LNBits lnurlp setup, etc.)
     *   2. For NWC wallets only: parse the `lud16` query param from `nwcUrl` as a fallback
     *      so wallets added before lud16 extraction was implemented still light up.
     *
     * Always returns a validated `user@domain` string or null. Spark
     * wallets carry a Breez-hosted address registered server-side against
     * the wallet identity.
     */
    activeWalletLightningAddress: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (!activeWallet) return null;

      // Helper: validate lightning address format (user@domain)
      const isValidLnAddress = (addr) => {
        if (!addr || typeof addr !== 'string') return false;
        const parts = addr.split('@');
        return parts.length === 2 && parts[0].length > 0 && parts[1].includes('.') && !addr.includes('://');
      };

      // Spark: live wallet info wins; the persisted metadata copy keeps
      // the address visible while the wallet is locked or not yet
      // connected.
      if (activeWallet.type === 'spark') {
        const breezAddress = state.walletInfos?.[activeWallet.id]?.lightningAddress
          || activeWallet.metadata?.lud16;
        return isValidLnAddress(breezAddress) ? breezAddress : null;
      }

      // Helper: extract lud16 from NWC URL string
      const extractLud16FromUrl = (url) => {
        if (!url) return null;
        try {
          const parsed = new URL(url.replace('nostr+walletconnect://', 'http://'));
          const lud16Raw = parsed.searchParams.get('lud16');
          if (lud16Raw && lud16Raw !== 'null' && isValidLnAddress(lud16Raw)) {
            return lud16Raw;
          }
        } catch (e) { /* ignore */ }
        return null;
      };

      // Check if already in metadata
      if (activeWallet.metadata?.lud16) {
        const stored = activeWallet.metadata.lud16;
        // Validate it's actually a clean lightning address
        if (isValidLnAddress(stored)) {
          return stored;
        }
        // metadata.lud16 might be corrupted (lud16 + NWC URI concatenated)
        // Extract the lightning address part before any protocol scheme
        if (stored.includes('@')) {
          const cleaned = stored.split(/nostr[+\s]/)[0];
          if (cleaned && isValidLnAddress(cleaned)) {
            return cleaned;
          }
        }
      }

      // Extract from nwcUrl for wallets added before lud16 extraction was implemented
      const extracted = extractLud16FromUrl(activeWallet.nwcUrl);
      if (extracted) return extracted;

      return null;
    },

    /**
     * Check if any Spark wallet exists
     */
    hasAnySparkWallet: (state) => {
      return state.wallets.some((w) => w.type === WALLET_TYPES.SPARK);
    },

    // Keep legacy alias for components that haven't migrated yet
    hasSparkWallet: (state) => {
      return state.wallets.some((w) => w.type === WALLET_TYPES.SPARK);
    },

    /**
     * Get all Spark wallets
     */
    sparkWallets: (state) => {
      return state.wallets.filter((w) => w.type === WALLET_TYPES.SPARK);
    },

    /**
     * Get the active Spark wallet, or fall back to the first one
     */
    sparkWallet: (state) => {
      const active = state.wallets.find((w) => w.id === state.activeWalletId);
      if (active?.type === WALLET_TYPES.SPARK) return active;
      return state.wallets.find((w) => w.type === WALLET_TYPES.SPARK) || null;
    },

    /**
     * Check if active wallet is Spark
     */
    isActiveWalletSpark: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      return activeWallet?.type === WALLET_TYPES.SPARK;
    },

    /**
     * Check if active wallet is LNBits
     */
    isActiveWalletLNBits: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      return activeWallet?.type === WALLET_TYPES.LNBITS;
    },

    /**
     * Whether to show the backup reminder banner.
     * True when: any Spark wallet has balance > 0 and is not backed up, and not recently dismissed.
     */
    shouldPromptBackup: (state) => {
      if (state.backupDismissedUntil && Date.now() < state.backupDismissedUntil) return false;
      // Seed-based backends (Spark, Arkade) are the only ones whose funds live
      // or die by a recovery phrase. Backup is deferred at onboarding by design;
      // we prompt once a wallet actually holds sats and isn't confirmed backed up.
      const seedWallets = state.wallets.filter(
        (w) => w.type === WALLET_TYPES.SPARK || w.type === WALLET_TYPES.ARKADE
      );
      if (seedWallets.length === 0) return false;
      return seedWallets.some((w) => {
        // Spark falls back to the legacy store-level flag for pre-migration
        // installs; Arkade (new) always uses its own per-wallet metadata flag.
        if (isWalletBackedUp(w, state.hasBackedUp)) return false;
        const balance = state.balanceStates[w.id]?.value ?? 0;
        return balance > 0;
      });
    },

    /**
     * Check if active wallet is NWC
     */
    isActiveWalletNWC: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      return activeWallet?.type === WALLET_TYPES.NWC;
    },

    /**
     * Get active wallet type
     */
    activeWalletType: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      // No active wallet is a legal state (fresh install, all wallets
      // removed): answer null instead of letting inferWalletType read
      // properties off undefined. Type comparisons downstream all read
      // false against null, which is the correct answer everywhere.
      if (!activeWallet) return null;
      return activeWallet.type || inferWalletType(activeWallet);
    },

    /**
     * Can any of the user's wallets pay this destination type? With "Pay
     * with" the paying wallet is chosen on the confirm sheet, so the gates
     * before it ask this, not whether the active wallet can.
     */
    canAnyWalletPay: (state) => (destinationType) =>
      state.wallets.some((w) => canWalletPay(w.type || inferWalletType(w), destinationType)),

    /**
     * Check if Spark wallet needs connection (no PIN required — auto-connects)
     */
    needsPinEntry: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== WALLET_TYPES.SPARK) return false;
      return !state.connectionStates[state.activeWalletId]?.connected;
    },

    /**
     * What every surface shows for one wallet's balance.
     * @returns {Function} (walletId) => { balance, known, outdated, refreshing,
     *   status, isLocked, isCached }: `known` false means a placeholder, never
     *   a dash or zero; `outdated` (the last refresh failed) means dimmed.
     */
    getDisplayBalance: (state) => (walletId) => {
      const wallet = state.wallets.find(w => w.id === walletId);
      if (!wallet) return { balance: 0, known: false, isLocked: false, isCached: false, status: 'unknown' };

      // Connection status and value freshness are separate questions: a
      // connected wallet can hold a stale value, and a disconnected one
      // can still show its last verified figure, labelled as such.
      const d = describeBalance(state.balanceStates[walletId]);
      const isLocked = wallet.type === WALLET_TYPES.SPARK && !state.connectionStates[walletId]?.connected;
      return {
        balance: d.known ? d.value : 0,
        known: d.known,
        isLocked,
        isCached: d.known && d.status !== 'fresh',
        // Known to be out of date: the last refresh failed. Only this is
        // shown dimmed; a value being re-verified reads as current.
        outdated: d.known && d.stale && !!d.error && !d.refreshing,
        status: d.status,
        refreshing: d.refreshing,
        verifiedAt: d.verifiedAt,
      };
    },

    /**
     * Check if a Spark wallet is currently locked
     */
    isSparkWalletLocked: (state) => (walletId) => {
      const wallet = state.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) return false;
      return !state.connectionStates[walletId]?.connected;
    },

    /**
     * Get Spark address for any wallet by ID
     * Works even when wallet is locked (uses persisted metadata)
     */
    getSparkAddress: (state) => (walletId) => {
      const wallet = state.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) return null;
      return state.walletInfos[walletId]?.sparkAddress
        || wallet?.metadata?.sparkAddress
        || null;
    },

    /** Whether another Spark wallet fits (utils/sparkAccounts.js). */
    canAddSparkWallet: (state) => sparkSlotAvailable(state.wallets),

    /** How many more Spark wallets can be added. */
    remainingSparkSlots: (state) => freeSparkSlots(state.wallets),

    maxSparkWallets: () => MAX_SPARK_WALLETS,

    /**
     * A Spark wallet's Lightning address: live wallet info first, the
     * persisted metadata copy while the wallet is locked or not yet
     * connected. Lowercased so every comparison against the profile's
     * lud16 is case-blind.
     */
    sparkLightningAddressOf: (state) => (wallet) => {
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) return null;
      const address = state.walletInfos?.[wallet.id]?.lightningAddress
        || wallet.metadata?.lud16
        || '';
      return isLightningAddress(address) ? String(address).toLowerCase() : null;
    },

    /**
     * The address the profile adopts by default: the oldest Spark wallet's
     * that has one. Null while none has, which sends the profile to its
     * Social Bucket fallback.
     */
    preferredProfileLightningAddress() {
      return preferredProfileAddress(this);
    },

    /**
     * Get the active Spark address (simple — just the active wallet's address)
     */
    activeSparkAddress: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== 'spark') return null;
      return state.walletInfos[state.activeWalletId]?.sparkAddress
        || activeWallet?.metadata?.sparkAddress
        || null;
    },

    // ─── Arkade getters (mirror the Spark block; a single wallet) ───

    /** Whether an Arkade wallet exists (only one is allowed — see D2). */
    hasArkadeWallet: (state) => {
      return state.wallets.some((w) => w.type === WALLET_TYPES.ARKADE);
    },

    /** The active Arkade wallet, or fall back to the (single) Arkade wallet. */
    arkadeWallet: (state) => {
      const active = state.wallets.find((w) => w.id === state.activeWalletId);
      if (active?.type === WALLET_TYPES.ARKADE) return active;
      return state.wallets.find((w) => w.type === WALLET_TYPES.ARKADE) || null;
    },

    /** Whether the active wallet is Arkade. */
    isActiveWalletArkade: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      return activeWallet?.type === WALLET_TYPES.ARKADE;
    },

    /**
     * Get the Arkade (ark1/tark1) address for any wallet by ID. Falls back to
     * the address cached in metadata so it resolves even before reconnect.
     */
    getArkadeAddress: (state) => (walletId) => {
      const wallet = state.wallets.find((w) => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.ARKADE) return null;
      return state.walletInfos[walletId]?.arkadeAddress
        || wallet?.metadata?.arkadeAddress
        || null;
    },

    /** The active Arkade address (the active wallet's ark1/tark1 address). */
    activeArkadeAddress: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== WALLET_TYPES.ARKADE) return null;
      return state.walletInfos[state.activeWalletId]?.arkadeAddress
        || activeWallet?.metadata?.arkadeAddress
        || null;
    },

    /** Kiosk is active and merchant has NOT unlocked */
    isKioskRestricted: (state) => state.kioskEnabled && !state.kioskOwnerAccess,

    /** The wallet object selected for kiosk payments */
    kioskWallet: (state) => state.wallets.find((w) => w.id === state.kioskWalletId) || null,
  },

  actions: {
    /**
     * Surface any user-facing failure via the global error dialog.
     * Funnels payment, withdraw, transfer, kiosk, link-resolution,
     * wallet-setup, identity, earn-payout and L1 errors into one
     * consistent surface so the upstream prose from LUD-06 / NWC /
     * LNbits / Spark SDK reaches the user verbatim. Name kept as
     * `showPaymentError` only for backwards-compatibility with the
     * existing call sites that predate the broader use.
     *
     * @param {Error|string} error
     * @param {object} ctx              See buildPaymentError docs for the
     *                                  full option list (context, title,
     *                                  reason, route, walletType,
     *                                  amountSats, t).
     */
    showPaymentError(error, ctx = {}) {
      const built = buildPaymentError(error, ctx, ctx.t || null);
      this.paymentError = {
        visible: true,
        title: built.title,
        reason: built.reason,
        reasonSource: built.reasonSource,
        reasonAttribution: built.reasonAttribution,
        technical: built.technical,
      };
    },

    /**
     * Explain a recognized BOLT12 offer consistently wherever it entered the
     * app (Send, NFC, or an Android deep link). No provider call is made for
     * this path, so the copy must not imply that a payment failed in flight.
     *
     * @param {{route?: string, t?: Function}} [ctx]
     */
    showUnsupportedSilentPayment(ctx = {}) {
      const t = typeof ctx.t === 'function'
        ? ctx.t
        : i18n.global.t.bind(i18n.global);
      const copy = getUnsupportedSilentPaymentCopy(t);
      this.showPaymentError(new Error('Silent Payment address detected'), {
        context: 'payment',
        title: copy.title,
        reason: copy.reason,
        route: ctx.route || 'Silent Payment address',
        t,
      });
    },

    showUnsupportedBolt12Offer(ctx = {}) {
      const t = typeof ctx.t === 'function'
        ? ctx.t
        : i18n.global.t.bind(i18n.global);
      const copy = getUnsupportedBolt12OfferCopy(t);
      this.showPaymentError(new Error('BOLT12 offer detected'), {
        context: 'payment',
        title: copy.title,
        reason: copy.reason,
        route: ctx.route || 'BOLT12 offer',
        t,
      });
    },

    /**
     * Close the global payment-error dialog and drop the held detail.
     */
    dismissPaymentError() {
      this.paymentError = {
        visible: false,
        title: '',
        reason: '',
        reasonSource: null,
        reasonAttribution: null,
        technical: null,
      };
    },

    /**
     * Mark a Bitcoin L1 deposit txId as currently being claimed. Idempotent.
     * Called by both the auto-claim flow (Wallet.vue) and the manual sheet
     * (L1BitcoinReceive.vue) so neither submits a duplicate to the SSP.
     */
    markDepositClaimInFlight(txId, outputIndex) {
      if (!txId) return;
      const key = depositClaimKey(txId, outputIndex);
      if (!this.inFlightDepositClaims[key]) {
        this.inFlightDepositClaims[key] = true;
      }
    },

    /**
     * Clear the in-flight marker for a txId. Always call from a `finally`
     * so a thrown error can't leave the UI permanently locked.
     */
    clearDepositClaimInFlight(txId, outputIndex) {
      if (!txId) return;
      const key = depositClaimKey(txId, outputIndex);
      if (this.inFlightDepositClaims[key]) {
        delete this.inFlightDepositClaims[key];
      }
    },

    /**
     * Reactive predicate: is this txId currently being claimed somewhere?
     * Use from templates as `walletStore.isDepositClaimInFlight(deposit.txId)`.
     */
    isDepositClaimInFlight(txId, outputIndex) {
      if (!txId) return false;
      // Without an output the question is about the whole transaction.
      if (outputIndex === undefined || outputIndex === null) {
        return Object.keys(this.inFlightDepositClaims).some((k) => k === txId || k.startsWith(`${txId}:`));
      }
      return !!this.inFlightDepositClaims[depositClaimKey(txId, outputIndex)]
        || !!this.inFlightDepositClaims[txId];
    },

    /**
     * Durably record that this deposit txId has been claimed (instant or
     * 3-conf). Unlike the in-flight marker above, this survives restarts:
     * an instantly-claimed deposit keeps appearing in the SDK's pending
     * list until its confirmations catch up, and without this record the
     * confirmed handler would submit the same UTXO a second time.
     */
    markDepositClaimed(txId, outputIndex) {
      if (!txId) return;
      claimedDepositRegistry.add(depositClaimKey(txId, outputIndex));
      recentDepositClaims.set(depositClaimKey(txId, outputIndex), Date.now());
    },

    /**
     * Drop claimed records the SDK proves wrong, so those deposits surface
     * and claim again. Builds before the claim-lock fix recorded a deposit as
     * claimed when the SDK's own (failing) attempt merely held the lock,
     * hiding confirmed deposits while their funds sat unclaimed on-chain.
     * Call with a fresh `getPendingDeposits()` list before filtering it.
     * @returns {number} how many records were released
     */
    reconcileDepositClaims(deposits) {
      let released = 0;
      for (const deposit of deposits || []) {
        if (!deposit?.txId || !sdkProvesUnclaimed(deposit)) continue;
        const key = depositClaimKey(deposit.txId, deposit.outputIndex);
        if (this.isDepositClaimInFlight(deposit.txId, deposit.outputIndex)) continue;
        if (Date.now() - (recentDepositClaims.get(key) || 0) < CLAIM_MARK_SETTLE_MS) continue;
        const a = claimedDepositRegistry.delete(key);
        const b = claimedDepositRegistry.delete(deposit.txId);
        if (a || b) {
          released += 1;
          console.warn('[deposits] released a claimed mark the SDK shows unclaimed:', key);
        }
      }
      return released;
    },

    /**
     * Has this deposit output already been claimed by this device? Keyed by
     * transaction AND output, so a second output of the same transaction
     * (several deposits, or one to each account) is never suppressed by the
     * first. A bare-txid record from an older build still counts as claimed.
     */
    isDepositClaimed(txId, outputIndex) {
      if (!txId) return false;
      return claimedDepositRegistry.has(depositClaimKey(txId, outputIndex))
        || claimedDepositRegistry.has(txId);
    },

    /**
     * Tell subscribed views (L1BitcoinReceive) to re-fetch their pending
     * deposit list now instead of waiting for the next poll. Bump the
     * counter so a `watch` on `depositsRefreshSignal` fires every time.
     */
    signalDepositsRefresh(walletId = this.activeWalletId) {
      this.lastDepositsRefreshWalletId = walletId;
      this.depositsRefreshSignal += 1;
    },

    // ==========================================
    // Canonical balance state (#293)
    // ==========================================

    /**
     * The one write path for a wallet balance: canonical state and the
     * persisted last-known value move together. Late or invalid readings
     * are dropped (see utils/balanceState.js); a read token that has
     * been superseded is dropped too.
     *
     * @returns {boolean} whether the reading was accepted
     */
    applyBalance(walletId, value, { source = 'sync', fresh, read = null, error = null, at } = {}) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet || (read && (read.walletId !== walletId || !this.isBalanceReadCurrent(read)))) return false;
      if (!this.balanceStates) this.balanceStates = {};
      const prev = this.balanceStates[walletId] || emptyBalanceState();
      const observedAt = at ?? Date.now();
      const next = nextBalanceState(prev, {
        value,
        source,
        fresh: fresh ?? source !== 'cache',
        at: observedAt,
        error,
      });
      if (next !== prev) this.balanceStates[walletId] = next;
      const accepted = value != null && Number.isFinite(Number(value)) && Number(value) >= 0
        && next.value === Number(value) && next.updatedAt === observedAt;
      if (!accepted) return false;

      // Reconcile the persisted projection even when the numerical balance
      // did not change (e.g. recovery from an older, inconsistent cache).
      const updatedAt = next.verifiedAt || next.updatedAt;
      if (wallet.metadata?.cachedBalance !== next.value || wallet.metadata?.balanceUpdatedAt !== updatedAt) {
        const valueChanged = wallet.metadata?.cachedBalance !== next.value;
        wallet.metadata = { ...wallet.metadata, cachedBalance: next.value, balanceUpdatedAt: updatedAt };
        // Changed funds must survive a restart immediately. Coalesce only
        // verification timestamps for unchanged figures.
        if (valueChanged) void this.persistState();
        else this._schedulePersist();
      }

      // Money only moves on a network-verified figure. Auto-withdraw also
      // re-verifies Spark itself before sending (stores/autoWithdraw.js).
      if (wallet && next.source !== 'cache' && next.source !== 'persisted' && next.value > 0 && fresh !== false) {
        try { useAutoWithdrawStore().checkAndExecute(walletId, next.value, this); } catch { /* harness/early boot */ }
      }
      return true;
    },

    markBalanceRefresh(walletId, refreshing) {
      if (!walletId) return;
      if (!this.balanceStates) this.balanceStates = {};
      const prev = this.balanceStates[walletId] || emptyBalanceState();
      if (prev.refreshing === !!refreshing) return;
      this.balanceStates[walletId] = { ...prev, refreshing: !!refreshing };
    },

    markBalanceError(walletId, message) {
      if (!walletId) return;
      if (!this.balanceStates) this.balanceStates = {};
      const prev = this.balanceStates[walletId] || emptyBalanceState();
      this.balanceStates[walletId] = { ...prev, error: message || 'Balance could not be refreshed' };
    },

    /** Saved last-known values become stale state on load: never a zero. */
    hydrateBalanceStates(legacyState = null) {
      const states = { ...(this.balanceStates || {}) };
      for (const wallet of this.wallets) {
        if (states[wallet.id]?.value != null) continue;
        const hydrated = hydrateBalanceState(wallet, legacyState);
        states[wallet.id] = hydrated;
        if (legacyState) {
          wallet.metadata = { ...wallet.metadata, cachedBalance: hydrated.value, balanceUpdatedAt: hydrated.updatedAt };
        }
      }
      this.balanceStates = states;
    },

    forgetBalance(walletId) {
      balanceReads.delete(walletId);
      if (this.balanceStates) delete this.balanceStates[walletId];
      if (this.sparkHealthStates) delete this.sparkHealthStates[walletId];
      if (this.pendingDepositsByWallet) delete this.pendingDepositsByWallet[walletId];
    },

    /** Persist soon, once: balance ticks must not hammer localStorage. */
    _schedulePersist() {
      if (this._persistTimer) return;
      this._persistTimer = setTimeout(() => {
        this._persistTimer = null;
        Promise.resolve(this.persistState?.()).catch(() => {});
      }, 750);
    },

    // ==========================================
    // Spark lifecycle hooks (services/sparkLifecycle.js)
    // ==========================================

    setSparkHealthState(walletId, health) {
      if (!this.sparkHealthStates) this.sparkHealthStates = {};
      this.sparkHealthStates[walletId] = { ...health };
    },

    noteSparkNetworkSync(walletId, at) {
      if (!this.sparkHealthStates) this.sparkHealthStates = {};
      const prev = this.sparkHealthStates[walletId] || {};
      this.sparkHealthStates[walletId] = { ...prev, lastSyncAt: at };
    },

    setPendingDeposits(walletId, deposits) {
      if (!this.pendingDepositsByWallet) this.pendingDepositsByWallet = {};
      this.pendingDepositsByWallet[walletId] = deposits || [];
    },

    /** A deposit claim landed: catch the owning wallet up right away. */
    onDepositClaimed(walletId) {
      sparkLifecycle?.()?.reconcile(walletId, 'event');
    },

    /**
     * Ask the lifecycle to reconcile Spark wallets now (user refresh,
     * switch). Resolves when the run(s) settle; never throws.
     */
    async reconcileSpark(walletIds = null, reason = 'user') {
      const lifecycle = sparkLifecycle?.();
      if (!lifecycle) return;
      const ids = walletIds || this.sparkWallets.map((w) => w.id);
      await Promise.allSettled(ids.map((id) => lifecycle.reconcile(id, reason)));
    },

    /**
     * Internal transfers in flight: { toWalletId, amountSats, until }. A
     * receipt matching one is the user's own move, never announced as
     * money arriving (services/paymentReceipts.js).
     */
    noteInternalTransfer(toWalletId, paymentHash, { windowMs = 10 * 60 * 1000 } = {}) {
      // Identity only: an amount cannot identify a payment, and matching on
      // it would hide an unrelated receipt of the same size (#297 review).
      if (!toWalletId || !paymentHash) return;
      this._internalTransfers = (this._internalTransfers || []).filter((t) => t.until > Date.now());
      this._internalTransfers.push({ toWalletId, paymentHash: String(paymentHash).toLowerCase(), until: Date.now() + windowMs });
    },

    isInternalTransferReceipt(walletId, payment) {
      const list = (this._internalTransfers || []).filter((t) => t.until > Date.now());
      this._internalTransfers = list;
      const hash = String(paymentHashOf(payment) || payment?.paymentHash || '').toLowerCase();
      if (!hash) return false;
      const idx = list.findIndex((t) => t.toWalletId === walletId && t.paymentHash === hash);
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    },

    /**
     * Starts loading the saved state (initialize()) and resolves once loading
     * has settled, which is early in initialize(): connections, rates and
     * syncs may still be running. Screens await this to paint at once. Never
     * rejects, also not when loading failed: `savedStateLoaded` tells the two
     * apart.
     */
    whenHydrated() {
      if (this.hydrated) return Promise.resolve();
      const init = this.initialize();
      return new Promise((resolve) => {
        const stop = this.$subscribe(() => {
          if (!this.hydrated) return;
          stop();
          resolve();
        });
        init.finally(() => { stop(); resolve(); });
      });
    },

    /**
     * Waits until the saved state is in memory. Throws WALLET_STATE_UNAVAILABLE
     * when it could not be read, so nothing is added to a list that cannot be
     * saved. Every action that adds a wallet starts here, before it reads or
     * changes the list. initialize() itself must never wait on it: it would
     * wait for itself.
     */
    async _requireSavedState() {
      await this.whenHydrated();
      if (!this.savedStateLoaded) throw codedError('WALLET_STATE_UNAVAILABLE', 'The saved wallets could not be loaded');
    },

    /**
     * Initialize the store from localStorage
     */
    async initialize() {
      if (this.isInitialized) {
        return;
      }

      if (this._initializePromise) {
        return this._initializePromise;
      }

      this._initializePromise = (async () => {
        let migrationNeedsPersist = false;
        try {
          // Load saved state. One that is not JSON is set aside, never
          // deleted, and the store starts empty.
          const savedState = localStorage.getItem(STORAGE_KEYS.WALLET_STORE);
          let parsed = null;
          try {
            parsed = savedState ? JSON.parse(savedState) : null;
          } catch {
            setAsideUnreadableState(savedState);
          }
          // Every wallet on disk, as read: a save may drop one of these.
          this._savedWalletIds = (parsed?.wallets || []).map((w) => w?.id);
          if (parsed) {

            // Check if cached exchange rates are still valid (less than 1 hour old)
            let ratesStillValid = false;
            if (parsed.exchangeRatesLastUpdate) {
              const lastUpdate = new Date(parsed.exchangeRatesLastUpdate);
              const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
              ratesStillValid = lastUpdate > oneHourAgo;
            }

            // Migrate old wallets without type field
            const storeBackedUp = parsed.hasBackedUp || false;
            const migratedWallets = (parsed.wallets || []).map(wallet => {
              const migrated = {
                ...wallet,
                type: wallet.type || inferWalletType(wallet)
              };
              // Migrate hasBackedUp from store-level to per-wallet metadata (pre-1.6.0 wallets)
              if (migrated.type === WALLET_TYPES.SPARK && migrated.metadata && migrated.metadata.hasBackedUp === undefined) {
                migrated.metadata.hasBackedUp = storeBackedUp;
              }
              return migrated;
            });

            // One recovery phrase, equal Spark wallets (utils/sparkWalletMigration.js).
            // Runs until it completes once; it never deletes a wallet: entries
            // it cannot keep (another phrase, a duplicate account) are set
            // aside in their own storage key.
            let sparkModelVersion = parsed.sparkModelVersion || 1;
            if (sparkModelVersion < SPARK_MODEL_VERSION) {
              const migration = await migrateToSparkModel(migratedWallets, {
                activeWalletId: parsed.activeWalletId || null,
                readSeed: (wallet) => CryptoUtils.decryptMnemonic(wallet.connectionData.encryptedMnemonic),
              });
              // Without a durable copy of what is set aside, nothing leaves the
              // list and the migration runs again on the next start.
              const stored = !migration.setAside.length || setAsideSparkWallets(migration.setAside);
              migratedWallets.splice(0, migratedWallets.length, ...(stored ? migration.wallets : migration.all));
              parsed.activeWalletId = stored ? migration.activeWalletId : migration.allActiveWalletId;
              if (migration.complete && stored) sparkModelVersion = SPARK_MODEL_VERSION;
              migrationNeedsPersist = true;
            }

            console.log(`[wallet-store] Loading ${migratedWallets.length} wallet(s):`, migratedWallets.map(w => `${w.type}:${w.name}`));

            this.$patch({
              wallets: migratedWallets,
              activeWalletId: parsed.activeWalletId || null,
              preferredFiatCurrency: parsed.preferredFiatCurrency || 'USD',
              defaultDisplayCurrency: parsed.defaultDisplayCurrency || 'bitcoin',
              denominationCurrency: parsed.denominationCurrency || 'sats',
              useBip177Format: parsed.useBip177Format !== undefined ? parsed.useBip177Format : true,
              balanceHidden: parsed.balanceHidden === true,
              exchangeRates: ratesStillValid ? (parsed.exchangeRates || {}) : {},
              exchangeRatesAvailable: ratesStillValid && parsed.exchangeRatesAvailable,
              exchangeRatesLastUpdate: ratesStillValid ? parsed.exchangeRatesLastUpdate : null,
              hasBackedUp: parsed.hasBackedUp || false,
              biometricsEnabled: parsed.biometricsEnabled || false,
              // Screen privacy: off by default. Only an explicitly
              // persisted choice takes effect; missing or undefined
              // means the user never opted in.
              privacyScreenEnabled: parsed.privacyScreenEnabled !== undefined
                ? !!parsed.privacyScreenEnabled
                : false,
              // Kiosk
              kioskEnabled: parsed.kioskEnabled || false,
              kioskPin: parsed.kioskPin || '',
              kioskOwnerAccess: this.kioskOwnerAccess || false, // preserve if already unlocked this session
              kioskWalletId: parsed.kioskWalletId || null,
              kioskTipEnabled: parsed.kioskTipEnabled || false,
              kioskTipValues: parsed.kioskTipValues || [5, 10, 20],
              kioskRoundUpEnabled: parsed.kioskRoundUpEnabled || false,
              kioskDisplayCurrency: parsed.kioskDisplayCurrency || 'sats',
              sparkModelVersion,
              sparkDiscovery: validDiscoveryPlan(parsed.sparkDiscovery),
            });
            // A migration that set the selected or kiosk wallet aside must not
            // leave either pointing at nothing.
            if (!this.wallets.some((w) => w.id === this.activeWalletId) && this.wallets.length) {
              this.activeWalletId = (this.wallets.find((w) => w.isDefault) || this.wallets[0]).id;
            }
            if (this.kioskWalletId && !this.wallets.some((w) => w.id === this.kioskWalletId)) {
              this.kioskWalletId = null;
            }
          }

          // Migrate the old Home snapshot once, before any persistence can
          // overwrite it. Conflicting unversioned caches need verification.
          let legacyBalances = null;
          if (parsed && parsed.balanceSchemaVersion !== BALANCE_SCHEMA_VERSION) {
            try { legacyBalances = JSON.parse(localStorage.getItem(STORAGE_KEYS.LEGACY_STATE)); } catch { /* unusable cache */ }
          }
          this.hydrateBalanceStates(legacyBalances);
          // Everything on disk is in memory now: saving is safe from here on.
          this.savedStateLoaded = true;
          // The Spark migration's result is written once, after the balance
          // snapshot moved too, so neither can be lost to the other.
          if (migrationNeedsPersist) await this.persistState();
          else if (legacyBalances) this._schedulePersist();

          // Validate wallets
          await this.validateWallets();
          this.hydrated = true;

          // Load exchange rates. Saved rates are already restored above; the
          // fresh ones arrive reactively instead of holding up startup.
          this.loadExchangeRates().catch(() => {});

          // Initialize auto-withdraw store
          const autoWithdrawStore = useAutoWithdrawStore();
          await autoWithdrawStore.initialize({ wallets: this.wallets });

          // Auto-connect Spark wallets — detect if migration from PIN is needed
          if (this.sparkWallets.length > 0) {
            if (typeof window !== 'undefined' && window.__AUDIT__) {
              // Audit harness: skip migration detection and provider init entirely
            } else {
              const firstSpark = this.sparkWallets[0];
              const isOld = await CryptoUtils.isOldPinFormat(firstSpark.connectionData.encryptedMnemonic);
              if (isOld) {
                this.needsPinMigration = true;
                console.log('[wallet] PIN migration required — waiting for user to enter PIN one last time');
              } else {
                await this.connectAllSparkWallets({ waitFor: [this.activeWalletId, this.kioskWalletId] });
              }
            }
          }

          // Auto-connect active non-Spark wallet
          if (this.activeWalletId) {
            const activeWallet = this.wallets.find(w => w.id === this.activeWalletId);
            if (activeWallet && activeWallet.type !== WALLET_TYPES.SPARK) {
              if (activeWallet.type === WALLET_TYPES.LNBITS) {
                await this.connectLNBitsWallet(this.activeWalletId).catch((err) => {
                  console.warn('LNBits auto-connect failed:', err.message);
                });
              } else {
                await this.connectWallet(this.activeWalletId).catch((err) => {
                  console.warn('Auto-connect failed:', err.message);
                });
              }
            }
          }
          // Every Spark wallet is owned by the app lifecycle, not by
          // whichever page or wallet is on screen (#292).
          if (this.sparkWallets.length > 0 && !(typeof window !== 'undefined' && window.__AUDIT__)) {
            sparkLifecycle?.()?.start();
          }
          // A restore that could not check every account yet carries on.
          if (!this.needsPinMigration) this._resumeSparkDiscovery();
        } catch (error) {
          console.error('Wallet store initialization error:', error);
          this.lastError = error.message;
        } finally {
          this.hydrated = true;
          this.isInitialized = true;
          this._initializePromise = null;
        }
      })();

      return this._initializePromise;
    },


    // ==========================================
    // Seed Backup Management
    // ==========================================

    /**
     * Mark seed as backed up after user verifies their phrase
     * @param {string} [walletId] - Specific wallet ID (defaults to active Spark wallet)
     */
    async confirmBackup(walletId) {
      const target = walletId
        ? this.wallets.find(w => w.id === walletId)
        : (this.activeWallet?.type === WALLET_TYPES.ARKADE ? this.activeWallet : this.sparkWallet);
      if (!target || ![WALLET_TYPES.SPARK, WALLET_TYPES.ARKADE].includes(target.type)) {
        throw new Error('No seed wallet to confirm');
      }
      const affected = target.type === WALLET_TYPES.SPARK ? this.sparkWallets : [target];
      const previous = affected.map(w => ({ wallet: w, metadata: w.metadata ? { ...w.metadata } : undefined }));
      const legacy = this.hasBackedUp;
      const dismissed = this.backupDismissedUntil;
      for (const w of affected) w.metadata = { ...w.metadata, hasBackedUp: true };
      if (target.type === WALLET_TYPES.SPARK) this.hasBackedUp = true;
      this.backupDismissedUntil = null;
      try {
        await this.persistState({ requireDurable: true });
      } catch (error) {
        for (const entry of previous) entry.wallet.metadata = entry.metadata;
        this.hasBackedUp = legacy;
        this.backupDismissedUntil = dismissed;
        throw error;
      }
    },

    /**
     * Dismiss the backup banner for 4 hours
     */
    dismissBackupPrompt() {
      this.backupDismissedUntil = Date.now() + (4 * 60 * 60 * 1000);
    },

    // ==========================================
    // Spark Wallet Methods
    // ==========================================
    //
    // Every Spark wallet is one account of the same recovery phrase
    // (utils/sparkAccounts.js): a new install starts with one, more are added
    // from Settings up to MAX_SPARK_WALLETS, and a restore finds every account
    // the phrase has used. Membership changes run one at a time through
    // `serializeSparkMembership`, so two of them never pick the same account.

    /**
     * The first Spark wallet on this device, from a freshly generated phrase.
     * Lands the person in it.
     * @param {{ mnemonic: string, network?: string, onProgress?: Function }} options
     */
    async createSparkWallet({ mnemonic, network = 'MAINNET', onProgress = () => {} } = {}) {
      return this._runSparkSetup(async () => {
        requireMnemonic(mnemonic);
        if (this.hasAnySparkWallet) throw codedError('SPARK_WALLET_EXISTS', 'Spark wallet already exists');
        onProgress('encrypting');
        const wallet = await this._createSparkWalletEntry({
          mnemonic,
          network,
          accountNumber: SPARK_ACCOUNT_ORDER[0],
          name: suggestWalletName(translate('Wallet'), this.wallets),
          hasBackedUp: false,
          connect: 'required',
          onProgress,
        });
        const previousActiveWalletId = this.activeWalletId;
        this._landOnNewWallet(wallet);
        onProgress('done');
        await this._saveAddedWallets([wallet], previousActiveWalletId);
        this._startSparkLifecycle(wallet.id);
        this._noteWalletsChanged();
        return wallet;
      });
    },

    /**
     * Bring back every wallet of a recovery phrase.
     *
     * On a device without Spark: the accounts a backup listed (or account 1)
     * are created now; every other account is checked in the background and
     * appears as soon as it shows use. On a device that already holds this
     * phrase: the missing accounts are added the same way. A different phrase
     * is refused, since all Spark wallets share one.
     *
     * @param {object} options
     * @param {string} options.mnemonic
     * @param {string} [options.network]
     * @param {{accountNumber: number, name?: string}[]} [options.accounts]  wallets a backup listed
     * @param {boolean} [options.phraseConfirmed] the person typed the phrase in,
     *   which proves they hold it. A cloud restore does not: the backup state
     *   then stays as it was, so the write-it-down prompt survives (as for the
     *   identity) and removing Spark still asks for a real backup first.
     * @param {Function} [options.onProgress]
     * @returns {Promise<{ wallet: object|null, added: object[], merged: boolean }>}
     */
    async restoreSparkWallets({ mnemonic, network = 'MAINNET', accounts = null, phraseConfirmed = true, onProgress = () => {} } = {}) {
      const result = await this._runSparkSetup(async () => {
        requireMnemonic(mnemonic);
        const listed = normalizeListedAccounts(accounts);
        const names = Object.fromEntries(listed.filter(a => a.name).map(a => [a.accountNumber, a.name]));

        if (this.hasAnySparkWallet) {
          if (!(await this._isSparkPhrase(mnemonic))) {
            throw codedError('SPARK_OTHER_PHRASE', 'A different Spark recovery phrase is already on this device');
          }
          const added = [];
          const backedUp = phraseConfirmed || this._sparkPhraseBackedUp();
          for (const { accountNumber, name } of listed) {
            if (usedSparkAccounts(this.wallets).has(accountNumber) || !sparkSlotAvailable(this.wallets)) continue;
            added.push(await this._createSparkWalletEntry({
              mnemonic, network: this._sparkNetwork(), accountNumber,
              name: this._freshSparkName(name), hasBackedUp: backedUp, connect: 'deferred',
            }));
          }
          const plan = this.sparkDiscovery;
          this._queueSparkDiscovery(names);
          if (phraseConfirmed) this._markSparkBackedUp();
          // A refused save keeps the backup marks (the phrase was typed in),
          // not the plan, which counts the undone wallets' accounts as taken.
          await this._saveAddedWallets(added, this.activeWalletId, () => { this.sparkDiscovery = plan; });
          for (const wallet of added) this._startSparkLifecycle(wallet.id);
          return { wallet: added[0] || null, added, merged: true };
        }

        // The first wallet proves the phrase works; a failure here undoes everything.
        const initial = listed.length ? listed : [{ accountNumber: SPARK_ACCOUNT_ORDER[0] }];
        onProgress('encrypting');
        const [first, ...rest] = initial;
        const wallet = await this._createSparkWalletEntry({
          mnemonic, network, accountNumber: first.accountNumber,
          name: this._freshSparkName(first.name), hasBackedUp: phraseConfirmed, connect: 'required', onProgress,
        });
        const added = [wallet];
        for (const { accountNumber, name } of rest) {
          if (!sparkSlotAvailable(this.wallets)) break;
          // Known to exist: listed at once, connected in the background.
          added.push(await this._createSparkWalletEntry({
            mnemonic, network, accountNumber, name: this._freshSparkName(name), hasBackedUp: phraseConfirmed, connect: 'deferred',
          }));
        }
        const landing = added.find(w => sparkAccountNumberOf(w) === SPARK_ACCOUNT_ORDER[0]) || wallet;
        const previousActiveWalletId = this.activeWalletId;
        const { sparkDiscovery: plan, hasBackedUp } = this;
        this._landOnNewWallet(landing);
        this._queueSparkDiscovery(names);
        if (phraseConfirmed) this.hasBackedUp = true;
        onProgress('done');
        // A refused save leaves no wallet of this phrase here, so its plan
        // and its backup flag go back too.
        await this._saveAddedWallets(added, previousActiveWalletId, () => {
          this.sparkDiscovery = plan;
          this.hasBackedUp = hasBackedUp;
        });
        for (const entry of added) this._startSparkLifecycle(entry.id);
        return { wallet: landing, added, merged: false };
      });
      // After the setup lock is released: discovery takes it per wallet it adds.
      if (result.added.length) this._noteWalletsChanged();
      this._resumeSparkDiscovery();
      return result;
    },

    /**
     * Add another Spark wallet from the phrase already on this device and
     * switch to it. Takes the lowest free account; a previously removed
     * account comes back with its history and Lightning address.
     * @param {{ name: string }} options
     */
    async addSparkWallet({ name } = {}) {
      return this._runSparkSetup(async () => {
        if (!this.hasAnySparkWallet) throw codedError('SPARK_NO_WALLET', 'No Spark wallet to add to');
        if (!sparkSlotAvailable(this.wallets)) throw codedError('SPARK_WALLET_LIMIT', 'Spark wallet limit reached');
        const problem = walletNameProblem(name, this.wallets);
        if (problem) throw new WalletNameError(problem);
        const mnemonic = await this.getSparkMnemonic();
        const wallet = await this._createSparkWalletEntry({
          mnemonic,
          network: this._sparkNetwork(),
          accountNumber: nextFreeSparkAccount(this.wallets),
          name: normalizeWalletName(name),
          hasBackedUp: this._sparkPhraseBackedUp(),
          connect: 'required',
        });
        // A refused save puts its account back in the discovery plan.
        const plan = this.sparkDiscovery;
        this._forgetQueuedSparkAccount(sparkAccountNumberOf(wallet));
        await this._saveAddedWallets([wallet], this.activeWalletId, () => { this.sparkDiscovery = plan; });
        this._startSparkLifecycle(wallet.id);
        this._noteWalletsChanged();
        await this.switchActiveWallet(wallet.id);
        return wallet;
      });
    },

    /**
     * One Spark membership change at a time, with the shared busy/error flags.
     * It starts once the saved wallets are in memory: every check the task
     * makes (a wallet exists, the phrase matches, a free account) reads them.
     */
    async _runSparkSetup(task) {
      this.isConnecting = true;
      this.lastError = null;
      try {
        await this._requireSavedState();
        return await serializeSparkMembership(task);
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    /**
     * Create one Spark wallet entry for `accountNumber`.
     *   connect: 'required'  connect now; a failure undoes the entry (the
     *                        caller needs a working wallet)
     *            'deferred'  do not wait: the account is known to exist and
     *                        the lifecycle connects it in the background
     *                        (the caller calls _startSparkLifecycle)
     * The caller's _saveAddedWallets saves the entry; no save writes it
     * before that. Discovery passes `bestEffort`: any save may write what it
     * finds, since an account of a phrase already saved is found again.
     */
    async _createSparkWalletEntry({ mnemonic, network, accountNumber, name, hasBackedUp, connect = 'required', bestEffort = false, onProgress = () => {} }) {
      if (!isSparkAccountNumber(accountNumber)) throw codedError('SPARK_ACCOUNT_INVALID', `Unsupported Spark account ${accountNumber}`);
      if (usedSparkAccounts(this.wallets).has(accountNumber)) throw codedError('SPARK_ACCOUNT_IN_USE', `Spark account ${accountNumber} already has a wallet`);
      if (!sparkSlotAvailable(this.wallets)) throw codedError('SPARK_WALLET_LIMIT', 'Spark wallet limit reached');

      const wallet = {
        id: this.generateWalletId(),
        type: WALLET_TYPES.SPARK,
        name,
        isActive: false,
        isDefault: false,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        connectionData: {
          encryptedMnemonic: await CryptoUtils.encryptMnemonic(mnemonic),
          network,
          accountNumber,
        },
        metadata: {
          // Written by the first successful connect: the derived address at
          // birth is the identity every later connect asserts against.
          sparkAddress: null,
          hasBackedUp: !!hasBackedUp,
        },
      };
      this.wallets.push(wallet);
      if (!bestEffort) addingWallets.add(wallet.id);

      if (connect === 'deferred') return wallet;
      onProgress('connecting');
      try {
        await this.connectSparkWallet(wallet.id);
      } catch (error) {
        await this._discardAddedWallet(wallet.id);
        throw error;
      }
      return wallet;
    },

    /**
     * Take back a wallet whose add did not complete: its connect or its save
     * failed. No save wrote it (see addingWallets), so it only leaves memory,
     * with its connection, balance and info, and for Spark its lifecycle
     * state and engine storage.
     */
    async _discardAddedWallet(walletId) {
      const isSpark = this.wallets.find(w => w.id === walletId)?.type === WALLET_TYPES.SPARK;
      this._bumpWalletEpoch(walletId);
      try {
        await this.providers[walletId]?.disconnect();
        this.connectionStates[walletId]?.nwcInstance?.close?.();
      } catch { /* closing is best-effort */ }
      delete this.providers[walletId];
      delete this.walletInfos[walletId];
      delete this.connectionStates[walletId];
      this.forgetBalance(walletId);
      const index = this.wallets.findIndex(w => w.id === walletId);
      if (index !== -1) this.wallets.splice(index, 1);
      addingWallets.delete(walletId);
      if (isSpark) {
        forgetSparkWallet?.(walletId);
        await deleteBreezStorage(walletId).catch(() => {});
      }
    },

    /** A wallet just set up becomes the one on screen (and the default when none is). */
    _landOnNewWallet(wallet) {
      for (const w of this.wallets) w.isActive = false;
      wallet.isActive = true;
      this.activeWalletId = wallet.id;
      if (!this.wallets.some(w => w.isDefault)) wallet.isDefault = true;
    },

    /** Start (or nudge) the app-wide Spark lifecycle for a wallet that just appeared (#292). */
    _startSparkLifecycle(walletId) {
      const lifecycle = sparkLifecycle?.();
      if (!lifecycle) return;
      lifecycle.start();
      lifecycle.reconcile(walletId, 'start');
    },

    /**
     * Wallets were added, removed, renamed or restored: the Drive backup may
     * need refreshing (stores/cloudBackup.js decides). Loaded lazily so the
     * wallet store keeps no static dependency on the backup store.
     */
    _noteWalletsChanged() {
      import('./cloudBackup.js')
        .then(({ useCloudBackupStore }) => useCloudBackupStore().noteWalletsChanged())
        .catch((error) => console.warn('[wallet] backup refresh not scheduled:', error?.message || error));
    },

    /** The network every Spark wallet on this device uses. */
    _sparkNetwork() {
      return this.sparkWallets[0]?.connectionData?.network || 'MAINNET';
    },

    /** One phrase, one backup: any Spark wallet confirmed means all are. */
    _sparkPhraseBackedUp() {
      return this.sparkWallets.some(w => isWalletBackedUp(w, this.hasBackedUp));
    },

    _markSparkBackedUp() {
      for (const w of this.sparkWallets) w.metadata = { ...w.metadata, hasBackedUp: true };
      this.hasBackedUp = true;
    },

    /** A name for a restored wallet: the backed-up one when still free, else a fresh default. */
    _freshSparkName(preferred) {
      if (preferred && !walletNameProblem(preferred, this.wallets)) return normalizeWalletName(preferred);
      return suggestWalletName(translate('Wallet'), this.wallets);
    },

    /** Whether `mnemonic` is the phrase the Spark wallets on this device use. */
    async _isSparkPhrase(mnemonic) {
      const current = await this.getSparkMnemonic();
      const words = value => String(value || '').trim().toLowerCase().split(/\s+/).join(' ');
      return words(current) === words(mnemonic);
    },

    // ---- Account discovery (restore) -------------------------------------
    //
    // The accounts still to check are persisted in `sparkDiscovery`, so a
    // restore interrupted by a closed app or a dead network resumes on the
    // next start. An account is dropped from the list once a check is
    // conclusive. Only passes that reached the network count as attempts, so
    // being offline never uses them up; after MAX_DISCOVERY_ATTEMPTS the rest
    // is left to the person, who is told (adding a wallet opens the next
    // account and finds it).

    /** Queue every account without a wallet for checking. */
    _queueSparkDiscovery(names = {}) {
      const used = usedSparkAccounts(this.wallets);
      const pending = SPARK_ACCOUNT_ORDER.filter(account => !used.has(account));
      const previous = this.sparkDiscovery;
      this.sparkDiscovery = pending.length
        ? { pending, attempts: 0, names: { ...(previous?.names || {}), ...names } }
        : null;
    },

    _forgetQueuedSparkAccount(accountNumber) {
      const plan = this.sparkDiscovery;
      if (!plan) return;
      const pending = plan.pending.filter(account => account !== accountNumber);
      this.sparkDiscovery = pending.length ? { ...plan, pending } : null;
    },

    /** Fire-and-forget discovery; the result surfaces through `sparkDiscoveryFound`. */
    _resumeSparkDiscovery() {
      if (!this.sparkDiscovery?.pending?.length) return;
      if (typeof window !== 'undefined' && window.__AUDIT__) return;
      this.discoverSparkAccounts().catch(error => {
        console.warn('[spark] account discovery paused:', error?.message || error);
      });
    },

    /**
     * Check the queued accounts and add a wallet for each one that shows use.
     * Single-flight: a second call joins the running one.
     * @returns {Promise<object[]>} wallets added
     */
    discoverSparkAccounts() {
      if (sparkDiscoveryRun) return sparkDiscoveryRun;
      sparkDiscoveryRun = this._discoverSparkAccounts().finally(() => {
        sparkDiscoveryRun = null;
        // The plan changed while this run was scanning (another restore or a
        // new phrase queued accounts): look at the newer plan as well.
        if (sparkDiscoveryRerun) {
          sparkDiscoveryRerun = false;
          this._resumeSparkDiscovery();
        }
      });
      return sparkDiscoveryRun;
    },

    async _discoverSparkAccounts() {
      const plan = this.sparkDiscovery;
      if (!plan?.pending?.length || !this.hasAnySparkWallet) {
        this.sparkDiscovery = null;
        return [];
      }
      const phraseEpoch = sparkPhraseEpoch;
      const used = usedSparkAccounts(this.wallets);
      const accounts = plan.pending.filter(account => !used.has(account));
      this.sparkDiscoveryRunning = true;
      try {
        const mnemonic = await this.getSparkMnemonic();
        const network = this._sparkNetwork();
        const results = await scanSparkAccounts(mnemonic, { accounts, network, probe: probeSparkAccountActivity });

        const added = [];
        const unresolved = [];
        for (const result of results) {
          if (!result.conclusive) { unresolved.push(result.accountNumber); continue; }
          if (!result.used) continue;
          try {
            const wallet = await serializeSparkMembership(async () => {
              // The phrase may have left the device while the probes ran.
              if (phraseEpoch !== sparkPhraseEpoch || !this.hasAnySparkWallet) return null;
              if (usedSparkAccounts(this.wallets).has(result.accountNumber) || !sparkSlotAvailable(this.wallets)) return null;
              return this._createSparkWalletEntry({
                mnemonic, network, accountNumber: result.accountNumber,
                name: this._freshSparkName(plan.names?.[result.accountNumber]),
                hasBackedUp: this._sparkPhraseBackedUp(), connect: 'deferred', bestEffort: true,
              });
            });
            if (wallet) {
              added.push(wallet);
              this._startSparkLifecycle(wallet.id);
            }
          } catch (error) {
            console.warn(`[spark] account ${result.accountNumber} found but not added:`, error?.message || error);
            unresolved.push(result.accountNumber);
          }
        }

        if (phraseEpoch !== sparkPhraseEpoch) {
          // Another phrase arrived meanwhile: its plan is not this run's to write.
          sparkDiscoveryRerun = !!this.sparkDiscovery?.pending?.length;
          return [];
        }
        let givenUp = 0;
        if (this.sparkDiscovery === plan) {
          const reachedNetwork = results.some(r => r.evidence);
          const attempts = (plan.attempts || 0) + (reachedNetwork ? 1 : 0);
          const keepLooking = this.hasAnySparkWallet && unresolved.length && attempts < MAX_DISCOVERY_ATTEMPTS;
          if (!keepLooking && this.hasAnySparkWallet) givenUp = unresolved.length;
          this.sparkDiscovery = keepLooking ? { ...plan, pending: unresolved, attempts } : null;
        } else if (this.sparkDiscovery) {
          // Re-planned during the scan: keep the newer plan, minus what this
          // run settled, and look at the rest next.
          const settled = new Set(results.filter(r => r.conclusive && !unresolved.includes(r.accountNumber)).map(r => r.accountNumber));
          const pending = this.sparkDiscovery.pending.filter(account => !settled.has(account));
          this.sparkDiscovery = pending.length ? { ...this.sparkDiscovery, pending } : null;
          sparkDiscoveryRerun = pending.length > 0;
        }
        await this.persistState();
        if (added.length || givenUp) {
          this.sparkDiscoveryFound = { count: added.length, unchecked: givenUp, at: Date.now() };
        }
        if (added.length) this._noteWalletsChanged();
        return added;
      } finally {
        this.sparkDiscoveryRunning = false;
      }
    },

    /**
     * Connect to a Spark wallet using device key
     * @param {string} walletId - Wallet ID
     */
    async connectSparkWallet(walletId, { forceReinit = false } = {}) {
      if (removingWallets.has(walletId)) throw new Error('Spark connection was cancelled');
      // Serialized per wallet: concurrent callers (startup, lifecycle,
      // switch, transfer) share one attempt instead of building separate
      // providers that race to publish.
      const pending = sparkConnects.get(walletId);
      if (pending) {
        if (!forceReinit && pending.epoch === epochOf(walletId)) return pending.promise;
        await pending.promise.catch(() => {});
        return this.connectSparkWallet(walletId, { forceReinit });
      }
      if (!forceReinit && this.providers[walletId]?.isConnected && this.connectionStates[walletId]?.connected) {
        return;
      }
      if (forceReinit || this.providers[walletId]) {
        this._bumpWalletEpoch(walletId);
        if (this.providers[walletId]) this.providers[walletId].isConnected = false;
      }
      const entry = { epoch: epochOf(walletId), promise: null };
      entry.promise = this._initializeSparkWallet(walletId, { forceReinit, epoch: entry.epoch });
      sparkConnects.set(walletId, entry);
      try {
        return await entry.promise;
      } finally {
        if (sparkConnects.get(walletId) === entry) sparkConnects.delete(walletId);
      }
    },

    /** Invalidate in-flight work for a wallet (disconnect, rebuild, removal). */
    _bumpWalletEpoch(walletId) {
      walletEpochs.set(walletId, epochOf(walletId) + 1);
    },

    walletEpoch(walletId) {
      return epochOf(walletId);
    },

    async _initializeSparkWallet(walletId, { forceReinit, epoch }) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) {
        throw new Error('Spark wallet not found');
      }
      // A removal or rebuild during any await below cancels this attempt:
      // it must not resurrect a removed wallet or overwrite a newer state.
      const current = () => epochOf(walletId) === epoch && this.wallets.includes(wallet) && !removingWallets.has(walletId);
      const assertCurrent = () => {
        if (!current()) throw new Error('Spark connection was cancelled');
      };
      let provider = null;

      try {
        // Decrypt mnemonic with device key
        const mnemonic = await CryptoUtils.decryptMnemonic(
          wallet.connectionData.encryptedMnemonic
        );

        // The full wallet object rides through the factory so the provider
        // can assert identity against the stored spark address before
        // going live.
        assertCurrent();
        provider = createWalletProvider(wallet);

        // Initialize with mnemonic. The Breez instance registry dedupes
        // live SDKs per wallet, so calling connectSparkWallet repeatedly
        // (startup, switch, balance poll, history load) never piles up
        // duplicate event streams. Pass forceReinit only when recovering
        // from a confirmed-dead connection.
        await provider.initializeWithMnemonic(mnemonic, { forceReinit });
        assertCurrent();

        // Store provider
        this.providers[walletId] = provider;

        // Update connection state
        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          error: null,
        };

        // First balance: a real sync when the network answers, otherwise the
        // local figure labelled stale (never a connect failure by itself).
        await this.refreshBalance(walletId, { provider, source: 'connect' });
        assertCurrent();

        // Get info
        const info = await provider.getInfo();
        assertCurrent();
        this.walletInfos[walletId] = info;

        // Record the derived spark address the first time this wallet
        // connects (new entries are created without one). It becomes the
        // reference every later connect's identity assertion checks
        // against, catching account-number or storage corruption before a
        // wrong wallet could ever be shown.
        if (info?.sparkAddress && !wallet.metadata.sparkAddress) {
          wallet.metadata.sparkAddress = info.sparkAddress;
          await this.persistState();
        }

        // Every Spark wallet holds a Lightning address:
        // keep the server's one, reclaim the remembered one, or mint a
        // random name (the user can change it in Settings). Non-fatal - a
        // failed lookup or registration retries on the next connect.
        if (typeof provider.ensureLightningAddress === 'function') {
          try {
            assertCurrent();
            await this._ensureSparkLightningAddress(walletId);
          } catch (error) {
            console.warn('Lightning address setup skipped:', error?.message || error);
          }
        }

        // Keep this wallet's emergency exit kit fresh: put a stored kit back
        // if the SDK databases are new, then refresh after every settled
        // payment. Non-fatal by design.
        try {
          exitKitService().onSparkConnected(walletId);
        } catch (error) {
          console.warn('exit kit sync skipped:', error?.message || error);
        }

      } catch (error) {
        if (!current()) {
          // Superseded: release what this attempt built and leave the newer
          // state alone. Attempts are serialized, so this cannot release a
          // newer provider's registry entry.
          if (provider) await Promise.resolve(provider.disconnect()).catch(() => {});
          if (this.providers[walletId] === provider) delete this.providers[walletId];
          throw error;
        }
        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: Date.now(),
          error: error.message,
        };
        throw error;
      }
    },

    /**
     * Record a Spark wallet's Lightning address wherever the app reads it:
     * `metadata.lud16` (persisted; also the memory the reclaim rule uses)
     * and the live wallet info (Settings row, receive screen). Passing null
     * is a no-op — the address rule is "always have one", never "clear it".
     */
    async setSparkLightningAddress(walletId, address) {
      if (!address) return;
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) return;
      // One address, one wallet: a stale read that hands back an address
      // another Spark wallet holds (right after a move) is not recorded.
      const lower = String(address).toLowerCase();
      if (this.sparkWallets.some(w => w.id !== walletId && this.sparkLightningAddressOf(w) === lower)) {
        console.warn('[wallet] ignored a Lightning address that another wallet holds');
        return;
      }
      const previousAddress = wallet.metadata?.lud16 || null;
      if (this.walletInfos[walletId]) {
        this.walletInfos[walletId].lightningAddress = address;
      }
      wallet.metadata = wallet.metadata || {};
      if (wallet.metadata.lud16 !== address) {
        wallet.metadata.lud16 = address;
        await this.persistState();
        // The published profile may point at the old name. Serve the user:
        // move it to the new one and publish a fresh profile event, without
        // being asked. A custom address is never touched (see the helper).
        // Not while the wallet is still being added: the add may yet be
        // undone, and the profile would then send payments to a phrase nobody
        // kept. Its save brings the profile along (_saveAddedWallets).
        if (!addingWallets.has(walletId)) {
          this._syncProfilePaymentAddress({ previousAddresses: [previousAddress], renamedTo: address })
            .catch(() => {});
        }
      }
    },

    /**
     * Give a Spark wallet its Lightning address: the server's, the one it
     * last held, or a fresh random name. One assignment per wallet at a time.
     * @param {string} walletId
     * @param {{ previousAddress?: string|null }} [options] the address to try
     *   reclaiming; defaults to the remembered one, null skips reclaiming
     * @returns {Promise<string|null>}
     */
    _ensureSparkLightningAddress(walletId, { previousAddress } = {}) {
      const pending = lnAddressEnsures.get(walletId);
      if (pending) return pending;
      const run = (async () => {
        const provider = this.providers[walletId];
        if (typeof provider?.ensureLightningAddress !== 'function') return null;
        const wallet = this.wallets.find(w => w.id === walletId);
        const address = await provider.ensureLightningAddress({
          previousAddress: previousAddress === undefined ? (wallet?.metadata?.lud16 || null) : previousAddress,
        });
        await this.setSparkLightningAddress(walletId, address);
        return address;
      })().finally(() => lnAddressEnsures.delete(walletId));
      lnAddressEnsures.set(walletId, run);
      return run;
    },

    /** The wallet no longer holds the address it remembered (moved away, or released elsewhere). */
    async _forgetSparkLightningAddress(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) return;
      if (this.walletInfos[walletId]) this.walletInfos[walletId].lightningAddress = null;
      if (wallet.metadata?.lud16) {
        wallet.metadata = { ...wallet.metadata };
        delete wallet.metadata.lud16;
        await this.persistState();
      }
    },

    /**
     * The SDK reported a new (or no) Lightning address for a wallet, for
     * example after a change on another device. An address is recorded; a
     * wallet left without one gets a fresh name, since every Spark wallet
     * keeps one. Changes made by a move in progress are already handled.
     */
    async noteSparkLightningAddress(walletId, address) {
      if (lnAddressMoves.has(walletId) || !this.wallets.some(w => w.id === walletId)) return;
      if (address) {
        await this.setSparkLightningAddress(walletId, address);
        return;
      }
      await this._forgetSparkLightningAddress(walletId);
      await this._ensureSparkLightningAddress(walletId, { previousAddress: null }).catch((error) => {
        console.warn('Lightning address not reassigned yet:', error?.message || error);
      });
    },

    /**
     * Hand a Spark wallet's Lightning address to another of the person's
     * Spark wallets (Breez address transfer: the source authorises the
     * target's identity key, the target claims). The target's own address
     * is replaced; the source gets a fresh random name it can change later.
     * A profile pointing at the target's old address moves with the target
     * to the moved address; one pointing at the moved address keeps working
     * as it is.
     *
     * @returns {Promise<{ moved: string, sourceAddress: string|null }>}
     * Errors carry `code`: LN_ADDRESS_INVALID_TARGET, LN_ADDRESS_NOT_CONNECTED,
     * LN_ADDRESS_NONE, LN_ADDRESS_TRANSFER_FAILED (nothing changed).
     */
    async moveSparkLightningAddress(fromWalletId, toWalletId) {
      const from = this.wallets.find(w => w.id === fromWalletId && w.type === WALLET_TYPES.SPARK);
      const to = this.wallets.find(w => w.id === toWalletId && w.type === WALLET_TYPES.SPARK);
      if (!from || !to || from.id === to.id) throw codedError('LN_ADDRESS_INVALID_TARGET', 'Choose another Spark wallet');
      if (lnAddressMoves.has(from.id) || lnAddressMoves.has(to.id)) throw codedError('LN_ADDRESS_BUSY', 'An address is already moving');

      lnAddressMoves.add(from.id);
      lnAddressMoves.add(to.id);
      try {
        for (const wallet of [from, to]) {
          if (!this.providers[wallet.id]?.isConnected) {
            await this.connectSparkWallet(wallet.id).catch(() => {});
          }
          if (!this.providers[wallet.id]?.isConnected) throw codedError('LN_ADDRESS_NOT_CONNECTED', `${wallet.name} is not connected`);
        }
        const source = this.providers[from.id];
        const target = this.providers[to.id];
        // The server's word, not the cache: only a held address can move.
        const moving = (await source.getLightningAddress())?.lightningAddress;
        if (!moving) throw codedError('LN_ADDRESS_NONE', `${from.name} has no Lightning address to move`);
        const targetPubkey = target.identityPubkey?.();
        if (!targetPubkey) throw codedError('LN_ADDRESS_NOT_CONNECTED', `${to.name} is not ready yet`);

        let claimed;
        try {
          const authorization = await source.authorizeLightningAddressTransfer(targetPubkey);
          claimed = await target.claimLightningAddressTransfer(authorization);
        } catch (error) {
          console.warn('[wallet] Lightning address transfer refused:', error?.message || error);
          throw codedError('LN_ADDRESS_TRANSFER_FAILED', 'The address could not be moved; nothing changed');
        }
        const movedAddress = claimed?.lightningAddress || moving;

        // The source no longer holds it: forgotten first, so it is never
        // reclaimed and never recorded on two wallets at once.
        await this._forgetSparkLightningAddress(from.id);
        // setSparkLightningAddress also moves a profile that pointed at the
        // target's old address along to the moved one.
        await this.setSparkLightningAddress(to.id, movedAddress);
        let sourceAddress = null;
        try {
          sourceAddress = await this._ensureSparkLightningAddress(from.id, { previousAddress: null });
          if (sourceAddress && sourceAddress.toLowerCase() === movedAddress.toLowerCase()) {
            // The source's SDK still reported the moved name from its cache.
            const fresh = await registerRandomLightningAddress(source);
            await this.setSparkLightningAddress(from.id, fresh);
            sourceAddress = fresh;
          }
        } catch (error) {
          // Assigned on its next connect instead.
          console.warn('[wallet] new address for the source wallet deferred:', error?.message || error);
          sourceAddress = null;
        }
        this._noteWalletsChanged();
        return { moved: movedAddress, sourceAddress };
      } finally {
        lnAddressMoves.delete(from.id);
        lnAddressMoves.delete(to.id);
      }
    },

    /**
     * Keep the published profile's payment address in step with the app's
     * default. Runs after a Spark address changes or a Spark wallet is
     * removed: when the profile pointed at an old default (one of the given
     * previous addresses, or the Social Bucket), it adopts the current
     * preferred address and publishes a fresh profile event. A renamed
     * address (`renamedTo`) is followed to the same wallet. An address the
     * user typed themselves is never touched. Dynamic imports keep the
     * wallet store free of a static profile dependency.
     */
    async _syncProfilePaymentAddress({ previousAddresses = [], renamedTo = null } = {}) {
      try {
        const [
          { useProfileStore },
          { useIdentityStore },
          { npubCashAddress, isNpubCashAddress },
        ] = await Promise.all([
          import('./profile.js'),
          import('./identity.js'),
          import('../services/npubCash.js'),
        ]);
        const profile = useProfileStore();
        const identity = useIdentityStore();
        await identity.hydrate();
        if (!identity.bootstrapped) return;
        await profile.hydrate();

        const preferred = this.preferredProfileLightningAddress
          || npubCashAddress(identity.nostrNpub);
        if (!preferred) return;

        const previous = previousAddresses
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        // The profile pointed at a wallet whose address was just renamed: it
        // stays with that wallet, wherever it ranks.
        const followsRename = Boolean(renamedTo) && previous.includes(String(profile.lud16).toLowerCase());
        // A profile brought from another app is the person's own (see the
        // payment-address boot): a wallet change only carries an address it
        // took from one of these wallets through that wallet's rename.
        // Checked last, so a switch during the loads above is seen.
        if (identity.activeExternalId) {
          if (followsRename) profile.setField('lud16', renamedTo);
          return;
        }
        profile.adoptDefaultPaymentAddress(followsRename ? renamedTo : preferred, {
          isReplaceable: (current) => {
            const value = String(current).toLowerCase();
            return isNpubCashAddress(value) || previous.includes(value);
          },
        });
        // The shared profile lifecycle publishes and retries this durable edit.
      } catch (err) {
        console.warn('[wallet] could not sync the profile payment address:', err);
      }
    },

    /**
     * Connect every Spark wallet: all of them stay live, each with its own
     * Breez instance and storage, so balances, events, deposits and exit
     * kits stay current whichever wallet is on screen (#285). The active
     * wallet connects first; the registry serializes per wallet.
     */
    async connectAllSparkWallets({ waitFor = null } = {}) {
      const first = new Set((waitFor || [this.activeWalletId]).filter(Boolean));
      const ordered = [...this.sparkWallets].sort((a, b) => (first.has(a.id) ? 0 : 1) - (first.has(b.id) ? 0 : 1));
      const connectEach = async (wallets) => {
        for (const wallet of wallets) {
          if (this.connectionStates[wallet.id]?.connected && this.providers[wallet.id]?.isConnected) continue;
          try {
            await this.connectSparkWallet(wallet.id);
          } catch (err) {
            console.warn(`Failed to connect Spark wallet "${wallet.name}":`, err.message);
          }
        }
      };
      if (!waitFor) return connectEach(ordered);
      // Startup: the wallets on screen (active, kiosk) first and awaited;
      // the others follow one at a time in the background, so up to six
      // connects never hold up Home or the kiosk.
      await connectEach(ordered.filter(w => first.has(w.id)));
      connectEach(ordered.filter(w => !first.has(w.id))).catch(() => {});
    },

    /**
     * Get decrypted mnemonic for a Spark wallet
     * @param {string} [walletId] - Specific wallet ID (defaults to active Spark wallet)
     * @returns {Promise<string>} Mnemonic
     */
    async getSparkMnemonic(walletId) {
      const wallet = walletId
        ? this.wallets.find(w => w.id === walletId && w.type === WALLET_TYPES.SPARK)
        : this.activeWallet?.type === WALLET_TYPES.SPARK ? this.activeWallet : this.sparkWallet;
      if (!wallet) {
        throw new Error('No Spark wallet found');
      }

      return CryptoUtils.decryptMnemonic(
        wallet.connectionData.encryptedMnemonic
      );
    },

    /**
     * Get Spark wallet provider
     * @param {string} walletId
     * @returns {BreezSparkWalletProvider|null}
     */
    getSparkProvider(walletId) {
      return this.providers[walletId] || null;
    },

    /**
     * One-time migration: re-encrypt all Spark wallets from old PIN scheme to device key.
     * Called once after update for users who had a PIN. After this, PIN is never needed again.
     * @param {string} pin - The user's existing 6-digit PIN (one last time)
     */
    async migrateSparkWallets(pin) {
      for (const wallet of this.sparkWallets) {
        const newEncrypted = await CryptoUtils.migrateFromPin(
          wallet.connectionData.encryptedMnemonic,
          pin
        );
        wallet.connectionData.encryptedMnemonic = newEncrypted;
      }

      this.needsPinMigration = false;
      await this.persistState();

      // Now connect with the new device key encryption
      await this.connectAllSparkWallets();
      sparkLifecycle?.()?.start();
      this._resumeSparkDiscovery();
    },

    // ==========================================
    // Arkade Wallet Methods
    // ==========================================

    /**
     * Create or restore the (single) Arkade wallet. Mirrors addLNBitsWallet's
     * single-wallet add → activate → connect → persist shape, plus the
     * mnemonic generation + device-key encryption that Spark does.
     *
     * @param {Object} walletData
     * @param {string} [walletData.name] - Display name (default 'Arkade')
     * @param {string} [walletData.mnemonic] - Restore phrase; omit to generate fresh
     * @param {boolean} [walletData.isRestore] - True on restore (marks backed up)
     * @param {string} [walletData.network] - SDK NetworkName (default mainnet 'bitcoin')
     * @param {string} [walletData.arkServerUrl]
     * @param {Function} [walletData.onProgress] - ('encrypting'|'connecting'|'done') => void
     * @returns {Promise<Object>} The created wallet object
     */
    async addArkadeWallet(walletData = {}) {
      this.isConnecting = true;
      this.lastError = null;
      const onProgress = walletData.onProgress || (() => {});

      try {
        // Before the snapshot below: a rollback restores the selection it
        // read, and only the loaded store holds the real one.
        await this._requireSavedState();
        // Snapshot for atomic rollback.
        const previousActiveWalletId = this.activeWalletId;

        // Only one Arkade wallet is allowed (D2).
        if (this.hasArkadeWallet) {
          const err = new Error('Arkade wallet already exists');
          err.code = 'ARKADE_WALLET_EXISTS';
          throw err;
        }

        const network = walletData.network || ARKADE_DEFAULT_NETWORK;
        const arkServerUrl = walletData.arkServerUrl || ARKADE_MAINNET_SERVER;

        // Generate a fresh phrase, or accept the one being restored. Validate
        // either way so a bad restore phrase fails fast — before we encrypt and
        // persist a wallet that could never connect.
        const mnemonic = walletData.mnemonic || ArkadeWalletProvider.generateMnemonic();
        if (!ArkadeWalletProvider.isValidMnemonic(mnemonic)) {
          const err = new Error('Invalid recovery phrase');
          err.code = 'ARKADE_INVALID_MNEMONIC';
          throw err;
        }

        onProgress('encrypting');
        const encryptedMnemonic = await CryptoUtils.encryptMnemonic(mnemonic);

        const wallet = {
          id: this.generateWalletId(),
          type: WALLET_TYPES.ARKADE,
          name: walletData.name || 'Arkade',
          isActive: false,
          isDefault: this.wallets.length === 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          connectionData: {
            encryptedMnemonic,
            arkServerUrl,
            network,
          },
          metadata: {
            // Backup is deferred at onboarding: a fresh wallet is NOT marked
            // backed up, so shouldPromptBackup nudges the user once funds land.
            // A restore implies the user already holds the phrase.
            hasBackedUp: !!walletData.isRestore,
          },
        };

        this.wallets.push(wallet);
        addingWallets.add(wallet.id);

        // Land on the new wallet, then connect it (builds the provider, caches
        // balance + the ark1 address). Atomic rollback: a connect failure takes
        // the wallet back out here, a refused save in _saveAddedWallets, so a
        // half-added Arkade wallet never stays in memory or storage.
        this.activeWalletId = wallet.id;
        wallet.isActive = true;

        onProgress('connecting');
        try {
          await this.connectArkadeWallet(wallet.id);
        } catch (error) {
          await this._undoAdd([wallet], previousActiveWalletId);
          throw error;
        }

        onProgress('done');
        await this._saveAddedWallets([wallet], previousActiveWalletId);
        this._noteWalletsChanged();
        return wallet;
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    /**
     * Connect (or reconnect) the Arkade wallet: build the provider, open the
     * SDK wallet from the encrypted seed, and cache balance + info. Mirrors
     * connectLNBitsWallet.
     * @param {string} walletId
     */
    async connectArkadeWallet(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.ARKADE) {
        throw new Error('Arkade wallet not found');
      }

      try {
        const provider = new ArkadeWalletProvider(walletId, {
          name: wallet.name,
          network: wallet.connectionData.network,
          arkServerUrl: wallet.connectionData.arkServerUrl,
          encryptedMnemonic: wallet.connectionData.encryptedMnemonic,
          // One-time HD restore scan bookkeeping lives on the wallet's
          // persisted metadata so it travels with the wallet (and dies with
          // it), instead of a parallel storage domain.
          restoreScanDone: !!wallet.metadata?.arkadeRestoreScanned,
        });

        provider._onRestoreScanComplete = () => {
          if (!wallet.metadata) wallet.metadata = {};
          wallet.metadata.arkadeRestoreScanned = true;
        };

        // Mirror background VTXO maintenance into reactive store state so the
        // UI can show a subtle indicator while a settlement is in flight.
        provider._onMaintenance = (active) => { this.arkadeMaintaining = active; };

        // Background swap lifecycle (autonomous claims of incoming Lightning,
        // auto-refunds of failed outgoing swaps) changes the balance without a
        // user action — refresh so the UI reflects it promptly.
        provider._onSwapActivity = (kind, swap, error) => {
          if (kind === 'failed') {
            console.warn('[arkade] swap failed, auto-refund handling engaged:',
              swap?.id, error?.message || error);
          }
          this.refreshWalletData(walletId).catch(() => {});
        };

        await provider.connect();

        this.providers[walletId] = provider;
        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          error: null,
        };

        await this.refreshBalance(walletId, { provider, source: 'connect' });

        const info = await provider.getInfo();
        this.walletInfos[walletId] = info;

        // Cache the ark1 address on the wallet so it renders while locked /
        // before reconnect (mirrors Spark's metadata.sparkAddress cache).
        if (info?.arkadeAddress) {
          if (!wallet.metadata) wallet.metadata = {};
          wallet.metadata.arkadeAddress = info.arkadeAddress;
        }
      } catch (error) {
        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: Date.now(),
          error: error.message,
        };
        throw error;
      }
    },

    /**
     * Get the decrypted recovery phrase for the (active) Arkade wallet.
     * @param {string} [walletId]
     * @returns {Promise<string>}
     */
    async getArkadeMnemonic(walletId) {
      const wallet = walletId
        ? this.wallets.find((w) => w.id === walletId && w.type === WALLET_TYPES.ARKADE)
        : this.arkadeWallet;
      if (!wallet) {
        throw new Error('No Arkade wallet found');
      }
      return CryptoUtils.decryptMnemonic(wallet.connectionData.encryptedMnemonic);
    },

    /**
     * Decrypt the recovery phrase for any seed-based wallet (Spark or Arkade),
     * by id or — with none — the active seed wallet. Both backends store
     * `connectionData.encryptedMnemonic` under the same device key, so the
     * decrypt is identical and the shared seed-phrase dialog can reveal either.
     * @param {string} [walletId]
     * @returns {Promise<string>}
     */
    /** Wallets set aside on another recovery phrase, for Manage Wallets: [{ id, name }]. */
    setAsideSparkWallets() {
      return setAsideOtherPhrases().map(({ id, name }) => ({ id, name }));
    },

    async getMnemonicForWallet(walletId) {
      let wallet;
      if (walletId) {
        wallet = this.wallets.find((w) => w.id === walletId);
        const setAside = !wallet && setAsideOtherPhrases().find((entry) => entry.id === walletId);
        if (setAside) return CryptoUtils.decryptMnemonic(setAside.encryptedMnemonic);
      } else if (this.activeWallet?.connectionData?.encryptedMnemonic) {
        wallet = this.activeWallet;
      } else {
        wallet = this.sparkWallet || this.arkadeWallet;
      }
      if (!wallet || !wallet.connectionData?.encryptedMnemonic) {
        throw new Error('No recovery phrase found for this wallet');
      }
      return CryptoUtils.decryptMnemonic(wallet.connectionData.encryptedMnemonic);
    },

    // ==========================================
    // NWC Wallet Methods (original functionality)
    // ==========================================

    /**
     * Add a new NWC wallet connection
     * @param {Object} walletData - Wallet configuration
     * @param {string} walletData.name - Display name for the wallet
     * @param {string} walletData.nwcUrl - NWC connection URL
     * @returns {Promise<Object>} The created wallet object
     */
    async addWallet(walletData) {
      this.isConnecting = true;
      this.lastError = null;

      try {
        // Before the duplicate check and the default below read the list.
        await this._requireSavedState();

        // Validate input
        if (!walletData.nwcUrl) {
          throw new Error('NWC connection URL is required');
        }

        if (!walletData.nwcUrl.startsWith('nostr+walletconnect://')) {
          throw new Error('Invalid NWC URL format');
        }

        // Check for duplicate
        const existing = this.wallets.find((w) => w.nwcUrl === walletData.nwcUrl);
        if (existing) {
          throw codedError('WALLET_ALREADY_CONNECTED', 'This wallet is already connected');
        }

        // Parse NWC URL to get relay info and lightning address
        const nwcUrlParsed = new URL(walletData.nwcUrl.replace('nostr+walletconnect://', 'http://'));
        const relays = nwcUrlParsed.searchParams.getAll('relay');
        const lud16Raw = nwcUrlParsed.searchParams.get('lud16');
        // Handle "null" string as no address, validate it looks like user@domain
        const lud16 = (lud16Raw && lud16Raw !== 'null' && lud16Raw.includes('@') && !lud16Raw.includes('://')) ? lud16Raw : null;
        console.log('Connecting to NWC with relays:', relays);
        if (lud16) console.log('Lightning address (lud16):', lud16);

        // Test connection with retry logic
        const nwc = new NostrWebLNProvider({
          nostrWalletConnectUrl: walletData.nwcUrl,
        });

        // Try to enable with retry - some relays/wallets need more time
        let retries = 5;
        let lastError = null;
        const delays = [2000, 3000, 4000, 5000, 6000]; // Progressive delay

        while (retries > 0) {
          try {
            console.log(`NWC enable attempt ${6 - retries}/5...`);
            await nwc.enable();
            console.log('NWC connection successful');
            break; // Success
          } catch (enableError) {
            lastError = enableError;
            retries--;
            if (retries > 0) {
              const delay = delays[5 - retries - 1] || 5000;
              console.warn(`NWC enable failed, retrying in ${delay/1000}s... (${retries} retries left)`, enableError.message);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        if (retries === 0 && lastError) {
          // Provide more helpful error message
          if (lastError.message.includes('no info event')) {
            throw new Error(
              'Could not connect to wallet. The relay did not return the NIP-47 info event (kind 13194). ' +
              'This may happen if:\n' +
              '1. The wallet service is not running or not connected to the relay\n' +
              '2. The relay is slow or unresponsive\n' +
              '3. The wallet does not support the NIP-47 info event\n\n' +
              'Please try again, or check that your wallet service is online and connected.'
            );
          }
          throw lastError;
        }

        const [info, balanceResponse] = await Promise.all([
          nwc.getInfo(),
          nwc.getBalance(),
        ]);

        // Create wallet object
        const wallet = {
          id: this.generateWalletId(),
          type: WALLET_TYPES.NWC,
          name: walletData.name || info.alias || 'Lightning Wallet',
          nwcUrl: walletData.nwcUrl,
          isActive: false,
          isDefault: this.wallets.length === 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          metadata: {
            alias: info.alias || 'Unknown',
            pubkey: info.pubkey || '',
            network: info.network || 'mainnet',
            methods: info.methods || [],
            lud16: lud16,
          },
        };

        // Store wallet data
        const previousActiveWalletId = this.activeWalletId;
        this.wallets.push(wallet);
        addingWallets.add(wallet.id);
        this.connectionStates[wallet.id] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc,
          error: null,
        };
        this.applyBalance(wallet.id, balanceResponse.balance, { source: 'connect' });
        this.walletInfos[wallet.id] = info;

        // Activate the newly added wallet
        this.activeWalletId = wallet.id;
        wallet.isActive = true;

        await this._saveAddedWallets([wallet], previousActiveWalletId);
        this._noteWalletsChanged();
        return wallet;
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    // ==========================================
    // LNBits Wallet Methods
    // ==========================================

    /**
     * Add a new LNBits wallet connection
     * @param {Object} walletData - Wallet configuration
     * @param {string} walletData.name - Display name for the wallet
     * @param {string} walletData.serverUrl - LNBits server URL
     * @param {string} walletData.adminKey - Admin API key
     * @returns {Promise<Object>} The created wallet object
     */
    async addLNBitsWallet(walletData) {
      this.isConnecting = true;
      this.lastError = null;

      try {
        // Before the duplicate check and the default below read the list.
        await this._requireSavedState();

        // Validate input
        if (!walletData.serverUrl) {
          throw new Error('LNBits server URL is required');
        }
        if (!walletData.adminKey) {
          throw new Error('Admin key is required');
        }
        // walletId is optional here — LNBits server-side scopes each
        // admin key to one wallet, so `GET /api/v1/wallet` (called by
        // validateCredentials below) discovers the walletId for us.
        // If a caller does pass walletId, validateCredentials uses it
        // as a sanity check and throws if the key resolves to a
        // different wallet. Either way, the persisted value comes from
        // `validation.walletInfo.id`, never from `walletData.walletId`.
        const validation = await LNBitsWalletProvider.validateCredentials(
          walletData.serverUrl,
          walletData.walletId, // may be undefined — provider handles that
          walletData.adminKey
        );

        if (!validation.valid) {
          throw new Error('Invalid LNBits credentials');
        }

        // Check for duplicate (same server URL and wallet ID)
        const existing = this.wallets.find(
          (w) => w.type === WALLET_TYPES.LNBITS &&
                 w.connectionData?.serverUrl === validation.serverUrl &&
                 w.connectionData?.walletId === validation.walletInfo.id
        );
        if (existing) {
          throw codedError('WALLET_ALREADY_CONNECTED', 'This LNBits wallet is already connected');
        }

        // Create wallet object
        const wallet = {
          id: this.generateWalletId(),
          type: WALLET_TYPES.LNBITS,
          name: walletData.name || validation.walletInfo.name || 'LNBits Wallet',
          isActive: false,
          isDefault: this.wallets.length === 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          connectionData: {
            serverUrl: validation.serverUrl,
            walletId: validation.walletInfo.id,
            adminKey: walletData.adminKey,
          },
          metadata: {
            lnbitsWalletId: validation.walletInfo.id,
          },
        };

        // Store wallet data
        const previousActiveWalletId = this.activeWalletId;
        this.wallets.push(wallet);
        addingWallets.add(wallet.id);
        this.applyBalance(wallet.id, validation.walletInfo.balance, { source: 'connect' });

        // Activate the newly added wallet
        this.activeWalletId = wallet.id;
        wallet.isActive = true;

        // Connect the wallet; a failure takes it back out.
        try {
          await this.connectLNBitsWallet(wallet.id);
        } catch (error) {
          await this._undoAdd([wallet], previousActiveWalletId);
          throw error;
        }

        await this._saveAddedWallets([wallet], previousActiveWalletId);
        this._noteWalletsChanged();
        return wallet;
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    /**
     * Connect to an LNBits wallet
     * @param {string} walletId - Wallet ID
     */
    async connectLNBitsWallet(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.LNBITS) {
        throw new Error('LNBits wallet not found');
      }

      try {
        // Create provider
        const provider = new LNBitsWalletProvider(walletId, {
          name: wallet.name,
          serverUrl: wallet.connectionData.serverUrl,
          adminKey: wallet.connectionData.adminKey,
          metadata: wallet.metadata,
        });

        // Connect
        await provider.connect();

        // Store provider
        this.providers[walletId] = provider;

        // Update connection state
        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          error: null,
        };

        // Get balance
        await this.refreshBalance(walletId, { provider, source: 'connect' });

        // Get info
        const info = await provider.getInfo();
        this.walletInfos[walletId] = info;

      } catch (error) {
        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: Date.now(),
          error: error.message,
        };
        throw error;
      }
    },

    /**
     * Whether a wallet may be removed right now, and what the person should
     * hear first (utils/walletRemoval.js). Screens call this before asking
     * for confirmation; removeWallet enforces the same verdict.
     * @returns {{ allowed: boolean, blockers: string[], notes: string[] }}
     */
    removalCheckFor(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) return { allowed: false, blockers: ['not_found'], notes: [] };
      const balance = describeBalance(this.balanceStates[walletId]);
      return removalCheck({
        wallet,
        sparkWalletCount: this.sparkWallets.length,
        balance: { known: balance.known, value: balance.value, fresh: balance.status === 'fresh' },
        hasPendingDeposit: (this.pendingDepositsByWallet?.[walletId] || []).length > 0,
        hasActiveExit: isActiveExit(useEmergencyExitStore().exitFor(walletId)),
        backedUp: this._sparkPhraseBackedUp(),
      });
    },

    /**
     * Whether every Spark wallet may leave this device together (the phrase
     * goes with them): the same rules as removing the last one, across all.
     */
    sparkRemovalCheck() {
      const exits = useEmergencyExitStore();
      return removalCheck({
        wallet: { type: WALLET_TYPES.SPARK },
        sparkWalletCount: 1,
        hasPendingDeposit: this.sparkWallets.some((w) => (this.pendingDepositsByWallet?.[w.id] || []).length > 0),
        hasActiveExit: this.sparkWallets.some((w) => isActiveExit(exits.exitFor(w.id))),
        backedUp: this._sparkPhraseBackedUp(),
      });
    },

    /**
     * Remove one wallet. Spark wallets are checked first (removalCheckFor);
     * a refusal throws WalletRemovalError with the blockers. A removal that
     * could not be saved is refused before anything is torn down
     * (_assertSavable), and the removal is saved before this resolves.
     * @param {string} walletId - The wallet ID to remove
     */
    async removeWallet(walletId) {
      const remove = async () => {
        try {
          const wallet = this.wallets.find((w) => w.id === walletId);
          if (!wallet) throw new Error('Wallet not found');
          if (wallet.type === WALLET_TYPES.SPARK) {
            const check = this.removalCheckFor(walletId);
            if (!check.allowed) throw new WalletRemovalError(check.blockers);
          }
          this._assertSavable();
          const removedAddresses = await this._removeWalletEntry(wallet);
          await this._afterWalletsRemoved({ removedTypes: [wallet.type], removedAddresses });
        } catch (error) {
          this.lastError = error.message;
          throw error;
        }
      };
      // Only Spark removals take part in the Spark membership order; other
      // wallets never wait behind a Spark add or restore.
      const isSpark = this.wallets.find((w) => w.id === walletId)?.type === WALLET_TYPES.SPARK;
      return isSpark ? serializeSparkMembership(remove) : remove();
    },

    /**
     * Take every Spark wallet, and with them the recovery phrase, off this
     * device (Settings, Danger Zone). Refused while an exit or a deposit is
     * under way, unless the phrase is backed up, and when the removal could
     * not be saved; saved before this resolves.
     */
    async removeSparkFromDevice() {
      return serializeSparkMembership(async () => {
        try {
          const check = this.sparkRemovalCheck();
          if (!check.allowed) throw new WalletRemovalError(check.blockers);
          this._assertSavable();
          const removedAddresses = [];
          for (const wallet of [...this.sparkWallets]) {
            removedAddresses.push(...await this._removeWalletEntry(wallet));
          }
          await this._afterWalletsRemoved({ removedTypes: [WALLET_TYPES.SPARK], removedAddresses });
        } catch (error) {
          this.lastError = error.message;
          throw error;
        }
      });
    },

    /**
     * Everything that belongs to one wallet leaves with it: connection,
     * engine databases, caches, lifecycle work, exit kit metadata (the kit
     * itself stays, see preserveBeforeRemoval), auto-transfer config, and
     * the kiosk binding. Returns the Lightning addresses that left with it.
     */
    async _removeWalletEntry(wallet) {
      const walletId = wallet.id;
      removingWallets.add(walletId);
      try {
        return await this._dropWalletEntry(wallet);
      } finally {
        removingWallets.delete(walletId);
      }
    },

    async _dropWalletEntry(wallet) {
      const walletId = wallet.id;
      this._bumpWalletEpoch(walletId);

      if (wallet.type === WALLET_TYPES.SPARK) {
        // The databases are about to be deleted with their exit chains: take
        // one last export of the kit while the SDK still holds them.
        try {
          await exitKitService().preserveBeforeRemoval(walletId);
        } catch (error) {
          console.warn('exit kit not preserved:', error?.message || error);
        }
        try { exitKitService().onSparkDisconnected(walletId); } catch { /* not attached */ }
      }
      const removedAddresses = wallet.type === WALLET_TYPES.SPARK ? [wallet.metadata?.lud16] : [];

      try {
        await this.disconnectWallet(walletId);
      } catch (error) {
        // A provider that fails to close must not keep the wallet alive.
        console.warn('disconnect during removal failed:', error?.message || error);
      }
      delete this.providers[walletId];

      if (wallet.type === WALLET_TYPES.ARKADE) {
        // disconnectWallet released the SDK's db handle; delete its cache.
        await ArkadeWalletProvider.deleteStorage(walletId);
      }
      if (wallet.type === WALLET_TYPES.SPARK) {
        // Removal must not leave payment history behind in IndexedDB.
        try { await deleteBreezStorage(walletId); } catch { /* best-effort */ }
      }
      clearCachedTransactions(walletId);

      this._bumpWalletEpoch(walletId);
      const index = this.wallets.findIndex((w) => w.id === walletId);
      if (index !== -1) this.wallets.splice(index, 1);
      delete this.connectionStates[walletId];
      this.forgetBalance(walletId);
      forgetSparkWallet?.(walletId);
      delete this.walletInfos[walletId];
      try { useExitKitStore().remove(walletId); } catch { /* metadata only */ }
      await useAutoWithdrawStore().removeConfig(walletId);
      if (this.kioskWalletId === walletId) this.kioskWalletId = null;
      return removedAddresses;
    },

    /** Selection, defaults, backup flags and the profile address after removals. */
    async _afterWalletsRemoved({ removedTypes = [], removedAddresses = [] } = {}) {
      if (removedTypes.includes(WALLET_TYPES.SPARK) && !this.hasAnySparkWallet) {
        // The phrase left the device: its backup state and pending restore go too.
        sparkPhraseEpoch += 1;
        this.hasBackedUp = false;
        this.backupDismissedUntil = null;
        this.sparkDiscovery = null;
      }

      if (!this.wallets.some((w) => w.isDefault) && this.wallets.length > 0) {
        this.wallets[0].isDefault = true;
      }

      if (!this.wallets.some((w) => w.id === this.activeWalletId)) {
        // Stay with the same kind of wallet when one is left.
        const next = this.wallets.find((w) => removedTypes.includes(w.type)) || this.defaultWallet || this.wallets[0];
        if (next) {
          try {
            await this.switchActiveWallet(next.id);
          } catch (error) {
            // Selected even when it cannot connect yet; it reconnects later.
            console.warn('switch after removal failed:', error?.message || error);
            this.activeWalletId = next.id;
          }
        } else {
          this.activeWalletId = null;
        }
      }

      // A removal that was not saved must not report success: the wallet
      // and its secret would be back on the next start.
      await this.persistState({ requireDurable: true });
      this._noteWalletsChanged();

      // A profile pointing at a removed address falls back to the next
      // default (oldest remaining Spark wallet, then the bucket).
      if (removedAddresses.some(Boolean)) {
        this._syncProfilePaymentAddress({ previousAddresses: removedAddresses }).catch(() => {});
      }
    },

    /**
     * Switch the active wallet
     * @param {string} walletId - The wallet ID to make active
     */
    async switchActiveWallet(walletId) {
      this.walletSwitching = true;
      try {
        const wallet = this.wallets.find((w) => w.id === walletId);
        if (!wallet) {
          throw new Error('Wallet not found');
        }

        // Update active states
        this.wallets.forEach((w) => (w.isActive = false));
        wallet.isActive = true;
        wallet.lastUsed = Date.now();
        this.activeWalletId = walletId;

        // Ensure connected.
        if (wallet.type === WALLET_TYPES.SPARK) {
          // Switching is a pointer flip (#285): the other Spark wallet stays
          // connected. Connect this one only if it is not live yet, then let
          // the lifecycle refresh it without blocking the switch.
          if (!this.connectionStates[walletId]?.connected || !this.providers[walletId]?.isConnected) {
            await this.connectSparkWallet(walletId);
          }
          sparkLifecycle?.()?.reconcile(walletId, 'switch');
        } else if (!this.connectionStates[walletId]?.connected) {
          if (wallet.type === WALLET_TYPES.LNBITS) {
            await this.connectLNBitsWallet(walletId);
          } else {
            await this.connectWallet(walletId);
          }
        }

        await this.persistState();
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.walletSwitching = false;
      }
    },

    /**
     * Connect to a wallet
     * @param {string} walletId - The wallet ID to connect
     * @returns {Promise<Object>} The NWC instance (for NWC wallets) or provider
     */
    async connectWallet(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Handle Spark wallet separately
      if (wallet.type === WALLET_TYPES.SPARK) {
        await this.connectSparkWallet(walletId);
        return null;
      }

      // Handle LNBits wallet
      if (wallet.type === WALLET_TYPES.LNBITS) {
        await this.connectLNBitsWallet(walletId);
        return this.providers[walletId];
      }

      // Handle Arkade wallet
      if (wallet.type === WALLET_TYPES.ARKADE) {
        await this.connectArkadeWallet(walletId);
        return this.providers[walletId];
      }

      // NWC wallet
      try {
        const nwc = new NostrWebLNProvider({
          nostrWalletConnectUrl: wallet.nwcUrl,
        });

        await nwc.enable();

        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc,
          error: null,
        };

        // Refresh data
        await this.refreshWalletData(walletId);

        return nwc;
      } catch (error) {
        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: Date.now(),
          nwcInstance: null,
          error: error.message,
        };
        throw error;
      }
    },

    /**
     * Disconnect from a wallet
     * @param {string} walletId - The wallet ID to disconnect
     */
    async disconnectWallet(walletId) {
      balanceReads.delete(walletId);
      this._bumpWalletEpoch(walletId);
      this.markBalanceRefresh(walletId, false);
      const wallet = this.wallets.find(w => w.id === walletId);
      const state = this.connectionStates[walletId];

      if (
        wallet?.type === WALLET_TYPES.SPARK ||
        wallet?.type === WALLET_TYPES.LNBITS ||
        wallet?.type === WALLET_TYPES.ARKADE
      ) {
        const provider = this.providers[walletId];
        if (provider) {
          await provider.disconnect();
          delete this.providers[walletId];
        }
      } else if (state) {
        // Close NWC connection if exists
        if (state.nwcInstance && typeof state.nwcInstance.close === 'function') {
          try {
            state.nwcInstance.close();
          } catch (e) {
            console.warn('Error closing NWC connection:', e);
          }
        }
      }

      this.connectionStates[walletId] = {
        connected: false,
        lastConnected: state?.lastConnected,
        nwcInstance: null,
        error: null,
      };
    },

    /** A later read, disconnect or removal invalidates this read's result. */
    beginBalanceRead(walletId) {
      const read = { walletId, wallet: this.wallets.find(w => w.id === walletId), epoch: epochOf(walletId) };
      balanceReads.set(walletId, read);
      return read;
    },

    isBalanceReadCurrent(read) {
      return !!read?.wallet && balanceReads.get(read.walletId) === read
        && this.wallets.includes(read.wallet) && epochOf(read.walletId) === read.epoch;
    },

    /** The shared balance read for every provider and screen. Wallet info
     * and transaction history must never delay publication of fresh funds. */
    async refreshBalance(walletId, { provider = null, source = 'sync' } = {}) {
      const read = this.beginBalanceRead(walletId);
      if (!this.isBalanceReadCurrent(read)) return false;
      this.markBalanceRefresh(walletId, true);
      try {
        provider ||= await this.ensureWalletConnectedForTransfer(walletId);
        // Connecting may already have published a newer reading.
        if (!this.isBalanceReadCurrent(read)) return false;
        const result = await provider.getBalance();
        if (!this.isBalanceReadCurrent(read)) return false;
        const accepted = this.applyBalance(walletId, result.balance, {
          read, source: result.fresh === false ? 'cache' : source,
          fresh: result.fresh !== false, error: result.syncError || null,
        });
        if (accepted) {
          if (read.wallet.type === WALLET_TYPES.ARKADE) {
            this.balanceDetails[walletId] = { pending: Number(result.pending || 0), recoverable: Number(result.recoverable || 0) };
          }
          this.noticeIncomingPayment(read.wallet, this.balanceStates[walletId].value);
        }
        return accepted;
      } catch (error) {
        if (this.isBalanceReadCurrent(read)) this.markBalanceError(walletId, error.message || 'Balance could not be refreshed');
        return false;
      } finally {
        if (this.isBalanceReadCurrent(read)) this.markBalanceRefresh(walletId, false);
      }
    },

    async refreshWalletData(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) return;
      // Publish the balance independently of ancillary wallet information.
      await this.refreshBalance(walletId);
      const provider = this.getProvider(walletId);
      const epoch = epochOf(walletId);
      if (!provider || !this.wallets.includes(wallet)) return;
      try {
        const info = await provider.getInfo();
        if (!this.wallets.includes(wallet) || epochOf(walletId) !== epoch || this.getProvider(walletId) !== provider) return;
        this.walletInfos[walletId] = info;
        if (wallet.type === WALLET_TYPES.ARKADE) {
          if (info?.arkadeAddress) wallet.metadata = { ...wallet.metadata, arkadeAddress: info.arkadeAddress };
          provider.checkLiveness?.().catch(e => console.warn('[arkade] recovery pass failed:', e?.message || e));
        }
        wallet.lastUsed = Date.now();
        await this.persistState();
      } catch (error) {
        // An info failure does not invalidate an independently verified balance.
        console.warn('Wallet info refresh failed:', error.message);
      }
    },

    /**
     * Tell the user money arrived while they were looking at something else.
     *
     * A balance that went UP between two refreshes is the honest, rail-agnostic
     * signal here: it covers a Lightning receive, an on-chain deposit landing
     * and a transfer in, without this store having to understand any of them.
     * A send lowers the balance and is never announced.
     *
     * Deliberately quiet in three cases: the first reading of a session (we
     * have nothing to compare against, and "you received your whole balance"
     * on launch would be a lie), while the app is on screen (the UI is already
     * showing it — the service checks this), and when the user has not asked
     * for notifications at all.
     *
     * Fire-and-forget: a notification is never worth failing a refresh over.
     */
    noticeIncomingPayment(wallet, balanceAfter) {
      if (!wallet?.id || !Number.isFinite(balanceAfter) || balanceAfter < 0) return;
      // Spark receipts are detected per payment id by the lifecycle's
      // receipt ledger (#295); a balance difference would double-announce
      // them and miss a receive that overlaps a send.
      if ((wallet.type || this.wallets?.find?.((w) => w.id === wallet.id)?.type) === WALLET_TYPES.SPARK) return;

      // The previous figure is what THIS method last saw for the wallet, not
      // whatever a caller had on screen. Shared refreshes report here, so
      // one map deduplicates notices and a wallet switch cannot read as
      // "you received everything".
      // The first reading of a session only seeds the map.
      const previous = observedBalance.get(wallet.id);
      observedBalance.set(wallet.id, balanceAfter);
      if (previous === undefined) return;
      const received = balanceAfter - previous;
      if (received <= 0) return;

      const notifications = useNotificationsStore();
      if (!notifications.canNotify) return;

      const t = i18n.global.t.bind(i18n.global);
      notifications.notifyIfEnabled({
        title: t('Payment received'),
        body: t('{amount} · {wallet}', {
          amount: formatAmount(received, this.useBip177Format),
          wallet: wallet.name || t('your wallet'),
        }),
      }).catch((err) => console.warn('[notifications] receive notice failed:', err?.message || err));
    },

    /**
     * Refresh all wallets
     */
    async refreshAllWallets() {
      this.isLoading = true;
      try {
        await Promise.allSettled(
          this.wallets.map((w) => this.refreshWalletData(w.id))
        );
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Rename a wallet. Names are trimmed, at most MAX_WALLET_NAME_LENGTH
     * characters and unique across wallets (utils/walletNames.js); a name
     * that breaks a rule throws WalletNameError. The new name is durable
     * before this resolves.
     * @param {string} walletId - The wallet ID
     * @param {string} newName - The new display name
     */
    async updateWalletName(walletId, newName) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) throw new Error('Wallet not found');
      const problem = walletNameProblem(newName, this.wallets, { exceptId: walletId });
      if (problem) throw new WalletNameError(problem);
      const name = normalizeWalletName(newName);
      if (wallet.name === name) return;
      const previous = wallet.name;
      wallet.name = name;
      try {
        await this.persistState({ requireDurable: true });
      } catch (error) {
        wallet.name = previous;
        throw error;
      }
      this._noteWalletsChanged();
    },

    /**
     * Set (or clear) the lightning address for a wallet.
     *
     * Stored in `metadata.lud16` — the same slot used for NWC-provided addresses —
     * so the `activeWalletLightningAddress` getter picks it up uniformly across
     * wallet types (LNBits, NWC, etc.). Spark wallets are rejected; they don't
     * support lightning addresses.
     *
     * @param {string} walletId
     * @param {string|null} address - Full `user@domain` address, or null/empty to clear
     */
    async setWalletLightningAddress(walletId, address) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) return;
      if (wallet.type === WALLET_TYPES.SPARK) return;

      if (!wallet.metadata) wallet.metadata = {};

      const cleaned = typeof address === 'string' ? address.trim() : '';
      if (cleaned) {
        wallet.metadata.lud16 = cleaned;
      } else {
        delete wallet.metadata.lud16;
      }

      await this.persistState();
    },

    /**
     * Set a wallet as the default
     * @param {string} walletId - The wallet ID to make default
     */
    async setDefaultWallet(walletId) {
      this.wallets.forEach((w) => (w.isDefault = false));
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (wallet) {
        wallet.isDefault = true;
        await this.persistState();
      }
    },

    /**
     * Get NWC instance for active wallet
     * @returns {Object|null} The NWC instance or null
     */
    getActiveNWC() {
      if (!this.activeWalletId) return null;
      const wallet = this.wallets.find(w => w.id === this.activeWalletId);
      if (wallet?.type === WALLET_TYPES.SPARK) return null;
      return this.connectionStates[this.activeWalletId]?.nwcInstance || null;
    },

    /**
     * Get NWC instance for a specific wallet
     * @param {string} walletId - The wallet ID
     * @returns {Object|null} The NWC instance or null
     */
    getNWC(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (wallet?.type === WALLET_TYPES.SPARK) return null;
      return this.connectionStates[walletId]?.nwcInstance || null;
    },

    /**
     * Get provider for a wallet (works for all types)
     * @param {string} walletId - The wallet ID
     * @returns {Object|null} Provider instance
     */
    getProvider(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) return null;

      if (
        wallet.type === WALLET_TYPES.SPARK ||
        wallet.type === WALLET_TYPES.LNBITS ||
        wallet.type === WALLET_TYPES.ARKADE
      ) {
        return this.providers[walletId] || null;
      }
      return this.connectionStates[walletId]?.nwcInstance || null;
    },

    /**
     * Get active wallet provider
     * @returns {Object|null}
     */
    getActiveProvider() {
      return this.getProvider(this.activeWalletId);
    },

    /**
     * Ensure Spark wallet is connected and return provider
     * Auto-connects using session PIN if available
     * @returns {Promise<Object>} Connected provider
     * @throws {Error} If wallet cannot be connected
     */
    async ensureSparkConnected(walletId = null) {
      // Default: the active wallet. A caller holding a specific wallet id
      // (e.g. a transaction deep link that outlives a wallet switch) may
      // target that Spark wallet directly - the rest of this method is
      // already account-aware via wallet.id.
      const wallet = walletId
        ? this.wallets.find(w => w.id === walletId && w.type === WALLET_TYPES.SPARK)
        : this.activeWallet;
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) {
        throw new Error('No active Spark wallet');
      }

      // Check if already have a connected provider (account-aware)
      let provider = this.getProvider(wallet.id);
      if (provider && provider.isConnected) {
        return provider;
      }

      // Try to auto-connect using device key
      try {
        await this.connectSparkWallet(wallet.id);
        provider = this.getProvider(wallet.id);
        if (provider && provider.isConnected) {
          return provider;
        }
      } catch (error) {
        console.warn('Spark auto-connect failed:', error.message);
      }

      throw new Error('Spark wallet could not be connected.');
    },

    /**
     * Ensure an LNBits wallet has a connected provider, connecting with
     * stored credentials if needed. Mirrors `ensureSparkConnected` so all
     * call sites (balance poll, send, batch send, auto-withdraw, internal
     * transfer, kiosk) can get a usable provider in one call without
     * worrying about lifecycle state.
     *
     * In normal operation `LNBitsWalletProvider.setError` no longer flips
     * `isConnected` on errors, so this method is a cheap getter once the
     * provider has been validated once. It still does meaningful work on
     * cold start, after an explicit `disconnect()`, or if the provider was
     * never created — in which case `connectLNBitsWallet` validates the
     * credentials against the server and either succeeds or throws an
     * actionable auth error.
     *
     * @param {string} [walletId] - Optional wallet ID; defaults to the active wallet
     * @returns {Promise<Object>} Connected LNBits provider
     * @throws {Error} If the wallet is not LNBits or connection fails
     */
    async ensureLNBitsConnected(walletId) {
      const targetId = walletId || this.activeWalletId;
      const wallet = this.wallets.find((w) => w.id === targetId);
      if (!wallet || wallet.type !== WALLET_TYPES.LNBITS) {
        throw new Error('Not an LNBits wallet');
      }

      const cached = this.getProvider(targetId);
      if (cached && cached.isConnected) {
        return cached;
      }

      await this.connectLNBitsWallet(targetId);
      const provider = this.getProvider(targetId);
      if (provider && provider.isConnected) {
        return provider;
      }

      throw new Error('LNBits wallet could not be connected.');
    },

    /**
     * Return the connected Arkade provider for `walletId` (or the active
     * wallet), self-healing a dropped connection before a send. Mirrors
     * ensureLNBitsConnected.
     * @param {string} [walletId]
     * @returns {Promise<ArkadeWalletProvider>}
     */
    async ensureArkadeConnected(walletId) {
      const targetId = walletId || this.activeWalletId;
      const wallet = this.wallets.find((w) => w.id === targetId);
      if (!wallet || wallet.type !== WALLET_TYPES.ARKADE) {
        throw new Error('Not an Arkade wallet');
      }

      const cached = this.getProvider(targetId);
      if (cached && cached.isConnected) {
        return cached;
      }

      await this.connectArkadeWallet(targetId);
      const provider = this.getProvider(targetId);
      if (provider && provider.isConnected) {
        return provider;
      }

      throw new Error('Arkade wallet could not be connected.');
    },

    /**
     * Keep the wallets this version can use. An entry it cannot use (a
     * missing secret, a type it does not know) leaves the list but never the
     * disk: it moves to `_unusableWallets`, which every save writes back as
     * it was read, so a newer version or a repair can still reach it.
     */
    async validateWallets() {
      const unusable = [];
      this.wallets = this.wallets.filter((wallet) => {
        let valid;
        if (wallet.type === WALLET_TYPES.SPARK) {
          valid = !!wallet.connectionData?.encryptedMnemonic;
          if (!valid) console.warn(`[validateWallets] Setting aside Spark wallet "${wallet.name}" (${wallet.id}): missing encryptedMnemonic`);
        } else if (wallet.type === WALLET_TYPES.LNBITS) {
          valid = !!(wallet.connectionData?.serverUrl && wallet.connectionData?.adminKey);
          if (!valid) console.warn(`[validateWallets] Setting aside LNBits wallet "${wallet.name}" (${wallet.id}): missing serverUrl or adminKey`);
        } else if (wallet.type === WALLET_TYPES.ARKADE) {
          valid = !!wallet.connectionData?.encryptedMnemonic;
          if (!valid) console.warn(`[validateWallets] Setting aside Arkade wallet "${wallet.name}" (${wallet.id}): missing encryptedMnemonic`);
        } else if (wallet.type === WALLET_TYPES.NWC) {
          valid = typeof wallet.nwcUrl === 'string' && wallet.nwcUrl.startsWith('nostr+walletconnect://');
          if (!valid) {
            console.warn(`[validateWallets] Setting aside NWC wallet "${wallet.name}" (${wallet.id}): nwcUrl=${wallet.nwcUrl ? 'invalid format' : 'missing'}`, JSON.stringify({ type: wallet.type, keys: Object.keys(wallet) }));
          }
        } else {
          valid = false;
          console.warn(`[validateWallets] Setting aside wallet "${wallet.name}" (${wallet.id}): unknown type ${wallet.type}`);
        }
        if (!valid) unusable.push(wallet);
        return valid;
      });

      if (unusable.length) {
        this._unusableWallets = [...this._unusableWallets, ...unusable];
        console.warn(`[validateWallets] Set aside ${unusable.length} wallet(s) this version cannot use; they stay saved. ${this.wallets.length} remaining.`);
      }

      // Ensure active wallet is valid
      if (this.activeWalletId && !this.wallets.find((w) => w.id === this.activeWalletId)) {
        console.warn(`[validateWallets] Active wallet ${this.activeWalletId} no longer valid, switching to ${this.wallets[0]?.id || 'none'}`);
        this.activeWalletId = this.wallets[0]?.id || null;
      }
    },

    /**
     * Disconnect and remove all wallets. Like every removal, refused before
     * anything is closed when it could not be saved, and saved before this
     * resolves.
     */
    async disconnectAll() {
      this._assertSavable();
      for (const walletId of Object.keys(this.connectionStates)) {
        await this.disconnectWallet(walletId);
      }

      this.wallets = [];
      this.activeWalletId = null;
      this.connectionStates = {};
      for (const id of Object.keys(this.balanceStates || {})) forgetSparkWallet?.(id);
      this.balanceStates = {};
      this.sparkHealthStates = {};
      this.pendingDepositsByWallet = {};
      this.walletInfos = {};
      this.providers = {};
      this.hasBackedUp = false;
      this.backupDismissedUntil = null;

      // Clear auto-withdraw configs
      const autoWithdrawStore = useAutoWithdrawStore();
      await autoWithdrawStore.clearAll();

      await this.persistState({ requireDurable: true });
    },

    /**
     * Disconnect and remove only NWC wallets (keeps Spark wallet). Refused
     * and saved like every removal (see disconnectAll).
     */
    async disconnectNwcWallets() {
      this._assertSavable();
      const nwcWallets = this.wallets.filter(w => w.type === WALLET_TYPES.NWC);

      // Disconnect each NWC wallet
      for (const wallet of nwcWallets) {
        await this.disconnectWallet(wallet.id);
        // Clean up state for this wallet
        delete this.connectionStates[wallet.id];
        this.forgetBalance(wallet.id);
        delete this.walletInfos[wallet.id];
        delete this.providers[wallet.id];
      }

      // Remove NWC wallets from the list
      this.wallets = this.wallets.filter(w => w.type !== WALLET_TYPES.NWC);

      // If active wallet was NWC, switch to Spark or null
      if (!this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets[0]?.id || null;
      }

      await this.persistState({ requireDurable: true });
    },

    /**
     * Disconnect and remove only LNBits wallets. Refused and saved like
     * every removal (see disconnectAll).
     */
    async disconnectLNBitsWallets() {
      this._assertSavable();
      const lnbitsWallets = this.wallets.filter(w => w.type === WALLET_TYPES.LNBITS);

      // Disconnect each LNBits wallet
      for (const wallet of lnbitsWallets) {
        await this.disconnectWallet(wallet.id);
        // Clean up state for this wallet
        delete this.connectionStates[wallet.id];
        this.forgetBalance(wallet.id);
        delete this.walletInfos[wallet.id];
        delete this.providers[wallet.id];
      }

      // Remove LNBits wallets from the list
      this.wallets = this.wallets.filter(w => w.type !== WALLET_TYPES.LNBITS);

      // If active wallet was LNBits, switch to first available or null
      if (!this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets[0]?.id || null;
      }

      await this.persistState({ requireDurable: true });
    },

    // ==========================================
    // Internal Fund Transfer Methods
    // ==========================================

    /**
     * Get wallets available for internal transfers
     * Returns wallets that can participate in transfers (connected or can be connected)
     * @returns {Array} Array of wallet objects with transfer capability info
     */
    getTransferableWallets() {
      return this.wallets.map(wallet => {
        const isConnected = this.connectionStates[wallet.id]?.connected;
        const balance = this.balances[wallet.id] || 0;

        return {
          ...wallet,
          isConnected,
          balance,
          canSend: isConnected && balance > 0,
          canReceive: true // All wallets can receive
        };
      })
      // Internal transfers ride Lightning invoices between the two wallets
      // (except the Spark-to-Spark path), and Arkade's Lightning rail is
      // out of service - an Arkade leg can neither mint nor pay the invoice.
      // Same reason Social Bucket sweeps (which mint an invoice on the
      // destination) must not offer Arkade. Lift with Arkade Intents
      // (Plans WIP/arkade-maintenance-map.md).
      .filter((w) => w.type !== 'arkade');
    },

    /**
     * Ensure a wallet is connected for transfer.
     *
     * Delegates LNBits to `ensureLNBitsConnected` so every LNBits send/transfer
     * path uses one source of truth for connect/reconnect. Spark and NWC keep
     * their own connect calls because their connection models differ (Spark
     * needs a device-key auto-connect; NWC tracks connection in a side
     * `nwcInstance` rather than on the provider).
     *
     * @param {string} walletId - Wallet ID to connect
     * @returns {Promise<Object>} Provider instance
     */
    /**
     * Create a bolt11 invoice on one specific wallet.
     *
     * Extracted from the internal-transfer path, which had this inline, so the
     * Social Bucket can ask a wallet to receive without duplicating the
     * per-backend differences (NWC speaks makeInvoice, everything else speaks
     * createInvoice).
     *
     * @param {string} walletId
     * @param {number} amountSats
     * @param {string} [description]
     * @returns {Promise<string>} bolt11
     */
    async createInvoiceOnWallet(walletId, amountSats, description = '') {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) throw new Error('Wallet not found');

      await this.ensureWalletConnectedForTransfer(walletId);
      const provider = this.providers[walletId];
      if (!provider) throw new Error('Wallet is not connected');

      const isNwc = wallet.type === WALLET_TYPES.NWC;
      const result = isNwc
        ? await provider.makeInvoice({ amount: amountSats, description })
        : await provider.createInvoice({ amount: amountSats, description });

      const invoice =
        result?.paymentRequest ||
        result?.payment_request ||
        result?.invoice ||
        result?.bolt11 ||
        (typeof result === 'string' ? result : '');

      if (!invoice) throw new Error('Wallet did not return an invoice');
      return invoice;
    },

    async ensureWalletConnectedForTransfer(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (wallet.type === WALLET_TYPES.LNBITS) {
        return await this.ensureLNBitsConnected(walletId);
      }

      let provider = this.getProvider(walletId);
      const isActuallyConnected = provider && (
        (wallet.type === WALLET_TYPES.SPARK && provider.isConnected) ||
        (wallet.type === WALLET_TYPES.ARKADE && provider.isConnected) ||
        (wallet.type === WALLET_TYPES.NWC && this.connectionStates[walletId]?.nwcInstance)
      );

      if (isActuallyConnected) {
        return provider;
      }

      if (wallet.type === WALLET_TYPES.SPARK) {
        await this.connectSparkWallet(walletId);
      } else {
        await this.connectWallet(walletId);
      }

      provider = this.getProvider(walletId);
      if (!provider) {
        throw new Error(`Failed to connect ${wallet.name}`);
      }

      return provider;
    },

    /**
     * Turn a raw SDK/transport error into a user-facing string for the
     * internal-transfer modal. Surfaces the upstream prose (LUD-06
     * reason, NWC message, LNbits detail) verbatim when it's safe, so
     * the modal shows "Insufficient balance (A → B)" instead of the
     * generic "Transfer failed (A → B)". Tech-only failures fall back
     * to a curated string inside getUserFriendlyError.
     *
     * The raw error is logged at the call site via `console.error` for
     * debugging; the return value here is what the user actually sees.
     */
    _friendlyTransferError(error, fromWallet, toWallet, phase = 'transfer') {
      const { description } = getUserFriendlyError(error, 'transfer');
      const suffix = phase === 'invoice'
        ? `(${toWallet.name})`
        : `(${fromWallet.name} → ${toWallet.name})`;
      return `${description} ${suffix}`;
    },

    /**
     * Transfer funds between two wallets
     * Creates an invoice from destination wallet and pays from source wallet
     * @param {string} fromWalletId - Source wallet ID
     * @param {string} toWalletId - Destination wallet ID
     * @param {number} amountSats - Amount in satoshis
     * @param {string} [memo] - Optional memo/description
     * @returns {Promise<Object>} Transfer result
     */
    async transferBetweenWallets(fromWalletId, toWalletId, amountSats, memo = '') {
      if (fromWalletId === toWalletId) {
        throw new Error('Cannot transfer to the same wallet');
      }

      if (amountSats <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      const fromWallet = this.wallets.find(w => w.id === fromWalletId);
      const toWallet = this.wallets.find(w => w.id === toWalletId);

      if (!fromWallet || !toWallet) {
        throw new Error('Wallet not found');
      }

      // Check balance
      const sourceBalance = this.balances[fromWalletId] || 0;
      if (sourceBalance < amountSats) {
        throw new Error('Insufficient balance');
      }

      // Ensure both wallets are connected and get providers
      const fromProvider = await this.ensureWalletConnectedForTransfer(fromWalletId);
      const toProvider = await this.ensureWalletConnectedForTransfer(toWalletId);

      if (!fromProvider || !toProvider) {
        throw new Error('Failed to connect wallets');
      }

      const fromType = fromWallet.type?.toLowerCase() || 'nwc';
      const toType = toWallet.type?.toLowerCase() || 'nwc';
      const transferMemo = memo || `Transfer from ${fromWallet.name}`;

      // Fast path: Spark → Spark uses native zero-fee transfer, bypassing
      // Lightning invoice creation. Avoids the SO preimage-share round-trip
      // that can fail with transport errors under flaky network conditions.
      let paymentResult;
      let invoice;
      // A direct Spark-to-Spark transfer exposes no receiving invoice hash,
      // so its receipt cannot be identified and is not suppressed.
      if (fromType === 'spark' && toType === 'spark') {
        try {
          const sparkAddress = await toProvider.getSparkAddress();
          paymentResult = await fromProvider.transferToSparkAddress(sparkAddress, amountSats);
        } catch (sparkError) {
          console.error('Spark-native transfer error:', sparkError);
          throw new Error(this._friendlyTransferError(sparkError, fromWallet, toWallet));
        }
      } else {
        // Lightning path: create invoice on destination, pay from source
        try {
          if (toType === 'spark' || toType === 'lnbits' || toType === 'arkade') {
            // Spark, LNBits and Arkade all expose createInvoice({ amount,
            // description }). For Arkade this mints a Boltz reverse-swap invoice;
            // the source wallet then pays it like any other bolt11.
            const invoiceResult = await toProvider.createInvoice({
              amount: amountSats,
              description: transferMemo
            });
            invoice = invoiceResult.paymentRequest || invoiceResult.payment_request || invoiceResult.bolt11 || invoiceResult;
          } else {
            // NWC wallet (WebLN interface) - makeInvoice expects satoshis
            // The Alby SDK handles internal conversion to millisats for NIP-47
            const invoiceResult = await toProvider.makeInvoice({
              amount: amountSats,
              description: transferMemo
            });
            invoice = invoiceResult.invoice || invoiceResult.paymentRequest || invoiceResult.bolt11;
          }
        } catch (invoiceError) {
          console.error('Invoice creation error:', invoiceError);
          throw new Error(this._friendlyTransferError(invoiceError, fromWallet, toWallet, 'invoice'));
        }

        if (!invoice) {
          throw new Error('Failed to create invoice from destination wallet');
        }

        if (toType === 'spark') {
          // The receiving half will settle this invoice: identify that
          // receipt by its payment hash so it is not announced as income.
          try {
            this.noteInternalTransfer(toWalletId, new Invoice({ pr: String(invoice) }).paymentHash || null);
          } catch { /* unidentified: not suppressed */ }
        }

        try {
          if (fromType === 'spark' || fromType === 'lnbits' || fromType === 'arkade') {
            // Spark, LNBits and Arkade all use payInvoice({ invoice }). For
            // Arkade this is a Boltz submarine swap.
            paymentResult = await fromProvider.payInvoice({ invoice });
          } else {
            // NWC wallet - use sendPayment with just the invoice string
            paymentResult = await fromProvider.sendPayment(invoice);
          }
        } catch (payError) {
          console.error('Payment error:', payError);
          throw new Error(this._friendlyTransferError(payError, fromWallet, toWallet, 'pay'));
        }
      }

      // Step 3: Refresh balances for both wallets
      await Promise.all([
        this.refreshWalletData(fromWalletId),
        this.refreshWalletData(toWalletId)
      ]);

      // Every Spark wallet stays connected after a transfer (#285).

      // The source payment ID is already known: stamp it now so a direct
      // details link has its transfer identity without opening History first.
      // The receiving wallet may assign a different ID, so its link still
      // waits for that wallet's history to reconcile it.
      //
      // This is the exact case that motivated wallet-scoping the metadata
      // store: both legs of an internal transfer can share a payment hash
      // (hence the same provider-assigned tx id) when both wallets live in
      // this app, so each link MUST carry the wallet whose list will show
      // it — the outgoing (debit) link carries fromWalletId, the incoming
      // (credit) link carries toWalletId — or the two legs could stamp (or
      // race to consume) each other's record.
      const transactionId = internalTransferTransactionId(fromType, paymentResult, invoice);
      try {
        const transactionMetadataStore = useTransactionMetadataStore();
        if (transactionId) {
          await transactionMetadataStore.setLabelForTransaction(transactionId, fromWalletId, `Transfer to ${toWallet.name}`);
          await transactionMetadataStore.setSourceForTransaction(transactionId, fromWalletId, 'internal-transfer');
        } else {
          await transactionMetadataStore.enqueuePendingContactLink({
            label: `Transfer to ${toWallet.name}`,
            source: 'internal-transfer',
            amountSats,
            walletId: fromWalletId,
          });
        }
        await transactionMetadataStore.enqueuePendingContactLink({
          label: `Transfer from ${fromWallet.name}`,
          source: 'internal-transfer',
          direction: 'incoming',
          amountSats,
          walletId: toWalletId,
        });
      } catch (err) {
        console.warn('[wallet] could not queue transfer metadata link:', err);
      }

      return {
        success: true,
        fromWallet: fromWallet.name,
        toWallet: toWallet.name,
        amount: amountSats,
        transactionId,
        paymentResult
      };
    },

    /**
     * Load exchange rates from fiat service
     */
    async loadExchangeRates() {
      this.exchangeRatesError = null;

      try {
        const rates = await fiatRatesService.getRates();

        if (rates && fiatRatesService.areRatesAvailable()) {
          // Keyed by lowercase code. Every selectable currency gets an
          // entry; keep a previously known rate if the response omits it.
          this.exchangeRates = Object.fromEntries(
            SELECTABLE_FIAT_CURRENCIES.map((code) => [code.toLowerCase(), rates[code] || this.exchangeRates[code.toLowerCase()] || 0])
          );
          this.exchangeRatesAvailable = true;
          this.exchangeRatesLastUpdate = new Date().toISOString();
          this.exchangeRatesError = null;
          await this.persistState();
        } else {
          this.exchangeRatesAvailable = false;
          this.exchangeRatesError = fiatRatesService.getLastError() || 'Exchange rates unavailable';
          console.warn('Exchange rates unavailable:', this.exchangeRatesError);
        }
      } catch (error) {
        console.error('Failed to load exchange rates:', error);
        this.exchangeRatesAvailable = false;
        this.exchangeRatesError = error.message || 'Failed to fetch exchange rates';
      }
    },

    /**
     * Update exchange rates
     * @param {Object} rates - New exchange rates
     */
    updateExchangeRates(rates) {
      this.exchangeRates = { ...this.exchangeRates, ...rates };
      this.persistState();
    },

    /**
     * Update currency preferences
     * @param {string} fiatCurrency - Preferred fiat currency code
     * @param {string} denominationCurrency - Display denomination (sats/btc/fiat)
     */
    updateCurrencyPreferences(fiatCurrency, denominationCurrency) {
      this.preferredFiatCurrency = fiatCurrency;
      this.denominationCurrency = denominationCurrency;
      this.persistState();
    },

    /**
     * Update BIP-177 format preference
     * @param {boolean} useBip177 - Use BIP-177 format (₿) vs Legacy (sats)
     */
    updateBip177Preference(useBip177) {
      this.useBip177Format = useBip177;
      this.persistState();
    },

    /**
     * Privacy mode for amounts (balances and aggregates). When on,
     * every balance / total in the UI renders as `••••`. Per-payment
     * amounts inside action flows (send, withdraw, payment confirm)
     * are *not* affected — those are tied to a specific action the
     * user is taking right now, not their funds at rest.
     *
     * @param {boolean|undefined} value - explicit new state. If omitted,
     *   the current value is flipped (used by the quick-toggle pill).
     */
    setBalanceHidden(value) {
      this.balanceHidden = value === undefined ? !this.balanceHidden : !!value;
      this.persistState();
    },

    /**
     * Update biometric lock preference
     * @param {boolean} enabled - Enable or disable biometric lock
     */
    updateBiometricsEnabled(enabled) {
      this.biometricsEnabled = enabled;
      this.persistState();
    },

    /**
     * Update the screen-capture protection preference. Pessimistic
     * update: the Pinia state only flips after the native plugin
     * confirms the new value has been persisted and applied. On
     * native failure the store stays at its last known good value
     * and the error propagates so the caller can show a toast.
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>} the value actually applied
     */
    async updatePrivacyScreenEnabled(enabled) {
      const requested = !!enabled;
      const result = await nativeSetScreenPrivacyEnabled(requested);
      const applied = !!(result?.enabled);
      this.privacyScreenEnabled = applied;
      this.persistState();
      return applied;
    },

    /**
     * Reconcile the Pinia value with the native source of truth.
     * Called once at boot on native, after the 'wallet-store' boot
     * loaded the saved settings: reads SharedPreferences via the
     * plugin and corrects the store if they disagree (e.g. after a
     * migration that cleared localStorage but kept SharedPreferences,
     * or vice versa). Silent on success; logs and keeps the loaded
     * value on failure.
     */
    async syncPrivacyScreenFromNative() {
      try {
        const nativeValue = await nativeIsScreenPrivacyEnabled();
        if (nativeValue !== this.privacyScreenEnabled) {
          this.privacyScreenEnabled = nativeValue;
          this.persistState();
        }
      } catch (error) {
        console.warn('[wallet] Privacy screen native sync failed:', error);
      }
    },

    /**
     * Generate a unique wallet ID
     * @returns {string} Unique wallet ID
     */
    generateWalletId() {
      return `wallet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    },

    /**
     * Refuse, with the code a save would give, when saving cannot be done
     * safely now. A save replaces everything on disk, so two rules keep it
     * from destroying what it replaces: nothing is written before the saved
     * state is in memory (a screen opened straight after a reload, a boot
     * task, a failed load), and a saved wallet this store never read or
     * wrote (another window added it) is never dropped. persistState checks
     * this before every write; a removal checks it before it tears anything
     * down, so a removal that could not be saved leaves the wallet whole.
     */
    _assertSavable() {
      if (!this.savedStateLoaded) {
        throw codedError('WALLET_STATE_UNAVAILABLE', 'The saved wallets are not loaded; nothing was saved');
      }
      const held = new Set([...this.wallets, ...this._unusableWallets].map((w) => w.id));
      // Entries without an id cannot be told apart; they never block a save.
      const unseen = savedWalletsOnDisk().filter((w) => w?.id && !held.has(w.id) && !this._savedWalletIds.includes(w.id));
      if (unseen.length) {
        throw codedError('WALLET_STATE_CONFLICT', `${unseen.length} saved wallet(s) changed elsewhere; nothing was saved`);
      }
    },

    /**
     * Persist state to localStorage, under the rules of _assertSavable. A
     * wallet still being added is left out until its add's own save, which
     * names it in `admit` (_saveAddedWallets). A refused or failed save is
     * logged, and thrown with `requireDurable`.
     */
    async persistState({ requireDurable = false, admit = [] } = {}) {
      try {
        this._assertSavable();
        const listed = this.wallets.filter((w) => !addingWallets.has(w.id) || admit.includes(w.id));
        const wallets = [...listed, ...this._unusableWallets];

        // Save new format
        const stateToSave = {
          balanceSchemaVersion: BALANCE_SCHEMA_VERSION,
          wallets,
          activeWalletId: this.activeWalletId,
          preferredFiatCurrency: this.preferredFiatCurrency,
          defaultDisplayCurrency: this.defaultDisplayCurrency,
          denominationCurrency: this.denominationCurrency,
          useBip177Format: this.useBip177Format,
          balanceHidden: this.balanceHidden,
          exchangeRates: this.exchangeRates,
          exchangeRatesAvailable: this.exchangeRatesAvailable,
          exchangeRatesLastUpdate: this.exchangeRatesLastUpdate,
          hasBackedUp: this.hasBackedUp,
          biometricsEnabled: this.biometricsEnabled,
          privacyScreenEnabled: this.privacyScreenEnabled,
          // Kiosk
          kioskEnabled: this.kioskEnabled,
          kioskPin: this.kioskPin,
          kioskWalletId: this.kioskWalletId,
          kioskTipEnabled: this.kioskTipEnabled,
          kioskTipValues: this.kioskTipValues,
          kioskRoundUpEnabled: this.kioskRoundUpEnabled,
          kioskDisplayCurrency: this.kioskDisplayCurrency,
          sparkModelVersion: this.sparkModelVersion,
          sparkDiscovery: this.sparkDiscovery,
        };
        localStorage.setItem(STORAGE_KEYS.WALLET_STORE, JSON.stringify(stateToSave));
        this._savedWalletIds = wallets.map((w) => w.id);
        for (const id of admit) addingWallets.delete(id);

        // Maintain backward compatibility
        const legacyState = {
          balance: this.activeBalance,
          connectedWallets: listed.map((w) => ({
            id: w.id,
            name: w.name,
            type: w.type || 'nwc',
            nwcString: w.nwcUrl,
            balance: this.balances[w.id] || 0,
          })),
          activeWalletId: this.activeWalletId,
          currency: this.denominationCurrency,
          currencies: ['sats', 'btc', 'usd'],
          exchangeRates: this.exchangeRates,
          preferredFiatCurrency: this.preferredFiatCurrency,
          denominationCurrency: this.denominationCurrency,
        };
        try {
          localStorage.setItem(STORAGE_KEYS.LEGACY_STATE, JSON.stringify(legacyState));
        } catch (error) {
          // The canonical wallet blob is already durable; legacy cache failure
          // must not report a successful phrase confirmation as unsaved.
          console.warn('Failed to update legacy wallet cache:', error);
        }
      } catch (error) {
        console.error('Failed to persist wallet state:', error);
        if (requireDurable) throw error;
      }
    },

    /**
     * The last step of every wallet add the person starts: the add's own
     * save, the first to write its wallets (see addingWallets), lands before
     * the add reports success. A wallet that exists only in memory is gone on
     * the next start, and for Spark and Arkade its recovery phrase with it.
     * When the save is refused or fails, `rollback` puts back what else the
     * add changed, the add is undone (_undoAdd) and the error goes to the
     * caller. Discovery saves best-effort instead: an account of a phrase
     * already saved is found again.
     */
    async _saveAddedWallets(wallets, previousActiveWalletId, rollback = () => {}) {
      try {
        await this.persistState({ requireDurable: true, admit: wallets.map((w) => w.id) });
      } catch (error) {
        rollback();
        await this._undoAdd(wallets, previousActiveWalletId);
        throw error;
      }
      // Saved now, so the profile may follow a new Spark wallet's address
      // (setSparkLightningAddress held it back while the add was running).
      if (wallets.some((w) => w.type === WALLET_TYPES.SPARK && w.metadata?.lud16)) {
        this._syncProfilePaymentAddress().catch(() => {});
      }
    },

    /**
     * Take back an add whose connect or save failed: its wallets leave
     * memory and the selection it found comes back. Nothing saved the
     * wallets, but a save during the add may have saved the selection it
     * moved, so the selection is saved again (best-effort).
     */
    async _undoAdd(wallets, previousActiveWalletId) {
      this._restoreSelection(previousActiveWalletId);
      for (const wallet of wallets) await this._discardAddedWallet(wallet.id);
      await this.persistState();
    },

    /** Put back the selection an add found, when the add did not complete. */
    _restoreSelection(walletId) {
      this.activeWalletId = walletId;
      for (const w of this.wallets) w.isActive = w.id === walletId;
    },

    /**
     * Clear all wallet data
     */
    clearAll() {
      // Everything in flight belongs to wallets that are about to vanish.
      sparkPhraseEpoch += 1;
      for (const wallet of this.wallets) {
        this._bumpWalletEpoch(wallet.id);
        if (wallet.type === WALLET_TYPES.SPARK) forgetSparkWallet?.(wallet.id);
      }
      if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
      // Close all connections first
      Object.values(this.connectionStates).forEach((state) => {
        if (state?.nwcInstance?.close) {
          try {
            state.nwcInstance.close();
          } catch (e) {
            // Ignore close errors
          }
        }
      });

      // Disconnect all Spark providers
      Object.values(this.providers).forEach((provider) => {
        try {
          Promise.resolve(provider.disconnect()).catch(() => {});
        } catch (e) {
          // Ignore errors
        }
      });

      this.$reset();
      localStorage.removeItem(STORAGE_KEYS.WALLET_STORE);
      localStorage.removeItem(STORAGE_KEYS.LEGACY_STATE);

      // Full reset also removes every Breez-engine database (fire-and-forget;
      // clearAll is sync by contract and the deletes are independent).
      deleteAllBreezStorage().catch(() => {});
      // A full reset takes the exit kits, any exit in progress and the
      // reachability record with it.
      clearExitData().catch(() => {});
    },

    // ─── Kiosk Mode ───────────────────────────────────────────

    async enableKiosk(pin, walletId) {
      this.kioskEnabled = true;
      this.kioskPin = pin;
      this.kioskWalletId = walletId || null;
      this.kioskOwnerAccess = true; // merchant keeps full access after setup
      await this.persistState();
    },

    async disableKiosk() {
      this.pendingDeepLink = null;
      this.kioskEnabled = false;
      this.kioskPin = '';
      this.kioskOwnerAccess = false;
      this.kioskWalletId = null;
      this.kioskTipEnabled = false;
      this.kioskTipValues = [5, 10, 20];
      this.kioskRoundUpEnabled = false;
      this.kioskDisplayCurrency = 'sats';
      await this.persistState();
    },

    unlockToOwnerMode(pin) {
      if (pin === this.kioskPin) {
        if (this.pendingDeepLink?.target === 'kiosk') this.pendingDeepLink = null;
        this.kioskOwnerAccess = true;
        return true;
      }
      return false;
    },

    forceUnlockKiosk() {
      this.pendingDeepLink = null;
      this.kioskOwnerAccess = true;
    },

    lockToKioskMode() {
      this.pendingDeepLink = null;
      this.kioskOwnerAccess = false;
    },

    verifyKioskPin(pin) {
      return pin === this.kioskPin;
    },

    async changeKioskPin(newPin) {
      this.kioskPin = newPin;
      await this.persistState();
    },

    async activateKioskMode() {
      this.pendingDeepLink = null;
      this.kioskOwnerAccess = false;
      await this.persistState();
    },

    async setKioskWallet(walletId) {
      this.kioskWalletId = walletId;
      await this.persistState();
    },

    async setKioskTipEnabled(val) {
      this.kioskTipEnabled = val;
      await this.persistState();
    },

    async setKioskTipValues(arr) {
      this.kioskTipValues = arr;
      await this.persistState();
    },

    async setKioskRoundUpEnabled(val) {
      this.kioskRoundUpEnabled = val;
      await this.persistState();
    },

    async setKioskDisplayCurrency(val) {
      this.kioskDisplayCurrency = val;
      await this.persistState();
    },
  },
});
