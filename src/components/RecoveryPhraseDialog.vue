<template>
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    :persistent="busy"
    class="recovery-dialog"
    :aria-label="title"
    @update:model-value="close"
  >
    <q-card class="recovery-card">
      <header class="recovery-header">
        <button v-if="step === 'prepare' || step === 'done'" type="button" class="recovery-nav" :disabled="busy" @click="close">
          {{ $t(step === 'done' ? 'Close' : 'Cancel') }}
        </button>
        <button v-else type="button" class="recovery-nav" :disabled="busy" @click="back">
          <Icon icon="tabler:chevron-left" width="18" height="18" />{{ $t('Back') }}
        </button>
        <div class="recovery-subject"><BackupSubjectIcon :kind="activeKind" :size="24" /><span>{{ title }}</span></div>
      </header>

      <div ref="body" class="recovery-body">
        <p v-if="step !== 'prepare'" class="recovery-context">{{ detail }}</p>
        <ol v-if="mode === 'backup' && step !== 'done'" class="recovery-progress" :aria-label="$t('Backup progress')">
          <li v-for="(item, index) in stages" :key="item" :aria-current="stageIndex === index ? 'step' : undefined" :class="{ 'is-current': stageIndex === index, 'is-complete': stageIndex > index }">
            <span aria-hidden="true">{{ index + 1 }}</span>{{ $t(item) }}
          </li>
        </ol>

        <template v-if="step === 'prepare'">
          <BackupCoverage :selected="activeKind" />
          <h1 ref="heading" tabindex="-1">{{ mode === 'view' ? $t('View recovery words') : $t('Keep a way back') }}</h1>
          <p v-if="!isIdentity" class="recovery-context">{{ detail }}</p>
          <p v-if="mode === 'backup'" class="recovery-lede">{{ benefit }}</p>
          <div v-if="mode === 'backup'" class="recovery-note">
            <strong>{{ $t('Get a pen and paper') }}</strong>
            <p>{{ $t('Write the words in order, then check your copy. Keep the paper somewhere private.') }}</p>
          </div>
          <p class="recovery-footnote">{{ risk }}</p>
          <p v-if="wallet.biometricsEnabled" class="recovery-footnote">{{ $t('Your phone will ask you to unlock before showing the words.') }}</p>
        </template>

        <template v-else-if="step === 'write'">
          <h1 ref="heading" tabindex="-1">{{ mode === 'view' ? $t('Your recovery words') : $t('Write down each word') }}</h1>
          <p class="recovery-lede">{{ $t('Label your paper: {label}', { label: paperLabel }) }}</p>
          <div class="recovery-reveal-bar">
            <span v-if="visible" class="recovery-timer">{{ $t('Hides in {time}', { time: countdown }) }}</span>
            <span v-else>{{ $t('Words are hidden') }}</span>
            <button type="button" class="recovery-nav" :aria-pressed="visible" @click="visible ? hide() : reveal()">
              <Icon :icon="visible ? 'tabler:eye-off' : 'tabler:eye'" width="18" height="18" />
              {{ visible ? $t('Hide words') : $t('Show words') }}
            </button>
          </div>
          <ol class="recovery-words" :aria-label="$t('Recovery words')">
            <li v-for="(word, index) in words" :key="index">
              <span class="recovery-word-number" aria-hidden="true">{{ index + 1 }}</span>
              <span v-if="visible"><span class="sr-only">{{ $t('Word {number}', { number: index + 1 }) }}: </span>{{ word }}</span>
              <span v-else aria-hidden="true" class="recovery-placeholder">••••••</span>
            </li>
          </ol>
          <p class="recovery-footnote">{{ $t('Keep these words offline. Do not take a photo or share them.') }}</p>
        </template>

        <template v-else-if="step === 'check'">
          <h1 ref="heading" tabindex="-1">{{ $t('Check your paper') }}</h1>
          <p class="recovery-lede">{{ $t('Use your paper to tap every word in its original order.') }}</p>
          <MnemonicOrderVerify :mnemonic="words" :busy="busy" @verify-success="confirm" @show-phrase="back" />
        </template>

        <template v-else-if="step === 'done'">
          <div class="recovery-complete-mark"><BackupSubjectIcon :kind="activeKind" :size="52" /><Icon icon="tabler:circle-check-filled" width="26" height="26" /></div>
          <h1 ref="heading" tabindex="-1">{{ $t('Backup checked') }}</h1>
          <p class="recovery-lede">{{ $t('Your copy matches. Keep the paper in a private place you can find again.') }}</p>
          <div class="recovery-note"><strong>{{ paperLabel }}</strong><p>{{ $t('Only this set of recovery words was checked.') }}</p></div>
          <BackupCoverage :selected="activeKind" />
        </template>

        <div v-if="error" class="recovery-error" role="alert">
          <Icon icon="tabler:alert-circle" width="20" height="20" /><p>{{ errorMessage }}</p>
        </div>
      </div>

      <footer v-if="step !== 'check'" class="recovery-footer">
        <q-btn v-if="step === 'prepare'" unelevated no-caps class="recovery-primary" :loading="busy" :label="$t('Continue')" @click="start" />
        <q-btn v-else-if="step === 'write' && mode === 'backup'" unelevated no-caps class="recovery-primary" :disable="!visible" :label="$t('Check my backup')" @click="check" />
        <template v-else-if="step === 'done' && nextBackup">
          <q-btn unelevated no-caps class="recovery-primary" :label="nextBackup.label" @click="continueWithNextBackup" />
          <button type="button" class="recovery-nav recovery-cancel" @click="close">{{ $t('Done for now') }}</button>
        </template>
        <q-btn v-else unelevated no-caps class="recovery-primary" :label="$t('Done')" @click="close" />
        <button v-if="step === 'write'" type="button" class="recovery-nav recovery-cancel" @click="close">{{ $t('Finish later') }}</button>
      </footer>
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
import BackupSubjectIcon from './BackupSubjectIcon.vue';
import BackupCoverage from './BackupCoverage.vue';
import { bitcoinBackupName, walletBackupGroups } from '../utils/backupStatus.js';
import MnemonicOrderVerify from './MnemonicOrderVerify.vue';

