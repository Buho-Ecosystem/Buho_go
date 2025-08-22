<template>
  <q-page class="transaction-details-page">
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
      <div class="header-title">Transaction Details</div>
      <div class="header-actions">
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-code" 
          @click="toggleDeveloperMode"
          :color="showDeveloperMode ? 'primary' : 'grey-7'"
          class="dev-toggle"
        >
          <q-tooltip>{{ showDeveloperMode ? 'Hide' : 'Show' }} Developer Details</q-tooltip>
        </q-btn>
        <q-btn 
          flat 
          round 
          dense 
          icon="las la-share-alt" 
          @click="shareTransaction"
          class="share-btn"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <q-spinner-dots color="primary" size="3rem"/>
      <div class="loading-text">Loading transaction details...</div>
    </div>

    <!-- Transaction Details -->
    <div v-else-if="transaction" class="transaction-content">
      <!-- Status Card -->
      <q-card class="status-card" :class="getStatusCardClass()">
        <q-card-section class="status-section">
          <div class="status-icon">
            <q-avatar 
              :color="getTransactionColor()" 
              :text-color="getTransactionTextColor()"
              size="64px"
            >
              <q-icon :name="getTransactionIcon()" size="32px"/>
            </q-avatar>
          </div>
          <div class="status-info">
            <div class="transaction-type">{{ getTransactionTypeLabel() }}</div>
            <div class="transaction-status" :class="getStatusClass()">
              <q-icon :name="getStatusIcon()" class="q-mr-xs"/>
              {{ getTransactionStatus() }}
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Amount Card -->
      <q-card class="amount-card">
        <q-card-section class="amount-section">
          <div class="amount-display">
            <div class="amount-value" :class="getAmountClass()">
              {{ getFormattedAmount() }}
            </div>
            <div class="amount-fiat">{{ getFiatAmount() }}</div>
          </div>
          <div class="amount-breakdown" v-if="showDeveloperMode && transaction.fees">
            <div class="breakdown-item">
              <span class="breakdown-label">Base Amount:</span>
              <span class="breakdown-value">{{ formatSats(transaction.amount - (transaction.fees || 0)) }}</span>
            </div>
            <div class="breakdown-item">
              <span class="breakdown-label">Fees:</span>
              <span class="breakdown-value">{{ formatSats(transaction.fees || 0) }}</span>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Nostr Profile Card (for zaps) -->
      <q-card 
        v-if="transaction.senderNpub && nostrProfile" 
        class="profile-card"
        @click="viewNostrProfile"
      >
        <q-card-section class="profile-section">
          <div class="profile-avatar">
            <q-avatar size="48px">
              <img 
                v-if="nostrProfile.picture" 
                :src="nostrProfile.picture"
                :alt="nostrProfile.displayName || nostrProfile.name"
              />
              <q-icon v-else name="las la-user" size="24px"/>
            </q-avatar>
          </div>
          <div class="profile-info">
            <div class="profile-name">{{ nostrProfile.displayName || nostrProfile.name }}</div>
            <div class="profile-meta">
              <q-icon name="las la-bolt" class="zap-icon q-mr-xs"/>
              Zap Transaction
            </div>
            <div class="profile-about" v-if="nostrProfile.about">
              {{ nostrProfile.about }}
            </div>
          </div>
          <q-icon name="las la-external-link-alt" class="external-icon"/>
        </q-card-section>
      </q-card>

      <!-- Transaction Info -->
      <q-card class="info-card">
        <q-card-section class="info-section">
          <div class="section-title">Transaction Information</div>
          
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Description</div>
              <div class="info-value">{{ transaction.description || 'No description' }}</div>
            </div>
            
            <div class="info-item">
              <div class="info-label">Date & Time</div>
              <div class="info-value">{{ formatDateTime(transaction.settled_at) }}</div>
            </div>
            
            <div class="info-item" v-if="transaction.preimage">
              <div class="info-label">Preimage</div>
              <div class="info-value hash-value" @click="copyToClipboard(transaction.preimage)">
                {{ formatHash(transaction.preimage) }}
                <q-icon name="las la-copy" class="copy-icon"/>
              </div>
            </div>
            
            <div class="info-item">
              <div class="info-label">Payment Hash</div>
              <div class="info-value hash-value" @click="copyToClipboard(transaction.payment_hash)">
                {{ formatHash(transaction.payment_hash) }}
                <q-icon name="las la-copy" class="copy-icon"/>
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Developer Details -->
      <q-slide-transition>
        <q-card v-show="showDeveloperMode" class="developer-card">
          <q-card-section class="developer-section">
            <div class="section-title">
              <q-icon name="las la-code" class="q-mr-sm"/>
              Developer Details
            </div>
            
            <div class="developer-grid">
              <div class="dev-item" v-if="transaction.id">
                <div class="dev-label">Transaction ID</div>
                <div class="dev-value hash-value" @click="copyToClipboard(transaction.id)">
                  {{ transaction.id }}
                  <q-icon name="las la-copy" class="copy-icon"/>
                </div>
              </div>
              
              <div class="dev-item" v-if="transaction.type">
                <div class="dev-label">Type</div>
                <div class="dev-value">{{ transaction.type }}</div>
              </div>
              
              <div class="dev-item" v-if="transaction.created_at">
                <div class="dev-label">Created At</div>
                <div class="dev-value">{{ formatTimestamp(transaction.created_at) }}</div>
              </div>
              
              <div class="dev-item" v-if="transaction.settled_at">
                <div class="dev-label">Settled At</div>
                <div class="dev-value">{{ formatTimestamp(transaction.settled_at) }}</div>
              </div>
              
              <div class="dev-item" v-if="transaction.expires_at">
                <div class="dev-label">Expires At</div>
                <div class="dev-value">{{ formatTimestamp(transaction.expires_at) }}</div>
              </div>
            </div>
            
            <!-- Raw Invoice -->
            <div class="raw-invoice" v-if="transaction.payment_request">
              <div class="dev-label">Raw Invoice</div>
              <q-input
                v-model="transaction.payment_request"
                type="textarea"
                readonly
                outlined
                rows="4"
                class="invoice-input"
              />
              <q-btn
                flat
                dense
                icon="las la-copy"
                label="Copy Invoice"
                @click="copyToClipboard(transaction.payment_request)"
                class="copy-invoice-btn"
              />
            </div>
            
            <!-- Raw JSON -->
            <div class="raw-json">
              <div class="dev-label">Raw JSON</div>
              <pre class="json-display">{{ JSON.stringify(transaction, null, 2) }}</pre>
              <q-btn
                flat
                dense
                icon="las la-copy"
                label="Copy JSON"
                @click="copyToClipboard(JSON.stringify(transaction, null, 2))"
                class="copy-json-btn"
              />
            </div>
          </q-card-section>
        </q-card>
      </q-slide-transition>

      <!-- Action Buttons -->
      <div class="action-buttons">
        <q-btn
          outline
          color="primary"
          icon="las la-redo-alt"
          label="Pay Again"
          @click="payAgain"
          v-if="transaction.type === 'outgoing' && transaction.payment_request"
          class="action-btn"
        />
        <q-btn
          outline
          color="primary"
          icon="las la-receipt"
          label="Create Similar"
          @click="createSimilar"
          v-if="transaction.type === 'incoming'"
          class="action-btn"
        />
        <q-btn
          outline
          color="negative"
          icon="las la-exclamation-triangle"
          label="Report Issue"
          @click="reportIssue"
          class="action-btn"
        />
      </div>
    </div>

    <!-- Error State -->
    <div v-else class="error-state">
      <q-icon name="las la-exclamation-triangle" size="4rem" color="negative"/>
      <div class="error-title">Transaction Not Found</div>
      <div class="error-subtitle">The requested transaction could not be found or loaded.</div>
      <q-btn
        outline
        color="primary"
        label="Go Back"
        @click="$router.back()"
        class="error-btn"
      />
    </div>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";

