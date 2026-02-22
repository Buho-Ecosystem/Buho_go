<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="receive-modal"
  >
    <q-card class="receive-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="receive-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="closeModal"
            class="back-btn"
            :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          >
            <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"
                 fill="none">
              <path
                d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
                fill="white"/>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
                fill="#6D6D6D"/>
            </svg>
          </q-btn>
          <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Receive') }}
          </div>
          <div class="header-actions">
            <q-btn
              v-if="hasLightningAddress"
              flat
              round
              dense
              icon="las la-at"
              @click="showLightningAddress"
              class="address-btn"
              :class="$q.dark.isActive ? 'back-btn-dark' : 'back-btn-light'"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="receive-content">
        <!-- Receive Mode Toggle (for Spark wallets) -->
        <div v-if="isSparkWallet && !generatedInvoice && !showAddressView" class="receive-type-toggle">
          <q-btn-toggle
            v-model="receiveMode"
            toggle-color="primary"
            :options="receiveModeOptions"
            class="type-toggle"
            :class="$q.dark.isActive ? 'toggle-dark' : 'toggle-light'"
            no-caps
            unelevated
            spread
          />
          <div class="mode-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            <template v-if="receiveMode === 'spark'">
              {{ $t('Spark-to-Spark only, zero fees') }}
            </template>
            <template v-else-if="receiveMode === 'bitcoin'">
              {{ $t('From any Bitcoin wallet (takes ~10-60 min)') }}
            </template>
            <template v-else>
              {{ $t('One-time request with amount') }}
            </template>
          </div>
        </div>

        <!-- Spark Address View -->
        <div v-if="showSparkAddressView && sparkAddress" class="spark-address-view">
          <!-- QR Code Section -->
          <div class="qr-section">
            <div class="qr-card" @click="copySparkAddress">
              <div class="qr-frame">
                <vue-qrcode
                  :value="sparkAddress"
                  :options="sparkQrOptions"
                  class="qr-code"
                />
              </div>
            </div>
            <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Tap QR to copy address') }}
            </div>
          </div>

          <!-- Address Display - Compact Pill -->
          <div
            class="address-pill"
            :class="$q.dark.isActive ? 'pill-dark' : 'pill-light'"
            @click="copySparkAddress"
          >
            <img :src="sparkPillIcon" class="pill-icon-img" />
            <span class="pill-address">{{ truncateSparkAddress(sparkAddress) }}</span>
            <q-icon name="las la-copy" size="14px" class="pill-copy" />
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <q-btn
              flat
              no-caps
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="copySparkAddress"
            >
              <q-icon name="las la-copy" size="18px" />
              <span>{{ $t('Copy') }}</span>
            </q-btn>
            <q-btn
              flat
              no-caps
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareSparkAddress"
            >
              <q-icon name="las la-share-alt" size="18px" />
              <span>{{ $t('Share') }}</span>
            </q-btn>
          </div>

          <!-- User Hint -->
          <div class="address-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Share this address to receive zero-fee payments from other Spark wallets.') }}
          </div>
        </div>

        <!-- Bitcoin (L1) Receive View -->
        <L1BitcoinReceive
          v-if="showBitcoinReceiveView"
          :qr-options="qrOptions"
          @deposit-claimed="handleBitcoinDepositClaimed"
          @deposits-updated="handleBitcoinDepositsUpdated"
        />

        <!-- Lightning Invoice Display -->
        <div class="lightning-receive" v-if="generatedInvoice">
          <!-- Amount Section -->
          <div class="ln-amount-section">
            <span class="ln-amount" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
              {{ formatInvoiceAmount(generatedInvoice.amount) }}
            </span>
            <span class="ln-fiat" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ formatInvoiceFiat(generatedInvoice.amount) }}
            </span>
            <span v-if="generatedInvoice.description && generatedInvoice.description !== 'BuhoGO Payment'"
                  class="ln-memo" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ generatedInvoice.description }}
            </span>
          </div>

          <!-- QR Code - Same structure as Spark/Bitcoin -->
          <div class="qr-section">
            <div class="qr-card" @click="copyInvoice">
              <div class="qr-frame">
                <vue-qrcode
                  :value="'lightning:' + generatedInvoice.payment_request.toUpperCase()"
                  :options="invoiceQrOptions"
                  class="qr-code"
                />
              </div>
            </div>
            <!-- Status -->
            <div class="ln-status" :class="paymentStatusClass">
              <div class="ln-status-dot"></div>
              <span>{{ paymentStatusMessage || $t('Waiting for payment...') }}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <q-btn
              flat
              no-caps
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="copyInvoice"
            >
              <q-icon name="las la-copy" size="18px" />
              <span>{{ $t('Copy') }}</span>
            </q-btn>
            <q-btn
              flat
              no-caps
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareInvoice"
            >
              <q-icon name="las la-share-alt" size="18px" />
              <span>{{ $t('Share') }}</span>
            </q-btn>
          </div>
        </div>

        <!-- Lightning Address View -->
        <div v-else-if="showAddressView && hasLightningAddress" class="address-view">
          <!-- Centered QR Section -->
          <div class="address-qr-section">
            <div class="qr-container" @click="copyLightningAddress">
              <div class="qr-wrapper">
                <vue-qrcode
                  :value="'lightning:' + lightningAddress"
                  :options="qrOptions"
                  class="qr-code"
                />
              </div>
            </div>

            <!-- Address Display -->
            <div
              class="address-display-box"
              :class="$q.dark.isActive ? 'address-box-dark' : 'address-box-light'"
              @click="copyLightningAddress"
            >
              <q-icon name="las la-at" size="18px" class="address-icon" />
              <span class="address-text-value">{{ lightningAddress }}</span>
              <q-icon name="las la-copy" size="16px" class="copy-icon" />
            </div>

            <!-- User Hint -->
            <div class="address-hint" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">
              {{ $t('Your permanent payment address. Share this QR or address to receive payments anytime.') }}
            </div>
          </div>
        </div>

        <!-- Amount Section (only for invoice creation, not for static address views) -->
        <div class="amount-section" v-else-if="!showSparkAddressView && !showBitcoinReceiveView">
          <!-- Currency Toggle -->
          <div class="currency-toggle" @click="toggleCurrency"
               :class="$q.dark.isActive ? 'currency-toggle-dark' : 'currency-toggle-light'">
            <span class="currency-label">{{ currentCurrency }}</span>
            <q-icon name="las la-redo-alt" class="toggle-icon"/>
          </div>

          <!-- Amount Input -->
          <div class="amount-input-container">
            <div class="amount-display">
              <!--              <span class="currency-symbol"-->
              <!--                    :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ getCurrencySymbol() }}</span>-->
              <input
                v-model="displayAmount"
                @input="onAmountChange"
                @focus="onAmountFocus"
                @blur="onAmountBlur"
                type="text"
                inputmode="decimal"
                class="amount-input"
                :class="$q.dark.isActive ? 'amount-input-dark' : 'amount-input-light'"
                :placeholder="getAmountPlaceholder()"
              />
            </div>
          </div>
        </div>

        <!-- Description Section (only for invoice creation) -->
        <div class="description-section" v-if="!generatedInvoice && !showAddressView && !showSparkAddressView && !showBitcoinReceiveView">
          <div class="description-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Description (optional)') }}
          </div>
          <div class="description-input-container">
            <input
              v-model="description"
              type="text"
              :placeholder="$t('No description')"
              class="description-input"
              :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
              maxlength="100"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Footer (only for invoice creation) -->
      <q-card-section class="receive-footer" v-if="!generatedInvoice && !showAddressView && !showSparkAddressView && !showBitcoinReceiveView">
        <div class="receive-footer-buttons">
          <q-btn
            flat
            round
            dense
            icon="las la-qrcode"
            class="scan-withdraw-btn"
            :class="$q.dark.isActive ? 'scan-btn-dark' : 'scan-btn-light'"
            @click="$emit('scan-withdraw')"
          >
            <q-tooltip>{{ $t('Scan to redeem') }}</q-tooltip>
          </q-btn>
          <q-btn
            class="create-invoice-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :loading="isCreatingInvoice"
            @click="createInvoice"
            :disable="!isValidAmount"
            no-caps
            unelevated
          >
            <span v-if="!isCreatingInvoice">{{ $t('Create Invoice') }}</span>
            <template v-slot:loading>
              <q-spinner-dots class="q-mr-sm"/>
              {{ $t('Creating...') }}
            </template>
          </q-btn>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Payment Confirmation Screen -->
  <PaymentConfirmation
    v-model="showPaymentConfirmation"
    :amount="confirmedAmount"
    :fiat-amount="confirmedFiatAmount"
    :description="generatedInvoice?.description"
    :auto-close-delay="5"
    @closed="handleConfirmationClosed"
  />
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { NostrWebLNProvider } from "@getalby/sdk";
import { Invoice } from "@getalby/lightning-tools";
import { formatAmount } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { createPaymentMonitor, PaymentStatus, checkNWCPaymentStatus } from '../utils/paymentMonitor';
import { shareContent } from '../utils/share';
import { truncateAddress } from '../utils/addressUtils';
import { getQrOptions } from '../utils/qrConfig';
import PaymentConfirmation from './PaymentConfirmation.vue';
import L1BitcoinReceive from './L1BitcoinReceive.vue';

