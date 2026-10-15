<!-- One flow from Receive and outgoing receipts; the goal stays private to its owner. -->
<template>
  <RequestFromSheet
    :key="opening"
    :model-value="modelValue && step === 'pick'"
    multiple
    v-model:selected="people"
    :exclude-pubkey="owner"
    @update:model-value="close"
    @next="step = 'amount'"
  />
  <SharedRequestSheet
    :key="opening"
    :model-value="modelValue && step === 'amount'"
    :people="people"
    :address="profile.lud16 || ''"
    :initial-sats="initialSats"
    :initial-note="initialNote"
    :repayment="Boolean(source)"
    :fiat-code="fiatCode"
    :fiat-rate="fiatRate"
    :submitting="submitting"
    :error="error"
    :bip177="walletStore.useBip177Format !== false"
    @back="step = 'pick'"
    @close="close"
    @open-address="openAddress"
    @submit="send"
  />
  <IdentityGetPaidSheet
    v-model="getPaidOpen"
    @update:model-value="onAddressModel"
  />
</template>
<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RequestFromSheet from './RequestFromSheet.vue'
import SharedRequestSheet from './SharedRequestSheet.vue'
import IdentityGetPaidSheet from '../identity/IdentityGetPaidSheet.vue'
import { useChatRuntime } from '../../composables/useChatRuntime.js'
import { describeDmError } from '../../composables/useContactChat.js'
import { useAddressBookStore } from '../../stores/addressBook.js'
import { useProfileStore } from '../../stores/profile.js'
import { useWalletStore } from '../../stores/wallet.js'
import { useMessagesStore } from '../../stores/messages.js'
import { contactChatRoute, unknownChatRoute } from '../../services/dm/routes.js'

const props = defineProps({
  modelValue: Boolean,
  initialSats: { type: Number, default: 0 },
  initialNote: { type: String, default: '' },
  source: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const router = useRouter()
const runtime = useChatRuntime()
const addressBook = useAddressBookStore()
const profile = useProfileStore()
const walletStore = useWalletStore()
const messages = useMessagesStore()
const step = ref('pick'),
  opening = ref(0),
  people = ref([]),
  owner = ref(null)
const draftId = ref(''),
  submitting = ref(false),
  error = ref(''),
  getPaidOpen = ref(false)
const fiatCode = computed(() => walletStore.preferredFiatCurrency || 'USD')
const fiatRate = computed(() => walletStore.exchangeRateFor(fiatCode.value))
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    opening.value += 1
    step.value = 'pick'
    people.value = []
    error.value = ''
    submitting.value = false
    owner.value = runtime.me.value
    draftId.value = crypto.randomUUID()
  }
)
watch(runtime.me, (me) => {
  if (props.modelValue && me !== owner.value) {
    getPaidOpen.value = false
    emit('update:modelValue', false)
  }
})
function close() {
  if (!submitting.value) emit('update:modelValue', false)
}
function openAddress() {
  step.value = 'address'
  getPaidOpen.value = true
}
function onAddressModel(open) {
  if (!open) step.value = 'amount'
}
async function send(payload) {
  if (submitting.value || runtime.me.value !== owner.value) return
  const identity = owner.value,
    chosen = [...people.value],
    id = draftId.value
  submitting.value = true
  error.value = ''
  try {
    const goalId = await runtime.createRequestGoal({
      ...payload,
      id,
      repayment: Boolean(props.source),
      source: props.source
    })
    if (runtime.me.value !== identity) return
    // Save new contacts only when their request reached the durable outbox.
    const savedIds = new Map()
    for (const person of chosen) {
      if (person.contact || !person.profile) continue
      const share = messages
        .requestGoal(goalId)
        ?.shares.find((share) => share.pubkey === person.pubkey)
      if (
        !messages
          .thread(person.pubkey)
          .messages.some((message) => message.id === share?.requestId)
      )
        continue
      if (runtime.me.value !== identity) return
      try {
        const entry = await addressBook.addNostrContact({
          pubkey: person.pubkey,
          npub: person.profile.npub,
          event: person.profile.event,
          relayHints: person.profile.relays,
          allowWithoutLightningAddress: true
        })
        if (entry?.id) savedIds.set(person.pubkey, entry.id)
      } catch {
        /* The pubkey chat remains reachable when contact saving fails. */
      }
    }
    if (runtime.me.value !== identity) return
    emit('update:modelValue', false)
    // One person: the request lives in your chat with them. Several: their progress.
    if (chosen.length === 1) {
      const [person] = chosen
      const contactId = person.contact?.id || savedIds.get(person.pubkey)
      await router.push(
        contactId ? contactChatRoute(contactId) : unknownChatRoute(person.pubkey)
      )
      return
    }
    await router.push({ name: 'request-goal', params: { goalId } })
  } catch (cause) {
    if (runtime.me.value !== identity) return
    // Once committed, its amounts are fixed. A failed save/send returns to
    // progress, not an editable form that could silently resend old amounts.
    if (messages.requestGoal(id)) {
      emit('update:modelValue', false)
      await router.push({ name: 'request-goal', params: { goalId: id } })
      return
    }
    error.value = describeDmError(cause, { t }).message
  } finally {
    if (runtime.me.value === identity) submitting.value = false
  }
}
</script>