export default {
  name: 'TransactionDetailsPage',
  data() {
    return {
      loading: true,
      showDeveloperMode: false,
      transaction: null,
      nostrProfile: null,
      walletState: {}
    }
  },
  async created() {
    await this.loadTransactionDetails();
    this.loadDeveloperModePreference();
  },
  methods: {
    async loadTransactionDetails() {
      this.loading = true;
      try {
        const txId = this.$route.params.id;
        
        // Load wallet state
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
        }
        
        // Try to find transaction in local storage first
        const cachedTransactions = localStorage.getItem('buhoGO_cached_transactions');
        if (cachedTransactions) {
          const transactions = JSON.parse(cachedTransactions);
          this.transaction = transactions.find(tx => tx.id === txId);
        }
        
        // If not found locally, fetch from wallet
        if (!this.transaction) {
          await this.fetchTransactionFromWallet(txId);
        }
        
        // Load nostr profile if it's a zap
        if (this.transaction && this.transaction.senderNpub) {
          await this.loadNostrProfile(this.transaction.senderNpub);
        }
        
      } catch (error) {
        console.error('Error loading transaction details:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to load transaction details',
          position: 'top'
        });
      } finally {
        this.loading = false;
      }
    },
    
    async fetchTransactionFromWallet(txId) {
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      );
      
      if (activeWallet) {
        try {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });
          
          await nwc.enable();
          const transactionsResponse = await nwc.listTransactions({ limit: 100 });
          
          if (transactionsResponse && transactionsResponse.transactions) {
            this.transaction = transactionsResponse.transactions.find(tx => 
              tx.id === txId || tx.payment_hash === txId
            );
            
            if (this.transaction) {
              // Enhance transaction data
              this.transaction.id = this.transaction.id || this.transaction.payment_hash || txId;
              this.transaction.type = this.transaction.type || (this.transaction.amount > 0 ? 'incoming' : 'outgoing');
              this.transaction.description = this.transaction.description || this.transaction.memo || 'Lightning transaction';
              this.transaction.settled_at = this.transaction.settled_at || this.transaction.created_at || Math.floor(Date.now() / 1000);
              
              // Check if it's a zap transaction
              if (this.isZapTransaction(this.transaction)) {
                this.transaction.senderNpub = this.extractNpubFromZap(this.transaction);
              }
            }
          }
        } catch (error) {
          console.error('Error fetching transaction from wallet:', error);
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
    
    async loadNostrProfile(npub) {
      try {
        // Load from cache first
        const cachedProfiles = localStorage.getItem('buhoGO_nostr_profiles');
        if (cachedProfiles) {
          const profiles = JSON.parse(cachedProfiles);
          this.nostrProfile = profiles[npub];
        }
        
        // If not cached, create a mock profile (replace with actual nostr client)
        if (!this.nostrProfile) {
          this.nostrProfile = {
            name: npub.substring(0, 12) + '...',
            displayName: 'Nostr User',
            picture: `https://api.dicebear.com/7.x/identicon/svg?seed=${npub}`,
            about: 'Lightning Network enthusiast',
            nip05: ''
          };
        }
      } catch (error) {
        console.error('Error loading nostr profile:', error);
      }
    },
    
    loadDeveloperModePreference() {
      const saved = localStorage.getItem('buhoGO_developer_mode');
      this.showDeveloperMode = saved === 'true';
    },
    
    toggleDeveloperMode() {
      this.showDeveloperMode = !this.showDeveloperMode;
      localStorage.setItem('buhoGO_developer_mode', this.showDeveloperMode.toString());
    },
    
    getTransactionTypeLabel() {
      if (this.transaction.senderNpub) return 'Zap Received';
      return this.transaction.type === 'incoming' ? 'Payment Received' : 'Payment Sent';
    },
    
    getTransactionColor() {
      if (this.transaction.senderNpub) return 'purple-1';
      return this.transaction.type === 'incoming' ? 'green-1' : 'grey-2';
    },
    
    getTransactionTextColor() {
      if (this.transaction.senderNpub) return 'purple-8';
      return this.transaction.type === 'incoming' ? 'green-8' : 'grey-7';
    },
    
    getTransactionIcon() {
      if (this.transaction.senderNpub) return 'las la-bolt';
      return this.transaction.type === 'incoming' ? 'las la-arrow-down' : 'las la-arrow-up';
    },
    
    getTransactionStatus() {
      if (this.transaction.settled) return 'Completed';
      if (this.transaction.pending) return 'Pending';
      return 'Completed';
    },
    
    getStatusIcon() {
      if (this.transaction.settled) return 'las la-check-circle';
      if (this.transaction.pending) return 'las la-clock';
      return 'las la-check-circle';
    },
    
    getStatusClass() {
      if (this.transaction.settled) return 'status-completed';
      if (this.transaction.pending) return 'status-pending';
      return 'status-completed';
    },
    
    getStatusCardClass() {
      if (this.transaction.senderNpub) return 'zap-card';
      return this.transaction.type === 'incoming' ? 'incoming-card' : 'outgoing-card';
    },
    
    getAmountClass() {
      return this.transaction.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },
    
    getFormattedAmount() {
      const prefix = this.transaction.type === 'incoming' ? '+' : '-';
      return prefix + Math.abs(this.transaction.amount).toLocaleString() + ' sats';
    },
    
    getFiatAmount() {
      const btcAmount = Math.abs(this.transaction.amount) / 100000000;
      const fiatValue = btcAmount * (this.walletState.exchangeRates?.usd || 65000);
      return '$' + fiatValue.toFixed(2);
    },
    
    formatSats(amount) {
      return Math.abs(amount).toLocaleString() + ' sats';
    },
    
    formatDateTime(timestamp) {
      const date = new Date(timestamp * 1000);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    },
    
    formatTimestamp(timestamp) {
      return new Date(timestamp * 1000).toISOString();
    },
    
    formatHash(hash) {
      if (!hash) return 'N/A';
      return hash.substring(0, 8) + '...' + hash.substring(hash.length - 8);
    },
    
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({
          type: 'positive',
          message: 'Copied to clipboard!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to copy to clipboard',
          position: 'top'
        });
      }
    },
    
    shareTransaction() {
      if (navigator.share) {
        navigator.share({
          title: 'Lightning Transaction',
          text: `Transaction: ${this.getFormattedAmount()}`,
          url: window.location.href
        });
      } else {
        this.copyToClipboard(window.location.href);
      }
    },
    
    viewNostrProfile() {
      if (this.transaction.senderNpub) {
        // Open nostr profile in new tab (replace with actual nostr client URL)
        const nostrUrl = `https://snort.social/p/${this.transaction.senderNpub}`;
        window.open(nostrUrl, '_blank');
      }
    },
    
    payAgain() {
      if (this.transaction.payment_request) {
        this.$router.push({
          path: '/wallet',
          query: { invoice: this.transaction.payment_request }
        });
      }
    },
    
    createSimilar() {
      this.$router.push({
        path: '/wallet',
        query: { 
          amount: Math.abs(this.transaction.amount),
          description: this.transaction.description
        }
      });
    },
    
    reportIssue() {
      // Open support/issue reporting
      const subject = encodeURIComponent(`Issue with transaction ${this.transaction.id}`);
      const body = encodeURIComponent(`Transaction ID: ${this.transaction.id}\nAmount: ${this.getFormattedAmount()}\nDate: ${this.formatDateTime(this.transaction.settled_at)}\n\nIssue description:`);
      window.open(`mailto:support@buhogo.com?subject=${subject}&body=${body}`);
    }
  }
}
</script>

