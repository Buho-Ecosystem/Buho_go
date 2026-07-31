<!--
  OnchainFeePanel
  The Spark L1 fee machinery, rendered inside PaymentConfirmSheet's
  `extras` slot so on-chain sends share the one confirm surface instead
  of a parallel sheet. Owns everything an on-chain send needs beyond the
  standard sheet:

    - balance row with "Use all" (emits `use-max`; the parent writes the
      amount back into the sheet)
    - debounced fee quote from the Spark SDK (`getWithdrawalFeeQuote`) —
      we don't second-guess it with third-party mempool data, because
      those are the numbers the SSP will actually charge when the
      withdrawal is submitted with the matching `feeQuoteId`
    - Economy / Standard / Priority speed cards built from the per-tier
      quote
    - explicit fee breakdown (send amount, Spark service fee, Bitcoin
      network fee, total) and the balance-including-fee check

  Contract with the parent:
    - props: amountSats (live from the sheet's @amount-changed),
      address, availableBalance, disabled (while submitting)
    - @update:fee  the selected quote as a commit gate:
        { ready, speed, feeQuoteId, totalFeeSats, insufficient } —
        or null whenever no valid quote is selected. The parent feeds
        `ready && !insufficient` into the sheet's commitGate and passes
        speed/feeQuoteId/totalFeeSats to `withdrawToL1` on confirm.
    - @use-max     conservative max-sendable sats for "Use all"
-->
<template>
  <div class="onchain-panel">
    <!-- Balance row — always visible so the ceiling is in sight before
         the user types, mirroring the retired L1 sheet. -->
    <div class="balance-row">
      <span class="balance-label">
        {{ $t('Available') }} · {{ formatAmount(availableBalance) }}
      </span>
      <button
        type="button"
        class="max-pill"
        :disabled="disabled || availableBalance <= 0"
        @click="emitUseMax"
      >
        {{ $t('Use all') }}
      </button>
    </div>

    <!-- Speed selection — appears once we have a fee quote. The three
         options come straight from the SDK's per-tier quote so users
         compare exactly what the SSP will charge for each. -->
    <section v-if="amountSats > 0 && feeQuote" class="speed-section">
      <div class="section-label">{{ $t('How fast?') }}</div>
      <div class="speed-grid">
        <button
          v-for="opt in speedOptions"
          :key="opt.id"
          type="button"
          class="speed-card"
          :class="{
            'speed-card--selected': selectedSpeed === opt.id,
            'speed-card--recommended': opt.id === 'medium'
          }"
          :disabled="disabled"
          @click="selectedSpeed = opt.id"
        >
          <div v-if="opt.id === 'medium'" class="speed-recommended">{{ $t('Recommended') }}</div>
          <div class="speed-icon">
            <Icon :icon="opt.icon" width="22" height="22" />
          </div>
          <div class="speed-name">{{ opt.label }}</div>
          <div class="speed-time">{{ opt.timeText }}</div>
          <div class="speed-fee">{{ opt.feeText }}</div>
        </button>
      </div>
    </section>

    <!-- Fee-quote loading indicator -->
    <div v-else-if="amountSats > 0 && isLoadingFeeQuote" class="fee-loading">
      <q-spinner-dots size="22px" />
      <span>{{ $t('Calculating fees...') }}</span>
    </div>

    <!-- Summary panel — explicit breakdown so users know what each
         slice of the total covers before they commit. -->
    <section v-if="amountSats > 0 && feeQuote && selectedFee" class="summary">
      <div class="summary-row">
        <span>{{ $t('You send') }}</span>
        <span class="summary-value">{{ formatAmount(amountSats) }}</span>
      </div>
      <div class="summary-row summary-row--muted">
        <span>{{ $t('Spark service fee') }}</span>
        <span class="summary-value">{{ formatAmount(selectedFee.serviceFee) }}</span>
      </div>
      <div class="summary-row summary-row--muted">
        <span>{{ $t('Bitcoin network fee') }}</span>
        <span class="summary-value">{{ formatAmount(selectedFee.networkFee) }}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-row summary-row--total">
        <span>{{ $t('Total from wallet') }}</span>
        <span class="summary-value summary-value--total">{{ formatAmount(totalAmount) }}</span>
      </div>
    </section>

    <!-- Insufficient-balance warning — same vocabulary as the sheet's
         wallet-hint so the UI stays unified. -->
    <div v-if="insufficientBalance && amountSats > 0" class="balance-warning">
      <Icon icon="tabler:alert-triangle" width="14" height="14" />
      <span>{{ $t('Total exceeds your balance, try a smaller amount') }}</span>
    </div>
  </div>
