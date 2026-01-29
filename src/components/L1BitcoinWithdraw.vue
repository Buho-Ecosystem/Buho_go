<template>
  <div class="l1-bitcoin-withdraw">
    <!-- Destination Display -->
    <div class="destination-section" :class="$q.dark.isActive ? 'section-dark' : 'section-light'">
      <div class="section-label">{{ $t('Sending to') }}</div>
      <div class="destination-display">
        <q-icon name="lab la-bitcoin" size="20px" class="bitcoin-icon" />
        <span class="destination-type">{{ $t('Bitcoin Address') }}</span>
      </div>
      <div class="destination-address">{{ truncateAddress(cleanedAddress) }}</div>
    </div>

    <!-- Amount Input -->
    <div class="amount-section">
      <div class="amount-input-wrapper" :class="$q.dark.isActive ? 'input-dark' : 'input-light'">
        <input
          v-model="displayAmount"
          type="number"
          inputmode="numeric"
          placeholder="0"
          class="amount-input-large"
          :class="$q.dark.isActive ? 'amount-input-dark' : 'amount-input-light'"
          @input="onAmountChange"
          @focus="isAmountFocused = true"
          @blur="isAmountFocused = false"
        />
        <span class="currency-label">{{ currencyLabel }}</span>
      </div>
      <div class="balance-row">
        <span class="balance-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
          {{ $t('Available:') }} {{ formatAmount(availableBalance) }}
        </span>
        <q-btn
          flat
          dense
          no-caps
          size="sm"
          class="use-max-btn"
          @click="setMaxAmount"
        >
          {{ $t('Use all') }}
        </q-btn>
      </div>
    </div>

    <!-- Speed Selection (shown after amount entered) -->
    <div v-if="amountSats > 0 && feeQuote" class="speed-section">
      <div class="section-label">{{ $t('How fast?') }}</div>
      <div class="speed-options">
        <!-- Economy (Slow) -->
        <div
          :class="['speed-card', { selected: selectedSpeed === 'slow' }]"
          @click="selectedSpeed = 'slow'"
        >
          <div class="speed-emoji">🐢</div>
          <div class="speed-name">{{ $t('Economy') }}</div>
          <div class="speed-time">{{ $t(feeQuote.slow.timeEstimate) }}</div>
          <div class="speed-fee">{{ formatAmount(feeQuote.slow.totalFee) }}</div>
        </div>

        <!-- Normal (Medium) - Recommended -->
        <div
          :class="['speed-card', 'recommended', { selected: selectedSpeed === 'medium' }]"
          @click="selectedSpeed = 'medium'"
        >
          <div class="recommended-badge">{{ $t('Recommended') }}</div>
          <div class="speed-emoji">⚡</div>
          <div class="speed-name">{{ $t('Normal') }}</div>
          <div class="speed-time">{{ $t(feeQuote.medium.timeEstimate) }}</div>
          <div class="speed-fee">{{ formatAmount(feeQuote.medium.totalFee) }}</div>
        </div>

        <!-- Fast (Next Block) -->
        <div
          :class="['speed-card', { selected: selectedSpeed === 'fast' }]"
          @click="selectedSpeed = 'fast'"
        >
          <div class="speed-emoji">🚀</div>
          <div class="speed-name">{{ $t('Fast') }}</div>
          <div class="speed-time">{{ $t(feeQuote.fast.timeEstimate) }}</div>
          <div class="speed-fee">{{ formatAmount(feeQuote.fast.totalFee) }}</div>
        </div>

        <!-- Custom Fee -->
        <div
          :class="['speed-card', 'custom-card', { selected: selectedSpeed === 'custom' }]"
          @click="selectedSpeed = 'custom'"
        >
          <div class="speed-emoji">⚙️</div>
          <div class="speed-name">{{ $t('Custom') }}</div>
          <div class="speed-time">{{ $t('Set your own') }}</div>
          <div class="speed-fee" v-if="selectedSpeed === 'custom' && customFeeRate > 0">
            {{ formatAmount(customNetworkFee) }}
          </div>
          <div class="speed-fee" v-else>—</div>
        </div>
      </div>

      <!-- Custom Fee Input (shown when custom selected) -->
      <div v-if="selectedSpeed === 'custom'" class="custom-fee-section">
        <div class="custom-fee-input-wrapper">
          <input
            v-model.number="customFeeRate"
            type="number"
            inputmode="numeric"
            min="1"
            :placeholder="String(feeQuote.medium.feeRate || 1)"
            class="custom-fee-input"
            :class="$q.dark.isActive ? 'input-dark' : 'input-light'"
          />
          <span class="fee-unit">sat/vB</span>
        </div>
        <div class="fee-rate-hints">
          <span class="hint" @click="customFeeRate = feeQuote.slow.feeRate">
            {{ $t('Economy') }}: {{ feeQuote.slow.feeRate }}
          </span>
          <span class="hint" @click="customFeeRate = feeQuote.medium.feeRate">
            {{ $t('Normal') }}: {{ feeQuote.medium.feeRate }}
          </span>
          <span class="hint" @click="customFeeRate = feeQuote.fast.feeRate">
            {{ $t('Fast') }}: {{ feeQuote.fast.feeRate }}
          </span>
        </div>
      </div>
    </div>

    <!-- Loading Fee Quote -->
    <div v-if="amountSats > 0 && isLoadingFeeQuote" class="fee-loading">
      <q-spinner size="20px" color="primary" />
      <span>{{ $t('Calculating fees...') }}</span>
    </div>

    <!-- Fee Breakdown & Summary -->
    <div v-if="amountSats > 0 && feeQuote && selectedSpeed" class="summary-section">
      <div class="summary-row">
        <span class="label">{{ $t('You send') }}</span>
        <span class="value">{{ formatAmount(amountSats) }}</span>
      </div>
      <div class="summary-row fee-row">
        <span class="label">{{ $t('Service fee') }}</span>
        <span class="value">{{ formatAmount(selectedFee.serviceFee) }}</span>
      </div>
      <div class="summary-row fee-row">
        <span class="label">{{ $t('Network fee') }}</span>
        <span class="value">{{ formatAmount(selectedFee.networkFee) }}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-row total-row">
        <span class="label">{{ $t('Total from wallet') }}</span>
        <span class="value total">{{ formatAmount(totalAmount) }}</span>
      </div>
    </div>

    <!-- Insufficient Balance Warning -->
    <div v-if="insufficientBalance" class="warning-message">
      <q-icon name="las la-exclamation-triangle" size="16px" />
      <span>{{ $t('Insufficient balance') }}</span>
    </div>

    <!-- Send Button -->
    <q-btn
      v-if="canSend"
      color="primary"
      size="lg"
      no-caps
      unelevated
      class="send-btn"
      :loading="isSending"
      @click="executeWithdrawal"
    >
      {{ $t('Send Bitcoin') }}
    </q-btn>
  </div>
