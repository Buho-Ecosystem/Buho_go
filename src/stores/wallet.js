import { defineStore } from 'pinia'
import { webln } from "@getalby/sdk"
import { fiatRatesService } from '../utils/fiatRates.js'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    // Wallet connections
    wallets: [],
    activeWalletId: null,

    // Connection states
    connectionStates: {},

    // Balances and info
    balances: {},
    walletInfos: {},

    // UI preferences
    preferredFiatCurrency: 'USD',
    denominationCurrency: 'sats',

    // Exchange rates (will be populated from fiatRatesService)
    exchangeRates: {},

    // Loading states
    isLoading: false,
    isConnecting: false,

    // Error handling
    lastError: null
  }),

  getters: {
    activeWallet: (state) => {
      return state.wallets.find(wallet => wallet.id === state.activeWalletId)
    },

    activeBalance: (state) => {
      return state.balances[state.activeWalletId] || 0
    },

    totalBalance: (state) => {
      return Object.values(state.balances).reduce((sum, balance) => sum + balance, 0)
    },

    connectedWallets: (state) => {
      return state.wallets.filter(wallet => state.connectionStates[wallet.id]?.connected)
    },

    defaultWallet: (state) => {
      return state.wallets.find(wallet => wallet.isDefault)
    },

    sortedWallets: (state) => {
      return [...state.wallets].sort((a, b) => {
        // Active wallet first
        if (a.id === state.activeWalletId) return -1
        if (b.id === state.activeWalletId) return 1

        // Default wallet second
        if (a.isDefault) return -1
        if (b.isDefault) return 1

        // Then by last used
        return (b.lastUsed || 0) - (a.lastUsed || 0)
      })
    }
  },

  actions: {
    // Initialize store from localStorage
    async initialize() {
      try {
        const savedState = localStorage.getItem('buhoGO_wallet_store')
        if (savedState) {
          try {
            const parsed = JSON.parse(savedState)
            this.$patch(parsed)
          } catch (parseError) {
            console.warn('Failed to parse saved state, clearing:', parseError)
            localStorage.removeItem('buhoGO_wallet_store')
          }
        }

        // Validate and clean up any invalid wallets
        await this.validateWallets()

        // Load exchange rates from fiat rates service
        await this.loadExchangeRates()

        // Auto-connect to active wallet if exists
        if (this.activeWalletId) {
          try {
            await this.connectWallet(this.activeWalletId)
          } catch (connectError) {
            console.warn('Failed to auto-connect wallet:', connectError)
            // Don't throw, just log the error
          }
        }
      } catch (error) {
        console.error('Error initializing wallet store:', error)
        this.lastError = error.message
      }
    },

    // Add a new wallet
    async addWallet(walletData) {
      try {
        this.isConnecting = true
        this.lastError = null

        // Test connection first
        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: walletData.nwcUrl,
        })

        await nwc.enable()
        const info = await nwc.getInfo()
        const balance = await nwc.getBalance()

        // Create wallet object
        const wallet = {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: walletData.name,
          nwcUrl: walletData.nwcUrl,
          isActive: false,
          isDefault: this.wallets.length === 0, // First wallet becomes default
          createdAt: Date.now(),
          lastUsed: Date.now(),
          metadata: {
            alias: info.alias || 'Unknown',
            pubkey: info.pubkey || '',
            network: info.network || 'mainnet'
          }
        }

        // Add to wallets array
        this.wallets.push(wallet)

        // Set connection state
        this.connectionStates[wallet.id] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc
        }

        // Store balance and info
        this.balances[wallet.id] = balance.balance
        this.walletInfos[wallet.id] = info

        // Set as active if it's the first wallet
        if (this.wallets.length === 1) {
          this.activeWalletId = wallet.id
          wallet.isActive = true
        }

        await this.persistState()
        return wallet
      } catch (error) {
        this.lastError = error.message
        throw error
      } finally {
        this.isConnecting = false
      }
    },

    // Remove a wallet
    async removeWallet(walletId) {
      try {
        const walletIndex = this.wallets.findIndex(w => w.id === walletId)
        if (walletIndex === -1) return

        const wallet = this.wallets[walletIndex]

        // Disconnect if connected
        if (this.connectionStates[walletId]?.connected) {
          await this.disconnectWallet(walletId)
        }

        // Remove from arrays
        this.wallets.splice(walletIndex, 1)
        delete this.connectionStates[walletId]
        delete this.balances[walletId]
        delete this.walletInfos[walletId]

        // Handle active wallet removal
        if (this.activeWalletId === walletId) {
          if (this.wallets.length > 0) {
            // Switch to default wallet or first available
            const newActive = this.defaultWallet || this.wallets[0]
            await this.switchActiveWallet(newActive.id)
          } else {
            this.activeWalletId = null
          }
        }

        // Handle default wallet removal
        if (wallet.isDefault && this.wallets.length > 0) {
          this.wallets[0].isDefault = true
        }

        await this.persistState()
      } catch (error) {
        this.lastError = error.message
        throw error
      }
    },

    // Switch active wallet
    async switchActiveWallet(walletId) {
      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (!wallet) throw new Error('Wallet not found')

        // Update active states
        this.wallets.forEach(w => w.isActive = false)
        wallet.isActive = true
        wallet.lastUsed = Date.now()

        this.activeWalletId = walletId

        // Ensure wallet is connected
        if (!this.connectionStates[walletId]?.connected) {
          await this.connectWallet(walletId)
        }

        await this.persistState()
      } catch (error) {
        this.lastError = error.message
        throw error
      }
    },

    // Connect to a specific wallet
    async connectWallet(walletId) {
      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (!wallet) throw new Error('Wallet not found')

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: wallet.nwcUrl,
        })

        await nwc.enable()

        // Update connection state
        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc
        }

        // Refresh balance and info
        await this.refreshWalletData(walletId)

        return nwc
      } catch (error) {
        this.connectionStates[walletId] = {
          connected: false,
          lastConnected: Date.now(),
          error: error.message
        }
        throw error
      }
    },

    // Disconnect from a specific wallet
    async disconnectWallet(walletId) {
      if (this.connectionStates[walletId]) {
        this.connectionStates[walletId].connected = false
        delete this.connectionStates[walletId].nwcInstance
      }
    },

    // Refresh wallet data (balance, info)
    async refreshWalletData(walletId) {
      try {
        const connectionState = this.connectionStates[walletId]
        if (!connectionState?.connected || !connectionState.nwcInstance) {
          await this.connectWallet(walletId)
        }

        const nwc = this.connectionStates[walletId].nwcInstance

        // Fetch balance and info in parallel
        const [balance, info] = await Promise.all([
          nwc.getBalance(),
          nwc.getInfo()
        ])

        this.balances[walletId] = balance.balance
        this.walletInfos[walletId] = info

        // Update last used timestamp
        const wallet = this.wallets.find(w => w.id === walletId)
        if (wallet) {
          wallet.lastUsed = Date.now()
        }

        await this.persistState()
      } catch (error) {
        console.error(`Error refreshing wallet ${walletId}:`, error)
        this.connectionStates[walletId] = {
          ...this.connectionStates[walletId],
          connected: false,
          error: error.message
        }
      }
    },

    // Refresh all connected wallets
    async refreshAllWallets() {
      this.isLoading = true
      try {
        const refreshPromises = this.wallets.map(wallet =>
          this.refreshWalletData(wallet.id).catch(error => {
            console.error(`Failed to refresh wallet ${wallet.id}:`, error)
          })
        )

        await Promise.allSettled(refreshPromises)
      } finally {
        this.isLoading = false
      }
    },

    // Update wallet name
    async updateWalletName(walletId, newName) {
      const wallet = this.wallets.find(w => w.id === walletId)
      if (wallet) {
        wallet.name = newName
        wallet.lastUsed = Date.now()
        await this.persistState()
      }
    },

    // Set default wallet
    async setDefaultWallet(walletId) {
      this.wallets.forEach(w => w.isDefault = false)
      const wallet = this.wallets.find(w => w.id === walletId)
      if (wallet) {
        wallet.isDefault = true
        await this.persistState()
      }
    },

    // Get NWC instance for active wallet
    getActiveNWC() {
      if (!this.activeWalletId) return null
      return this.connectionStates[this.activeWalletId]?.nwcInstance || null
    },

    // Get NWC instance for specific wallet
    getNWC(walletId) {
      return this.connectionStates[walletId]?.nwcInstance || null
    },

    // Validate all wallets (remove invalid ones)
    async validateWallets() {
      const validWallets = []

      for (const wallet of this.wallets) {
        try {
          // Quick validation of NWC URL format
          if (wallet.nwcUrl && wallet.nwcUrl.startsWith('nostr+walletconnect://')) {
            validWallets.push(wallet)
          }
        } catch (error) {
          console.warn(`Removing invalid wallet ${wallet.id}:`, error)
        }
      }

      this.wallets = validWallets

      // Ensure active wallet is still valid
      if (this.activeWalletId && !this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets.length > 0 ? this.wallets[0].id : null
      }
    },

    // Disconnect all wallets
    async disconnectAll() {
      for (const walletId of Object.keys(this.connectionStates)) {
        await this.disconnectWallet(walletId)
      }

      this.wallets = []
      this.activeWalletId = null
      this.connectionStates = {}
      this.balances = {}
      this.walletInfos = {}

      await this.persistState()
    },

    // Load exchange rates from fiat rates service
    async loadExchangeRates() {
      try {
        const rates = await fiatRatesService.getRates()
        // Convert to lowercase keys to match existing format
        this.exchangeRates = {
          usd: rates.USD || 0,
          eur: rates.EUR || 0,
          gbp: rates.GBP || 0,
          jpy: rates.JPY || 0,
          chf: rates.CHF || 0,
        }
        await this.persistState()
      } catch (error) {
        console.error('Error loading exchange rates:', error)
        // Keep existing rates or use fallback
        if (Object.keys(this.exchangeRates).length === 0) {
          this.exchangeRates = {
            usd: 65000,
            eur: 60000,
            gbp: 52000,
            jpy: 9800000,
            chf: 62000
          }
        }
      }
    },

    // Update exchange rates
    updateExchangeRates(rates) {
      this.exchangeRates = { ...this.exchangeRates, ...rates }
      this.persistState()
    },

    // Update currency preferences
    updateCurrencyPreferences(fiatCurrency, denominationCurrency) {
      this.preferredFiatCurrency = fiatCurrency
      this.denominationCurrency = denominationCurrency
      this.persistState()
    },

    // Persist state to localStorage
    async persistState() {
      try {
        const stateToSave = {
          wallets: this.wallets,
          activeWalletId: this.activeWalletId,
          preferredFiatCurrency: this.preferredFiatCurrency,
          denominationCurrency: this.denominationCurrency,
          exchangeRates: this.exchangeRates
        }

        localStorage.setItem('buhoGO_wallet_store', JSON.stringify(stateToSave))

        // Also maintain backward compatibility with old format
        const legacyState = {
          balance: this.activeBalance,
          connectedWallets: this.wallets.map(w => ({
            id: w.id,
            name: w.name,
            type: 'nwc',
            nwcString: w.nwcUrl,
            balance: this.balances[w.id] || 0
          })),
          activeWalletId: this.activeWalletId,
          currency: this.denominationCurrency,
          currencies: ['sats', 'btc', 'usd'],
          exchangeRates: this.exchangeRates,
          preferredFiatCurrency: this.preferredFiatCurrency,
          denominationCurrency: this.denominationCurrency
        }

        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(legacyState))
      } catch (error) {
        console.error('Error persisting wallet state:', error)
      }
    },

    // Clear all data
    clearAll() {
      this.$reset()
      localStorage.removeItem('buhoGO_wallet_store')
      localStorage.removeItem('buhoGO_wallet_state')
    }
  }
})
