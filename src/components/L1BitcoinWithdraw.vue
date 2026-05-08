<!--
  L1BitcoinWithdraw
  Self-managed bottom-sheet for sending Bitcoin on-chain. Uses the same
  design vocabulary as PaymentConfirmSheet (recipient hero, big amount
  stage, slide-to-send) but stays a dedicated component because L1 sends
  carry concerns the LN flows don't: priority-fee selection (slow /
  medium / fast), Spark service fee + Bitcoin network fee breakdown,
  and a wallet-balance check that includes the fee in the total.

  Fee numbers come from the Spark SDK's `getWithdrawalFeeQuote`
  (`userFee*` + `l1BroadcastFee*`) — we don't second-guess them with
  third-party mempool data, because those are the numbers the SSP will
  actually charge when we submit the withdrawal with the matching
  `feeQuoteId` and `feeAmountSats`.
-->
<template>
  <q-dialog
    v-model="show"
    position="bottom"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="sheet-card" :class="$q.dark.isActive ? 'sheet-card-dark' : 'sheet-card-light'">
      <div class="grab-bar"></div>

      <header class="top-row">
        <q-btn flat round dense @click="closeSheet" class="top-btn" :disable="isSending">
          <Icon icon="tabler:x" width="20" height="20" />
        </q-btn>
        <div class="top-title">{{ $t('Send Bitcoin') }}</div>
        <div class="top-spacer"></div>
      </header>

      <div class="stage">
        <!-- Recipient strip: bitcoin icon + truncated address with a tap-
             to-reveal toggle for the full address. -->
        <section class="recipient">
          <div class="recipient-avatar">
            <Icon icon="tabler:currency-bitcoin" width="28" height="28" />
          </div>
          <div class="recipient-meta">
            <div class="recipient-name">{{ $t('Bitcoin Address') }}</div>
            <button type="button" class="recipient-via" @click="showFullAddress = !showFullAddress">
              <span>{{ showFullAddress ? $t('Hide address') : truncateAddress(cleanedAddress) }}</span>
              <Icon
                icon="tabler:chevron-down"
                width="12"
                height="12"
                class="recipient-via-chev"
                :class="{ flipped: showFullAddress }"
              />
            </button>
            <transition name="fade-collapse">
              <div v-if="showFullAddress" class="recipient-address">{{ cleanedAddress }}</div>
            </transition>
          </div>
        </section>

        <!-- Amount stage -->
        <section class="amount-stage">
          <input
            v-model="displayAmount"
            type="text"
            inputmode="numeric"
            placeholder="0"
            class="amount-input"
            @input="onAmountChange"
            @focus="isAmountFocused = true"
            @blur="isAmountFocused = false"
            :readonly="isSending"
          />
          <button type="button" class="unit-pill" disabled>
            <span>{{ currencyLabel }}</span>
          </button>
          <div class="balance-row">
            <span class="balance-label">
              {{ $t('Available') }} · {{ formatAmount(availableBalance) }}
            </span>
            <button
              type="button"
              class="max-pill"
              :disabled="isSending || availableBalance <= 0"
              @click="setMaxAmount"
            >
              {{ $t('Use all') }}
            </button>
          </div>
        </section>

        <!-- Speed selection — appears once we have a fee quote. The
             three options (Economy / Normal / Fast) come straight from
             the SDK's per-tier quote so users compare exactly what the
             SSP will charge for each. -->
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
              :disabled="isSending"
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
        <section v-if="amountSats > 0 && feeQuote && selectedSpeed" class="summary">
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

        <!-- Insufficient-balance warning — same vocabulary as the
             PaymentConfirmSheet wallet-hint so the UI stays unified. -->
        <div v-if="insufficientBalance && amountSats > 0" class="wallet-hint">
          <Icon icon="tabler:alert-triangle" width="14" height="14" />
          <span>{{ $t('Total exceeds your balance — try a smaller amount') }}</span>
        </div>

        <!-- Slide-to-send. Bitcoin sends are always above the threshold
             we'd normally use for LN — every on-chain transaction is
             irreversible, so the deliberate gesture is appropriate
             regardless of amount. -->
        <div class="cta-row">
          <SlideToSend
            ref="slideRef"
            :label="slideLabel"
            :loading="isSending"
            :disabled="!canSend"
            @complete="executeWithdrawal"
          />
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { useWalletStore } from 'src/stores/wallet';
import { formatAmount as formatAmountUtil } from 'src/utils/amountFormatting';
import { parseBip21 } from 'src/utils/bip21';
import SlideToSend from './SlideToSend.vue';

