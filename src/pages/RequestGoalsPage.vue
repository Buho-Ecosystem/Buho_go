<template>
  <q-page class="request-goals">
    <header class="request-goals__header">
      <button type="button" :aria-label="$t('Back')" @click="back">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </button>
      <h1>{{ $t(detailId ? 'Payment request' : 'Requests') }}</h1>
      <span aria-hidden="true" />
    </header>
    <div
      v-if="!ready"
      class="request-goals__empty"
      role="status"
      :aria-label="$t('Loading…')"
    >
      <q-spinner size="28px" />
    </div>
    <template v-else-if="detailId && goal">
      <div class="request-goals__body">
        <section class="request-goals__hero" :aria-label="title(goal)">
          <h2>{{ title(goal) }}</h2>
          <p class="request-goals__amount">{{ money(goal.receivedSats) }}</p>
          <p class="request-goals__of">
            {{
              $t('of {amount} received', { amount: money(goal.collectSats) })
            }}
          </p>
          <div
            class="request-goals__bar"
            role="progressbar"
            :aria-label="$t('Amount received')"
            :aria-valuemin="0"
            :aria-valuemax="goal.collectSats"
            :aria-valuenow="goal.receivedSats"
          >
            <span
              :style="{
                width: `${(goal.receivedSats / goal.collectSats) * 100}%`
              }"
            />
          </div>
          <p
            class="request-goals__count"
            :class="{ 'request-goals__complete': goal.complete }"
          >
            <Icon
              v-if="goal.complete"
              icon="tabler:circle-check"
              width="16"
              height="16"
            />{{
              goal.complete
                ? $t('Everyone has paid')
                : $t('{n} of {total} paid', {
                    n: goal.paidCount,
                    total: goal.shares.length
                  })
            }}
          </p>
          <p v-if="goal.ownSats" class="request-goals__own">
            {{ $t('Your share: {amount}', { amount: money(goal.ownSats) }) }}
          </p>
        </section>
        <div class="request-goals__people">
          <p
            v-if="
              goal.sendErrorCode && goal.shares.some((share) => share.canRetry)
            "
            class="form-sheet-error"
            role="alert"
          >
            {{ goalError(goal.sendErrorCode) }}
          </p>
          <article
            v-for="share in goal.shares"
            :key="share.requestId"
            class="request-goals__person"
          >
            <button
              class="request-goals__person-main"
              type="button"
              :disabled="!share.hasMessage"
              :aria-label="$t('Open chat with {name}', { name: shareName(share) })"
              @click="openChat(share.pubkey)"
            >
              <ContactAvatar
                :entry="contactOf(share.pubkey) || {}"
                :name="shareName(share)"
              />
              <span class="request-goals__names"
                ><strong>{{ shareName(share) }}</strong
                ><small
                  :class="{ 'request-goals__paid': share.state === 'paid' }"
                  >{{ $t(stateLabels[share.state] || 'Requested') }}</small
                ></span
              >
              <span class="request-goals__share">{{
                money(share.amountSats)
              }}</span
              ><Icon
                v-if="share.hasMessage"
                icon="tabler:chevron-right"
                width="16"
                height="16"
              />
            </button>
            <button
              v-if="share.canRetry"
              class="request-goals__retry"
              type="button"
              :disabled="busy.has(share.requestId)"
              :aria-label="
                $t('Try sending the request to {name} again', {
                  name: shareName(share)
                })
              "
              @click="retry(share)"
            >
              {{ busy.has(share.requestId) ? $t('Sending…') : $t('Try again') }}
            </button>
            <p
              v-if="
                errors[share.requestId] || (share.canRetry && share.errorCode)
              "
              class="form-sheet-error"
              role="alert"
            >
              {{ errors[share.requestId] || deliveryError(share) }}
            </p>
          </article>
        </div>
        <p class="request-goals__privacy">
          {{ $t('Each person has a request in your private chat.') }}
        </p>
      </div>
    </template>
    <template v-else-if="!detailId">
      <div class="request-goals__body request-goals__list">
        <section v-if="toPay.length" :aria-labelledby="toPayId">
          <h2 :id="toPayId" class="request-goals__section">
            {{ $t('To pay') }}
          </h2>
          <button
            v-for="request in toPay"
            :key="request.id"
            class="request-goals__list-row"
            type="button"
            @click="openChat(request.partner)"
          >
            <ContactAvatar
              :entry="contactOf(request.partner) || {}"
              :name="nameOf(request.partner)"
            />
            <span class="request-goals__names"
              ><strong>{{
                $t('{name} requests', { name: nameOf(request.partner) })
              }}</strong
              ><small>{{
                request.request.note || $t('Payment request')
              }}</small></span
            >
            <span class="request-goals__list-amount">{{
              money(request.request.amountSats)
            }}</span
            ><Icon icon="tabler:chevron-right" width="16" height="16" />
          </button>
        </section>
        <section
          v-if="outgoing.length"
          :aria-labelledby="toPay.length ? outgoingId : undefined"
        >
          <h2 v-if="toPay.length" :id="outgoingId" class="request-goals__section">
            {{ $t('Your requests') }}
          </h2>
          <button
            v-for="item in outgoing"
            :key="item.id"
            class="request-goals__list-row"
            type="button"
            @click="openRequest(item)"
          >
            <template v-if="item.shares.length === 1">
              <ContactAvatar
                :entry="contactOf(item.shares[0].pubkey) || {}"
                :name="shareName(item.shares[0])"
              />
              <span class="request-goals__names"
                ><strong>{{ shareName(item.shares[0]) }}</strong
                ><small
                  :class="{
                    'request-goals__paid': item.shares[0].state === 'paid'
                  }"
                  >{{ singleStatus(item) }}</small
                ></span
              >
              <span class="request-goals__list-amount">{{
                money(item.collectSats)
              }}</span>
            </template>
            <template v-else>
              <span class="request-goals__list-icon"
                ><Icon
                  :icon="item.complete ? 'tabler:circle-check' : 'buho:request'"
                  width="22"
                  height="22"
              /></span>
              <span class="request-goals__names"
                ><strong>{{ title(item) }}</strong
                ><small>{{
                  $t('{n} of {total} paid', {
                    n: item.paidCount,
                    total: item.shares.length
                  })
                }}</small
                ><span class="request-goals__mini-bar"
                  ><span
                    :style="{
                      width: `${(item.receivedSats / item.collectSats) * 100}%`
                    }" /></span
              ></span>
              <span class="request-goals__list-amount"
                >{{ money(item.receivedSats)
                }}<small>{{
                  $t('of {amount}', { amount: money(item.collectSats) })
                }}</small></span
              >
            </template>
            <Icon icon="tabler:chevron-right" width="16" height="16" />
          </button>
        </section>
        <div
          v-if="!toPay.length && !outgoing.length"
          class="request-goals__empty"
        >
          <Icon icon="buho:request" width="32" height="32" />
          <h2>{{ $t('No requests yet') }}</h2>
          <p>{{ $t('Ask one person or a few. See their payments here.') }}</p>
        </div>
      </div>
      <footer class="request-goals__footer">
        <button
          class="form-sheet-primary"
          type="button"
          :disabled="!runtime.available.value"
          @click="requestOpen = true"
        >
          {{ $t('Request money') }}
        </button>
      </footer>
    </template>
    <div v-else class="request-goals__empty">
      <h2>{{ $t('Request not found') }}</h2>
      <p>{{ $t('This request may belong to another identity.') }}</p>
      <button
        class="request-goals__done"
        type="button"
        @click="$router.push('/requests')"
      >
        {{ $t('Requests') }}
      </button>
    </div>
    <RequestMoneyFlow v-model="requestOpen" />
  </q-page>
