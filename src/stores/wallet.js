/**
 * Wallet Store
 *
 * Pinia store for managing multiple Lightning wallets.
 * Supports both NWC (Nostr Wallet Connect) and Spark (self-custodial) wallets.
 */

import { defineStore } from 'pinia';
import { NostrWebLNProvider } from '@getalby/sdk';
import { fiatRatesService } from '../utils/fiatRates.js';
import { SparkWalletProvider, SPARK_ACCOUNT_DEFAULTS } from '../providers/SparkWalletProvider';
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider';
import { createWalletProvider, inferWalletType, WALLET_TYPES } from '../providers/WalletFactory';
import { useAutoWithdrawStore } from './autoWithdraw';

/**
 * Storage keys for persistence
 */
const STORAGE_KEYS = {
  WALLET_STORE: 'buhoGO_wallet_store',
  LEGACY_STATE: 'buhoGO_wallet_state',
  DEVICE_KEY: 'buhoGO_device_key',
};

/**
 * Encryption utilities for Spark wallet mnemonic.
 * Uses a random 256-bit device key stored in localStorage.
 * The mnemonic is never stored in plaintext — AES-256-GCM encryption at rest.
 */
const CryptoUtils = {
  /**
   * Get or create the device encryption key.
   * Generated once, stored in localStorage as base64.
   */
  async getDeviceKey() {
    let keyB64 = localStorage.getItem(STORAGE_KEYS.DEVICE_KEY);

    if (!keyB64) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      keyB64 = btoa(String.fromCharCode(...raw));
      localStorage.setItem(STORAGE_KEYS.DEVICE_KEY, keyB64);
    }

    const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Encrypt mnemonic with device key
   */
  async encryptMnemonic(mnemonic) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.getDeviceKey();

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(mnemonic)
    );

    // Combine iv + encrypted data
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
  },

  /**
   * Decrypt mnemonic with device key
   */
  async decryptMnemonic(encryptedData) {
    const data = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const key = await this.getDeviceKey();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  },

  /**
   * Migrate a PIN-encrypted mnemonic to device-key encryption.
   * Used once for existing users who had a PIN.
   */
  async migrateFromPin(encryptedData, pin) {
    // Decrypt with old PIN-based scheme (salt + iv + ciphertext)
    const data = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const encrypted = data.slice(28);

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']
    );
    const oldKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      oldKey,
      encrypted
    );

    const mnemonic = new TextDecoder().decode(decrypted);

    // Re-encrypt with device key
    return this.encryptMnemonic(mnemonic);
  },

  /**
   * Check if encrypted data uses the old PIN-based format.
   * Old format: salt(16) + iv(12) + ciphertext (base64 decodes to > 28 bytes with salt prefix)
   * New format: iv(12) + ciphertext (no salt)
   * We detect by trying device-key decryption — if it fails, it's old format.
   */
  async isOldPinFormat(encryptedData) {
    try {
      await this.decryptMnemonic(encryptedData);
      return false; // Device key worked — already migrated
    } catch {
      return true; // Device key failed — still PIN-encrypted
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

    // Biometric lock
    biometricsEnabled: false,

    // Internal flag: set true when user explicitly removes wallets (bypasses persist guard)
    _walletRemovalInProgress: false,

    // Migration: true if existing wallets still use old PIN encryption
    needsPinMigration: false,

    // UI states
    isLoading: false,
    isConnecting: false,
    walletSwitching: false,

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
      const sparkWallets = state.wallets.filter(w => w.type === WALLET_TYPES.SPARK);
      if (sparkWallets.length === 0) return false;
      // Check per-wallet backup status first, fall back to store-level for pre-migration wallets
      return sparkWallets.some(w => {
        const backedUp = w.metadata?.hasBackedUp ?? state.hasBackedUp;
        if (backedUp) return false;
        const balance = state.balances[w.id] || 0;
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
      return activeWallet?.type || inferWalletType(activeWallet);
    },

    /**
     * Check if Spark wallet needs connection (no PIN required — auto-connects)
     */
    needsPinEntry: (state) => {
      const activeWallet = state.wallets.find((w) => w.id === state.activeWalletId);
      if (activeWallet?.type !== WALLET_TYPES.SPARK) return false;
      return !state.connectionStates[state.activeWalletId]?.connected;
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

    /**
     * Get the Business Spark wallet
     */
    sparkBusinessWallet: (state) => {
      return state.wallets.find(w =>
        w.type === WALLET_TYPES.SPARK && w.connectionData?.accountNumber === 1
      ) || null;
    },

    /**
     * Get the Personal Spark wallet
     */
    sparkPersonalWallet: (state) => {
      return state.wallets.find(w =>
        w.type === WALLET_TYPES.SPARK && w.connectionData?.accountNumber === 2
      ) || null;
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

          // Migrate to Business/Personal pair
          // Find all existing Spark wallets
          const sparkWallets = migratedWallets.filter(w => w.type === WALLET_TYPES.SPARK);

          if (sparkWallets.length > 0) {
            // First, migrate pockets (metadata.accounts[]) to top-level wallets
            for (const wallet of [...sparkWallets]) {
              if (wallet.metadata?.accounts?.length) {
                const walletGroupId = wallet.connectionData.walletGroupId
                  || `spark_group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                wallet.connectionData.walletGroupId = walletGroupId;

                for (const account of wallet.metadata.accounts) {
                  const newWalletId = `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
                  migratedWallets.push({
                    id: newWalletId,
                    type: WALLET_TYPES.SPARK,
                    name: account.name || 'Personal',
                    isActive: false,
                    isDefault: false,
                    createdAt: Date.now(),
                    lastUsed: Date.now(),
                    connectionData: {
                      encryptedMnemonic: wallet.connectionData.encryptedMnemonic,
                      network: wallet.connectionData.network,
                      accountNumber: account.accountNumber,
                      walletGroupId: walletGroupId,
                    },
                    metadata: {
                      sparkAddress: account.sparkAddress || null,
                      hasBackedUp: wallet.metadata?.hasBackedUp || false,
                      cachedBalance: account.cachedBalance || 0,
                    },
                  });

                  if (parsed.activeWalletId === wallet.id
                    && wallet.metadata.activeAccountNumber === account.accountNumber) {
                    parsed.activeWalletId = newWalletId;
                  }
                }
                delete wallet.metadata.accounts;
                delete wallet.metadata.activeAccountNumber;
              }
            }

            // Now ensure Business/Personal pair exists
            // Re-scan after pocket migration
            const allSpark = migratedWallets.filter(w => w.type === WALLET_TYPES.SPARK);
            const hasAccNum1 = allSpark.find(w => w.connectionData?.accountNumber === 1);
            const hasAccNum2 = allSpark.find(w => w.connectionData?.accountNumber === 2);

            if (hasAccNum1 && !hasAccNum2) {
              // Has Business (acc 1) but no Personal (acc 2) — create Personal
              const walletGroupId = hasAccNum1.connectionData.walletGroupId
                || `spark_group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              hasAccNum1.connectionData.walletGroupId = walletGroupId;
              hasAccNum1.name = 'Business';

              migratedWallets.push({
                id: `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                type: WALLET_TYPES.SPARK,
                name: 'Personal',
                isActive: false,
                isDefault: false,
                createdAt: Date.now(),
                lastUsed: Date.now(),
                connectionData: {
                  encryptedMnemonic: hasAccNum1.connectionData.encryptedMnemonic,
                  network: hasAccNum1.connectionData.network,
                  accountNumber: 2,
                  walletGroupId: walletGroupId,
                },
                metadata: {
                  sparkAddress: null,
                  hasBackedUp: hasAccNum1.metadata?.hasBackedUp || false,
                  cachedBalance: 0,
                },
              });
            } else if (hasAccNum1 && hasAccNum2) {
              // Both exist — ensure they share a walletGroupId and have correct names
              const walletGroupId = hasAccNum1.connectionData.walletGroupId
                || hasAccNum2.connectionData.walletGroupId
                || `spark_group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              hasAccNum1.connectionData.walletGroupId = walletGroupId;
              hasAccNum2.connectionData.walletGroupId = walletGroupId;
            }

            // Remove any extra Spark wallets beyond the Business/Personal pair
            // (from old multi-wallet system with different mnemonics)
            const finalSpark = migratedWallets.filter(w => w.type === WALLET_TYPES.SPARK);
            if (finalSpark.length > 2) {
              const keepGroup = finalSpark.find(w => w.connectionData?.accountNumber === 1)?.connectionData?.walletGroupId;
              for (let i = migratedWallets.length - 1; i >= 0; i--) {
                const w = migratedWallets[i];
                if (w.type === WALLET_TYPES.SPARK && w.connectionData?.walletGroupId !== keepGroup) {
                  migratedWallets.splice(i, 1);
                }
              }
            }
          }

          console.log(`[wallet-store] Loading ${migratedWallets.length} wallet(s):`, migratedWallets.map(w => `${w.type}:${w.name}`));

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
            biometricsEnabled: parsed.biometricsEnabled || false,
          });
        }

        // Validate wallets
        await this.validateWallets();

        // Load exchange rates
        await this.loadExchangeRates();

        // Initialize auto-withdraw store
        const autoWithdrawStore = useAutoWithdrawStore();
        await autoWithdrawStore.initialize();

        // Auto-connect Spark wallets — detect if migration from PIN is needed
        if (this.sparkWallets.length > 0) {
          const firstSpark = this.sparkWallets[0];
          const isOld = await CryptoUtils.isOldPinFormat(firstSpark.connectionData.encryptedMnemonic);
          if (isOld) {
            this.needsPinMigration = true;
            console.log('[wallet] PIN migration required — waiting for user to enter PIN one last time');
          } else {
            await this.connectAllSparkWallets();
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
      } catch (error) {
        console.error('Wallet store initialization error:', error);
        this.lastError = error.message;
      }
    },


    // ==========================================
    // Seed Backup Management
    // ==========================================

    /**
     * Mark seed as backed up after user verifies their phrase
     * @param {string} [walletId] - Specific wallet ID (defaults to active Spark wallet)
     */
    async confirmBackup(walletId) {
      // Mark ALL Spark wallets as backed up (they share the same mnemonic)
      for (const w of this.sparkWallets) {
        if (w.metadata) {
          w.metadata.hasBackedUp = true;
        }
      }
      // Legacy store-level flag
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

    async addSparkWallet(walletData) {
      this.isConnecting = true;
      this.lastError = null;
      const onProgress = walletData.onProgress || (() => {});

      try {
        if (!walletData.mnemonic) {
          throw new Error('Mnemonic is required');
        }

        // Only one Spark wallet pair allowed
        if (this.hasAnySparkWallet) {
          throw new Error('Spark wallet already exists');
        }

        const network = walletData.network || 'MAINNET';
        const walletGroupId = `spark_group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Encrypt mnemonic with device key
        onProgress('encrypting');
        const encryptedMnemonic = await CryptoUtils.encryptMnemonic(walletData.mnemonic);

        // Create Business wallet (accountNumber 1)
        onProgress('business');
        const businessWallet = await this._createSparkWalletEntry({
          mnemonic: walletData.mnemonic,
          encryptedMnemonic,
          name: 'Business',
          network,
          accountNumber: 1,
          walletGroupId,
          isRestore: walletData.isRestore,
        });

        // Set Business as active and default
        this.activeWalletId = businessWallet.id;
        businessWallet.isActive = true;
        businessWallet.isDefault = true;

        // Create Personal wallet (accountNumber 2)
        onProgress('personal');
        const personalEncrypted = await CryptoUtils.encryptMnemonic(walletData.mnemonic);
        await this._createSparkWalletEntry({
          mnemonic: walletData.mnemonic,
          encryptedMnemonic: personalEncrypted,
          name: 'Personal',
          network,
          accountNumber: 2,
          walletGroupId,
          isRestore: walletData.isRestore,
        });

        // Legacy store-level backup flag
        if (walletData.isRestore) {
          this.hasBackedUp = true;
        }

        onProgress('done');
        await this.persistState();
        return businessWallet;
      } catch (error) {
        this.lastError = error.message;
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },

    /**
     * Internal helper: create and connect a single Spark wallet entry
     */
    async _createSparkWalletEntry({ mnemonic, encryptedMnemonic, name, network, accountNumber, walletGroupId, isRestore }) {
      // Validate mnemonic
      const testWallet = await SparkWalletProvider.restoreWallet(mnemonic, network, accountNumber);
      const sparkAddress = await testWallet.getSparkAddress();
      testWallet.cleanupConnections();

      const wallet = {
        id: this.generateWalletId(),
        type: WALLET_TYPES.SPARK,
        name,
        isActive: false,
        isDefault: false,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        connectionData: {
          encryptedMnemonic,
          network,
          accountNumber,
          walletGroupId,
        },
        metadata: {
          sparkAddress,
          hasBackedUp: isRestore || false,
        },
      };

      this.wallets.push(wallet);
      this.walletInfos[wallet.id] = { sparkAddress, type: 'spark' };

      // Connect the wallet
      await this.connectSparkWallet(wallet.id);

      return wallet;
    },

    /**
     * Connect to a Spark wallet using device key
     * @param {string} walletId - Wallet ID
     */
    async connectSparkWallet(walletId) {
      const wallet = this.wallets.find(w => w.id === walletId);
      if (!wallet || wallet.type !== WALLET_TYPES.SPARK) {
        throw new Error('Spark wallet not found');
      }

      try {
        // Decrypt mnemonic with device key
        const mnemonic = await CryptoUtils.decryptMnemonic(
          wallet.connectionData.encryptedMnemonic
        );

        // Create provider (accountNumber falls back to network default for pre-1.5.0 wallets)
        const provider = new SparkWalletProvider(walletId, {
          name: wallet.name,
          network: wallet.connectionData.network,
          accountNumber: wallet.connectionData.accountNumber,
        });

        // Initialize with mnemonic
        await provider.initializeWithMnemonic(mnemonic);

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
     * Connect all Spark wallets using device key
     */
    async connectAllSparkWallets() {
      for (const wallet of this.sparkWallets) {
        try {
          if (!this.connectionStates[wallet.id]?.connected) {
            await this.connectSparkWallet(wallet.id);
          }
        } catch (err) {
          console.warn(`Failed to connect Spark wallet "${wallet.name}":`, err.message);
        }
      }
    },

    /**
     * Lock all Spark wallets (disconnect providers)
     */
    lockSparkWallet() {
      for (const wallet of this.sparkWallets) {
        const provider = this.providers[wallet.id];
        if (provider) {
          provider.disconnect();
          delete this.providers[wallet.id];
        }
        this.connectionStates[wallet.id] = {
          connected: false,
          lastConnected: Date.now(),
          error: null,
        };
      }
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
     * @returns {SparkWalletProvider|null}
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

        // Activate the newly added wallet
        this.activeWalletId = wallet.id;
        wallet.isActive = true;

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

        // Activate the newly added wallet
        this.activeWalletId = wallet.id;
        wallet.isActive = true;

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
      this._walletRemovalInProgress = true;
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

        // If this wallet is in a group, also remove all other group members
        const groupId = wallet.connectionData?.walletGroupId;
        if (groupId) {
          const groupMembers = this.wallets.filter(w => w.connectionData?.walletGroupId === groupId && w.id !== walletId);
          for (const member of groupMembers) {
            if (this.providers[member.id]) {
              try { this.providers[member.id].disconnect(); } catch (e) { /* ignore */ }
              delete this.providers[member.id];
            }
            delete this.connectionStates[member.id];
            delete this.balances[member.id];
            delete this.walletInfos[member.id];
            const idx = this.wallets.indexOf(member);
            if (idx !== -1) this.wallets.splice(idx, 1);
            const autoWithdrawStore = useAutoWithdrawStore();
            await autoWithdrawStore.removeConfig(member.id);
          }
        }

        // Remove from state
        this.wallets.splice(walletIndex, 1);
        delete this.connectionStates[walletId];
        delete this.balances[walletId];
        delete this.walletInfos[walletId];

        // Clean up backup state if removing the last Spark wallet
        if (wallet.type === WALLET_TYPES.SPARK) {
          const remainingSparkWallets = this.wallets.filter(w => w.type === WALLET_TYPES.SPARK);
          if (remainingSparkWallets.length === 0) {
            this.hasBackedUp = false;
            this.backupDismissedUntil = null;
          }
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

        // Ensure connected
        if (!this.connectionStates[walletId]?.connected) {
          if (wallet.type === WALLET_TYPES.SPARK) {
            await this.connectSparkWallet(walletId);
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
            await this.connectSparkWallet(walletId);
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
     * Validate all wallets and remove invalid ones
     */
    async validateWallets() {
      const before = this.wallets.length;
      this.wallets = this.wallets.filter((wallet) => {
        if (wallet.type === WALLET_TYPES.SPARK) {
          const valid = !!wallet.connectionData?.encryptedMnemonic;
          if (!valid) console.warn(`[validateWallets] Removing Spark wallet "${wallet.name}" (${wallet.id}): missing encryptedMnemonic`);
          return valid;
        }
        if (wallet.type === WALLET_TYPES.LNBITS) {
          const valid = wallet.connectionData?.serverUrl && wallet.connectionData?.adminKey;
          if (!valid) console.warn(`[validateWallets] Removing LNBits wallet "${wallet.name}" (${wallet.id}): missing serverUrl or adminKey`);
          return valid;
        }
        // NWC wallet
        const isValid = wallet.nwcUrl && wallet.nwcUrl.startsWith('nostr+walletconnect://');
        if (!isValid) {
          console.warn(`[validateWallets] Removing NWC wallet "${wallet.name}" (${wallet.id}): nwcUrl=${wallet.nwcUrl ? 'invalid format' : 'missing'}`, JSON.stringify({ type: wallet.type, keys: Object.keys(wallet) }));
        }
        return isValid;
      });

      if (this.wallets.length < before) {
        console.warn(`[validateWallets] Removed ${before - this.wallets.length} wallet(s). ${this.wallets.length} remaining.`);
      }

      // Ensure active wallet is valid
      if (this.activeWalletId && !this.wallets.find((w) => w.id === this.activeWalletId)) {
        console.warn(`[validateWallets] Active wallet ${this.activeWalletId} no longer valid, switching to ${this.wallets[0]?.id || 'none'}`);
        this.activeWalletId = this.wallets[0]?.id || null;
      }
    },

    /**
     * Disconnect and remove all wallets
     */
    async disconnectAll() {
      this._walletRemovalInProgress = true;
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

      // Clear auto-withdraw configs
      const autoWithdrawStore = useAutoWithdrawStore();
      await autoWithdrawStore.clearAll();

      await this.persistState();
    },

    /**
     * Disconnect and remove only NWC wallets (keeps Spark wallet)
     */
    async disconnectNwcWallets() {
      this._walletRemovalInProgress = true;
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
      this._walletRemovalInProgress = true;
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
        await this.connectSparkWallet(walletId);
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
     * Update biometric lock preference
     * @param {boolean} enabled - Enable or disable biometric lock
     */
    updateBiometricsEnabled(enabled) {
      this.biometricsEnabled = enabled;
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
        // Safety: never save fewer wallets than localStorage already has,
        // unless the user explicitly removed wallets (disconnect/remove actions).
        // Guards against HMR resets and race conditions that wipe wallet data.
        if (!this._walletRemovalInProgress) {
          const existing = localStorage.getItem(STORAGE_KEYS.WALLET_STORE);
          if (existing) {
            const parsed = JSON.parse(existing);
            const savedCount = parsed.wallets?.length || 0;
            if (savedCount > 0 && this.wallets.length < savedCount) {
              console.warn(`[wallet-store] Refusing to persist — would lose wallets (${this.wallets.length} < ${savedCount} saved). This is likely an HMR or race condition.`);
              return;
            }
          }
        }
        this._walletRemovalInProgress = false;

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
          biometricsEnabled: this.biometricsEnabled,
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
