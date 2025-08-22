<template>
  <q-dialog 
    v-model="show" 
    persistent 
    maximized 
    transition-show="slide-up" 
    transition-hide="slide-down"
    class="receive-modal"
  >
    <q-card class="receive-card">
      <!-- Header -->
      <q-card-section class="receive-header">
        <div class="header-content">
          <q-btn 
            flat 
            round 
            dense 
            icon="las la-arrow-left" 
            @click="closeModal"
            class="back-btn"
          />
          <div class="header-title">Receive</div>
          <div class="header-actions">
            <q-btn 
              flat 
              round 
              dense 
              icon="las la-at" 
              @click="showLightningAddress"
              class="address-btn"
            />
            <q-btn 
              flat 
              round 
              dense 
              icon="las la-expand-arrows-alt" 
              @click="toggleFullscreen"
              class="fullscreen-btn"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="receive-content">
        <!-- QR Code Area -->
        <div class="qr-section">
          <div class="qr-container" v-if="generatedInvoice">
            <vue-qrcode 
              :value="generatedInvoice.payment_request" 
              :options="{ width: 280, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } }"
              class="qr-code"
            />
          </div>
          <div class="qr-placeholder" v-else>
            <q-icon name="las la-qrcode" size="120px" class="placeholder-icon"/>
          </div>
        </div>

        <!-- Amount Section -->
        <div class="amount-section">
          <!-- Currency Toggle -->
          <div class="currency-toggle" @click="toggleCurrency">
            <span class="currency-label">{{ currentCurrency }}</span>
            <q-icon name="las la-sync-alt" class="toggle-icon"/>
          </div>

          <!-- Amount Input -->
          <div class="amount-input-container">
            <div class="amount-display">
              <span class="currency-symbol">{{ getCurrencySymbol() }}</span>
              <input 
                v-model="displayAmount"
                @input="onAmountChange"
                @focus="onAmountFocus"
                @blur="onAmountBlur"
                type="text"
                inputmode="decimal"
                class="amount-input"
                :placeholder="getAmountPlaceholder()"
              />
            </div>
          </div>
        </div>

        <!-- Description Section -->
        <div class="description-section">
          <div class="description-label">Description (optional)</div>
          <q-input
            v-model="description"
            outlined
            placeholder="No description"
            class="description-input"
            maxlength="100"
            counter
            dense
          />
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-section class="receive-footer">
        <q-btn
          class="create-invoice-btn"
          :loading="isCreatingInvoice"
          @click="createInvoice"
          :disable="!isValidAmount"
          no-caps
          unelevated
        >
          <span v-if="!isCreatingInvoice">Create Invoice</span>
          <template v-slot:loading>
            <q-spinner-dots class="q-mr-sm"/>
            Creating...
          </template>
        </q-btn>
      </q-card-section>

      <!-- Invoice Actions (shown after creation) -->
      <q-card-section v-if="generatedInvoice" class="invoice-actions">
        <div class="action-buttons">
          <q-btn
            flat
            icon="las la-copy"
            label="Copy"
            @click="copyInvoice"
            class="action-btn"
          />
          <q-btn
            flat
            icon="las la-share-alt"
            label="Share"
            @click="shareInvoice"
            class="action-btn"
          />
          <q-btn
            flat
            icon="las la-download"
            label="Save QR"
            @click="saveQR"
            class="action-btn"
          />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { webln } from "@getalby/sdk";

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
      const currencies = ['sats', 'btc', this.walletState.preferredFiatCurrency?.toLowerCase() || 'usd'];
      const currentIndex = currencies.indexOf(this.currentCurrency);
      const nextIndex = (currentIndex + 1) % currencies.length;
      this.currentCurrency = currencies[nextIndex];
      this.convertAmount();
    },

    getCurrencySymbol() {
      switch (this.currentCurrency) {
        case 'sats':
          return '';
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

        const nwc = new webln.NostrWebLNProvider({
          nostrWalletConnectUrl: activeWallet.nwcString,
        });

        await nwc.enable();

        const invoice = await nwc.makeInvoice({
          amount: this.amountInSats,
          description: this.description || 'BuhoGO Payment'
        });

        this.generatedInvoice = invoice;
        this.$emit('invoice-created', invoice);

        this.$q.notify({
          type: 'positive',
          message: 'Invoice created successfully!',
          position: 'top'
        });

      } catch (error) {
        console.error('Error creating invoice:', error);
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
      if (!this.generatedInvoice) return;

      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: 'Invoice copied to clipboard!',
          position: 'top'
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to copy invoice',
          position: 'top'
        });
      }
    },

    async shareInvoice() {
      if (!this.generatedInvoice) return;

      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Lightning Invoice',
            text: 'Pay this Lightning invoice',
            url: `lightning:${this.generatedInvoice.payment_request}`
          });
        } else {
          await this.copyInvoice();
        }
      } catch (error) {
        console.error('Failed to share invoice:', error);
      }
    },

    saveQR() {
      // Implementation for saving QR code as image
      this.$q.notify({
        type: 'info',
        message: 'QR code save feature coming soon!',
        position: 'top'
      });
    },

    showLightningAddress() {
      this.$q.notify({
        type: 'info',
        message: 'Lightning address feature coming soon!',
        position: 'top'
      });
    },

    toggleFullscreen() {
      // Implementation for fullscreen QR view
      this.$q.notify({
        type: 'info',
        message: 'Fullscreen view coming soon!',
        position: 'top'
      });
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
  background: #ffffff;
}