</template>
<script setup>
import { computed, getCurrentInstance, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useRequests } from '../composables/useRequests.js'
import { useAddressBookStore } from '../stores/addressBook.js'
import { useWalletStore } from '../stores/wallet.js'
import { describeDmError } from '../composables/useContactChat.js'
import { DmError } from '../services/dm/errors.js'
import { contactChatRoute, unknownChatRoute } from '../services/dm/routes.js'
import { formatSats } from '../components/chat/chatFormat.js'
import ContactAvatar from '../components/AddressBook/ContactAvatar.vue'
import RequestMoneyFlow from '../components/chat/RequestMoneyFlow.vue'
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const route = useRoute(),
  router = useRouter(),
  wallets = useWalletStore(),
  addressBook = useAddressBookStore()
const { outgoing, toPay, goalFor, runtime, ready } = useRequests()
const toPayId = `request-goals-to-pay-${proxy.$.uid}`
const outgoingId = `request-goals-outgoing-${proxy.$.uid}`
const detailId = computed(() =>
  typeof route.params.goalId === 'string' ? route.params.goalId : ''
)
const goal = computed(() => goalFor(detailId.value))
const requestOpen = ref(false),
  busy = reactive(new Set()),
  errors = reactive({})
const stateLabels = {
  paid: 'Paid',
  paying: 'Checking payment…',
  checking: 'Checking payment…',
  failed: 'Not sent',
  sending: 'Sending…',
  pending: 'Requested',
  expired: 'Expired',
  declined: 'Declined',
  cancelled: 'Cancelled'
}
const money = (amount) =>
  formatSats(amount, wallets.useBip177Format !== false, proxy.$i18n.locale)
