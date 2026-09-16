<template>
  <q-dialog :model-value="modelValue" position="bottom" :persistent="busy" :aria-label="$t('Private key')" @update:model-value="close">
    <q-card class="private-key-sheet">
      <header>
        <div><span class="private-key-kicker">{{ $t('Private key') }}</span><h2>{{ name }}</h2></div>
        <q-btn flat round :disable="busy" :aria-label="$t('Close')" @click="close"><Icon icon="tabler:x" width="20" /></q-btn>
      </header>
      <p class="private-key-public">{{ npub.slice(0, 16) }}…{{ npub.slice(-8) }}</p>
      <div class="private-key-note"><Icon icon="tabler:lock" width="24" /><p>{{ $t('Kept hidden for your privacy. Anyone with this key can use this identity.') }}</p></div>
      <p>{{ $t('Copy only to an app you trust. Never send it in a message.') }}</p>
      <p v-if="error" role="alert" class="private-key-error">{{ error }}</p>
      <p v-if="copied" role="status">{{ $t('Private key copied') }}</p>
      <q-btn unelevated no-caps class="private-key-copy" :loading="busy" :label="copied ? $t('Done') : $t('Copy private key')" @click="copied ? close() : copyKey()" />
    </q-card>
  </q-dialog>
</template>

<script setup>
import { getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useIdentityStore } from '../../stores/identity';
import { useWalletStore } from '../../stores/wallet';
import { isBiometricAvailable, authenticate } from '../../utils/biometric';
import { copySensitive } from '../../utils/sensitiveClipboard';

const props = defineProps({ modelValue: Boolean, account: { type: Number, default: null }, name: { type: String, default: '' }, npub: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const { proxy } = getCurrentInstance();
const t = key => proxy.$t(key);
const identity = useIdentityStore();
const wallet = useWalletStore();
const busy = ref(false);
const copied = ref(false);
const error = ref('');
let revision = 0;
watch(() => [props.modelValue, props.account, identity.fingerprint], () => { revision++; copied.value = false; error.value = ''; });
onBeforeUnmount(() => { revision++; });
function close() { if (!busy.value) emit('update:modelValue', false); }

async function copyKey() {
  if (busy.value || props.account === null) return;
  const request = revision;
  const account = props.account;
  busy.value = true;
  error.value = '';
  try {
    if (wallet.biometricsEnabled) {
      const { available } = await isBiometricAvailable();
      if (available && !await authenticate({ reason: t('Copy private key'), title: 'BuhoGO', subtitle: props.name, useFallback: true })) {
        error.value = t('Unlock was not completed. Try again when you are ready.');
        return;
      }
    }
    if (request !== revision || !props.modelValue) return;
    // Only a local reference: never render or cache nsec in component/store state.
    const { nsec } = await identity.revealNostrSecret(account);
    if (request !== revision || !props.modelValue) return;
    await copySensitive(nsec);
    copied.value = true;
    // The best-effort clipboard wipe intentionally survives closing this sheet.
  } catch {
    if (request === revision) error.value = t('Private key could not be copied. Try again.');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.private-key-sheet { width: 100%; max-width: 520px; max-height: 90dvh; overflow-y: auto; padding: 24px 24px max(24px, env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; background: var(--bg-card); color: var(--text-primary); }
.private-key-sheet header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.private-key-kicker { color: var(--text-secondary); font-size: 13px; }
.private-key-sheet h2 { font: 700 22px/1.3 'Manrope', sans-serif; margin: 4px 0; overflow-wrap: anywhere; }
.private-key-sheet p { color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
.private-key-public { font-family: var(--font-mono); overflow-wrap: anywhere; }
.private-key-note { display: flex; gap: 12px; padding: 16px; background: var(--bg-input); border-radius: 16px; margin: 20px 0; }
.private-key-note svg { flex-shrink: 0; }
.private-key-note p { margin: 0; color: var(--text-primary); }
.private-key-copy { width: 100%; min-height: 48px; border-radius: 14px; background: var(--text-primary); color: var(--bg-card); }
.private-key-error { color: var(--color-red) !important; }
</style>