</template>

<script>
import { useWalletStore } from '../stores/wallet';
import { formatAmount as formatAmountUtil } from '../utils/amountFormatting';
import { describeL1WithdrawError } from '../utils/l1WithdrawErrors';

// Conservative max-fee reservation for "Use all". The real fee gets
// recalculated once the quote returns; this just gives the user
// something to commit to with a single tap without the amount field
// flickering.
const USE_ALL_FEE_RESERVE_SATS = 2000;

export default {
  name: 'OnchainFeePanel',

  props: {
    /** Live amount from the confirm sheet (its @amount-changed emit). */
    amountSats: { type: Number, default: 0 },
    /** Bare on-chain destination (BIP21 already unwrapped upstream). */
    address: { type: String, required: true },
    availableBalance: { type: Number, default: 0 },
    /** True while the parent is submitting — freezes the controls. */
    disabled: { type: Boolean, default: false },
  },

  emits: ['update:fee', 'use-max'],

  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },

  data() {
    return {
      feeQuote: null,
      isLoadingFeeQuote: false,
      selectedSpeed: 'medium',
      feeQuoteDebounceTimer: null,
    };
  },

  computed: {
    selectedFee() {
      if (!this.feeQuote || !this.selectedSpeed) return null;
      return this.feeQuote[this.selectedSpeed];
    },

    totalAmount() {
      if (!this.selectedFee) return this.amountSats;
      return this.amountSats + this.selectedFee.totalFee;
    },

    insufficientBalance() {
      return this.totalAmount > this.availableBalance;
    },

    /**
     * Speed-card view models. Building these in computed-land keeps the
     * template free of conditional formatting and lets the cards render
     * through a single `v-for`. Fee numbers come straight from the SDK
     * quote — no third-party derivation.
     */
    speedOptions() {
      if (!this.feeQuote) return [];
      const fmt = (sats) => this.formatAmount(sats);
      // Icon vocabulary mirrors the auto-withdraw fee picker in Settings
      // so the same three speeds read identically across the app.
      return [
        {
          id: 'slow',
          icon: 'tabler:leaf',
          label: this.$t('Economy'),
          timeText: this.$t(this.feeQuote.slow.timeEstimate),
          feeText: fmt(this.feeQuote.slow.totalFee)
        },
        {
          id: 'medium',
          icon: 'tabler:scale',
          label: this.$t('Standard'),
          timeText: this.$t(this.feeQuote.medium.timeEstimate),
          feeText: fmt(this.feeQuote.medium.totalFee)
        },
        {
          id: 'fast',
          icon: 'tabler:rocket',
          label: this.$t('Priority'),
          timeText: this.$t(this.feeQuote.fast.timeEstimate),
          feeText: fmt(this.feeQuote.fast.totalFee)
        }
      ];
    }
  },

  watch: {
    /**
     * Debounced quote-per-amount. Any amount edit invalidates the current
     * quote immediately (the gate goes null → the sheet's commit control
     * disables), then a fresh quote is fetched once typing settles.
     */
    amountSats: {
      handler(sats) {
        if (this.feeQuoteDebounceTimer) clearTimeout(this.feeQuoteDebounceTimer);
        this.feeQuote = null;
        this.emitFeeGate();
        if (sats > 0) {
          this.feeQuoteDebounceTimer = setTimeout(() => this.fetchFeeQuote(), 500);
        }
      },
      immediate: true
    },

    selectedSpeed() {
      this.emitFeeGate();
    },

    // Balance changes (mid-typing refresh) can flip sufficiency.
    insufficientBalance() {
      this.emitFeeGate();
    }
  },

  beforeUnmount() {
    if (this.feeQuoteDebounceTimer) clearTimeout(this.feeQuoteDebounceTimer);
  },

  methods: {
    emitUseMax() {
      const maxSendable = Math.max(0, this.availableBalance - USE_ALL_FEE_RESERVE_SATS);
      this.$emit('use-max', maxSendable);
    },

    emitFeeGate() {
      if (!this.selectedFee) {
        this.$emit('update:fee', null);
        return;
      }
      this.$emit('update:fee', {
        ready: true,
        speed: this.selectedSpeed,
        feeQuoteId: this.selectedFee.feeQuoteId,
        totalFeeSats: this.selectedFee.totalFee,
        insufficient: this.insufficientBalance,
      });
    },

    async fetchFeeQuote() {
      if (this.amountSats <= 0) return;

      this.isLoadingFeeQuote = true;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getWithdrawalFeeQuote) {
          throw new Error('Withdrawal not supported');
        }
        this.feeQuote = await provider.getWithdrawalFeeQuote(this.amountSats, this.address);
        this.emitFeeGate();
      } catch (error) {
        console.error('Failed to fetch fee quote:', error);
        // The shared translator's titles ("Amount too small", "Connection
        // problem", "Wallet locked") are more accurate than the generic
        // "Bitcoin transaction failed" for these precondition errors,
        // so pass them through. Same modal shell as everywhere else.
        const msg = describeL1WithdrawError(error, this.$t.bind(this));
        this.walletStore.showPaymentError(error, {
          context: 'l1',
          route: 'L1 withdrawal fee quote',
          title: msg.title,
          reason: msg.description,
          t: this.$t.bind(this),
        });
        this.feeQuote = null;
        this.emitFeeGate();
      } finally {
        this.isLoadingFeeQuote = false;
      }
    },

    formatAmount(sats) {
      if (!sats && sats !== 0) return formatAmountUtil(0, this.walletStore.useBip177Format);
      return formatAmountUtil(sats, this.walletStore.useBip177Format);
    }
  }
};
</script>

