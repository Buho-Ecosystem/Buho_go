<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="submitting"
    @update:model-value="$emit('close')"
  >
    <section class="shared-request" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <header class="shared-request__header">
        <button
          class="shared-request__back"
          type="button"
          :disabled="submitting"
          @click="$emit('back')"
        >
          <Icon icon="tabler:chevron-left" width="18" height="18" /><span>{{
            $t('People')
          }}</span>
        </button>
        <h2 :id="titleId">
          {{
            people.length === 1
              ? $t('Request from {name}', { name: firstName(people[0].name) })
              : $t('Request money')
          }}
        </h2>
        <button
          class="shared-request__close"
          type="button"
          :aria-label="$t('Close request')"
          :disabled="submitting"
          @click="$emit('close')"
        >
          <Icon icon="tabler:x" width="20" height="20" />
        </button>
      </header>
      <div v-if="!address" class="shared-request__empty">
        <Icon icon="tabler:at" width="28" height="28" />
        <p>
          {{
            $t('To request money you need a Lightning address in your profile.')
          }}
        </p>
      </div>
      <template v-else>
        <div
          class="shared-request__body"
          :class="{
            'shared-request__body--individual': draft.method === 'amounts'
          }"
        >
          <div v-if="people.length > 1" class="shared-request__people">
            <span class="shared-request__faces" aria-hidden="true"
              ><ContactAvatar
                v-for="person in people.slice(0, 4)"
                :key="person.pubkey"
                :entry="person.contact || {}"
                :name="person.name"
                :picture="person.profile?.picture || ''"
            /></span>
            <span>{{ peopleLabel }}</span>
          </div>
          <div
            v-if="people.length > 1 || repayment || draft.method === 'amounts'"
            class="shared-request__methods"
            role="radiogroup"
            :aria-label="$t('How to split the request')"
          >
            <button
              v-for="method in methods"
              :key="method.value"
              :ref="(el) => (methodButtons[method.value] = el)"
              type="button"
              role="radio"
              :aria-checked="draft.method === method.value"
              :tabindex="draft.method === method.value ? 0 : -1"
              :disabled="submitting"
              @click="chooseMethod(method.value)"
              @keydown="onMethodKey($event, method.value)"
            >
              {{ $t(method.label) }}
            </button>
          </div>
          <div v-if="draft.method === 'equal'" class="shared-request__equal">
            <p class="shared-request__label">
              {{ $t(repayment ? 'Expense total' : 'Total to receive') }}
            </p>
            <AmountKeypad
              :model-value="draft.amount"
              :fiat="draft.inFiat"
              :fiat-code="fiatCode.toLowerCase()"
              :fiat-rate="rate"
              :disabled="submitting"
              :locale="$i18n.locale"
              :exact-sats="totalSats"
              scroll-content
              @update:model-value="draft.amount = $event"
              @update:fiat="draft.inFiat = $event"
              @edit="editTotal"
              @swap-unit="preserveTotal"
            >
              <p v-if="eachLabel" class="shared-request__each">{{ eachLabel }}</p>
              <p v-if="roundedShares" class="shared-request__rounding">
                {{ roundedShares }}
              </p>
              <p
                v-if="allocation.error && totalSats"
                class="shared-request__feedback shared-request__feedback--error"
                role="status"
              >
                {{ allocationMessage }}
              </p>
              <button
                v-if="repayment"
                class="shared-request__own"
                type="button"
                role="switch"
                :aria-checked="draft.includeSelf"
                :disabled="submitting"
                @click="draft.includeSelf = !draft.includeSelf"
              >
                <span
                  >{{ $t('Include my share')
                  }}<small v-if="draft.includeSelf && !allocation.error">
                    · {{ money(allocation.ownSats) }}</small
                  ></span
                ><span
                  class="shared-request__switch"
                  :class="{ 'shared-request__switch--on': draft.includeSelf }"
                />
              </button>
              <button
                class="shared-request__address"
                type="button"
                :disabled="submitting"
                @click="$emit('open-address')"
              >
                {{ $t('Paid to {address}', { address }) }}
              </button>
            </AmountKeypad>
          </div>
          <template v-else>
            <div class="shared-request__total">
              <p class="shared-request__label">
                {{ $t(repayment ? 'Expense total' : 'Total to receive') }}
              </p>
              <p class="shared-request__amount" aria-live="polite">
                {{ draft.inFiat ? fiat(displayTotal) : decimal(displayTotal)
                }}<small v-if="!draft.inFiat">sats</small>
              </p>
              <button
                class="shared-request__currency"
                type="button"
                :disabled="submitting || !rate"
                :aria-label="
                  $t('Switch amount between {currency} and sats', {
                    currency: fiatCode
                  })
                "
                @click="swapUnit"
              >
                {{ draft.inFiat ? money(displayTotal) : fiat(displayTotal)
                }}<Icon icon="tabler:arrows-up-down" width="14" height="14" />
              </button>
            </div>
            <p class="shared-request__list-label">
              <span>{{ $t('Amount per person') }}</span
              ><span>{{ draft.inFiat ? fiatCode : 'sats' }}</span>
            </p>
            <div class="shared-request__amounts">
              <div
                v-for="(person, index) in people"
                :key="person.pubkey"
                class="shared-request__person"
              >
                <ContactAvatar
                  :entry="person.contact || {}"
                  :name="person.name"
                  :picture="person.profile?.picture || ''"
                />
                <label
                  class="shared-request__name"
                  :for="amountId(person.pubkey)"
                  >{{ person.name }}</label
                >
                <div class="shared-request__entry">
                  <input
                    :id="amountId(person.pubkey)"
                    :ref="(el) => (amountInputs[person.pubkey] = el)"
                    type="text"
                    :inputmode="draft.inFiat ? 'decimal' : 'numeric'"
                    :enterkeyhint="
                      index === people.length - 1 ? 'done' : 'next'
                    "
                    :aria-label="$t('Amount for {name}', { name: person.name })"
                    :aria-describedby="
                      allocationMessage ? feedbackId : undefined
                    "
                    :aria-invalid="
                      touched.has(person.pubkey) &&
                      draft.individual[person.pubkey] == null &&
                      Boolean(draft.inputs[person.pubkey])
                    "
                    :value="fieldValue(person.pubkey)"
                    :disabled="submitting"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="24"
                    placeholder="0"
                    @focus="focusAmount(person.pubkey, $event)"
                    @blur="blurAmount(person.pubkey)"
                    @input="
                      updateIndividual(person.pubkey, $event.target.value)
                    "
                    @keydown.enter.prevent="nextAmount(index)"
                  />
                  <small>{{
                    draft.individual[person.pubkey] == null
                      ? '\u00a0'
                      : draft.inFiat
                        ? money(draft.individual[person.pubkey])
                        : fiat(draft.individual[person.pubkey])
                  }}</small>
                </div>
              </div>
              <button
                v-if="repayment"
                class="shared-request__person shared-request__person--own"
                type="button"
                role="switch"
                :aria-label="$t('Include my share')"
                :aria-checked="draft.includeSelf"
                :disabled="submitting"
                @click="draft.includeSelf = !draft.includeSelf"
              >
                <span
                  class="shared-request__switch"
                  :class="{ 'shared-request__switch--on': draft.includeSelf }"
                /><span class="shared-request__name"
                  >{{ $t('You')
                  }}<small>{{
                    $t(draft.includeSelf ? 'Cover the rest' : 'Not included')
                  }}</small></span
                >
                <strong>{{
                  draft.includeSelf
                    ? allocation.error
                      ? '--'
                      : money(allocation.ownSats)
                    : ''
                }}</strong>
              </button>
            </div>
            <p
              v-if="allocationMessage"
              :id="feedbackId"
              class="shared-request__feedback"
              :class="{
                'shared-request__feedback--error':
                  allocation.error === 'over' || allocation.error === 'limit'
              }"
              role="status"
            >
              {{ allocationMessage }}
            </p>
            <button
              class="shared-request__address"
              type="button"
              :disabled="submitting"
              @click="$emit('open-address')"
            >
              {{ $t('Paid to {address}', { address }) }}
            </button>
          </template>
        </div>
      </template>
      <footer class="shared-request__footer">
        <p v-if="error" class="form-sheet-error" role="alert">{{ error }}</p>
        <RequestNote
          v-if="address"
          v-model="draft.note"
          :initially-open="draft.noteOpen"
          :disabled="submitting"
        />
        <button
          class="form-sheet-primary"
          type="button"
          :disabled="submitting || (address && Boolean(allocation.error))"
          :aria-busy="submitting"
          @click="submit"
        >
          <Icon
            v-if="submitting"
            icon="tabler:loader-2"
            width="20"
            height="20"
            class="shared-request__spin"
          />
          {{
            !address
              ? $t('Set up Lightning address')
              : submitting
                ? $t('Sending requests…')
                : allocation.collectSats
                  ? $t('Request {amount}', {
                      amount: money(allocation.collectSats)
                    })
                  : $t('Request')
          }}
        </button>
      </footer>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, reactive, ref } from 'vue'
