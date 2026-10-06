<template>
  <PinEntryDialog
    :model-value="visible"
    :title="$t('Bolt Card PIN')"
    :subtitle="$t('Enter your 4-digit PIN to confirm this withdrawal')"
    :amount-display="amountDisplay"
    :fiat-amount="fiatAmount"
    :pin-length="4"
    mode="enter"
    :show-back-button="true"
    :error-message="error"
    :loading="validating"
    :loading-text="$t('Authorizing…')"
    :timeout-seconds="60"
    @pin-complete="enterPin"
    @cancel="cancel"
    @timeout="cancel"
  />
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref } from 'vue';
import PinEntryDialog from './PinEntryDialog.vue';
import { useWalletStore } from '../stores/wallet';
import { formatAmount } from '../utils/amountFormatting.js';
import { fiatRatesService } from '../utils/fiatRates';
import { submitWithdrawCallback } from '../services/lnurlWithdraw.js';

const { proxy } = getCurrentInstance();
const store = useWalletStore();
const visible = ref(false);
const validating = ref(false);
const error = ref('');
const amount = ref(0);
const amountDisplay = computed(() => formatAmount(amount.value, store.useBip177Format));
const fiatAmount = computed(() => {
  const currency = store.preferredFiatCurrency || 'USD';
  const rate = store.exchangeRates[currency] || store.exchangeRates[currency.toLowerCase()];
  return rate ? '≈ ' + fiatRatesService.formatFiatAmount(amount.value * rate / 100000000, currency) : '';
});
let session = null;
let resolvePin = null;

function enterPin(pin) {
  const resolve = resolvePin;
  resolvePin = null;
  resolve?.(pin);
}
function cancel() {
  session?.abort();
  enterPin(null);
  visible.value = false;
}
onBeforeUnmount(cancel);

/** Used by both wallet and kiosk, with the exact invoice chosen by the caller. */
async function submit(request, invoice, amountSats, { signal } = {}) {
  if (session) throw new Error('Withdrawal already in progress');
  const controller = new AbortController();
  session = controller;
  const abort = () => cancel();
  signal?.addEventListener('abort', abort, { once: true });
  const assertActive = () => {
    if (signal?.aborted || controller.signal.aborted) throw new DOMException('Withdrawal cancelled', 'AbortError');
  };
  amount.value = amountSats;
  error.value = '';
  let attempts = 0;
  try {
    assertActive();
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0 || amountSats * 1000 < request.minWithdrawable || amountSats * 1000 > request.maxWithdrawable) {
      throw new Error('Invalid amount');
    }
    const requiresPin = request.pinLimit && amountSats * 1000 >= request.pinLimit;
    while (true) {
      let pin = null;
      if (requiresPin) {
        visible.value = true;
        validating.value = false;
        pin = await new Promise(resolve => { resolvePin = resolve; });
        assertActive();
        if (!pin) throw new DOMException('Withdrawal cancelled', 'AbortError');
      }
      validating.value = true;
      try {
        assertActive();
        await submitWithdrawCallback(request, invoice, pin, { signal: controller.signal });
        assertActive();
        return;
      } catch (failure) {
        assertActive();
        if (requiresPin && failure.code === 'INVALID_PIN' && ++attempts < 3) {
          error.value = '';
          await nextTick();
          assertActive();
          error.value = attempts === 2
            ? proxy.$t('Invalid PIN. Last attempt.')
            : proxy.$t('Invalid PIN. {n} attempts left.', { n: 3 - attempts });
          continue;
        }
        if (failure.code === 'CARD_BLOCKED' || (failure.code === 'INVALID_PIN' && attempts >= 3)) {
          throw new Error(proxy.$t('Card blocked: too many incorrect PIN attempts'));
        }
        throw failure;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    visible.value = false;
    validating.value = false;
    resolvePin = null;
    session = null;
  }
}
defineExpose({ submit, cancel });
</script>
