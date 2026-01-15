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
            :options="[
              { label: $t('Invoice'), value: 'lightning', icon: 'las la-file-invoice' },
              { label: $t('Address'), value: 'spark', icon: 'las la-qrcode' }
            ]"
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
            <template v-else>
              {{ $t('One-time request with amount') }}
            </template>
          </div>
        </div>

        <!-- Spark Address View -->
        <div v-if="showSparkAddressView && sparkAddress" class="address-view">
          <div class="address-qr-section">
            <div class="qr-container" @click="copySparkAddress">
              <div class="qr-wrapper">
                <vue-qrcode
                  :value="sparkAddress"
                  :options="{ width: 280, margin: 0, color: { dark: '#000000', light: '#ffffff' } }"
                  class="qr-code"
                />
              </div>
            </div>

            <!-- Spark Address Display -->
            <div
              class="address-display-box spark-address-box"
              :class="$q.dark.isActive ? 'address-box-dark' : 'address-box-light'"
              @click="copySparkAddress"
            >
              <q-icon name="las la-fire" size="18px" class="address-icon spark-icon" />
              <span class="address-text-value">{{ truncateSparkAddress(sparkAddress) }}</span>
              <q-icon name="las la-copy" size="16px" class="copy-icon" />
            </div>

            <!-- Action Buttons -->
            <div class="spark-actions">
              <q-btn
                flat
                no-caps
                class="invoice-action-btn"
                :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
                @click="copySparkAddress"
              >
                <q-icon name="las la-copy" size="20px" class="q-mr-xs"/>
                {{ $t('Copy') }}
              </q-btn>
              <q-btn
                flat
                no-caps
                class="invoice-action-btn"
                :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
                @click="shareSparkAddress"
              >
                <q-icon name="las la-share-alt" size="20px" class="q-mr-xs"/>
                {{ $t('Share') }}
              </q-btn>
            </div>

            <!-- User Hint -->
            <div class="address-hint" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">
              {{ $t('Share this address to receive zero-fee payments from other Spark wallets.') }}
            </div>
          </div>
        </div>

        <!-- QR Code Display -->
        <div class="qr-display-section" v-if="generatedInvoice">
          <!-- Payment Status Badge -->
          <div class="status-badge" :class="paymentStatusClass">
            <div class="status-dot" :class="paymentStatusDotClass"></div>
            <span>{{ paymentStatusMessage || $t('Waiting for payment...') }}</span>
          </div>

          <!-- Amount Display -->
          <div class="invoice-amount-section">
            <div class="invoice-amount" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
              {{ formatInvoiceAmount(generatedInvoice.amount) }}
            </div>
            <div class="invoice-fiat" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ formatInvoiceFiat(generatedInvoice.amount) }}
            </div>
          </div>

          <!-- Description/Memo -->
          <div v-if="generatedInvoice.description && generatedInvoice.description !== 'BuhoGO Payment'"
               class="invoice-memo"
               :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ generatedInvoice.description }}
          </div>

          <!-- QR Code -->
          <div class="qr-container" @click="copyInvoice">
            <div class="qr-wrapper">
              <vue-qrcode
                :value="generatedInvoice.payment_request"
                :options="{ width: 280, margin: 0, color: { dark: '#000000', light: '#ffffff' } }"
                class="qr-code"
              />
            </div>
            <div class="qr-tap-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Tap to copy invoice') }}
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="invoice-actions">
            <q-btn
              flat
              no-caps
              class="invoice-action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="copyInvoice"
            >
              <q-icon name="las la-copy" size="20px" class="q-mr-xs"/>
              {{ $t('Copy') }}
            </q-btn>
            <q-btn
              flat
              no-caps
              class="invoice-action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareInvoice"
            >
              <q-icon name="las la-share-alt" size="20px" class="q-mr-xs"/>
              {{ $t('Share') }}
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
                  :options="{ width: 280, margin: 0, color: { dark: '#000000', light: '#ffffff' } }"
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
        <div class="amount-section" v-else-if="!showSparkAddressView">
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
        <div class="description-section" v-if="!generatedInvoice && !showAddressView && !showSparkAddressView">
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
      <q-card-section class="receive-footer" v-if="!generatedInvoice && !showAddressView && !showSparkAddressView">
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
import { formatAmount } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { createPaymentMonitor, PaymentStatus } from '../utils/paymentMonitor';
import PaymentConfirmation from './PaymentConfirmation.vue';

