<template>
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    :persistent="busy"
    class="recovery-dialog"
    :aria-label="title"
    @update:model-value="close"
    @hide="$emit('closed')"
  >
    <q-card class="recovery-card">
      <BackupSuccessScreen v-if="step === 'done'" :kind="kind" @done="close" />
      <template v-else>
        <header class="recovery-header">
          <button v-if="step !== 'prepare'" type="button" class="recovery-nav" :disabled="busy" :aria-label="$t('Back')" @click="goBack">
            <Icon icon="tabler:arrow-left" width="24" height="24" />
          </button>
          <h1 ref="heading" tabindex="-1" :class="{ 'recovery-sr-only': step !== 'prepare' }">{{ title }}</h1>
          <button v-if="step === 'prepare'" type="button" class="recovery-nav" :disabled="busy" :aria-label="$t('Close')" @click="close">
            <Icon icon="tabler:x" width="26" height="26" />
          </button>
        </header>

        <div ref="body" class="recovery-body" :class="`recovery-body--${step}`">
          <template v-if="step === 'prepare'">
            <p class="recovery-intro">{{ $t('wosBackup.intro') }}</p>
            <div class="recovery-notice">
              <p>{{ $t(wallet.biometricsEnabled ? 'wosBackup.revealWithUnlock' : 'wosBackup.reveal') }}</p>
              <p>{{ $t(isIdentity ? 'wosBackup.keepIdentity' : 'wosBackup.keepWallet') }}</p>
              <p>{{ $t('wosBackup.privatePlace') }}</p>
              <p>{{ $t('wosBackup.noPhoto') }} <strong>{{ $t('wosBackup.usePaper') }}</strong></p>
            </div>
            <svg class="recovery-illustration" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 8h34l18 18v62H12zM46 8v20h18M23 23h12M23 40h29M23 52h29M23 64h29M23 76h29M77 10h10v58l-5 18-5-18zM77 23h10M82 23v45M77 68h10" />
            </svg>
          </template>

          <template v-else-if="step === 'write'">
            <p class="recovery-instruction">{{ $t('wosBackup.write') }}</p>
            <p class="recovery-paper-label">{{ paperLabel }}</p>
            <ol class="recovery-word-grid recovery-words" :aria-label="$t('Recovery words')">
              <li v-for="(word, index) in words" :key="index" class="recovery-word-tile">
                <span class="recovery-word-number" aria-hidden="true">{{ index + 1 }}</span>
                <span v-if="visible"><span class="recovery-sr-only">{{ $t('Word {number}', { number: index + 1 }) }}: </span>{{ word }}</span>
                <span v-else aria-hidden="true">••••••</span>
              </li>
            </ol>
            <button v-if="!visible" type="button" class="recovery-show" @click="reveal">{{ $t('Show words') }}</button>
            <p v-if="mode === 'backup'" class="recovery-footnote">{{ $t('wosBackup.checkNext') }}</p>
          </template>

          <template v-else-if="step === 'check'">
            <p class="recovery-instruction">{{ $t('wosBackup.check') }}</p>
            <MnemonicOrderVerify :mnemonic="words" :busy="busy" @complete="checkComplete = $event" />
          </template>

          <div v-if="error" class="recovery-error" role="alert">{{ errorMessage }}</div>
        </div>

        <footer class="recovery-footer">
          <label v-if="step === 'prepare'" class="recovery-acknowledgement">
            <input v-model="acknowledged" type="checkbox" role="switch" :disabled="busy" />
            <span class="recovery-consent-track" aria-hidden="true"><span /></span>
            <span>{{ $t('wosBackup.understand') }}</span>
          </label>
          <q-btn
            unelevated no-caps class="recovery-primary" :loading="busy" :disable="!canContinue"
            :label="mode === 'view' && step === 'write' ? $t('Done') : $t('wosBackup.next')"
            @click="advance"
          />
        </footer>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { isBiometricAvailable, authenticate } from '../utils/biometric';
import { useRecoveryPhraseFlow } from '../composables/useRecoveryPhraseFlow.js';
import { walletBackupGroups } from '../utils/backupStatus.js';
import MnemonicOrderVerify from './MnemonicOrderVerify.vue';
import BackupSuccessScreen from './BackupSuccessScreen.vue';