export default {
  name: 'L1BitcoinWithdraw',
  components: { SlideToSend },

  props: {
    modelValue: { type: Boolean, default: false },
    destinationAddress: { type: String, required: true },
    availableBalance: { type: Number, default: 0 }
  },

  emits: ['update:modelValue', 'withdrawal-submitted', 'withdrawal-error'],

  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },

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
      showFullAddress: false
    };
  },

  computed: {
    show: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); }
    },

    /**
     * Clean Bitcoin address — if the user pastes a BIP21 URI, extract just
     * the on-chain address portion. Query params (amount, label, lightning)
     * are intentionally dropped here: this component is the L1 withdraw
     * path, so any `lightning=` fallback is not applicable.
     */
    cleanedAddress() {
      const raw = (this.destinationAddress || '').trim();
      const bip21 = parseBip21(raw);
      return bip21 ? bip21.address : raw;
    },

    /** Currency label for amount input — respects user format preference. */
    currencyLabel() {
      return this.walletStore.useBip177Format ? '₿' : 'sats';
    },

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

    canSend() {
      return (
        this.amountSats > 0 &&
        this.feeQuote &&
        this.selectedSpeed &&
        !this.insufficientBalance &&
        !this.isLoadingFeeQuote
      );
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
    },

    slideLabel() {
      if (!this.amountSats) return this.$t('Slide to send');
      return `${this.$t('Slide to send')} ${this.formatAmount(this.amountSats)}`;
    }
  },

  watch: {
    show(v) {
      // Reset all entry-form state on a fresh open so a previous
      // attempt's amount/fee don't leak into a new send.
      if (v) this.resetForFreshOpen();
    }
  },

  methods: {
    resetForFreshOpen() {
      this.displayAmount = '';
      this.amountSats = 0;
      this.feeQuote = null;
      this.isLoadingFeeQuote = false;
      this.selectedSpeed = 'medium';
      this.showFullAddress = false;
      this.isSending = false;
    },

    closeSheet() {
      if (this.isSending) return;
      this.show = false;
    },

    onAmountChange() {
      const value = parseFloat(this.displayAmount) || 0;
      this.amountSats = Math.floor(value);

      // Debounce so we're not hammering the fee quote endpoint on
      // every keystroke. 500ms feels close to "still typing" without
      // adding a noticeable wait once the user stops.
      if (this.feeQuoteDebounceTimer) clearTimeout(this.feeQuoteDebounceTimer);

      if (this.amountSats > 0) {
        this.feeQuoteDebounceTimer = setTimeout(() => this.fetchFeeQuote(), 500);
      } else {
        this.feeQuote = null;
      }
    },

    setMaxAmount() {
      // Conservative max-fee reservation. The real fee gets recalculated
      // once the quote returns; this just gives the user something to
      // commit to with a single tap without the amount field flickering.
      const estimatedMaxFee = 2000;
      const maxSendable = Math.max(0, this.availableBalance - estimatedMaxFee);
      this.displayAmount = maxSendable.toString();
      this.onAmountChange();
    },

    async fetchFeeQuote() {
      if (this.amountSats <= 0) return;

      this.isLoadingFeeQuote = true;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getWithdrawalFeeQuote) {
          throw new Error('Withdrawal not supported');
        }
        this.feeQuote = await provider.getWithdrawalFeeQuote(this.amountSats, this.cleanedAddress);
      } catch (error) {
        console.error('Failed to fetch fee quote:', error);
        const msg = this.getUserFriendlyError(error);
        this.$q.notify({ type: 'negative', message: msg.title, caption: msg.description });
        this.feeQuote = null;
      } finally {
        this.isLoadingFeeQuote = false;
      }
    },

    async executeWithdrawal() {
      if (!this.canSend) {
        this.$refs.slideRef?.reset();
        return;
      }

      this.isSending = true;
      const totalFee = this.selectedFee.totalFee;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.withdrawToL1) throw new Error('Withdrawal not supported');

        const result = await provider.withdrawToL1({
          amountSats: this.amountSats,
          destinationAddress: this.cleanedAddress,
          speed: this.selectedSpeed,
          feeQuoteId: this.selectedFee.feeQuoteId,
          feeAmountSats: totalFee,
          deductFeeFromWithdrawalAmount: false
        });

        // Hand off to the parent: emit once with the request ID and
        // close. The parent owns the post-submission lifecycle (polling,
        // mempool-link toast, balance refresh) so this component can
        // safely unmount the moment the sheet closes — important because
        // the parent's `v-if` typically tears us down right after.
        this.$emit('withdrawal-submitted', {
          requestId: result.requestId,
          amountSats: this.amountSats,
          feeSats: totalFee,
          destinationAddress: this.destinationAddress
        });

        this.show = false;
      } catch (error) {
        console.error('Withdrawal failed:', error);
        const msg = this.getUserFriendlyError(error);
        this.$q.notify({ type: 'negative', message: msg.title, caption: msg.description });
        this.$emit('withdrawal-error', error);
        this.$refs.slideRef?.reset();
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

    /**
     * Map raw provider/network errors to short, user-readable copy.
     * Categories are derived from substring matches on the error
     * message — when nothing matches we fall back to a friendly
     * generic so we never leak stack-trace fragments to users.
     */
    getUserFriendlyError(error) {
      const errorStr = error?.message || error?.toString() || '';
      const errorLower = errorStr.toLowerCase();

      if (errorLower.includes('exceeds available balance') ||
          errorLower.includes('insufficient') ||
          errorLower.includes('not enough')) {
        return {
          title: this.$t('Not enough funds'),
          description: this.$t('The amount plus fees exceeds your balance. Try a smaller amount.')
        };
      }
      if (errorLower.includes('minimum') || errorLower.includes('too small') || errorLower.includes('dust')) {
        return {
          title: this.$t('Amount too small'),
          description: this.$t('Please enter a larger amount to cover network fees.')
        };
      }
      if (errorLower.includes('invalid address') || errorLower.includes('address')) {
        return {
          title: this.$t('Invalid address'),
          description: this.$t('The Bitcoin address appears to be invalid.')
        };
      }
      if (errorLower.includes('network') || errorLower.includes('timeout') ||
          errorLower.includes('connection') || errorLower.includes('fetch')) {
        return {
          title: this.$t('Connection problem'),
          description: this.$t('Please check your internet and try again.')
        };
      }
      if (errorLower.includes('expired') || errorLower.includes('quote')) {
        return {
          title: this.$t('Please try again'),
          description: this.$t("The fee estimate expired. We'll get a fresh one.")
        };
      }
      if (errorLower.includes('not unlocked') || errorLower.includes('enter your pin') || errorLower.includes('pin')) {
        return {
          title: this.$t('Wallet locked'),
          description: this.$t('Please enter your PIN to unlock the wallet.')
        };
      }
      if (errorLower.includes('not supported') || errorLower.includes('provider') ||
          errorLower.includes('not connected') || errorLower.includes('wallet')) {
        return {
          title: this.$t('Wallet not ready'),
          description: this.$t('Please make sure your wallet is unlocked.')
        };
      }
      return {
        title: this.$t('Something went wrong'),
        description: this.$t('Please try again in a moment.')
      };
    }
  },

  beforeUnmount() {
    if (this.feeQuoteDebounceTimer) clearTimeout(this.feeQuoteDebounceTimer);
  }
};
</script>