</template>

<script>
import { useWalletStore } from 'src/stores/wallet';
import { formatAmount as formatAmountUtil } from 'src/utils/amountFormatting';

export default {
  name: 'L1BitcoinWithdraw',

  props: {
    destinationAddress: {
      type: String,
      required: true
    },
    availableBalance: {
      type: Number,
      default: 0
    }
  },

  emits: ['withdrawal-complete', 'withdrawal-error'],

  data() {
    return {
      displayAmount: '',
      amountSats: 0,
      isAmountFocused: false,
      feeQuote: null,
      isLoadingFeeQuote: false,
      selectedSpeed: 'medium',
      isSending: false,
      feeQuoteDebounceTimer: null,
      customFeeRate: 0,
      TX_VBYTES: 140 // Typical withdrawal transaction size
    };
  },

  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },

  computed: {
    /**
     * Clean Bitcoin address - strips bitcoin: URI prefix and query params
     * Defensive handling for BIP21 URIs that might come from QR codes
     */
    cleanedAddress() {
      let address = this.destinationAddress || '';
      // Strip bitcoin: prefix (BIP21 URI scheme)
      if (address.toLowerCase().startsWith('bitcoin:')) {
        address = address.substring(8);
      }
      // Remove query parameters (?amount=X&label=Y)
      return address.split('?')[0];
    },

    /**
     * Currency label for amount input - respects user format preference
     */
    currencyLabel() {
      return this.walletStore.useBip177Format ? '₿' : 'sats';
    },

    /**
     * Calculate custom network fee based on user-defined fee rate
     */
    customNetworkFee() {
      if (!this.customFeeRate || this.customFeeRate <= 0) return 0;
      return Math.ceil(this.customFeeRate * this.TX_VBYTES);
    },

    /**
     * Build custom fee object matching the structure of preset fees
     */
    customFeeObject() {
      if (!this.feeQuote) return null;
      return {
        serviceFee: Number(this.feeQuote.medium?.serviceFee || 0),
        networkFee: this.customNetworkFee,
        totalFee: Number(this.feeQuote.medium?.serviceFee || 0) + this.customNetworkFee,
        feeQuoteId: this.feeQuote.medium?.feeQuoteId,
        timeEstimate: this.$t('Custom'),
        feeRate: this.customFeeRate
      };
    },

    selectedFee() {
      if (!this.feeQuote || !this.selectedSpeed) return null;
      // Handle custom fee selection
      if (this.selectedSpeed === 'custom') {
        return this.customFeeObject;
      }
      return this.feeQuote[this.selectedSpeed];
    },

    totalAmount() {
      if (!this.selectedFee) return this.amountSats;
      return this.amountSats + this.selectedFee.totalFee;
    },

    insufficientBalance() {
      return this.totalAmount > this.availableBalance;
    },

    canSend() {
      // For custom fee, require a valid fee rate
      if (this.selectedSpeed === 'custom' && (!this.customFeeRate || this.customFeeRate < 1)) {
        return false;
      }
      return (
        this.amountSats > 0 &&
        this.feeQuote &&
        this.selectedSpeed &&
        !this.insufficientBalance &&
        !this.isLoadingFeeQuote
      );
    }
  },

  methods: {
    onAmountChange() {
      const value = parseFloat(this.displayAmount) || 0;
      this.amountSats = Math.floor(value);

      // Debounce fee quote fetching
      if (this.feeQuoteDebounceTimer) {
        clearTimeout(this.feeQuoteDebounceTimer);
      }

      if (this.amountSats > 0) {
        this.feeQuoteDebounceTimer = setTimeout(() => {
          this.fetchFeeQuote();
        }, 500);
      } else {
        this.feeQuote = null;
      }
    },

    setMaxAmount() {
      // Calculate max sendable (balance - estimated max fee)
      // Use a conservative estimate for max fee
      const estimatedMaxFee = 2000; // Conservative estimate
      const maxSendable = Math.max(0, this.availableBalance - estimatedMaxFee);
      this.displayAmount = maxSendable.toString();
      this.onAmountChange();
    },

    async fetchFeeQuote() {
      if (this.amountSats <= 0) return;

      this.isLoadingFeeQuote = true;
      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getWithdrawalFeeQuote) {
          throw new Error('Withdrawal not supported');
        }

        this.feeQuote = await provider.getWithdrawalFeeQuote(
          this.amountSats,
          this.cleanedAddress
        );
      } catch (error) {
        console.error('Failed to fetch fee quote:', error);
        const userMessage = this.getUserFriendlyError(error);
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description,
          
        });
        this.feeQuote = null;
      } finally {
        this.isLoadingFeeQuote = false;
      }
    },

    async executeWithdrawal() {
      if (!this.canSend) return;

      this.isSending = true;
      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.withdrawToL1) {
          throw new Error('Withdrawal not supported');
        }

        const result = await provider.withdrawToL1({
          amountSats: this.amountSats,
          destinationAddress: this.cleanedAddress,
          speed: this.selectedSpeed.toUpperCase(),
          feeQuoteId: this.selectedFee.feeQuoteId
        });

        // Try to get txId for mempool link (available once broadcast)
        let txId = null;
        try {
          const status = await provider.getWithdrawalStatus(result.requestId);
          txId = status.txId;
        } catch (e) {
          console.warn('Could not fetch withdrawal status:', e);
        }

        // Show success with optional "view on mempool" action
        const mempoolUrl = provider.getMempoolExplorerUrl();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Bitcoin sent'),
          caption: txId ? this.$t('Tap to view transaction') : this.$t('Your withdrawal is being processed'),
          
          timeout: 6000,
          actions: txId ? [{
            icon: 'las la-external-link-alt',
            color: 'white',
            handler: () => window.open(`${mempoolUrl}/tx/${txId}`, '_blank')
          }] : []
        });

        this.$emit('withdrawal-complete', {
          ...result,
          txId: txId,
          amount: this.amountSats,
          fee: this.selectedFee.totalFee,
          destinationAddress: this.destinationAddress
        });

        // Refresh wallet balance
        if (this.walletStore.activeWalletId) {
          await this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
        }

      } catch (error) {
        console.error('Withdrawal failed:', error);
        const userMessage = this.getUserFriendlyError(error);
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description,
          
        });
        this.$emit('withdrawal-error', error);
      } finally {
        this.isSending = false;
      }
    },

    truncateAddress(address) {
      if (!address) return '';
      if (address.length <= 20) return address;
      return `${address.slice(0, 12)}...${address.slice(-8)}`;
    },

    formatAmount(sats) {
      if (!sats && sats !== 0) return formatAmountUtil(0, this.walletStore.useBip177Format);
      return formatAmountUtil(sats, this.walletStore.useBip177Format);
    },

    getUserFriendlyError(error) {
      const errorStr = error?.message || error?.toString() || '';
      const errorLower = errorStr.toLowerCase();

      // Balance/amount issues
      if (errorLower.includes('exceeds available balance') ||
          errorLower.includes('insufficient') ||
          errorLower.includes('not enough')) {
        return {
          title: this.$t('Not enough funds'),
          description: this.$t('The amount plus fees exceeds your balance. Try a smaller amount.')
        };
      }

      // Minimum amount
      if (errorLower.includes('minimum') || errorLower.includes('too small') ||
          errorLower.includes('dust')) {
        return {
          title: this.$t('Amount too small'),
          description: this.$t('Please enter a larger amount to cover network fees.')
        };
      }

      // Invalid address
      if (errorLower.includes('invalid address') || errorLower.includes('address')) {
        return {
          title: this.$t('Invalid address'),
          description: this.$t('The Bitcoin address appears to be invalid.')
        };
      }

      // Network/connection issues
      if (errorLower.includes('network') || errorLower.includes('timeout') ||
          errorLower.includes('connection') || errorLower.includes('fetch')) {
        return {
          title: this.$t('Connection problem'),
          description: this.$t('Please check your internet and try again.')
        };
      }

      // Fee quote expired
      if (errorLower.includes('expired') || errorLower.includes('quote')) {
        return {
          title: this.$t('Please try again'),
          description: this.$t('The fee estimate expired. We\'ll get a fresh one.')
        };
      }

      // Wallet not unlocked / PIN needed
      if (errorLower.includes('not unlocked') || errorLower.includes('enter your pin') ||
          errorLower.includes('pin')) {
        return {
          title: this.$t('Wallet locked'),
          description: this.$t('Please enter your PIN to unlock the wallet.')
        };
      }

      // Wallet not ready
      if (errorLower.includes('not supported') || errorLower.includes('provider') ||
          errorLower.includes('not connected') || errorLower.includes('wallet')) {
        return {
          title: this.$t('Wallet not ready'),
          description: this.$t('Please make sure your wallet is unlocked.')
        };
      }

      // Generic fallback - don't show technical details
      return {
        title: this.$t('Something went wrong'),
        description: this.$t('Please try again in a moment.')
      };
    }
  },

  beforeUnmount() {
    if (this.feeQuoteDebounceTimer) {
      clearTimeout(this.feeQuoteDebounceTimer);
    }
  }
};
</script>