import { Icon } from '@iconify/vue'
import AmountKeypad from '../AmountKeypad.vue'
import ContactAvatar from '../AddressBook/ContactAvatar.vue'
import RequestNote from './RequestNote.vue'
import { useRequestAllocation } from '../../composables/useRequestAllocation.js'
import { formatSats } from './chatFormat.js'

const props = defineProps({
  modelValue: Boolean,
  people: { type: Array, default: () => [] },
  address: { type: String, default: '' },
  initialSats: { type: Number, default: 0 },
  initialNote: { type: String, default: '' },
  repayment: Boolean,
  fiatCode: { type: String, default: 'USD' },
  fiatRate: { type: Number, default: 0 },
  submitting: Boolean,
  error: { type: String, default: '' },
  bip177: { type: Boolean, default: true }
})
const emit = defineEmits(['back', 'close', 'open-address', 'submit'])
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const titleId = `shared-request-${proxy.$.uid}`
const feedbackId = `${titleId}-feedback`
const amountId = (pubkey) => `${titleId}-${pubkey}`
const {
  draft,
  rate,
  totalSats,
  allocation,
  chooseMethod,
  updateIndividual,
  swapUnit,
  editTotal,
  preserveTotal
} = useRequestAllocation(props)
const methodButtons = {}
const amountInputs = {}
const methods = [
  { value: 'equal', label: 'Equal shares' },
  { value: 'amounts', label: 'By amount' }
]
const touched = reactive(new Set())
const activeAmount = ref(null)
const firstName = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)[0]
const decimal = (amount) =>
  Number(amount || 0).toLocaleString(proxy.$i18n.locale)
