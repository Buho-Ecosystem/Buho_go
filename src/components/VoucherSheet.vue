<!--
  LUD-14 vouchers: saved withdraw links that still hold money.

  Opened from the Receive sheet's one-line summary. The list and everything
  that manages it live here, so the receive flow itself stays a receive flow.

  Rules of the surface:
    - every row is ONE native button: tap sweeps what is left through the
      wallet page's dispatcher (the same path a scanned code takes), Enter
      does exactly the same and nothing else
    - the store re-checks stale vouchers when this sheet opens; a row shows
      "Checking…" meanwhile and there is no refresh control anywhere
    - Edit turns the trailing disclosure into a destructive Remove; the
      wallet page asks before forgetting, because the URL is the bearer
      right to the money and a rotating service may no longer honour the
      paper code
    - a failed check is said in words next to the last known figure; only
      an empty answer from the service makes a voucher leave the list
-->
<template>
  <q-card
    class="voucher-sheet"
    :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
  >
    <div class="sheet-handle" aria-hidden="true">
      <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
    </div>

    <div class="sheet-header">
      <q-btn
        flat
        round
        class="sheet-close"
        :aria-label="$t('Back')"
        ref="backButton"
        @click="$emit('back')"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
        {{ $t('Vouchers') }}
      </div>
      <button
        v-if="vouchers.length"
        type="button"
        class="sheet-edit"
        :aria-pressed="editing ? 'true' : 'false'"
        @click="editing = !editing"
      >
        {{ editing ? $t('Done') : $t('Edit') }}
      </button>
      <span v-else class="sheet-edit-spacer" aria-hidden="true"></span>
    </div>

    <div class="sheet-body">
      <ul v-if="vouchers.length" class="voucher-list">
        <li v-for="voucher in vouchers" :key="voucher.id" class="voucher-item">
          <button
            v-if="!editing"
            type="button"
            class="voucher-row"
            :disabled="isChecking(voucher) || voucher.maxSats < 1"
            :aria-busy="isChecking(voucher) ? 'true' : 'false'"
            @click="$emit('redeem', voucher)"
          >
            <span class="voucher-icon" aria-hidden="true">
              <Icon icon="tabler:ticket" width="18" height="18" />
            </span>
            <span class="voucher-copy">
              <strong class="voucher-title">{{ voucher.title || voucher.domain }}</strong>
              <small class="voucher-sub">{{ secondary(voucher) }}</small>
            </span>
            <q-spinner v-if="isChecking(voucher)" size="16px" class="voucher-trailing" aria-hidden="true" />
            <Icon v-else icon="tabler:chevron-right" width="18" height="18" class="voucher-trailing" aria-hidden="true" />
          </button>

          <div v-else class="voucher-row voucher-row--editing">
            <span class="voucher-icon" aria-hidden="true">
              <Icon icon="tabler:ticket" width="18" height="18" />
            </span>
            <span class="voucher-copy">
              <strong class="voucher-title">{{ voucher.title || voucher.domain }}</strong>
              <small class="voucher-sub">{{ secondary(voucher) }}</small>
            </span>
            <button
              type="button"
              class="voucher-remove"
              :aria-label="$t('Remove') + ' ' + (voucher.title || voucher.domain)"
              @click="$emit('remove', voucher)"
            >
              {{ $t('Remove') }}
            </button>
          </div>
        </li>
      </ul>

      <p v-else class="voucher-empty">{{ $t('No vouchers saved.') }}</p>

      <p class="voucher-foot">
        {{ $t('BuhoGO checks these when you open this list. Tap one to receive what is left.') }}
      </p>
    </div>
  </q-card>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { formatAmount } from '../utils/amountFormatting.js';

