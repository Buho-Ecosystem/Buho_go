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
          @click="showReceiveModal = true"
          no-caps
          unelevated
          aria-label="Receive payment"
        >
          <q-icon name="las la-arrow-down" size="24px"/>
          <div class="btn-text">Receive</div>
        </q-btn>
        <q-btn
          class="action-btn send-btn"
          @click="showSendModal = true"
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
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Receive Modal -->
    <ReceiveModal 
      v-model="showReceiveModal"
      @invoice-created="onInvoiceCreated"
    />

    <!-- Send Modal -->
    <SendModal 
      v-model="showSendModal"
      @payment-detected="onPaymentDetected"
    />

    <!-- Payment Confirmation Dialog -->
    <q-dialog v-model="showPaymentConfirmation" class="payment-dialog">
      <q-card class="payment-card">
        <q-card-section class="payment-header">
          <div class="payment-title">Confirm Payment</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="payment-content" v-if="pendingPayment">
          <div class="payment-info">
            <div class="payment-amount">
              <div class="amount-display">{{ formatPaymentAmount() }}</div>
              <div class="amount-fiat">{{ formatPaymentFiat() }}</div>
            </div>
            
            <div class="payment-details">
              <div class="detail-item" v-if="pendingPayment.description">
                <span class="detail-label">Description:</span>
                <span class="detail-value">{{ pendingPayment.description }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Type:</span>
                <span class="detail-value">{{ getPaymentTypeLabel() }}</span>
              </div>
            </div>

            <!-- Amount input for LNURL/Lightning Address -->
            <div v-if="needsAmountInput" class="amount-input-section">
              <q-input
                v-model="paymentAmount"
                outlined
                label="Amount (sats)"
                type="number"
                :min="pendingPayment.minSendable ? Math.floor(pendingPayment.minSendable / 1000) : 1"
                :max="pendingPayment.maxSendable ? Math.floor(pendingPayment.maxSendable / 1000) : 100000000"
                class="amount-input"
                :rules="[validatePaymentAmount]"
              />
              
              <q-input
                v-if="pendingPayment.commentAllowed > 0"
                v-model="paymentComment"
                outlined
                label="Comment (optional)"
                :maxlength="pendingPayment.commentAllowed"
                class="comment-input"
              />
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
            :disable="!canConfirmPayment"
          />
        </q-card-actions>
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
              min="1"
              class="amount-input"
              :rules="[val => val > 0 || 'Amount must be greater than 0']"
            />
            
            <q-input
              v-model="receiveForm.description"
              outlined
              label="Description (optional)"
              placeholder="What is this payment for?"
              class="description-input"
            />
            
            <q-btn
              class="create-invoice-btn"
              @click="createInvoice"
              :loading="isCreatingInvoice"
              :disable="!receiveForm.amount || receiveForm.amount <= 0"
              no-caps
              unelevated
            >
              Create Invoice
            </q-btn>
          </div>

          <!-- Invoice Result -->
          <div class="invoice-result" v-else>
            <!-- Payment Success State -->
            <div class="payment-success" v-if="invoicePaid">
              <q-icon name="las la-check-circle" size="64px" color="positive" class="success-icon"/>
              <div class="success-text">Payment Received!</div>
              <div class="success-amount">{{ formatBalance(receiveForm.amount) }}</div>
            </div>

            <!-- Compact Invoice Display (waiting for payment) -->
            <div class="compact-invoice" v-else-if="waitingForPayment">
              <!-- QR Code Section -->
              <div class="qr-code-section compact">
                <vue-qrcode
                  :value="generatedInvoice.paymentRequest"
                  :options="{ width: 200, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } }"
                  class="qr-code"
                />
              </div>
              
              <!-- Invoice Info -->
              <div class="invoice-info-compact">
                <div class="amount-compact">
                  {{ parseInt(receiveForm.amount).toLocaleString() }} sats
                </div>
                <div class="description-compact" v-if="receiveForm.description">
                  {{ receiveForm.description }}
                </div>
                
                <div class="waiting-indicator-compact">
                  <q-spinner-dots color="primary" size="18px"/>
                  <span class="waiting-text-compact">Waiting for payment...</span>
                </div>
              </div>
              
              <!-- Copy Button -->
              <q-btn
                flat
                color="primary"
                icon="las la-copy"
                label="Copy Invoice"
                @click="copyInvoice"
                class="copy-invoice-btn-compact"
                no-caps
              />
            </div>

            <!-- Static Invoice Display (fallback) -->
            <div class="static-invoice" v-else>
              <!-- QR Code Section -->
              <div class="qr-code-section">
                <vue-qrcode
                  :value="generatedInvoice.paymentRequest"
                  :options="{ width: 240, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } }"
                  class="qr-code"
                />
              </div>
              
              <!-- Amount Display -->
              <div class="amount-section">
                <div class="amount-value">
                  {{ parseInt(receiveForm.amount).toLocaleString() }} sats
                </div>
                <div class="description-text" v-if="receiveForm.description">
                  {{ receiveForm.description }}
                </div>
              </div>
              
              <!-- Copy Button -->
              <q-btn
                outline
                color="primary"
                icon="las la-copy"
                label="Copy"
                @click="copyInvoice"
                class="copy-invoice-btn"
                no-caps
                unelevated
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
import LoadingScreen from '../components/LoadingScreen.vue';
import ReceiveModal from '../components/ReceiveModal.vue';
import SendModal from '../components/SendModal.vue';

export default {
  name: 'WalletPage',
  components: {
    LoadingScreen,
    ReceiveModal,
    SendModal
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
      showReceiveModal: false,
      showSendModal: false,
      showPaymentConfirmation: false,
      pendingPayment: null,
      paymentAmount: '',
      paymentComment: '',
      parsedInvoice: null,
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
      // Invoice payment tracking
      currentInvoicePaymentHash: null,
      invoiceCheckInterval: null,
      waitingForPayment: false,
      showLoadingScreen: true,
      loadingText: 'Loading wallet...'
    };
  },
  computed: {
    needsAmountInput() {
      return this.pendingPayment && 
             (this.pendingPayment.type === 'lightning_address' || 
              this.pendingPayment.type === 'lnurl_pay');
    },
    canConfirmPayment() {
      if (!this.pendingPayment) return false;
      if (this.needsAmountInput) {
        return this.paymentAmount && this.paymentAmount > 0 && this.validatePaymentAmount(this.paymentAmount) === true;
      }
      return true;
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
    if (this.invoiceCheckInterval) {
      clearInterval(this.invoiceCheckInterval);
    }
    if (this.qrScanner) {
      this.qrScanner.destroy();
    }
  },
  watch: {
    'sendForm.input': {
      handler: 'processPaymentInput',
      immediate: false
    },
    showReceiveDialog(newVal) {
      if (!newVal) {
        this.resetReceiveForm();
      }
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
      this.parsedInvoice = null;
      this.sendForm.amount = '';
      this.sendForm.comment = '';

      if (!this.sendForm.input.trim()) return;

      try {
        console.log('🔍 Processing payment input:', this.sendForm.input);
        
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
        
        console.log('✅ Payment data processed:', this.paymentData);
        
        // For Lightning invoices, parse additional details
        if (this.paymentData.type === 'lightning_invoice') {
          try {
            const nwc = new webln.NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            await nwc.enable();
            
            // Try to get invoice details
            const invoiceDetails = await nwc.getInfo();
            console.log('📋 Invoice details from NWC:', invoiceDetails);
            
            // Parse the invoice manually if needed
            this.parsedInvoice = this.parseInvoiceManually(this.sendForm.input.trim());
            console.log('📊 Parsed invoice:', this.parsedInvoice);
            
          } catch (error) {
            console.warn('Could not get detailed invoice info:', error);
            // Fallback to manual parsing
            this.parsedInvoice = this.parseInvoiceManually(this.sendForm.input.trim());
          }
        }
        
        if (this.paymentData.type === 'lightning_invoice' && this.paymentData.amount === 0) {
          this.paymentData.requiresAmount = true;
        }
        
        // Show confirmation modal for invoices
        if (this.paymentData.type === 'lightning_invoice') {
          this.showPaymentConfirmation = true;
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

    parseInvoiceManually(invoice) {
      try {
        // Remove lightning: prefix if present
        const cleanInvoice = invoice.replace(/^lightning:/i, '');
        
        // Extract amount from invoice (basic parsing)
        let amount = 0;
        const amountMatch = cleanInvoice.match(/lnbc(\d+)([munp]?)/i);
        if (amountMatch) {
          const value = parseInt(amountMatch[1]);
          const unit = amountMatch[2];
          
          switch (unit) {
            case 'm': // milli-bitcoin
              amount = value * 100000;
              break;
            case 'u': // micro-bitcoin
              amount = value * 100;
              break;
            case 'n': // nano-bitcoin
              amount = value / 10;
              break;
            case 'p': // pico-bitcoin
              amount = value / 10000;
              break;
            default:
              amount = value * 100000000; // bitcoin
          }
        }
        
        // Extract description (basic parsing)
        let description = 'Lightning Payment';
        
        // Extract expiry (basic parsing)
        const now = Math.floor(Date.now() / 1000);
        const expiry = now + 3600; // Default 1 hour
        
        return {
          amount: Math.floor(amount),
          description,
          expiry,
          invoice: cleanInvoice
        };
      } catch (error) {
        console.error('Error parsing invoice manually:', error);
        return {
          amount: 0,
          description: 'Lightning Payment',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          invoice: invoice
        };
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
        if (text.trim()) {
          this.sendForm.input = text.trim();
          this.showSendDialog = false;
          
          // Small delay to ensure dialog closes
          setTimeout(async () => {
            await this.processPaymentInput();
          }, 100);
        }
      } catch (error) {
        console.error('Failed to paste from clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to access clipboard',
          position: 'top'
        });
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
        console.log('🔍 Starting invoice creation...');
      } catch (error) {
        console.error('Error creating invoice:', error);
      } finally {
        this.isCreatingInvoice = false;
      }
      // Refresh balance after invoice creation
      this.updateBalance();
      this.$q.notify({
        position: 'top'
      });
    },

    async onPaymentDetected(paymentData) {
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        this.pendingPayment = await lightningService.processPaymentInput(paymentData.data);
        this.showPaymentConfirmation = true;

      } catch (error) {
        console.error('Error processing payment:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Invalid payment request: ' + error.message,
          position: 'top'
        });
      }
    },

    formatPaymentAmount() {
      if (!this.pendingPayment) return '';
      
      if (this.needsAmountInput) {
        return this.paymentAmount ? `${parseInt(this.paymentAmount).toLocaleString()} sats` : 'Enter amount';
      }
      
      return this.pendingPayment.amount ? 
        `${parseInt(this.pendingPayment.amount).toLocaleString()} sats` : 
        'Variable amount';
    },

    formatPaymentFiat() {
      if (!this.pendingPayment) return '';
      
      let amountSats = 0;
      if (this.needsAmountInput) {
        amountSats = parseInt(this.paymentAmount) || 0;
      } else {
        amountSats = this.pendingPayment.amount || 0;
      }
      
      if (amountSats === 0) return '';
      
      const btcAmount = amountSats / 100000000;
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

    getPaymentTypeLabel() {
      if (!this.pendingPayment) return '';
      
      switch (this.pendingPayment.type) {
        case 'lightning_invoice':
          return 'Lightning Invoice';
        case 'lightning_address':
          return 'Lightning Address';
        case 'lnurl_pay':
          return 'LNURL Pay';
        default:
          return 'Lightning Payment';
      }
    },

    validatePaymentAmount(amount) {
      if (!this.pendingPayment) return 'No payment details';
      
      const amountNum = parseInt(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return 'Amount must be greater than 0';
      }
      
      if (this.pendingPayment.minSendable) {
        const minSats = Math.floor(this.pendingPayment.minSendable / 1000);
        if (amountNum < minSats) {
          return `Minimum amount is ${minSats} sats`;
        }
      }
      
      if (this.pendingPayment.maxSendable) {
        const maxSats = Math.floor(this.pendingPayment.maxSendable / 1000);
        if (amountNum > maxSats) {
          return `Maximum amount is ${maxSats} sats`;
        }
      }
      
      return true;
    },

    async confirmPayment() {
      if (!this.pendingPayment) return;

      this.isSendingPayment = true;
      try {
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);
        
        const amount = this.needsAmountInput ? parseInt(this.paymentAmount) : this.pendingPayment.amount;
        const comment = this.paymentComment || null;
        
        const result = await lightningService.sendPayment(this.pendingPayment, amount, comment);

        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'top'
        });

        // Reset and close
        this.showPaymentConfirmation = false;
        this.pendingPayment = null;
        this.paymentAmount = '';
        this.paymentComment = '';

        // Refresh balance and transactions
        await this.updateBalance();
        await this.loadRecentTransactions();

      } catch (error) {
        console.error('Error sending payment:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to send payment: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isSendingPayment = false;
      }
    },

    async checkInvoicePayment() {
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
        this.invoiceCheckInterval = null;
      }

      this.waitingForPayment = false;

      // Show success notification
      this.$q.notify({
        type: 'positive',
        message: `🎉 Payment received! ${parseInt(this.receiveForm.amount).toLocaleString()} sats`,
        position: 'top',
        timeout: 4000,
        actions: [
          { 
            label: 'View', 
            color: 'white', 
            handler: () => {
              this.$router.push(`/transaction/${transaction.id || transaction.payment_hash}`);
            }
          }
        ]
      });

      // Update wallet balance and transactions
      await this.updateWalletBalance();
      await this.loadTransactions();

      // Close dialog after a short delay to show success state
      setTimeout(() => {
        this.showReceiveDialog = false;
      }, 2000);
    },

    resetReceiveForm() {
      // Clear interval
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
        this.invoiceCheckInterval = null;
      }

      // Reset form data
      this.receiveForm.amount = '';
      this.receiveForm.description = '';
      this.generatedInvoice = null;
      this.currentInvoicePaymentHash = null;
      this.waitingForPayment = false;
    },

    extractPaymentHashFromInvoice(paymentRequest) {
      try {
        // BOLT11 invoice format: the payment hash is embedded in the invoice
        // We'll use a simple approach to extract it from the 'p' field
        const invoice = paymentRequest.toLowerCase();
        
        // Find the 'p' field which contains the payment hash (32 bytes = 64 hex chars)
        const pFieldMatch = invoice.match(/p([a-f0-9]{64})/);
        if (pFieldMatch) {
          return pFieldMatch[1];
        }
        
        // Alternative: try to find any 64-character hex string that looks like a hash
        const hashMatch = invoice.match(/([a-f0-9]{64})/);
        if (hashMatch) {
          return hashMatch[1];
        }
        
        console.warn('Could not extract payment hash from invoice');
        return null;
      } catch (error) {
        console.error('Error extracting payment hash:', error);
        return null;
      }
    },

    handleQRScan(result) {
      this.sendForm.input = result.trim();
      this.showQRScanner = false;
      this.showSendDialog = false;
      
      // Small delay to ensure dialog closes
      setTimeout(async () => {
        await this.processPaymentInput();
      }, 100);
    },

    async copyInvoice() {
      try {
        await navigator.clipboard.writeText(this.generatedInvoice.paymentRequest);
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
  padding: 1rem;
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
  color: #374151;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, transform 0.1s ease;
  position: relative;
}

.modern-menu-btn:hover {
  background: #f1f5f9;
}

.modern-menu-btn:active {
  transform: scale(0.95);
  background: #e2e8f0;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 2.5px;
  width: 16px;
  height: 12px;
}

.menu-line {
  height: 1.5px;
  background: currentColor;
  border-radius: 0.75px;
  transition: all 0.2s ease;
}

.menu-line:nth-child(1) {
  width: 100%;
}

.menu-line:nth-child(2) {
  width: 70%;
}

.menu-line:nth-child(3) {
  width: 100%;
}

.modern-menu-btn:hover .menu-line:nth-child(1) {
  width: 85%;
}

.modern-menu-btn:hover .menu-line:nth-child(2) {
  width: 100%;
}

.modern-menu-btn:hover .menu-line:nth-child(3) {
  width: 90%;
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
  background: #f8f9fa;
  color: #6b7280;
  border-radius: 50%;
  transition: transform 0.1s ease;
  opacity: 0.6;
}

.transaction-history-btn:active {
  transform: scale(0.95);
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
  padding: 1rem 1.5rem 2rem 1.5rem;
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
  background: rgba(5, 149, 115, 0.05);
}

.scan-btn:hover {
  background: rgba(5, 149, 115, 0.1);
  border-color: #047857;
  color: #047857;
  transform: translateY(-1px);
}

.scan-btn:active {
  background: #059573;
  color: white;
  border-color: #059573;
  transform: translateY(0);
}

.paste-btn {
  color: #3b82f6;
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.paste-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: #2563eb;
  color: #2563eb;
  transform: translateY(-1px);
}

.paste-btn:active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
  transform: translateY(0);
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
  gap: 1.25rem;
  text-align: center;
}