const props = defineProps({
  modelValue: Boolean,
  kind: { type: String, required: true, validator: value => ['wallet', 'identity'].includes(value) },
  mode: { type: String, required: true, validator: value => ['backup', 'view'].includes(value) },
  walletId: { type: String, default: null },
});
const emit = defineEmits(['update:modelValue', 'verified']);
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const wallet = useWalletStore();
const identity = useIdentityStore();
const target = ref(null);
const fingerprint = ref(null);
const activeKind = ref(props.kind);
const mode = ref(props.mode);
const heading = ref(null);
const body = ref(null);
const stages = ['Prepare', 'Write', 'Check'];
const isIdentity = computed(() => activeKind.value === 'identity');
const title = computed(() => isIdentity.value ? t('Identity backup') : t('Bitcoin backup'));
const groups = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp));
const detail = computed(() => isIdentity.value ? t('Name, photo and contacts')
  : target.value?.type === 'spark' ? `Spark · ${groups.value.find(group => group.type === 'spark')?.names.join(' · ') || t('Wallet')}`
    : `Arkade · ${target.value?.name || t('Wallet')}`);
const nextBackup = computed(() => {
  const group = groups.value.find(group => !group.saved);
  if (group) {
    const name = bitcoinBackupName(group, t);
    return { kind: 'wallet', walletId: group.walletId, label: name === t('Your bitcoin') ? t('Back up bitcoin') : t('Back up {wallet}', { wallet: name }) };
  }
  if (identity.bootstrapped && !identity.backupConfirmed) return { kind: 'identity', label: t('Back up identity') };
  return null;
});
const paperLabel = computed(() => isIdentity.value ? `BuhoGO · ${t('Identity')}` : `BuhoGO · ${target.value?.type === 'arkade' ? 'Arkade' : 'Spark'}`);
const benefit = computed(() => isIdentity.value
  ? t('These words restore your identity, including your name, photo and contacts.')
  : t('These words restore your wallet and access to its bitcoin.'));
const risk = computed(() => isIdentity.value
  ? t('Anyone with these words can use your identity.')
  : t('Anyone with these words can spend your bitcoin.'));

