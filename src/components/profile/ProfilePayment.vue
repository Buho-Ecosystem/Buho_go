<script setup>
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isNavigationFailure, useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { useWalletStore } from '../../stores/wallet';
import { useProfileInvoice } from '../../composables/useProfileInvoice.js';
import { invoiceAppIntent, invoiceIsUsable, profileAmountSats } from '../../utils/publicProfilePayment.js';
import { isAndroidBrowser } from '../../utils/publicCard.js';
import { fiatRatesService } from '../../utils/fiatRates.js';
import { FIAT_SYMBOLS } from '../../utils/fiatCurrencies.js';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';

const props = defineProps({ address: { type: String, required: true }, name: { type: String, required: true } });
const emit = defineEmits(['invoice-ready']);
const { proxy } = getCurrentInstance();
const t = (key, values) => proxy.$t(key, values);
const router = useRouter();
const walletStore = useWalletStore();
const native = Capacitor.isNativePlatform();
const android = !native && isAndroidBrowser(navigator.userAgent);
const hasWebWallet = computed(() => !native && walletStore.wallets.length > 0);
const { invoice, error, loading, create, invalidate } = useProfileInvoice();
const displayAmount = ref('');
const comment = ref('');
const fiat = ref(false);
const rates = ref({});
const amountInput = ref(null);
const invoiceHeading = ref(null);
const copied = ref(false);
const actionError = ref('');
const now = ref(Date.now());
let clockTimer;
let copyTimer;

