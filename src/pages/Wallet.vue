<template>
  <q-page class="wallet-page">
    <!-- Header with Balance -->
    <div class="wallet-header">
      <div class="header-content">
        <div class="logo-container">
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="32" viewBox="0 0 30 32" fill="none">
            <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
                  fill="#059573"/>
            <path
              d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
              fill="#78D53C"/>
            <path
              d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
              fill="#43B65B"/>
          </svg>
          <div class="title">BuhoGO</div>
        </div>
        <q-btn flat round dense icon="las la-cog" @click="$router.push('/settings')" class="settings-btn"/>
      </div>

      <!-- Balance Card -->
      <div class="balance-card">
        <div class="balance-header">
          <div class="balance-label">Total Balance</div>
          <div class="currency-toggle">
            <q-btn-toggle
              v-model="walletState.currency"
              toggle-color="primary"
              :options="[
                {label: 'SATS', value: 'sats'},
                {label: 'BTC', value: 'btc'},
                {label: 'USD', value: 'usd'}
              ]"
              dense
              no-caps
              class="currency-selector"
            />
          </div>
        </div>
        <div class="balance-amount">{{ formatBalance(walletState.balance) }}</div>
        <div class="balance-fiat" v-if="walletState.currency !== 'usd'">
          ≈ ${{ getFiatValue(walletState.balance).toFixed(2) }}
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-buttons">
      <q-btn
        class="action-btn send-btn"
        @click="showSendDialog = true"
        no-caps
        unelevated
      >
        <q-icon name="las la-arrow-up" class="q-mr-sm"/>
        Send
      </q-btn>
      <q-btn
        class="action-btn receive-btn"
        @click="showReceiveDialog = true"
        no-caps
        unelevated
      >
        <q-icon name="las la-arrow-down" class="q-mr-sm"/>
        Receive
      </q-btn>
    </div>

    <!-- Recent Transactions Preview -->
    <div class="transactions-preview">
      <div class="section-header">
        <h3 class="section-title">Recent Activity</h3>
        <q-btn
          flat
          no-caps
          color="primary"
          @click="$router.push('/transactions')"
          class="view-all-btn"
          v-if="recentTransactions.length > 0"
        >
          View All
          <q-icon name="las la-chevron-right" class="q-ml-xs"/>
        </q-btn>
      </div>

      <!-- Transaction List Preview (3-4 items) -->
      <div class="transaction-preview-list" v-if="recentTransactions.length > 0">
        <div
          v-for="(tx, index) in recentTransactions.slice(0, 4)"
          :key="tx.id"
          class="transaction-preview-item"
          @click="viewTransactionDetail(tx)"
        >
          <div class="transaction-avatar">
            <q-avatar
              :color="getTransactionColor(tx)"
              :text-color="getTransactionTextColor(tx)"
              size="44px"
            >
              <q-icon :name="getTransactionIcon(tx)" size="20px"/>
            </q-avatar>
          </div>

          <div class="transaction-info">
            <div class="transaction-description">
              {{ getTransactionDescription(tx) }}
            </div>
            <div class="transaction-meta">
              <span class="transaction-time">{{ formatTransactionTime(tx.settled_at) }}</span>
              <span class="transaction-status" :class="getStatusClass(tx)">
                {{ getTransactionStatus(tx) }}
              </span>
            </div>
            <div class="sender-info" v-if="tx.senderNpub && nostrProfiles[tx.senderNpub]">
              <q-icon name="las la-bolt" size="12px" class="zap-icon"/>
              <span class="sender-name">{{ getSenderDisplayName(tx.senderNpub) }}</span>
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

      <!-- Empty State -->
      <div class="empty-transactions" v-else>
        <q-icon name="las la-receipt" size="3rem" color="grey-4"/>
        <div class="empty-title">No transactions yet</div>
        <div class="empty-subtitle">Your transaction history will appear here</div>
      </div>
    </div>

    <!-- Send Dialog -->
    <q-dialog v-model="showSendDialog" class="send-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Send Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <q-input
            v-model="sendForm.invoice"
            outlined
            label="Lightning Invoice"
            placeholder="Paste lightning invoice or LNURL"
            type="textarea"
            rows="3"
            class="q-mb-md"
          />

          <div class="amount-input-section" v-if="sendForm.decodedInvoice">
            <div class="invoice-details">
              <div class="detail-row">
                <span class="detail-label">Amount:</span>
                <span class="detail-value">{{ formatBalance(sendForm.decodedInvoice.amount) }}</span>
              </div>
              <div class="detail-row" v-if="sendForm.decodedInvoice.description">
                <span class="detail-label">Description:</span>
                <span class="detail-value">{{ sendForm.decodedInvoice.description }}</span>
              </div>
            </div>
          </div>

          <div class="dialog-actions">
            <q-btn
              outline
              label="Scan QR"
              icon="las la-qrcode"
              @click="showQRScanner = true"
              class="scan-btn"
            />
            <q-btn
              color="primary"
              label="Send Payment"
              :loading="isSending"
              :disable="!sendForm.invoice"
              @click="sendPayment"
              class="send-payment-btn"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Receive Dialog -->
    <q-dialog v-model="showReceiveDialog" class="receive-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Receive Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <q-input
            v-model="receiveForm.amount"
            outlined
            label="Amount (sats)"
            type="number"
            class="q-mb-md"
          />

          <q-input
            v-model="receiveForm.description"
            outlined
            label="Description (optional)"
            class="q-mb-md"
          />

          <q-btn
            color="primary"
            label="Create Invoice"
            :loading="isCreatingInvoice"
            @click="createInvoice"
            class="full-width create-invoice-btn"
          />

          <div class="invoice-result" v-if="generatedInvoice">
            <div class="qr-code-container">
              <vue-qrcode
                :value="generatedInvoice.payment_request"
                :options="{ width: 200 }"
                class="qr-code"
              />
            </div>
            <q-input
              v-model="generatedInvoice.payment_request"
              readonly
              outlined
              type="textarea"
              rows="3"
              class="invoice-text"
            />
            <q-btn
              outline
              label="Copy Invoice"
              icon="las la-copy"
              @click="copyInvoice"
              class="full-width copy-btn"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- QR Scanner Dialog -->
    <q-dialog v-model="showQRScanner" class="qr-scanner-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="text-h6">Scan Lightning Invoice</div>
          <q-btn flat round dense icon="las la-times" v-close-popup/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="qr-scanner-container">
            <qrcode-capture @detect="handleQRScan"/>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { QrcodeCapture } from 'vue-qrcode-reader';

