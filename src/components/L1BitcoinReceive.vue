<template>
  <div class="l1-bitcoin-receive">
    <!-- QR Code Section -->
    <div class="qr-section">
      <div class="qr-card" @click="copyAddress">
        <div class="qr-frame" :class="{ 'loading': !depositAddress }">
          <vue-qrcode
            v-if="depositAddress"
            ref="depositQr"
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
      <Icon icon="tabler:currency-bitcoin" width="16" height="16" class="pill-icon" />
      <span class="pill-address">{{ truncateAddress(depositAddress) }}</span>
      <Icon icon="tabler:copy" width="14" height="14" class="pill-copy" />
    </div>

    <!-- Action Buttons — markup and styling intentionally mirror the Spark
         receive view (ReceiveModal.vue) so both flows feel identical. -->
    <div v-if="depositAddress" class="action-buttons">
      <button
        class="action-btn"
        :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
        @click="copyAddress"
      >
        <Icon icon="tabler:copy" width="18" height="18" />
        <span>{{ $t('Copy') }}</span>
      </button>
      <button
        class="action-btn"
        :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
        @click="shareAddress"
      >
        <Icon icon="tabler:share" width="18" height="18" />
        <span>{{ $t('Share') }}</span>
      </button>
    </div>

    <!--
      Pending Deposits
      Polished incoming-deposit tracker. Surfaces directly under the
      address card so a user who just scanned the QR sees the
      confirmation progress without scrolling. Card uses Bitcoin orange
      as the accent (matches the asset colour) instead of the legacy
      green tint, with a subtle progress bar that fills 1/3 → 2/3 → 3/3
      so the wait is legible at a glance.
    -->
    <div v-if="pendingDeposits.length > 0" class="deposits-section" :class="$q.dark.isActive ? 'deposits-section-dark' : 'deposits-section-light'">
      <div class="section-header">
        <span class="section-eyebrow" :class="$q.dark.isActive ? 'eyebrow-dark' : 'eyebrow-light'">
          <span class="eyebrow-pulse" aria-hidden="true"></span>
          {{ $t('Incoming') }}
        </span>
        <q-btn
          flat
          dense
          round
          size="sm"
          :loading="isCheckingDeposits"
          @click="checkDeposits"
          class="refresh-icon"
          :class="[$q.dark.isActive ? 'refresh-dark' : 'refresh-light', { 'spinning': isCheckingDeposits }]"
        >
          <Icon icon="tabler:refresh" width="14" height="14" />
        </q-btn>
      </div>

      <div
        v-for="deposit in pendingDeposits"
        :key="deposit.txId"
        class="deposit-row"
      >
        <!-- Avatar: orange-tinted Bitcoin glyph (shared with the
             transaction-history rows so the same payment reads the same
             everywhere). -->
        <div class="deposit-indicator" :class="$q.dark.isActive ? 'indicator-dark' : 'indicator-light'">
          <Icon icon="tabler:currency-bitcoin" width="20" height="20" />
        </div>

        <!-- Centre: amount + progress meter. -->
        <div class="deposit-details">
          <div class="deposit-amount-row">
            <span class="deposit-amount" :class="$q.dark.isActive ? 'amount-dark' : 'amount-light'">
              +{{ formatAmount(deposit.amount) }}
            </span>
            <span
              class="deposit-state"
              :class="[
                deposit.confirmed ? 'state-ready' : 'state-pending',
                $q.dark.isActive ? 'state-dark' : 'state-light'
              ]"
            >
              {{ deposit.confirmed ? $t('Ready') : $t('Confirming...') }}
            </span>
          </div>
          <div class="deposit-progress" :class="$q.dark.isActive ? 'progress-dark' : 'progress-light'" aria-hidden="true">
            <span
              class="progress-fill"
              :class="deposit.confirmed ? 'progress-fill-ready' : 'progress-fill-pending'"
              :style="{ width: ((Math.min(deposit.confirmations, 3) / 3) * 100) + '%' }"
            ></span>
          </div>
          <div class="deposit-meta" :class="$q.dark.isActive ? 'meta-dark' : 'meta-light'">
            {{ deposit.confirmations }}/3 {{ $t('confirmations') }}
          </div>
        </div>

        <!-- Trailing action: Claim CTA when ready, nothing when still
             waiting (the progress bar carries that state). -->
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
        <Icon icon="tabler:refresh" width="16" height="16" class="q-mr-xs" />
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
          <Icon icon="tabler:info-circle" width="16" height="16" />
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
import { formatAmount as formatAmountUtil } from 'src/utils/amountFormatting';
import { shareContent } from 'src/utils/share';
import { qrBlobFromRef } from 'src/utils/qrShare';
import { truncateAddress } from 'src/utils/addressUtils';
import { getQrOptions } from 'src/utils/qrConfig';

