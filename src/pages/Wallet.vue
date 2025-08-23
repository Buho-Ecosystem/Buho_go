<template>
  <!-- Loading Screen -->
  <LoadingScreen 
    :show="showLoadingScreen" 
    :loading-text="loadingText"
  />
  
  <q-page class="wallet-page">
    <!-- Header -->
    <div class="wallet-header">
      <div class="header-top">
        <!-- Wallet Switcher -->
        <WalletSwitcher 
          @add-wallet="showAddWalletDialog = true"
          @manage-wallets="$router.push('/settings')"
        />
        
        <!-- Settings Button -->
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-cog" 
          @click="$router.push('/settings')"
          class="settings-btn"
        />
      </div>

      <!-- Balance Display -->
      <div class="balance-section">
        <div class="balance-container" @click="toggleCurrency">
          <div class="balance-amount">{{ formattedBalance }}</div>
          <div class="balance-currency">{{ currentCurrencyLabel }}</div>
          <q-icon name="las la-redo-alt" class="currency-toggle-icon"/>
        </div>
        
        <div class="balance-fiat" v-if="currentCurrency === 'sats' || currentCurrency === 'btc'">
          {{ fiatBalance }}
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions">
      <q-btn
        class="action-btn send-btn"
        @click="showSendModal = true"
        no-caps
        unelevated
      >
        <q-icon name="las la-arrow-up" class="action-icon"/>
        <span class="action-label">Send</span>
      </q-btn>

      <q-btn
        class="action-btn receive-btn"
        @click="showReceiveModal = true"
        no-caps
        unelevated
      >
        <q-icon name="las la-arrow-down" class="action-icon"/>
        <span class="action-label">Receive</span>
      </q-btn>
    </div>

    <!-- Recent Transactions -->
    <div class="recent-section">
      <div class="section-header">
        <div class="section-title">Recent Activity</div>
        <q-btn 
          flat 
          dense 
          color="primary" 
          label="View All" 
          @click="$router.push('/transactions')"
          class="view-all-btn"
        />
      </div>

      <!-- Transaction List -->
      <div class="transaction-list" v-if="recentTransactions.length > 0">
        <div 
          v-for="tx in recentTransactions" 
          :key="tx.id"
          class="transaction-item"
          @click="$router.push(`/transaction/${tx.id}`)"
        >
          <div class="transaction-icon">
            <div class="tx-icon-container" :class="getTransactionIconClass(tx)">
              <q-icon :name="getTransactionIcon(tx)" size="16px"/>
            </div>
          </div>

          <div class="transaction-details">
            <div class="transaction-type">{{ getTransactionTypeText(tx) }}</div>
            <div class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</div>
          </div>

          <div class="transaction-amount">
            <div class="amount-sats" :class="getAmountClass(tx)">
              {{ getFormattedAmount(tx) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-transactions">
        <q-icon name="las la-receipt" size="3rem" color="grey-4"/>
        <div class="empty-title">No transactions yet</div>
        <div class="empty-subtitle">Your transaction history will appear here</div>
      </div>
    </div>

    <!-- Modals -->
    <SendModal 
      v-model="showSendModal" 
      @payment-detected="handlePaymentDetected"
    />
    
    <ReceiveModal 
      v-model="showReceiveModal"
      @invoice-created="handleInvoiceCreated"
    />

    <!-- Add Wallet Dialog -->
    <q-dialog v-model="showAddWalletDialog" class="add-wallet-dialog">
      <q-card class="add-wallet-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Add New Wallet</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <q-input
            v-model="newWalletName"
            outlined
            label="Wallet Name"
            placeholder="Enter a name for your wallet"
            class="wallet-name-input"
            :rules="[val => !!val || 'Wallet name is required']"
          />
          
          <q-input
            v-model="newWalletNwc"
            outlined
            label="NWC Connection String"
            placeholder="nostr+walletconnect://..."
            class="nwc-input"
            :rules="[validateNwcString]"
          />
          
          <div class="input-help">
            <q-icon name="las la-info-circle" class="help-icon"/>
            <span>Get your NWC string from your Lightning wallet's settings</span>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="dialog-actions">
          <q-btn flat label="Cancel" v-close-popup/>
          <q-btn 
            flat 
            label="Add Wallet" 
            color="primary" 
            @click="addNewWallet"
            :loading="isAddingWallet"
            :disable="!isValidNewWallet"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Payment Confirmation Dialog -->
    <q-dialog v-model="showPaymentDialog" class="payment-dialog">
      <q-card class="payment-card">
        <q-card-section class="payment-header">
          <div class="payment-title">Confirm Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="payment-content" v-if="paymentData">
          <div class="payment-details">
            <div class="payment-amount">
              <div class="amount-display">{{ getPaymentAmountDisplay() }}</div>
              <div class="amount-fiat">{{ getPaymentFiatDisplay() }}</div>
            </div>
            
            <div class="payment-info">
              <div class="info-item">
                <div class="info-label">To</div>
                <div class="info-value">{{ getPaymentDestination() }}</div>
              </div>
              
              <div class="info-item" v-if="paymentData.description">
                <div class="info-label">Description</div>
                <div class="info-value">{{ paymentData.description }}</div>
              </div>
              
              <div class="info-item" v-if="paymentData.type !== 'lightning_invoice'">
                <div class="info-label">Amount</div>
                <div class="amount-input-container">
                  <q-input
                    v-model="paymentAmount"
                    type="number"
                    outlined
                    dense
                    suffix="sats"
                    :min="getMinAmount()"
                    :max="getMaxAmount()"
                    class="amount-input"
                  />
                </div>
              </div>
              
              <div class="info-item" v-if="paymentData.commentAllowed > 0">
                <div class="info-label">Comment (optional)</div>
                <q-input
                  v-model="paymentComment"
                  outlined
                  dense
                  :maxlength="paymentData.commentAllowed"
                  placeholder="Add a comment..."
                  class="comment-input"
                />
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="payment-actions">
          <q-btn flat label="Cancel" v-close-popup/>
          <q-btn 
            flat 
            label="Send Payment" 
            color="primary" 
            @click="confirmPayment"
            :loading="isSendingPayment"
            :disable="!isValidPayment"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { useWalletStore } from '../stores/wallet'
import { mapState, mapActions } from 'pinia'
import WalletSwitcher from '../components/WalletSwitcher.vue'
import SendModal from '../components/SendModal.vue'
import ReceiveModal from '../components/ReceiveModal.vue'
import LoadingScreen from '../components/LoadingScreen.vue'
import LightningPaymentService from '../utils/lightning.js'

export default {
  name: 'WalletPage',
  components: {
    WalletSwitcher,
    SendModal,
    ReceiveModal,
    LoadingScreen
  },
  data() {
    return {
      currentCurrency: 'sats',
      showSendModal: false,
      showReceiveModal: false,
      showAddWalletDialog: false,
      showPaymentDialog: false,
      
      // New wallet form
      newWalletName: '',
      newWalletNwc: '',
      isAddingWallet: false,
      
      // Payment flow
      paymentData: null,
      paymentAmount: '',
      paymentComment: '',
      isSendingPayment: false,
      
      // Recent transactions
      recentTransactions: [],
      
      // Loading states
      showLoadingScreen: true,
      loadingText: 'Loading wallet...'
    }
  },
  computed: {
    ...mapState(useWalletStore, [
      'wallets',
      'activeWallet',
      'activeBalance',
      'balances',
      'connectionStates',
      'preferredFiatCurrency',
      'denominationCurrency',
      'exchangeRates',
      'isLoading'
    ]),

    formattedBalance() {
      return this.formatBalance(this.activeBalance, this.currentCurrency)
    },

    currentCurrencyLabel() {
      switch (this.currentCurrency) {
        case 'sats': return 'sats'
        case 'btc': return 'BTC'
        case 'usd': return 'USD'
        case 'eur': return 'EUR'
        case 'gbp': return 'GBP'
        case 'jpy': return 'JPY'
        default: return this.currentCurrency.toUpperCase()
      }
    },

    fiatBalance() {
      if (this.currentCurrency !== 'sats' && this.currentCurrency !== 'btc') return ''
      
      const btcAmount = this.activeBalance / 100000000
      const currency = this.preferredFiatCurrency
      const rate = this.exchangeRates[currency.toLowerCase()] || 65000
      const fiatValue = btcAmount * rate
      
      const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
      const symbol = symbols[currency] || currency
      
      return `${symbol}${fiatValue.toFixed(2)}`
    },

    isValidNewWallet() {
      return this.newWalletName.trim() && 
             this.newWalletNwc.trim() && 
             this.validateNwcString(this.newWalletNwc) === true
    },

    isValidPayment() {
      if (!this.paymentData) return false
      if (this.paymentData.type === 'lightning_invoice') return true
      return this.paymentAmount && parseFloat(this.paymentAmount) > 0
    }
  },
  async created() {
    await this.initializeWallet()
  },
  methods: {
    ...mapActions(useWalletStore, [
      'initialize',
      'addWallet',
      'switchActiveWallet',
      'refreshAllWallets',
      'getActiveNWC'
    ]),

    async initializeWallet() {
      try {
        this.loadingText = 'Initializing wallet store...'
        await this.initialize()
        
        if (!this.activeWallet) {
          this.loadingText = 'No wallet found...'
          await new Promise(resolve => setTimeout(resolve, 1000))
          this.$router.push('/')
          return
        }
        
        this.loadingText = 'Loading recent transactions...'
        await this.loadRecentTransactions()
        
        this.loadingText = 'Ready!'
        await new Promise(resolve => setTimeout(resolve, 500))
        this.showLoadingScreen = false
      } catch (error) {
        console.error('Error initializing wallet:', error)
        this.showLoadingScreen = false
        this.$q.notify({
          type: 'negative',
          message: 'Failed to initialize wallet',
          position: 'top'
        })
      }
    },

    async loadRecentTransactions() {
      try {
        const nwc = this.getActiveNWC()
        if (!nwc) return

        const response = await nwc.listTransactions({ limit: 5 })
        if (response?.transactions) {
          this.recentTransactions = response.transactions.map(tx => ({
            ...tx,
            id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
            type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
            description: tx.description || tx.memo || '',
            settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
          }))
        }
      } catch (error) {
        console.error('Error loading recent transactions:', error)
      }
    },

    toggleCurrency() {
      const currencies = ['sats', 'btc', this.preferredFiatCurrency.toLowerCase()]
      const currentIndex = currencies.indexOf(this.currentCurrency)
      const nextIndex = (currentIndex + 1) % currencies.length
      this.currentCurrency = currencies[nextIndex]
    },

    formatBalance(balance, currency = null) {
      const curr = currency || this.denominationCurrency
      
      switch (curr) {
        case 'btc':
          return (balance / 100000000).toFixed(8)
        case 'usd':
        case 'eur':
        case 'gbp':
        case 'jpy':
          const btcAmount = balance / 100000000
          const rate = this.exchangeRates[curr] || 65000
          const fiatValue = btcAmount * rate
          return fiatValue.toFixed(2)
        case 'sats':
        default:
          return balance.toLocaleString()
      }
    },

    validateNwcString(nwcString) {
      if (!nwcString || !nwcString.trim()) {
        return 'NWC string is required'
      }
      
      if (!nwcString.startsWith('nostr+walletconnect://')) {
        return 'Invalid NWC format. Must start with nostr+walletconnect://'
      }
      
      return true
    },

    async addNewWallet() {
      if (!this.isValidNewWallet) return

      this.isAddingWallet = true
      try {
        await this.addWallet({
          name: this.newWalletName.trim(),
          nwcUrl: this.newWalletNwc.trim()
        })

        this.showAddWalletDialog = false
        this.newWalletName = ''
        this.newWalletNwc = ''

        this.$q.notify({
          type: 'positive',
          message: 'Wallet added successfully!',
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: 'Failed to add wallet: ' + error.message,
          position: 'top'
        })
      } finally {
        this.isAddingWallet = false
      }
    },

    async handlePaymentDetected(payment) {
      try {
        const nwc = this.getActiveNWC()
        if (!nwc) {
          throw new Error('No active wallet connection')
        }

        const lightningService = new LightningPaymentService(this.activeWallet.nwcUrl)
        this.paymentData = await lightningService.processPaymentInput(payment.data)
        
        // For invoices, show confirmation immediately
        if (this.paymentData.type === 'lightning_invoice') {
          this.showPaymentDialog = true
        } else {
          // For LNURL/Lightning Address, need amount input
          this.paymentAmount = ''
          this.paymentComment = ''
          this.showPaymentDialog = true
        }
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: 'Invalid payment request: ' + error.message,
          position: 'top'
        })
      }
    },

    async confirmPayment() {
      if (!this.isValidPayment) return

      this.isSendingPayment = true
      try {
        const lightningService = new LightningPaymentService(this.activeWallet.nwcUrl)
        
        const amount = this.paymentData.type === 'lightning_invoice' 
          ? null 
          : parseInt(this.paymentAmount)
        
        const result = await lightningService.sendPayment(
          this.paymentData,
          amount,
          this.paymentComment || null
        )

        this.showPaymentDialog = false
        this.paymentData = null
        this.paymentAmount = ''
        this.paymentComment = ''

        // Refresh wallet data
        await this.refreshAllWallets()
        await this.loadRecentTransactions()

        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'top'
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: 'Payment failed: ' + error.message,
          position: 'top'
        })
      } finally {
        this.isSendingPayment = false
      }
    },

    async handleInvoiceCreated(invoice) {
      // Refresh wallet data after invoice creation
      await this.refreshAllWallets()
      await this.loadRecentTransactions()
    },

    getPaymentAmountDisplay() {
      if (this.paymentData.type === 'lightning_invoice') {
        return this.paymentData.amount 
          ? this.paymentData.amount.toLocaleString() + ' sats'
          : 'Variable amount'
      }
      
      return this.paymentAmount 
        ? parseInt(this.paymentAmount).toLocaleString() + ' sats'
        : '0 sats'
    },

    getPaymentFiatDisplay() {
      const amount = this.paymentData.type === 'lightning_invoice' 
        ? this.paymentData.amount 
        : parseInt(this.paymentAmount) || 0
      
      if (!amount) return ''
      
      const btcAmount = amount / 100000000
      const rate = this.exchangeRates[this.preferredFiatCurrency.toLowerCase()] || 65000
      const fiatValue = btcAmount * rate
      
      const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
      const symbol = symbols[this.preferredFiatCurrency] || this.preferredFiatCurrency
      
      return `${symbol}${fiatValue.toFixed(2)}`
    },

    getPaymentDestination() {
      switch (this.paymentData.type) {
        case 'lightning_address':
          return this.paymentData.address
        case 'lightning_invoice':
          return 'Lightning Invoice'
        case 'lnurl_pay':
          return 'LNURL Payment'
        default:
          return 'Unknown'
      }
    },

    getMinAmount() {
      return this.paymentData.minSendable ? Math.floor(this.paymentData.minSendable / 1000) : 1
    },

    getMaxAmount() {
      return this.paymentData.maxSendable ? Math.floor(this.paymentData.maxSendable / 1000) : 100000000
    },

    // Transaction display methods
    getTransactionTypeText(tx) {
      return tx.type === 'incoming' ? 'Received' : 'Sent'
    },
    
    getTransactionIconClass(tx) {
      return tx.type === 'incoming' ? 'tx-icon-received' : 'tx-icon-sent'
    },
    
    getTransactionIcon(tx) {
      return tx.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up'
    },
    
    getAmountClass(tx) {
      return tx.type === 'incoming' ? 'amount-positive' : 'amount-negative'
    },
    
    getFormattedAmount(tx) {
      const prefix = tx.type === 'incoming' ? '+' : '-'
      return prefix + ' ' + Math.abs(tx.amount).toLocaleString()
    },

    formatTransactionTime(timestamp) {
      const date = new Date(timestamp * 1000)
      const now = new Date()
      const diffMs = now - date
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays < 7) return `${diffDays}d ago`
      
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }
}
</script>

