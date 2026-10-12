<!--
  AddSparkWalletSheet: one more Spark wallet from the recovery phrase already
  on this device. One field (the name, prefilled with a free default) and
  one action; the phrase, the backup and the account number are handled for
  the person. On success the app switches to the new wallet and the parent
  confirms it.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :persistent="creating"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="focusName"
  >
    <q-card class="add-spark-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <button type="button" class="form-sheet-cancel" :disabled="creating" @click="open = false">{{ $t('Cancel') }}</button>
        <h2 class="form-sheet-title">{{ $t('New Spark wallet') }}</h2>
        <span aria-hidden="true"></span>
      </header>

      <form class="add-spark-body" novalidate @submit.prevent="create">
        <div class="add-spark-mark" aria-hidden="true"><WalletBrandMark type="spark" :size="26" /></div>

        <label class="add-spark-label" for="add-spark-name">{{ $t('Wallet Name') }}</label>
        <input
          id="add-spark-name"
          ref="nameInput"
          v-model="name"
          class="add-spark-input"
          name="wallet-name"
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="done"
          :maxlength="maxLength"
          :disabled="creating"
          :aria-invalid="!!error"
          :aria-describedby="error ? 'add-spark-error' : 'add-spark-note'"
          @input="error = ''"
        />
        <p v-if="error" id="add-spark-error" class="form-sheet-error add-spark-error" role="alert">{{ error }}</p>
        <p id="add-spark-note" class="add-spark-note">
          {{ $t('Made from your recovery phrase, so the backup you have already covers it.') }}
          {{ remainingAfter === 0 ? $t("After this one, you can't add more Spark wallets.") : $t('You can add {count} more after this one.', { count: remainingAfter }) }}
        </p>

        <button type="submit" class="form-sheet-primary add-spark-primary" :disabled="creating || !name.trim()">
          <q-spinner v-if="creating" size="18px" :aria-hidden="true" />
          {{ creating ? $t('Creating wallet...') : $t('Create wallet') }}
        </button>
      </form>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue';
import { useWalletStore } from '../../stores/wallet';
import { suggestWalletName } from '../../utils/sparkAccounts.js';
import { MAX_WALLET_NAME_LENGTH, walletNameCopy } from '../../utils/walletNames.js';
import { translateErrorCode } from '../../utils/userErrors';
import WalletBrandMark from '../WalletBrandMark.vue';

const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue', 'created']);

const store = useWalletStore();
// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
// Reach $t through the component proxy, the app's established pattern.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const nameInput = ref(null);
const name = ref('');
const error = ref('');
const creating = ref(false);
const maxLength = MAX_WALLET_NAME_LENGTH;

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const remainingAfter = computed(() => Math.max(0, store.remainingSparkSlots - 1));

watch(() => props.modelValue, (visible) => {
  if (!visible) return;
  name.value = suggestWalletName(t('Wallet'), store.wallets);
  error.value = '';
});

async function focusName() {
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

function describe(failure) {
  if (failure?.problem) return walletNameCopy(failure.problem, t);
  if (failure?.code === 'SPARK_WALLET_LIMIT') return t('You already have the most Spark wallets this app supports.');
  return translateErrorCode(failure, t) || t("Couldn't create the wallet. Check your connection and try again.");
}

async function create() {
  if (creating.value) return;
  creating.value = true;
  error.value = '';
  try {
    const wallet = await store.addSparkWallet({ name: name.value });
    emit('created', wallet);
    open.value = false;
  } catch (failure) {
    console.warn('[add-spark-wallet] not created:', failure?.code || failure?.message || failure);
    error.value = describe(failure);
    await focusName();
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.add-spark-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); }
.add-spark-body { display: flex; flex-direction: column; padding: 12px 20px 0; }
.add-spark-mark { align-self: center; display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: 20px; border-radius: 16px; background: #1a1a1c; }
.add-spark-label { margin-bottom: 8px; color: var(--text-secondary); font-size: 13px; font-weight: 500; }
.add-spark-input { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border-card); border-radius: 12px; background: var(--bg-input); color: var(--text-primary); font: 500 16px/1.4 'Manrope', sans-serif; }
.add-spark-input[aria-invalid="true"] { border-color: var(--color-negative); }
.add-spark-error { margin: 8px 0 0; }
.add-spark-note { margin: 10px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.add-spark-primary { margin-top: 24px; }
body.body--dark .add-spark-mark { background: rgba(255, 255, 255, 0.1); }
input:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
