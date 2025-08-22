<template>
  <q-page class="transaction-history-page">
    <!-- Header -->
    <div class="page-header">
      <div class="header-top">
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-arrow-left" 
          @click="$router.back()" 
          class="back-btn"
        />
        <div class="header-title">
          <div class="title">Transaction History</div>
          <div class="subtitle">{{ totalTransactions }} transactions</div>
        </div>
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-filter" 
          @click="showFilters = !showFilters"
          :color="showFilters ? 'primary' : 'grey-7'"
          class="filter-btn"
        />
      </div>

      <!-- Enhanced Filter Bar -->
      <div class="filter-section" :class="{ 'filter-expanded': showFilters }">
        <div class="filter-tabs">
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
                clickable
              >
                <q-icon :name="filter.icon" class="q-mr-xs" v-if="filter.icon"/>
                {{ filter.label }}
              </q-chip>
            </div>
          </q-scroll-area>
        </div>

        <!-- Quick Stats -->
        <div class="quick-stats" v-if="showFilters && filteredTransactions.length > 0">
          <div class="stat-item">
            <div class="stat-value income">+{{ formatBalance(totalIncome) }}</div>
            <div class="stat-label">Received</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value expense">-{{ formatBalance(totalExpense) }}</div>
            <div class="stat-label">Sent</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value net" :class="netAmount >= 0 ? 'income' : 'expense'">
              {{ netAmount >= 0 ? '+' : '' }}{{ formatBalance(netAmount) }}
            </div>
            <div class="stat-label">Net</div>
          </div>
        </div>
      </div>
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
          <div class="group-header" @click="toggleGroup(group.period)">
            <div class="group-info">
              <div class="group-title">{{ group.title }}</div>
              <div class="group-meta">
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
            <q-icon 
              :name="expandedGroups.includes(group.period) ? 'las la-chevron-up' : 'las la-chevron-down'"
              class="expand-icon"
            />
          </div>

          <!-- Transaction List -->
          <q-slide-transition>
            <div 
              v-show="expandedGroups.includes(group.period)"
              class="group-transactions"
            >
              <div 
                v-for="tx in group.transactions" 
                :key="tx.id"
                class="transaction-item"
                @click="viewTransaction(tx)"
              >
                <div class="transaction-avatar">
                  <q-avatar 
                    :color="getTransactionColor(tx)" 
                    :text-color="getTransactionTextColor(tx)"
                    size="48px"
                  >
                    <q-icon :name="getTransactionIcon(tx)" size="24px"/>
                  </q-avatar>
                </div>

                <div class="transaction-details">
                  <div class="transaction-description">
                    {{ getTransactionDescription(tx) }}
                  </div>
                  <div class="transaction-meta">
                    <div class="meta-row">
                      <span class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</span>
                      <span class="transaction-status" :class="getStatusClass(tx)">
                        {{ getTransactionStatus(tx) }}
                      </span>
                    </div>
                    <div class="meta-row" v-if="tx.senderNpub && nostrProfiles[tx.senderNpub]">
                      <div class="sender-info">
                        <q-avatar size="16px" class="sender-avatar">
                          <img 
                            v-if="nostrProfiles[tx.senderNpub].picture" 
                            :src="nostrProfiles[tx.senderNpub].picture"
                            :alt="getSenderDisplayName(tx.senderNpub)"
                          />
                          <q-icon v-else name="las la-user" size="10px"/>
                        </q-avatar>
                        <span class="sender-name">{{ getSenderDisplayName(tx.senderNpub) }}</span>
                        <q-icon name="las la-bolt" size="12px" class="zap-icon"/>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="transaction-amount">
                  <div class="amount-text" :class="getAmountClass(tx)">
                    {{ getFormattedAmount(tx) }}
                  </div>
                  <div class="fiat-amount">{{ getFiatAmount(tx) }}</div>
                </div>
              </div>
            </div>
          </q-slide-transition>
        </div>
      </div>
    </q-scroll-area>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-state">
      <q-spinner-dots color="primary" size="3rem"/>
      <div class="loading-text">Loading transactions...</div>
    </div>

    <!-- Empty State -->
    <div v-if="!isLoading && groupedTransactions.length === 0" class="empty-state">
      <div class="empty-icon">
        <q-icon name="las la-receipt" size="4rem" color="grey-4"/>
      </div>
      <div class="empty-title">No transactions found</div>
      <div class="empty-subtitle">
        {{ selectedFilter === 'all' ? 'Your transactions will appear here' : 'No transactions for this period' }}
      </div>
      <q-btn 
        outline 
        color="primary" 
        label="Refresh" 
        icon="las la-sync-alt"
        @click="loadTransactions"
        class="refresh-btn"
      />
    </div>

    <!-- Floating Action Button -->
    <q-page-sticky position="bottom-right" :offset="[18, 18]">
      <q-btn
        fab
        icon="las la-sync-alt"
        color="primary"
        @click="refreshTransactions"
        :loading="isRefreshing"
        class="refresh-fab"
      />
    </q-page-sticky>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";