// Keep the existing locale-based currency shortcut; sats remain authoritative.
function visitorCurrency() {
  const euro = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
  const currencies = { US: 'USD', GB: 'GBP', CH: 'CHF', JP: 'JPY', CA: 'CAD', AU: 'AUD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', MX: 'MXN', BR: 'BRL', KE: 'KES', ZM: 'ZMW', TZ: 'TZS', ZA: 'ZAR' };
  try {
    const region = new Intl.Locale(navigator.language || 'en-US').maximize().region;
    return euro.includes(region) ? 'EUR' : currencies[region] || 'USD';
  } catch { return 'USD'; }
}
const fiatCode = visitorCurrency();
const rate = computed(() => rates.value[fiatCode] || 0);
const symbol = FIAT_SYMBOLS[fiatCode] || fiatCode;
const amountSats = computed(() => profileAmountSats(displayAmount.value, { fiat: fiat.value, rate: rate.value }));
const amountWidth = computed(() => `${Math.max(displayAmount.value.length, fiat.value ? 4 : 1) + 0.3}ch`);
const conversion = computed(() => {
  if (!amountSats.value || !rate.value) return '';
  return fiat.value
    ? `≈ ${amountSats.value.toLocaleString()} ${t('sats')}`
    : `≈ ${symbol}${(amountSats.value / 100000000 * rate.value).toFixed(2)}`;
});
const usable = computed(() => invoiceIsUsable(invoice.value, now.value));
const paymentUri = computed(() => usable.value ? `lightning:${invoice.value.invoice}` : '');
const appIntent = computed(() => usable.value && android ? invoiceAppIntent(invoice.value.invoice) : '');
const expiresIn = computed(() => {
  const seconds = Math.max(0, Math.ceil(((invoice.value?.expiresAt || 0) - now.value) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});
const qrOptions = getQrOptionsWithSize(224);
const errorText = computed(() => {
  if (!error.value) return '';
  const messages = {
    amount: 'Enter a valid amount in whole sats.',
    minimum: 'Minimum is {n} sats',
    maximum: 'Maximum is {n} sats',
    invalid: 'The invoice did not match this payment. Try again.',
    expired: 'The invoice has expired. Create a new one.',
  };
  return t(messages[error.value.code] || "Couldn't create an invoice. Please try again.", {
    n: error.value.values?.n?.toLocaleString(),
  });
});

// Synchronous invalidation also covers an edit during an outstanding request.
watch([() => props.address, displayAmount, comment, fiat, amountSats], () => {
  invalidate();
  actionError.value = '';
}, { flush: 'sync' });
watch(invoice, value => {
  emit('invoice-ready', !!value);
  clearInterval(clockTimer);
  clearTimeout(copyTimer);
  copied.value = false;
  now.value = Date.now();
  if (value) clockTimer = setInterval(() => { now.value = Date.now(); }, 1000);
});

async function createInvoice() {
  actionError.value = '';
  await create({ address: props.address, amountSats: amountSats.value, comment: comment.value });
  if (invoice.value) {
    await nextTick();
    invoiceHeading.value?.focus();
  } else if (['amount', 'minimum', 'maximum'].includes(error.value?.code)) {
    await nextTick();
    amountInput.value?.focus();
  }
}

async function editInvoice() {
  invalidate();
  actionError.value = '';
  await nextTick();
  amountInput.value?.focus();
}

function checkInvoice(event) {
  // Timers can be suspended while another app is open. Check the real clock
  // inside each user action so an expired invoice never escapes on return.
  now.value = Date.now();
  if (invoiceIsUsable(invoice.value)) return true;
  event?.preventDefault();
  return false;
}

function openWallet(event) {
  if (!checkInvoice(event)) return;
  if (native) {
    event.preventDefault();
    payHere();
  }
  // A real anchor activated by the user's tap keeps the browser's app-opening
  // gesture. No async request, forced navigation or success timer belongs here.
}

async function payHere() {
  if (!checkInvoice()) return;
  if (!walletStore.activeWallet) {
    actionError.value = t('Please set up a wallet first');
    return;
  }
  const payment = { type: 'lightning_invoice', data: invoice.value.invoice };
  walletStore.pendingDeepLink = payment;
  try {
    const result = await router.push('/wallet');
    if (isNavigationFailure(result)) throw result;
  } catch {
    if (walletStore.pendingDeepLink?.data === payment.data) walletStore.pendingDeepLink = null;
    actionError.value = t("Couldn't open the wallet. You can copy the invoice instead.");
  }
}

async function copyInvoice() {
  if (!checkInvoice()) return;
  actionError.value = '';
  const current = invoice.value;
  try {
    if (native) {
      const { Clipboard } = await import('@capacitor/clipboard');
      if (invoice.value !== current || !checkInvoice()) return;
      await Clipboard.write({ string: current.invoice });
    } else {
      await navigator.clipboard.writeText(current.invoice);
    }
    if (invoice.value !== current) return;
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 2000);
  } catch { actionError.value = t("Couldn't copy"); }
}

function refreshClock() { now.value = Date.now(); }
onMounted(() => {
  document.addEventListener('visibilitychange', refreshClock);
  fiatRatesService.ensureRatesLoaded()
    .then(() => fiatRatesService.getRates())
    .then(value => { rates.value = value || {}; })
    .catch(() => {});
});
onBeforeUnmount(() => {
  clearInterval(clockTimer);
  clearTimeout(copyTimer);
  document.removeEventListener('visibilitychange', refreshClock);
});
</script>

<template>
  <section class="profile-payment">
    <form v-if="!invoice" class="payment-form" @submit.prevent="createInvoice">
      <div class="payment-amount-area">
        <label class="payment-label" for="profile-payment-amount">{{ t('Amount to send') }}</label>
        <div class="payment-amount-wrap">
          <input
            id="profile-payment-amount" ref="amountInput" v-model="displayAmount"
            class="payment-amount" :class="{ 'payment-amount-long': displayAmount.length > 6 }"
            :style="{ width: amountWidth }" type="text" :inputmode="fiat ? 'decimal' : 'numeric'"
            :placeholder="fiat ? '0.00' : '0'" maxlength="12" autocomplete="off"
            :aria-label="t('Amount in {currency}', { currency: fiat ? fiatCode : t('sats') })"
            :aria-invalid="['amount', 'minimum', 'maximum'].includes(error?.code)" aria-describedby="profile-payment-error"
          />
          <span class="payment-unit">{{ fiat ? symbol : t('sats') }}</span>
        </div>
        <button v-if="rate" type="button" class="payment-currency" :aria-label="t('Switch to {currency}', { currency: fiat ? 'SATS' : fiatCode })" @click="fiat = !fiat; displayAmount = ''">
          {{ fiat ? fiatCode : 'SATS' }} <Icon icon="tabler:arrows-exchange" width="14" />
        </button>
        <p class="payment-conversion">{{ conversion || ' ' }}</p>
      </div>
      <label for="profile-payment-note" class="payment-note-label">{{ t('Note (optional)') }}</label>
      <div class="payment-note">
        <Icon icon="tabler:message-circle" width="18" />
        <input id="profile-payment-note" v-model="comment" type="text" :placeholder="t('Add a note')" maxlength="150" />
      </div>
      <p id="profile-payment-error" class="payment-error" role="alert">{{ errorText }}</p>
      <button type="submit" class="payment-primary" :disabled="loading" :aria-busy="loading">
        <q-spinner v-if="loading" size="18px" />
        <Icon v-else icon="tabler:qrcode" width="19" />
        {{ loading ? t('Creating invoice…') : t('Create invoice') }}
      </button>
      <p class="payment-hint">{{ t('Choose your wallet in the next step.') }}</p>
    </form>

    <template v-else>
      <button type="button" class="payment-edit" @click="editInvoice">
        <Icon icon="tabler:chevron-left" width="16" /> {{ t('Edit amount') }}
      </button>
      <div class="payment-invoice">
        <p class="payment-label">{{ t('Invoice for {name}', { name }) }}</p>
        <h2 ref="invoiceHeading" class="payment-total" tabindex="-1">{{ invoice.amountSats.toLocaleString() }} <span>{{ t('sats') }}</span></h2>
        <p class="payment-address">{{ invoice.address }}</p>
        <div v-if="usable" class="payment-qr">
          <vue-qrcode :value="paymentUri.toUpperCase()" :options="qrOptions" role="img" :aria-label="t('Lightning invoice QR code')" />
        </div>
        <div v-else class="payment-expired" role="status">
          <Icon icon="tabler:clock-off" width="32" />
          <p>{{ t('The invoice has expired. Create a new one.') }}</p>
        </div>
        <p v-if="usable" class="payment-expiry">{{ t('Expires in {time}', { time: expiresIn }) }}</p>
        <p v-if="invoice.comment" class="payment-comment">{{ invoice.comment }}</p>
        <p v-if="invoice.noteChanged" class="payment-hint">{{ invoice.comment ? t('Your note was shortened to fit the recipient’s limit.') : t('This recipient does not accept notes.') }}</p>
        <button v-if="usable" type="button" class="payment-copy" @click="copyInvoice">
          <Icon :icon="copied ? 'tabler:check' : 'tabler:copy'" width="16" />
          <span aria-live="polite">{{ copied ? t('Copied') : t('Copy invoice') }}</span>
        </button>
      </div>
      <div class="payment-wallet-actions">
        <template v-if="usable">
          <a class="payment-primary" :href="paymentUri" data-pay="wallet" @click="openWallet">
            <Icon icon="tabler:wallet" width="19" /> {{ native ? t('Pay with BuhoGO') : t('Pay in wallet') }}
          </a>
          <a v-if="appIntent" class="payment-secondary" :href="appIntent" data-pay="app" @click="checkInvoice">
            <img src="/buho_logo.svg" width="18" height="18" alt="" /> {{ t('Pay with BuhoGO') }}
          </a>
          <p class="payment-hint">{{ t('You confirm the payment in your wallet.') }}</p>
          <button v-if="hasWebWallet" type="button" class="payment-browser" @click="payHere">{{ t('Pay with browser wallet') }}</button>
        </template>
        <button v-else type="button" class="payment-primary" @click="createInvoice">{{ t('Create new invoice') }}</button>
        <p v-if="actionError" class="payment-error" role="alert">{{ actionError }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profile-payment, .payment-form { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.profile-payment { color: #1c1b18; }
.profile-payment button, .profile-payment a, .profile-payment input { font-family: inherit; }
.profile-payment button, .profile-payment a { -webkit-tap-highlight-color: transparent; }
.profile-payment button:focus-visible, .profile-payment a:focus-visible, .profile-payment input:focus-visible { outline: 2px solid #059573; outline-offset: 4px; }
.payment-amount-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 0; }
.payment-label { font-size: 13px; font-weight: 600; color: #6b665c; margin: 0 0 10px; text-align: center; }
.payment-amount-wrap { display: flex; align-items: baseline; justify-content: center; gap: 8px; max-width: 100%; }
.payment-amount { max-width: 270px; min-width: 0; border: 0; background: transparent; text-align: center; color: #1c1b18; font-size: 56px; font-weight: 800; letter-spacing: -.035em; font-variant-numeric: tabular-nums; padding: 0; }
.payment-amount-long { font-size: 38px; }
.payment-amount::placeholder { color: #6b665c; opacity: 1; }
.payment-unit { font-size: 18px; font-weight: 700; color: #6b665c; }
.payment-currency { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 24px; border: 0; background: #eeebe3; color: inherit; font-weight: 700; margin-top: 12px; cursor: pointer; }
.payment-conversion { font-size: 13px; color: #6b665c; margin: 8px 0 0; }
.payment-note { display: flex; align-items: center; gap: 10px; background: #eeebe3; padding: 0 14px; min-height: 48px; border-radius: 14px; color: #6b665c; }
.payment-note-label { font-size: 13px; font-weight: 600; color: #6b665c; margin: 0 0 8px; }
.payment-note input { flex: 1; min-width: 0; min-height: 48px; border: 0; background: transparent; color: #1c1b18; font-size: 16px; }
.payment-note input::placeholder { color: #6b665c; opacity: 1; }
.payment-error { font-size: 13px; line-height: 1.5; color: #9b3028; margin: 10px 0; }
.payment-error:empty { margin: 5px 0; }
.payment-primary, .payment-secondary { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; padding: 12px 18px; border: 0; border-radius: 26px; font-size: 16px; font-weight: 750; line-height: 1.4; text-align: center; text-decoration: none; cursor: pointer; }
.payment-primary { background: #1a1a1c; color: #faf7ef; }
.payment-primary:disabled { opacity: .65; cursor: wait; }
.payment-secondary { background: #eeebe3; color: #1c1b18; margin-top: 10px; }
.payment-hint { color: #6b665c; font-size: 12px; text-align: center; line-height: 1.5; margin: 10px 0 0; }
.payment-edit { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; min-height: 44px; border: 0; padding: 0; margin-top: 8px; background: transparent; color: #6b665c; font-size: 13px; cursor: pointer; }
.payment-invoice { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 0 20px; }
.payment-total { font-size: 34px; font-weight: 800; line-height: 1.2; letter-spacing: -.035em; margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: center; }
.payment-total span { font-size: 18px; font-weight: 600; color: #6b665c; letter-spacing: normal; }
.payment-total:focus { outline: none; }
.payment-address { font-size: 12px; color: #6b665c; margin: 8px 0 20px; overflow-wrap: anywhere; text-align: center; }
.payment-qr { width: 256px; max-width: 100%; padding: 16px; background: #fff; border: 1px solid #e4dfd4; border-radius: 18px; }
/* qrcode writes pixel dimensions inline; retain the aspect ratio when the
   available width is smaller, and leave a full quiet zone around the code. */
.payment-qr :deep(canvas) { display: block; max-width: 100%; height: auto !important; }
.payment-expiry { font-size: 12px; color: #6b665c; margin: 12px 0 0; font-variant-numeric: tabular-nums; }
.payment-comment { font-size: 13px; color: #6b665c; margin: 8px 0 0; text-align: center; overflow-wrap: anywhere; }
.payment-copy { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 44px; padding: 0 12px; margin-top: 4px; background: transparent; border: 0; color: #1c1b18; font-size: 13px; font-weight: 650; cursor: pointer; }
.payment-browser { display: block; margin: 4px auto 0; min-height: 44px; padding: 0 12px; border: 0; background: transparent; color: #6b665c; text-decoration: underline; text-underline-offset: 3px; font-size: 12px; cursor: pointer; }
.payment-expired { display: flex; flex-direction: column; align-items: center; justify-content: center; max-width: 256px; min-height: 160px; text-align: center; color: #6b665c; font-size: 14px; line-height: 1.5; }
.payment-wallet-actions { flex: 0 0 auto; }
@media (max-width: 350px) { .payment-amount-long { font-size: 30px; } .payment-total { font-size: 30px; } }
</style>
