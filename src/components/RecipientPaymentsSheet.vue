<!--
  RecipientPaymentsSheet: how often and how much was paid to one recipient,
  opened from a receipt (its To row, or More options). Two figures, the
  payments by month (each opens its receipt, this one marked), and Pay again.
  The list comes from services/recipientPayments, across every wallet.
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)" @show="load">
    <section class="payments-sheet" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <header class="payments-sheet__head">
        <div class="payments-sheet__title">
          <h2 :id="titleId">{{ name }}</h2>
          <p v-if="addressLine" class="payments-sheet__address">{{ addressLine }}</p>
        </div>
        <button type="button" class="payments-sheet__done" @click="$emit('update:modelValue', false)">{{ $t('Done') }}</button>
      </header>

      <div v-if="loading && !payments.length" class="payments-sheet__loading">
        <q-skeleton type="rect" height="76px" class="payments-sheet__skeleton" />
        <q-skeleton v-for="n in 3" :key="n" type="text" height="44px" />
      </div>

      <template v-else>
        <div class="payments-stats">
          <div class="payments-stat">
            <strong><HiddenAmount>{{ formatAmount(summary.totalSats, walletStore.useBip177Format) }}</HiddenAmount></strong>
            <span class="payments-stat__label">{{ $t(complete ? 'Sent in total' : 'Sent recently') }}<template v-if="totalFiat"> · ≈ <HiddenAmount>{{ totalFiat }}</HiddenAmount></template></span>
          </div>
          <div class="payments-stat">
            <strong>{{ summary.count.toLocaleString() }}</strong>
            <span class="payments-stat__label">{{ countLabel }}</span>
          </div>
        </div>

        <div v-for="month in months" :key="month.label">
          <h3 v-if="month.label" class="payments-sheet__label">{{ month.label }}</h3>
          <ul class="payments-list">
            <li v-for="payment in month.payments" :key="payment.sourceKey">
              <button
                type="button"
                class="payments-row"
                :class="{ 'payments-row--current': isCurrent(payment) }"
                :aria-current="isCurrent(payment) ? 'true' : null"
                @click="openPayment(payment)"
              >
                <span class="payments-row__copy">
                  <strong>{{ formatDay(payment.timeMs, true) }}</strong>
                  <small v-if="isCurrent(payment)">{{ $t('This payment') }}</small>
                  <small v-else-if="messageOf(payment)">{{ messageOf(payment) }}</small>
                </span>
                <span class="payments-row__amount"><HiddenAmount>{{ formatAmount(payment.amountSats, walletStore.useBip177Format) }}</HiddenAmount></span>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <footer v-if="target" class="payments-sheet__foot">
        <button type="button" class="form-sheet-primary payments-sheet__again" @click="payAgain">
          <Icon icon="tabler:repeat" width="18" height="18" aria-hidden="true" />
          {{ $t('Pay again') }}
        </button>
      </footer>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { Icon } from '@iconify/vue'
import HiddenAmount from './HiddenAmount.vue'
import { useWalletStore } from '../stores/wallet.js'
import { useTransactionMetadataStore } from '../stores/transactionMetadata.js'
import { usePayContact } from '../composables/usePayContact.js'
import { loadRecipientPayments, paymentTimeMs, summarizePayments } from '../services/recipientPayments.js'
import { fiatRatesService } from '../utils/fiatRates.js'
import { formatAmount } from '../utils/amountFormatting.js'
import { getTxMessage } from '../utils/txMessage.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The recipient, as the receipt names it. */
  name: { type: String, default: '' },
  addressLine: { type: String, default: '' },
  /** Every address the recipient is known by, and the contact it is, if any. */
  addresses: { type: Array, default: () => [] },
  contactId: { type: String, default: '' },
  /** The payment this was opened from: always listed, and marked. */
  current: { type: Object, default: null },
  currentWalletId: { type: String, default: '' },
  /** What Pay again pays (utils/payAgain `payAgainTarget`). */
  target: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const router = useRouter()
const walletStore = useWalletStore()
const metadataStore = useTransactionMetadataStore()
const payContact = usePayContact({ $q: useQuasar(), $t: (key, params) => proxy.$t(key, params), $router: router })

const titleId = `recipient-payments-${proxy.$.uid}`
const payments = ref([])
const complete = ref(true)
const loading = ref(false)
let loadToken = 0

