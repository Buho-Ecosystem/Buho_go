<!--
  IncomingPaymentHost: tells the user about Bitcoin that arrives while they
  are in the app without having asked for it, such as a payment to their
  Lightning address. services/incomingPayments.js decides where:

    Home, nothing open    the "Bitcoin received" screen (PaymentConfirmation)
    anywhere else         a toast at the bottom; a tap opens the payment in
                          Transaction details, a swipe dismisses it

  Payments to the same wallet in a row add up on what is already showing.
  Mounted once, in App.vue.
-->
<template>
  <PaymentConfirmation
    v-model="screenOpen"
    :amount="screenSats"
    :fiat-amount="fiatText(screenSats)"
    @closed="onScreenClosed"
  />
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import PaymentConfirmation from './PaymentConfirmation.vue';
import { useWalletStore } from '../stores/wallet';
import { i18n } from '../boot/i18n.js';
import { formatAmount } from '../utils/amountFormatting.js';
import { fiatRatesService } from '../utils/fiatRates.js';
import { haptics } from '../utils/haptics.js';
import {
  incomingSurface,
  shownByReceive,
  transactionRoute,
  findReceivedTransactionId,
} from '../services/incomingPayments.js';

const props = defineProps({
  /** True while the app lock covers the screen: nothing is shown behind it. */
  suspended: { type: Boolean, default: false },
});

const TOAST_TIMEOUT_MS = 4000;
/** How far back a balance-based payment is looked for in its wallet's history. */
const LOOKBACK_MS = 15 * 60 * 1000;

const walletStore = useWalletStore();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const t = (key, values) => i18n.global.t(key, values);

/**
 * What is showing now: { kind: 'screen'|'toast', walletId, sats, count,
 * paymentId, firstAt, update? }. A plain object, compared by identity.
 */
let current = null;
const screenOpen = ref(false);
const screenSats = ref(0);

watch(() => walletStore.lastReceipt, announce);

function announce(receipt) {
  if (props.suspended || !receipt?.walletId || !(receipt.amountSats > 0)) return;
  if (shownByReceive(receipt)) return;
  const surface = incomingSurface({
    path: route.path,
    dialogOpen: !!document.querySelector('.q-dialog[aria-modal="true"]'),
    kiosk: route.path.startsWith('/kiosk') || walletStore.isKioskRestricted,
    settledWhileAway: !!receipt.settledWhileAway,
  });
  if (!surface) return;
  haptics.success();

  if (current && current.walletId === receipt.walletId) {
    current.sats += receipt.amountSats;
    current.count += 1;
    if (current.kind === 'screen') screenSats.value = current.sats;
    else current.update?.(toastConfig(current));
    return;
  }

  const entry = {
    kind: surface,
    walletId: receipt.walletId,
    sats: receipt.amountSats,
    count: 1,
    paymentId: receipt.paymentId || null,
    firstAt: receipt.at || Date.now(),
  };
  current = entry;
  if (surface === 'screen') {
    screenSats.value = entry.sats;
    screenOpen.value = true;
  } else {
    entry.update = $q.notify(toastConfig(entry));
  }
}

function toastConfig(entry) {
  const wallet = walletStore.wallets.find((w) => w.id === entry.walletId);
  return {
    type: 'positive',
    message: t('Bitcoin received'),
    caption: t('{amount} · {wallet}', {
      amount: formatAmount(entry.sats, walletStore.useBip177Format),
      wallet: wallet?.name || t('your wallet'),
    }),
    position: 'bottom',
    timeout: TOAST_TIMEOUT_MS,
    // Updated in place when the next payment to this wallet arrives.
    group: false,
    openLabel: t('Show payment'),
    onOpen: () => openPayment(entry),
    onDismiss: () => { if (current === entry) current = null; },
  };
}

/** One payment opens in Transaction details; several open History. */
async function openPayment(entry) {
  if (entry.count > 1) return router.push('/transactions');
  if (entry.paymentId) return router.push(transactionRoute(entry.walletId, entry.paymentId));
  const wallet = walletStore.wallets.find((w) => w.id === entry.walletId);
  const id = await findReceivedTransactionId({
    wallet,
    provider: walletStore.providers?.[entry.walletId],
    amountSats: entry.sats,
    sinceMs: entry.firstAt - LOOKBACK_MS,
  }).catch(() => null);
  return router.push(id ? transactionRoute(entry.walletId, id) : '/transactions');
}

function onScreenClosed() {
  if (current?.kind === 'screen') current = null;
}

function fiatText(sats) {
  if (!(sats > 0)) return '';
  const code = walletStore.preferredFiatCurrency || 'USD';
  const value = fiatRatesService.convertSatsToFiatSync(sats, code);
  return value == null ? '' : fiatRatesService.formatFiatAmount(value, code);
}
</script>