<style scoped>
.l1-bitcoin-withdraw {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 0.5rem 0;
}

/* Destination Section */
.destination-section {
  padding: 14px 16px;
  border-radius: 14px;
}

.section-dark {
  background: rgba(255, 255, 255, 0.06);
}

.section-light {
  background: rgba(0, 0, 0, 0.03);
}

.section-label {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.destination-display {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.bitcoin-icon {
  color: #F7931A;
}

.destination-type {
  font-size: 15px;
  font-weight: 600;
}

.destination-address {
  font-family: 'SF Mono', 'Roboto Mono', monospace;
  font-size: 12px;
  opacity: 0.7;
}

/* Amount Section */
.amount-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.amount-input-wrapper {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-radius: 14px;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.input-dark {
  background: rgba(255, 255, 255, 0.06);
}

.input-light {
  background: rgba(0, 0, 0, 0.03);
}

.amount-input-wrapper:focus-within {
  border-color: #15DE72;
}

.amount-input-large {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 28px;
  font-weight: 700;
  outline: none;
  width: 100%;
}

.amount-input-dark {
  color: #FFFFFF;
}

.amount-input-light {
  color: #212121;
}

.amount-input-large::placeholder {
  opacity: 0.3;
}

.amount-input-dark::placeholder {
  color: #FFFFFF;
}

.amount-input-light::placeholder {
  color: #212121;
}

.currency-label {
  font-size: 16px;
  font-weight: 500;
  opacity: 0.6;
  margin-left: 8px;
}

.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
}

.balance-label {
  font-size: 13px;
}

.use-max-btn {
  color: #15DE72;
  font-weight: 600;
}

/* Speed Selection */
.speed-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.speed-options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 400px) {
  .speed-options {
    grid-template-columns: repeat(2, 1fr);
  }
}

.speed-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 8px;
  border-radius: 14px;
  background: rgba(128, 128, 128, 0.1);
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.speed-card.selected {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.speed-card.recommended {
  border-color: rgba(21, 222, 114, 0.3);
}

.recommended-badge {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  background: #15DE72;
  color: white;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  text-transform: uppercase;
}

.speed-emoji {
  font-size: 24px;
  margin-bottom: 4px;
}

.speed-name {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}

.speed-time {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 6px;
}

.speed-fee {
  font-size: 12px;
  font-weight: 600;
  color: #15DE72;
}

/* Custom Card */
.speed-card.custom-card {
  border-style: dashed;
  border-color: rgba(128, 128, 128, 0.3);
}

.speed-card.custom-card.selected {
  border-style: solid;
  border-color: #15DE72;
}

/* Custom Fee Input Section */
.custom-fee-section {
  margin-top: 12px;
  padding: 16px;
  border-radius: 14px;
  background: rgba(21, 222, 114, 0.08);
  border: 1px solid rgba(21, 222, 114, 0.2);
}

.custom-fee-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  margin-bottom: 10px;
}

.custom-fee-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 18px;
  font-weight: 600;
  outline: none;
  width: 100%;
  text-align: center;
}