export default {
  name: 'ReceiveModal',
  components: {
    VueQrcode,
    PaymentConfirmation
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
  emits: ['update:modelValue', 'invoice-created'],
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
      receiveMode: 'lightning', // 'lightning' or 'spark'
      // Payment monitoring
      paymentMonitor: null,
      sparkEventUnsubscribe: null, // For Spark event-based monitoring
      paymentStatus: PaymentStatus.PENDING,
      paymentStatusMessage: '',
      isPaymentConfirmed: false,
      // Payment confirmation screen
      showPaymentConfirmation: false,
      confirmedAmount: 0,
      confirmedFiatAmount: ''
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
    sparkAddress() {
      return this.walletStore.activeSparkAddress;
    },
    showSparkAddressView() {
      return this.isSparkWallet && this.receiveMode === 'spark' && !this.generatedInvoice;
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
  beforeUnmount() {
    // Cleanup on component destroy
    this.stopPaymentMonitor();
  },
  methods: {
    // ... (keeping all existing methods from the original component)
    loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        this.walletState = JSON.parse(savedState);
      }
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
    },

    /**
     * Start monitoring for payment confirmation
     * Uses event-based for Spark (instant), polling for NWC
     */
    async startPaymentMonitor() {
      if (!this.generatedInvoice?.payment_hash) {
        console.warn('Cannot start payment monitor: no invoice');
        return;
      }

      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = this.$t('Waiting for payment...');

      if (this.isSparkWallet) {
        // Spark: Use event-based monitoring (instant, no polling)
        await this.startSparkEventMonitor();
      } else {
        // NWC: Use polling-based monitoring
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
          // Any incoming payment triggers confirmation
          // The Spark event fires for all incoming transfers
          this.handlePaymentStatus(PaymentStatus.CONFIRMED, {
            transferId,
            amount: this.generatedInvoice?.amount,
            newBalance
          });
        });

        console.log('Spark event listener active - waiting for payment');
      } catch (error) {
        console.warn('Could not start Spark event monitoring, falling back to polling:', error);
        // Fallback to polling if events fail
        await this.startNWCPollingMonitor();
      }
    },

    /**
     * Start NWC polling-based payment monitoring
     */
    async startNWCPollingMonitor() {
      let provider = null;

      try {
        provider = this.walletStore.getActiveProvider();
        if (!provider) {
          // Create NWC provider on-the-fly
          const activeWallet = this.walletState.connectedWallets?.find(
            w => w.id === this.walletState.activeWalletId
          );
          if (activeWallet?.nwcString) {
            const nwc = new NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            await nwc.enable();
            // Create a minimal provider wrapper
            provider = {
              lookupInvoice: async (hash) => {
                try {
                  const invoice = await nwc.lookupInvoice({ payment_hash: hash });
                  return {
                    paid: invoice?.settled || invoice?.paid || false,
                    preimage: invoice?.preimage,
                    amount: invoice?.amount
                  };
                } catch {
                  return { paid: false };
                }
              }
            };
          }
        }
      } catch (error) {
        console.warn('Could not get provider for payment monitoring:', error);
        return;
      }

      if (!provider) {
        console.warn('No provider available for payment monitoring');
        return;
      }

      // Create and start the polling monitor
      this.paymentMonitor = createPaymentMonitor();

      this.paymentMonitor.start({
        invoice: {
          payment_hash: this.generatedInvoice.payment_hash,
          expires_at: this.generatedInvoice.expires_at,
          amount: this.generatedInvoice.amount
        },
        provider: provider,
        onStatusChange: this.handlePaymentStatus
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
          this.walletStore.refreshActiveWallet();
          break;

        case PaymentStatus.EXPIRED:
          this.paymentStatusMessage = this.$t('Invoice expired');
          this.$q.notify({
            type: 'warning',
            message: this.$t('Invoice expired'),
            caption: this.$t('Please create a new invoice'),
            position: 'bottom',
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
      // const currencies = ['sats', 'btc', this.walletState.preferredFiatCurrency?.toLowerCase() || 'usd'];
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
          const rate = this.walletState.exchangeRates?.[this.currentCurrency] || 65000;
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

        // Check if active wallet is Spark or NWC
        if (this.isSparkWallet) {
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
        } else {
          // Use NWC for non-Spark wallets
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

        const processedInvoice = {
          payment_request: paymentRequest,
          payment_hash: invoice.payment_hash || invoice.paymentHash,
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        // Start monitoring for payment confirmation
        this.startPaymentMonitor();

      } catch (error) {
        console.error('Error creating invoice:', error);

        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t create invoice'),
          caption: error.message,
          position: 'bottom',
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          position: 'bottom',
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          position: 'bottom',
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async shareSparkAddress() {
      if (!this.sparkAddress) return;

      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Spark Address',
            text: this.sparkAddress
          });

          this.$q.notify({
            type: 'positive',
            message: this.$t('Shared'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        } else {
          await this.copySparkAddress();
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to share Spark address:', error);
        }
      }
    },

    truncateSparkAddress(address) {
      if (!address) return '';
      if (address.length <= 20) return address;
      return `${address.slice(0, 10)}...${address.slice(-8)}`;
    },

    formatInvoiceAmount(sats) {
      if (!sats) return formatAmount(0, this.walletStore.useBip177Format);
      return formatAmount(sats, this.walletStore.useBip177Format);
    },

    formatInvoiceFiat(sats) {
      if (!sats || !this.walletState.exchangeRates) return '';

      const fiatCurrency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates[fiatCurrency.toLowerCase()] || 65000;
      const btcAmount = sats / 100000000;
      const fiatAmount = btcAmount * rate;

      return `≈ $${fiatAmount.toFixed(2)} ${fiatCurrency}`;
    },

    async shareInvoice() {
      if (!this.generatedInvoice) return;

      const shareText = `lightning:${this.generatedInvoice.payment_request}`;

      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Lightning Invoice',
            text: `Pay ${this.formatInvoiceAmount(this.generatedInvoice.amount)}`,
            url: shareText
          });

          this.$q.notify({
            type: 'positive',
            message: this.$t('Shared'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        } else {
          await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Invoice copied'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to share invoice:', error);
        }
      }
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
    }
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

/* QR Display Section */
.qr-display-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  gap: 1.5rem;
  overflow-y: auto;
}

/* Status Badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 100px;
  background: rgba(255, 212, 59, 0.1);
  border: 1px solid rgba(255, 212, 59, 0.3);
  transition: all 0.3s ease;
}

.status-badge span {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #FFD43B;
  letter-spacing: 0.01em;
  transition: color 0.3s ease;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #FFD43B;
  animation: pulse 2s ease-in-out infinite;
  transition: background 0.3s ease;
}

/* Payment status: Pending (default yellow) */
.status-pending {
  background: rgba(255, 212, 59, 0.1);
  border-color: rgba(255, 212, 59, 0.3);
}
.status-pending span { color: #FFD43B; }
.dot-pending { background: #FFD43B; animation: pulse 2s ease-in-out infinite; }

/* Payment status: Confirmed (green) */
.status-confirmed {
  background: rgba(21, 222, 114, 0.15);
  border-color: rgba(21, 222, 114, 0.4);
}
.status-confirmed span { color: #15DE72; }
.dot-confirmed { background: #15DE72; animation: none; }

/* Payment status: Expired (gray) */
.status-expired {
  background: rgba(107, 114, 128, 0.1);
  border-color: rgba(107, 114, 128, 0.3);
}
.status-expired span { color: #6B7280; }
.dot-expired { background: #6B7280; animation: none; }

/* Payment status: Error (red) */
.status-error {
  background: rgba(255, 75, 75, 0.1);
  border-color: rgba(255, 75, 75, 0.3);
}
.status-error span { color: #FF4B4B; }
.dot-error { background: #FF4B4B; animation: none; }

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

/* Invoice Amount Section */
.invoice-amount-section {
  text-align: center;
  width: 100%;
}

.invoice-amount {
  font-family: 'Inter', sans-serif;
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin-bottom: 0.5rem;
}

.invoice-fiat {
  font-family: 'Inter', sans-serif;
  font-size: 17px;
  font-weight: 400;
  opacity: 0.75;
}

/* Invoice Memo */
.invoice-memo {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 400;
  text-align: center;
  opacity: 0.65;
  max-width: 320px;
  line-height: 1.4;
}

/* QR Container */
.qr-container {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 320px;
  -webkit-tap-highlight-color: transparent;
}

.qr-wrapper {
  background: #FFF;
  border-radius: 16px;
  padding: 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  border: 1px solid rgba(0, 0, 0, 0.08);
  width: 100%;
}

.qr-container:active .qr-wrapper {
  transform: scale(0.97);
}

.qr-code {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
}

.qr-tap-hint {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 400;
  margin-top: 1rem;
  opacity: 0.6;
  text-align: center;
}

/* Invoice Actions */
.invoice-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  max-width: 360px;
}

.invoice-action-btn {
  flex: 1;
  height: 44px;
  border-radius: 100px;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  transition: all 0.2s ease;
  border: 1px solid;
}

.action-btn-dark {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.1);
  color: #FFF;
}

.action-btn-dark:hover {
  background: rgba(255, 255, 255, 0.03);
}

.action-btn-dark:active {
  transform: scale(0.97);
  background: rgba(255, 255, 255, 0.05);
}

.action-btn-light {
  background: transparent;
  border-color: rgba(15, 20, 25, 0.1);
  color: #0F1419;
}

.action-btn-light:hover {
  background: rgba(15, 20, 25, 0.03);
}

.action-btn-light:active {
  transform: scale(0.97);
  background: rgba(15, 20, 25, 0.05);
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

  .qr-display-section {
    padding: 1.5rem 1rem;
    gap: 1.25rem;
  }

  .invoice-amount {
    font-size: 2rem;
  }

  .invoice-fiat {
    font-size: 15px;
  }

  .qr-container {
    max-width: 280px;
  }

  .qr-wrapper {
    padding: 1rem;
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

/* Extra small screens (320px and below) */
@media (max-width: 360px) {
  .qr-container {
    max-width: 220px;
  }

  .qr-wrapper {
    padding: 0.75rem;
  }

  .invoice-amount {
    font-size: 1.75rem;
  }

  .invoice-actions {
    max-width: 260px;
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