/* Header */
.receive-header {
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  padding: 1rem;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  color: #1f2937;
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

.address-btn,
.fullscreen-btn {
  color: #6b7280;
}

/* Content */
.receive-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 2rem 1rem;
  overflow-y: auto;
}

/* QR Section */
.qr-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.qr-container {
  background: white;
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.qr-placeholder {
  width: 300px;
  height: 300px;
  background: #f9fafb;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #d1d5db;
}

.placeholder-icon {
  color: #d1d5db;
}

/* Amount Section */
.amount-section {
  margin-bottom: 2rem;
  text-align: center;
}

.currency-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #f3f4f6;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  cursor: pointer;
  margin-bottom: 1rem;
  transition: background-color 0.2s;
}

.currency-toggle:hover {
  background: #e5e7eb;
}

.currency-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
  text-transform: uppercase;
}

.toggle-icon {
  color: #6b7280;
  font-size: 14px;
}

.amount-input-container {
  display: flex;
  justify-content: center;
}

.amount-display {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.currency-symbol {
  font-size: 2rem;
  font-weight: 300;
  color: #6b7280;
}

.amount-input {
  font-size: 3rem;
  font-weight: 300;
  color: #1f2937;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  min-width: 200px;
}

.amount-input::placeholder {
  color: #d1d5db;
}

/* Description Section */
.description-section {
  margin-bottom: 2rem;
}

.description-label {
  font-size: 1rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
  text-align: center;
}

.description-input {
  max-width: 400px;
  margin: 0 auto;
}

.description-input :deep(.q-field__control) {
  border-radius: 12px;
}

/* Footer */
.receive-footer {
  padding: 1rem;
  flex-shrink: 0;
}

.create-invoice-btn {
  width: 100%;
  height: 56px;
  background: #1f2937;
  color: white;
  border-radius: 16px;
  font-size: 1.125rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.create-invoice-btn:hover {
  background: #374151;
  transform: translateY(-1px);
}

.create-invoice-btn:disabled {
  background: #d1d5db;
  color: #9ca3af;
  transform: none;
}

/* Invoice Actions */
.invoice-actions {
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  padding: 1rem;
  flex-shrink: 0;
}

.action-buttons {
  display: flex;
  justify-content: space-around;
  gap: 1rem;
}

.action-btn {
  flex: 1;
  height: 48px;
  border-radius: 12px;
  color: #6b7280;
  font-weight: 500;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

/* Responsive Design */
@media (max-width: 480px) {
  .receive-content {
    padding: 1rem;
  }
  
  .qr-container,
  .qr-placeholder {
    width: 250px;
    height: 250px;
  }
  
  .amount-input {
    font-size: 2.5rem;
    min-width: 150px;
  }
  
  .currency-symbol {
    font-size: 1.5rem;
  }
  
  .action-buttons {
    flex-direction: column;
    gap: 0.5rem;
  }
}
</style>