export default {
  name: 'WalletPage',
  components: {
    VueQrcode,
    QrcodeCapture
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
      showSendDialog: false,
      showReceiveDialog: false,
      showQRScanner: false,
      isSending: false,
      isCreatingInvoice: false,
      sendForm: {
        invoice: '',
        decodedInvoice: null
      },
      receiveForm: {
        amount: '',
        description: ''
      },
      generatedInvoice: null,
      refreshInterval: null
    }
  },
  async created() {
    await this.loadWalletState();
    await this.loadTransactions();
    await this.loadNostrProfiles();
    this.startPeriodicRefresh();
  },
  beforeUnmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  },
  watch: {
    'sendForm.invoice': {
      handler: 'decodeInvoice',
      immediate: false
    }
  },
  methods: {
    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          this.walletState = JSON.parse(savedState);
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        this.$router.push('/');
      }
    },

    async updateWalletBalance() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const balance = await nwc.getBalance();
          this.walletState.balance = balance.balance;
          activeWallet.balance = balance.balance;

          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        } catch (error) {
          console.error('Failed to update balance:', error);
        }
      }
    },

    async loadTransactions() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const transactionsResponse = await nwc.listTransactions({ limit: 10, offset: 0 });

          if (transactionsResponse && transactionsResponse.transactions) {
            this.recentTransactions = transactionsResponse.transactions.map(tx => ({
              ...tx,
              id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
              type: tx.type || (tx.amount > 0 ? 'incoming' : 'outgoing'),
              description: tx.description || tx.memo || 'Lightning transaction',
              settled_at: tx.settled_at || tx.created_at || Math.floor(Date.now() / 1000)
            }));

            await this.processZapTransactions();
          }
        } catch (error) {
          console.error('Failed to load transactions:', error);
        }
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
        // Mock implementation - replace with actual nostr client
        const profile = {
          name: npub.substring(0, 12) + '...',
          displayName: 'Nostr User',
          picture: null,
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

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        await this.updateWalletBalance();
        await this.loadTransactions();
      }, 30000); // Refresh every 30 seconds
    },

    formatBalance(balance) {
      switch (this.walletState.currency) {
        case 'btc':
          return (balance / 100000000).toFixed(8) + ' BTC';
        case 'usd':
          const usdValue = (balance / 100000000) * (this.walletState.exchangeRates.usd || 65000);
          return '$' + usdValue.toFixed(2);
        case 'sats':
        default:
          return balance.toLocaleString() + ' sats';
      }
    },

    getFiatValue(balance) {
      const btcAmount = balance / 100000000;
      return btcAmount * (this.walletState.exchangeRates.usd || 65000);
    },

    getTransactionDescription(tx) {
      if (tx.senderNpub && this.nostrProfiles[tx.senderNpub]) {
        return `Zap from ${this.getSenderDisplayName(tx.senderNpub)}`;
      }
      return tx.description || 'Lightning Transaction';
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

    getFiatAmount(tx) {
      const btcAmount = Math.abs(tx.amount) / 100000000;
      const fiatValue = btcAmount * (this.walletState.exchangeRates.usd || 65000);
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

    viewTransactionDetail(tx) {
      this.$router.push(`/transaction/${tx.id}`);
    },

    async decodeInvoice() {
      if (!this.sendForm.invoice) {
        this.sendForm.decodedInvoice = null;
        return;
      }

      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const decoded = await nwc.decodeInvoice(this.sendForm.invoice);
          this.sendForm.decodedInvoice = decoded;
        }
      } catch (error) {
        console.error('Failed to decode invoice:', error);
        this.sendForm.decodedInvoice = null;
      }
    },

    async sendPayment() {
      if (!this.sendForm.invoice) return;

      this.isSending = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const result = await nwc.sendPayment(this.sendForm.invoice);

          this.$q.notify({
            type: 'positive',
            message: 'Payment sent successfully!',
            position: 'top'
          });

          this.showSendDialog = false;
          this.sendForm.invoice = '';
          this.sendForm.decodedInvoice = null;

          await this.updateWalletBalance();
          await this.loadTransactions();
        }
      } catch (error) {
        console.error('Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Payment failed: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isSending = false;
      }
    },

    async createInvoice() {
      if (!this.receiveForm.amount) return;

      this.isCreatingInvoice = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet) {
          const nwc = new webln.NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const invoice = await nwc.makeInvoice({
            amount: parseInt(this.receiveForm.amount),
            description: this.receiveForm.description || 'BuhoGO Invoice'
          });

          this.generatedInvoice = invoice;
        }
      } catch (error) {
        console.error('Failed to create invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to create invoice: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    async copyInvoice() {
      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: 'Invoice copied to clipboard!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
      }
    },

    handleQRScan(result) {
      this.sendForm.invoice = result;
      this.showQRScanner = false;
    }
  }
}
</script>