const money = (amount) => formatSats(amount, props.bip177, proxy.$i18n.locale)
const fiat = (amount) =>
  rate.value
    ? new Intl.NumberFormat(proxy.$i18n.locale, {
        style: 'currency',
        currency: props.fiatCode
      }).format((amount / 100_000_000) * rate.value)
    : '--'
const displayTotal = computed(() =>
  props.repayment ? totalSats.value : allocation.value.collectSats
)
const peopleLabel = computed(() =>
  props.people.length <= 3
    ? props.people.map((person) => firstName(person.name)).join(', ')
    : t('{names} and {n} more', {
        names: props.people
          .slice(0, 2)
          .map((person) => firstName(person.name))
          .join(', '),
        n: props.people.length - 2
      })
)
const eachLabel = computed(() => {
  if (props.people.length === 1) return ''
  if (allocation.value.error) return t('Split equally')
  const first = allocation.value.shares[0].amountSats
  const uneven = allocation.value.shares.some(
    (share) => share.amountSats !== first
  )
  return t(uneven ? 'About {amount} each' : '{amount} each', {
    amount: money(first)
  })
})
const roundedShares = computed(() => {
  const shares = allocation.value.shares
  if (
    allocation.value.error ||
    !shares.some((share) => share.amountSats !== shares[0]?.amountSats)
  )
    return ''
  return shares
    .map(
      (share) =>
        `${firstName(props.people.find((person) => person.pubkey === share.pubkey)?.name)} ${money(share.amountSats)}`
    )
    .join(' · ')
})
const allocationMessage = computed(() => {
  const result = allocation.value
  switch (result.error) {
    case 'total':
      return t('Enter at least {amount}.', {
        amount: money(result.minimum || 1)
      })
    case 'amount':
      return t('Enter an amount for {name}.', {
        name: firstName(
          props.people.find((person) => person.pubkey === result.pubkey)?.name
        )
      })
    case 'over':
      return t('{amount} over the expense total.', {
        amount: money(result.difference)
      })
    case 'unassigned':
      return t('{amount} left to assign.', { amount: money(result.difference) })
    case 'limit':
      return t('The total is too large.')
    default:
      return ''
  }
})
function fieldValue(pubkey) {
  const amount = draft.individual[pubkey]
  if (activeAmount.value === pubkey || amount == null)
    return draft.inputs[pubkey] || ''
  return draft.inFiat
    ? ((amount / 100_000_000) * rate.value).toLocaleString(proxy.$i18n.locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : decimal(amount)
}
function focusAmount(pubkey, event) {
  activeAmount.value = pubkey
  nextTick(() => {
    event.target.select()
    event.target.scrollIntoView({ block: 'nearest' })
  })
}
function blurAmount(pubkey) {
  touched.add(pubkey)
  if (activeAmount.value === pubkey) activeAmount.value = null
}
function nextAmount(index) {
  const next = props.people[index + 1]
  if (next) amountInputs[next.pubkey]?.focus()
  else amountInputs[props.people[index].pubkey]?.blur()
}
function onMethodKey(event, current) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const method =
    event.key === 'Home'
      ? 'equal'
      : event.key === 'End'
        ? 'amounts'
        : current === 'equal'
          ? 'amounts'
          : 'equal'
  chooseMethod(method)
  nextTick(() => methodButtons[method]?.focus())
}
function submit() {
  if (props.submitting) return
  if (!props.address) {
    emit('open-address')
    return
  }
  if (allocation.value.error) return
  emit('submit', {
    method: draft.method,
    totalSats: allocation.value.totalSats,
    includeSelf: draft.includeSelf,
    note: draft.note.trim(),
    people: props.people.map((person) => ({
      pubkey: person.pubkey,
      name: person.name,
      amountSats: allocation.value.shares.find(
        (share) => share.pubkey === person.pubkey
      ).amountSats
    }))
  })
}
</script>

