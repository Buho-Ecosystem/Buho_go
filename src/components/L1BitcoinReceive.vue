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
            :options="bitcoinQrOptions"
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
    <!--
      Pending Deposits — slim, single-line chips. The chip is just a
      tap target; the bottom sheet below carries the full picture
      (progress while confirming, fee + Add to Wallet when ready).
      That keeps the receive screen scannable when nothing is
      happening yet, and gives users one consistent surface to learn.
    -->
    <div v-if="pendingDeposits.length > 0" class="deposits-list">
      <button
        v-for="deposit in pendingDeposits"
        :key="deposit.txId"
        class="deposit-chip"
        :class="$q.dark.isActive ? 'chip-dark' : 'chip-light'"
        @click="openDepositSheet(deposit)"
      >
        <div class="chip-indicator" :class="$q.dark.isActive ? 'indicator-dark' : 'indicator-light'">
          <Icon icon="tabler:currency-bitcoin" width="16" height="16" />
        </div>
        <span class="chip-amount" :class="$q.dark.isActive ? 'amount-dark' : 'amount-light'">
          +{{ formatAmount(deposit.amount) }}
        </span>
        <span
          class="chip-status"
          :class="[
            deposit.confirmed ? 'chip-status-ready' : 'chip-status-pending',
            $q.dark.isActive ? 'chip-status-dark' : 'chip-status-light'
          ]"
        >
          <span class="chip-dot" :class="deposit.confirmed ? 'chip-dot-ready' : 'chip-dot-pending'" aria-hidden="true"></span>
          <span v-if="deposit.confirmed">{{ walletStore.isDepositClaimInFlight(deposit.txId) ? $t('Adding') : $t('Ready') }}</span>
          <span v-else>{{ deposit.confirmations }}/3</span>
        </span>
        <Icon icon="tabler:chevron-right" width="14" height="14" class="chip-chevron" />
      </button>
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

    <!--
      Deposit Sheet — single bottom sheet that handles every state of
      a single Bitcoin deposit: still confirming, fetching the fee
      quote, ready to claim, claim in flight. The chip above just
      opens the sheet for the deposit it represents; everything the
      user might want to do/see lives here so this is the one surface
      we'd expose if a second call site ever needs the same flow.
    -->
    <q-dialog v-model="showClaimDialog" position="bottom" transition-show="slide-up" transition-hide="slide-down">
      <q-card class="claim-sheet" :class="$q.dark.isActive ? 'sheet-dark' : 'sheet-light'">
        <div class="sheet-handle"><div class="handle-bar"></div></div>

        <!-- ============================================================
             CONFIRMING STATE — deposit is still waiting for blocks.
             We surface the count, a 3-segment progress strip, and the
             expected time so the user doesn't have to guess. No CTA
             here; the sheet auto-promotes to the ready state when
             confirmations land.
             ============================================================ -->
        <template v-if="claimingDeposit && !claimingDeposit.confirmed">
          <div class="amount-hero">
            <div class="hero-eyebrow" :class="$q.dark.isActive ? 'eyebrow-dark' : 'eyebrow-light'">
              <span class="eyebrow-pulse" aria-hidden="true"></span>
              {{ $t('Bitcoin arriving') }}
            </div>
            <div class="hero-value hero-value-pending">
              +{{ formatAmount(claimingDeposit.amount) }}
            </div>
            <div class="hero-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
              {{ $t('Confirming on the Bitcoin network') }}
            </div>
          </div>

          <div class="confirm-progress">
            <div class="confirm-segments" aria-hidden="true">
              <span
                v-for="i in 3"
                :key="i"
                class="confirm-segment"
                :class="[
                  $q.dark.isActive ? 'segment-dark' : 'segment-light',
                  { 'segment-filled': (claimingDeposit.confirmations || 0) >= i }
                ]"
              ></span>
            </div>
            <div class="confirm-caption" :class="$q.dark.isActive ? 'meta-dark' : 'meta-light'">
              <strong>{{ claimingDeposit.confirmations || 0 }}/3</strong>
              {{ $t('confirmations') }}
              <span class="meta-sep" aria-hidden="true">·</span>
              <span>{{ $t('~10-60 min total') }}</span>
            </div>
          </div>

          <div class="sheet-actions">
            <q-btn
              flat
              no-caps
              class="cancel-btn"
              :class="$q.dark.isActive ? 'cancel-dark' : 'cancel-light'"
              @click="cancelClaim"
            >
              {{ $t('Close') }}
            </q-btn>
          </div>
        </template>

        <!-- ============================================================
             READY / CLAIMING STATE — deposit has 3+ confirmations.
             Quote fetch happens inline so the sheet can be opened at
             the moment of confirmation without a separate modal hop.
             ============================================================ -->
        <template v-else-if="claimingDeposit">
          <div class="amount-hero">
            <div class="hero-value">
              <q-spinner v-if="isLoadingQuote" size="32px" :color="$q.dark.isActive ? 'green-4' : 'green-8'" />
              <span v-else>+{{ formatAmount(netClaimAmount) }}</span>
            </div>
            <div class="hero-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
              {{ isLoadingQuote ? $t('Calculating fee...') : $t('will be added to your wallet') }}
            </div>
          </div>

          <div v-if="!isLoadingQuote && claimFeeQuote" class="fee-details" :class="$q.dark.isActive ? 'details-dark' : 'details-light'">
            <div class="fee-row">
              <span class="fee-label">{{ $t('Deposit') }}</span>
              <span class="fee-value">{{ formatAmount(claimingDeposit.amount || 0) }}</span>
            </div>
            <div class="fee-row deduct">
              <span class="fee-label">{{ $t('Network fee') }}</span>
              <span class="fee-value">-{{ formatAmount(claimFeeAmount) }}</span>
            </div>
          </div>

          <div v-if="!isLoadingQuote && isHighFee" class="fee-alert">
            <Icon icon="tabler:info-circle" width="16" height="16" />
            <span>{{ $t('High fee relative to deposit') }}</span>
          </div>

          <div class="sheet-actions">
            <q-btn
              unelevated
              no-caps
              class="confirm-btn"
              :class="$q.dark.isActive ? 'confirm-btn-dark' : 'confirm-btn-light'"
              :loading="isClaimingDeposit || walletStore.isDepositClaimInFlight(claimingDeposit.txId)"
              :disable="isLoadingQuote || !claimFeeQuote"
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
        </template>
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
import { AUTO_CLAIM_THRESHOLDS } from 'src/stores/bitcoinPreferences';

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
      // Claim dialog state. The same sheet shows both the
      // "still confirming" view and the "ready to claim" view, driven
      // by `claimingDeposit.confirmed`. `isLoadingQuote` covers the
      // brief gap after a confirmed deposit's sheet opens but before
      // the SSP fee quote arrives.
      showClaimDialog: false,
      claimingDeposit: null,
      claimFeeQuote: null,
      isLoadingQuote: false,
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

    /**
     * Render the Bitcoin QR slightly smaller than the default Spark/LN
     * QR (220px vs 280px) so the receive screen fits a phone viewport
     * with the address pill, action buttons and incoming chips below
     * the fold without scrolling. The shape is set via the canvas
     * width here rather than CSS — scaling a canvas via CSS skews it
     * because canvas doesn't honour `height: auto` from intrinsic
     * width/height attributes.
     */
    bitcoinQrOptions() {
      return { ...this.qrOptions, width: 220 };
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
      // Mirror the auto-claim classifier so the in-sheet warning fires
      // for exactly the deposits that fall into `needs_approval` (i.e.
      // the ones we used to flag with a sticky banner). Single source
      // of truth lives in bitcoinPreferences.
      if (!this.claimingDeposit || !this.claimFeeQuote) return false;
      const ratio = this.claimingDeposit.amount > 0
        ? this.claimFeeAmount / this.claimingDeposit.amount
        : 1;
      return (
        this.claimFeeAmount > AUTO_CLAIM_THRESHOLDS.MAX_FEE_SATS ||
        ratio > AUTO_CLAIM_THRESHOLDS.MAX_FEE_RATIO
      );
    }
  },

  mounted() {
    this.loadDepositAddress();
    // Note: Polling starts after successful address load in loadDepositAddress()
  },

  beforeUnmount() {
    this.stopPolling();
  },

  watch: {
    // The store bumps `depositsRefreshSignal` whenever a claim (auto or
    // manual, here or in Wallet.vue) lands. We re-fetch instead of trusting
    // the 30s poll so the row vanishes the instant the UTXO is gone.
    'walletStore.depositsRefreshSignal'() {
      this.checkDeposits();
    }
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
          this.pendingDeposits = await provider.getPendingDeposits();
          this.$emit('deposits-updated', this.pendingDeposits);

          // If the sheet is open against a deposit that just promoted
          // to confirmed (poll tick caught the third confirmation),
          // re-bind to the fresh object and kick off the quote fetch
          // so the sheet auto-transitions from "Confirming" to the
          // Add to Wallet view in front of the user.
          if (this.showClaimDialog && this.claimingDeposit) {
            const fresh = this.pendingDeposits.find(d => d.txId === this.claimingDeposit.txId);
            if (fresh) {
              const justConfirmed = fresh.confirmed && !this.claimingDeposit.confirmed;
              this.claimingDeposit = fresh;
              if (justConfirmed && !this.claimFeeQuote) {
                this.openDepositSheet(fresh);
              }
            }
          }
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

    /**
     * Open the deposit sheet for any deposit, confirmed or not.
     *
     * Not confirmed → just show the progress view; no quote, no
     * SSP call. The sheet auto-promotes to the ready view once a
     * poll tick mutates `deposit.confirmed` to true (handled in
     * `checkDeposits`).
     *
     * Confirmed → flip `isLoadingQuote` BEFORE opening so the very
     * first paint shows the spinner instead of `+₿ 0` (the ready
     * view's amount is derived from `claimFeeQuote` which is null
     * until the SSP responds). Then fetch the quote.
     *
     * If an auto-claim is already mid-flight for this UTXO we still
     * fetch a quote — the SSP either returns one (we can race-recover
     * if the user taps Add to Wallet too), or rejects with "not found"
     * which we surface as a friendly "Deposit not available" toast.
     * Better than opening an empty sheet the user can't act on.
     */
    async openDepositSheet(deposit) {
      // Set the spinner flag first so the first render of the ready
      // view shows the spinner, never the 0-sat fallback amount.
      this.isLoadingQuote = !!deposit.confirmed;
      this.claimingDeposit = deposit;
      this.claimFeeQuote = null;
      this.showClaimDialog = true;

      if (!deposit.confirmed) return;

      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getClaimFeeQuote) {
          throw new Error('Claim not supported');
        }
        this.claimFeeQuote = await provider.getClaimFeeQuote(deposit.txId, deposit.outputIndex);
      } catch (error) {
        console.error('Failed to get claim fee quote:', error);
        const userMessage = this.getUserFriendlyError(error, 'claim');
        this.$q.notify({
          type: 'negative',
          message: userMessage.title,
          caption: userMessage.description
        });
        // Close the sheet on quote failure — without a quote there's
        // nothing actionable for the user to see.
        this.showClaimDialog = false;
        this.claimingDeposit = null;
      } finally {
        this.isLoadingQuote = false;
      }
    },

    cancelClaim() {
      this.showClaimDialog = false;
      this.claimingDeposit = null;
      this.claimFeeQuote = null;
      this.isLoadingQuote = false;
    },

    async confirmClaim() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return;

      const claimTxId = this.claimingDeposit.txId;

      // Final coordination check: auto-claim may have grabbed the UTXO
      // between the user opening this sheet and tapping "Add to Wallet".
      // Bail with a friendly message instead of submitting a duplicate.
      if (this.walletStore.isDepositClaimInFlight(claimTxId)) {
        this.$q.notify({
          type: 'info',
          icon: 'sync',
          message: this.$t('Already adding to wallet'),
          caption: this.$t('Your balance will update shortly')
        });
        this.showClaimDialog = false;
        return;
      }

      this.walletStore.markDepositClaimInFlight(claimTxId);
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
          // Tell the parent banner to drop this deposit immediately so the
          // "Ready to claim" pill on the wallet home doesn't outlive the
          // sheet by 30 seconds.
          this.walletStore.signalDepositsRefresh();
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
        this.walletStore.signalDepositsRefresh();
        this.showClaimDialog = false;

      } catch (error) {
        console.error('Failed to claim deposit:', error);

        // Race recovery: the auto-claim path in Wallet.vue may have already
        // claimed this deposit between our quote and the SSP submit. In that
        // case the SDK throws a misleading "needs more confirmations" error
        // even though the UTXO is gone. Re-check the pending list — if our
        // deposit is no longer there, treat it as a success and refresh the
        // balance instead of surfacing a scary error.
        const claimedTxId = this.claimingDeposit?.txId;
        let alreadyClaimed = false;
        try {
          const provider = await this.walletStore.ensureSparkConnected();
          if (provider?.getPendingDeposits && claimedTxId) {
            const stillPending = await provider.getPendingDeposits();
            alreadyClaimed = !stillPending.some(d => d.txId === claimedTxId);
            if (alreadyClaimed) {
              this.pendingDeposits = stillPending;
              this.$emit('deposits-updated', this.pendingDeposits);
            }
          }
        } catch (recheckError) {
          console.warn('Post-claim re-check failed:', recheckError?.message || recheckError);
        }

        if (alreadyClaimed) {
          this.$q.notify({
            type: 'positive',
            message: this.$t('Bitcoin added to wallet'),

          });
          this.walletStore.signalDepositsRefresh();
        } else {
          const userMessage = this.getUserFriendlyError(error, 'claim');
          this.$q.notify({
            type: 'negative',
            message: userMessage.title,
            caption: userMessage.description
          });
        }

        // Always refresh balance — even on a "real" failure, an in-flight
        // auto-claim may have settled in the background.
        if (this.walletStore.activeWalletId) {
          try {
            await this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
          } catch (refreshError) {
            console.warn('Balance refresh failed:', refreshError?.message || refreshError);
          }
        }

        // Close the sheet on error so the amount doesn't visibly drop to 0
        // when we null the quote in `finally`.
        this.showClaimDialog = false;
      } finally {
        this.walletStore.clearDepositClaimInFlight(claimTxId);
        this.isClaimingDeposit = false;
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
          message: this.$t('Failed to copy address'),

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

      // Deposit not found or already claimed — checked BEFORE the
      // confirmation-keyword branch because the SDK sometimes returns a
      // "needs more confirmations" message for a UTXO that was actually
      // already swept (e.g. by the auto-claim path).
      if (errorLower.includes('not found') || errorLower.includes('already claimed') ||
          errorLower.includes('utxo')) {
        return {
          title: this.$t('Deposit not available'),
          description: this.$t('This deposit may have already been claimed.')
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
  padding: 12px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.qr-frame.loading {
  width: 220px;
  height: 220px;
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
   Pending Deposits — slim chip list. Each row is a single tap
   target that opens the deposit sheet for that UTXO. The sheet
   carries the full picture (progress while confirming, fee table
   when ready), so the chip stays minimal: avatar, amount, tiny
   status, chevron. Listed vertically in case a user receives
   multiple deposits in a row.
   ========================================== */
.deposits-list {
  align-self: stretch;
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.deposit-chip {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: 'Manrope', sans-serif;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.08s ease;
  -webkit-tap-highlight-color: transparent;
}
.deposit-chip:active { transform: scale(0.99); }

.chip-light {
  background: rgba(247, 147, 26, 0.06);
  border-color: rgba(247, 147, 26, 0.18);
}
.chip-light:hover {
  background: rgba(247, 147, 26, 0.10);
}
.chip-dark {
  background: rgba(247, 147, 26, 0.07);
  border-color: rgba(247, 147, 26, 0.16);
}
.chip-dark:hover {
  background: rgba(247, 147, 26, 0.11);
}

/* Avatar: tinted bg + solid Bitcoin orange glyph. Same vocabulary as
   the transaction-history rows so a deposit reads the same wherever
   the user encounters it. */
.chip-indicator {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #F7931A;
}
.indicator-light { background: rgba(247, 147, 26, 0.14); }
.indicator-dark  { background: rgba(247, 147, 26, 0.18); }

.chip-amount {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.amount-light { color: #0F172A; }
.amount-dark  { color: #FFFFFF; }

/* Status badge — soft pill with a status dot + tiny label.
   Pending uses the orange family, ready flips to green. */
.chip-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.chip-status-pending.chip-status-light { background: rgba(247, 147, 26, 0.14); color: #B86E0F; }
.chip-status-pending.chip-status-dark  { background: rgba(247, 147, 26, 0.18); color: #FBBF77; }
.chip-status-ready.chip-status-light   { background: rgba(13, 187, 95, 0.14); color: #0DBB5F; }
.chip-status-ready.chip-status-dark    { background: rgba(21, 222, 114, 0.18); color: #15DE72; }

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.chip-dot-pending {
  background: #F7931A;
  box-shadow: 0 0 0 0 rgba(247, 147, 26, 0.55);
  animation: eyebrow-pulse 1.8s ease-out infinite;
}
.chip-dot-ready {
  background: #15DE72;
}

.chip-chevron {
  opacity: 0.4;
  flex-shrink: 0;
}

/* Reused by the sheet's "Bitcoin arriving" eyebrow + chip dot. */
@keyframes eyebrow-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(247, 147, 26, 0.55); }
  70%  { box-shadow: 0 0 0 7px rgba(247, 147, 26, 0);  }
  100% { box-shadow: 0 0 0 0 rgba(247, 147, 26, 0);    }
}
.eyebrow-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #F7931A;
  box-shadow: 0 0 0 0 rgba(247, 147, 26, 0.55);
  animation: eyebrow-pulse 1.8s ease-out infinite;
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
  /* Inherits the project's brand-aware credit colour: muted #059573 on
     cream (set on body.body--light via --color-green), neon #15DE72 on
     dark. Keeps "incoming sats" as a credit signal without the cream-
     mode neon buzz. */
  color: var(--color-green, #15DE72);
  line-height: 1;
}

.hero-label {
  font-size: 15px;
  margin-top: 10px;
}

/* Confirming-state hero overrides — small uppercase eyebrow above
   the amount, and a softer orange tint for the amount itself so it
   doesn't claim the same credit-green meaning as the ready state. */
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 12px;
}
.hero-eyebrow.eyebrow-light { color: #B86E0F; }
.hero-eyebrow.eyebrow-dark  { color: #FBBF77; }

.hero-value-pending {
  color: #F7931A !important;
}

/* 3-segment confirmation strip. Each segment is a rounded bar that
   fills as confirmations land. We use distinct elements (instead of
   a single bar with width %) so the discrete "1 of 3" milestone is
   legible at a glance and animates per-block. */
.confirm-progress {
  margin: 0 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.confirm-segments {
  display: flex;
  gap: 6px;
}

.confirm-segment {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  transition: background 0.3s ease;
}
.confirm-segment.segment-light { background: rgba(247, 147, 26, 0.18); }
.confirm-segment.segment-dark  { background: rgba(247, 147, 26, 0.20); }
.confirm-segment.segment-filled {
  background: linear-gradient(90deg, #F7931A, #FFB347);
}

.confirm-caption {
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.confirm-caption strong {
  font-weight: 700;
}
.confirm-caption .meta-sep {
  margin: 0 4px;
  opacity: 0.5;
}

/* Reused by the confirming caption below the segments. */
.meta-light { color: rgba(15, 23, 42, 0.6); }
.meta-dark  { color: rgba(255, 255, 255, 0.55); }

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
}
.confirm-btn-dark {
  background: linear-gradient(135deg, #15DE72, #0DBB5F) !important;
  color: white !important;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
}
.confirm-btn-light {
  background: var(--btn-neutral-bg) !important;
  color: var(--btn-neutral-fg) !important;
  box-shadow: none;
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