<style scoped>
.transaction-details-page {
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  min-height: 100vh;
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  position: sticky;
  top: 0;
  z-index: 100;
}

.back-btn {
  color: #6b7280;
}

.header-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  flex: 1;
  text-align: center;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.dev-toggle,
.share-btn {
  color: #6b7280;
}

/* Loading State */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
}

.loading-text {
  margin-top: 1rem;
  color: #6b7280;
  font-size: 1rem;
}

/* Transaction Content */
.transaction-content {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Status Card */
.status-card {
  border-radius: 16px;
  overflow: hidden;
  border: 2px solid transparent;
}

.incoming-card {
  border-color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(16, 185, 129, 0.02));
}

.outgoing-card {
  border-color: #6b7280;
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.05), rgba(107, 114, 128, 0.02));
}

.zap-card {
  border-color: #8b5cf6;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(139, 92, 246, 0.02));
}

.status-section {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
}

.status-info {
  flex: 1;
}

.transaction-type {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.transaction-status {
  display: flex;
  align-items: center;
  font-weight: 500;
}

.status-completed {
  color: #10b981;
}

.status-pending {
  color: #f59e0b;
}

/* Amount Card */
.amount-card {
  border-radius: 16px;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.amount-section {
  text-align: center;
  padding: 2rem 1.5rem;
}

.amount-value {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.amount-positive {
  color: #10b981;
}

.amount-negative {
  color: #6b7280;
}

.amount-fiat {
  font-size: 1.125rem;
  color: #6b7280;
  margin-bottom: 1rem;
}

.amount-breakdown {
  background: rgba(243, 244, 246, 0.5);
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1rem;
}

.breakdown-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.breakdown-item:last-child {
  margin-bottom: 0;
}

.breakdown-label {
  color: #6b7280;
}

.breakdown-value {
  font-weight: 500;
  color: #1f2937;
}

/* Profile Card */
.profile-card {
  border-radius: 16px;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: transform 0.2s;
}

.profile-card:hover {
  transform: translateY(-2px);
}

.profile-section {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
}

.profile-info {
  flex: 1;
}

.profile-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.profile-meta {
  display: flex;
  align-items: center;
  color: #8b5cf6;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.zap-icon {
  color: #fbbf24;
}

.profile-about {
  color: #6b7280;
  font-size: 0.875rem;
}

.external-icon {
  color: #9ca3af;
}

/* Info Card */
.info-card,
.developer-card {
  border-radius: 16px;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.info-section,
.developer-section {
  padding: 1.5rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
}

.info-grid,
.developer-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-item,
.dev-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-label,
.dev-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
}

.info-value,
.dev-value {
  font-size: 1rem;
  color: #1f2937;
  word-break: break-all;
}

.hash-value {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(243, 244, 246, 0.5);
  border-radius: 8px;
  transition: background-color 0.2s;
}

.hash-value:hover {
  background: rgba(243, 244, 246, 0.8);
}

.copy-icon {
  color: #6b7280;
  opacity: 0.7;
}

/* Developer Details */
.developer-card {
  border: 2px dashed #d1d5db;
}

.raw-invoice,
.raw-json {
  margin-top: 1rem;
}

.invoice-input {
  margin: 0.5rem 0;
}

.json-display {
  background: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  font-size: 0.875rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.copy-invoice-btn,
.copy-json-btn {
  margin-top: 0.5rem;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.action-btn {
  border-radius: 12px;
  padding: 0.75rem;
  font-weight: 500;
}

/* Error State */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
}

.error-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: #6b7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.error-btn {
  border-radius: 8px;
}

/* Responsive Design */
@media (max-width: 480px) {
  .transaction-content {
    padding: 0.75rem;
  }
  
  .amount-value {
    font-size: 2rem;
  }
  
  .status-section,
  .profile-section,
  .info-section,
  .developer-section {
    padding: 1rem;
  }
  
  .amount-section {
    padding: 1.5rem 1rem;
  }
  
  .action-buttons {
    gap: 0.5rem;
  }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .transaction-details-page {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  }
  
  .page-header,
  .amount-card,
  .profile-card,
  .info-card,
  .developer-card {
    background: #374151;
    border-color: rgba(75, 85, 99, 0.3);
  }
  
  .header-title,
  .transaction-type,
  .profile-name,
  .section-title,
  .info-value,
  .dev-value {
    color: #f9fafb;
  }
  
  .amount-fiat,
  .profile-about,
  .info-label,
  .dev-label {
    color: #d1d5db;
  }
  
  .hash-value {
    background: rgba(55, 65, 81, 0.5);
  }
  
  .json-display {
    background: #1f2937;
    border-color: #374151;
    color: #f9fafb;
  }
}
</style>