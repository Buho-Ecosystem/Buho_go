<!--
  RequestMoneyFlow: asking someone for money from Receive.

    1. "Request from" (RequestFromSheet): pick a contact, or find someone new.
    2. How much (RequestSheet, on the app's keypad): starts from the amount
       Receive already had; going back returns to the picker.
    3. Send through the chat runtime, then open the chat, where the request
       lives and shows when it is paid. Someone new is added to the address
       book only once their request went out, so a failed send leaves no
       stray contact.

  Wallet.vue mounts it once and opens it with v-model.
-->
<template>
  <RequestFromSheet :key="opening" :model-value="modelValue && step === 'pick'" @update:model-value="onPickerModel" @pick="onPick" />

  <RequestSheet
    :model-value="modelValue && step === 'amount'"
    :partner-name="givenName"
    :address="profile.lud16 || ''"
    :fiat-code="fiatCode"
    :fiat-rate="fiatRate"
    :initial-sats="initialSats"
    :submitting="submitting"
    :error="error"
    :bip177="walletStore.useBip177Format !== false"
    @update:model-value="onAmountModel"
    @open-address="getPaidOpen = true"
    @submit="send"
  >
    <template #avatar>
      <ContactAvatar :entry="person?.contact || {}" :name="person?.name || ''" :picture="person?.profile?.picture || ''" />
    </template>
  </RequestSheet>

  <IdentityGetPaidSheet v-model="getPaidOpen" />
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import RequestFromSheet from './RequestFromSheet.vue';
import RequestSheet from './RequestSheet.vue';
import ContactAvatar from '../AddressBook/ContactAvatar.vue';
import IdentityGetPaidSheet from '../identity/IdentityGetPaidSheet.vue';
import { useChatRuntime } from '../../composables/useChatRuntime.js';
import { describeDmError } from '../../composables/useContactChat.js';
import { useAddressBookStore } from '../../stores/addressBook';
import { useProfileStore } from '../../stores/profile.js';
import { useWalletStore } from '../../stores/wallet';
import { contactChatRoute, unknownChatRoute } from '../../services/dm/routes.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The amount Receive had typed, to start from; 0 = none. */
  initialSats: { type: Number, default: 0 },
});
const emit = defineEmits(['update:modelValue']);

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const router = useRouter();
const runtime = useChatRuntime();
const addressBook = useAddressBookStore();
const profile = useProfileStore();
const walletStore = useWalletStore();

const step = ref('pick');
/** Counts openings: each one gets a fresh picker, while going back keeps its search. */
const opening = ref(0);
const person = ref(null);
const submitting = ref(false);
const error = ref('');
const getPaidOpen = ref(false);

/** "Request from Anna": the title asks someone by their first name. */
const givenName = computed(() => String(person.value?.name || '').trim().split(/\s+/)[0]);
const fiatCode = computed(() => walletStore.preferredFiatCurrency || 'USD');
const fiatRate = computed(() => walletStore.exchangeRateFor(fiatCode.value));

// Every opening starts at the picker.
watch(() => props.modelValue, (open) => {
  if (!open) return;
  opening.value += 1;
  step.value = 'pick';
  person.value = null;
  error.value = '';
});

function close() {
  emit('update:modelValue', false);
}

function onPickerModel(open) {
  if (!open) close();
}

function onPick(picked) {
  person.value = picked;
  error.value = '';
  step.value = 'amount';
}

/** Closing the amount sheet goes back to the picker; sending moves on. */
function onAmountModel(open) {
  if (open || submitting.value) return;
  error.value = '';
  step.value = 'pick';
}

async function send({ amountSats, note }) {
  const asked = person.value;
  if (!asked || submitting.value) return;
  submitting.value = true;
  error.value = '';
  try {
    await runtime.requestMoney(asked.pubkey, { amountSats, note: note || undefined });
  } catch (cause) {
    error.value = describeDmError(cause, { t, name: asked.name }).message;
    submitting.value = false;
    return;
  }
  const contactId = asked.contact?.id || await addContact(asked);
  submitting.value = false;
  close();
  router.push(contactId ? contactChatRoute(contactId) : unknownChatRoute(asked.pubkey));
}

/** Save someone new after their request went out; the chat still opens if this fails. */
async function addContact({ pubkey, profile: found }) {
  try {
    const entry = await addressBook.addNostrContact({
      pubkey,
      npub: found.npub,
      event: found.event,
      relayHints: found.relays,
      allowWithoutLightningAddress: true,
    });
    return entry?.id || null;
  } catch (cause) {
    console.warn('[request-money] contact not saved:', cause?.message || cause);
    return addressBook.findContactByPubkey(pubkey)?.id || null;
  }
}
</script>
