/**
 * Wallet Store
 *
 * Pinia store for managing multiple Lightning wallets.
 * Supports both NWC (Nostr Wallet Connect) and Spark (self-custodial) wallets.
 */

import { defineStore } from 'pinia';
import { NostrWebLNProvider } from '@getalby/sdk';
import { fiatRatesService } from '../utils/fiatRates.js';
import { SparkWalletProvider } from '../providers/SparkWalletProvider';
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider';
import { createWalletProvider, inferWalletType, WALLET_TYPES } from '../providers/WalletFactory';
import { useAutoWithdrawStore } from './autoWithdraw';

/**
 * Storage keys for persistence
 */
const STORAGE_KEYS = {
  WALLET_STORE: 'buhoGO_wallet_store',
  LEGACY_STATE: 'buhoGO_wallet_state',
  SESSION_PIN: 'buhoGO_session_pin', // sessionStorage only - per tab, cleared on close
};

/**
 * Encryption utilities for Spark wallet mnemonic
 * Uses Web Crypto API with AES-256-GCM
 */
const CryptoUtils = {
  /**
   * Derive encryption key from PIN using PBKDF2
   */
  async deriveKey(pin, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Encrypt mnemonic with PIN
   */
  async encryptMnemonic(mnemonic, pin) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(pin, salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(mnemonic)
    );

    // Combine salt + iv + encrypted data
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Return as base64
    return btoa(String.fromCharCode(...result));
  },

  /**
   * Decrypt mnemonic with PIN
   */
  async decryptMnemonic(encryptedData, pin) {
    try {
      const data = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

      const salt = data.slice(0, 16);
      const iv = data.slice(16, 28);
      const encrypted = data.slice(28);

      const key = await this.deriveKey(pin, salt);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error('Incorrect PIN');
    }
  }
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
    balances: {},
    walletInfos: {},

    // Session PIN for Spark wallet (runtime only, not persisted)
    sessionPin: null,

    // User preferences
    preferredFiatCurrency: 'USD',
    denominationCurrency: 'sats',
    useBip177Format: true, // BIP-177 (₿) vs Legacy (sats) format

    // Exchange rates (BTC price in each currency)
    exchangeRates: {},
    exchangeRatesAvailable: false,
    exchangeRatesLastUpdate: null,
    exchangeRatesError: null,

    // Seed backup tracking
    hasBackedUp: false,
    backupDismissedUntil: null, // timestamp when banner dismissal expires

    // UI states
    isLoading: false,
    isConnecting: false,

    // Error tracking
    lastError: null,
  }),

  getters: {
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
      return state.balances[state.activeWalletId] || 0;
    },

    /**
     * Total balance across all wallets in sats
     */
    totalBalance: (state) => {
      return Object.values(state.balances).reduce((sum, bal) => sum + (bal || 0), 0);
    },

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
     * Check if fiat conversion is available
     */
    canShowFiat: (state) => {
      return state.exchangeRatesAvailable && Object.keys(state.exchangeRates).length > 0;
    },

    /**
     * Lightning address of the active wallet (from NWC lud16 parameter)
     */
    activeWalletLightningAddress: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (!activeWallet) return null;

      // Spark wallets don't have lightning addresses
      if (activeWallet.type === 'spark') return null;

      // Helper: validate lightning address format (user@domain)
      const isValidLnAddress = (addr) => {
        if (!addr || typeof addr !== 'string') return false;
        const parts = addr.split('@');
        return parts.length === 2 && parts[0].length > 0 && parts[1].includes('.') && !addr.includes('://');
      };

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
     * Check if a Spark wallet already exists (only one allowed)
     */
    hasSparkWallet: (state) => {
      return state.wallets.some((w) => w.type === WALLET_TYPES.SPARK);
    },

    /**
     * Get the Spark wallet if it exists
     */
    sparkWallet: (state) => {
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
     * True when: Spark wallet exists, not backed up, has balance > 0, and not recently dismissed.
     */
    shouldPromptBackup: (state) => {
      if (state.hasBackedUp) return false;
      if (!state.wallets.some(w => w.type === WALLET_TYPES.SPARK)) return false;
      const sparkWallet = state.wallets.find(w => w.type === WALLET_TYPES.SPARK);
      if (!sparkWallet) return false;
      const balance = state.balances[sparkWallet.id] || 0;
      if (balance <= 0) return false;
      if (state.backupDismissedUntil && Date.now() < state.backupDismissedUntil) return false;
      return true;
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
      return activeWallet?.type || inferWalletType(activeWallet);
    },

    /**
     * Spark address of active wallet (if Spark)
     * Falls back to stored metadata address when wallet is locked/disconnected
     */
    activeSparkAddress: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== WALLET_TYPES.SPARK) return null;
      // Try runtime state first, fall back to persisted metadata
      return state.walletInfos[state.activeWalletId]?.sparkAddress
        || activeWallet?.metadata?.sparkAddress
        || null;
    },

    /**
     * Check if PIN is required for Spark wallet
     */
    needsPinEntry: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== WALLET_TYPES.SPARK) return false;
      return !state.sessionPin;
    },

    /**
     * Get display balance for a wallet (uses cached balance for locked Spark)
     * @returns {Function} (walletId) => { balance: number, isLocked: boolean, isCached: boolean }
     */
    getDisplayBalance: (state) => (walletId) => {
      const wallet = state.wallets.find(w => w.id === walletId);
      if (!wallet) return { balance: 0, isLocked: false, isCached: false };

      // For Spark wallets
      if (wallet.type === WALLET_TYPES.SPARK) {
        const isConnected = state.connectionStates[walletId]?.connected;
        const currentBalance = state.balances[walletId];

        // If connected, use current balance
        if (isConnected && currentBalance !== undefined) {
          return { balance: currentBalance, isLocked: false, isCached: false };
        }

        // If not connected, try cached balance from metadata
        const cachedBalance = wallet.metadata?.cachedBalance;
        if (cachedBalance !== undefined) {
          return { balance: cachedBalance, isLocked: true, isCached: true };
        }

        // No cached balance, wallet is locked
        return { balance: 0, isLocked: true, isCached: false };
      }

      // For NWC wallets, use current balance
      return {
        balance: state.balances[walletId] || 0,
        isLocked: false,
        isCached: false
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
  },

  actions: {
    /**
     * Initialize the store from localStorage
     */
    async initialize() {
      try {
        // Load saved state
        const savedState = localStorage.getItem(STORAGE_KEYS.WALLET_STORE);
        if (savedState) {
          const parsed = JSON.parse(savedState);

          // Check if cached exchange rates are still valid (less than 1 hour old)
          let ratesStillValid = false;
          if (parsed.exchangeRatesLastUpdate) {
            const lastUpdate = new Date(parsed.exchangeRatesLastUpdate);
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            ratesStillValid = lastUpdate > oneHourAgo;
          }

          // Migrate old wallets without type field
          const migratedWallets = (parsed.wallets || []).map(wallet => ({
            ...wallet,
            type: wallet.type || inferWalletType(wallet)
          }));

          this.$patch({
            wallets: migratedWallets,
            activeWalletId: parsed.activeWalletId || null,
            preferredFiatCurrency: parsed.preferredFiatCurrency || 'USD',
            denominationCurrency: parsed.denominationCurrency || 'sats',
            useBip177Format: parsed.useBip177Format !== undefined ? parsed.useBip177Format : true,
            exchangeRates: ratesStillValid ? (parsed.exchangeRates || {}) : {},
            exchangeRatesAvailable: ratesStillValid && parsed.exchangeRatesAvailable,
            exchangeRatesLastUpdate: ratesStillValid ? parsed.exchangeRatesLastUpdate : null,
            hasBackedUp: parsed.hasBackedUp || false,
          });
        }

        // Validate wallets
        await this.validateWallets();

        // Load exchange rates
        await this.loadExchangeRates();

        // Initialize auto-withdraw store
        const autoWithdrawStore = useAutoWithdrawStore();
        await autoWithdrawStore.initialize();

        // Try to restore session PIN from sessionStorage (survives page reload)
        this._restoreSessionPin();

        // Auto-connect to active wallet
        if (this.activeWalletId) {
          const activeWallet = this.wallets.find(w => w.id === this.activeWalletId);
          if (activeWallet) {
            if (activeWallet.type === WALLET_TYPES.SPARK) {
              // Spark wallet: auto-connect if session PIN is available
              if (this.sessionPin) {
                await this.connectSparkWallet(this.activeWalletId, this.sessionPin).catch((err) => {
                  console.warn('Spark auto-connect failed:', err.message);
                  // Don't clear PIN on failure - might be temporary network issue
                });
              }
            } else if (activeWallet.type === WALLET_TYPES.LNBITS) {
              // LNBits wallet: auto-connect
              await this.connectLNBitsWallet(this.activeWalletId).catch((err) => {
                console.warn('LNBits auto-connect failed:', err.message);
              });
            } else {
              // NWC wallet: auto-connect
              await this.connectWallet(this.activeWalletId).catch((err) => {
                console.warn('Auto-connect failed:', err.message);
              });
            }
          }
        }
      } catch (error) {
        console.error('Wallet store initialization error:', error);
        this.lastError = error.message;
      }
    },

    // ==========================================
    // Session PIN Management (survives page reload within tab)
    // ==========================================

    /**
     * Store session PIN in both Pinia state and sessionStorage
     * sessionStorage survives page reloads but clears when tab closes
     */
    _setSessionPin(pin) {
      this.sessionPin = pin;
      if (pin) {
        try {
          sessionStorage.setItem(STORAGE_KEYS.SESSION_PIN, pin);
        } catch (e) {
          console.warn('Could not store session PIN:', e);
        }
      } else {
        sessionStorage.removeItem(STORAGE_KEYS.SESSION_PIN);
      }
    },

    /**
     * Restore session PIN from sessionStorage if available
     * Called during initialization or when Pinia state is lost (HMR)
     */
    _restoreSessionPin() {
      if (!this.sessionPin) {
        try {
          const stored = sessionStorage.getItem(STORAGE_KEYS.SESSION_PIN);
          if (stored) {
            this.sessionPin = stored;
            return true;
          }
        } catch (e) {
          console.warn('Could not restore session PIN:', e);
        }
      }
      return !!this.sessionPin;
    },

    /**
     * Clear session PIN from both Pinia state and sessionStorage
     */
    _clearSessionPin() {
      this.sessionPin = null;
      try {
        sessionStorage.removeItem(STORAGE_KEYS.SESSION_PIN);
      } catch (e) {
        // Ignore errors
      }
    },

    // ==========================================
    // Seed Backup Management
    // ==========================================

    /**
     * Mark seed as backed up after user verifies their phrase
     */
    async confirmBackup() {
      this.hasBackedUp = true;
      this.backupDismissedUntil = null;
      await this.persistState();
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

    /**
     * Add a new Spark wallet
     * @param {Object} walletData - Spark wallet configuration
     * @param {string} walletData.name - Display name
     * @param {string} walletData.mnemonic - 12-word seed phrase
     * @param {string} walletData.pin - 6-digit PIN for encryption
     * @param {string} [walletData.network] - 'MAINNET' or 'REGTEST'
     * @param {boolean} [walletData.isRestore] - True if restoring from existing seed (marks backup as done)
     * @returns {Promise<Object>} The created wallet object
     */
    async addSparkWallet(walletData) {
      this.isConnecting = true;
      this.lastError = null;

      try {
        // Check if Spark wallet already exists
        if (this.hasSparkWallet) {
          throw new Error('A Spark wallet already exists. Delete it first to create a new one.');
        }

        // Validate input
        if (!walletData.mnemonic) {
          throw new Error('Mnemonic is required');
        }
        if (!walletData.pin || walletData.pin.length !== 6) {
          throw new Error('A 6-digit PIN is required');
        }

        // Validate mnemonic by trying to restore wallet
        const testWallet = await SparkWalletProvider.restoreWallet(
          walletData.mnemonic,
          walletData.network || 'MAINNET'
        );

        // Get Spark address
        const sparkAddress = await testWallet.getSparkAddress();

        // Clean up test wallet
        testWallet.cleanupConnections();

        // Encrypt mnemonic with PIN
        const encryptedMnemonic = await CryptoUtils.encryptMnemonic(
          walletData.mnemonic,
          walletData.pin
        );

        // Create wallet object
        const wallet = {
          id: this.generateWalletId(),
          type: WALLET_TYPES.SPARK,
          name: walletData.name || 'Spark Wallet',
          isActive: false,
          isDefault: this.wallets.length === 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          connectionData: {
            encryptedMnemonic: encryptedMnemonic,
            network: walletData.network || 'MAINNET',
          },
          metadata: {
            sparkAddress: sparkAddress,
          },
        };

        // Store wallet
        this.wallets.push(wallet);
        this.walletInfos[wallet.id] = {
          sparkAddress: sparkAddress,
          type: 'spark'
        };

        // Set as active if first wallet
        if (this.wallets.length === 1) {
          this.activeWalletId = wallet.id;
          wallet.isActive = true;
        }

        // Restored wallets already have their seed backed up
        if (walletData.isRestore) {
          this.hasBackedUp = true;
        }

        // Store PIN in session for immediate use (survives page reload)
        this._setSessionPin(walletData.pin);

        // Connect the wallet
        await this.connectSparkWallet(wallet.id, walletData.pin);

        await this.persistState();
        return wallet;
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    /**
     * Connect to a Spark wallet with PIN
     * @param {string} walletId - Wallet ID
     * @param {string} pin - 6-digit PIN
     */
    async connectSparkWallet(walletId, pin) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) {
        throw new Error('Spark wallet not found');
      }

      try {
        // Decrypt mnemonic
        const mnemonic = await CryptoUtils.decryptMnemonic(
          wallet.connectionData.encryptedMnemonic,
          pin
        );

        // Create provider
        const provider = new SparkWalletProvider(walletId, {
          name: wallet.name,
          network: wallet.connectionData.network,
        });

        // Initialize with mnemonic
        await provider.initializeWithMnemonic(mnemonic);

        // Store provider and session PIN (survives page reload)
        this.providers[walletId] = provider;
        this._setSessionPin(pin);

        // Update connection state
        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          error: null,
        };

        // Get balance
        const balanceResult = await provider.getBalance();
        this.balances[walletId] = balanceResult.balance;

        // Cache balance in wallet metadata for display when locked
        wallet.metadata = wallet.metadata || {};
        wallet.metadata.cachedBalance = balanceResult.balance;
        wallet.metadata.balanceUpdatedAt = Date.now();

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
     * Unlock Spark wallet with PIN (for session)
     * @param {string} pin - 6-digit PIN
     */
    async unlockSparkWallet(pin) {
      const sparkWallet = this.sparkWallet;
      if (!sparkWallet) {
        throw new Error('No Spark wallet found');
      }

      // Try to decrypt - this validates the PIN
      await CryptoUtils.decryptMnemonic(
        sparkWallet.connectionData.encryptedMnemonic,
        pin
      );

      // Store PIN and connect (survives page reload)
      this._setSessionPin(pin);
      await this.connectSparkWallet(sparkWallet.id, pin);
    },

    /**
     * Lock Spark wallet (clear session)
     */
    lockSparkWallet() {
      const sparkWallet = this.sparkWallet;
      if (sparkWallet) {
        // Disconnect provider
        const provider = this.providers[sparkWallet.id];
        if (provider) {
          provider.disconnect();
          delete this.providers[sparkWallet.id];
        }

        this.connectionStates[sparkWallet.id] = {
          connected: false,
          lastConnected: Date.now(),
          error: null,
        };
      }

      this._clearSessionPin();
    },

    /**
     * Get decrypted mnemonic (requires PIN verification)
     * @param {string} pin - PIN to verify
     * @returns {Promise<string>} Mnemonic
     */
    async getSparkMnemonic(pin) {
      const sparkWallet = this.sparkWallet;
      if (!sparkWallet) {
        throw new Error('No Spark wallet found');
      }

      return CryptoUtils.decryptMnemonic(
        sparkWallet.connectionData.encryptedMnemonic,
        pin
      );
    },

    /**
     * Change Spark wallet PIN
     * @param {string} currentPin - Current PIN
     * @param {string} newPin - New PIN
     */
    async changeSparkPin(currentPin, newPin) {
      const sparkWallet = this.sparkWallet;
      if (!sparkWallet) {
        throw new Error('No Spark wallet found');
      }

      if (!newPin || newPin.length !== 6) {
        throw new Error('New PIN must be 6 digits');
      }

      // Decrypt with current PIN
      const mnemonic = await CryptoUtils.decryptMnemonic(
        sparkWallet.connectionData.encryptedMnemonic,
        currentPin
      );

      // Re-encrypt with new PIN
      const newEncryptedMnemonic = await CryptoUtils.encryptMnemonic(mnemonic, newPin);

      // Update wallet
      sparkWallet.connectionData.encryptedMnemonic = newEncryptedMnemonic;
      this._setSessionPin(newPin);

      await this.persistState();
    },

    /**
     * Get Spark wallet provider
     * @param {string} walletId
     * @returns {SparkWalletProvider|null}
     */
    getSparkProvider(walletId) {
      return this.providers[walletId] || null;
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
          throw new Error('This wallet is already connected');
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
        this.wallets.push(wallet);
        this.connectionStates[wallet.id] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc,
          error: null,
        };
        this.balances[wallet.id] = balanceResponse.balance;
        this.walletInfos[wallet.id] = info;

        // Set as active if first wallet
        if (this.wallets.length === 1) {
          this.activeWalletId = wallet.id;
          wallet.isActive = true;
        }

        await this.persistState();
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
        // Validate input
        if (!walletData.serverUrl) {
          throw new Error('LNBits server URL is required');
        }
        if (!walletData.walletId) {
          throw new Error('Wallet ID is required');
        }
        if (!walletData.adminKey) {
          throw new Error('Admin key is required');
        }

        // Validate credentials and normalize URL
        const validation = await LNBitsWalletProvider.validateCredentials(
          walletData.serverUrl,
          walletData.walletId,
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
          throw new Error('This LNBits wallet is already connected');
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
        this.wallets.push(wallet);
        this.balances[wallet.id] = validation.walletInfo.balance;

        // Set as active if first wallet
        if (this.wallets.length === 1) {
          this.activeWalletId = wallet.id;
          wallet.isActive = true;
        }

        // Connect the wallet
        await this.connectLNBitsWallet(wallet.id);

        await this.persistState();
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
        const balanceResult = await provider.getBalance();
        this.balances[walletId] = balanceResult.balance;

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
     * Remove a wallet
     * @param {string} walletId - The wallet ID to remove
     */
    async removeWallet(walletId) {
      try {
        const walletIndex = this.wallets.findIndex((w) => w.id === walletId);
        if (walletIndex === -1) {
          throw new Error('Wallet not found');
        }

        const wallet = this.wallets[walletIndex];

        // Disconnect and cleanup
        await this.disconnectWallet(walletId);

        // Remove provider if exists
        if (this.providers[walletId]) {
          delete this.providers[walletId];
        }

        // Remove from state
        this.wallets.splice(walletIndex, 1);
        delete this.connectionStates[walletId];
        delete this.balances[walletId];
        delete this.walletInfos[walletId];

        // Clear session PIN and backup state if removing Spark wallet
        if (wallet.type === WALLET_TYPES.SPARK) {
          this._clearSessionPin();
          this.hasBackedUp = false;
          this.backupDismissedUntil = null;
        }

        // Clean up auto-withdraw config
        const autoWithdrawStore = useAutoWithdrawStore();
        await autoWithdrawStore.removeConfig(walletId);

        // Handle active wallet removal
        if (this.activeWalletId === walletId) {
          const newActive = this.defaultWallet || this.wallets[0];
          if (newActive) {
            await this.switchActiveWallet(newActive.id);
          } else {
            this.activeWalletId = null;
          }
        }

        // Handle default wallet removal
        if (wallet.isDefault && this.wallets.length > 0) {
          this.wallets[0].isDefault = true;
        }

        await this.persistState();
      } catch (error) {
        this.lastError = error.message;
        throw error;
      }
    },

    /**
     * Switch the active wallet
     * @param {string} walletId - The wallet ID to make active
     */
    async switchActiveWallet(walletId) {
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

        // Ensure connected (Spark needs PIN)
        if (!this.connectionStates[walletId]?.connected) {
          if (wallet.type === WALLET_TYPES.SPARK) {
            if (this.sessionPin) {
              await this.connectSparkWallet(walletId, this.sessionPin);
            }
            // If no PIN, the UI will prompt for it
          } else if (wallet.type === WALLET_TYPES.LNBITS) {
            await this.connectLNBitsWallet(walletId);
          } else {
            await this.connectWallet(walletId);
          }
        }

        await this.persistState();
      } catch (error) {
        this.lastError = error.message;
        throw error;
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
        if (!this.sessionPin) {
          throw new Error('PIN required for Spark wallet');
        }
        await this.connectSparkWallet(walletId, this.sessionPin);
        return null;
      }

      // Handle LNBits wallet
      if (wallet.type === WALLET_TYPES.LNBITS) {
        await this.connectLNBitsWallet(walletId);
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
      const wallet = this.wallets.find(w => w.id === walletId);
      const state = this.connectionStates[walletId];

      if (wallet?.type === WALLET_TYPES.SPARK || wallet?.type === WALLET_TYPES.LNBITS) {
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

    /**
     * Refresh wallet balance and info
     * @param {string} walletId - The wallet ID to refresh
     */
    async refreshWalletData(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) return;

      try {
        if (wallet.type === WALLET_TYPES.SPARK) {
          const provider = this.providers[walletId];
          if (!provider || !this.connectionStates[walletId]?.connected) {
            if (this.sessionPin) {
              await this.connectSparkWallet(walletId, this.sessionPin);
            }
            return;
          }

          const [balanceResult, info] = await Promise.all([
            provider.getBalance(),
            provider.getInfo()
          ]);

          this.balances[walletId] = balanceResult.balance;
          this.walletInfos[walletId] = info;
        } else if (wallet.type === WALLET_TYPES.LNBITS) {
          let provider = this.providers[walletId];

          if (!provider || !this.connectionStates[walletId]?.connected) {
            await this.connectLNBitsWallet(walletId);
            provider = this.providers[walletId];
          }

          const [balanceResult, info] = await Promise.all([
            provider.getBalance(),
            provider.getInfo()
          ]);

          this.balances[walletId] = balanceResult.balance;
          this.walletInfos[walletId] = info;
        } else {
          // NWC wallet
          let nwc = this.connectionStates[walletId]?.nwcInstance;

          if (!nwc || !this.connectionStates[walletId]?.connected) {
            nwc = await this.connectWallet(walletId);
          }

          const [balanceResponse, info] = await Promise.all([
            nwc.getBalance(),
            nwc.getInfo(),
          ]);

          this.balances[walletId] = balanceResponse.balance;
          this.walletInfos[walletId] = info;
        }

        // Update last used
        wallet.lastUsed = Date.now();
        await this.persistState();

        // Auto-withdraw check
        const newBalance = this.balances[walletId];
        if (newBalance > 0) {
          const autoWithdrawStore = useAutoWithdrawStore();
          autoWithdrawStore.checkAndExecute(walletId, newBalance, this);
        }
      } catch (error) {
        console.error(`Refresh wallet ${walletId} failed:`, error);
        this.connectionStates[walletId] = {
          ...this.connectionStates[walletId],
          connected: false,
          error: error.message,
        };
      }
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
     * Update wallet display name
     * @param {string} walletId - The wallet ID
     * @param {string} newName - The new display name
     */
    async updateWalletName(walletId, newName) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (wallet) {
        wallet.name = newName;
        wallet.lastUsed = Date.now();
        await this.persistState();
      }
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

      if (wallet.type === WALLET_TYPES.SPARK || wallet.type === WALLET_TYPES.LNBITS) {
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
    async ensureSparkConnected() {
      const wallet = this.activeWallet;
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) {
        throw new Error('No active Spark wallet');
      }

      // Check if already have a connected provider
      let provider = this.providers[wallet.id];
      if (provider && provider.isConnected) {
        return provider;
      }

      // Try to restore session PIN from sessionStorage if not in memory
      // This handles cases where Pinia state was lost (HMR, etc.)
      if (!this.sessionPin) {
        this._restoreSessionPin();
      }

      // Try to connect using session PIN
      if (this.sessionPin) {
        try {
          await this.connectSparkWallet(wallet.id, this.sessionPin);
          provider = this.providers[wallet.id];
          if (provider && provider.isConnected) {
            return provider;
          }
        } catch (error) {
          // If connection fails with stored PIN, it might be corrupted
          // Clear it and let user re-enter
          console.warn('Auto-reconnect failed:', error.message);
        }
      }

      throw new Error('Spark wallet not unlocked. Please enter your PIN.');
    },

    /**
     * Validate all wallets and remove invalid ones
     */
    async validateWallets() {
      this.wallets = this.wallets.filter((wallet) => {
        if (wallet.type === WALLET_TYPES.SPARK) {
          return wallet.connectionData?.encryptedMnemonic;
        }
        if (wallet.type === WALLET_TYPES.LNBITS) {
          return wallet.connectionData?.serverUrl && wallet.connectionData?.adminKey;
        }
        // NWC wallet
        const isValid = wallet.nwcUrl && wallet.nwcUrl.startsWith('nostr+walletconnect://');
        if (!isValid) {
          console.warn(`Removing invalid wallet: ${wallet.id}`);
        }
        return isValid;
      });

      // Ensure active wallet is valid
      if (this.activeWalletId && !this.wallets.find((w) => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets[0]?.id || null;
      }
    },

    /**
     * Disconnect and remove all wallets
     */
    async disconnectAll() {
      for (const walletId of Object.keys(this.connectionStates)) {
        await this.disconnectWallet(walletId);
      }

      this.wallets = [];
      this.activeWalletId = null;
      this.connectionStates = {};
      this.balances = {};
      this.walletInfos = {};
      this.providers = {};
      this.hasBackedUp = false;
      this.backupDismissedUntil = null;
      this._clearSessionPin();

      // Clear auto-withdraw configs
      const autoWithdrawStore = useAutoWithdrawStore();
      await autoWithdrawStore.clearAll();

      await this.persistState();
    },

    /**
     * Disconnect and remove only NWC wallets (keeps Spark wallet)
     */
    async disconnectNwcWallets() {
      const nwcWallets = this.wallets.filter(w => w.type === WALLET_TYPES.NWC);

      // Disconnect each NWC wallet
      for (const wallet of nwcWallets) {
        await this.disconnectWallet(wallet.id);
        // Clean up state for this wallet
        delete this.connectionStates[wallet.id];
        delete this.balances[wallet.id];
        delete this.walletInfos[wallet.id];
        delete this.providers[wallet.id];
      }

      // Remove NWC wallets from the list
      this.wallets = this.wallets.filter(w => w.type !== WALLET_TYPES.NWC);

      // If active wallet was NWC, switch to Spark or null
      if (!this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets[0]?.id || null;
      }

      await this.persistState();
    },

    /**
     * Disconnect and remove only LNBits wallets
     */
    async disconnectLNBitsWallets() {
      const lnbitsWallets = this.wallets.filter(w => w.type === WALLET_TYPES.LNBITS);

      // Disconnect each LNBits wallet
      for (const wallet of lnbitsWallets) {
        await this.disconnectWallet(wallet.id);
        // Clean up state for this wallet
        delete this.connectionStates[wallet.id];
        delete this.balances[wallet.id];
        delete this.walletInfos[wallet.id];
        delete this.providers[wallet.id];
      }

      // Remove LNBits wallets from the list
      this.wallets = this.wallets.filter(w => w.type !== WALLET_TYPES.LNBITS);

      // If active wallet was LNBits, switch to first available or null
      if (!this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets[0]?.id || null;
      }

      await this.persistState();
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
      });
    },

    /**
     * Ensure a wallet is connected for transfer
     * @param {string} walletId - Wallet ID to connect
     * @returns {Promise<Object>} Provider instance
     */
    async ensureWalletConnectedForTransfer(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Get current provider
      let provider = this.getProvider(walletId);

      // Check if provider exists and is actually connected
      const isActuallyConnected = provider && (
        (wallet.type === WALLET_TYPES.SPARK && provider.isConnected) ||
        (wallet.type === WALLET_TYPES.LNBITS && provider.isConnected) ||
        (wallet.type === WALLET_TYPES.NWC && this.connectionStates[walletId]?.nwcInstance)
      );

      if (isActuallyConnected) {
        return provider;
      }

      // Connect based on wallet type
      if (wallet.type === WALLET_TYPES.SPARK) {
        if (!this.sessionPin) {
          throw new Error('PIN required for Spark wallet');
        }
        await this.connectSparkWallet(walletId, this.sessionPin);
      } else if (wallet.type === WALLET_TYPES.LNBITS) {
        await this.connectLNBitsWallet(walletId);
      } else {
        await this.connectWallet(walletId);
      }

      // Get the newly connected provider
      provider = this.getProvider(walletId);
      if (!provider) {
        throw new Error(`Failed to connect ${wallet.name}`);
      }

      return provider;
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

      // Step 1: Create invoice from destination wallet
      let invoice;
      const transferMemo = memo || `Transfer from ${fromWallet.name}`;
      const toType = toWallet.type?.toLowerCase() || 'nwc';

      try {
        if (toType === 'spark' || toType === 'lnbits') {
          // Spark and LNBits both use createInvoice({ amount, description })
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
        throw new Error(`Failed to create invoice from ${toWallet.name}: ${invoiceError.message}`);
      }

      if (!invoice) {
        throw new Error('Failed to create invoice from destination wallet');
      }

      // Step 2: Pay invoice from source wallet
      let paymentResult;
      const fromType = fromWallet.type?.toLowerCase() || 'nwc';

      try {
        if (fromType === 'spark' || fromType === 'lnbits') {
          // Spark and LNBits both use payInvoice({ invoice })
          paymentResult = await fromProvider.payInvoice({ invoice });
        } else {
          // NWC wallet - use sendPayment with just the invoice string
          paymentResult = await fromProvider.sendPayment(invoice);
        }
      } catch (payError) {
        console.error('Payment error:', payError);
        throw new Error(`Failed to send payment from ${fromWallet.name}: ${payError.message}`);
      }

      // Step 3: Refresh balances for both wallets
      await Promise.all([
        this.refreshWalletData(fromWalletId),
        this.refreshWalletData(toWalletId)
      ]);

      return {
        success: true,
        fromWallet: fromWallet.name,
        toWallet: toWallet.name,
        amount: amountSats,
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
          this.exchangeRates = {
            usd: rates.USD || 0,
            eur: rates.EUR || 0,
            gbp: rates.GBP || 0,
            jpy: rates.JPY || 0,
            chf: rates.CHF || 0,
            cad: rates.CAD || 0,
            aud: rates.AUD || 0,
          };
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
     * Generate a unique wallet ID
     * @returns {string} Unique wallet ID
     */
    generateWalletId() {
      return `wallet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    },

    /**
     * Persist state to localStorage
     */
    async persistState() {
      try {
        // Save new format
        const stateToSave = {
          wallets: this.wallets,
          activeWalletId: this.activeWalletId,
          preferredFiatCurrency: this.preferredFiatCurrency,
          denominationCurrency: this.denominationCurrency,
          useBip177Format: this.useBip177Format,
          exchangeRates: this.exchangeRates,
          exchangeRatesAvailable: this.exchangeRatesAvailable,
          exchangeRatesLastUpdate: this.exchangeRatesLastUpdate,
          hasBackedUp: this.hasBackedUp,
        };
        localStorage.setItem(STORAGE_KEYS.WALLET_STORE, JSON.stringify(stateToSave));

        // Maintain backward compatibility
        const legacyState = {
          balance: this.activeBalance,
          connectedWallets: this.wallets.map((w) => ({
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
        localStorage.setItem(STORAGE_KEYS.LEGACY_STATE, JSON.stringify(legacyState));
      } catch (error) {
        console.error('Failed to persist wallet state:', error);
      }
    },

    /**
     * Clear all wallet data
     */
    clearAll() {
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
          provider.disconnect();
        } catch (e) {
          // Ignore errors
        }
      });

      this.$reset();
      localStorage.removeItem(STORAGE_KEYS.WALLET_STORE);
      localStorage.removeItem(STORAGE_KEYS.LEGACY_STATE);
    },
  },
});
