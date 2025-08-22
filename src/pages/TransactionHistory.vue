<template>
  <q-page class="transaction-history-page">
    <!-- Header -->
    <q-toolbar class="transaction-header">
      <q-btn flat round dense icon="las la-arrow-left" class="q-mr-sm" @click="$router.back()"/>
      <div class="header-content">
        <div class="title">Transaction History</div>
        <div class="subtitle">{{ totalTransactions }} transactions</div>
      </div>
      <q-space/>
      <q-btn flat round dense icon="las la-filter" @click="showFilters = !showFilters"/>
    </q-toolbar>

    <!-- Filter Bar -->
    <div class="filter-bar" v-show="showFilters">
      <q-scroll-area horizontal class="filter-scroll">
        <div class="filter-chips">
          <q-chip
            v-for="filter in filterOptions"
            :key="filter.value"
            :selected="selectedFilter === filter.value"
            @click="setFilter(filter.value)"
            :color="selectedFilter === filter.value ? 'primary' : 'grey-3'"
            :text-color="selectedFilter === filter.value ? 'white' : 'grey-8'"
            class="filter-chip"
          >
            {{ filter.label }}
          </q-chip>
        </div>
      </q-scroll-area>
    </div>

    <!-- Transaction Groups -->
    <q-scroll-area class="transaction-content" v-if="!isLoading && groupedTransactions.length > 0">
      <div class="transaction-groups">
        <div 
          v-for="group in groupedTransactions" 
          :key="group.period"
          class="transaction-group"
        >
          <!-- Group Header -->
          <div class="group-header">
            <div class="group-title">{{ group.title }}</div>
            <div class="group-summary">
              <span class="transaction-count">{{ group.transactions.length }} transactions</span>
              <div class="group-totals">
                <span class="income" v-if="group.totalIncome > 0">
                  +{{ formatBalance(group.totalIncome) }}
                </span>
                <span class="expense" v-if="group.totalExpense > 0">
                  -{{ formatBalance(group.totalExpense) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Transaction List -->
          <div class="group-transactions">
            <q-item 
              v-for="tx in group.transactions" 
              :key="tx.id"
              clickable 
              v-ripple 
              @click="viewTransaction(tx)"
              class="transaction-item"
            >
              <q-item-section side class="transaction-avatar">
                <q-avatar 
                  :color="getTransactionColor(tx)" 
                  :text-color="getTransactionTextColor(tx)"
                  size="48px"
                >
                  <q-icon :name="getTransactionIcon(tx)" size="24px"/>
                </q-avatar>
              </q-item-section>

              <q-item-section class="transaction-details">
                <q-item-label class="transaction-description">
                  {{ tx.description || 'Lightning Transaction' }}
                </q-item-label>
                <q-item-label caption class="transaction-meta">
                  <div class="meta-row">
                    <span class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</span>
                    <span class="transaction-status" :class="getStatusClass(tx)">
                      {{ getTransactionStatus(tx) }}
                    </span>
                  </div>
                  <div class="meta-row" v-if="tx.senderNpub">
                    <span class="sender-info">
                      <q-icon name="las la-user" size="12px" class="q-mr-xs"/>
                      {{ getSenderName(tx.senderNpub) }}
                    </span>
                  </div>
                </q-item-label>
              </q-item-section>

              <q-item-section side class="transaction-amount">
                <q-item-label 
                  :class="getAmountClass(tx)" 
                  class="amount-text"
                >
                  {{ getFormattedAmount(tx) }}
                </q-item-label>
                <q-item-label caption class="fiat-amount">
                  {{ getFiatAmount(tx) }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </div>
        </div>
      </div>
    </q-scroll-area>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state">
      <q-spinner-dots color="primary" size="2rem"/>
      <div class="loading-text">Loading transactions...</div>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && groupedTransactions.length === 0" class="empty-state">
      <q-icon name="las la-receipt" size="4rem" color="grey-5"/>
      <div class="empty-title">No transactions found</div>
      <div class="empty-subtitle">
        {{ selectedFilter === 'all' ? 'Your transactions will appear here' : 'No transactions for this period' }}
      </div>
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
      showFilters: false,
      selectedFilter: 'all',
      transactions: [],
      walletState: {},
      nostrProfiles: {}, // Cache for nostr profiles
      filterOptions: [
        { label: 'All Time', value: 'all' },
        { label: 'This Week', value: 'week' },
        { label: 'This Month', value: 'month' },
        { label: 'Last Month', value: 'lastMonth' },
        { label: 'Last 3 Months', value: '3months' },
        { label: 'This Year', value: 'year' }
      ]
    }
  },
  computed: {
    totalTransactions() {
      return this.transactions.length;
    },
    groupedTransactions() {
      const filtered = this.filterTransactions();
      return this.groupTransactionsByPeriod(filtered);
    }
  },
  async created() {
    await this.loadTransactions();
  },
  methods: {
    async loadTransactions() {
      this.isLoading = true;
      try {
        // Load wallet state
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
            
            // Get transactions with larger limit for history page
            const transactionsResponse = await nwc.listTransactions({ 
              limit: 100, 
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
              
              // Process zap transactions to extract sender npubs
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
        // Check if transaction is a zap and extract sender npub
        if (tx.description && tx.description.includes('zap')) {
          try {
            // Extract npub from zap description or metadata
            const npubMatch = tx.description.match(/npub1[a-zA-Z0-9]{58}/);
            if (npubMatch) {
              tx.senderNpub = npubMatch[0];
              await this.fetchNostrProfile(tx.senderNpub);
            }
          } catch (error) {
            console.error('Error processing zap transaction:', error);
          }
        }
      }
    },
    
    async fetchNostrProfile(npub) {
      if (this.nostrProfiles[npub]) return; // Already cached
      
      try {
        // Mock implementation - in real app, use nostr client
        // const profile = await nostrClient.getProfile(npub);
        const profile = {
          name: npub.substring(0, 12) + '...',
          displayName: 'Nostr User',
          picture: null
        };
        
        this.nostrProfiles[npub] = profile;
        
        // Cache profiles in localStorage
        localStorage.setItem('buhoGO_nostr_profiles', JSON.stringify(this.nostrProfiles));
      } catch (error) {
        console.error('Error fetching nostr profile:', error);
      }
    },
    
    getSenderName(npub) {
      const profile = this.nostrProfiles[npub];
      return profile ? (profile.displayName || profile.name) : npub.substring(0, 12) + '...';
    },
    
    setFilter(filter) {
      this.selectedFilter = filter;
      this.showFilters = false;
    },
    
    filterTransactions() {
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      const start3MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      
      return this.transactions.filter(tx => {
        const txDate = new Date(tx.settled_at * 1000);
        
        switch (this.selectedFilter) {
          case 'week':
            return txDate >= startOfWeek;
          case 'month':
            return txDate >= startOfMonth;
          case 'lastMonth':
            return txDate >= startOfLastMonth && txDate <= endOfLastMonth;
          case '3months':
            return txDate >= start3MonthsAgo;
          case 'year':
            return txDate >= startOfYear;
          default:
            return true;
        }
      });
    },
    
    groupTransactionsByPeriod(transactions) {
      const groups = {};
      
      transactions.forEach(tx => {
        const date = new Date(tx.settled_at * 1000);
        let groupKey, groupTitle;
        
        if (this.selectedFilter === 'week') {
          const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
          groupKey = date.toDateString();
          groupTitle = dayOfWeek + ', ' + date.toLocaleDateString();
        } else {
          const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          groupKey = `${date.getFullYear()}-${date.getMonth()}`;
          groupTitle = monthYear;
        }
        
        if (!groups[groupKey]) {
          groups[groupKey] = {
            period: groupKey,
            title: groupTitle,
            transactions: [],
            totalIncome: 0,
            totalExpense: 0
          };
        }
        
        groups[groupKey].transactions.push(tx);
        
        if (tx.type === 'incoming') {
          groups[groupKey].totalIncome += tx.amount;
        } else {
          groups[groupKey].totalExpense += Math.abs(tx.amount);
        }
      });
      
      // Sort groups by date (newest first)
      return Object.values(groups).sort((a, b) => {
        return new Date(b.period) - new Date(a.period);
      });
    },
    
    getTransactionColor(tx) {
      if (tx.type === 'incoming') return 'green-1';
      return 'grey-2';
    },
    
    getTransactionTextColor(tx) {
      if (tx.type === 'incoming') return 'green-8';
      return 'grey-7';
    },
    
    getTransactionIcon(tx) {
      if (tx.senderNpub) return 'las la-bolt'; // Zap icon
      if (tx.type === 'incoming') return 'las la-arrow-down';
      return 'las la-arrow-up';
    },
    
    getTransactionStatus(tx) {
      if (tx.settled) return 'Completed';
      if (tx.pending) return 'Pending';
      return 'Completed';
    },
    
    getStatusClass(tx) {
      if (tx.settled) return 'status-completed';
      if (tx.pending) return 'status-pending';
      return 'status-completed';
    },
    
    getAmountClass(tx) {
      return tx.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },
    
    getFormattedAmount(tx) {
      const prefix = tx.type === 'incoming' ? '+' : '-';
      return prefix + this.formatBalance(Math.abs(tx.amount));
    },
    
    formatBalance(amount) {
      return amount.toLocaleString() + ' sats';
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
      
      if (diffInHours < 1) {
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        return `${diffInMinutes}m ago`;
      } else if (diffInHours < 24) {
        return `${Math.floor(diffInHours)}h ago`;
      } else {
        return date.toLocaleDateString();
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
  background-color: #f8f9fa;
  min-height: 100vh;
}

.transaction-header {
  background-color: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  padding: 0.5rem 1rem;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.filter-bar {
  background-color: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  padding: 0.75rem 0;
}

.filter-scroll {
  height: 40px;
}

.filter-chips {
  display: flex;
  gap: 0.5rem;
  padding: 0 1rem;
  white-space: nowrap;
}

.filter-chip {
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
}

.transaction-content {
  height: calc(100vh - 140px);
  padding: 1rem;
}

.transaction-groups {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.transaction-group {
  background-color: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.group-header {
  padding: 1rem;
  background-color: rgba(243, 244, 246, 0.5);
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.group-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.group-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.transaction-count {
  font-size: 0.875rem;
  color: #6b7280;
}

.group-totals {
  display: flex;
  gap: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.income {
  color: #10b981;
}

.expense {
  color: #ef4444;
}

.group-transactions {
  display: flex;
  flex-direction: column;
}

.transaction-item {
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  transition: background-color 0.2s;
}

.transaction-item:hover {
  background-color: rgba(243, 244, 246, 0.3);
}

.transaction-item:last-child {
  border-bottom: none;
}

.transaction-avatar {
  margin-right: 1rem;
}

.transaction-details {
  flex: 1;
  min-width: 0;
}

.transaction-description {
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transaction-meta {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.transaction-time {
  color: #6b7280;
  font-size: 0.75rem;
}

.transaction-status {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
}

.status-completed {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-pending {
  background-color: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.sender-info {
  display: flex;
  align-items: center;
  color: #6366f1;
  font-size: 0.75rem;
  font-weight: 500;
}

.transaction-amount {
  text-align: right;
  min-width: 80px;
}

.amount-text {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 0.125rem;
}

.amount-positive {
  color: #10b981;
}

.amount-negative {
  color: #6b7280;
}

.fiat-amount {
  color: #9ca3af;
  font-size: 0.75rem;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 50vh;
  text-align: center;
  padding: 2rem;
}

.loading-text {
  margin-top: 1rem;
  color: #6b7280;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 1rem 0 0.5rem;
}

.empty-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
}
</style>