.custom-fee-input::placeholder {
  opacity: 0.4;
}

.custom-fee-input.input-dark {
  color: #FFFFFF;
}

.custom-fee-input.input-light {
  color: #212121;
}

.fee-unit {
  font-size: 14px;
  opacity: 0.6;
  font-weight: 500;
}

.fee-rate-hints {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.fee-rate-hints .hint {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(128, 128, 128, 0.15);
  cursor: pointer;
  transition: all 0.2s ease;
}

.fee-rate-hints .hint:hover {
  background: rgba(21, 222, 114, 0.2);
}

/* Fee Loading */
.fee-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  font-size: 14px;
  opacity: 0.7;
}

/* Summary Section */
.summary-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 14px;
  background: rgba(128, 128, 128, 0.08);
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.summary-row .label {
  font-size: 14px;
  opacity: 0.7;
}

.summary-row .value {
  font-size: 14px;
  font-weight: 500;
}

.fee-row .label {
  opacity: 0.5;
  font-size: 13px;
}

.fee-row .value {
  font-size: 13px;
  opacity: 0.8;
}

.summary-divider {
  height: 1px;
  background: rgba(128, 128, 128, 0.2);
  margin: 4px 0;
}

.total-row .label {
  font-weight: 600;
  opacity: 1;
}

.total-row .value.total {
  font-size: 16px;
  font-weight: 700;
}

/* Warning Message */
.warning-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 107, 107, 0.1);
  color: #FF6B6B;
  font-size: 13px;
  font-weight: 500;
}

/* Send Button */
.send-btn {
  width: 100%;
  height: 54px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 700;
  margin-top: 0.5rem;
}

/* Mobile Responsiveness */
@media (max-width: 375px) {
  .amount-input-large {
    font-size: 24px;
  }

  .speed-options {
    gap: 6px;
  }

  .speed-card {
    padding: 10px 4px;
  }

  .speed-emoji {
    font-size: 20px;
  }

  .speed-name {
    font-size: 11px;
  }

  .recommended-badge {
    font-size: 8px;
    padding: 2px 6px;
  }
}
</style>