/** What was sent, the payment this was opened from included even when older than what the wallets list. */
const sent = computed(() => {
  const list = payments.value.filter((payment) => payment.type === 'outgoing')
  const current = props.current
  if (!current?.id || list.some(isCurrent)) return list
  const opened = {
    ...current,
    walletId: props.currentWalletId,
    sourceKey: `${props.currentWalletId}:${current.id}`,
    amountSats: current.recipientSats || Math.abs(Number(current.amount) || 0),
    timeMs: paymentTimeMs(current),
  }
  return [...list, opened].sort((a, b) => b.timeMs - a.timeMs)
})
const summary = computed(() => summarizePayments(sent.value))
const countLabel = computed(() => {
  const { count, sinceMs } = summary.value
  if (!complete.value) return proxy.$t('Recent payments')
  if (!sinceMs) return proxy.$t('Payments')
  return proxy.$t(count === 1 ? 'Payment since {date}' : 'Payments since {date}', { date: formatDay(sinceMs) })
})
const totalFiat = computed(() => {
  const currency = walletStore.preferredFiatCurrency || 'USD'
  const value = fiatRatesService.convertSatsToFiatSync(summary.value.totalSats, currency)
  return value === null ? '' : fiatRatesService.formatFiatAmount(value, currency)
})
const months = computed(() => {
  const groups = []
  for (const payment of sent.value) {
    const label = formatMonth(payment.timeMs)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.payments.push(payment)
    else groups.push({ label, payments: [payment] })
  }
  return groups
})

async function load() {
  const token = ++loadToken
  loading.value = true
  try {
    const found = await loadRecipientPayments({
      wallets: walletStore.wallets,
      providers: walletStore.providers,
      metadataFor: (txId, walletId) => metadataStore.getMetadataForTransaction(txId, walletId),
      addresses: props.addresses,
      contactId: props.contactId || null,
    })
    if (token !== loadToken) return
    payments.value = found.payments
    complete.value = found.complete
  } finally {
    if (token === loadToken) loading.value = false
  }
}

const locale = () => proxy.$i18n?.locale || undefined
function formatMonth(ms) {
  if (!ms) return ''
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(ms))
}
function formatDay(ms, withWeekday = false) {
  if (!ms) return ''
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale(), {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}
const messageOf = (payment) => getTxMessage(payment)
const isCurrent = (payment) => payment.id === props.current?.id && payment.walletId === props.currentWalletId

function openPayment(payment) {
  emit('update:modelValue', false)
  if (isCurrent(payment)) return
  router.push(`/transaction/${encodeURIComponent(payment.id)}?wallet=${encodeURIComponent(payment.walletId)}`)
}

function payAgain() {
  emit('update:modelValue', false)
  payContact.payAgain(props.target, { walletId: props.currentWalletId })
}
</script>

<style scoped>
/* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
.payments-sheet {
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  max-height: min(86dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  padding: 0 20px;
  font-family: 'Manrope', sans-serif;
}
.payments-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0 4px;
}
.payments-sheet__title {
  min-width: 0;
}
.payments-sheet__head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.payments-sheet__address {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.payments-sheet__done {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 16px 'Manrope', sans-serif;
  cursor: pointer;
}
.payments-sheet__loading {
  display: grid;
  gap: 8px;
  padding: 12px 0 20px;
}
.payments-sheet__skeleton {
  border-radius: 14px;
}
.payments-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 12px;
  border: 1px solid var(--border-card);
  border-radius: 14px;
}
.payments-stat {
  padding: 12px 14px;
  min-width: 0;
}
.payments-stat + .payments-stat {
  border-left: 1px solid var(--border-card);
}
.payments-stat strong {
  display: block;
  font-size: 20px;
  font-weight: 800;
}
.payments-stat__label {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-secondary);
}
.payments-sheet__label {
  margin: 18px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.payments-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-card);
  border-radius: 14px;
  overflow: hidden;
}
.payments-list li + li {
  border-top: 1px solid var(--border-card);
}
.payments-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}
.payments-row--current {
  background: var(--bg-input);
}
.payments-row__copy {
  min-width: 0;
}
.payments-row__copy strong {
  display: block;
  font-size: 15px;
  font-weight: 600;
}
.payments-row__copy small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.payments-row__amount {
  flex: 0 0 auto;
  font-size: 15px;
  font-weight: 700;
}
.payments-row:focus-visible,
.payments-sheet__done:focus-visible,
.payments-sheet__again:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
}
.payments-sheet__foot {
  position: sticky;
  bottom: 0;
  margin: 16px -20px 0;
  padding: 12px 20px max(16px, var(--safe-bottom, 0px));
  background: var(--bg-card);
  border-top: 1px solid var(--border-card);
}
.payments-sheet__again {
  width: 100%;
}
</style>