export default {
  name: 'VoucherSheet',
  components: { Icon },

  props: {
    /** withdrawVouchers store `active`: newest first, nothing exhausted. */
    vouchers: { type: Array, default: () => [] },
    /** id → true while the store is re-checking that voucher. */
    checking: { type: Object, default: () => ({}) },
    /** withdrawVouchers store `displaySats` getter (currentBalance first). */
    displaySats: { type: Function, default: (voucher) => voucher?.maxSats || 0 },
  },

  emits: ['back', 'redeem', 'remove'],

  setup() {
    return { walletStore: useWalletStore() };
  },

  data() {
    return { editing: false };
  },

  mounted() {
    this.$refs.backButton?.$el.focus();
  },

  watch: {
    // Removing the last voucher leaves nothing to edit.
    'vouchers.length'(count) {
      if (!count) this.editing = false;
    },
  },

  methods: {
    isChecking(voucher) {
      return !!this.checking?.[voucher.id];
    },

    amount(voucher) {
      return formatAmount(this.displaySats(voucher), this.walletStore.useBip177Format);
    },

    /** The one line under the title: a figure, or the reason there is none. */
    secondary(voucher) {
      if (this.isChecking(voucher)) return this.$t('Checking…');
      const error = voucher.lastError;
      if (error?.kind === 'service' && error.reason) {
        return this.$t('Last known {amount} · {reason}', { amount: this.amount(voucher), reason: error.reason });
      }
      if (error) {
        return this.$t("Last known {amount} · couldn't check", { amount: this.amount(voucher) });
      }
      if (voucher.maxSats < 1) {
        return this.$t('{amount} left · temporarily unavailable', { amount: this.amount(voucher) });
      }
      return this.$t('{amount} left', { amount: this.amount(voucher) });
    },
  },
};
</script>

<style scoped>
.voucher-sheet {
  width: 100%;
  max-width: 560px;
  max-height: 90dvh;
  overflow-y: auto;
  margin: 0 auto;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
}

.sheet-handle span {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  display: block;
}

.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark  { background: rgba(255, 255, 255, 0.22); }

.sheet-header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 0 12px 10px;
}

.sheet-close {
  width: 44px;
  height: 44px;
}

.sheet-title {
  text-align: center;
  overflow-wrap: anywhere;
  font-family: 'Manrope', sans-serif;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.005em;
}

.sheet-edit {
  justify-self: end;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 4px;
  border: 0;
  background: none;
  font: 700 0.9375rem/1.3 'Manrope', sans-serif;
  color: var(--brand-accent-text);
  cursor: pointer;
  white-space: nowrap;
}

.sheet-edit-spacer {
  width: 44px;
  height: 44px;
}

.sheet-body {
  padding: 0 16px 4px;
}

.voucher-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voucher-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 8px 12px;
  border: 1px solid var(--border-card);
  border-radius: 16px;
  background: var(--bg-card);
  color: var(--text-primary);
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.voucher-row:disabled {
  cursor: default;
}

.voucher-row:not(:disabled):active {
  opacity: 0.85;
}

.voucher-row:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
}

.voucher-row--editing {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  cursor: default;
}

.voucher-row--editing .voucher-remove {
  grid-column: 2;
  justify-self: start;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.voucher-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
}

.voucher-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.voucher-title {
  font: 700 0.9375rem/1.3 'Manrope', sans-serif;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.voucher-sub {
  font: 0.8125rem/1.3 'Manrope', sans-serif;
  color: var(--text-secondary);
}

.voucher-trailing {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.voucher-remove {
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 6px;
  border: 0;
  background: none;
  font: 700 0.9375rem/1.3 'Manrope', sans-serif;
  color: #C43D2F;
  cursor: pointer;
}

.body--dark .voucher-remove {
  color: #FF6B5B;
}

.voucher-remove:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  border-radius: 8px;
}

.voucher-empty,
.voucher-foot {
  font: 0.78125rem/1.45 'Manrope', sans-serif;
  color: var(--text-secondary);
  text-align: center;
  margin: 0;
  padding: 12px 8px 4px;
}

.voucher-empty {
  font-size: 0.875rem;
  padding-top: 18px;
}
/* Give the title its own line on narrow phones; enlarged action labels
   must not squeeze it into a column of individual syllables. */
@media (max-width: 380px) {
  .sheet-title { grid-column: 1 / -1; grid-row: 2; }
  .sheet-close { grid-column: 1; grid-row: 1; }
  .sheet-edit, .sheet-edit-spacer { grid-column: 3; grid-row: 1; }
}
</style>
