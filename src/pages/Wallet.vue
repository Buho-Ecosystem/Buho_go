<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page :class="$q.dark.isActive ? 'wallet-page-dark' : 'wallet-page-light'">
    <!-- Header -->
    <q-toolbar>

      <q-avatar square size="30px">
        <img src="buho_logo.svg" alt="Logo" class="app-logo">
      </q-avatar>
<!--      <q-toolbar-title>-->
<!--        <div class="title" :class="$q.dark.isActive ? 'title-dark' : 'title-light'">BuhoGO</div>-->
<!--      </q-toolbar-title>-->
      <q-space/>
      <q-btn
        flat
        round
        dense
        class="float-right q-mr-sm"
        :class="$q.dark.isActive ? 'modern-menu-btn-dark' : 'modern-menu-btn-light'"
        @click="$router.push('/settings')"
        aria-label="Settings"
        icon="las la-cog"
      >
      </q-btn>
      <q-btn
        flat
        round
        class="float-right"
        :class="$q.dark.isActive ? 'dark-mode-btn-dark' : 'dark-mode-btn-light'"
        @click="$q.dark.toggle()"
        padding="sm sm"
        style="border-radius: 12px"
        aria-label="Toggle Dark Mode"
        :icon="$q.dark.isActive ? 'las la-sun' : 'las la-moon'"
      >
      </q-btn>
    </q-toolbar>
    <!-- Main Content -->
    <div class="main-content">
      <!-- Wallet Name Badge -->
      <div
        v-if="activeWallet"
        class="wallet-name-badge"
        :class="$q.dark.isActive ? 'wallet-badge-dark' : 'wallet-badge-light'"
        @click="openWalletManagement"
      >
        <q-icon name="las la-wallet" size="12px" class="wallet-badge-icon" />
        <span class="wallet-badge-text">{{ activeWallet.name }}</span>
      </div>

      <!-- Balance Display -->
      <div class="balance-section">
        <div class="balance-container" @click="toggleCurrency" :class="{ 'switching': isSwitchingCurrency }">
          <div class="balance-amount">
            <transition name="balance-fade" mode="out-in">
              <div :key="currentDisplayMode" class="amount-display">
                <span class="amount-number" :class="$q.dark.isActive ? 'amount-number-dark' : 'amount-number-light'">{{
                    formatMainBalance(walletState.balance)
                  }}</span>
                <span class="amount-unit"
                      :class="$q.dark.isActive ? 'amount-unit-dark' : 'amount-unit-light'">{{ getCurrentUnit() }}</span>
              </div>
            </transition>
          </div>
          <transition name="secondary-fade" mode="out-in">
            <div :key="currentDisplayMode" class="balance-secondary"
                 :class="$q.dark.isActive ? 'balance-secondary-dark' : 'balance-secondary-light'">
              <span v-if="secondaryValue">{{ secondaryValue }}</span>
              <span v-else class="loading-secondary">{{ $t('Loading...') }}</span>
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
          :class="[$q.dark.isActive ? 'transaction-history-btn-dark' : 'transaction-history-btn-light', { 'pulse': shouldPulse }]"
          aria-label="Transaction History"
        />
      </div>
    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <div class="action-buttons">
        <q-btn
          :class="$q.dark.isActive ? 'action-btn receive-btn-dark' : 'action-btn receive-btn-light'"
          @click="showReceiveModal = true"
          no-caps
          unelevated
          aria-label="Receive payment"
        >
          <q-icon name="las la-arrow-down" size="24px"/>
          <div class="btn-text">{{ $t('Receive') }}</div>
        </q-btn>
        <q-btn
          :class="$q.dark.isActive ? 'action-btn send-btn-dark' : 'action-btn send-btn-light'"
          @click="showSendModal = true"
          no-caps
          unelevated
          aria-label="Send payment"
        >
          <q-icon name="las la-arrow-up" size="24px"/>
          <div class="btn-text">{{ $t('Send') }}</div>
        </q-btn>
      </div>
    </div>

    <!-- Send Dialog -->
    <q-dialog v-model="showSendDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">{{
              $t('Send Lightning Payment')
            }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Payment Input -->
          <div class="payment-input-section">
            <q-input
              v-model="sendForm.input"
              outlined
              :label="$t('Payment Details')"
              :placeholder="$t('Invoice, LNURL, or Lightning Address')"
              type="textarea"
              rows="3"
              :class="$q.dark.isActive ? 'payment_input_dark' : 'payment_input_light'"
            />

            <div class="input-actions">
              <q-btn
                flat
                color="primary"
                icon="las la-qrcode"
                :label="$t('Scan QR')"
                @click="showQRScanner = true"
                :class="$q.dark.isActive ? 'scan_btn_dark' : 'scan_btn_light'"
                no-caps
              />
              <q-btn
                flat
                color="primary"
                icon="las la-paste"
                :label="$t('Paste')"
                @click="pasteFromClipboard"
                :class="$q.dark.isActive ? 'paste_btn_dark' : 'paste_btn_light'"
                no-caps
              />
            </div>
          </div>

          <!-- Payment Type Indicator -->
          <div class="payment-type-section" v-if="paymentData"
               :class="$q.dark.isActive ? 'payment_type_dark' : 'payment_type_light'">
            <div class="type-indicator">
              <q-icon name="las la-bolt" class="type-icon"/>
              <span class="type-label" :class="$q.dark.isActive ? 'type_label_dark' : 'type_label_light'">{{
                  getPaymentTypeLabel()
                }}</span>
            </div>
          </div>

          <!-- Amount Input for LNURL/Lightning Address -->
          <div class="amount-section" v-if="requiresAmount()"
               :class="$q.dark.isActive ? 'amount_section_dark' : 'amount_section_light'">
            <div class="amount-limits" v-if="getAmountLimits()"
                 :class="$q.dark.isActive ? 'amount_limits_dark' : 'amount_limits_light'">
              <q-icon name="las la-info-circle" class="limits-icon"/>
              <span>{{ $t('Amount') }}: {{ getAmountLimits().min }} - {{ getAmountLimits().max }} sats</span>
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
    <q-dialog v-model="showPaymentConfirmation" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" style="width: 500px;">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">{{ $t('Confirm Payment') }}</div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"/>
        </q-card-section>

        <q-card-section class="payment-content" v-if="pendingPayment">
          <div class="payment-info">
            <div class="payment-amount">
              <div class="amount-display" :class="$q.dark.isActive ? 'amount_display_dark' : 'amount_display_light'">
                {{ formatPaymentAmount() }}
              </div>
              <div class="amount-fiat" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'">
                <span v-if="paymentFiatValue">{{ paymentFiatValue }}</span>
                <span v-else-if="pendingPayment && (pendingPayment.amount > 0 || paymentAmount)"
                      class="loading-fiat">{{ $t('Loading...') }}</span>
              </div>
            </div>

            <div class="payment-details" :class="$q.dark.isActive ? 'payment_details_dark' : 'payment_details_light'">
              <div class="detail-item" v-if="pendingPayment.description">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('Description')
                  }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.description
                  }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label"
                      :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Type') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    getPaymentTypeLabel()
                  }}</span>
              </div>
            </div>

            <!-- Amount input for LNURL/Lightning Address -->
            <div v-if="needsAmountInput" class="amount-input-section">
              <q-input
                v-model="paymentAmount"
                outlined
                :label="$t('Amount (sats)')"
                type="number"
                :min="pendingPayment.minSendable ? Math.floor(pendingPayment.minSendable / 1000) : 1"
                :max="pendingPayment.maxSendable ? Math.floor(pendingPayment.maxSendable / 1000) : 100000000"
                :class="$q.dark.isActive ? 'amount_input_dark' : 'amount_input_light'"
                :rules="[validatePaymentAmount]"
              />

              <q-input
                v-if="pendingPayment.commentAllowed > 0"
                v-model="paymentComment"
                outlined
                :label="$t('Comment (optional)')"
                :maxlength="pendingPayment.commentAllowed"
                :class="$q.dark.isActive ? 'comment_input_dark' : 'comment_input_light'"
              />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="payment-actions"
                        :class="$q.dark.isActive ? 'payment_actions_dark' : 'payment_actions_light'">
          <q-btn flat :label="$t('Cancel')" v-close-popup no-caps
                 :class="$q.dark.isActive ? 'cancel_btn_dark' : 'cancel_btn_light'"/>
          <q-btn
            flat
            :label="$t('Send Payment')"
            color="primary"
            no-caps
            @click="confirmPayment"
            :loading="isSendingPayment"
            :disable="!canConfirmPayment"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Receive Dialog -->
    <q-dialog v-model="showReceiveDialog" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">{{
              $t('Receive Lightning Payment')
            }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <!-- Invoice Form -->
          <div class="invoice-form" v-if="!generatedInvoice">
            <q-input
              v-model="receiveForm.amount"
              outlined
              :label="$t('Amount (sats)')"
              type="number"
              min="1"
              :class="$q.dark.isActive ? 'amount_input_dark' : 'amount_input_light'"
              :rules="[val => val > 0 || $t('Amount must be greater than 0')]"
            />

            <q-input
              v-model="receiveForm.description"
              outlined
              :label="$t('Description (optional)')"
              :placeholder="$t('What is this payment for?')"
              :class="$q.dark.isActive ? 'description_input_dark' : 'description_input_light'"
            />

            <q-btn
              :class="$q.dark.isActive ? 'dialog_add_btn_dark create-invoice-btn' : 'dialog_add_btn_light create-invoice-btn'"
              @click="createInvoice"
              :loading="isCreatingInvoice"
              :disable="!receiveForm.amount || receiveForm.amount <= 0"
              no-caps
              unelevated
            >
              {{ $t('Create Invoice') }}
            </q-btn>
          </div>

          <!-- Invoice Result -->
          <div class="invoice-result" v-else>
            <!-- Payment Success State -->
            <div class="payment-success" v-if="invoicePaid"
                 :class="$q.dark.isActive ? 'payment_success_dark' : 'payment_success_light'">
              <q-icon name="las la-check-circle" size="64px" color="positive" class="success-icon"/>
              <div class="success-text" :class="$q.dark.isActive ? 'success_text_dark' : 'success_text_light'">
                {{ $t('Payment Received!') }}
              </div>
              <div class="success-amount" :class="$q.dark.isActive ? 'success_amount_dark' : 'success_amount_light'">
                {{ formatBalance(receiveForm.amount) }}
              </div>
            </div>

            <!-- Compact Invoice Display (waiting for payment) -->
            <div class="compact-invoice" v-else-if="waitingForPayment">
              <!-- QR Code Section -->
              <div class="qr-code-section compact"
                   :class="$q.dark.isActive ? 'qr_code_section_dark' : 'qr_code_section_light'">
                <vue-qrcode
                  :value="generatedInvoice.paymentRequest"
                  :options="{ width: 200, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } }"
                  class="qr-code"
                />
              </div>

              <!-- Invoice Info -->
              <div class="invoice-info-compact"
                   :class="$q.dark.isActive ? 'invoice_info_compact_dark' : 'invoice_info_compact_light'">
                <div class="amount-compact" :class="$q.dark.isActive ? 'amount_compact_dark' : 'amount_compact_light'">
                  {{ parseInt(receiveForm.amount).toLocaleString() }} sats
                </div>
                <div class="description-compact" v-if="receiveForm.description"
                     :class="$q.dark.isActive ? 'description_compact_dark' : 'description_compact_light'">
                  {{ receiveForm.description }}
                </div>

                <div class="waiting-indicator-compact"
                     :class="$q.dark.isActive ? 'waiting_indicator_compact_dark' : 'waiting_indicator_compact_light'">
                  <q-spinner-dots color="primary" size="18px"/>
                  <span class="waiting-text-compact"
                        :class="$q.dark.isActive ? 'waiting_text_compact_dark' : 'waiting_text_compact_light'">{{
                      $t('Waiting for payment...')
                    }}</span>
                </div>
              </div>

              <!-- Copy Button -->
              <q-btn
                flat
                color="primary"
                icon="las la-copy"
                :label="$t('Copy Invoice')"
                @click="copyInvoice"
                :class="$q.dark.isActive ? 'copy_invoice_btn_compact_dark' : 'copy_invoice_btn_compact_light'"
                no-caps
              />
            </div>

            <!-- Static Invoice Display (fallback) -->
            <div class="static-invoice" v-else>
              <!-- QR Code Section -->
              <div class="qr-code-section" :class="$q.dark.isActive ? 'qr_code_section_dark' : 'qr_code_section_light'">
                <vue-qrcode
                  :value="generatedInvoice.paymentRequest"
                  :options="{ width: 240, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } }"
                  class="qr-code"
                />
              </div>

              <!-- Amount Display -->
              <div class="amount-section">
                <div class="amount-value" :class="$q.dark.isActive ? 'amount_value_dark' : 'amount_value_light'">
                  {{ parseInt(receiveForm.amount).toLocaleString() }} sats
                </div>
                <div class="description-text" v-if="receiveForm.description"
                     :class="$q.dark.isActive ? 'description_text_dark' : 'description_text_light'">
                  {{ receiveForm.description }}
                </div>
              </div>

              <!-- Copy Button -->
              <q-btn
                outline
                color="primary"
                icon="las la-copy"
                :label="$t('Copy')"
                @click="copyInvoice"
                :class="$q.dark.isActive ? 'copy_invoice_btn_dark' : 'copy_invoice_btn_light'"
                no-caps
                unelevated
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- QR Scanner Dialog -->
    <q-dialog v-model="showQRScanner" :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">{{
              $t('Scan Lightning Invoice')
            }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"/>
        </q-card-section>

        <q-card-section class="dialog-content">
          <div class="qr-scanner-container"
               :class="$q.dark.isActive ? 'qr_scanner_container_dark' : 'qr_scanner_container_light'">
            <qrcode-capture @detect="handleQRScan"/>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {webln} from "@getalby/sdk";