<style scoped>
/* Sits inside PaymentConfirmSheet's .stage (which owns outer padding),
   so the panel only manages its own internal rhythm. */
.onchain-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ─── Balance row ─── */
.balance-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  justify-content: center;
}

.balance-label {
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 0.01em;
}

.max-pill {
  border: none;
  background: var(--brand-accent-soft);
  color: var(--brand-accent);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.08s ease;
}
.max-pill:hover:not(:disabled) { filter: brightness(1.05); }
.max-pill:active:not(:disabled) { transform: scale(0.96); }
.max-pill:disabled { opacity: 0.4; cursor: not-allowed; }

/* ─── Speed selection ─── */
.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.speed-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.speed-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.08s ease;
  font-family: inherit;
}

.speed-card:active:not(:disabled) { transform: scale(0.98); }
.speed-card:disabled { opacity: 0.6; cursor: not-allowed; }

.speed-card--selected {
  border-color: var(--brand-accent);
  background: var(--brand-accent-soft);
  box-shadow: inset 0 0 0 1px var(--brand-accent);
}

.speed-recommended {
  position: absolute;
  top: -8px;
  right: 10px;
  background: var(--brand-accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
}

/* Icon tile picks up the muted secondary tone for unselected cards and
   flips to brand-accent on the selected one. Driven entirely off CSS
   variables so light/dark mode follow the same rule. */
.speed-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 2px;
  color: var(--text-secondary);
  transition: color 0.15s ease;
}
.speed-card--selected .speed-icon { color: var(--brand-accent); }
.speed-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.speed-time { font-size: 11px; color: var(--text-muted); letter-spacing: 0.01em; }
.speed-fee {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.speed-card--selected .speed-fee { color: var(--brand-accent); }

/* ─── Fee loading ─── */
.fee-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 13px;
}

/* ─── Summary ─── */
.summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: var(--bg-input);
  border-radius: var(--radius-lg);
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-primary);
}

.summary-row--muted {
  color: var(--text-secondary);
  font-size: 12.5px;
}

.summary-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.summary-value--total {
  font-size: 15px;
  color: var(--text-primary);
}

.summary-divider {
  height: 1px;
  background: var(--border-card);
  margin: 4px 0;
}

.summary-row--total {
  font-size: 14px;
  font-weight: 600;
  margin-top: 2px;
}

/* ─── Insufficient balance ─── */
.balance-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  line-height: 1.4;
  background: rgba(239, 68, 68, 0.10);
  color: #DC2626;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.22);
}
.body--dark .balance-warning {
  background: rgba(239, 68, 68, 0.14);
  color: #FCA5A5;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.32);
}

@media (max-width: 480px) {
  .speed-card { padding: 12px 8px 10px; }
  .speed-icon { width: 26px; height: 26px; }
}
</style>
