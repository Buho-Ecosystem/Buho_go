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
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 30 32" fill="none" class="logo-svg">
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
        <q-btn 
          flat 
          round 
          dense 
          class="modern-menu-btn"
          @click="$router.push('/settings')" 
          aria-label="Settings"
        >
          <div class="menu-icon">
            <div class="menu-line"></div>
            <div class="menu-line"></div>
            <div class="menu-line"></div>
          </div>
        </q-btn>
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-content">
      <!-- Balance Display -->
      <div class="balance-section">
        <div class="balance-container" @click="toggleCurrency" :class="{ 'switching': isSwitchingCurrency }">
          <div class="balance-amount">
            <transition name="balance-fade" mode="out-in">
              <div :key="currentDisplayMode" class="amount-display">
                <span class="amount-number">{{ formatMainBalance(walletState.balance) }}</span>
                <span class="amount-unit">{{ getCurrentUnit() }}</span>
              </div>
            </transition>
          </div>
          <transition name="secondary-fade" mode="out-in">
            <div :key="currentDisplayMode" class="balance-secondary">
              {{ getSecondaryValue(walletState.balance) }}
            </div>
          </transition>
        </div>
      </div>

      <!-- Transaction History Icon -->
      <div class="transaction-icon-section">
        <q-btn
          flat
          round
          size="md"
          icon="las la-history"
          @click="$router.push('/transactions')"
          class="transaction-history-btn"
          aria-label="Transaction History"
          :class="{ 'pulse': shouldPulse }"
        />
      </div>
    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <div class="action-buttons">
        <q-btn
          class="action-btn receive-btn"
          @click="showReceiveDialog = true"
          no-caps
          unelevated
          aria-label="Receive payment"
        >
          <q-icon name="las la-arrow-down" size="24px"/>
          <div class="btn-text">Receive</div>
        </q-btn>
        <q-btn
          class="action-btn send-btn"
          @click="showSendDialog = true"
          no-caps
          unelevated
          aria-label="Send payment"
        >
          <q-icon name="las la-arrow-up" size="24px"/>
          <div class="btn-text">Send</div>
        </q-btn>
      </div>
    </div>

    <!-- Send Dialog -->
    <q-dialog v-model="showSendDialog" class="payment-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Send Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Payment Input -->
          <div class="payment-input-section">
            <q-input
              v-model="sendForm.input"
              outlined
              label="Payment Details"
              placeholder="Invoice, LNURL, or Lightning Address"
              type="textarea"
              rows="3"
              class="payment-input"
            />
            
            <div class="input-actions">
              <q-btn
                flat
                color="primary"
                icon="las la-qrcode"
                label="Scan QR"
                @click="showQRScanner = true"
                class="action-btn scan-btn"
                no-caps
              />
              <q-btn
                flat
                color="primary"
                icon="las la-paste"
                label="Paste"
                @click="pasteFromClipboard"
                class="action-btn paste-btn"
                no-caps
              />
            </div>
          </div>

          <!-- Payment Type Indicator -->
          <div class="payment-type-section" v-if="paymentData">
            <div class="type-indicator">
              <q-icon name="las la-bolt" class="type-icon"/>
              <span class="type-label">{{ getPaymentTypeLabel() }}</span>
            </div>
          </div>

          <!-- Amount Input for LNURL/Lightning Address -->
          <div class="amount-section" v-if="requiresAmount()">
            <div class="amount-limits" v-if="getAmountLimits()">
              <q-icon name="las la-info-circle" class="limits-icon"/>
              <span>Amount: {{ getAmountLimits().min }} - {{ getAmountLimits().max }} sats</span>
            </div>
            
            <q-input
              v-model="sendForm.amount"
              outlined
              label="Amount (sats)"
              type="number"
              class="amount-input"
            />
            
            <q-input
              v-model="sendForm.comment"
              outlined
              label="Comment (optional)"
              :maxlength="paymentData.commentAllowed || 0"
              :disable="!paymentData.commentAllowed"
              :hint="paymentData.commentAllowed ? `Max ${paymentData.commentAllowed} characters` : 'Comments not supported'"
              class="comment-input"
            />
          </div>

          <!-- Invoice Details -->
          <div class="invoice-preview" v-if="paymentData && paymentData.type === 'lightning_invoice'">
            <div class="invoice-details">
              <div class="preview-header">
                <q-icon name="las la-receipt" class="preview-icon"/>
                <span class="preview-title">Invoice Preview</span>
              </div>
              
              <div class="preview-content">
                <div class="detail-item">
                  <span class="detail-label">Amount</span>
                  <span class="detail-value amount-value">{{ formatBalance(paymentData.amount) }}</span>
                </div>
                <div class="detail-item" v-if="paymentData.description">
                  <span class="detail-label">Description</span>
                  <span class="detail-value">{{ paymentData.description }}</span>
                </div>
                <div class="detail-item" v-if="paymentData.expiry">
                  <span class="detail-label">Expires</span>
                  <span class="detail-value">{{ formatExpiry(paymentData.expiry) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Send Button -->
          <q-btn
            :loading="isSending"
            :disable="!canSendPayment()"
            @click="sendPayment"
            class="send-payment-btn"
            unelevated
            no-caps
          >
            <q-icon name="las la-paper-plane" class="q-mr-sm"/>
            <span v-if="!isSending">Send Payment</span>
            <span v-else>Sending...</span>
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Receive Dialog -->
    <q-dialog v-model="showReceiveDialog" class="payment-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Receive Lightning Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Invoice Form -->
          <div class="invoice-form" v-if="!generatedInvoice">
            <q-input
              v-model="receiveForm.amount"
              outlined
              label="Amount (sats)"
              type="number"
              class="amount-input"
              :rules="[val => val > 0 || 'Amount must be greater than 0']"
            />

            <q-input
              v-model="receiveForm.description"
              outlined
              label="Description (optional)"
              class="description-input"
              maxlength="100"
            />

            <q-btn
              :loading="isCreatingInvoice"
              @click="createInvoice"
              class="create-invoice-btn"
              :disable="!receiveForm.amount || receiveForm.amount <= 0"
              unelevated
              no-caps
            >
              <q-icon name="las la-plus-circle" class="q-mr-sm"/>
              <span v-if="!isCreatingInvoice">Create Invoice</span>
              <span v-else>Creating...</span>
            </q-btn>
          </div>

          <!-- Generated Invoice -->
          <div class="invoice-result" v-if="generatedInvoice">
            <!-- QR Code -->
            <div class="qr-section">
              <vue-qrcode
                :value="generatedInvoice.payment_request"
                :options="{ width: 200 }"
                class="qr-code"
              />
            </div>
            
            <!-- Invoice Info -->
            <div class="invoice-info">
              <div class="invoice-amount">
                {{ formatBalance(generatedInvoice.amount || receiveForm.amount) }}
              </div>
              <div class="invoice-description" v-if="receiveForm.description">
                {{ receiveForm.description }}
              </div>
            </div>
            
            <!-- Invoice String -->
            <div class="invoice-string">
              <q-input
                v-model="generatedInvoice.payment_request"
                readonly
                outlined
                type="textarea"
                rows="3"
                class="invoice-text"
                label="Lightning Invoice"
              />
            </div>
            
            <!-- Action Buttons -->
            <div class="invoice-actions">
              <q-btn
                flat
                color="primary"
                icon="las la-copy"
                label="Copy"
                @click="copyInvoice"
                class="copy-btn"
                no-caps
              />
              <q-btn
                flat
                color="primary"
                icon="las la-share-alt"
                label="Share"
                @click="shareInvoice"
                class="share-btn"
                no-caps
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- QR Scanner Dialog -->
    <q-dialog v-model="showQRScanner" class="payment-dialog">
      <q-card class="dialog-card">
        <q-card-section class="dialog-header">
          <div class="dialog-title">Scan Lightning Invoice</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="qr-scanner-container">
            <qrcode-capture @detect="handleQRScan" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { webln } from "@getalby/sdk";
import { LightningPaymentService } from '../utils/lightning.js';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { QrcodeCapture } from 'vue-qrcode-reader';
import LoadingScreen from '../components/LoadingScreen.vue';

export default {
  name: 'WalletPage',
  components: {
    VueQrcode,
    QrcodeCapture,
    LoadingScreen
  },
  data() {
    return {
      walletState: {
        balance: 312,
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
        denominationCurrency: 'sats',
        displayMode: 'sats'
      },
      recentTransactions: [],
      nostrProfiles: {},
      showSendDialog: false,
      showReceiveDialog: false,
      showQRScanner: false,
      isSending: false,
      isCreatingInvoice: false,
      isSwitchingCurrency: false,
      shouldPulse: false,
      paymentData: null,
      lightningAddress: '',
      sendForm: {
        input: '',
        amount: '',
        comment: ''
      },
      receiveForm: {
        amount: '',
        description: ''
      },
      generatedInvoice: null,
      refreshInterval: null,
      pulseInterval: null,
      showLoadingScreen: true,
      loadingText: 'Loading wallet...'
    };
  },
  computed: {
    currentDisplayMode() {
      return this.walletState.displayMode || 'sats';
    }
  },
  async created() {
    this.initializeWallet();
  },
  beforeUnmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
    }
  },
  watch: {
    'sendForm.input': {
      handler: 'processPaymentInput',
      immediate: false
    }
  },
  methods: {
    async initializeWallet() {
      try {
        this.loadingText = 'Loading wallet state...';
    await this.loadWalletState();
        
        this.loadingText = 'Fetching transactions...';
    await this.loadTransactions();
        
        this.loadingText = 'Loading profiles...';
    await this.loadNostrProfiles();
        
        this.loadingText = 'Starting services...';
    this.startPeriodicRefresh();
    this.startPulseAnimation();
        
        // Hide loading screen
        this.loadingText = 'Ready!';
        await new Promise(resolve => setTimeout(resolve, 500));
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing wallet:', error);
        this.loadingText = 'Error loading wallet';
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.showLoadingScreen = false;
      }
    },
    
    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          this.walletState = { ...this.walletState, ...parsedState };
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        // For demo purposes, keep the 312 sats balance
        this.walletState.balance = 312;
      }
    },

    async updateWalletBalance() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
          // Show loading for balance updates only if it's a manual refresh
          if (this.showLoadingScreen) {
            this.loadingText = 'Updating balance...';
          }
          
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
      // Mock implementation for demo
      this.recentTransactions = [];
    },

    async processZapTransactions() {
      // Mock implementation
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
      // Mock implementation
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
      }, 30000);
    },

    startPulseAnimation() {
      this.pulseInterval = setInterval(() => {
        this.shouldPulse = true;
        setTimeout(() => {
          this.shouldPulse = false;
        }, 1000);
      }, 25000);
    },

    async toggleCurrency() {
      if (this.isSwitchingCurrency) return;
      
      this.isSwitchingCurrency = true;
      
      const modes = ['sats', 'fiat', 'btc'];
      const currentIndex = modes.indexOf(this.currentDisplayMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      
      this.walletState.displayMode = modes[nextIndex];
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
      
      setTimeout(() => {
        this.isSwitchingCurrency = false;
      }, 200);
    },

    formatMainBalance(balance) {
      switch (this.currentDisplayMode) {
        case 'btc':
          const btcAmount = balance / 100000000;
          // Show in sats if BTC amount is very small (less than 0.001 BTC)
          if (btcAmount < 0.001) {
            return balance.toLocaleString();
          }
          return btcAmount.toFixed(8);
        case 'fiat':
          const btcAmountForFiat = balance / 100000000;
          const rate = this.walletState.exchangeRates[this.walletState.preferredFiatCurrency.toLowerCase()] || 65000;
          const fiatValue = btcAmountForFiat * rate;
          return fiatValue.toFixed(2);
        case 'sats':
        default:
          return balance.toLocaleString();
      }
    },

    getCurrentUnit() {
      switch (this.currentDisplayMode) {
        case 'btc':
          const btcAmount = this.walletState.balance / 100000000;
          // Show sats unit if BTC amount is very small
          if (btcAmount < 0.001) {
            return 'sats';
          }
          return 'BTC';
        case 'fiat':
          return this.walletState.preferredFiatCurrency || 'USD';
        case 'sats':
        default:
          return 'sats';
      }
    },

    getSecondaryValue(balance) {
      switch (this.currentDisplayMode) {
        case 'btc':
          const btcAmountForSecondary = balance / 100000000;
          // Show fiat value if displaying sats due to small BTC amount
          if (btcAmountForSecondary < 0.001) {
            return this.getFiatValue(balance);
          }
          return balance.toLocaleString() + ' sats';
        case 'fiat':
          return balance.toLocaleString() + ' sats';
        case 'sats':
        default:
          return this.getFiatValue(balance);
      }
    },

    formatBalance(balance) {
      return balance.toLocaleString() + ' sats';
    },

    getFiatValue(balance) {
      const btcAmount = balance / 100000000;
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

    async processPaymentInput() {
      this.paymentData = null;
      this.sendForm.amount = '';
      this.sendForm.comment = '';

      if (!this.sendForm.input.trim()) return;

      try {
        const validation = LightningPaymentService.validatePaymentInput(this.sendForm.input);
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        const activeWallet = this.getActiveWallet();
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        this.paymentData = await lightningService.processPaymentInput(this.sendForm.input.trim());
        
        if (this.paymentData.type === 'lightning_invoice' && this.paymentData.amount === 0) {
          this.paymentData.requiresAmount = true;
        }
        
      } catch (error) {
        console.error('Error processing payment input:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message,
          position: 'top'
        });
      }
    },

    getActiveWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );
    },

    getPaymentTypeLabel() {
      if (!this.paymentData) return '';
      
      const labels = {
        'lightning_invoice': 'Lightning Invoice',
        'lnurl_pay': 'LNURL Payment',
        'lightning_address': 'Lightning Address'
      };
      return labels[this.paymentData.type] || 'Lightning Payment';
    },

    requiresAmount() {
      if (!this.paymentData) return false;
      
      return this.paymentData.type === 'lnurl_pay' || 
             this.paymentData.type === 'lightning_address' ||
             (this.paymentData.type === 'lightning_invoice' && this.paymentData.requiresAmount);
    },

    getAmountLimits() {
      if (!this.paymentData) return null;
      
      return {
        min: Math.floor(this.paymentData.minSendable / 1000),
        max: Math.floor(this.paymentData.maxSendable / 1000)
      };
    },

    canSendPayment() {
      if (!this.paymentData) return false;
      
      if (this.requiresAmount()) {
        const amount = parseInt(this.sendForm.amount);
        if (!amount || amount <= 0) return false;
        
        if (this.paymentData.type !== 'lightning_invoice') {
          const limits = this.getAmountLimits();
          return amount >= limits.min && amount <= limits.max;
        }
        return true;
      }
      
      return true;
    },

    async pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        this.sendForm.input = text;
        await this.processPaymentInput();
      } catch (error) {
        console.error('Failed to paste from clipboard:', error);
      }
    },

    async sendPayment() {
      if (!this.canSendPayment()) return;

      this.isSending = true;
      try {
        const activeWallet = this.getActiveWallet();
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);

        const amount = this.requiresAmount() ? parseInt(this.sendForm.amount) : null;
        const comment = this.sendForm.comment || null;

        const result = await lightningService.sendPayment(this.paymentData, amount, comment);
        
        console.log('Payment result:', result);

        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'top'
        });

        this.showSendDialog = false;
        this.resetSendForm();
        await this.updateWalletBalance();
        await this.loadTransactions();
        
      } catch (error) {
        console.error('Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message,
          position: 'top'
        });
      } finally {
        this.isSending = false;
      }
    },

    resetSendForm() {
      this.sendForm.input = '';
      this.sendForm.amount = '';
      this.sendForm.comment = '';
      this.paymentData = null;
    },

    async createInvoice() {
      if (!this.receiveForm.amount) return;

      this.isCreatingInvoice = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (!activeWallet) throw new Error('No active wallet');

        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        await lightningService.enable();

        this.generatedInvoice = await lightningService.createInvoice(
          this.receiveForm.amount,
          this.receiveForm.description
        );
      } catch (error) {
        console.error('Failed to create invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message,
          position: 'top'
        });
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    handleQRScan(result) {
      this.sendForm.input = result;
      this.showQRScanner = false;
      this.processPaymentInput();
    },

    async copyInvoice() {
      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: 'Invoice copied!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
      }
    },

    async shareInvoice() {
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Lightning Invoice',
            text: `Payment request for ${this.formatBalance(this.receiveForm.amount)}`,
            url: `lightning:${this.generatedInvoice.payment_request}`
          });
        } catch (error) {
          console.error('Failed to share invoice:', error);
        }
      } else {
        this.copyInvoice();
      }
    },

    formatExpiry(expiry) {
      const expiryDate = new Date(expiry * 1000);
      const now = new Date();
      const diffMinutes = Math.floor((expiryDate - now) / (1000 * 60));
      
      if (diffMinutes < 0) return 'Expired';
      if (diffMinutes < 60) return `${diffMinutes} minutes`;
      if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} hours`;
      return `${Math.floor(diffMinutes / 1440)} days`;
    }
  }
};
</script>

<style scoped>
.wallet-page {
  background: #f8f9fa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.wallet-header {
  background: white;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo-svg {
  filter: drop-shadow(0 2px 4px rgba(5, 149, 115, 0.15));
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #78D53C);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.modern-menu-btn {
  color: #6b7280;
  transition: all 0.2s;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modern-menu-btn:hover {
  color: #374151;
  background: #f3f4f6;
  transform: translateY(-1px);
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 18px;
  height: 14px;
}

.menu-line {
  height: 2px;
  background: currentColor;
  border-radius: 1px;
  transition: all 0.3s ease;
}

.menu-line:nth-child(1) {
  width: 100%;
}

.menu-line:nth-child(2) {
  width: 75%;
}

.menu-line:nth-child(3) {
  width: 100%;
}

.modern-menu-btn:hover .menu-line:nth-child(1) {
  width: 75%;
}

.modern-menu-btn:hover .menu-line:nth-child(2) {
  width: 100%;
}

.modern-menu-btn:hover .menu-line:nth-child(3) {
  width: 85%;
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2rem 1rem 8rem 1rem;
}

/* Balance Section */
.balance-section {
  text-align: center;
  margin-bottom: 2rem;
}

.balance-container {
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 16px;
  padding: 1rem;
}

.balance-container:hover {
  background: rgba(255, 255, 255, 0.5);
  transform: translateY(-2px);
}

.balance-amount {
  margin-bottom: 1rem;
}

.amount-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.75rem;
}

.amount-number {
  font-size: 4rem;
  font-weight: 800;
  color: #1f2937;
  line-height: 1;
}

.amount-unit {
  font-size: 1.5rem;
  color: #6b7280;
  font-weight: 600;
}

.balance-secondary {
  font-size: 1.25rem;
  color: #9ca3af;
  font-weight: 400;
}

/* Balance Transitions */
.balance-fade-enter-active,
.balance-fade-leave-active,
.secondary-fade-enter-active,
.secondary-fade-leave-active {
  transition: all 0.2s ease;
}

.balance-fade-enter-from,
.balance-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.secondary-fade-enter-from,
.secondary-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Transaction History Button */
.transaction-icon-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.transaction-history-btn {
  width: 48px;
  height: 48px;
  background: #f3f4f6;
  color: #9ca3af;
  border-radius: 50%;
  transition: all 0.3s ease;
  opacity: 0.6;
}

.transaction-history-btn:hover {
  background: #059573;
  color: white;
  transform: translateY(-2px) scale(1.05);
  opacity: 1;
  box-shadow: 0 4px 16px rgba(5, 149, 115, 0.3);
}

.transaction-history-btn.pulse {
  animation: subtle-pulse 1s ease-out;
}

@keyframes subtle-pulse {
  0% { 
    opacity: 0.6; 
    transform: scale(1);
  }
  50% { 
    opacity: 0.8; 
    transform: scale(1.02);
  }
  100% { 
    opacity: 0.6; 
    transform: scale(1);
  }
}

/* Bottom Actions */
.bottom-actions {
  background: white;
  padding: 1rem 1.5rem 2rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.05);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  max-width: 400px;
  margin: 0 auto;
}

.action-btn {
  flex: 1;
  height: 72px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  font-weight: 600;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  min-height: 72px;
  min-width: 120px;
}

.action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.action-btn:active {
  transform: translateY(0) scale(0.98);
}

.receive-btn {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
}

.receive-btn:hover {
  background: linear-gradient(135deg, #047857, #059573);
}

.send-btn {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.send-btn:hover {
  background: linear-gradient(135deg, #2563EB, #1D4ED8);
}

.btn-text {
  font-size: 1rem;
  font-weight: 600;
}

/* Dialog Styles */
.payment-dialog .dialog-card {
  width: 100%;
  max-width: 480px;
  border-radius: 20px;
  overflow: hidden;
}

.payment-dialog .dialog-header {
  background: #f8f9fa;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

.payment-dialog .dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.payment-dialog .close-btn {
  color: #6b7280;
}

.payment-dialog .dialog-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Payment Input Section */
.payment-input-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.payment-input {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
  font-size: 0.875rem;
}

.input-actions {
  display: flex;
  gap: 0.75rem;
}

.action-btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.scan-btn {
  color: #059573;
  border-color: #059573;
}

.scan-btn:hover {
  background: #059573;
  color: white;
}

.paste-btn {
  color: #3b82f6;
  border-color: #3b82f6;
}

.paste-btn:hover {
  background: #3b82f6;
  color: white;
}

/* Payment Type Section */
.payment-type-section {
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid rgba(5, 149, 115, 0.2);
  border-radius: 12px;
  padding: 1rem;
}

.type-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.type-icon {
  color: #059573;
  font-weight: 500;
}

.type-label {
  color: #059573;
  font-weight: 500;
}

/* Amount Section */
.amount-section {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount-limits {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  background: white;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.limits-icon {
  color: #3b82f6;
  font-size: 16px;
}

/* Invoice Preview */
.invoice-preview {
  background: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.invoice-details {
  padding: 1.5rem;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.preview-icon {
  color: #059573;
  font-weight: 600;
}

.preview-title {
  color: #1f2937;
  font-weight: 600;
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.detail-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.detail-value {
  font-size: 0.875rem;
  color: #1f2937;
  font-weight: 500;
  text-align: right;
}

.amount-value {
  color: #059573;
  font-weight: 600;
  font-size: 1rem;
}

/* Send Payment Button */
.send-payment-btn {
  width: 100%;
  height: 52px;
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
  border-radius: 16px;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.send-payment-btn:hover {
  background: linear-gradient(135deg, #047857, #059573);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(5, 149, 115, 0.3);
}

/* Invoice Form */
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.create-invoice-btn {
  width: 100%;
  height: 52px;
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
  border-radius: 16px;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.create-invoice-btn:hover {
  background: linear-gradient(135deg, #047857, #059573);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(5, 149, 115, 0.3);
}

/* Invoice Result */
.invoice-result {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  text-align: center;
}

.qr-section {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
  background: white;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
}

.invoice-info {
  padding: 1.5rem;
  background: #f9fafb;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
}

.invoice-amount {
  font-size: 2rem;
  font-weight: 800;
  color: #059573;
  margin-bottom: 0.75rem;
}

.invoice-description {
  color: #6b7280;
  font-size: 1rem;
  font-weight: 500;
}

.invoice-string {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1rem;
}

.invoice-text :deep(.q-field__control) {
  font-family: monospace;
  font-size: 0.8rem;
  background: white;
}

.invoice-actions {
  display: flex;
  gap: 0.75rem;
}

.copy-btn,
.share-btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.copy-btn {
  color: #059573;
  border-color: rgba(5, 149, 115, 0.3);
}

.copy-btn:hover,
.copy-btn:focus {
  background: #059573;
  color: white;
  border-color: #059573;
}

.share-btn {
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.3);
}

.share-btn:hover,
.share-btn:focus {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

/* QR Scanner */
.qr-scanner-container {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  background: #f8f9fa;
}

/* Responsive Design */
@media (max-width: 480px) {
  .bottom-actions {
    padding: 0.75rem 1rem 1.5rem 1rem;
  }
  
  .action-buttons {
    gap: 0.75rem;
  }
  
  .action-btn {
    height: 68px;
    min-height: 68px;
    min-width: 100px;
  }
  
  .main-content {
    padding: 1.5rem 1rem 7rem 1rem;
  }
  
  .amount-number {
    font-size: 3rem;
  }
  
  .amount-unit {
    font-size: 1.25rem;
  }
  
  .payment-dialog .dialog-header,
  .payment-dialog .dialog-content {
    padding: 1rem;
  }
  
  .payment-dialog .dialog-content {
    gap: 1rem;
  }
  
  .input-actions {
    flex-direction: column;
  }
  
  .action-btn {
    height: 40px;
  }
  
  .invoice-amount {
    font-size: 1.5rem;
  }
  
  .send-payment-btn,
  .create-invoice-btn {
    height: 48px;
    font-size: 0.9rem;
  }
  
  .invoice-actions {
    flex-direction: column;
  }
  
  .copy-btn,
  .share-btn {
    height: 40px;
  }
  
  .qr-scanner-container {
    height: 250px;
  }
}
</style>