<style scoped>
.wallet-page {
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  min-height: 100vh;
}

/* Header Styles */
.wallet-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #10b981, #059669);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.settings-btn {
  color: #6b7280;
}

/* Balance Card */
.balance-card {
  background: linear-gradient(135deg, #10b981, #059669);
  border-radius: 16px;
  padding: 1.5rem;
  color: white;
  position: relative;
  overflow: hidden;
}

.balance-card::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
  pointer-events: none;
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.balance-label {
  font-size: 0.875rem;
  opacity: 0.9;
}

.currency-selector {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
}

.balance-amount {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.balance-fiat {
  font-size: 1rem;
  opacity: 0.8;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 1rem;
  padding: 1rem;
}

.action-btn {
  flex: 1;
  height: 48px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 1rem;
}

.send-btn {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
}

.receive-btn {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
}

/* Transactions Preview */
.transactions-preview {
  padding: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.view-all-btn {
  font-weight: 500;
  text-transform: none;
}

.transaction-preview-list {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.transaction-preview-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  cursor: pointer;
  transition: background-color 0.2s;
}

.transaction-preview-item:hover {
  background-color: rgba(243, 244, 246, 0.5);
}

.transaction-preview-item:last-child {
  border-bottom: none;
}

.transaction-avatar {
  margin-right: 1rem;
}

.transaction-info {
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
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.25rem;
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
  gap: 0.25rem;
  color: #8b5cf6;
  font-size: 0.75rem;
  font-weight: 500;
}

.zap-icon {
  color: #fbbf24;
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Empty State */
.empty-transactions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  background: white;
  border-radius: 16px;
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
.dialog-card {
  width: 100%;
  max-width: 500px;
  border-radius: 16px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.dialog-content {
  padding: 1rem;
}

.dialog-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.scan-btn {
  flex: 1;
}

.send-payment-btn,
.create-invoice-btn {
  flex: 2;
}

.invoice-details {
  background: rgba(243, 244, 246, 0.5);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-weight: 500;
  color: #6b7280;
}

.detail-value {
  font-weight: 600;
  color: #1f2937;
}

.invoice-result {
  margin-top: 1rem;
  text-align: center;
}

.qr-code-container {
  margin-bottom: 1rem;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
}

.invoice-text {
  margin-bottom: 1rem;
}

.qr-scanner-container {
  height: 300px;
  border-radius: 8px;
  overflow: hidden;
}

/* Responsive Design */
@media (max-width: 480px) {
  .balance-amount {
    font-size: 2rem;
  }
  
  .action-buttons {
    padding: 0.75rem;
  }
  
  .action-btn {
    height: 44px;
    font-size: 0.875rem;
  }
  
  .transactions-preview {
    padding: 0.75rem;
  }
  
  .transaction-preview-item {
    padding: 0.75rem;
  }
}
</style>