const flow = useRecoveryPhraseFlow({
  async authorize() {
    if (!wallet.biometricsEnabled) return true;
    const { available } = await isBiometricAvailable();
    // Preserve the existing web/unavailable-device behavior and native PIN fallback.
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
const { step, words, visible, busy, error, remaining, reset, start, hide, reveal, check, back, confirm } = flow;
const stageIndex = computed(() => ['prepare', 'write', 'check'].indexOf(step.value));
const countdown = computed(() => `${Math.floor(remaining.value / 60)}:${String(remaining.value % 60).padStart(2, '0')}`);
const errorMessage = computed(() => error.value === 'auth'
  ? t('Unlock was not completed. Try again when you are ready.')
  : error.value === 'save' ? t('Backup status could not be saved. Your paper is unchanged. Try confirming again.')
    : t('Recovery words could not be opened. Try again.'));

function close() { if (!busy.value) { reset(); emit('update:modelValue', false); } }
function continueWithNextBackup() {
  const next = nextBackup.value;
  if (!next) return;
  reset();
  activeKind.value = next.kind;
  mode.value = 'backup';
  target.value = wallet.wallets.find(w => w.id === next.walletId) || null;
  fingerprint.value = identity.fingerprint;
}
watch(() => props.modelValue, (open) => {
  reset();
  if (open) {
    activeKind.value = props.kind;
    mode.value = props.mode;
    const active = wallet.activeWallet;
    target.value = props.walletId ? wallet.wallets.find(w => w.id === props.walletId)
      : (['spark', 'arkade'].includes(active?.type) ? active : wallet.sparkWallet || wallet.arkadeWallet);
    fingerprint.value = identity.fingerprint;
  }
}, { immediate: true });
watch(() => identity.fingerprint, (value, previous) => {
  if (props.modelValue && isIdentity.value && previous && value !== previous) reset();
});
watch(step, async () => { await nextTick(); if (body.value) body.value.scrollTop = 0; heading.value?.focus(); });
// A hidden document must never retain visible words or a visible verification grid.
function onVisibilityChange() { if (document.hidden && props.modelValue && step.value !== 'done' && (step.value !== 'prepare' || !busy.value)) reset(); }
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisibilityChange); reset(); });
</script>

<style scoped>
.recovery-card { display: flex; flex-direction: column; width: 560px; max-width: 100%; max-height: 90dvh; background: var(--bg-primary); color: var(--text-primary); border-radius: 24px; }
.recovery-header { display: flex; align-items: center; gap: 12px; padding: 12px 20px; flex-shrink: 0; }
.recovery-subject { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex: 1; min-width: 0; font: 600 14px/1.3 'Manrope', sans-serif; text-align: right; }
.recovery-nav { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 44px; min-width: 44px; padding: 8px; border: 0; background: transparent; color: var(--text-secondary); font: inherit; cursor: pointer; border-radius: 10px; }
.recovery-nav:disabled { opacity: .5; cursor: default; }
.recovery-nav:focus-visible, .recovery-primary:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; }
.recovery-body { padding: 20px 28px 24px; overflow-y: auto; min-height: 0; flex: 1; }
.recovery-context { margin: 0 0 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.recovery-progress { display: flex; padding: 0; margin: 0 0 26px; list-style: none; gap: 14px; flex-wrap: wrap; }
.recovery-progress li { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
.recovery-progress li > span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bg-input); }
.recovery-progress .is-current { color: var(--text-primary); font-weight: 700; }
.recovery-progress .is-current > span, .recovery-progress .is-complete > span { background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.recovery-hero { margin: 12px 0 20px; }
.recovery-body h1 { font: 700 27px/1.2 'Manrope', sans-serif; letter-spacing: -.03em; margin: 0 0 14px; outline: 0; overflow-wrap: anywhere; }
.recovery-lede { color: var(--text-secondary); font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
.recovery-note { padding: 18px; background: var(--bg-card); border-radius: 16px; font-size: 14px; line-height: 1.5; }
.recovery-note p { margin: 6px 0 0; color: var(--text-secondary); }
.recovery-footnote { margin: 18px 0 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.recovery-reveal-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.recovery-timer { font-variant-numeric: tabular-nums; }
.recovery-words { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 8px 0 0; padding: 0; list-style: none; }
.recovery-words li { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 10px; background: var(--bg-input); border-radius: 10px; font-size: 14px; }
.recovery-word-number { color: var(--text-secondary); font-size: 11px; }
.recovery-placeholder { color: var(--text-secondary); letter-spacing: 2px; }
.recovery-footer { flex-shrink: 0; padding: 16px 28px max(20px, env(safe-area-inset-bottom)); }
.recovery-primary { width: 100%; min-height: 48px; border-radius: 14px; background: var(--brand-accent); color: #052d20; font-weight: 700; font-size: 15px; }
.recovery-cancel { display: flex; margin: 4px auto -8px; font-size: 13px; }
.recovery-error { display: flex; align-items: flex-start; gap: 8px; background: var(--color-warn-soft); color: var(--text-primary); padding: 14px; border-radius: 12px; margin-top: 18px; font-size: 14px; }
.recovery-error p { margin: 0; }
.recovery-error svg { flex-shrink: 0; }
.recovery-complete-mark { display: inline-flex; align-items: flex-end; margin: 30px 0 24px; color: var(--brand-accent-text); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 599px) {
  .recovery-card { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .recovery-header { padding-top: max(12px, var(--safe-top, 0px)); }
  .recovery-body { padding: 20px; }
  .recovery-footer { padding-left: 20px; padding-right: 20px; }
}
@media (max-width: 359px) { .recovery-words { grid-template-columns: repeat(2, minmax(0, 1fr)); } .recovery-progress { gap: 9px; } }
</style>
