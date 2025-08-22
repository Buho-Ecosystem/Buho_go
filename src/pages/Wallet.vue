<template>
  <!-- Loading Screen -->
  <LoadingScreen 
    :show="showLoadingScreen" 
    :loading-text="loadingText"
  />
  
  <q-page class="wallet-page">
    <!-- Header -->
    <div class="wallet-header">
      <div class="header-content">
        <div class="logo-container">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 30 32" fill="none" class="logo">
            <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z" fill="#059573"/>
            <path d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z" fill="#78D53C"/>
            <path d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z" fill="#43B65B"/>
          </svg>
          <div class="title">BuhoGO</div>
        </div>
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-cog" 
          @click="$router.push('/settings')"
          class="settings-btn"
        />
      </div>
    </div>

    <!-- Balance Card -->
    <div class="balance-section">
      <div class="balance-card">
        <div class="balance-header">
          <div class="balance-label">Total Balance</div>
          <div class="currency-toggle" @click="toggleCurrency">
            <span class="currency-text">{{ walletState.currency }}</span>
            <q-icon name="las la-redo-alt" class="toggle-icon"/>
          </div>
        </div>
        
        <div class="balance-amount">
          <div class="amount-display">{{ formatBalance(walletState.balance) }}</div>
          <div class="amount-fiat" v-if="walletState.currency === 'sats'">
            {{ getFiatBalance() }}
          </div>
        </div>

        <!-- Wallet Selector -->
        <div class="wallet-selector" v-if="walletState.connectedWallets.length > 1">
          <q-select
            v-model="walletState.activeWalletId"
            :options="walletOptions"
            @update:model-value="switchWallet"
            outlined
            dense
            class="wallet-select"
            option-value="value"
            option-label="label"
            emit-value
            map-options
          />
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-section">
      <div class="action-buttons">
        <q-btn
          class="action-btn send-btn"
          @click="showSendModal = true"
          no-caps
          unelevated
        >
          <div class="btn-content">
            <q-icon name="las la-arrow-up" class="btn-icon"/>
            <span class="btn-label">Send</span>
          </div>
        </q-btn>

        <q-btn
          class="action-btn receive-btn"
          @click="showReceiveModal = true"
          no-caps
          unelevated
        >
          <div class="btn-content">
            <q-icon name="las la-arrow-down" class="btn-icon"/>
            <span class="btn-label">Receive</span>
          </div>
        </q-btn>
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="transactions-section">
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
          @click="viewTransaction(tx)"
        >
          <div class="transaction-icon">
            <div class="tx-icon-container" :class="getTransactionIconClass(tx)">
              <q-icon :name="getTransactionIcon(tx)" size="18px"/>
            </div>
          </div>

          <div class="transaction-details">
            <div class="transaction-main">
              <div class="transaction-type">{{ getTransactionTypeText(tx) }}</div>
              <div class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</div>
            </div>
            <div class="transaction-description" v-if="tx.description && tx.description !== 'Lightning transaction'">
              {{ tx.description }}
            </div>
            <div class="transaction-description" v-else-if="tx.memo">
              {{ tx.memo }}
            </div>
            <div class="nostr-info" v-if="tx.senderNpub && nostrProfiles[tx.senderNpub]">
              <q-avatar size="14px" class="sender-avatar">
                <img 
                  v-if="nostrProfiles[tx.senderNpub].picture" 
                  :src="nostrProfiles[tx.senderNpub].picture"
                  :alt="getSenderDisplayName(tx.senderNpub)"
                />
                <q-icon v-else name="las la-user" size="8px"/>
              </q-avatar>
              <span class="sender-name">{{ getSenderDisplayName(tx.senderNpub) }}</span>
            </div>
          </div>

          <div class="transaction-amount">
            <div class="amount-sats" :class="getAmountClass(tx)">
              {{ getFormattedAmount(tx) }}
            </div>
            <div class="amount-fiat">{{ getFiatAmount(tx) }}</div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-transactions">
        <div class="empty-icon">
          <q-icon name="las la-receipt" size="3rem" color="grey-4"/>
        </div>
        <div class="empty-text">No transactions yet</div>
        <div class="empty-subtext">Your transaction history will appear here</div>
      </div>
    </div>

    <!-- Send Modal -->
    <SendModal 
      v-model="showSendModal" 
      @payment-detected="handlePaymentDetected"
    />

    <!-- Receive Modal -->
    <ReceiveModal 
      v-model="showReceiveModal" 
      @invoice-created="handleInvoiceCreated"
    />

    <!-- Payment Confirmation Dialog -->
    <q-dialog v-model="showPaymentDialog" class="payment-dialog">
      <q-card class="payment-card">
        <q-card-section class="payment-header">
          <div class="payment-title">Confirm Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="payment-content">
          <!-- Payment Details -->
          <div class="payment-details">
            <div class="detail-item">
              <div class="detail-label">To</div>
              <div class="detail-value">{{ getPaymentDestination() }}</div>
            </div>
            
            <div class="detail-item" v-if="paymentData.amount">
              <div class="detail-label">Amount</div>
              <div class="detail-value amount-highlight">
                {{ formatPaymentAmount() }}
              </div>
            </div>
            
            <div class="detail-item" v-if="paymentData.description">
              <div class="detail-label">Description</div>
              <div class="detail-value">{{ paymentData.description }}</div>
            </div>
          </div>

          <!-- Amount Input for LNURL/Lightning Address -->
          <div v-if="needsAmountInput" class="amount-input-section">
            <div class="amount-label">Enter Amount</div>
            <div class="amount-input-container">
              <q-input
                v-model="paymentAmount"
                type="number"
                outlined
                label="Amount (sats)"
                :min="Math.floor(paymentData.minSendable / 1000)"
                :max="Math.floor(paymentData.maxSendable / 1000)"
                class="amount-input"
              />
            </div>
            <div class="amount-range">
              Min: {{ Math.floor(paymentData.minSendable / 1000) }} sats - 
              Max: {{ Math.floor(paymentData.maxSendable / 1000) }} sats
            </div>
          </div>

          <!-- Comment Input -->
          <div v-if="paymentData.commentAllowed > 0" class="comment-section">
            <div class="comment-label">Comment (optional)</div>
            <q-input
              v-model="paymentComment"
              outlined
              type="textarea"
              :maxlength="paymentData.commentAllowed"
              :placeholder="`Max ${paymentData.commentAllowed} characters`"
              class="comment-input"
            />
          </div>
        </q-card-section>

        <q-card-actions class="payment-actions">
          <q-btn flat label="Cancel" v-close-popup class="cancel-btn"/>
          <q-btn 
            unelevated 
            color="primary" 
            label="Send Payment" 
            @click="confirmPayment"
            :loading="isProcessingPayment"
            :disable="needsAmountInput && !isValidPaymentAmount"
            class="confirm-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";
