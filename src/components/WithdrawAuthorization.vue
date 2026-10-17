<template>
  <CardPinPanel
    v-if="visible"
    :amount-display="amountDisplay"
    :fiat-amount="fiatAmount"
    :card-host="cardHost"
    :destination="destination"
    :prompt="prompt || $t('Enter the card PIN')"
    :error-message="error"
    :error-detail="errorDetail"
    :loading="validating"
    :loading-text="$t('Checking PIN…')"
    :timeout-seconds="60"
    @pin-complete="enterPin"
    @timeout="cancel"
  />
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import CardPinPanel from './CardPinPanel.vue';
import { useWalletStore } from '../stores/wallet';
import { formatAmount } from '../utils/amountFormatting.js';
import { fiatRatesService } from '../utils/fiatRates';
import { submitWithdrawCallback } from '../services/lnurlWithdraw.js';

/**
 * Authorizes one card withdrawal: asks for the card's PIN when the amount
 * reaches its pinLimit (LUD-XX), sends the callback, and handles the
 * service's "Invalid PIN" / "Card blocked" answers. Draws the PIN in place
 * (CardPinPanel); the parent decides where, and learns through `active`
 * when the PIN takes over its screen and through `checking` while a typed
 * PIN is with the card's service.
 */
const props = defineProps({
  /** "Into Main" in the wallet; empty at the kiosk. */
  destination: { type: String, default: '' },
  /** Defaults to "Enter the card PIN"; the kiosk asks the customer directly. */
  prompt: { type: String, default: '' },
});
const emit = defineEmits(['update:active', 'update:checking']);

const { proxy } = getCurrentInstance();
const store = useWalletStore();
const visible = ref(false);
const validating = ref(false);
const error = ref('');
const errorDetail = ref('');
const amount = ref(0);
const cardHost = ref('');
const amountDisplay = computed(() => formatAmount(amount.value, store.useBip177Format));
const fiatAmount = computed(() => {
  const currency = store.preferredFiatCurrency || 'USD';
  const rate = store.exchangeRates[currency] || store.exchangeRates[currency.toLowerCase()];
  return rate ? '≈ ' + fiatRatesService.formatFiatAmount(amount.value * rate / 100000000, currency) : '';
});
watch(visible, (active) => emit('update:active', active), { flush: 'sync' });
// While a typed PIN is with the card's service, the PIN screen cannot be
// called back: the parent keeps its cancel out of reach.
watch(() => visible.value && validating.value, (checking) => emit('update:checking', checking), { flush: 'sync' });
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
  try { cardHost.value = new URL(request.callback).host; } catch { cardHost.value = ''; }
  error.value = '';
  errorDetail.value = '';
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
          // Cleared first so the same message twice still reads as new.
          error.value = '';
          errorDetail.value = '';
          await nextTick();
          assertActive();
          const left = 3 - attempts;
          error.value = left === 1
            ? proxy.$t('Wrong PIN. 1 try left.')
            : proxy.$t('Wrong PIN. {n} tries left.', { n: left });
          errorDetail.value = left === 1 ? proxy.$t('Another wrong PIN locks this card.') : '';
          continue;
        }
        if (failure.code === 'CARD_BLOCKED' || (failure.code === 'INVALID_PIN' && attempts >= 3)) {
          throw Object.assign(new Error(proxy.$t('Card blocked: too many incorrect PIN attempts')), { code: 'CARD_BLOCKED' });
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
