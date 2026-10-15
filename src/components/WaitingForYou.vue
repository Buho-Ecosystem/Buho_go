<!--
  WaitingForYou: what waits for the user, on Home. One written line above
  Receive and Send ("Lena asks for ₿ 8,000", "2 requests · 1 voucher") opens
  a sheet with each request (Pay) and each voucher (Redeem). Pay hands the
  request over to the send pipeline exactly like the chat does; Redeem is
  left to the wallet page (redeem-voucher). Nothing shows while nothing waits.
-->
<template>
  <button v-if="summary" type="button" class="waiting-line" data-audit="waiting-line" @click="open = true">
    <Icon :icon="requests.length ? 'buho:request' : 'tabler:ticket'" width="17" height="17" class="waiting-line__icon" aria-hidden="true" />
    <span class="waiting-line__text">{{ summary }}</span>
    <Icon icon="tabler:chevron-right" width="14" height="14" class="waiting-line__chevron" aria-hidden="true" />
  </button>

  <q-dialog v-model="open" position="bottom">
    <section class="waiting-sheet" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <header class="waiting-sheet__head">
        <h2 :id="titleId">{{ $t('Waiting for you') }}</h2>
        <button type="button" class="waiting-sheet__done" @click="open = false">{{ $t('Done') }}</button>
      </header>

      <template v-if="requests.length">
        <h3 class="waiting-sheet__label">{{ $t('To pay') }}</h3>
        <ul class="waiting-list">
          <li v-for="message in requests" :key="message.id" class="waiting-row">
            <button type="button" class="waiting-row__main" @click="openChat(message.partner)">
              <ContactAvatar class="waiting-row__avatar" :entry="contactOf(message.partner) || {}" :name="nameOf(message.partner)" />
              <span class="waiting-row__copy">
                <strong>{{ nameOf(message.partner) }}</strong>
                <small>{{ requestLine(message) }}</small>
              </span>
            </button>
            <button
              type="button"
              class="waiting-row__action waiting-row__action--pay"
              :disabled="paying !== null"
              :aria-busy="paying === message.id"
              @click="payRequest(message)"
            >
              <q-spinner v-if="paying === message.id" size="14px" />
              <template v-else>{{ $t('Pay') }}</template>
            </button>
          </li>
        </ul>
        <p v-if="error" class="form-sheet-error waiting-sheet__error" role="alert">{{ error }}</p>
      </template>

      <template v-if="vouchers.length">
        <h3 class="waiting-sheet__label">{{ $t('Vouchers') }}</h3>
        <ul class="waiting-list">
          <li v-for="voucher in vouchers" :key="voucher.id" class="waiting-row">
            <span class="waiting-row__main">
              <span class="waiting-row__icon" aria-hidden="true"><Icon icon="tabler:ticket" width="18" height="18" /></span>
              <span class="waiting-row__copy">
                <strong>{{ voucherName(voucher) }}</strong>
                <small v-if="amountOf(vouchersStore.displaySats(voucher))">{{ $t('{amount} left', { amount: amountOf(vouchersStore.displaySats(voucher)) }) }}</small>
              </span>
            </span>
            <button
              type="button"
              class="waiting-row__action"
              :disabled="voucher.maxSats < 1 || vouchersStore.isChecking(voucher.id)"
              @click="redeem(voucher)"
            >
              {{ $t('Redeem') }}
            </button>
          </li>
        </ul>
      </template>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { Icon } from '@iconify/vue'
import ContactAvatar from './AddressBook/ContactAvatar.vue'
import { useWaiting } from '../composables/useWaiting.js'
import { useChatRuntime } from '../composables/useChatRuntime.js'
import { usePayContact } from '../composables/usePayContact.js'
import { describeDmError } from '../composables/useContactChat.js'
import { useAddressBookStore } from '../stores/addressBook.js'
import { useWalletStore } from '../stores/wallet.js'
import { useWithdrawVouchersStore } from '../stores/withdrawVouchers.js'
import { requestPaymentHandover } from '../services/dm/paymentContext.js'
import { contactChatRoute } from '../services/dm/routes.js'
import { payingWalletsInStore, pickDefaultPayingWallet } from '../utils/payingWallets.js'
import { formatAmount } from '../utils/amountFormatting.js'
import { waitingSummary } from '../utils/waitingSummary.js'