/* Payment Success State */
.payment-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(34, 197, 94, 0.05);
  border: 2px solid rgba(34, 197, 94, 0.2);
  border-radius: 16px;
  text-align: center;
}

.success-icon {
  margin-bottom: 0.5rem;
}

.success-text {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059669;
  margin-bottom: 0.5rem;
}

.success-amount {
  font-size: 1.25rem;
  font-weight: 600;
  color: #059573;
}

/* Waiting State */
.waiting-state {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.waiting-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 12px;
  margin: 1rem 0;
}

.waiting-text {
  font-size: 1.125rem;
  font-weight: 600;
  color: #3b82f6;
}

.waiting-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

/* Static Invoice (fallback) */
.static-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

/* QR Code Section */
.qr-code-section {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1.5rem;
  background: white;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}

.qr-code-section.compact {
  padding: 1rem;
  margin-bottom: 0.75rem;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
}

/* Compact Invoice Info */
.invoice-info-compact {
  text-align: center;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.amount-compact {
  font-size: 1.25rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.25rem;
}

.description-compact {
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.waiting-indicator-compact {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting-text-compact {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

/* Compact Copy Button */
.copy-invoice-btn-compact {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #059573;
  background: rgba(5, 149, 115, 0.05);
}

.copy-invoice-btn-compact:hover {
  background: #059573;
  color: white;
}

/* Responsive Design for Invoice */
@media (max-width: 480px) {
  .qr-code-section {
    padding: 1rem;
  }
  
  .amount-section {
    padding: 1rem;
  }
  
  .amount-value {
    font-size: 1.25rem;
  }
  
  .copy-invoice-btn {
    height: 44px;
    font-size: 0.875rem;
  }
  
  .payment-success {
    padding: 1.5rem 1rem;
  }
  
  .success-text {
    font-size: 1.25rem;
  }
  
  .success-amount {
    font-size: 1.125rem;
  }
  
  .waiting-indicator {
    padding: 1rem;
  }
  
  .waiting-text {
    font-size: 1rem;
  }
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
  z-index: 5000;
}

/* Payment Confirmation Dialog */
.confirmation-card {
  width: 100%;
  width: 100vw;
  height: 100vh;
  max-width: none;
  max-height: none;
  border-radius: 0;
  margin: 0;
}

.confirmation-header {
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

.confirmation-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.title-icon {
  font-size: 24px;
  color: #78D53C;
}

.confirmation-header .close-btn {
  color: rgba(255, 255, 255, 0.8);
}

.confirmation-header .close-btn:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.confirmation-content {
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Amount Section */
.amount-section {
  text-align: center;
  padding: 1.5rem;
  background: #f8f9fa;
  border-radius: 16px;
  border: 2px solid #e5e7eb;
}

.amount-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.amount-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.amount-value {
  font-size: 2.5rem;
  font-weight: 800;
  color: #059573;
  line-height: 1;
}

.amount-unit {
  font-size: 1.25rem;
  color: #6b7280;
  font-weight: 600;
}

.amount-fiat {
  font-size: 1rem;
  color: #9ca3af;
  font-weight: 500;
}

/* Payment Details */
.payment-details {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.detail-icon {
  font-size: 16px;
  color: #9ca3af;
}

.detail-value {
  font-weight: 600;
  text-align: right;
  color: #6b7280;
  margin-top: 1rem;
}

.header-icon {
  color: #059573;
  font-size: 1.25rem;
}

.header-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
}

/* Slide to Confirm */
.step-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  border-radius: 32px;
  border: 2px solid #e5e7eb;
  display: flex;
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
  position: relative;
  width: 100%;
}

.back-btn {
  color: #6b7280;
}

.step-info {
  flex: 1;
}

.step-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.step-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

/* Payment Methods */
.payment-methods {
  justify-content: center;
  flex-direction: column;
  gap: 1rem;
}

.method-card {
  display: flex;
  overflow: hidden;
  gap: 1rem;
  padding: 1.25rem;
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.input-help {
  font-size: 0.875rem;
  color: #6b7280;
  text-align: center;
  margin-top: -0.5rem;
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.15);
}

.continue-btn {
  height: 48px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 500;
  margin-top: 1rem;
  width: 48px;
  height: 48px;
}

/* QR Scanner */
.scan-content {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  align-items: center;
  justify-content: center;
}

.scan-content .step-header {
  padding: 1rem;
  margin-bottom: 0;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.scanner-container {
  flex: 1;
  position: relative;
  background: #000;
}

.qr-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scan-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.paste-method .method-icon {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}

.scan-frame {
  width: 250px;
  height: 250px;
  position: relative;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  flex: 1;
}

.scan-corner {
  position: absolute;
  width: 20px;
  height: 20px;
  border: 3px solid #10b981;
  color: #6b7280;
}

.method-arrow {
}

.scan-corner.top-left {
  top: -3px;
  left: -3px;
  border-right: none;
  border-bottom: none;
  border-radius: 12px 0 0 0;
}

/* Manual Input */
.scan-corner.top-right {
  top: -3px;
  right: -3px;
  border-left: none;
  border-bottom: none;
  border-radius: 0 12px 0 0;
  font-size: 1.125rem;
  height: 56px;
}

/* Payment Confirmation Dialog */
.payment-dialog :deep(.q-dialog__inner) {
  padding: 1rem;
}

.payment-card {
  width: 100%;
  max-width: 400px;
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

.payment-content {
  padding: 1.5rem;
}

.payment-info {
  text-align: center;
}

.payment-amount {
  margin-bottom: 1.5rem;
}

.amount-display {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.amount-fiat {
  font-size: 1rem;
  color: #6b7280;
}

.payment-details {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-weight: 500;
  color: #6b7280;
}

.detail-value {
  color: #1f2937;
  word-break: break-all;
}

.amount-input-section {
  text-align: left;
}

.amount-input,
.comment-input {
  margin-bottom: 1rem;
}

.amount-input :deep(.q-field__control),
.comment-input :deep(.q-field__control) {
  border-radius: 12px;
}

.payment-actions {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
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
  
  .method-cards {
    gap: 0.5rem;
  }
  
  .method-card {
    padding: 0.75rem 1rem;
    min-height: 64px;
  }
  
  .method-icon {
    width: 48px;
    height: 48px;
  }
  
  .method-title {
    font-size: 1rem;
  }
  
  .method-subtitle {
    font-size: 0.8125rem;
  }
  
  .scanner-container {
    height: 250px;
  }
  
  .scan-frame {
    width: 160px;
    height: 160px;
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
  
  .amount-display {
    font-size: 1.5rem;
  }
}
</style>