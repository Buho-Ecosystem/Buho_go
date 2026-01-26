<template>
  <div class="l1-bitcoin-receive">
    <!-- QR Code Section -->
    <div class="qr-section">
      <div class="qr-card" @click="copyAddress">
        <div class="qr-frame" :class="{ 'loading': !depositAddress }">
          <vue-qrcode
            v-if="depositAddress"
            :value="qrValue"
            :options="qrOptions"
            class="qr-code"
          />
          <q-spinner v-else size="32px" color="primary" />
        </div>
      </div>
      <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
        {{ $t('Tap QR to copy address') }}
      </div>
    </div>

    <!-- Address Display - Compact -->
    <div
      v-if="depositAddress"
      class="address-pill"
      :class="$q.dark.isActive ? 'pill-dark' : 'pill-light'"
      @click="copyAddress"
    >
      <q-icon name="lab la-bitcoin" size="16px" class="pill-icon" />
      <span class="pill-address">{{ truncateAddress(depositAddress) }}</span>
      <q-icon name="las la-copy" size="14px" class="pill-copy" />
    </div>

    <!-- Info Note - Subtle -->
    <div class="info-note" :class="$q.dark.isActive ? 'note-dark' : 'note-light'">
      {{ $t('Minimum') }}: {{ minDepositAmount }} sats
    </div>

    <!-- Pending Deposits -->
    <div v-if="pendingDeposits.length > 0" class="deposits-section">
      <div class="section-header">
        <span class="section-title" :class="$q.dark.isActive ? 'title-dark' : 'title-light'">
          {{ $t('Incoming') }}
        </span>
        <q-btn
          flat
          dense
          round
          size="sm"
          icon="las la-sync"
          :loading="isCheckingDeposits"
          @click="checkDeposits"
          class="refresh-icon"
          :class="{ 'spinning': isCheckingDeposits }"
        />
      </div>

      <div
        v-for="deposit in pendingDeposits"
        :key="deposit.txId"
        class="deposit-row"
        :class="$q.dark.isActive ? 'row-dark' : 'row-light'"
      >
        <!-- Left: Status indicator -->
        <div class="deposit-indicator" :class="deposit.confirmed ? 'ready' : 'pending'">
          <q-icon :name="deposit.confirmed ? 'las la-check' : 'lab la-bitcoin'" size="18px" />
        </div>

        <!-- Center: Amount & Status -->
        <div class="deposit-details">
          <div class="deposit-amount" :class="$q.dark.isActive ? 'amount-dark' : 'amount-light'">
            +{{ formatAmount(deposit.amount) }}
          </div>
          <div class="deposit-status" :class="deposit.confirmed ? 'status-ready' : 'status-pending'">
            <template v-if="deposit.confirmed">
              {{ $t('Ready') }}
            </template>
            <template v-else>
              <span class="status-dots">
                <span class="dot" :class="{ 'active': deposit.confirmations >= 1 }"></span>
                <span class="dot" :class="{ 'active': deposit.confirmations >= 2 }"></span>
                <span class="dot" :class="{ 'active': deposit.confirmations >= 3 }"></span>
              </span>
              {{ deposit.confirmations }}/3
            </template>
          </div>
        </div>

        <!-- Right: Action -->
        <q-btn
          v-if="deposit.confirmed"
          no-caps
          unelevated
          size="sm"
          class="claim-btn"
          :loading="deposit.claiming"
          @click="initiateClaimDeposit(deposit)"
        >
          {{ $t('Claim') }}
        </q-btn>
        <span v-else class="confirming-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
          {{ $t('Confirming...') }}
        </span>
      </div>
    </div>

    <!-- Empty State: Check Button -->
    <div v-else class="empty-state">
      <q-btn
        flat
        no-caps
        class="check-btn"
        :class="$q.dark.isActive ? 'check-dark' : 'check-light'"
        :loading="isCheckingDeposits"
        @click="checkDeposits"
      >
        <q-icon name="las la-sync" size="16px" class="q-mr-xs" />
        {{ $t('Check for deposits') }}
      </q-btn>
    </div>

    <!-- Claim Confirmation - iOS Bottom Sheet -->
    <q-dialog v-model="showClaimDialog" position="bottom" transition-show="slide-up" transition-hide="slide-down">
      <q-card class="claim-sheet" :class="$q.dark.isActive ? 'sheet-dark' : 'sheet-light'">
        <!-- Handle -->
        <div class="sheet-handle"><div class="handle-bar"></div></div>

        <!-- Amount Hero -->
        <div class="amount-hero">
          <div class="hero-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            +{{ formatAmount(netClaimAmount) }}
          </div>
          <div class="hero-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
            {{ $t('will be added to your wallet') }}
          </div>
        </div>

        <!-- Fee Details -->
        <div class="fee-details" :class="$q.dark.isActive ? 'details-dark' : 'details-light'">
          <div class="fee-row">
            <span class="fee-label">{{ $t('Deposit') }}</span>
            <span class="fee-value">{{ formatAmount(claimingDeposit?.amount || 0) }}</span>
          </div>
          <div class="fee-row deduct">
            <span class="fee-label">{{ $t('Network fee') }}</span>
            <span class="fee-value">-{{ formatAmount(claimFeeAmount) }}</span>
          </div>
        </div>

        <!-- High Fee Warning -->
        <div v-if="isHighFee" class="fee-alert">
          <q-icon name="las la-exclamation-circle" size="16px" />
          <span>{{ $t('High fee relative to deposit') }}</span>
        </div>

        <!-- Actions -->
        <div class="sheet-actions">
          <q-btn
            unelevated
            no-caps
            class="confirm-btn"
            :loading="isClaimingDeposit"
            @click="confirmClaim"
          >
            {{ $t('Add to Wallet') }}
          </q-btn>
          <q-btn
            flat
            no-caps
            class="cancel-btn"
            :class="$q.dark.isActive ? 'cancel-dark' : 'cancel-light'"
            @click="cancelClaim"
          >
            {{ $t('Cancel') }}
          </q-btn>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { useWalletStore } from 'src/stores/wallet';