export default {
  name: 'TransactionHistoryPage',
  data() {
    return {
      isLoading: true,
      isRefreshing: false,
      showFilters: false,
      selectedFilter: 'all',
      transactions: [],
      walletState: {},
      nostrProfiles: {},
      expandedGroups: [],
      filterOptions: [
        { label: 'All Time', value: 'all', icon: 'las la-infinity' },
        { label: 'Today', value: 'today', icon: 'las la-calendar-day' },
        { label: 'This Week', value: 'week', icon: 'las la-calendar-week' },
        { label: 'This Month', value: 'month', icon: 'las la-calendar' },
        { label: 'Last Month', value: 'lastMonth', icon: 'las la-calendar-minus' },
        { label: 'Last 3 Months', value: '3months', icon: 'las la-calendar-alt' },
        { label: 'This Year', value: 'year', icon: 'las la-calendar-check' }
      ]
    }
  },
  computed: {
    totalTransactions() {
      return this.transactions.length;
    },
    filteredTransactions() {
      return this.filterTransactions();
    },
    groupedTransactions() {
      const filtered = this.filteredTransactions;
      const grouped = this.groupTransactionsByPeriod(filtered);
      
      // Auto-expand first group if there are transactions
      if (grouped.length > 0 && this.expandedGroups.length === 0) {
        this.expandedGroups = [grouped[0].period];
      }
      
      return grouped;
    },
    totalIncome() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'incoming')
        .reduce((sum, tx) => sum + tx.amount, 0);
    },
    totalExpense() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'outgoing')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },
    netAmount() {
      return this.totalIncome - this.totalExpense;
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

    async refreshTransactions() {
      this.isRefreshing = true;
      await this.loadTransactions();
      this.isRefreshing = false;
      
      this.$q.notify({
        type: 'positive',
        message: 'Transactions refreshed',
        position: 'top'
      });
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
        // Mock implementation - replace with actual nostr client
        const profile = {
          name: npub.substring(0, 12) + '...',
          displayName: 'Nostr User',
          picture: `https://api.dicebear.com/7.x/identicon/svg?seed=${npub}`,
          about: '',
          nip05: ''
        };
        
        this.nostrProfiles[npub] = profile;
        this.saveNostrProfiles();
      } catch (error) {
        console.error('Error fetching nostr profile:', error);
      }
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

    getTransactionDescription(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return `Zap from ${this.getSenderDisplayName(tx.senderNpub)}`;
      }
      return tx.description || 'Lightning Transaction';
    },
    
    setFilter(filter) {
      this.selectedFilter = filter;
      this.showFilters = false;
      // Reset expanded groups when filter changes
      this.expandedGroups = [];
    },

    toggleGroup(period) {
      const index = this.expandedGroups.indexOf(period);
      if (index > -1) {
        this.expandedGroups.splice(index, 1);
      } else {
        this.expandedGroups.push(period);
      }
    },
    
    filterTransactions() {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      const start3MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      
      return this.transactions.filter(tx => {
        const txDate = new Date(tx.settled_at * 1000);
        
        switch (this.selectedFilter) {
          case 'today':
            return txDate >= today;
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
        
        if (this.selectedFilter === 'today' || this.selectedFilter === 'week') {
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
      
      return Object.values(groups).sort((a, b) => {
        return new Date(b.period) - new Date(a.period);
      });
    },
    
    getTransactionColor(tx) {
      if (tx.senderNpub) return 'purple-1';
      if (tx.type === 'incoming') return 'green-1';
      return 'grey-2';
    },
    
    getTransactionTextColor(tx) {
      if (tx.senderNpub) return 'purple-8';
      if (tx.type === 'incoming') return 'green-8';
      return 'grey-7';
    },
    
    getTransactionIcon(tx) {
      if (tx.senderNpub) return 'las la-bolt';
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
      return prefix + Math.abs(tx.amount).toLocaleString() + ' sats';
    },
    
    formatBalance(amount) {
      return Math.abs(amount).toLocaleString() + ' sats';
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
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  min-height: 100vh;
}

/* Header Styles */
.page-header {
  background: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-top {
  display: flex;
  align-items: center;
  padding: 1rem;
  gap: 1rem;
}

.back-btn {
  color: #6b7280;
}

.header-title {
  flex: 1;
}

.title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.125rem;
}

.subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.filter-btn {
  transition: all 0.2s;
}

/* Filter Section */
.filter-section {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.filter-expanded {
  max-height: 200px;
}

.filter-tabs {
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
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
  transition: all 0.2s;
}

.filter-chip:hover {
  transform: translateY(-1px);
}

/* Quick Stats */
.quick-stats {
  display: flex;
  justify-content: space-around;
  padding: 1rem;
  background: rgba(243, 244, 246, 0.5);
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.stat-value.income {
  color: #10b981;
}

.stat-value.expense {
  color: #ef4444;
}

.stat-value.net {
  color: #6366f1;
}

.stat-label {
  font-size: 0.75rem;
  color: #6b7280;
  font-weight: 500;
}

.stat-divider {
  width: 1px;
  background: rgba(229, 231, 235, 0.5);
  margin: 0 1rem;
}

/* Transaction Content */
.transaction-content {
  height: calc(100vh - 140px);
  padding: 1rem;
}

.transaction-groups {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.transaction-group {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(229, 231, 235, 0.3);
}

/* Group Header */
.group-header {
  padding: 1rem;
  background: rgba(243, 244, 246, 0.3);
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background-color 0.2s;
}

.group-header:hover {
  background: rgba(243, 244, 246, 0.5);
}

.group-info {
  flex: 1;
}

.group-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.group-meta {
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

.expand-icon {
  color: #9ca3af;
  transition: transform 0.2s;
}

/* Transaction Items */
.group-transactions {
  display: flex;
  flex-direction: column;
}

.transaction-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.2);
  cursor: pointer;
  transition: all 0.2s;
}

.transaction-item:hover {
  background: rgba(243, 244, 246, 0.3);
  transform: translateX(4px);
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
  gap: 0.25rem;
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
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-pending {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.sender-info {
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

.zap-icon {
  color: #fbbf24;
}

.transaction-amount {
  text-align: right;
  min-width: 90px;
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

/* Floating Action Button */
.refresh-fab {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Responsive Design */
@media (max-width: 480px) {
  .header-top {
    padding: 0.75rem;
  }
  
  .title {
    font-size: 1.125rem;
  }
  
  .transaction-content {
    padding: 0.75rem;
  }
  
  .transaction-item {
    padding: 0.75rem;
  }
  
  .group-header {
    padding: 0.75rem;
  }
  
  .quick-stats {
    padding: 0.75rem;
  }
  
  .stat-value {
    font-size: 1rem;
  }
  
  .filter-chips {
    padding: 0 0.75rem;
  }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .transaction-history-page {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  }
  
  .page-header,
  .transaction-group {
    background: #374151;
    border-color: rgba(75, 85, 99, 0.3);
  }
  
  .group-header {
    background: rgba(55, 65, 81, 0.5);
  }
  
  .title {
    color: #f9fafb;
  }
  
  .subtitle,
  .transaction-count,
  .transaction-time {
    color: #d1d5db;
  }
  
  .transaction-description {
    color: #f9fafb;
  }
  
  .empty-title {
    color: #f9fafb;
  }
  
  .empty-subtitle {
    color: #d1d5db;
  }
}
</style>