<style scoped>
/* ─── Surface (mirrors PaymentConfirmSheet) ─── */
.sheet-card {
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

.sheet-card-dark { box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55); }
.sheet-card-light {
  border-top: 1px solid var(--border-card);
  box-shadow: 0 -20px 50px rgba(40, 34, 20, 0.12);
}

.grab-bar {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
  margin: 8px auto 4px;
  flex-shrink: 0;
}

.top-row {
  display: flex;
  align-items: center;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}
.top-btn { width: 36px; height: 36px; color: var(--text-secondary); }
.top-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}
.top-spacer { width: 36px; }

.stage {
  display: flex;
  flex-direction: column;
  padding: 8px 20px 12px;
  gap: 14px;
  overflow-y: auto;
}

/* ─── Recipient ─── */
.recipient {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: var(--bg-input);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
}

.recipient-avatar {
  width: 56px;
  height: 56px;
  min-width: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(247, 147, 26, 0.14);
  color: #F7931A;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.32);
  flex-shrink: 0;
}

.recipient-meta { flex: 1; min-width: 0; }
.recipient-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.recipient-via {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.recipient-via:hover { color: var(--text-primary); }
.recipient-via-chev { transition: transform 0.18s ease; opacity: 0.7; }
.recipient-via-chev.flipped { transform: rotate(180deg); }

.recipient-address {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.45;
}

.fade-collapse-enter-active, .fade-collapse-leave-active {
  transition: opacity 0.16s ease, max-height 0.2s ease;
  overflow: hidden;
  max-height: 200px;
}
.fade-collapse-enter-from, .fade-collapse-leave-to { opacity: 0; max-height: 0; }

/* ─── Amount stage ─── */
.amount-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
  gap: 10px;
}

.amount-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 48px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  caret-color: var(--color-green);
  padding: 0;
}
.amount-input::placeholder { color: var(--text-muted); opacity: 0.45; }

.unit-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  border: none;
  cursor: default;
  opacity: 0.85;
}
.body--light .unit-pill { background: rgba(17, 24, 39, 0.05); }

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

.body--light .speed-recommended { color: #fff; }

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

/* ─── Wallet hint (insufficient balance) ─── */
.wallet-hint {
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
.body--dark .wallet-hint {
  background: rgba(239, 68, 68, 0.14);
  color: #FCA5A5;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.32);
}

/* ─── CTA ─── */
.cta-row { margin-top: 6px; }

@media (max-width: 480px) {
  .stage { padding: 8px 16px 10px; gap: 12px; }
  .recipient { padding: 12px; }
  .recipient-avatar { width: 48px; height: 48px; min-width: 48px; }
  .amount-input { font-size: 40px; }
  .speed-card { padding: 12px 8px 10px; }
  .speed-icon { width: 26px; height: 26px; }
}
</style>