export default {
  name: 'L1BitcoinReceive',

  components: {
    VueQrcode
  },

  props: {
    qrOptions: {
      type: Object,
      default: () => ({
        width: 240,
        margin: 0,
        color: { dark: '#000000', light: '#ffffff' }
      })
    }
  },

  emits: ['deposit-claimed', 'deposits-updated'],

  data() {
    return {
      depositAddress: null,
      pendingDeposits: [],
      isLoadingAddress: false,
      isCheckingDeposits: false,
      pollingInterval: null,
      // Claim dialog state
      showClaimDialog: false,
      claimingDeposit: null,
      claimFeeQuote: null,
      isClaimingDeposit: false,
      // Config
      minDepositAmount: 500,
      pollingIntervalMs: 30000 // 30 seconds
    };
  },

  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },

  computed: {
    qrValue() {
      // Use bitcoin: URI scheme for better wallet compatibility
      return this.depositAddress ? `bitcoin:${this.depositAddress}` : '';
    },

    netClaimAmount() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return 0;
      // creditAmountSats is the amount after fee deduction
      return this.claimFeeQuote.creditAmountSats || 0;
    },

    claimFeeAmount() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return 0;
      // Fee = deposit amount - credit amount
      return Math.max(0, this.claimingDeposit.amount - (this.claimFeeQuote.creditAmountSats || 0));
    },

    isHighFee() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return false;
      return this.claimFeeAmount > (this.claimingDeposit.amount * 0.5);
    }
  },

  mounted() {
    this.loadDepositAddress();
    // Note: Polling starts after successful address load in loadDepositAddress()
  },

  beforeUnmount() {
    this.stopPolling();
  },

  methods: {
    async loadDepositAddress() {
      this.isLoadingAddress = true;
      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        if (provider?.getL1DepositAddress) {
          this.depositAddress = await provider.getL1DepositAddress();
          // Initial deposit check
          await this.checkDeposits();
          // Start polling only after successful address load
          this.startPolling();
        }
      } catch (error) {
        console.error('Failed to load Bitcoin deposit address:', error);
        const userMessage = this.getUserFriendlyError(error, 'address');
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description,
          position: 'bottom'
        });
      } finally {
        this.isLoadingAddress = false;
      }
    },

    async checkDeposits() {
      this.isCheckingDeposits = true;
      const startTime = Date.now();
      const minLoadingTime = 2000; // Minimum 2 seconds for better UX

      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        if (provider?.getPendingDeposits) {
          const deposits = await provider.getPendingDeposits();
          // Preserve claiming state for existing deposits
          this.pendingDeposits = deposits.map(d => ({
            ...d,
            claiming: this.pendingDeposits.find(pd => pd.txId === d.txId)?.claiming || false
          }));
          this.$emit('deposits-updated', this.pendingDeposits);
        }
      } catch (error) {
        console.error('Failed to check deposits:', error);
      } finally {
        // Ensure minimum loading time for better UX feedback
        const elapsed = Date.now() - startTime;
        const remainingTime = minLoadingTime - elapsed;
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingTime));
        }
        this.isCheckingDeposits = false;
      }
    },

    startPolling() {
      this.pollingInterval = setInterval(() => {
        this.checkDeposits();
      }, this.pollingIntervalMs);
    },

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    },

    async initiateClaimDeposit(deposit) {
      // Step 1: Get fee quote
      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getClaimFeeQuote) {
          throw new Error('Claim not supported');
        }

        // Mark as claiming to show loading state
        deposit.claiming = true;

        const quote = await provider.getClaimFeeQuote(deposit.txId, deposit.outputIndex);

        this.claimingDeposit = deposit;
        this.claimFeeQuote = quote;
        this.showClaimDialog = true;

      } catch (error) {
        console.error('Failed to get claim fee quote:', error);
        deposit.claiming = false;
        const userMessage = this.getUserFriendlyError(error, 'claim');
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description,
          position: 'bottom'
        });
      }
    },

    cancelClaim() {
      if (this.claimingDeposit) {
        this.claimingDeposit.claiming = false;
      }
      this.showClaimDialog = false;
      this.claimingDeposit = null;
      this.claimFeeQuote = null;
    },

    async confirmClaim() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return;

      this.isClaimingDeposit = true;
      try {
        // Ensure Spark is connected (auto-reconnects with session PIN if needed)
        const provider = await this.walletStore.ensureSparkConnected();
        const result = await provider.claimDeposit(
          this.claimingDeposit.txId,
          this.claimFeeQuote, // Pass the full quote with creditAmountSats and signature
          this.claimingDeposit.outputIndex
        );

        // Success
        this.$q.notify({
          type: 'positive',
          message: this.$t('Bitcoin added to wallet'),
          caption: `+${this.formatAmount(result.amount)}`,
          position: 'bottom'
        });

        // Remove claimed deposit from list
        this.pendingDeposits = this.pendingDeposits.filter(
          d => d.txId !== this.claimingDeposit.txId
        );

        // Refresh wallet balance
        await this.walletStore.refreshActiveWallet();

        this.$emit('deposit-claimed', result);
        this.showClaimDialog = false;

      } catch (error) {
        console.error('Failed to claim deposit:', error);
        const userMessage = this.getUserFriendlyError(error, 'claim');
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description,
          position: 'bottom'
        });
      } finally {
        this.isClaimingDeposit = false;
        if (this.claimingDeposit) {
          this.claimingDeposit.claiming = false;
        }
        this.claimingDeposit = null;
        this.claimFeeQuote = null;
      }
    },

    truncateAddress(address) {
      if (!address) return '';
      if (address.length <= 20) return address;
      return `${address.slice(0, 10)}...${address.slice(-8)}`;
    },

    formatAmount(sats) {
      if (!sats && sats !== 0) return '0 sats';
      return `${sats.toLocaleString()} sats`;
    },

    async copyAddress() {
      if (!this.depositAddress) return;

      try {
        await navigator.clipboard.writeText(this.depositAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied'),
          position: 'bottom'
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy'),
          position: 'bottom'
        });
      }
    },

    getUserFriendlyError(error, context = 'general') {
      const errorStr = error?.message || error?.toString() || '';
      const errorLower = errorStr.toLowerCase();

      // Balance/amount issues
      if (errorLower.includes('exceeds available balance') ||
          errorLower.includes('insufficient') ||
          errorLower.includes('not enough')) {
        return {
          title: this.$t('Not enough funds'),
          description: this.$t('The claim fee exceeds the deposit amount.')
        };
      }

      // Deposit not ready/confirmed
      if (errorLower.includes('confirmation') || errorLower.includes('not confirmed') ||
          errorLower.includes('pending')) {
        return {
          title: this.$t('Still confirming'),
          description: this.$t('Please wait for more confirmations before claiming.')
        };
      }

      // Deposit not found or already claimed
      if (errorLower.includes('not found') || errorLower.includes('already claimed') ||
          errorLower.includes('utxo')) {
        return {
          title: this.$t('Deposit not available'),
          description: this.$t('This deposit may have already been claimed.')
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

      // Context-specific fallbacks
      if (context === 'address') {
        return {
          title: this.$t('Couldn\'t load address'),
          description: this.$t('Please try again in a moment.')
        };
      }

      if (context === 'claim') {
        return {
          title: this.$t('Couldn\'t process claim'),
          description: this.$t('Please try again in a moment.')
        };
      }

      if (context === 'refund') {
        return {
          title: this.$t('Couldn\'t process refund'),
          description: this.$t('Please try again in a moment.')
        };
      }

      // Generic fallback
      return {
        title: this.$t('Something went wrong'),
        description: this.$t('Please try again in a moment.')
      };
    }
  }
};
</script>