<style scoped>
.wallet-page {
  background: #f8f9fa;
  min-height: 100vh;
}

/* Header */
.wallet-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.settings-btn {
  color: #6b7280;
  width: 40px;
  height: 40px;
}

.settings-btn:hover {
  color: #374151;
  background: #f3f4f6;
}

/* Balance Section */
.balance-section {
  text-align: center;
}

.balance-container {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.balance-container:hover {
  background: #f9fafb;
}

.balance-amount {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1;
}

.balance-currency {
  font-size: 1.125rem;
  color: #6b7280;
  font-weight: 500;
}

.currency-toggle-icon {
  color: #9ca3af;
  font-size: 16px;
  opacity: 0.7;
}

.balance-fiat {
  color: #6b7280;
  font-size: 1.125rem;
  margin-top: 0.5rem;
}

/* Quick Actions */
.quick-actions {
  display: flex;
  gap: 1rem;
  padding: 1rem;
}

.action-btn {
  flex: 1;
  height: 56px;
  border-radius: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.send-btn {
  background: #374151;
  color: white;
}

.send-btn:hover {
  background: #4b5563;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(55, 65, 81, 0.3);
}

.receive-btn {
  background: #059573;
  color: white;
}

.receive-btn:hover {
  background: #047857;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.3);
}

.action-icon {
  font-size: 18px;
}

.action-label {
  font-size: 1rem;
}

/* Recent Section */
.recent-section {
  background: white;
  margin: 1rem;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #f3f4f6;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

.view-all-btn {
  font-size: 0.875rem;
  font-weight: 500;
}

/* Transaction List */
.transaction-list {
  background: white;
}

.transaction-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #f9fafb;
}

.transaction-item:hover {
  background: #f9fafb;
}

.transaction-item:last-child {
  border-bottom: none;
}

.transaction-icon {
  margin-right: 0.75rem;
}

.tx-icon-container {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tx-icon-received {
  background: #059573;
}

.tx-icon-sent {
  background: #6b7280;
}

.transaction-details {
  flex: 1;
}

.transaction-type {
  font-weight: 500;
  color: #1f2937;
  font-size: 0.9375rem;
  margin-bottom: 0.125rem;
}

.transaction-time {
  color: #6b7280;
  font-size: 0.8125rem;
}

.transaction-amount {
  text-align: right;
}

.amount-sats {
  font-weight: 600;
  font-size: 0.9375rem;
}

.amount-positive {
  color: #059573;
}

.amount-negative {
  color: #dc2626;
}

/* Empty State */
.empty-transactions {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3rem 1rem;
  text-align: center;
}

.empty-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 1rem 0 0.5rem;
}

.empty-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
}

/* Dialog Styles */
.add-wallet-card,
.payment-card {
  width: 100%;
  max-width: 480px;
  border-radius: 16px;
}

.dialog-header,
.payment-header {
  background: #f8f9fa;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-title,
.payment-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

.close-btn {
  color: #6b7280;
}

.dialog-content,
.payment-content {
  padding: 1.5rem;
}

.wallet-name-input,
.nwc-input {
  margin-bottom: 1rem;
}

.input-help {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #6b7280;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.help-icon {
  color: #059573;
  font-size: 16px;
}

.dialog-actions,
.payment-actions {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
}

/* Payment Dialog */
.payment-details {
  text-align: center;
}

.payment-amount {
  margin-bottom: 1.5rem;
}

.amount-display {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.amount-fiat {
  color: #6b7280;
  font-size: 1rem;
}

.payment-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: left;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
}

.info-value {
  font-size: 1rem;
  color: #1f2937;
  word-break: break-all;
}

.amount-input-container {
  margin-top: 0.5rem;
}

.amount-input,
.comment-input {
  width: 100%;
}

/* Responsive Design */
@media (max-width: 480px) {
  .wallet-header {
    padding: 0.75rem;
  }
  
  .balance-amount {
    font-size: 2rem;
  }
  
  .balance-currency {
    font-size: 1rem;
  }
  
  .quick-actions {
    padding: 0.75rem;
    gap: 0.75rem;
  }
  
  .action-btn {
    height: 48px;
  }
  
  .action-label {
    font-size: 0.875rem;
  }
  
  .recent-section {
    margin: 0.75rem;
  }
  
  .section-header {
    padding: 0.75rem;
  }
  
  .transaction-item {
    padding: 0.75rem;
  }
  
  .dialog-content,
  .payment-content {
    padding: 1rem;
  }
  
  .amount-display {
    font-size: 1.5rem;
  }
}
</style>