import {LightningPaymentService} from '../utils/lightning.js';
import {fiatRatesService} from '../utils/fiatRates.js';
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
        exchangeRates: {},
        lastRateUpdate: null,
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
      slidePosition: 0,
      slideConfirmed: false,
      isSliding: false,
      slideStartX: 0,
      maxSlideDistance: 0,
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
      currentInvoicePaymentHash: null,
      invoiceCheckInterval: null,
      waitingForPayment: false,
      showLoadingScreen: true,
      loadingText: 'Loading wallet...',
      currentDisplayMode: 'sats',
      isSwitchingCurrency: false,
      shouldPulse: false,
      showSendDialog: false,
      showReceiveDialog: false,
      showQRScanner: false,
      paymentData: null,
      isCreatingInvoice: false,
      invoicePaid: false,
      isSendingPayment: false,
      fiatRatesLoaded: false,
      secondaryValue: '',
      paymentFiatValue: ''
    };
  },
  computed: {
    activeWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      ) || null;
    },
    needsAmountInput() {
      if (!this.pendingPayment) return false;

      if (this.pendingPayment.type === 'lightning_address' ||
          this.pendingPayment.type === 'lnurl' ||
          this.pendingPayment.type === 'lnurl_pay') {
        return this.pendingPayment.minSendable !== this.pendingPayment.maxSendable;
      }

      return (this.pendingPayment.type === 'lightning_invoice' && this.pendingPayment.amount === 0) ||
             (this.pendingPayment.type === 'invoice' && this.pendingPayment.amount === 0);
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
    },

    'walletState.balance': {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    currentDisplayMode: {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    pendingPayment: {
      handler: 'updatePaymentFiatValue',
      immediate: true,
      deep: true
    },

    paymentAmount: {
      handler: 'updatePaymentFiatValue',
      immediate: true
    }
  },
  methods: {
    // ... (keeping all your existing methods from the original file)
    openWalletManagement() {
      this.$router.push('/settings');
    },
    async initializeWallet() {
      try {
        this.loadingText = 'Loading wallet state...';
        await this.loadWalletState();

        this.loadingText = 'Loading fiat rates...';
        await this.loadFiatRates();

        this.loadingText = 'Fetching transactions...';
        await this.loadTransactions();

        this.loadingText = 'Loading profiles...';
        await this.loadNostrProfiles();

        this.loadingText = 'Starting services...';
        this.startPeriodicRefresh();
        this.startPulseAnimation();

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
          this.walletState = {...this.walletState, ...parsedState};
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        this.walletState.balance = 312;
      }
    },

    async updateWalletBalance() {
      const activeWallet = this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (activeWallet && activeWallet.nwcString) {
        try {
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
      this.recentTransactions = [];
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

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        await this.updateWalletBalance();
        await this.loadTransactions();
        await this.loadFiatRates();
      }, 30000);
    },

    async loadFiatRates() {
      try {
        const rates = await fiatRatesService.getRates();
        this.walletState.exchangeRates = {
          usd: rates.USD || 100000,
          eur: rates.EUR || 85000,
          gbp: rates.GBP || 75000,
          cad: rates.CAD || 135000,
          chf: rates.CHF || 90000,
          aud: rates.AUD || 150000,
          jpy: rates.JPY || 15000000
        };
        this.walletState.lastRateUpdate = new Date();
        this.fiatRatesLoaded = true;

        // Save updated state
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        console.log('✅ Fiat rates loaded:', this.walletState.exchangeRates);
      } catch (error) {
        console.error('❌ Error loading fiat rates:', error);
        // Keep existing rates or use fallbacks
        if (!this.fiatRatesLoaded) {
          this.walletState.exchangeRates = {
            usd: 100000,
            eur: 85000,
            gbp: 75000,
            cad: 135000,
            chf: 90000,
            aud: 150000,
            jpy: 15000000
          };
        }
      }
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
      this.currentDisplayMode = modes[nextIndex];
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

      setTimeout(() => {
        this.isSwitchingCurrency = false;
      }, 200);
    },

    formatMainBalance(balance) {
      switch (this.currentDisplayMode) {
        case 'btc':
          const btcAmount = balance / 100000000;
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

    async getSecondaryValue(balance) {
      switch (this.currentDisplayMode) {
        case 'btc':
          const btcAmountForSecondary = balance / 100000000;
          if (btcAmountForSecondary < 0.001) {
            return await this.getFiatValue(balance);
          }
          return balance.toLocaleString() + ' sats';
        case 'fiat':
          return balance.toLocaleString() + ' sats';
        case 'sats':
        default:
          return await this.getFiatValue(balance);
      }
    },

    formatBalance(balance) {
      return balance.toLocaleString() + ' sats';
    },

    async getFiatValue(balance) {
      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(balance, currency);
        return fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error getting fiat value:', error);
        // Fallback to stored rates
        const btcAmount = balance / 100000000;
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const rate = this.walletState.exchangeRates[currency.toLowerCase()] || 100000;
        const fiatValue = btcAmount * rate;

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF ',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return currency === 'JPY' ? symbol + Math.round(fiatValue).toLocaleString() : symbol + fiatValue.toFixed(2);
      }
    },

    // Payment processing methods

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

        if (this.paymentData.type === 'lightning_invoice') {
          try {
            const nwc = new webln.NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            await nwc.enable();

            const invoiceDetails = await nwc.getInfo();
            console.log('📋 Invoice details from NWC:', invoiceDetails);

            this.parsedInvoice = this.parseInvoiceManually(this.sendForm.input.trim());
            console.log('📊 Parsed invoice:', this.parsedInvoice);

          } catch (error) {
            console.warn('Could not get detailed invoice info:', error);
            this.parsedInvoice = this.parseInvoiceManually(this.sendForm.input.trim());
          }
        }

        if (this.paymentData.type === 'lightning_invoice' && this.paymentData.amount === 0) {
          this.paymentData.requiresAmount = true;
        }

        if (this.paymentData.type === 'lightning_invoice') {
          this.showPaymentConfirmation = true;
        }

      } catch (error) {
        console.error('Error processing payment input:', error);
        this.$q.notify({
          type: 'negative',
          message: error.message,
          position: 'bottom'
        });
      }
    },

    parseInvoiceManually(invoice) {
      try {
        const cleanInvoice = invoice.replace(/^lightning:/i, '');

        let amount = 0;
        const amountMatch = cleanInvoice.match(/lnbc(\d+)([munp]?)/i);
        if (amountMatch) {
          const value = parseInt(amountMatch[1]);
          const unit = amountMatch[2];

          switch (unit) {
            case 'm':
              amount = value * 100000; // milli-bitcoin
              break;
            case 'u':
              amount = value * 100; // micro-bitcoin
              break;
            case 'n':
              amount = value / 10; // nano-bitcoin
              break;
            case 'p':
              amount = value / 10000; // pico-bitcoin
              break;
            default:
              // No unit or unrecognized unit - likely variable amount invoice
              amount = 0;
          }
        }

        let description = 'Lightning Payment';
        const now = Math.floor(Date.now() / 1000);
        const expiry = now + 3600;

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
      if (!this.paymentData && !this.pendingPayment) return '';

      const payment = this.paymentData || this.pendingPayment;

      const labels = {
        'lightning_invoice': 'Lightning Invoice',
        'lnurl_pay': 'LNURL Payment',
        'lightning_address': 'Lightning Address'
      };
      return labels[payment.type] || 'Lightning Payment';
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

    async pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        this.sendForm.input = text;
      } catch (error) {
        console.error('Failed to read clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to read clipboard',
          position: 'bottom'
        });
      }
    },

    async onPaymentDetected(paymentData) {
      console.log('Payment detected:', paymentData);

      try {
        // Transform the payment data to match expected structure
        if (paymentData.type === 'lightning_invoice' && paymentData.data) {
          // Parse the invoice to get the amount
          const parsedInvoice = this.parseInvoiceManually(paymentData.data);

          this.pendingPayment = {
            ...paymentData,
            invoice: paymentData.data,
            amount: parsedInvoice.amount,
            description: parsedInvoice.description
          };
        } else if (paymentData.type === 'lnurl' && paymentData.data) {
          // Process LNURL to get the actual payment parameters
          const activeWallet = this.getActiveWallet();
          if (!activeWallet) {
            throw new Error('No active wallet found');
          }
          
          const lightningService = new LightningPaymentService(activeWallet.nwcString);
          const processedLnurl = await lightningService.processPaymentInput(paymentData.data);
          
          console.log('✅ LNURL processed:', processedLnurl);
          this.pendingPayment = processedLnurl;
        } else if (paymentData.type === 'lightning_address' && paymentData.data) {
          // Process Lightning Address to get the actual payment parameters
          const activeWallet = this.getActiveWallet();
          if (!activeWallet) {
            throw new Error('No active wallet found');
          }
          
          const lightningService = new LightningPaymentService(activeWallet.nwcString);
          const processedAddress = await lightningService.processPaymentInput(paymentData.data);
          
          console.log('✅ Lightning Address processed:', processedAddress);
          this.pendingPayment = processedAddress;
        } else {
          this.pendingPayment = paymentData;
        }

        this.showPaymentConfirmation = true;
      } catch (error) {
        console.error('❌ Error processing payment:', error);
        this.$q.notify({
          type: 'negative',
          message: `Payment processing failed: ${error.message}`,
          position: 'bottom'
        });
      }
    },

    async checkInvoiceStatus() {
      if (!this.currentInvoicePaymentHash || this.invoicePaid) return;

      try {
        const activeWallet = this.getActiveWallet();
        if (!activeWallet) return;

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });
        await nwc.enable();

        const transactions = await nwc.getTransactions();
        const paidInvoice = transactions.find(tx =>
          tx.type === 'incoming' &&
          tx.payment_hash === this.currentInvoicePaymentHash
        );

        if (paidInvoice) {
          console.log('✅ Invoice paid!', paidInvoice);
          this.invoicePaid = true;
          this.waitingForPayment = false;
          this.stopInvoiceMonitoring();

          await this.updateWalletBalance();

          this.$q.notify({
            type: 'positive',
            message: 'Payment received!',
            position: 'bottom'
          });
        }
      } catch (error) {
        console.error('Error checking invoice status:', error);
      }
    },

    formatPaymentAmount() {
      if (!this.pendingPayment) return '';

      if (this.needsAmountInput) {
        return this.paymentAmount ? `${parseInt(this.paymentAmount).toLocaleString()} sats` : 'Enter amount';
      }

      // For fixed-amount LNURL/Lightning Address payments
      if ((this.pendingPayment.type === 'lnurl' ||
           this.pendingPayment.type === 'lnurl_pay' ||
           this.pendingPayment.type === 'lightning_address') &&
          this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
        const fixedAmount = Math.floor(this.pendingPayment.minSendable / 1000);
        return `${fixedAmount.toLocaleString()} sats`;
      }

      return this.pendingPayment.amount ?
        `${parseInt(this.pendingPayment.amount).toLocaleString()} sats` :
        'Variable amount';
    },

    async formatPaymentFiat() {
      if (!this.pendingPayment) return '';

      let amount = 0;
      if (this.needsAmountInput) {
        amount = parseInt(this.paymentAmount) || 0;
      } else if ((this.pendingPayment.type === 'lnurl' ||
                  this.pendingPayment.type === 'lnurl_pay' ||
                  this.pendingPayment.type === 'lightning_address') &&
                 this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
        // Fixed-amount LNURL/Lightning Address
        amount = Math.floor(this.pendingPayment.minSendable / 1000);
      } else {
        amount = this.pendingPayment.amount || 0;
      }

      if (amount === 0) return '';

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(amount, currency);
        return '≈ ' + fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error formatting payment fiat:', error);
        return '';
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
      if (!this.canConfirmPayment) return;

      this.isSendingPayment = true;

      try {
        const activeWallet = this.getActiveWallet();
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const lightningService = new LightningPaymentService(activeWallet.nwcString);

        // Get amount from paymentAmount for variable amount payments, or from pendingPayment for fixed amount invoices
        let amount = null;
        if (this.needsAmountInput && this.paymentAmount) {
          // For variable amount invoices, LNURL, and Lightning Address
          amount = parseInt(this.paymentAmount);
        } else if (this.pendingPayment && this.pendingPayment.amount > 0) {
          // For fixed amount invoices
          amount = this.pendingPayment.amount;
        } else if ((this.pendingPayment.type === 'lnurl' ||
                    this.pendingPayment.type === 'lnurl_pay' ||
                    this.pendingPayment.type === 'lightning_address') &&
                   this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          // For fixed-amount LNURL/Lightning Address payments
          amount = Math.floor(this.pendingPayment.minSendable / 1000);
        }

        const comment = this.paymentComment || null;

        console.log('🚀 Sending payment:', this.pendingPayment);
        console.log('💰 Amount:', amount, 'Comment:', comment);
        console.log('📝 Raw paymentAmount:', this.paymentAmount);
        console.log('📝 Raw sendForm.input:', this.sendForm.input);
        const result = await lightningService.sendPayment(this.pendingPayment, amount, comment);
        console.log('✅ Payment sent:', result);

        this.showPaymentConfirmation = false;
        this.pendingPayment = null;
        this.paymentAmount = '';
        this.paymentComment = '';
        this.sendForm.input = '';

        await this.updateWalletBalance();

        this.$q.notify({
          type: 'positive',
          message: 'Payment sent successfully!',
          position: 'bottom'
        });

      } catch (error) {
        console.error('❌ Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Payment failed: ' + error.message,
          position: 'bottom'
        });
      } finally {
        this.isSendingPayment = false;
      }
    },

    async createInvoice() {
      if (!this.receiveForm.amount || this.receiveForm.amount <= 0) return;

      this.isCreatingInvoice = true;

      try {
        const activeWallet = this.getActiveWallet();
        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });
        await nwc.enable();

        const invoiceData = {
          amount: parseInt(this.receiveForm.amount),
          description: this.receiveForm.description || 'BuhoGO Payment'
        };

        console.log('🧾 Creating invoice:', invoiceData);
        const invoice = await nwc.makeInvoice(invoiceData);
        console.log('✅ Invoice created:', invoice);

        this.generatedInvoice = invoice;
        this.currentInvoicePaymentHash = invoice.paymentHash;
        this.waitingForPayment = true;
        this.startInvoiceMonitoring();

      } catch (error) {
        console.error('❌ Failed to create invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to create invoice: ' + error.message,
          position: 'bottom'
        });
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    async updateSecondaryValue() {
      if (this.walletState.balance !== undefined) {
        this.secondaryValue = await this.getSecondaryValue(this.walletState.balance);
      }
    },

    async updatePaymentFiatValue() {
      this.paymentFiatValue = await this.formatPaymentFiat();
    },

    startInvoiceMonitoring() {
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
      }

      this.invoiceCheckInterval = setInterval(async () => {
        await this.checkInvoiceStatus();
      }, 2000);
    },

    stopInvoiceMonitoring() {
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
        this.invoiceCheckInterval = null;
      }
    },

    onInvoiceCreated(invoice) {
      console.log('Invoice created:', invoice);
      this.generatedInvoice = invoice;
      this.currentInvoicePaymentHash = invoice.paymentHash;
      this.waitingForPayment = true;
      this.startInvoiceMonitoring();
    },

    resetReceiveForm() {
      this.receiveForm.amount = '';
      this.receiveForm.description = '';
      this.generatedInvoice = null;
      this.waitingForPayment = false;
      this.invoicePaid = false;
      this.currentInvoicePaymentHash = null;
      this.stopInvoiceMonitoring();
    },

    async handleQRScan(result) {
      this.showQRScanner = false;
      this.sendForm.input = result;
    },

    async copyInvoice() {
      if (!this.generatedInvoice) return;

      try {
        await navigator.clipboard.writeText(this.generatedInvoice.paymentRequest);
        this.$q.notify({
          type: 'positive',
          message: 'Invoice copied to clipboard!',
          position: 'bottom'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to copy invoice',
          position: 'bottom'
        });
      }
    }
  }
};
</script>

