<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    aria-labelledby="backup-choices-title"
    @hide="openSelectedBackup"
  >
    <q-card class="backup-choices" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="backup-choices-handle" aria-hidden="true"><span /></div>
      <div class="backup-choices-header">
        <h2 id="backup-choices-title">{{ $t('Backups') }}</h2>
        <q-btn flat round :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <div class="backup-choices-list">
        <button v-for="choice in choices" :key="choice.key" type="button" class="backup-choice" @click="selectBackup(choice)">
          <span class="backup-choice-icon"><BackupSubjectIcon :kind="choice.kind" :size="28" /></span>
          <span class="backup-choice-copy">
            <strong>{{ $t(choice.kind === 'wallet' ? 'Bitcoin backup' : 'Identity backup') }}</strong>
            <span class="backup-choice-detail">{{ choice.detail }}</span>
            <span class="backup-choice-state" :class="{ 'is-saved': choice.saved }">
              <Icon v-if="choice.saved" icon="tabler:check" width="14" height="14" aria-hidden="true" />
              {{ $t(choice.saved ? 'Words checked' : 'Not checked yet') }}
            </span>
          </span>
          <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
        </button>
      </div>
      <button v-if="cloudAvailable" type="button" class="backup-choice backup-choice-cloud" @click="selectBackup({ kind: 'cloud' })">
        <span class="backup-choice-icon"><BackupKeyring :size="28" /></span>
        <span class="backup-choice-copy">
          <strong>{{ $t('Google Drive backup') }}</strong>
          <span class="backup-choice-detail">{{ $t('Optional backup') }}</span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
      </button>
      <p v-if="!groups.length" class="backup-choices-intro">
        {{ $t('For connected wallets, keep the recovery details from your wallet provider.') }}
      </p>
    </q-card>
  </q-dialog>

  <!-- Reuse the same authentication, reveal and verification flows as Settings and Identity. -->
  <SparkSeedPhraseDialog v-model="showWalletWords" :wallet-id="selectedWalletId" :mode="phraseMode" />
  <IdentitySeedPhraseDialog v-model="showIdentityWords" :mode="phraseMode" :label-paper="groups.length > 0" />
  <CloudBackupSheet v-if="cloudAvailable" v-model="showCloudBackup" />
</template>

<script setup>

import { computed, getCurrentInstance, ref } from 'vue';
import BackupKeyring from './BackupKeyring.vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { bitcoinBackupName, walletBackupGroups } from '../utils/backupStatus.js';
import { isCloudBackupPlatform } from '../services/cloudStorage.js';
import BackupSubjectIcon from './BackupSubjectIcon.vue';
import SparkSeedPhraseDialog from './SparkSeedPhraseDialog.vue';
import IdentitySeedPhraseDialog from './IdentitySeedPhraseDialog.vue';
import CloudBackupSheet from './CloudBackupSheet.vue';

const wallet = useWalletStore();
const identity = useIdentityStore();
const groups = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp));
const cloudAvailable = isCloudBackupPlatform();
const { proxy } = getCurrentInstance();
const t = key => proxy.$t(key);
// Each button names the backup first; wallet/provider details remain subordinate.
const choices = computed(() => [
  ...groups.value.map(group => ({
    key: group.key, kind: 'wallet', walletId: group.walletId, saved: group.saved,
    mode: group.saved ? 'view' : 'backup',
    detail: `${bitcoinBackupName(group, t)} · ${group.type === 'spark' ? 'Spark' : 'Arkade'}`,
  })),
  ...(identity.bootstrapped ? [{
    key: 'identity', kind: 'identity', saved: identity.backupConfirmed,
    mode: identity.backupConfirmed ? 'view' : 'backup', detail: t('Name, photo and contacts'),
  }] : []),
]);
const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);
const open = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) });
const showWalletWords = ref(false);
const showIdentityWords = ref(false);
const showCloudBackup = ref(false);
const selectedWalletId = ref(null);
const phraseMode = ref('backup');
let pendingChoice = null;

function selectBackup(choice) {
  pendingChoice = choice;
  open.value = false;
}

// Wait for the chooser to close so Quasar transfers focus to a single dialog.
function openSelectedBackup() {
  const choice = pendingChoice;
  pendingChoice = null;
  if (!choice) return;
  phraseMode.value = choice.mode || 'backup';
  if (choice.kind === 'wallet') {
    selectedWalletId.value = choice.walletId;
    showWalletWords.value = true;
  } else if (choice.kind === 'identity') {
    showIdentityWords.value = true;
  } else {
    showCloudBackup.value = true;
  }
}
</script>

<style scoped>
.backup-choices {
  width: 100%;
  max-width: 520px;
  max-height: 85dvh;
  overflow-y: auto;
  border-radius: 24px 24px 0 0;
  padding: 0 16px max(20px, env(safe-area-inset-bottom, 0px));
  color: var(--text-primary);
}
.backup-choices-handle { display: flex; justify-content: center; padding: 10px; }
.backup-choices-handle span { width: 32px; height: 4px; border-radius: 4px; background: var(--text-muted); opacity: .35; }
.backup-choices-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.backup-choices-header h2 { margin: 0; font: 700 21px/1.3 'Manrope', sans-serif; }
.backup-choices-intro { margin: 10px 0 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.backup-choices-list { display: grid; gap: 8px; margin-top: 20px; }
.backup-choice { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 88px; padding: 16px; border: 0; border-radius: 18px; background: var(--bg-input); color: var(--text-primary); text-align: start; font: inherit; cursor: pointer; }
.backup-choice:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; }
.backup-choice:active { background: var(--brand-accent-soft); }
.backup-choice-icon { display: grid; place-items: center; flex-shrink: 0; width: 32px; color: var(--text-secondary); }
.backup-choice-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.backup-choice-copy strong { font-size: 16px; font-weight: 650; line-height: 1.35; }
.backup-choice-detail { color: var(--text-secondary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.backup-choice-state { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.backup-choice-state.is-saved { color: var(--brand-accent-text); }
.backup-choice-state svg, .backup-choice-chevron { flex-shrink: 0; }
.backup-choice-chevron { color: var(--text-secondary); }
.backup-choice-cloud { margin-top: 16px; background: transparent; }
</style>