export default {
  name: 'ReceiveModal',
  components: {
    VueQrcode,
    PaymentConfirmation,
    L1BitcoinReceive
  },
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'invoice-created', 'bitcoin-deposits-updated', 'scan-withdraw'],
  data() {
    return {
      displayAmount: '',
      description: '',
      currentCurrency: 'sats',
      isCreatingInvoice: false,
      generatedInvoice: null,
      walletState: {},
      amountInSats: 0,
      isAmountFocused: false,
      showAddressView: false,
      receiveMode: 'lightning', // 'lightning', 'spark', or 'bitcoin'
      // Payment monitoring
      paymentMonitor: null,
      sparkEventUnsubscribe: null, // For Spark event-based monitoring
      nwcNotificationUnsubscribe: null, // For NWC notification-based monitoring
      paymentStatus: PaymentStatus.PENDING,
      paymentStatusMessage: '',
      isPaymentConfirmed: false,
      // Payment confirmation screen
      showPaymentConfirmation: false,
      confirmedAmount: 0,
      confirmedFiatAmount: '',
      // Screen width for responsive QR sizing
      screenWidth: typeof window !== 'undefined' ? window.innerWidth : 375
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    },
    isValidAmount() {
      return this.amountInSats > 0;
    },
    hasLightningAddress() {
      return !!this.walletStore.activeWalletLightningAddress;
    },
    lightningAddress() {
      return this.walletStore.activeWalletLightningAddress;
    },
    isSparkWallet() {
      return this.walletStore.isActiveWalletSpark;
    },
    isLNBitsWallet() {
      return this.walletStore.isActiveWalletLNBits;
    },
    sparkAddress() {
      return this.walletStore.activeSparkAddress;
    },
    showSparkAddressView() {
      return this.isSparkWallet && this.receiveMode === 'spark' && !this.generatedInvoice;
    },
    showBitcoinReceiveView() {
      return this.isSparkWallet && this.receiveMode === 'bitcoin' && !this.generatedInvoice;
    },
    paymentStatusClass() {
      switch (this.paymentStatus) {
        case PaymentStatus.CONFIRMED:
          return 'status-confirmed';
        case PaymentStatus.EXPIRED:
          return 'status-expired';
        case PaymentStatus.ERROR:
          return 'status-error';
        default:
          return 'status-pending';
      }
    },
    paymentStatusDotClass() {
      switch (this.paymentStatus) {
        case PaymentStatus.CONFIRMED:
          return 'dot-confirmed';
        case PaymentStatus.EXPIRED:
          return 'dot-expired';
        case PaymentStatus.ERROR:
          return 'dot-error';
        default:
          return 'dot-pending';
      }
    },
    /**
     * Dynamic QR code options based on screen width
     * Ensures QR codes always fit within the viewport
     */
    qrOptions() {
      let qrSize;

      if (this.screenWidth <= 320) {
        // Extra small phones (iPhone SE 1st gen)
        qrSize = Math.min(this.screenWidth - 80, 200);
      } else if (this.screenWidth <= 375) {
        // Small phones (iPhone SE, iPhone 8)
        qrSize = Math.min(this.screenWidth - 70, 240);
      } else if (this.screenWidth <= 414) {
        // Medium phones (iPhone Plus, most Android)
        qrSize = Math.min(this.screenWidth - 60, 270);
      } else {
        // Larger screens
        qrSize = 280;
      }

      return {
        width: qrSize,
        margin: 0,
        color: { dark: '#000000', light: '#ffffff' }
      };
    },
    receiveModeOptions() {
      const sparkIcon = this.$q.dark.isActive
        ? 'img:/Spark/Spark Asterisk White.svg'
        : 'img:/Spark/Spark Asterisk Black.svg';
      return [
        { label: this.$t('Lightning'), value: 'lightning', icon: 'las la-bolt' },
        { label: this.$t('Spark'), value: 'spark', icon: sparkIcon },
        { label: this.$t('Bitcoin'), value: 'bitcoin', icon: 'lab la-bitcoin' }
      ];
    },
    sparkPillIcon() {
      return this.$q.dark.isActive
        ? '/Spark/Spark Asterisk White.svg'
        : '/Spark/Spark Asterisk Black.svg';
    },
    sparkQrOptions() {
      return getQrOptions();
    },
    invoiceQrOptions() {
      return getQrOptions();
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.loadWalletState();
        this.resetForm();
      } else {
        // Stop monitoring when modal closes
        this.stopPaymentMonitor();
      }
    }
  },
  mounted() {
    // Listen for window resize to update QR size
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    // Cleanup on component destroy
    this.stopPaymentMonitor();
    window.removeEventListener('resize', this.handleResize);
  },
  methods: {
    // ... (keeping all existing methods from the original component)
    loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        this.walletState = JSON.parse(savedState);
      }
    },

    /**
     * Handle window resize for responsive QR sizing
     */
    handleResize() {
      this.screenWidth = window.innerWidth;
    },

    resetForm() {
      this.stopPaymentMonitor();
      this.displayAmount = '';
      this.description = '';
      this.generatedInvoice = null;
      this.amountInSats = 0;
      this.showAddressView = false;
      this.receiveMode = 'lightning';
      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = '';
      this.isPaymentConfirmed = false;
      // Reset confirmation data
      this.confirmedAmount = 0;
      this.confirmedFiatAmount = '';
    },

    closeModal() {
      this.stopPaymentMonitor();
      this.show = false;
    },

    /**
     * Set receive mode programmatically (for parent component access)
     * @param {string} mode - 'lightning', 'spark', or 'bitcoin'
     */
    setReceiveMode(mode) {
      if (['lightning', 'spark', 'bitcoin'].includes(mode)) {
        this.receiveMode = mode;
      }
    },

    /**
     * Handle Bitcoin deposit claimed - show confirmation
     */
    handleBitcoinDepositClaimed(result) {
      // Show success confirmation similar to Lightning payments
      this.confirmedAmount = result.amount;
      this.confirmedFiatAmount = this.calculateFiatAmount(result.amount);
      this.showPaymentConfirmation = true;
    },

    /**
     * Handle Bitcoin deposits list updated
     */
    handleBitcoinDepositsUpdated(deposits) {
      // Emit event for parent components (Wallet.vue) to update banner
      this.$emit('bitcoin-deposits-updated', deposits);
    },

    /**
     * Calculate fiat amount for confirmation display
     */
    calculateFiatAmount(sats) {
      const rate = this.walletState.exchangeRates?.['usd'];
      if (!rate) return '--';
      const btc = sats / 100000000;
      const fiat = btc * rate;
      return `$${fiat.toFixed(2)}`;
    },

    /**
     * Stop the payment monitor if running
     */
    stopPaymentMonitor() {
      // Stop polling-based monitor (NWC)
      if (this.paymentMonitor) {
        this.paymentMonitor.stop();
        this.paymentMonitor = null;
      }
      // Unsubscribe from Spark events
      if (this.sparkEventUnsubscribe) {
        this.sparkEventUnsubscribe();
        this.sparkEventUnsubscribe = null;
      }
      // Unsubscribe from NWC notifications
      if (this.nwcNotificationUnsubscribe) {
        this.nwcNotificationUnsubscribe();
        this.nwcNotificationUnsubscribe = null;
      }
    },

    /**
     * Start monitoring for payment confirmation
     * Uses event-based for Spark (instant), polling for LNBits/NWC
     */
    async startPaymentMonitor() {
      if (!this.generatedInvoice?.payment_hash) {
        console.warn('Cannot start payment monitor: no invoice payment_hash');
        return;
      }

      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = this.$t('Waiting for payment...');

      if (this.isSparkWallet) {
        await this.startSparkEventMonitor();
      } else if (this.isLNBitsWallet) {
        await this.startLNBitsPollingMonitor();
      } else {
        await this.startNWCPollingMonitor();
      }
    },

    /**
     * Start Spark event-based payment monitoring (real-time, no polling)
     */
    async startSparkEventMonitor() {
      try {
        const provider = await this.walletStore.ensureSparkConnected();

        // Subscribe to payment events
        this.sparkEventUnsubscribe = provider.onPaymentReceived((transferId, newBalance) => {
          this.handlePaymentStatus(PaymentStatus.CONFIRMED, {
            transferId,
            amount: this.generatedInvoice?.amount,
            newBalance
          });
        });
      } catch (error) {
        console.warn('Could not start Spark event monitoring, falling back to polling:', error);
        // Fallback to polling if events fail
        await this.startNWCPollingMonitor();
      }
    },

    /**
     * Start NWC payment monitoring using polling
     * Falls back to listTransactions if lookupInvoice is not supported
     */
    async startNWCPollingMonitor() {
      let rawProvider = null;
      let wrappedProvider = null;

      try {
        rawProvider = this.walletStore.getActiveProvider();

        if (!rawProvider) {
          // Create NWC provider on-the-fly
          const activeWallet = this.walletState.connectedWallets?.find(
            w => w.id === this.walletState.activeWalletId
          );

          if (activeWallet?.nwcString) {
            rawProvider = new NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            await rawProvider.enable();
          }
        }
      } catch (error) {
        console.warn('Could not get provider for payment monitoring:', error.message);
        return;
      }

      if (!rawProvider) {
        console.warn('No provider available for payment monitoring');
        return;
      }

      // Wrap the provider with robust payment status detection
      // Many NWC wallets don't support lookupInvoice, so we use listTransactions as fallback
      wrappedProvider = {
        lookupInvoice: async (hash) => {
          // Try lookupInvoice first (may not be supported by all wallets)
          try {
            const invoice = await rawProvider.lookupInvoice({ payment_hash: hash });
            if (invoice) {
              const isPaid = checkNWCPaymentStatus(invoice);
              if (isPaid) {
                return { paid: true, preimage: invoice?.preimage, amount: invoice?.amount };
              }
            }
          } catch (e) {
            // lookupInvoice not supported or timed out - use fallback
          }

          // Fallback: Search in recent transactions
          try {
            const txResponse = await rawProvider.listTransactions({
              limit: 50,
              unpaid: false,
              type: 'incoming'
            });

            if (txResponse?.transactions) {
              const found = txResponse.transactions.find(tx =>
                tx.payment_hash === hash || tx.paymentHash === hash
              );

              if (found && checkNWCPaymentStatus(found)) {
                return {
                  paid: true,
                  preimage: found.preimage,
                  amount: Math.abs(found.amount || 0)
                };
              }
            }
          } catch (listError) {
            // listTransactions also failed - return not paid
          }

          return { paid: false };
        }
      };

      // Start polling for payment confirmation
      this.paymentMonitor = createPaymentMonitor();

      this.paymentMonitor.start({
        invoice: {
          payment_hash: this.generatedInvoice.payment_hash,
          expires_at: this.generatedInvoice.expires_at,
          amount: this.generatedInvoice.amount
        },
        provider: wrappedProvider,
        onStatusChange: (status, data) => {
          if (!this.isPaymentConfirmed) {
            this.handlePaymentStatus(status, data);
          }
        }
      });
    },

    /**
     * Start LNBits payment monitoring using polling
     * Uses the LNBits API to check payment status
     */
    async startLNBitsPollingMonitor() {
      let rawProvider = null;

      try {
        rawProvider = this.walletStore.getActiveProvider();
      } catch (error) {
        console.warn('Could not get LNBits provider for payment monitoring:', error.message);
        return;
      }

      if (!rawProvider) {
        console.warn('No LNBits provider available for payment monitoring');
        return;
      }

      // Wrap the LNBits provider with the expected interface
      const wrappedProvider = {
        lookupInvoice: async (hash) => {
          try {
            // LNBits lookupInvoice expects a string payment hash
            const result = await rawProvider.lookupInvoice(hash);
            return result;
          } catch (error) {
            console.warn('LNBits lookupInvoice error:', error.message);
            return { paid: false };
          }
        }
      };

      // Start polling for payment confirmation
      this.paymentMonitor = createPaymentMonitor();

      this.paymentMonitor.start({
        invoice: {
          payment_hash: this.generatedInvoice.payment_hash,
          expires_at: this.generatedInvoice.expires_at,
          amount: this.generatedInvoice.amount
        },
        provider: wrappedProvider,
        onStatusChange: (status, data) => {
          if (!this.isPaymentConfirmed) {
            this.handlePaymentStatus(status, data);
          }
        }
      });
    },

    /**
     * Handle payment status updates from monitor
     */
    handlePaymentStatus(status, data) {
      this.paymentStatus = status;

      switch (status) {
        case PaymentStatus.CONFIRMED:
          this.isPaymentConfirmed = true;
          this.paymentStatusMessage = this.$t('Payment received!');

          // Stop monitoring
          this.stopPaymentMonitor();

          // Set confirmed amount for confirmation screen
          this.confirmedAmount = data.amount || this.generatedInvoice?.amount || 0;
          this.confirmedFiatAmount = this.formatInvoiceFiat(this.confirmedAmount);

          // Close the receive modal and show confirmation screen
          this.show = false;
          this.$nextTick(() => {
            this.showPaymentConfirmation = true;
          });

          // Refresh wallet balance in background
          if (this.walletStore.activeWalletId) {
            this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
          }
          break;

        case PaymentStatus.EXPIRED:
          this.paymentStatusMessage = this.$t('Invoice expired');
          this.$q.notify({
            type: 'warning',
            message: this.$t('Invoice expired'),
            caption: this.$t('Please create a new invoice'),
            
            timeout: 4000,
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
          break;

        case PaymentStatus.ERROR:
          this.paymentStatusMessage = data.message || this.$t('Error checking payment');
          break;

        case PaymentStatus.PENDING:
        default:
          this.paymentStatusMessage = this.$t('Waiting for payment...');
          break;
      }
    },

    toggleCurrency() {
      const currencies = ['sats', this.walletState.preferredFiatCurrency?.toLowerCase() || 'usd'];
      const currentIndex = currencies.indexOf(this.currentCurrency);
      const nextIndex = (currentIndex + 1) % currencies.length;
      this.currentCurrency = currencies[nextIndex];
      this.convertAmount();
    },

    getCurrencySymbol() {
      switch (this.currentCurrency) {
        case 'sats':
          return 'Sats';
        case 'btc':
          return '₿';
        case 'usd':
          return '$';
        case 'eur':
          return '€';
        case 'gbp':
          return '£';
        case 'jpy':
          return '¥';
        default:
          return '$';
      }
    },

    getAmountPlaceholder() {
      switch (this.currentCurrency) {
        case 'sats':
          return '0';
        case 'btc':
          return '0.00000000';
        default:
          return '0.00';
      }
    },

    onAmountChange() {
      this.convertAmount();
    },

    onAmountFocus() {
      this.isAmountFocused = true;
    },

    onAmountBlur() {
      this.isAmountFocused = false;
      this.formatDisplayAmount();
    },

    convertAmount() {
      const amount = parseFloat(this.displayAmount) || 0;

      switch (this.currentCurrency) {
        case 'sats':
          this.amountInSats = Math.floor(amount);
          break;
        case 'btc':
          this.amountInSats = Math.floor(amount * 100000000);
          break;
        default:
          const rate = this.walletState.exchangeRates?.[this.currentCurrency];
          if (!rate) return;
          const btcAmount = amount / rate;
          this.amountInSats = Math.floor(btcAmount * 100000000);
          break;
      }
    },

    formatDisplayAmount() {
      if (!this.isAmountFocused && this.displayAmount) {
        const amount = parseFloat(this.displayAmount);
        if (!isNaN(amount)) {
          switch (this.currentCurrency) {
            case 'sats':
              this.displayAmount = Math.floor(amount).toString();
              break;
            case 'btc':
              this.displayAmount = amount.toFixed(8);
              break;
            default:
              this.displayAmount = amount.toFixed(2);
              break;
          }
        }
      }
    },

    async createInvoice() {
      if (!this.isValidAmount) return;

      this.isCreatingInvoice = true;
      try {
        const invoiceParams = {
          amount: this.amountInSats,
          description: this.description || 'BuhoGO Payment',
          expiry: 3600
        };

        let invoice;

        const walletType = this.walletStore.activeWalletType;

        // Check wallet type and use appropriate provider
        if (walletType === 'spark') {
          // Use Spark wallet provider
          const provider = this.walletStore.getActiveProvider();
          if (!provider) {
            throw new Error('Spark wallet not unlocked. Please enter your PIN.');
          }

          const result = await provider.createInvoice(invoiceParams);
          invoice = {
            paymentRequest: result.paymentRequest,
            payment_hash: result.paymentHash,
            amount: this.amountInSats,
            description: invoiceParams.description,
            expires_at: result.expiresAt
          };
        } else if (walletType === 'lnbits') {
          // Use LNBits wallet provider
          const provider = this.walletStore.getActiveProvider();
          if (!provider) {
            throw new Error('LNBits wallet not connected');
          }

          const result = await provider.createInvoice(invoiceParams);
          invoice = {
            paymentRequest: result.paymentRequest,
            payment_hash: result.paymentHash,
            amount: this.amountInSats,
            description: invoiceParams.description,
            expires_at: result.expiresAt
          };
        } else {
          // Use NWC for NWC wallets
          const activeWallet = this.walletState.connectedWallets?.find(
            w => w.id === this.walletState.activeWalletId
          );

          if (!activeWallet || !activeWallet.nwcString) {
            throw new Error('No active wallet found');
          }

          const nwc = new NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          invoice = await nwc.makeInvoice(invoiceParams);
        }

        const paymentRequest = invoice.paymentRequest || invoice.payment_request;
        if (!paymentRequest) {
          throw new Error('Invalid invoice: missing payment request');
        }

        // Extract payment_hash - try multiple field names used by different wallets
        let paymentHash = invoice.payment_hash || invoice.paymentHash || invoice.rHash || invoice.r_hash;

        // If payment_hash is not in response, decode it from the bolt11 invoice
        if (!paymentHash) {
          paymentHash = this._extractPaymentHashFromBolt11(paymentRequest);
        }

        const processedInvoice = {
          payment_request: paymentRequest,
          payment_hash: paymentHash,
          amount: invoice.amount || this.amountInSats,
          description: invoice.description || this.description || 'BuhoGO Payment',
          expires_at: invoice.expires_at || invoice.expiresAt,
          created_at: Math.floor(Date.now() / 1000)
        };

        this.generatedInvoice = processedInvoice;
        this.$emit('invoice-created', processedInvoice);

        this.$q.notify({
          type: 'positive',
          message: this.$t('Invoice ready'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        // Start monitoring for payment confirmation
        this.startPaymentMonitor();

      } catch (error) {
        console.error('Error creating invoice:', error);

        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t create invoice'),
          caption: this.$t('Please try again'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        this.generatedInvoice = null;
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    async copyInvoice() {
      if (!this.generatedInvoice) return;

      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Invoice copied'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    showLightningAddress() {
      this.showAddressView = true;
      this.generatedInvoice = null;
    },

    async copyLightningAddress() {
      if (!this.lightningAddress) return;

      try {
        await navigator.clipboard.writeText(this.lightningAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async copySparkAddress() {
      if (!this.sparkAddress) return;

      try {
        await navigator.clipboard.writeText(this.sparkAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Spark address copied'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async shareSparkAddress() {
      if (!this.sparkAddress) return;

      const result = await shareContent({
        title: this.$t('Spark Address'),
        text: this.sparkAddress
      });

      if (result.success) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Shared'),

          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } else if (result.reason === 'unsupported') {
        // Fallback: copy to clipboard
        await this.copySparkAddress();
      } else if (result.reason === 'error') {
        console.error('Failed to share Spark address:', result.error);
        await this.copySparkAddress();
      }
      // Don't do anything for 'cancelled' - user just closed the dialog
    },

    truncateSparkAddress(address) {
      return truncateAddress(address);
    },

    formatInvoiceAmount(sats) {
      if (!sats) return formatAmount(0, this.walletStore.useBip177Format);
      return formatAmount(sats, this.walletStore.useBip177Format);
    },

    formatInvoiceFiat(sats) {
      if (!sats || !this.walletState.exchangeRates) return '';

      const fiatCurrency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates?.[fiatCurrency.toLowerCase()];
      if (!rate) return '';
      const btcAmount = sats / 100000000;
      const fiatAmount = btcAmount * rate;

      return `≈ $${fiatAmount.toFixed(2)} ${fiatCurrency}`;
    },

    async shareInvoice() {
      if (!this.generatedInvoice) return;

      // Lightning URI for sharing (most wallets recognize this format)
      const lightningUri = `lightning:${this.generatedInvoice.payment_request}`;

      const result = await shareContent({
        title: this.$t('Lightning Invoice'),
        text: lightningUri
      });

      if (result.success) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Shared'),

          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share invoice:', result.error);
        }
        // Fallback: copy to clipboard
        try {
          await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Invoice copied'),

            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        } catch (copyError) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Couldn\'t share'),

            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      }
      // Don't do anything for 'cancelled' - user just closed the dialog
    },

    /**
     * Handle when the payment confirmation screen is closed
     * Redirects to home/wallet page
     */
    handleConfirmationClosed() {
      this.showPaymentConfirmation = false;
      this.resetForm();

      // Navigate to home/wallet page
      if (this.$router.currentRoute.value.path !== '/wallet') {
        this.$router.push('/wallet');
      }
    },

    /**
     * Extract payment hash from a bolt11 invoice string
     * Uses @getalby/lightning-tools Invoice decoder
     * @param {string} bolt11 - The bolt11 invoice string
     * @returns {string|null} The payment hash in hex format, or null if extraction fails
     */
    _extractPaymentHashFromBolt11(bolt11) {
      try {
        const invoice = new Invoice({ pr: bolt11 });
        // The Invoice class provides paymentHash property
        return invoice.paymentHash || null;
      } catch (error) {
        console.warn('[_extractPaymentHashFromBolt11] Failed to decode bolt11:', error.message);
        return null;
      }
    },

  }
}
</script>

<style scoped>
.receive-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.receive-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Header */
.receive-header {
  border-bottom: 1px solid;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.header-dark {
  border-bottom-color: #2A342A;
}

.header-light {
  border-bottom-color: #E5E7EB;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
}

.back-btn-dark {
  color: #FFF;
}

.back-btn-light {
  color: #212121;
}

.header-title {
  flex: 1;
  text-align: center;
  margin: 0 1rem;
}

.address-btn {
  width: 40px;
  height: 40px;
}

/* Content */
.receive-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  overflow-y: auto;
  justify-content: space-between;
  min-height: 0;
}

/* Amount Icon Section */
.amount-icon-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
  align-items: center;
}

.amount-icon {
  opacity: 0.3;
}

/* ===========================================
   Shared QR Code Styles - Used by Lightning, Spark, Bitcoin
   =========================================== */
.qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
}

.qr-card {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.qr-card:active {
  transform: scale(0.98);
}

.qr-frame {
  background: white;
  padding: 14px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.qr-frame .qr-code {
  display: block;
  border-radius: 8px;
}

.qr-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.5;
}

/* ===========================================
   Lightning Receive
   =========================================== */
.lightning-receive {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
}

/* Amount Section */
.ln-amount-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 16px;
}

.ln-amount {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}

.ln-fiat {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  margin-top: 4px;
}

.ln-memo {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 400;
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
}

/* Status */
.ln-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 212, 59, 0.1);
}

.ln-status span {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #FFD43B;
}

.ln-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FFD43B;
  animation: pulse 2s ease-in-out infinite;
}

/* Status Variants */
.ln-status.status-pending { background: rgba(255, 212, 59, 0.1); }
.ln-status.status-pending span { color: #FFD43B; }
.ln-status.status-pending .ln-status-dot { background: #FFD43B; }

.ln-status.status-confirmed { background: rgba(21, 222, 114, 0.1); }
.ln-status.status-confirmed span { color: #15DE72; }
.ln-status.status-confirmed .ln-status-dot { background: #15DE72; animation: none; }

.ln-status.status-expired { background: rgba(107, 114, 128, 0.1); }
.ln-status.status-expired span { color: #6B7280; }
.ln-status.status-expired .ln-status-dot { background: #6B7280; animation: none; }

.ln-status.status-error { background: rgba(239, 68, 68, 0.1); }
.ln-status.status-error span { color: #EF4444; }
.ln-status.status-error .ln-status-dot { background: #EF4444; animation: none; }

/* Responsive - Lightning Amount */
@media (max-width: 375px) {
  .ln-amount {
    font-size: 32px;
  }

  .ln-fiat {
    font-size: 13px;
  }
}

@media (max-width: 320px) {
  .ln-amount {
    font-size: 28px;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.9);
  }
}

/* QR Container - Used by Lightning Address View */
.qr-container {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: min(320px, calc(100vw - 48px)); /* Never exceed viewport minus padding */
  -webkit-tap-highlight-color: transparent;
}

.qr-wrapper {
  background: #FFF;
  border-radius: 16px;
  padding: clamp(0.75rem, 3vw, 1.25rem); /* Responsive padding */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  border: 1px solid rgba(0, 0, 0, 0.08);
  width: 100%;
  box-sizing: border-box;
}

.qr-container:active .qr-wrapper {
  transform: scale(0.97);
}

.qr-code {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
  max-width: 100%;
}

/* Action Buttons - Shared Style */
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
}

.action-btn-dark {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.action-btn-light {
  color: rgba(0, 0, 0, 0.7);
  background: rgba(0, 0, 0, 0.05);
}

.action-btn-light:hover {
  background: rgba(0, 0, 0, 0.08);
}


/* Amount Section */
.amount-section {
  margin-bottom: 2rem;
  text-align: center;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.currency-toggle-dark {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #2A342A;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  cursor: pointer;
  margin: 0 auto 1.5rem;
  transition: background-color 0.2s;
  width: fit-content;
}

.currency-toggle-light {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #E5E7EB;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  cursor: pointer;
  margin: 0 auto 1.5rem;
  transition: background-color 0.2s;
  width: fit-content;
}

.currency-toggle-dark:hover {
  background: #1F231F;
}

.currency-toggle-light:hover {
  background: #D1D5DB;
}

.currency-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #B0B0B0;
  text-transform: capitalize;
  letter-spacing: 0.025em;
}

.toggle-icon {
  color: #B0B0B0;
  font-size: 12px;
}

.amount-input-container {
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.amount-display {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.currency-symbol {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 2.5rem;
  font-weight: 300;
}

.amount-input {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 2.75rem;
  font-weight: 300;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  min-width: 200px;
}

.amount-input-dark {
  color: #FFF;
}

.amount-input-light {
  color: #374151;
}

.amount-input::placeholder {
  color: #B0B0B0;
}

/* Description Section */
.description-section {
  margin-bottom: 2rem;
  flex-shrink: 0;
}

.description-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  margin-bottom: 0.75rem;
  text-align: center;
}

.view_title_dark {
  color: #B0B0B0;
}

.description-input-container {
  max-width: 320px;
  margin: 0 auto;
}

.description-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-radius: 20px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.description-input:focus {
  border-color: #15DE72;
}

.description-input::placeholder {
  color: #B0B0B0;
}

/* Footer */
.receive-footer {
  padding: 1rem 1.5rem 1.5rem;
  flex-shrink: 0;
}

.receive-footer-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scan-withdraw-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  flex-shrink: 0;
}

.scan-btn-dark {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.scan-btn-light {
  background: rgba(0, 0, 0, 0.05);
  color: rgba(0, 0, 0, 0.5);
}

.create-invoice-btn {
  width: 100%;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  transition: all 0.2s ease;
  border: none;
  cursor: pointer;
}

/* Responsive Design */
@media (max-width: 480px) {
  .receive-content {
    padding: 1.5rem 1rem;
  }

  .action-buttons {
    gap: 10px;
  }

  .action-btn {
    padding: 8px 14px;
    font-size: 13px;
  }

  .invoice-actions {
    max-width: 320px;
  }

  .invoice-action-btn {
    height: 42px;
    font-size: 14px;
  }

  .amount-icon-section {
    margin-bottom: 1.5rem;
  }

  .amount-input {
    font-size: 2.25rem;
    min-width: 160px;
  }

  .currency-symbol {
    font-size: 2rem;
  }

  .amount-section {
    margin-bottom: 1.5rem;
  }

  .description-section {
    margin-bottom: 1.5rem;
  }

  .description-input-container {
    max-width: 280px;
  }

  .receive-footer {
    padding: 0.75rem 1rem 1.25rem;
  }

  .create-invoice-btn {
    height: 48px;
  }
}

/* Extra small screens (360px and below) */
@media (max-width: 360px) {
  .action-buttons {
    gap: 8px;
  }

  .action-btn {
    padding: 8px 12px;
    font-size: 13px;
  }

  .invoice-actions {
    max-width: calc(100vw - 48px);
    flex-direction: column;
  }

  .invoice-action-btn {
    width: 100%;
  }

  .amount-input {
    font-size: 2rem;
    min-width: 120px;
  }

  .currency-symbol {
    font-size: 1.75rem;
  }

  .address-qr-section {
    padding: 1rem;
  }
}

/* Spark Address View */
.spark-address-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  min-height: 0;
}

/* Address Pill - Shared by Spark */
.address-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 12px auto 0;
}

.address-pill:active {
  transform: scale(0.98);
}

.pill-dark {
  background: rgba(255, 255, 255, 0.08);
}

.pill-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.pill-light {
  background: rgba(0, 0, 0, 0.04);
}

.pill-light:hover {
  background: rgba(0, 0, 0, 0.06);
}

.pill-icon-img {
  width: 16px;
  height: 16px;
}

.pill-address {
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.pill-copy {
  opacity: 0.4;
}

.address-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  text-align: center;
  max-width: 280px;
  line-height: 1.4;
  margin-top: 16px;
}

/* Lightning Address View */
.address-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
  min-height: 0;
}

.address-qr-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem 2rem;
  gap: 1.25rem;
}

.address-display-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  cursor: pointer;
  width: 100%;
  max-width: 320px;
  transition: all 0.2s ease;
}

.address-box-dark {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.address-box-dark:hover {
  background: rgba(255, 255, 255, 0.08);
}

.address-box-dark:active {
  transform: scale(0.98);
}

.address-box-light {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.address-box-light:hover {
  background: rgba(0, 0, 0, 0.05);
}

.address-box-light:active {
  transform: scale(0.98);
}

.address-icon {
  color: #15DE72;
  flex-shrink: 0;
}

.address-text-value {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 13px;
  flex: 1;
  word-break: break-all;
  line-height: 1.3;
  text-align: center;
}

.copy-icon {
  opacity: 0.4;
  flex-shrink: 0;
}

.address-hint {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  text-align: center;
  line-height: 1.5;
  max-width: 280px;
  margin-top: 0.5rem;
}

@media (max-width: 480px) {
  .address-qr-section {
    padding: 1rem;
    gap: 1rem;
  }

  .address-display-box {
    max-width: 280px;
    padding: 0.625rem 0.875rem;
  }

  .address-text-value {
    font-size: 12px;
  }

  .address-hint {
    font-size: 12px;
    max-width: 260px;
  }
}

/* Spark/Lightning Toggle */
.receive-type-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.type-toggle {
  border-radius: 12px;
  overflow: hidden;
  max-width: 280px;
  width: 100%;
}

.type-toggle :deep(.q-btn) {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 0.625rem 1rem;
  min-height: 40px;
}

.type-toggle :deep(.q-btn__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.type-toggle :deep(.q-btn__content .q-icon) {
  margin: 0;
}

.toggle-dark {
  background: #1A1A1A;
  border: 1px solid #2A342A;
}

.toggle-dark :deep(.q-btn) {
  color: #B0B0B0;
}

.toggle-dark :deep(.q-btn--active) {
  background: linear-gradient(90deg, #059573, #15DE72);
  color: #FFFFFF;
}

.toggle-light {
  background: #F3F4F6;
  border: 1px solid #E5E7EB;
}

.toggle-light :deep(.q-btn) {
  color: #6B7280;
}

.toggle-light :deep(.q-btn--active) {
  background: linear-gradient(90deg, #059573, #15DE72);
  color: #FFFFFF;
}

.mode-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  text-align: center;
}

/* Spark Address Specific */
.spark-icon {
  color: #FF6B35;
}

.spark-address-box {
  margin-top: 1rem;
}

.spark-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  margin-top: 1rem;
}

@media (max-width: 480px) {
  .type-toggle {
    max-width: 260px;
  }

  .type-toggle :deep(.q-btn) {
    font-size: 12px;
    padding: 0.5rem 0.75rem;
    min-height: 36px;
  }

  .spark-actions {
    max-width: 280px;
  }
}
</style>