<style scoped>
/* Base Page Styles */
.wallet-page-dark {
  background: #171717;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.wallet-page-light {
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
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  -moz-background-clip: text;
  background-size: 400% 400%;
  animation: gradientShift 6s ease-in-out infinite;
}

.title-dark {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.title-light {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

@keyframes gradientShift {
  0% {
    background-position: 0% 0%;
  }
  25% {
    background-position: 100% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

.modern-menu-btn-dark,
.modern-menu-btn-light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, transform 0.1s ease;
  position: relative;
}

.modern-menu-btn-dark {
  color: #F6F6F6;
}

.modern-menu-btn-dark:hover {
  background: #2A342A;
}

.modern-menu-btn-light {
  color: #374151;
}

.modern-menu-btn-light:hover {
  background: #f1f5f9;
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
  border-radius: 0.75px;
  transition: all 0.2s ease;
}

.menu-line-dark {
  background: #F6F6F6;
}

.menu-line-light {
  background: #374151;
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

/* Wallet Name Badge */
.wallet-name-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  margin-bottom: 1rem;
  border: 1px solid;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.wallet-badge-dark {
  background: rgba(38, 38, 38, 0.6);
  border-color: rgba(21, 222, 114, 0.3);
  color: #a1a1a1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.wallet-badge-light {
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(5, 149, 115, 0.35);
  color: #6b6b6b;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.wallet-badge-dark:hover {
  background: rgba(38, 38, 38, 0.8);
  border-color: rgba(21, 222, 114, 0.6);
  color: #d4d4d4;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.wallet-badge-light:hover {
  background: rgba(0, 0, 0, 0.6);
  border-color: rgba(5, 149, 115, 0.55);
  color: #3f3f3f;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.wallet-badge-icon {
  opacity: 0.7;
  transition: opacity 0.3s ease;
}

.wallet-badge-dark:hover .wallet-badge-icon {
  opacity: 1;
}

.wallet-badge-light:hover .wallet-badge-icon {
  opacity: 1;
}

.wallet-badge-text {
  font-family: 'Inter', sans-serif;
  letter-spacing: -0.01em;
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
  line-height: 1;
}

.amount-number-dark {
  color: #FFF;
}

.amount-number-light {
  color: #1f2937;
}

.amount-unit {
  font-size: 1.5rem;
  font-weight: 600;
}

.amount-unit-dark {
  color: #B0B0B0;
}

.amount-unit-light {
  color: #6b7280;
}

.balance-secondary {
  font-size: 1.25rem;
  font-weight: 400;
}

.balance-secondary-dark {
  color: #B0B0B0;
}

.balance-secondary-light {
  color: #9ca3af;
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

.transaction-history-btn-dark,
.transaction-history-btn-light {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  transition: transform 0.1s ease;
  opacity: 0.6;
}

.transaction-history-btn-dark {
  background: #2A342A;
  color: #B0B0B0;
}

.transaction-history-btn-light {
  background: #f8f9fa;
  color: #6b7280;
}

.transaction-history-btn-dark:active,
.transaction-history-btn-light:active {
  transform: scale(0.95);
}

.transaction-history-btn-dark.pulse,
.transaction-history-btn-light.pulse {
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

.receive-btn-dark,
.receive-btn-light {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
}

.receive-btn-dark:hover,
.receive-btn-light:hover {
  background: linear-gradient(135deg, #047857, #059573);
}

.send-btn-dark,
.send-btn-light {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.send-btn-dark:hover,
.send-btn-light:hover {
  background: linear-gradient(135deg, #2563EB, #1D4ED8);
}

.btn-text {
  font-size: 1rem;
  font-weight: 600;
}

/* Dialog Header Styles */
.dialog_header_dark {
  background: #0C0C0C;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #2A342A;
}

.dialog_header_light {
  background: #f8f9fa;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

/* Close Button Styles */
.close_btn_dark {
  color: #B0B0B0;
}

.close_btn_light {
  color: #6b7280;
}

/* Dialog Content */
.dialog-content {
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

.payment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.payment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.input-actions {
  display: flex;
  gap: 0.75rem;
}

.scan_btn_dark,
.paste_btn_dark {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.scan_btn_light,
.paste_btn_light {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.scan_btn_dark:hover,
.paste_btn_dark:hover {
  background: rgba(21, 222, 114, 0.2);
  transform: translateY(-1px);
}

.scan_btn_light:hover,
.paste_btn_light:hover {
  background: rgba(5, 149, 115, 0.1);
  transform: translateY(-1px);
}

/* Payment Type Section */
.payment_type_dark {
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid rgba(21, 222, 114, 0.3);
  border-radius: 12px;
  padding: 1rem;
}

.payment_type_light {
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
  color: #15DE72;
  font-weight: 500;
}

.type_label_dark {
  color: #15DE72;
  font-weight: 500;
}

.type_label_light {
  color: #059573;
  font-weight: 500;
}

/* Amount Section */
.amount_section_dark {
  background: #171717;
  border: 1px solid #2A342A;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_section_light {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_limits_dark {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #B0B0B0;
  background: #0C0C0C;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #2A342A;
}

.amount_limits_light {
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

/* Payment Content */
.payment-content {
  padding: 1.5rem;
}

.payment-info {
  text-align: center;
}

.payment-amount {
  margin-bottom: 1.5rem;
}

.amount_display_dark {
  font-size: 2rem;
  font-weight: 700;
  color: #FFF;
  margin-bottom: 0.5rem;
}

.amount_display_light {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.amount_fiat_dark {
  font-size: 1rem;
  color: #B0B0B0;
}

.amount_fiat_light {
  font-size: 1rem;
  color: #6b7280;
}

/* Payment Details */
.payment_details_dark {
  background: #171717;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #2A342A;
}

.payment_details_light {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e5e7eb;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail_label_dark {
  font-weight: 500;
  color: #B0B0B0;
}

.detail_label_light {
  font-weight: 500;
  color: #6b7280;
}

.detail_value_dark {
  color: #FFF;
  word-break: break-all;
}

.detail_value_light {
  color: #1f2937;
  word-break: break-all;
}

/* Amount Input Section */
.amount-input-section {
  text-align: left;
}

.amount_input_dark :deep(.q-field__control),
.comment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.amount_input_light :deep(.q-field__control),
.comment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  margin-bottom: 1rem;
}

/* Payment Actions */
.payment_actions_dark {
  background: #0C0C0C;
  border-top: 1px solid #2A342A;
}

.payment_actions_light {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
}

.cancel_btn_dark {
  color: #B0B0B0;
}

.cancel_btn_light {
  color: #6b7280;
}

/* Invoice Form */
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.description_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.description_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.create-invoice-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

/* Invoice Result */
.invoice-result {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

/* Payment Success State */
.payment_success_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(21, 222, 114, 0.1);
  border: 2px solid rgba(21, 222, 114, 0.3);
  border-radius: 16px;
  text-align: center;
}

.payment_success_light {
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

.success_text_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.success_text_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059669;
  margin-bottom: 0.5rem;
}

.success_amount_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #15DE72;
}

.success_amount_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #059573;
}

/* Compact Invoice */
.compact-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.qr_code_section_dark {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  background: #FFF;
  border-radius: 16px;
  border: 1px solid #2A342A;
  margin-bottom: 0.75rem;
}

.qr_code_section_light {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  background: white;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  margin-bottom: 0.75rem;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
}

.invoice_info_compact_dark {
  text-align: center;
  padding: 0.75rem;
  background: #171717;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #2A342A;
}

.invoice_info_compact_light {
  text-align: center;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #e5e7eb;
}

.amount_compact_dark {
  font-size: 1.25rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.25rem;
}

.amount_compact_light {
  font-size: 1.25rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.25rem;
}

.description_compact_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.description_compact_light {
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.waiting_indicator_compact_dark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_indicator_compact_light {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_text_compact_dark {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

.waiting_text_compact_light {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

/* Copy Invoice Button */
.copy_invoice_btn_compact_dark {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid #15DE72;
}

.copy_invoice_btn_compact_light {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #059573;
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid #059573;
}

.copy_invoice_btn_compact_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_compact_light:hover {
  background: #059573;
  color: white;
}

/* Static Invoice */
.static-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.amount-section {
  padding: 1rem;
}

.amount_value_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.amount_value_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.5rem;
}

.description_text_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  font-weight: 500;
}

.description_text_light {
  color: #6b7280;
  font-size: 0.875rem;
  font-weight: 500;
}

.copy_invoice_btn_dark {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.copy_invoice_btn_light {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.copy_invoice_btn_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_light:hover {
  background: #059573;
  color: white;
}

/* QR Scanner */
.qr_scanner_container_dark {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #2A342A;
  background: #171717;
  z-index: 5000;
}

.qr_scanner_container_light {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  background: #f8f9fa;
  z-index: 5000;
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

  .dialog-content {
    padding: 1rem;
    gap: 1rem;
  }

  .create-invoice-btn {
    height: 48px;
    font-size: 0.9rem;
  }

  .amount_display_dark,
  .amount_display_light {
    font-size: 1.5rem;
  }

  .payment-content {
    padding: 1rem;
  }
}
</style>