const emit = defineEmits(['redeem-voucher'])

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const router = useRouter()
const runtime = useChatRuntime()
const addressBook = useAddressBookStore()
const walletStore = useWalletStore()
const vouchersStore = useWithdrawVouchersStore()
const payContact = usePayContact({ $q: useQuasar(), $t: t, $router: router })
const { requests, vouchers, hasAny } = useWaiting()

const titleId = `waiting-for-you-${proxy.$.uid}`
const open = ref(false)
const paying = ref(null)
const error = ref('')

const contactOf = (pubkey) => addressBook.findContactByPubkey(pubkey)
const nameOf = (pubkey) => contactOf(pubkey)?.name || ''
const firstNameOf = (pubkey) => nameOf(pubkey).trim().split(/\s+/)[0]
/** Amounts follow Hide balance: '' while hidden. */
const amountOf = (sats) => (walletStore.balanceHidden ? '' : formatAmount(sats, walletStore.useBip177Format))
const voucherName = (voucher) => voucher.title || voucher.domain

const summary = computed(() => waitingSummary(
  { requests: requests.value, vouchers: vouchers.value },
  { t, nameOf: firstNameOf, amountOf, voucherName, voucherSats: vouchersStore.displaySats },
))

/** "₿ 8,000 · Cinema tickets": the amount (unless hidden) and what it is for. */
const requestLine = ({ request }) =>
  [amountOf(request.amountSats), request.note || t('Payment request')].filter(Boolean).join(' · ')

// The sheet closes by itself once nothing waits any more.
watch(hasAny, (any) => { if (!any) open.value = false })

function openChat(pubkey) {
  const contact = contactOf(pubkey)
  if (!contact) return
  open.value = false
  router.push(contactChatRoute(contact.id))
}

/** Same path as Pay in the chat: an invoice for exactly the amount, then the confirm sheet. */
async function payRequest(message) {
  if (paying.value) return
  paying.value = message.id
  error.value = ''
  const contact = contactOf(message.partner)
  try {
    const invoice = await runtime.fetchRequestInvoice(message.partner, message.id)
    open.value = false
    payContact.payInvoice(...requestPaymentHandover({
      partner: message.partner,
      message,
      invoice,
      name: contact?.name || '',
      contactId: contact?.id,
      payer: pickDefaultPayingWallet(payingWalletsInStore(walletStore, message.request.amountSats)),
    }))
  } catch (cause) {
    error.value = describeDmError(cause, { t, name: contact?.name || '' }).message
  } finally {
    paying.value = null
  }
}

function redeem(voucher) {
  open.value = false
  emit('redeem-voucher', voucher)
}
</script>

<style scoped>
.waiting-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: 100%;
  min-height: 44px;
  margin: 0 auto 6px;
  padding: 0 12px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: 500 14px 'Manrope', sans-serif;
  cursor: pointer;
}
.waiting-line__icon {
  flex-shrink: 0;
  color: var(--brand-accent-text);
}
.waiting-line__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.waiting-line__chevron {
  flex-shrink: 0;
  color: var(--text-muted, var(--text-secondary));
}
.waiting-line:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
  border-radius: 10px;
}

/* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
.waiting-sheet {
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  max-height: min(80dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  padding: 0 20px max(20px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
}
.waiting-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
}
.waiting-sheet__head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}
.waiting-sheet__done {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 16px 'Manrope', sans-serif;
  cursor: pointer;
}
.waiting-sheet__label {
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.waiting-sheet__error {
  margin: 8px 0 0;
}
.waiting-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-card);
  border-radius: 14px;
  overflow: hidden;
}
.waiting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
}
.waiting-row + .waiting-row {
  border-top: 1px solid var(--border-card);
}
.waiting-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 0 10px 14px;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  font: inherit;
}
button.waiting-row__main {
  cursor: pointer;
}
.waiting-row__avatar,
.waiting-row__icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}
.waiting-row__icon {
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--brand-accent-text);
}
.waiting-row__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.waiting-row__copy strong {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.waiting-row__copy small {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* A capsule with a verb, like the App Store's Update: one tap, says what it does. */
.waiting-row__action {
  flex-shrink: 0;
  min-width: 64px;
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
  font: 700 14px 'Manrope', sans-serif;
  cursor: pointer;
}
.waiting-row__action--pay {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-fg);
}
.waiting-row__action:disabled {
  opacity: 0.5;
  cursor: default;
}
.waiting-row__main:focus-visible,
.waiting-row__action:focus-visible,
.waiting-sheet__done:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
}
</style>
