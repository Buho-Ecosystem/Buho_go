/**
 * Wallet Store
 *
 * Pinia store for managing multiple Lightning wallets via Nostr Wallet Connect (NWC).
 * Handles wallet connections, balances, and preferences.
 */

import { defineStore } from 'pinia';
import { NostrWebLNProvider } from '@getalby/sdk';
import { fiatRatesService } from '../utils/fiatRates.js';

/**
 * Storage keys for persistence
 */
const STORAGE_KEYS = {
  WALLET_STORE: 'buhoGO_wallet_store',
  LEGACY_STATE: 'buhoGO_wallet_state',
};

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    // Wallet list
    wallets: [],
    activeWalletId: null,

    // Connection states (keyed by wallet ID)
    connectionStates: {},

    // Wallet data (keyed by wallet ID)
    balances: {},
    walletInfos: {},

    // User preferences
    preferredFiatCurrency: 'USD',
    denominationCurrency: 'sats',

    // Exchange rates (BTC price in each currency)
    exchangeRates: {},
    exchangeRatesAvailable: false,
    exchangeRatesLastUpdate: null,
    exchangeRatesError: null,

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

      // Check if already in metadata
      if (activeWallet.metadata?.lud16) {
        return activeWallet.metadata.lud16;
      }

      // Extract from nwcUrl for wallets added before lud16 extraction was implemented
      if (activeWallet.nwcUrl) {
        try {
          const nwcUrlParsed = new URL(activeWallet.nwcUrl.replace('nostr+walletconnect://', 'http://'));
          const lud16Raw = nwcUrlParsed.searchParams.get('lud16');
          if (lud16Raw && lud16Raw !== 'null') {
            return lud16Raw;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      return null;
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

          this.$patch({
            wallets: parsed.wallets || [],
            activeWalletId: parsed.activeWalletId || null,
            preferredFiatCurrency: parsed.preferredFiatCurrency || 'USD',
            denominationCurrency: parsed.denominationCurrency || 'sats',
            exchangeRates: ratesStillValid ? (parsed.exchangeRates || {}) : {},
            exchangeRatesAvailable: ratesStillValid && parsed.exchangeRatesAvailable,
            exchangeRatesLastUpdate: ratesStillValid ? parsed.exchangeRatesLastUpdate : null,
          });
        }

        // Validate wallets
        await this.validateWallets();

        // Load exchange rates
        await this.loadExchangeRates();

        // Auto-connect to active wallet
        if (this.activeWalletId) {
          await this.connectWallet(this.activeWalletId).catch((err) => {
            console.warn('Auto-connect failed:', err.message);
          });
        }
      } catch (error) {
        console.error('Wallet store initialization error:', error);
        this.lastError = error.message;
      }
    },

    /**
     * Add a new wallet connection
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
        // Handle "null" string as no address
        const lud16 = (lud16Raw && lud16Raw !== 'null') ? lud16Raw : null;
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
            console.log('✅ NWC connection successful');
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

        // Disconnect and cleanup NWC instance
        await this.disconnectWallet(walletId);

        // Remove from state
        this.wallets.splice(walletIndex, 1);
        delete this.connectionStates[walletId];
        delete this.balances[walletId];
        delete this.walletInfos[walletId];

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

        // Ensure connected
        if (!this.connectionStates[walletId]?.connected) {
          await this.connectWallet(walletId);
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
     * @returns {Promise<Object>} The NWC instance
     */
    async connectWallet(walletId) {
      const wallet = this.wallets.find((w) => w.id === walletId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

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
      const state = this.connectionStates[walletId];
      if (state) {
        // Close NWC connection if exists
        if (state.nwcInstance && typeof state.nwcInstance.close === 'function') {
          try {
            state.nwcInstance.close();
          } catch (e) {
            console.warn('Error closing NWC connection:', e);
          }
        }

        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: state.lastConnected,
          nwcInstance: null,
          error: null,
        };
      }
    },

    /**
     * Refresh wallet balance and info
     * @param {string} walletId - The wallet ID to refresh
     */
    async refreshWalletData(walletId) {
      try {
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

        // Update last used
        const wallet = this.wallets.find((w) => w.id === walletId);
        if (wallet) {
          wallet.lastUsed = Date.now();
        }

        await this.persistState();
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
      return this.connectionStates[this.activeWalletId]?.nwcInstance || null;
    },

    /**
     * Get NWC instance for a specific wallet
     * @param {string} walletId - The wallet ID
     * @returns {Object|null} The NWC instance or null
     */
    getNWC(walletId) {
      return this.connectionStates[walletId]?.nwcInstance || null;
    },

    /**
     * Validate all wallets and remove invalid ones
     */
    async validateWallets() {
      this.wallets = this.wallets.filter((wallet) => {
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

      await this.persistState();
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
          exchangeRates: this.exchangeRates,
          exchangeRatesAvailable: this.exchangeRatesAvailable,
          exchangeRatesLastUpdate: this.exchangeRatesLastUpdate,
        };
        localStorage.setItem(STORAGE_KEYS.WALLET_STORE, JSON.stringify(stateToSave));

        // Maintain backward compatibility
        const legacyState = {
          balance: this.activeBalance,
          connectedWallets: this.wallets.map((w) => ({
            id: w.id,
            name: w.name,
            type: 'nwc',
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

      this.$reset();
      localStorage.removeItem(STORAGE_KEYS.WALLET_STORE);
      localStorage.removeItem(STORAGE_KEYS.LEGACY_STATE);
    },
  },
});
