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

    <!-- Filter Tabs -->
    <div class="filter-section">
      <q-tabs
        v-model="activeFilter"
        dense
        class="filter-tabs"
        indicator-color="primary"
        active-color="primary"
        align="justify"
      >
        <q-tab name="all" label="All" />
        <q-tab name="today" label="Today" />
        <q-tab name="week" label="Week" />
        <q-tab name="month" label="Month" />
      </q-tabs>
    </div>

    <!-- Summary Stats (when filtered) -->
    <div class="stats-section" v-if="activeFilter !== 'all' && filteredTransactions.length > 0">
      <div class="stats-container">
        <div class="stat-item">
          <div class="stat-label">Received</div>
          <div class="stat-value positive">+{{ formatAmount(totalReceived) }}</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-label">Sent</div>
          <div class="stat-value negative">-{{ formatAmount(totalSent) }}</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-label">Net</div>
          <div class="stat-value" :class="netAmount >= 0 ? 'positive' : 'negative'">
            {{ netAmount >= 0 ? '+' : '' }}{{ formatAmount(netAmount) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction List -->
    <q-scroll-area class="transaction-content" v-if="!isLoading && groupedTransactions.length > 0">
      <div class="transaction-groups">
        <div 
          v-for="group in groupedTransactions" 
          :key="group.date"
          class="transaction-group"
        >
          <!-- Group Header -->
          <div class="group-header" @click="toggleGroup(group.date)">
            <div class="group-info">
              <div class="group-date">{{ group.dateLabel }}</div>
              <div class="group-summary">{{ group.transactions.length }} transactions</div>
            </div>
            <div class="group-amount">
              <div class="group-total" :class="group.netAmount >= 0 ? 'positive' : 'negative'">
                {{ group.netAmount >= 0 ? '+' : '' }}{{ formatAmount(group.netAmount) }}
              </div>
              <q-icon 
                :name="group.expanded ? 'las la-chevron-up' : 'las la-chevron-down'" 
                class="expand-icon"
              />
            </div>
          </div>

          <!-- Group Transactions -->
          <q-slide-transition>
            <div v-show="group.expanded" class="group-transactions">
              <div 
                v-for="tx in group.transactions" 
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
                    <div class="transaction-time">{{ formatTime(tx.settled_at) }}</div>
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
    <div v-if="!isLoading && filteredTransactions.length === 0" class="empty-state">
      <div class="empty-icon">
        <q-icon name="las la-receipt" size="4rem" color="grey-4"/>
      </div>
      <div class="empty-title">No transactions found</div>
      <div class="empty-subtitle">
        {{ activeFilter === 'all' ? 'Your transactions will appear here' : `No transactions for ${activeFilter}` }}
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

    <!-- Floating Refresh Button -->
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
      activeFilter: 'all',
      transactions: [],
      walletState: {},
      nostrProfiles: {},
      expandedGroups: new Set()
    }
  },
  computed: {
    filteredTransactions() {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      return this.transactions.filter(tx => {
        const txDate = new Date(tx.settled_at * 1000);
        
        switch (this.activeFilter) {
          case 'today':
            return txDate >= today;
          case 'week':
            return txDate >= weekAgo;
          case 'month':
            return txDate >= monthAgo;
          default:
            return true;
        }
      });
    },

    groupedTransactions() {
      const groups = {};
      
      this.filteredTransactions.forEach(tx => {
        const date = new Date(tx.settled_at * 1000);
        const dateKey = this.getDateKey(date);
        
        if (!groups[dateKey]) {
          groups[dateKey] = {
            date: dateKey,
            dateLabel: this.getDateLabel(date),
            transactions: [],
            netAmount: 0,
            expanded: this.expandedGroups.has(dateKey)
          };
        }
        
        groups[dateKey].transactions.push(tx);
        groups[dateKey].netAmount += tx.type === 'incoming' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
      });

      // Sort groups by date (newest first) and sort transactions within each group
      return Object.values(groups)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(group => ({
          ...group,
          transactions: group.transactions.sort((a, b) => b.settled_at - a.settled_at)
        }));
    },

    totalReceived() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'incoming')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    totalSent() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'outgoing')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    netAmount() {
      return this.totalReceived - this.totalSent;
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
              limit: 500, 
              offset: 0 
            });
            
            if (transactionsResponse && transactionsResponse.transactions) {
              this.transactions = transactionsResponse.transactions.map(tx => ({
                ...tx,
                id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
                type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
                description: tx.description || tx.memo || '',
                settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
              }));
              
              // Sort by date (newest first)
              this.transactions.sort((a, b) => b.settled_at - a.settled_at);
              
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

    getDateKey(date) {
      return date.toISOString().split('T')[0];
    },

    getDateLabel(date) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      
      if (date >= today) {
        return 'Today';
      } else if (date >= yesterday) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'short', 
          day: 'numeric' 
        });
      }
    },

    toggleGroup(dateKey) {
      if (this.expandedGroups.has(dateKey)) {
        this.expandedGroups.delete(dateKey);
      } else {
        this.expandedGroups.add(dateKey);
      }
      
      // Update the expanded state in grouped transactions
      const group = this.groupedTransactions.find(g => g.date === dateKey);
      if (group) {
        group.expanded = this.expandedGroups.has(dateKey);
      }
    },

    getTransactionTypeText(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return 'Received';
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

    formatAmount(amount) {
      return Math.abs(amount).toLocaleString() + ' sats';
    },
    
    getFiatAmount(tx) {
      const btcAmount = Math.abs(tx.amount) / 100000000;
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates?.[currency.toLowerCase()] || 65000;
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

    formatTime(timestamp) {
      const date = new Date(timestamp * 1000);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
      });
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

/* Filter Section */
.filter-section {
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.filter-tabs {
  padding: 0 1rem;
}

.filter-tabs :deep(.q-tab) {
  font-weight: 500;
  text-transform: none;
  color: #6b7280;
}

.filter-tabs :deep(.q-tab--active) {
  color: #059573;
}

.filter-tabs :deep(.q-indicator) {
  background: #059573;
}

/* Stats Section */
.stats-section {
  background: #f8f9fa;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.stats-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.stat-label {
  font-size: 0.6875rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.stat-value {
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
}

.stat-value.positive {
  color: #059573;
}

.stat-value.negative {
  color: #dc2626;
}

/* Remove dividers for cleaner mobile look */

/* Transaction Content */
.transaction-content {
  height: calc(100vh - 200px);
  background: white;
}

.transaction-groups {
  padding: 0.5rem;
}

.transaction-group {
  margin-bottom: 1rem;
}

/* Group Header */
.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 0.5rem;
}

.group-header:hover {
  background: #f3f4f6;
}

.group-info {
  flex: 1;
}

.group-date {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.group-summary {
  font-size: 0.875rem;
  color: #6b7280;
}

.group-amount {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.group-total {
  font-size: 1rem;
  font-weight: 600;
}

.group-total.positive {
  color: #059573;
}

.group-total.negative {
  color: #dc2626;
}

.expand-icon {
  color: #6b7280;
  transition: transform 0.2s;
}

/* Group Transactions */
.group-transactions {
  background: white;
  border-radius: 12px;
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

/* Floating Action Button */
.refresh-fab {
  background: linear-gradient(135deg, #059573, #047857);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.3);
}

.refresh-fab:hover {
  background: linear-gradient(135deg, #047857, #065f46);
  box-shadow: 0 6px 16px rgba(5, 149, 115, 0.4);
}

/* Responsive Design */
@media (max-width: 480px) {
  .stats-section {
    padding: 0.75rem;
  }
  
  .stats-container {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
  }
  
  .stat-label {
    font-size: 0.625rem;
    margin-bottom: 0.125rem;
  }
  
  .stat-value {
    font-size: 0.8125rem;
  }
  
  .transaction-item {
    padding: 0.75rem;
  }
  
  .transaction-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .group-header {
    padding: 0.75rem;
  }
  
  .tx-icon-container {
    width: 32px;
    height: 32px;
  }
}
</style>