import SendModal from '../components/SendModal.vue';
import ReceiveModal from '../components/ReceiveModal.vue';
import LoadingScreen from '../components/LoadingScreen.vue';
import LightningPaymentService from '../utils/lightning.js';

export default {
  name: 'WalletPage',
  components: {
    SendModal,
    ReceiveModal,
    LoadingScreen
  },
  data() {
    return {
      walletState: {
        balance: 0,
        connectedWallets: [],
        activeWalletId: null,
        currency: 'sats',
        currencies: ['sats', 'btc', 'usd'],
        exchangeRates: {
          usd: 65000,
          eur: 60000,
          gbp: 52000,
          jpy: 9800000
        },
        preferredFiatCurrency: 'USD',
        denominationCurrency: 'sats'
      },
      recentTransactions: [],
      nostrProfiles: {},
      showSendModal: false,
      showReceiveModal: false,
      showPaymentDialog: false,
      paymentData: null,
      paymentAmount: '',
      paymentComment: '',
      isProcessingPayment: false,
      showLoadingScreen: true,
      loadingText: 'Loading wallet...'
    }
  },
  computed: {
    walletOptions() {
      return this.walletState.connectedWallets.map(wallet => ({
        label: wallet.name,
        value: wallet.id
      }));
    },
    needsAmountInput() {
      return this.paymentData && (
        this.paymentData.type === 'lightning_address' || 
        this.paymentData.type === 'lnurl_pay'
      );
    },
    isValidPaymentAmount() {
      if (!this.needsAmountInput) return true;
      const amount = parseInt(this.paymentAmount);
      const minSats = Math.floor(this.paymentData.minSendable / 1000);
      const maxSats = Math.floor(this.paymentData.maxSendable / 1000);
      return amount >= minSats && amount <= maxSats;
    }
  },
  async created() {
    this.initializeWallet();
  },
  methods: {
    async initializeWallet() {
      try {
        this.loadingText = 'Loading wallet state...';
        await this.loadWalletState();
        
        this.loadingText = 'Fetching balance...';
        await this.updateBalance();
        
        this.loadingText = 'Loading transactions...';
        await this.loadRecentTransactions();
        
        this.loadingText = 'Loading profiles...';
        this.loadNostrProfiles();
        
        // Hide loading screen
        this.loadingText = 'Ready!';
        await new Promise(resolve => setTimeout(resolve, 500));
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing wallet:', error);
        this.showLoadingScreen = false;
      }
    },

    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          this.walletState = JSON.parse(savedState);
        } catch (error) {
          console.error('Failed to parse wallet state:', error);
        }
      }
    },

    async updateBalance() {
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet && activeWallet.nwcString) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await Promise.race([
            nwc.enable(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Connection timeout')), 8000)
            )
          ]);

          const balance = await Promise.race([
            nwc.getBalance(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Balance request timeout')), 6000)
            )
          ]);

          this.walletState.balance = balance.balance;
          activeWallet.balance = balance.balance;

          // Save updated state
          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        }
      } catch (error) {
        console.error('Failed to update balance:', error);
      }
    },

    async loadRecentTransactions() {
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          
          const transactionsResponse = await nwc.listTransactions({ 
            limit: 10, 
            offset: 0 
          });

          if (transactionsResponse && transactionsResponse.transactions) {
            this.recentTransactions = transactionsResponse.transactions.map(tx => ({
              ...tx,
              id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
              type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
              description: tx.description || tx.memo || '',
              settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
            }));

            // Sort by date (newest first)
            this.recentTransactions.sort((a, b) => b.settled_at - a.settled_at);

            // Process zap transactions
            await this.processZapTransactions();

            // Cache transactions
            localStorage.setItem('buhoGO_cached_transactions', JSON.stringify(this.recentTransactions));
          }
        }
      } catch (error) {
        console.error('Error loading transactions:', error);
      }
    },

    async processZapTransactions() {
      for (const tx of this.recentTransactions) {
        if (this.isZapTransaction(tx)) {
          const npub = this.extractNpubFromZap(tx);
          if (npub) {
            tx.senderNpub = npub;
            await this.fetchNostrProfile(npub);
          }
        }
      }
    },

    isZapTransaction(tx) {
      return tx.description && (
        tx.description.toLowerCase().includes('zap') ||
        tx.description.includes('⚡') ||
        tx.type === 'incoming' && tx.description.match(/npub1[a-zA-Z0-9]{58}/)
      );
    },

    extractNpubFromZap(tx) {
      const npubMatch = tx.description.match(/npub1[a-zA-Z0-9]{58}/);
      return npubMatch ? npubMatch[0] : null;
    },

    async fetchNostrProfile(npub) {
      if (this.nostrProfiles[npub]) return;
      
      try {
        const profile = {
          name: npub.substring(0, 12) + '...',
          displayName: this.generateDisplayName(),
          picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${npub}`,
          about: 'Lightning Network enthusiast',
          nip05: '',
          lud16: `${npub.substring(0, 8)}@getalby.com`
        };
        
        this.nostrProfiles[npub] = profile;
        this.saveNostrProfiles();
      } catch (error) {
        console.error('Error fetching nostr profile:', error);
      }
    },

    generateDisplayName() {
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      return names[Math.floor(Math.random() * names.length)];
    },

    loadNostrProfiles() {
      const saved = localStorage.getItem('buhoGO_nostr_profiles');
      if (saved) {
        try {
          this.nostrProfiles = JSON.parse(saved);
        } catch (error) {
          console.error('Error loading nostr profiles:', error);
        }
      }
    },

    saveNostrProfiles() {
      localStorage.setItem('buhoGO_nostr_profiles', JSON.stringify(this.nostrProfiles));
    },

    getSenderDisplayName(npub) {
      const profile = this.nostrProfiles[npub];
      return profile ? (profile.displayName || profile.name) : npub.substring(0, 12) + '...';
    },

    toggleCurrency() {
      const currentIndex = this.walletState.currencies.indexOf(this.walletState.currency);
      const nextIndex = (currentIndex + 1) % this.walletState.currencies.length;
      this.walletState.currency = this.walletState.currencies[nextIndex];
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
    },

    formatBalance(balance) {
      switch (this.walletState.currency) {
        case 'btc':
          return (balance / 100000000).toFixed(8) + ' BTC'
        case 'usd':
          const usdValue = (balance / 100000000) * (this.walletState.exchangeRates.usd || 65000)
          return '$' + usdValue.toFixed(2)
        case 'sats':
        default:
          return balance.toLocaleString() + ' sats'
      }
    },

    getFiatBalance() {
      const btcAmount = this.walletState.balance / 100000000;
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates[currency.toLowerCase()] || 65000;
      const fiatValue = btcAmount * rate;
      
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      };
      
      const symbol = symbols[currency] || currency;
      return symbol + fiatValue.toFixed(2);
    },

    async switchWallet(walletId) {
      this.walletState.activeWalletId = walletId;
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
      await this.updateBalance();
      await this.loadRecentTransactions();
    },

    handlePaymentDetected(payment) {
      this.paymentData = payment;
      this.paymentAmount = '';
      this.paymentComment = '';
      this.showPaymentDialog = true;
    },

    handleInvoiceCreated(invoice) {
      this.$q.notify({
        type: 'positive',
        message: 'Invoice created successfully!',
        position: 'top'
      });
      // Refresh transactions after creating invoice
      setTimeout(() => {
        this.loadRecentTransactions();
      }, 1000);
    },

    getPaymentDestination() {
      if (!this.paymentData) return '';
      
      switch (this.paymentData.type) {
        case 'lightning_address':
          return this.paymentData.address;
        case 'lnurl_pay':
          return 'LNURL Payment';
        case 'lightning_invoice':
          return 'Lightning Invoice';
        default:
          return 'Unknown';
      }
    },

    formatPaymentAmount() {
      if (!this.paymentData) return '';
      
      if (this.needsAmountInput) {
        return this.paymentAmount ? `${this.paymentAmount} sats` : 'Amount to be entered';
      }
      
      return this.paymentData.amount ? `${this.paymentData.amount} sats` : 'Variable amount';
    },

    async confirmPayment() {
      this.isProcessingPayment = true;
      
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        
        const amount = this.needsAmountInput ? parseInt(this.paymentAmount) : null;
        const comment = this.paymentComment || null;
        
        const result = await lightningService.sendPayment(this.paymentData, amount, comment);
        
        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'top'
        });

        this.showPaymentDialog = false;
        
        // Update balance and transactions
        await this.updateBalance();
        await this.loadRecentTransactions();
        
      } catch (error) {
        console.error('Error sending payment:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Error sending payment: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isProcessingPayment = false;
      }
    },

    getTransactionTypeText(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return 'Zap Received';
      }
      return tx.type === 'incoming' ? 'Received' : 'Sent';
    },
    
    getTransactionIconClass(tx) {
      if (tx.senderNpub) return 'tx-icon-zap';
      return tx.type === 'incoming' ? 'tx-icon-received' : 'tx-icon-sent';
    },
    
    getTransactionIcon(tx) {
      if (tx.senderNpub) return 'las la-bolt';
      return tx.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up';
    },
    
    getAmountClass(tx) {
      return tx.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },
    
    getFormattedAmount(tx) {
      const prefix = tx.type === 'incoming' ? '+' : '-';
      return prefix + ' ' + Math.abs(tx.amount).toLocaleString() + ' sats';
    },
    
    getFiatAmount(tx) {
      const btcAmount = Math.abs(tx.amount) / 100000000;
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates[currency.toLowerCase()] || 65000;
      const fiatValue = btcAmount * rate;
      
      const symbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      };
      
      const symbol = symbols[currency] || currency;
      return symbol + fiatValue.toFixed(2);
    },

    formatTransactionTime(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      
      if (txDate.getTime() === today.getTime()) {
        return date.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
      } else if (txDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
      }
    },
    
    viewTransaction(tx) {
      this.$router.push(`/transaction/${tx.id}`);
    }
  }
}
</script>

<style scoped>
.wallet-page {
  background: #f8f9fa;
  min-height: 100vh;
  padding-bottom: 2rem;
}

/* Header */
.wallet-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo {
  filter: drop-shadow(0 2px 4px rgba(5, 149, 115, 0.15));
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #78D53C);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.settings-btn {
  color: #6b7280;
  transition: all 0.2s ease;
}

.settings-btn:hover {
  color: #374151;
  background: #f3f4f6;
}

/* Balance Section */
.balance-section {
  padding: 1rem;
}

.balance-card {
  background: white;
  border-radius: 20px;
  padding: 2rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(229, 231, 235, 0.5);
  text-align: center;
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.balance-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.currency-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f3f4f6;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.currency-toggle:hover {
  background: #e5e7eb;
}

.currency-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.toggle-icon {
  color: #6b7280;
  font-size: 12px;
}

.balance-amount {
  margin-bottom: 1.5rem;
}

.amount-display {
  font-size: 3rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
  line-height: 1;
}

.amount-fiat {
  font-size: 1.125rem;
  color: #6b7280;
}

.wallet-selector {
  max-width: 300px;
  margin: 0 auto;
}

.wallet-select {
  background: #f8f9fa;
  border-radius: 12px;
}

/* Action Section */
.action-section {
  padding: 0 1rem 1rem;
}

.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.action-btn {
  height: 60px;
  border-radius: 16px;
  font-weight: 600;
  transition: all 0.2s ease;
  border: none;
}

.send-btn {
  background: #374151;
  color: white;
}

.send-btn:hover {
  background: #4b5563;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(55, 65, 81, 0.3);
}

.receive-btn {
  background: #059573;
  color: white;
}

.receive-btn:hover {
  background: #047857;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(5, 149, 115, 0.3);
}

.btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  font-size: 1.5rem;
}

.btn-label {
  font-size: 0.875rem;
  font-weight: 600;
}

/* Transactions Section */
.transactions-section {
  padding: 0 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

.view-all-btn {
  font-size: 0.875rem;
  font-weight: 500;
  color: #059573;
  text-transform: none;
}

.transaction-list {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.transaction-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #f3f4f6;
}

.transaction-item:hover {
  background: #f9fafb;
}

.transaction-item:last-child {
  border-bottom: none;
}

.transaction-icon {
  margin-right: 1rem;
}

.tx-icon-container {
  width: 36px;
  height: 36px;
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

.tx-icon-zap {
  background: #059573;
}

.transaction-details {
  flex: 1;
  min-width: 0;
}

.transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.transaction-type {
  font-weight: 500;
  color: #1f2937;
  font-size: 0.95rem;
}

.transaction-time {
  color: #6b7280;
  font-size: 0.8rem;
}

.transaction-description {
  color: #6b7280;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.nostr-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #059573;
  font-size: 0.7rem;
  font-weight: 500;
}

.sender-avatar {
  border: 1px solid rgba(5, 149, 115, 0.3);
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.transaction-amount {
  text-align: right;
  min-width: 90px;
}

.amount-sats {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}

.amount-positive {
  color: #059573;
}

.amount-negative {
  color: #dc2626;
}

.amount-fiat {
  color: #6b7280;
  font-size: 0.8rem;
}

/* Empty State */
.empty-transactions {
  text-align: center;
  padding: 3rem 2rem;
  background: white;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
}

.empty-icon {
  margin-bottom: 1rem;
}

.empty-text {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.empty-subtext {
  color: #6b7280;
  font-size: 0.875rem;
}

/* Payment Dialog */
.payment-dialog :deep(.q-dialog__inner) {
  padding: 1rem;
}

.payment-card {
  width: 100%;
  max-width: 500px;
  border-radius: 16px;
}

.payment-header {
  background: #f8f9fa;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.payment-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

.close-btn {
  color: #6b7280;
}

.payment-content {
  padding: 1.5rem;
}

.payment-details {
  margin-bottom: 1.5rem;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
  gap: 1rem;
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-weight: 500;
  color: #6b7280;
  min-width: 80px;
}

.detail-value {
  color: #1f2937;
  word-break: break-all;
  text-align: right;
  flex: 1;
}

.amount-highlight {
  font-weight: 600;
  color: #059573;
  font-size: 1.125rem;
}

.amount-input-section {
  margin-bottom: 1.5rem;
}

.amount-label {
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 0.75rem;
}

.amount-input {
  margin-bottom: 0.5rem;
}

.amount-range {
  font-size: 0.875rem;
  color: #6b7280;
}

.comment-section {
  margin-bottom: 1.5rem;
}

.comment-label {
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 0.75rem;
}

.payment-actions {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
  justify-content: flex-end;
  gap: 0.75rem;
}

.cancel-btn {
  color: #6b7280;
}

.confirm-btn {
  background: #059573;
  color: white;
  font-weight: 500;
}

.confirm-btn:hover {
  background: #047857;
}

/* Responsive Design */
@media (max-width: 480px) {
  .balance-card {
    padding: 1.5rem;
  }
  
  .amount-display {
    font-size: 2.5rem;
  }
  
  .action-buttons {
    gap: 0.75rem;
  }
  
  .action-btn {
    height: 56px;
  }
  
  .btn-icon {
    font-size: 1.25rem;
  }
  
  .transaction-item {
    padding: 0.75rem;
  }
  
  .transaction-description {
    max-width: 150px;
  }
  
  .payment-content {
    padding: 1rem;
  }
  
  .detail-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .detail-value {
    text-align: left;
  }
}
</style>