const props = defineProps({
  modelValue: Boolean,
  kind: { type: String, required: true, validator: value => ['wallet', 'identity'].includes(value) },
  mode: { type: String, required: true, validator: value => ['backup', 'view'].includes(value) },
  walletId: { type: String, default: null },
});
const emit = defineEmits(['update:modelValue', 'verified', 'closed']);
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const wallet = useWalletStore();
const identity = useIdentityStore();
const target = ref(null);
const fingerprint = ref(null);
const acknowledged = ref(false);
const checkComplete = ref(false);
const heading = ref(null);
const body = ref(null);
const isIdentity = computed(() => props.kind === 'identity');
const title = computed(() => t(isIdentity.value ? 'wosBackup.identityTitle' : 'wosBackup.walletTitle'));
const detail = computed(() => isIdentity.value ? t('Identity')
  : target.value?.type === 'spark' ? `${walletBackupGroups(wallet.wallets, wallet.hasBackedUp).find(group => group.type === 'spark')?.names.join(' · ') || t('Wallet')} · Spark`
    : `${target.value?.name || t('Wallet')} · Arkade`);
const paperLabel = computed(() => `BuhoGO · ${detail.value}`);

const flow = useRecoveryPhraseFlow({
  async authorize() {
    if (!wallet.biometricsEnabled) return true;
    const { available } = await isBiometricAvailable();
    if (!available) return true;
    return authenticate({ reason: t('Verify it is you to reveal your recovery phrase'), title: 'BuhoGO', subtitle: title.value, useFallback: true });
  },
  async load() {
    if (isIdentity.value) {
      await identity.ensureIdentity();
      fingerprint.value = identity.fingerprint;
      return identity.getMnemonic();
    }
    if (!target.value) throw new Error('Wallet missing');
    return wallet.getMnemonicForWallet(target.value.id);
  },
  async save() {
    if (isIdentity.value) {
      if (!fingerprint.value || fingerprint.value !== identity.fingerprint) throw new Error('Identity changed');
      await identity.confirmBackup();
    } else {
      if (!wallet.wallets.some(w => w.id === target.value?.id)) throw new Error('Wallet removed');
      await wallet.confirmBackup(target.value.id);
    }
  },
  onVerified: () => emit('verified'),
});
const { step, words, visible, busy, error, reset, start, reveal, check, back, confirm } = flow;
const canContinue = computed(() => step.value === 'prepare' ? acknowledged.value
  : step.value === 'write' ? visible.value : step.value === 'check' && checkComplete.value);
const errorMessage = computed(() => error.value === 'auth'
  ? t('Unlock was not completed. Try again when you are ready.')
  : error.value === 'save' ? t('Backup status could not be saved. Your paper is unchanged. Try confirming again.')
    : t('Recovery words could not be opened. Try again.'));

function resetSession() {
  reset();
  acknowledged.value = false;
  checkComplete.value = false;
}
function close() { if (!busy.value) { resetSession(); emit('update:modelValue', false); } }
async function advance() {
  if (busy.value || !canContinue.value) return;
  if (step.value === 'prepare') {
    await start();
    // A native unlock can background the document. Never reveal until it is visible.
    if (document.hidden) resetSession();
    else if (props.modelValue) reveal();
  } else if (step.value === 'write') {
    if (props.mode === 'view') close();
    else { checkComplete.value = false; check(); }
  } else if (step.value === 'check') await confirm();
}
function goBack() {
  back();
  checkComplete.value = false;
  if (step.value === 'prepare') acknowledged.value = false;
  else if (!document.hidden) reveal();
}
watch(() => props.modelValue, (open) => {
  resetSession();
  if (open) {
    const active = wallet.activeWallet;
    target.value = props.walletId ? wallet.wallets.find(w => w.id === props.walletId)
      : (['spark', 'arkade'].includes(active?.type) ? active : wallet.sparkWallet || wallet.arkadeWallet);
    fingerprint.value = identity.fingerprint;
  }
}, { immediate: true });
watch(() => identity.fingerprint, (value, previous) => {
  if (props.modelValue && isIdentity.value && previous && value !== previous) resetSession();
});
watch(step, async () => { await nextTick(); if (body.value) body.value.scrollTop = 0; heading.value?.focus(); });
function onVisibilityChange() {
  if (document.hidden && props.modelValue && step.value !== 'done' && (step.value !== 'prepare' || !busy.value)) resetSession();
}
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisibilityChange); resetSession(); });
</script>

<style src="../css/recovery.css"></style>