export default {
  name: 'L1BitcoinReceive',

  components: {
    VueQrcode
  },

  props: {
    qrOptions: {
      type: Object,
      default: () => getQrOptions()
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

    /**
     * Poll for balance update after a processing claim
     * Used when TRANSFER_LOCKED indicates background processing
     */
    startBalancePolling() {
      let attempts = 0;
      const maxAttempts = 10;
      const intervalMs = 3000; // 3 seconds

      const poll = setInterval(async () => {
        attempts++;

        try {
          // Refresh wallet balance
          if (this.walletStore.activeWalletId) {
            await this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
          }
        } catch (error) {
          console.warn('Balance poll error:', error.message);
        }

        // Stop after max attempts
        if (attempts >= maxAttempts) {
          clearInterval(poll);
        }
      }, intervalMs);
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

        // Handle processing state (TRANSFER_LOCKED - claim is being processed in background)
        if (result.processing) {
          this.$q.notify({
            type: 'info',
            message: this.$t('Claim is being processed'),
            caption: this.$t('Your balance will update shortly'),
            icon: 'sync'
          });

          // Remove from pending list (it will complete in background)
          this.pendingDeposits = this.pendingDeposits.filter(
            d => d.txId !== this.claimingDeposit.txId
          );

          // Start polling for balance update
          this.startBalancePolling();

          this.$emit('deposit-claimed', result);
          this.showClaimDialog = false;
          return;
        }

        // Immediate success
        this.$q.notify({
          type: 'positive',
          message: this.$t('Bitcoin added to wallet'),
          caption: `+${this.formatAmount(result.amount)}`
        });

        // Remove claimed deposit from list
        this.pendingDeposits = this.pendingDeposits.filter(
          d => d.txId !== this.claimingDeposit.txId
        );

        // Refresh wallet balance
        if (this.walletStore.activeWalletId) {
          await this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
        }

        this.$emit('deposit-claimed', result);
        this.showClaimDialog = false;

      } catch (error) {
        console.error('Failed to claim deposit:', error);
        const userMessage = this.getUserFriendlyError(error, 'claim');
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description
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
      return truncateAddress(address);
    },

    formatAmount(sats) {
      if (!sats && sats !== 0) return formatAmountUtil(0, this.walletStore.useBip177Format);
      return formatAmountUtil(sats, this.walletStore.useBip177Format);
    },

    async copyAddress() {
      if (!this.depositAddress) return;

      try {
        await navigator.clipboard.writeText(this.depositAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied'),

        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy'),

        });
      }
    },

    async shareAddress() {
      if (!this.depositAddress) return;

      const qrBlob = await qrBlobFromRef(this.$refs.depositQr);
      const result = await shareContent({
        title: this.$t('Bitcoin Address'),
        // Pure address so recipients can copy-paste cleanly. The
        // BuhoGO wordmark is baked into the QR image by qrShare.
        text: this.depositAddress,
        files: qrBlob ? [{ blob: qrBlob, name: 'bitcoin-address.png', mimeType: 'image/png' }] : undefined,
      });

      if (result.success) {
        // Native share UI already confirms success; no toast needed.
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share address:', result.error);
        }
        await this.copyAddress();
      }
      // 'cancelled' → user closed the dialog, no action needed.
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
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  min-height: 0;
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
  width: 240px;
  height: 240px;
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
  margin-top: 8px;
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

.pill-icon {
  color: #F7931A;
}

.pill-address {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.pill-copy {
  opacity: 0.4;
}

/* ==========================================
   Action Buttons
   ========================================== */
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

/* Action button styles intentionally mirror ReceiveModal.vue's Spark view
   so the Bitcoin receive screen matches the Spark receive screen pixel-
   for-pixel. Keep these in sync if either side changes. */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: background-color 0.18s ease, color 0.18s ease;
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

/* ==========================================
   Pending Deposits — orange-accented, fits both themes through
   CSS variables + paired -light / -dark modifiers.
   ========================================== */
.deposits-section {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid transparent;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.deposits-section-light {
  background: rgba(247, 147, 26, 0.06);
  border-color: rgba(247, 147, 26, 0.18);
}
.deposits-section-dark {
  background: rgba(247, 147, 26, 0.07);
  border-color: rgba(247, 147, 26, 0.16);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
}

.section-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.eyebrow-light { color: #B86E0F; }
.eyebrow-dark  { color: #FBBF77; }

/* Soft pulsing dot to signal "in motion". Pure CSS, no JS. */
.eyebrow-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #F7931A;
  box-shadow: 0 0 0 0 rgba(247, 147, 26, 0.55);
  animation: eyebrow-pulse 1.8s ease-out infinite;
}
@keyframes eyebrow-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(247, 147, 26, 0.55); }
  70%  { box-shadow: 0 0 0 8px rgba(247, 147, 26, 0);    }
  100% { box-shadow: 0 0 0 0 rgba(247, 147, 26, 0);    }
}

.refresh-icon { transition: opacity 0.15s ease; }
.refresh-light { color: #B86E0F; }
.refresh-dark  { color: #FBBF77; }
.refresh-icon.spinning { animation: spin 1s linear infinite; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Deposit Row */
.deposit-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px 14px;
}
.deposit-row + .deposit-row {
  border-top: 1px solid rgba(247, 147, 26, 0.12);
}

/* Avatar: tinted bg + solid Bitcoin orange glyph. Same vocabulary as
   the transaction-history rows so a deposit reads the same wherever
   the user encounters it. */
.deposit-indicator {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #F7931A;
}
.indicator-light { background: rgba(247, 147, 26, 0.14); }
.indicator-dark  { background: rgba(247, 147, 26, 0.18); }

.deposit-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deposit-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.deposit-amount {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.amount-light { color: #0F172A; }
.amount-dark  { color: #FFFFFF; }

.deposit-state {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.state-pending.state-light { color: #B86E0F; }
.state-pending.state-dark  { color: #FBBF77; }
.state-ready.state-light   { color: #0DBB5F; }
.state-ready.state-dark    { color: #15DE72; }

/* Progress meter — fills with Bitcoin orange while pending, flips to
   green the moment the deposit is claimable. Width is driven inline
   so it animates smoothly between confirmation jumps. */
.deposit-progress {
  position: relative;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
}
.progress-light { background: rgba(247, 147, 26, 0.16); }
.progress-dark  { background: rgba(247, 147, 26, 0.18); }

.progress-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background 0.2s ease;
}
.progress-fill-pending {
  background: linear-gradient(90deg, #F7931A, #FFB347);
}
.progress-fill-ready {
  background: linear-gradient(90deg, #0DBB5F, #15DE72);
}

.deposit-meta {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.meta-light { color: rgba(15, 23, 42, 0.6); }
.meta-dark  { color: rgba(255, 255, 255, 0.55); }

/* Claim CTA — same green palette as elsewhere in the app, but tightened
   shadow so it doesn't fight with the orange accent. */
.claim-btn {
  background: linear-gradient(135deg, #15DE72, #0DBB5F) !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  padding: 8px 16px !important;
  border-radius: 10px !important;
  box-shadow: 0 2px 6px rgba(21, 222, 114, 0.22);
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
  background: var(--bg-card);
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
  padding: 8px 20px;
  padding-bottom: max(32px, var(--safe-bottom, 0px));
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
