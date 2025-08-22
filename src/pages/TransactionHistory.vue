<template>
  <q-page class="transaction-history-page">
    <!-- Header -->
    <div class="page-header">
      <q-btn 
        flat 
        round 
        dense 
        icon="las la-arrow-left" 
        @click="$router.back()" 
        class="back-btn"
      />
      <div class="header-title">Transactions</div>
      <q-btn 
        flat 
        round 
        dense 
        icon="las la-times" 
        @click="$router.push('/wallet')"
        class="close-btn"
      />
    </div>

    <!-- Transaction List -->
    <q-scroll-area class="transaction-content" v-if="!isLoading && transactions.length > 0">
      <div class="transaction-list">
        <div 
          v-for="tx in transactions" 
          :key="tx.id"
          class="transaction-item"
          @click="viewTransaction(tx)"
        >
          <div class="transaction-icon">
            <q-avatar
              :color="getTransactionIconColor(tx)"
              size="40px"
            >
              <q-icon :name="getTransactionIcon(tx)" size="20px" color="white"/>
            </q-avatar>
          </div>

          <div class="transaction-details">
            <div class="transaction-main">
              <div class="transaction-type">{{ getTransactionTypeText(tx) }}</div>
              <div class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</div>
            </div>
            <div class="transaction-description" v-if="tx.description && tx.description !== 'Lightning transaction'">
              {{ tx.description }}
            </div>
            <div class="nostr-info" v-if="tx.senderNpub && nostrProfiles[tx.senderNpub]">
              <q-avatar size="16px" class="sender-avatar">
                <img 
                  v-if="nostrProfiles[tx.senderNpub].picture" 
                  :src="nostrProfiles[tx.senderNpub].picture"
                  :alt="getSenderDisplayName(tx.senderNpub)"
                />
                <q-icon v-else name="las la-user" size="10px"/>
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
    </q-scroll-area>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state">
      <q-spinner-dots color="primary" size="3rem"/>
      <div class="loading-text">Loading transactions...</div>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && transactions.length === 0" class="empty-state">
      <div class="empty-icon">
        <q-icon name="las la-receipt" size="4rem" color="grey-4"/>
      </div>
      <div class="empty-title">No transactions found</div>
      <div class="empty-subtitle">Your transactions will appear here</div>
      <q-btn 
        outline 
        color="primary" 
        label="Refresh" 
        icon="las la-sync-alt"
        @click="loadTransactions"
        class="refresh-btn"
      />
    </div>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";

export default {
  name: 'TransactionHistoryPage',
  data() {
    return {
      isLoading: true,
      transactions: [],
      walletState: {},
      nostrProfiles: {}
    }
  },
  async created() {
    await this.loadTransactions();
    this.loadNostrProfiles();
  },
  methods: {
    async loadTransactions() {
      this.isLoading = true;
      try {
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
          
          const activeWallet = this.walletState.connectedWallets.find(
            w => w.id === this.walletState.activeWalletId
          );
          
          if (activeWallet) {
            const nwc = new webln.NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            
            await nwc.enable();
            
            const transactionsResponse = await nwc.listTransactions({ 
              limit: 200, 
              offset: 0 
            });
            
            if (transactionsResponse && transactionsResponse.transactions) {
              this.transactions = transactionsResponse.transactions.map(tx => ({
                ...tx,
                id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
                type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
                description: tx.description || tx.memo || 'Lightning transaction',
                settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
              }));
              
              await this.processZapTransactions();
            }
          }
        }
      } catch (error) {
        console.error('Error loading transactions:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to load transaction history',
          position: 'top'
        });
      } finally {
        this.isLoading = false;
      }
    },
    
    async processZapTransactions() {
      for (const tx of this.transactions) {
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
        // Enhanced mock implementation with better profile data
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

    getTransactionTypeText(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return 'Received';
      }
      return tx.type === 'incoming' ? 'Received' : 'Sent';
    },
    
    getTransactionIconColor(tx) {
      if (tx.senderNpub) return '#8b5cf6'; // Purple for zaps
      return tx.type === 'incoming' ? '#10b981' : '#f97316'; // Green for received, orange for sent
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
      const fiatValue = btcAmount * (this.walletState.exchangeRates?.usd || 65000);
      return '$' + fiatValue.toFixed(2);
    },
    
    formatTransactionTime(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      const diffInHours = (now - date) / (1000 * 60 * 60);
      const diffInDays = Math.floor(diffInHours / 24);
      const diffInMonths = Math.floor(diffInDays / 30);

      if (diffInHours < 1) {
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        return `${diffInMinutes} minutes ago`;
      } else if (diffInHours < 24) {
        return `${Math.floor(diffInHours)} hours ago`;
      } else if (diffInDays < 30) {
        return `${diffInDays} days ago`;
      } else if (diffInMonths === 1) {
        return 'a month ago';
      } else {
        return `${diffInMonths} months ago`;
      }
    },
    
    viewTransaction(tx) {
      this.$router.push(`/transaction/${tx.id}`);
    }
  }
}
</script>

<style scoped>
.transaction-history-page {
  background: #f8f9fa;
  min-height: 100vh;
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 100;
}

.back-btn,
.close-btn {
  color: #6b7280;
}

.header-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

/* Transaction Content */
.transaction-content {
  height: calc(100vh - 80px);
  background: white;
}

.transaction-list {
  display: flex;
  flex-direction: column;
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
  font-size: 1rem;
}

.transaction-time {
  color: #6b7280;
  font-size: 0.875rem;
}

.transaction-description {
  color: #6b7280;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nostr-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #8b5cf6;
  font-size: 0.75rem;
  font-weight: 500;
}

.sender-avatar {
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.transaction-amount {
  text-align: right;
  min-width: 100px;
}

.amount-sats {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

.amount-positive {
  color: #10b981;
}

.amount-negative {
  color: #6b7280;
}

.amount-fiat {
  color: #9ca3af;
  font-size: 0.875rem;
}

/* Loading and Empty States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: white;
}

.loading-text {
  margin-top: 1rem;
  color: #6b7280;
  font-size: 1rem;
}

.empty-icon {
  margin-bottom: 1rem;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.empty-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.refresh-btn {
  border-radius: 8px;
}

/* Responsive Design */
@media (max-width: 480px) {
  .transaction-item {
    padding: 0.75rem;
  }
  
  .transaction-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .transaction-time {
    font-size: 0.75rem;
  }
}
</style>