<style scoped>
.l1-bitcoin-receive {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  gap: 20px;
}

/* ==========================================
   QR Code Section - Clean & Centered
   ========================================== */
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

.qr-frame.loading {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-code {
  display: block;
  border-radius: 8px;
}

.qr-hint {
  font-size: 12px;
  margin-top: 10px;
  opacity: 0.5;
}

/* ==========================================
   Address Pill - Compact & Tappable
   ========================================== */
.address-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 0 auto;
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

.pill-icon {
  color: #F7931A;
}

.pill-address {
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.pill-copy {
  opacity: 0.4;
}

/* ==========================================
   Info Note - Subtle
   ========================================== */
.info-note {
  text-align: center;
  font-size: 12px;
  padding: 8px 16px;
  border-radius: 8px;
  margin: 0 auto;
}

.note-dark {
  color: rgba(255, 255, 255, 0.5);
  background: rgba(247, 147, 26, 0.08);
}

.note-light {
  color: rgba(0, 0, 0, 0.5);
  background: rgba(247, 147, 26, 0.06);
}

/* ==========================================
   Pending Deposits Section
   ========================================== */
.deposits-section {
  background: rgba(21, 222, 114, 0.06);
  border-radius: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(21, 222, 114, 0.1);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.title-dark {
  color: #15DE72;
}

.title-light {
  color: #0DBB5F;
}

.refresh-icon {
  color: #15DE72;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Deposit Row */
.deposit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.row-dark {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.row-light {
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.deposit-row:last-child {
  border-bottom: none;
}

.deposit-indicator {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.deposit-indicator.pending {
  background: linear-gradient(135deg, #F7931A, #FFAB40);
}

.deposit-indicator.ready {
  background: linear-gradient(135deg, #15DE72, #0DBB5F);
}

.deposit-details {
  flex: 1;
  min-width: 0;
}

.deposit-amount {
  font-size: 16px;
  font-weight: 600;
  color: #15DE72;
}

.amount-dark {
  color: #FFFFFF;
}

.amount-light {
  color: #000000;
}

.deposit-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-top: 2px;
}

.deposit-status.status-ready {
  color: #15DE72;
}

.deposit-status.status-pending {
  color: #F7931A;
}

/* Status Dots */
.status-dots {
  display: inline-flex;
  gap: 3px;
  margin-right: 4px;
}

.status-dots .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(247, 147, 26, 0.25);
  transition: all 0.3s ease;
}

.status-dots .dot.active {
  background: #F7931A;
}

/* Claim Button */
.claim-btn {
  background: linear-gradient(135deg, #15DE72, #0DBB5F) !important;
  color: white !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  padding: 8px 16px !important;
  border-radius: 10px !important;
  box-shadow: 0 2px 8px rgba(21, 222, 114, 0.25);
}

.confirming-label {
  font-size: 12px;
  font-style: italic;
}

/* ==========================================
   Empty State
   ========================================== */
.empty-state {
  text-align: center;
  padding: 8px 0;
}

.check-btn {
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
}

.check-dark {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
}

.check-light {
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
}

/* ==========================================
   iOS Bottom Sheet - Claim Confirmation
   ========================================== */
.claim-sheet {
  width: 100%;
  max-width: 100%;
  border-radius: 20px 20px 0 0;
  margin: 0;
}

.claim-sheet.sheet-dark {
  background: #1C1C1E;
}

.claim-sheet.sheet-light {
  background: #FFFFFF;
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
}

.handle-bar {
  width: 36px;
  height: 5px;
  background: rgba(128, 128, 128, 0.3);
  border-radius: 3px;
}

/* Amount Hero */
.amount-hero {
  text-align: center;
  padding: 20px 24px 28px;
}

.hero-value {
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -1px;
  color: #15DE72;
  line-height: 1;
}

.hero-label {
  font-size: 15px;
  margin-top: 10px;
}

/* Fee Details */
.fee-details {
  margin: 0 20px 16px;
  padding: 14px 16px;
  border-radius: 12px;
}

.fee-details.details-dark {
  background: rgba(255, 255, 255, 0.06);
}

.fee-details.details-light {
  background: rgba(0, 0, 0, 0.03);
}

.fee-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 14px;
}

.fee-row .fee-label {
  opacity: 0.7;
}

.fee-row .fee-value {
  font-weight: 500;
}

.fee-row.deduct .fee-value {
  color: #FF6B6B;
}

/* Fee Alert */
.fee-alert {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 20px 16px;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(255, 107, 107, 0.1);
  color: #FF6B6B;
  font-size: 13px;
  font-weight: 500;
}

/* Sheet Actions */
.sheet-actions {
  padding: 8px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.confirm-btn {
  width: 100%;
  height: 54px;
  border-radius: 14px;
  font-size: 17px;
  font-weight: 600;
  background: linear-gradient(135deg, #15DE72, #0DBB5F) !important;
  color: white !important;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
}

.cancel-btn {
  width: 100%;
  height: 48px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 500;
}

.cancel-btn.cancel-dark {
  color: rgba(255, 255, 255, 0.6);
}

.cancel-btn.cancel-light {
  color: rgba(0, 0, 0, 0.5);
}

/* ==========================================
   Responsive
   ========================================== */
@media (max-width: 375px) {
  .qr-frame {
    padding: 10px;
  }

  .hero-value {
    font-size: 38px;
  }

  .confirm-btn {
    height: 50px;
    font-size: 16px;
  }
}
</style>
