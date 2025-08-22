<template>
  <q-page class="transaction-detail-page">
    <!-- Header -->
    <q-toolbar class="detail-header">
      <q-btn flat round dense icon="las la-arrow-left" class="q-mr-sm" @click="$router.back()"/>
      <div class="header-content">
        <div class="title">Transaction Details</div>
      </div>
      <q-space/>
      <q-btn flat round dense icon="las la-share-alt" @click="shareTransaction" v-if="!loading"/>
      <q-btn flat round dense icon="las la-code" @click="toggleDeveloperMode" v-if="!loading">
        <q-tooltip>{{ developerMode ? 'User View' : 'Developer View' }}</q-tooltip>
      </q-btn>
    </q-toolbar>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <q-spinner-dots color="primary" size="2rem"/>
      <div class="loading-text">Loading transaction details...</div>
    </div>

    <!-- Transaction Details -->
    <div v-else class="detail-content">
      <!-- Transaction Summary Card -->
      <q-card class="summary-card">
        <q-card-section class="summary-section">
          <div class="transaction-icon-container">
            <q-avatar 
              :color="getTransactionColor(details)" 
              :text-color="getTransactionTextColor(details)"
              size="64px"
            >
              <q-icon :name="getTransactionIcon(details)" size="32px"/>
            </q-avatar>
          </div>
          
          <div class="transaction-summary">
            <div class="transaction-type">
              {{ details.type === 'incoming' ? 'Received' : 'Sent' }}
              <span v-if="details.senderNpub" class="zap-badge">⚡ Zap</span>
            </div>
            <div class="transaction-amount-large" :class="getAmountClass(details)">
              {{ getFormattedAmount(details) }}
            </div>
            <div class="transaction-fiat">
              {{ getFiatAmount(details) }}
            </div>
            <div class="transaction-status-badge" :class="getStatusClass(details)">
              <q-icon name="las la-check-circle" size="16px" class="q-mr-xs"/>
              {{ getTransactionStatus(details) }}
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Transaction Information -->
      <q-card class="info-card">
        <q-card-section class="info-header">
          <div class="info-title">Transaction Information</div>
        </q-card-section>
        
        <q-card-section class="info-content">
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Description</div>
  </q-page>
</template>

<script>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
// Assume LN or nwc utils are globally available or import as needed

export default {
  name: 'TransactionDetails',
  setup() {
    const route = useRoute();
    const loading = ref(true);
    const details = ref({
      status: '',
      amount: '',
      description: '',
      settled_at: '',
      destination: '',
      rawInvoice: '',
    });

    function formatDate(ts) {
      if (!ts) return '';
      const d = new Date(ts * 1000);
      return d.toLocaleString();
    }

    const statusColor = computed(() => {
      if (details.value.status === 'paid') return 'text-green-8';
      if (details.value.status === 'unpaid') return 'text-orange-8';
      return 'text-grey-7';
    });

    async function fetchDetails() {
      loading.value = true;
      try {
        // Get transaction from local state or fetch from backend if needed
        // For now, try to get from localStorage (Wallet.vue keeps transactions in local state)
        const txId = route.params.id;
        let tx = null;
        const walletState = JSON.parse(localStorage.getItem('buhoGO_wallet_state'));
        if (walletState && walletState.transactions) {
          tx = walletState.transactions.find(t => t.id == txId);
        }
        // If not found, fallback to window.transactions (if set by Wallet.vue)
        if (!tx && window.transactions) {
          tx = window.transactions.find(t => t.id == txId);
        }
        if (!tx) {
          details.value.description = 'Transaction not found.';
          loading.value = false;
          return;
        }
        // Lookup invoice using SDK (simulate for now)
        let invoiceData = {};
        if (tx.payment_request) {
          // Use SDK to decode invoice
          try {
            const nwcString = walletState.connectedWallets.find(w => w.id === walletState.activeWalletId).nwcString;
            const nwc = new window.webln.NostrWebLNProvider({ nostrWalletConnectUrl: nwcString });
            await nwc.enable();
            invoiceData = await nwc.decodeInvoice(tx.payment_request);
          } catch (e) {
            invoiceData = {};
          }
        }
        details.value = {
          status: tx.status || (tx.settled ? 'paid' : 'unpaid'),
          amount: tx.amount || invoiceData.amount || '',
          description: tx.description || invoiceData.description || '',
          settled_at: tx.settled_at || tx.timestamp || '',
          destination: invoiceData.destination || '',
          rawInvoice: tx.payment_request || '',
        };
      } finally {
        loading.value = false;
      }
    }

    onMounted(fetchDetails);

    return { loading, details, formatDate, statusColor };
  },
};
</script>

<style scoped>
.text-green-8 { color: #22c55e; }
.text-orange-8 { color: #f59e42; }
.text-grey-7 { color: #6b7280; }
</style> 