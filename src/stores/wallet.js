import { defineStore } from 'pinia'
import { NostrWebLNProvider } from "@getalby/sdk/webln"
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

    // Exchange rates
    exchangeRates: {},

    // Loading states
    isLoading: false,
    isConnecting: false,

    // Error handling
    lastError: null,

    // Notification subscriptions
    notificationSubscriptions: {}
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
        if (a.id === state.activeWalletId) return -1
        if (b.id === state.activeWalletId) return 1
        if (a.isDefault) return -1
        if (b.isDefault) return 1
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
          const parsed = JSON.parse(savedState)
          this.$patch(parsed)
        }

        await this.validateWallets()
        await this.loadExchangeRates()

        if (this.activeWalletId) {
          await this.connectWallet(this.activeWalletId)
        }
      } catch (error) {
        console.error('Error initializing wallet store:', error)
        this.lastError = error.message
      }
    },

    // Add a new wallet with enhanced connection testing
    async addWallet(walletData) {
      try {
        this.isConnecting = true
        this.lastError = null

        // Create NostrWebLNProvider instance
        const nwc = new NostrWebLNProvider({
          nostrWalletConnectUrl: walletData.nwcUrl,
        })

        // Test connection
        await nwc.enable()

        // Get wallet info and balance in parallel
        const [info, balance] = await Promise.all([
          nwc.getInfo(),
          nwc.getBalance()
        ])

        // Create wallet object
        const wallet = {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: walletData.name,
          nwcUrl: walletData.nwcUrl,
          isActive: false,
          isDefault: this.wallets.length === 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          metadata: {
            alias: info.node?.alias || info.alias || 'Unknown',
            pubkey: info.node?.pubkey || info.pubkey || '',
            network: info.network || 'mainnet',
            methods: info.methods || [],
            supports: info.supports || []
          }
        }

        this.wallets.push(wallet)

        // Set connection state with enhanced info
        this.connectionStates[wallet.id] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc,
          capabilities: info.methods || []
        }

        this.balances[wallet.id] = balance.balance
        this.walletInfos[wallet.id] = info

        if (this.wallets.length === 1) {
          this.activeWalletId = wallet.id
          wallet.isActive = true
        }

        // Set up payment notifications if supported
        await this.setupNotifications(wallet.id)

        await this.persistState()
        return wallet

      } catch (error) {
        this.lastError = error.message
        throw error
      } finally {
        this.isConnecting = false
      }
    },

    // Enhanced connection with better error handling
    async connectWallet(walletId) {
      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (!wallet) throw new Error('Wallet not found')

        const nwc = new NostrWebLNProvider({
          nostrWalletConnectUrl: wallet.nwcUrl,
        })

        await nwc.enable()

        // Test connection with getInfo
        const info = await nwc.getInfo()

        this.connectionStates[walletId] = {
          connected: true,
          lastConnected: Date.now(),
          nwcInstance: nwc,
          capabilities: info.methods || []
        }

        // Set up notifications
        await this.setupNotifications(walletId)

        // Refresh wallet data
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

    // New: Set up payment notifications
    async setupNotifications(walletId) {
      try {
        const nwcInstance = this.connectionStates[walletId]?.nwcInstance
        if (!nwcInstance) return

        // Check if wallet supports notifications
        const info = await nwcInstance.getInfo()
        if (!info.methods?.includes('notifications')) return

        // Subscribe to payment notifications
        const unsubscribe = await nwcInstance.subscribeNotifications(
          (notification) => {
            this.handleNotification(walletId, notification)
          },
          ['payment_received', 'payment_sent']
        )

        this.notificationSubscriptions[walletId] = unsubscribe

      } catch (error) {
        console.warn(`Could not set up notifications for wallet ${walletId}:`, error)
      }
    },

    // New: Handle incoming notifications
    handleNotification(walletId, notification) {
      console.log(`Notification for wallet ${walletId}:`, notification)

      // Update balance when payment is received/sent
      if (notification.notification_type === 'payment_received' ||
          notification.notification_type === 'payment_sent') {
        // Refresh wallet data to get updated balance
        this.refreshWalletData(walletId)
      }
    },

    // Enhanced disconnect with notification cleanup
    async disconnectWallet(walletId) {
      // Clean up notification subscription
      if (this.notificationSubscriptions[walletId]) {
        try {
          this.notificationSubscriptions[walletId]()
          delete this.notificationSubscriptions[walletId]
        } catch (error) {
          console.warn(`Error cleaning up notifications for wallet ${walletId}:`, error)
        }
      }

      // Close WebLN connection
      if (this.connectionStates[walletId]?.nwcInstance) {
        try {
          this.connectionStates[walletId].nwcInstance.close()
        } catch (error) {
          console.warn(`Error closing WebLN connection for wallet ${walletId}:`, error)
        }
      }

      if (this.connectionStates[walletId]) {
        this.connectionStates[walletId].connected = false
        delete this.connectionStates[walletId].nwcInstance
      }
    },

    // Enhanced wallet data refresh
    async refreshWalletData(walletId) {
      try {
        const connectionState = this.connectionStates[walletId]
        if (!connectionState?.connected || !connectionState.nwcInstance) {
          await this.connectWallet(walletId)
        }

        const nwc = this.connectionStates[walletId].nwcInstance

        // Fetch balance and info in parallel with timeout
        const [balance, info] = await Promise.all([
          Promise.race([
            nwc.getBalance(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Balance fetch timeout')), 10000)
            )
          ]),
          Promise.race([
            nwc.getInfo(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Info fetch timeout')), 10000)
            )
          ])
        ])

        this.balances[walletId] = balance.balance
        this.walletInfos[walletId] = info

        const wallet = this.wallets.find(w => w.id === walletId)
        if (wallet) {
          wallet.lastUsed = Date.now()
          // Update metadata with latest info
          wallet.metadata = {
            ...wallet.metadata,
            alias: info.node?.alias || info.alias || wallet.metadata.alias,
            methods: info.methods || []
          }
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

    // Enhanced remove wallet with cleanup
    async removeWallet(walletId) {
      try {
        const walletIndex = this.wallets.findIndex(w => w.id === walletId)
        if (walletIndex === -1) return

        const wallet = this.wallets[walletIndex]

        // Disconnect and cleanup
        await this.disconnectWallet(walletId)

        // Remove from arrays
        this.wallets.splice(walletIndex, 1)
        delete this.connectionStates[walletId]
        delete this.balances[walletId]
        delete this.walletInfos[walletId]

        // Handle active wallet removal
        if (this.activeWalletId === walletId) {
          if (this.wallets.length > 0) {
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

    // New: Create wallet from authorization URL (for easier setup)
    async addWalletFromAuth(authUrl, walletName) {
      try {
        this.isConnecting = true

        const nwc = await NostrWebLNProvider.fromAuthorizationUrl(authUrl, {
          name: walletName || `Wallet ${this.wallets.length + 1}`
        })

        await nwc.enable()
        const [info, balance] = await Promise.all([
          nwc.getInfo(),
          nwc.getBalance()
        ])

        return this.addWallet({
          name: walletName || info.node?.alias || `Wallet ${this.wallets.length + 1}`,
          nwcUrl: nwc.getNostrWalletConnectUrl()
        })

      } catch (error) {
        this.lastError = error.message
        throw error
      } finally {
        this.isConnecting = false
      }
    },

    // Enhanced validation with better NWC URL checking
    async validateWallets() {
      const validWallets = []

      for (const wallet of this.wallets) {
        try {
          // More robust NWC URL validation
          if (wallet.nwcUrl &&
              (wallet.nwcUrl.startsWith('nostr+walletconnect://') ||
               wallet.nwcUrl.startsWith('nostrwalletconnect://'))) {
            validWallets.push(wallet)
          }
        } catch (error) {
          console.warn(`Removing invalid wallet ${wallet.id}:`, error)
        }
      }

      this.wallets = validWallets

      if (this.activeWalletId && !this.wallets.find(w => w.id === this.activeWalletId)) {
        this.activeWalletId = this.wallets.length > 0 ? this.wallets[0].id : null
      }
    },

    // Enhanced disconnect all with proper cleanup
    async disconnectAll() {
      // Clean up all notification subscriptions
      for (const walletId of Object.keys(this.notificationSubscriptions)) {
        try {
          this.notificationSubscriptions[walletId]()
        } catch (error) {
          console.warn(`Error cleaning up notifications for wallet ${walletId}:`, error)
        }
      }
      this.notificationSubscriptions = {}

      // Disconnect all wallets
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

    // Rest of the methods remain the same...
    async switchActiveWallet(walletId) {
      try {
        const wallet = this.wallets.find(w => w.id === walletId)
        if (!wallet) throw new Error('Wallet not found')

        this.wallets.forEach(w => w.isActive = false)
        wallet.isActive = true
        wallet.lastUsed = Date.now()
        this.activeWalletId = walletId

        if (!this.connectionStates[walletId]?.connected) {
          await this.connectWallet(walletId)
        }

        await this.persistState()
      } catch (error) {
        this.lastError = error.message
        throw error
      }
    },

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

    async updateWalletName(walletId, newName) {
      const wallet = this.wallets.find(w => w.id === walletId)
      if (wallet) {
        wallet.name = newName
        wallet.lastUsed = Date.now()
        await this.persistState()
      }
    },

    async setDefaultWallet(walletId) {
      this.wallets.forEach(w => w.isDefault = false)
      const wallet = this.wallets.find(w => w.id === walletId)
      if (wallet) {
        wallet.isDefault = true
        await this.persistState()
      }
    },

    getActiveNWC() {
      if (!this.activeWalletId) return null
      return this.connectionStates[this.activeWalletId]?.nwcInstance || null
    },

    getNWC(walletId) {
      return this.connectionStates[walletId]?.nwcInstance || null
    },

    async loadExchangeRates() {
      try {
        const rates = await fiatRatesService.getRates()
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

    updateExchangeRates(rates) {
      this.exchangeRates = { ...this.exchangeRates, ...rates }
      this.persistState()
    },

    updateCurrencyPreferences(fiatCurrency, denominationCurrency) {
      this.preferredFiatCurrency = fiatCurrency
      this.denominationCurrency = denominationCurrency
      this.persistState()
    },

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

        // Maintain backward compatibility
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

    clearAll() {
      this.$reset()
      localStorage.removeItem('buhoGO_wallet_store')
      localStorage.removeItem('buhoGO_wallet_state')
    }
  }
})