<style scoped>
.shared-request {
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  height: min(94dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  overflow: hidden;
  padding-bottom: max(12px, var(--safe-bottom, 0px));
}
.shared-request__header {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 72px;
  align-items: center;
  min-height: 56px;
  padding: 0 16px;
  flex-shrink: 0;
  gap: 4px;
}
.shared-request__header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  text-align: center;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.shared-request button {
  font-family: inherit;
  cursor: pointer;
}
.shared-request button:disabled {
  cursor: default;
  opacity: 0.4;
}
.shared-request__back,
.shared-request__close {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font-size: 13px;
  padding: 0;
}
.shared-request__back {
  justify-content: flex-start;
  min-width: 0;
}
/* A long label ("Personen") truncates; the chevron keeps its size. */
.shared-request__back svg {
  flex-shrink: 0;
}
.shared-request__back span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shared-request__close {
  color: var(--text-secondary);
  justify-self: end;
  min-width: 44px;
}
.shared-request__body {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.shared-request__body--individual {
  overflow-y: auto;
  padding-bottom: 12px;
}
.shared-request__people {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 28px;
  flex-shrink: 0;
  margin: 0 20px 6px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
}
.shared-request__faces {
  display: flex;
  padding-left: 6px;
}
.shared-request__faces :deep(.contact-avatar) {
  width: 24px !important;
  height: 24px !important;
  margin-left: -6px;
  border: 2px solid var(--bg-card);
  font-size: 8px !important;
}
.shared-request__methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  background: var(--bg-input);
  border-radius: 12px;
  padding: 3px;
  margin: 0 20px 8px;
  flex-shrink: 0;
}
.shared-request__methods button {
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}
.shared-request__methods button[aria-checked='true'] {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1px 4px #00000014;
}
.shared-request__equal {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.shared-request__label {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
  text-align: center;
  margin: 4px 0;
}
.shared-request__equal :deep(.amount-keypad) {
  min-height: 0;
  padding-top: 0;
  gap: 6px;
}
.shared-request__equal :deep(.amount-keypad__amount) {
  padding-top: 8px;
  gap: 2px;
  flex-shrink: 0;
}
.shared-request__equal :deep(.amount-keypad__keys) {
  flex-shrink: 0;
  margin-top: auto;
  padding: 8px 20px 0;
  box-sizing: border-box;
  max-width: 400px;
}
.shared-request__equal :deep(.amount-keypad__key) {
  height: 52px;
  min-height: 44px;
}
.shared-request__each {
  font-size: 14px;
  margin: 0;
  text-align: center;
  flex-shrink: 0;
}
.shared-request__rounding {
  font-size: 11px;
  line-height: 1.4;
  margin: 0 18px;
  color: var(--text-secondary);
  text-align: center;
  overflow-wrap: anywhere;
}
.shared-request__own {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  border: 0;
  background: none;
  width: 100%;
  padding: 0 20px;
  font-size: 12px;
  color: var(--text-primary);
  flex-shrink: 0;
}
.shared-request__own small {
  color: var(--text-secondary);
  font-size: 11px;
}
.shared-request__switch {
  width: 34px;
  height: 23px;
  display: inline-block;
  flex-shrink: 0;
  border-radius: 30px;
  background: var(--border-card);
  padding: 3px;
}
.shared-request__switch:after {
  content: '';
  display: block;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: white;
  transition: transform 0.15s;
}
.shared-request__switch--on {
  background: var(--brand-accent-text);
}
.shared-request__switch--on:after {
  transform: translateX(11px);
}
.shared-request__total {
  text-align: center;
  padding: 8px 20px;
}
.shared-request__amount {
  font-size: 36px;
  line-height: 1.25;
  font-weight: 750;
  letter-spacing: -0.02em;
  margin: 7px 0 0;
  overflow-wrap: anywhere;
}
.shared-request__amount small {
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-secondary);
  margin-left: 6px;
}
.shared-request__currency {
  min-height: 44px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
}
.shared-request__list-label {
  margin: 5px 20px 8px;
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 11px;
}
.shared-request__amounts {
  margin: 0 20px;
  border: 1px solid var(--border-card);
  border-radius: 17px;
  overflow: hidden;
  flex-shrink: 0;
}
.shared-request__person {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  min-height: 76px;
  border-bottom: 1px solid var(--border-card);
}
.shared-request__person:last-child {
  border: 0;
}
.shared-request__person :deep(.contact-avatar) {
  width: 34px !important;
  height: 34px !important;
  font-size: 11px !important;
}
.shared-request__name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.shared-request__entry {
  width: 137px;
  flex-shrink: 0;
  text-align: right;
}
.shared-request__entry input {
  min-height: 44px;
  width: 100%;
  min-width: 0;
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid transparent;
  border-radius: 9px;
  text-align: right;
  padding: 8px 10px;
  font:
    600 16px 'Manrope',
    sans-serif;
  font-variant-numeric: tabular-nums;
}
.shared-request__entry input:focus {
  border-color: var(--brand-accent-text);
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
}
.shared-request__entry input[aria-invalid='true'] {
  border-color: var(--color-negative);
}
.shared-request__entry small,
.shared-request__person--own small {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 400;
  margin-top: 3px;
}
.shared-request__person--own {
  width: 100%;
  text-align: left;
  background: var(--bg-input);
  color: var(--text-primary);
  border: 0;
}
.shared-request__person--own strong {
  font-size: 14px;
  text-align: right;
  font-weight: 600;
  flex-shrink: 0;
  max-width: 45%;
  overflow-wrap: anywhere;
}
.shared-request__feedback {
  font-size: 12px;
  text-align: center;
  color: var(--text-secondary);
  margin: 8px 20px;
}
.shared-request__feedback--error {
  color: var(--color-negative);
}
.shared-request__footer .form-sheet-primary {
  width: 100%;
}
.shared-request__footer {
  flex-shrink: 0;
  padding: 4px 20px 0;
  background: var(--bg-card);
}
.shared-request__footer .request-note {
  padding: 0;
  margin-bottom: 8px;
}
.shared-request__address {
  min-height: 44px;
  display: block;
  flex-shrink: 0;
  margin: 0 auto;
  border: 0;
  background: none;
  font-size: 11px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
/* Above the keypad, close to the action, when there is room. */
.shared-request__equal .shared-request__address {
  margin-top: auto;
}
.shared-request__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px;
  color: var(--text-secondary);
}
.shared-request__spin {
  animation: shared-spin 1s linear infinite;
}
button:focus-visible {
  outline: 2px solid var(--chat-focus, #2563eb);
  outline-offset: 2px;
}
@keyframes shared-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shared-request__switch:after {
    transition: none;
  }
  .shared-request__spin {
    animation: none;
  }
}
@media (max-width: 360px) {
  .shared-request__header {
    padding: 0 12px;
    grid-template-columns: 62px minmax(0, 1fr) 62px;
  }
  .shared-request__header h2 {
    font-size: 15px;
  }
  .shared-request__methods,
  .shared-request__amounts {
    margin-left: 16px;
    margin-right: 16px;
  }
  .shared-request__methods button {
    font-size: 12px;
  }
  .shared-request__person {
    gap: 7px;
    padding: 6px 9px;
  }
  .shared-request__entry {
    width: 115px;
  }
  .shared-request__person > label {
    font-size: 13px;
  }
  .shared-request__footer .form-sheet-primary {
    width: 100%;
  }
  .shared-request__footer {
    padding-left: 16px;
    padding-right: 16px;
  }
  .shared-request__equal :deep(.amount-keypad__keys) {
    gap: 6px;
    padding: 6px 16px 0;
  }
  .shared-request__equal :deep(.amount-keypad__key) {
    height: 44px;
  }
  .shared-request__equal :deep(.amount-keypad__primary) {
    font-size: 35px !important;
  }
  .shared-request__amount {
    font-size: 32px;
  }
}
@media (max-height: 720px) {
  .shared-request__people {
    display: none;
  }
  .shared-request__equal :deep(.amount-keypad__keys) {
    gap: 5px;
  }
  .shared-request__equal :deep(.amount-keypad__key) {
    height: 44px;
  }
  .shared-request__equal :deep(.amount-keypad__primary) {
    font-size: 34px !important;
  }
  .shared-request__equal :deep(.amount-keypad__secondary) {
    min-height: 34px;
  }
  .shared-request__equal {
    overflow-y: auto;
  }
  .shared-request__rounding {
    font-size: 10px;
  }
}
</style>
