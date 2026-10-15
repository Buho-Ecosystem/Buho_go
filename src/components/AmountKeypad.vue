<!--
  AmountKeypad: the in-app amount entry used where someone types an amount
  to receive or to request (ReceiveModal, chat/RequestSheet).

  The typed amount sits large on top; the other unit sits underneath, and
  tapping it swaps which one is typed (sats or the preferred fiat currency).
  The default slot sits between the amount and the keys (a note, a
  description). Below, a 3x4 keypad: 000 in sats, a decimal point in fiat,
  and backspace.

  Controlled: the raw value and the unit are v-models (`modelValue`,
  `fiat`), so the parent decides when to clear them. The rules live in
  utils/amountKeypad.js.
-->
<template>
  <div class="amount-keypad">
    <div class="amount-keypad__content" :class="{ 'amount-keypad__content--scroll': scrollContent }">
    <div class="amount-keypad__amount">
      <div
        class="amount-keypad__primary"
        :class="{ 'amount-keypad__primary--empty': sats === 0 }"
        :style="{ fontSize: primaryFontSize }"
        aria-live="polite"
      >
        {{ primary }}<span v-if="!fiat" class="amount-keypad__suffix">sats</span>
      </div>
      <button
        type="button"
        class="amount-keypad__secondary"
        :disabled="disabled || !fiatRate"
        :aria-label="fiatRate ? $t('Enter the amount in {unit}', { unit: otherUnit }) : undefined"
        @click="swap"
      >
        <span>{{ secondary }}</span>
        <Icon v-if="fiatRate" icon="tabler:arrows-up-down" width="16" height="16" class="amount-keypad__swap" />
      </button>
    </div>

    <slot />
    </div>

    <div class="amount-keypad__keys">
      <button
        v-for="key in keys"
        :key="key"
        type="button"
        class="amount-keypad__key"
        :disabled="disabled"
        :aria-label="key === 'del' ? $t('Delete') : undefined"
        @click="tap(key)"
      >
        <Icon v-if="key === 'del'" icon="tabler:backspace" width="22" height="22" />
        <template v-else>{{ key === '.' ? decimalSeparator : key }}</template>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { applyKeypadKey, groupFiatInput, keypadSats, satsToFiat, swapKeypadUnit } from '../utils/amountKeypad.js';
import { fiatSymbol as fiatSymbolFor } from '../utils/fiatCurrencies.js';
import { fiatRatesService } from '../utils/fiatRates.js';

const props = defineProps({
  /** The raw typed value, in the unit `fiat` names. */
  modelValue: { type: String, default: '' },
  /** True while the amount is typed in fiat. */
  fiat: { type: Boolean, default: false },
  /** Lower-case currency code for the fiat side, e.g. 'eur'. */
  fiatCode: { type: String, default: 'usd' },
  /** Fiat per bitcoin; 0 when unknown, which leaves sats only. */
  fiatRate: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
  scrollContent: { type: Boolean, default: false },
  locale: { type: String, default: '' },
  /** Optional canonical amount: display rounding must not change an assigned share. */
  exactSats: { type: Number, default: null },
});
const emit = defineEmits(['update:modelValue', 'update:fiat', 'edit', 'swap-unit']);

const sats = computed(() => props.exactSats ?? keypadSats(props.modelValue, { fiat: props.fiat, rate: props.fiatRate }));
const keys = computed(() => ['1', '2', '3', '4', '5', '6', '7', '8', '9', props.fiat ? '.' : '000', '0', 'del']);
const fiatLabel = computed(() => props.fiatCode.toUpperCase());
const otherUnit = computed(() => (props.fiat ? 'sats' : fiatLabel.value));
const numberLocale = computed(() => props.locale || 'en-US');
const decimalSeparator = computed(() => new Intl.NumberFormat(numberLocale.value).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.');

const primary = computed(() => (props.fiat
  ? `${fiatSymbolFor(props.fiatCode)}${groupFiatInput(props.modelValue, numberLocale.value)}`
  : (props.exactSats !== null ? sats.value.toLocaleString(numberLocale.value) : props.modelValue ? Number(props.modelValue).toLocaleString(numberLocale.value) : '0')));

const secondary = computed(() => {
  if (props.fiat) return `${sats.value.toLocaleString(numberLocale.value)} sats`;
  // No rate is "unknown", never a zero value.
  if (!props.fiatRate) return '--';
  const amount = satsToFiat(sats.value, props.fiatRate);
  return props.locale ? new Intl.NumberFormat(props.locale, { style: 'currency', currency: fiatLabel.value }).format(amount)
    : fiatRatesService.formatFiatAmount(amount, props.fiatCode);
});

/**
 * The typed amount always fits on one line: 44px holds about eleven
 * characters on a 360px phone; past that the size steps down with the length.
 */
const primaryFontSize = computed(() => {
  const chars = primary.value.length + (props.fiat ? 0 : 3);
  return chars <= 11 ? '44px' : `${Math.max(22, Math.floor((44 * 11) / chars))}px`;
});

function tap(key) {
  if (props.disabled) return;
  emit('edit');
  emit('update:modelValue', applyKeypadKey(props.modelValue, key, { fiat: props.fiat }));
}

function swap() {
  if (props.disabled) return;
  const swapped = swapKeypadUnit(props.modelValue, { fiat: props.fiat, rate: props.fiatRate });
  if (!swapped) return;
  if (props.exactSats !== null) swapped.value = swapped.fiat ? satsToFiat(sats.value, props.fiatRate).toFixed(2) : String(sats.value);
  emit('swap-unit');
  emit('update:modelValue', swapped.value);
  emit('update:fiat', swapped.fiat);
}
</script>

<style scoped>
.amount-keypad {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding-top: 0.5rem;
}

.amount-keypad__amount {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 0 0.5rem;
}
.amount-keypad__content {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.amount-keypad__content--scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  gap: 6px;
}
.amount-keypad__key:disabled {
  opacity: 0.4;
  cursor: default;
}

.amount-keypad__primary {
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 1rem;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.4rem;
  font: 700 44px/1 'Manrope', sans-serif;
  letter-spacing: -0.02em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  transition: font-size 0.12s ease;
}
.amount-keypad__primary--empty { opacity: 0.35; }

.amount-keypad__suffix {
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 0;
  opacity: 0.6;
}

.amount-keypad__secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0 0.8rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font: 500 15px 'Manrope', sans-serif;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}
.amount-keypad__secondary:disabled { cursor: default; }
.amount-keypad__secondary:not(:disabled):active { background: rgba(128, 128, 128, 0.12); }
.amount-keypad__swap { opacity: 0.6; }

.amount-keypad__keys {
  width: 100%;
  max-width: 360px;
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  padding-bottom: 0.5rem;
}

.amount-keypad__key {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.04);
  color: #1A1A1A;
  font: 600 26px 'Manrope', sans-serif;
  letter-spacing: -0.01em;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.12s ease, transform 0.08s ease;
}
.amount-keypad__key:active { transform: scale(0.96); background: rgba(0, 0, 0, 0.09); }
body.body--dark .amount-keypad__key { background: rgba(255, 255, 255, 0.06); color: #FFFFFF; }
body.body--dark .amount-keypad__key:active { background: rgba(255, 255, 255, 0.12); }

button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }

@media (max-width: 360px) {
  .amount-keypad__suffix { font-size: 15px; }
  .amount-keypad__key { height: 52px; font-size: 22px; }
}
</style>