const shortName = (pubkey) => `${pubkey.slice(0, 8)}…`
const contactOf = (pubkey) => addressBook.findContactByPubkey(pubkey)
const nameOf = (pubkey) => contactOf(pubkey)?.name || shortName(pubkey)
const shareName = (share) => share.name || nameOf(share.pubkey)
const title = (item) =>
  item.note ||
  (item.shares.length === 1
    ? t('Request to {name}', { name: shareName(item.shares[0]) })
    : t('Request to {n} people', { n: item.shares.length }))
/** One person: their note and where the request stands, in one line. */
const singleStatus = (item) =>
  [item.note, t(stateLabels[item.shares[0].state] || 'Requested')]
    .filter(Boolean)
    .join(' · ')
const deliveryError = (share) =>
  describeDmError(new DmError(share.errorCode, 'request delivery failed'), {
    t,
    name: share.name
  }).message
const goalError = (code) =>
  describeDmError(new DmError(code, 'request sending failed'), { t }).message
// Back returns to where the page was opened from (chat, receipt, list, wallet).
function back() {
  if (window.history.state?.back) router.back()
  else router.replace(detailId.value ? '/requests' : '/wallet')
}
function openChat(pubkey) {
  const found = contactOf(pubkey)
  router.push(found ? contactChatRoute(found.id) : unknownChatRoute(pubkey))
}
/** One person: the chat where the request lives. Several: their progress. */
function openRequest(item) {
  if (item.shares.length === 1) openChat(item.shares[0].pubkey)
  else router.push({ name: 'request-goal', params: { goalId: item.id } })
}
async function retry(share) {
  if (busy.has(share.requestId)) return
  const owner = runtime.me.value,
    goalId = goal.value.id
  busy.add(share.requestId)
  delete errors[share.requestId]
  try {
    await runtime.retryRequestGoal(goalId, share.requestId)
  } catch (error) {
    if (runtime.me.value === owner)
      errors[share.requestId] = describeDmError(error, {
        t,
        name: share.name
      }).message
  } finally {
    busy.delete(share.requestId)
  }
}
</script>
<style scoped>
.request-goals {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--safe-top, 0px));
  background: var(--bg-primary);
  color: var(--text-primary);
  max-width: 600px;
  margin: auto;
  font-family: 'Manrope', sans-serif;
}
.request-goals__header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-card);
  min-height: 62px;
}
.request-goals__header h1 {
  font-size: 17px;
  font-weight: 700;
  text-align: center;
  margin: 0;
}
.request-goals__header button {
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}
.request-goals__body {
  flex: 1;
  padding-bottom: 24px;
}
.request-goals__hero {
  text-align: center;
  padding: 30px 20px 20px;
}
.request-goals__hero h2 {
  font-size: 17px;
  font-weight: 650;
  margin: 0 0 18px;
  overflow-wrap: anywhere;
}
.request-goals__amount {
  font-size: 39px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.2;
  margin: 0;
  overflow-wrap: anywhere;
}
.request-goals__of {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 8px 0 20px;
}
.request-goals__bar,
.request-goals__mini-bar {
  height: 6px;
  background: var(--bg-input);
  border-radius: 30px;
  overflow: hidden;
  max-width: 250px;
  margin: auto;
}
.request-goals__bar > span,
.request-goals__mini-bar > span {
  display: block;
  height: 100%;
  border-radius: 30px;
  background: var(--brand-accent-text);
  transition: width 0.25s;
}
.request-goals__count {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  margin: 12px 0 0;
}
.request-goals__complete,
.request-goals__paid {
  color: var(--brand-accent-text) !important;
}
.request-goals__own {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 8px 0 0;
}
.request-goals__people,
.request-goals__list {
  padding-left: 20px;
  padding-right: 20px;
}
.request-goals__person {
  border-bottom: 1px solid var(--border-card);
}
.request-goals__person:last-child {
  border: 0;
}
.request-goals__person-main {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 76px;
  padding: 12px 0;
  width: 100%;
  border: 0;
  background: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.request-goals__person-main:disabled {
  cursor: default;
}
.request-goals__person-main :deep(.contact-avatar) {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}
.request-goals__names {
  min-width: 0;
  flex: 1;
}
.request-goals__names strong {
  font-size: 14px;
  font-weight: 650;
  display: block;
  overflow-wrap: anywhere;
}
.request-goals__names small {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  margin-top: 3px;
}
.request-goals__share {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  max-width: 40%;
  overflow-wrap: anywhere;
  text-align: right;
}
.request-goals__retry {
  min-height: 44px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font-weight: 600;
  font-size: 13px;
  padding: 0 0 8px;
  cursor: pointer;
}
.request-goals__privacy {
  color: var(--text-secondary);
  text-align: center;
  font-size: 11px;
  margin: 20px;
}
.request-goals__footer {
  padding: 16px 20px max(20px, var(--safe-bottom, 0px));
  margin-top: auto;
  background: var(--bg-primary);
}
.request-goals__footer button {
  width: 100%;
}
.request-goals__done {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--border-card);
  border-radius: 14px;
  background: none;
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
}
.request-goals__list-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 18px 0;
  width: 100%;
  min-height: 88px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.request-goals__section {
  margin: 20px 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.request-goals__list-row :deep(.contact-avatar) {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}
.request-goals__list-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-input);
  flex-shrink: 0;
}
.request-goals__list-amount {
  font-size: 12px;
  font-weight: 650;
  text-align: right;
  max-width: 38%;
  overflow-wrap: anywhere;
}
.request-goals__list-amount small {
  font-size: 10px;
  font-weight: 400;
  display: block;
  color: var(--text-secondary);
  margin-top: 4px;
}
.request-goals__mini-bar {
  height: 3px;
  margin-top: 8px;
  max-width: none;
}
.request-goals__empty {
  text-align: center;
  padding: 60px 24px;
  color: var(--text-secondary);
}
.request-goals__empty h2 {
  font-size: 18px;
  color: var(--text-primary);
  margin: 15px 0 8px;
}
.request-goals__empty p {
  font-size: 13px;
  margin: 0 0 20px;
}
button:focus-visible {
  outline: 2px solid var(--chat-focus, #2563eb);
  outline-offset: 3px;
}
button:disabled {
  opacity: 0.5;
}
@media (max-width: 360px) {
  .request-goals__hero {
    padding-top: 24px;
  }
  .request-goals__amount {
    font-size: 34px;
  }
  .request-goals__people,
  .request-goals__list {
    padding-left: 16px;
    padding-right: 16px;
  }
  .request-goals__share {
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .request-goals__bar > span,
  .request-goals__mini-bar > span {
    transition: none;
  }
}
</style>
