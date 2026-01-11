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
        <!-- Amount Icon -->
        <!--        <div class="amount-icon-section" v-if="!generatedInvoice">-->
        <!--          <div class="amount-icon text-h2">-->
        <!--            {{ getCurrencySymbol() }}-->
        <!--          </div>-->
        <!--        </div>-->

        <!-- QR Code Display -->
        <div class="qr-display-section" v-if="generatedInvoice">
          <!-- Status Badge -->
          <div class="status-badge">
            <div class="status-dot"></div>
            <span>{{ $t('Waiting for payment') }}</span>
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

        <!-- Amount Section -->
        <div class="amount-section" v-if="!generatedInvoice">
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

        <!-- Description Section -->
        <div class="description-section" v-if="!generatedInvoice">
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

      <!-- Footer -->
      <q-card-section class="receive-footer" v-if="!generatedInvoice">
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
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { NostrWebLNProvider } from "@getalby/sdk";

export default {
  name: 'ReceiveModal',
  components: {
    VueQrcode
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
      isAmountFocused: false
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
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.loadWalletState();
        this.resetForm();
      }
    }
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
      this.displayAmount = '';
      this.description = '';
      this.generatedInvoice = null;
      this.amountInSats = 0;
    },

    closeModal() {
      this.show = false;
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
        const activeWallet = this.walletState.connectedWallets?.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (!activeWallet) {
          throw new Error('No active wallet found');
        }

        const nwc = new NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });

        await nwc.enable();

        const invoiceRequest = {
          amount: this.amountInSats,
          description: this.description || 'BuhoGO Payment',
          expiry: 3600
        };

        const invoice = await nwc.makeInvoice(invoiceRequest);

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
          message: this.$t('Invoice created successfully!'),
          position: 'bottom'
        });

      } catch (error) {
        console.error('Error creating invoice:', error);

        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to create invoice: ') + error.message,
          position: 'bottom'
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
          message: this.$t('Lightning invoice copied!'),
          position: 'bottom'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy invoice'),
          position: 'bottom'
        });
      }
    },

    showLightningAddress() {
      this.$q.notify({
        type: 'info',
        message: this.$t('Lightning address feature coming soon!'),
        position: 'bottom'
      });
    },

    formatInvoiceAmount(sats) {
      if (!sats) return '0 sats';
      return new Intl.NumberFormat('en-US').format(sats) + ' sats';
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
            message: this.$t('Invoice shared!'),
            position: 'bottom'
          });
        } else {
          await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
          this.$q.notify({
            type: 'info',
            message: this.$t('Invoice copied to clipboard!'),
            position: 'bottom'
          });
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Failed to share invoice:', error);
        }
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
}

.status-badge span {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #FFD43B;
  letter-spacing: 0.01em;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #FFD43B;
  animation: pulse 2s ease-in-out infinite;
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
</style>
