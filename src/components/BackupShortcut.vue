<template>
  <button
    type="button"
    class="backup-shortcut"
    :aria-label="needsBackup ? `${$t('Backup')}: ${pendingLabel}` : $t('Backups')"
    aria-haspopup="dialog"
    :aria-expanded="showChoices"
    @click="showChoices = true"
  >
    <img src="/icons/backup-keyring.svg" width="29" height="29" alt="" class="backup-shortcut-keyring" />
    <span v-if="needsBackup" class="backup-shortcut-label">
      <span>{{ $t('Backup') }}</span>
      <span>{{ pendingLabel }}</span>
    </span>
  </button>

  <q-dialog
    v-model="showChoices"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    aria-labelledby="backup-choices-title"
    @hide="openSelectedBackup"
  >
    <q-card class="backup-choices" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="backup-choices-handle" aria-hidden="true"><span /></div>
      <div class="backup-choices-header">
        <h2 id="backup-choices-title">{{ $t('Backups') }}</h2>
        <q-btn flat round :aria-label="$t('Close')" @click="showChoices = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <p v-if="groups.length && identity.bootstrapped" class="backup-choices-intro">
        {{ $t('Your wallet and identity have separate recovery words. Save each set.') }}
      </p>
      <div class="backup-choices-list">
        <SettingsRow
          v-for="group in groups"
          :key="group.key"
          icon="tabler:wallet"
          :label="$t('Wallet backup · {wallet}', { wallet: group.type === 'spark' ? 'Spark' : 'Arkade' })"
          @click="selectBackup({ kind: 'wallet', walletId: group.walletId, mode: group.saved ? 'view' : 'backup' })"
        >
          <template #caption>
            <span>{{ group.names.join(' · ') }}</span>
            <span class="backup-choice-state" :class="{ 'backup-choice-state--saved': group.saved }">
              <Icon v-if="group.saved" icon="tabler:check" width="13" height="13" aria-hidden="true" />
              {{ group.saved ? $t('Saved') : $t('Not saved yet') }}
            </span>
          </template>
        </SettingsRow>
        <SettingsRow
          v-if="identity.bootstrapped"
          icon="tabler:user"
          :label="$t('Identity backup')"
          @click="selectBackup({ kind: 'identity', mode: identity.backupConfirmed ? 'view' : 'backup' })"
        >
          <template #caption>
            <span>{{ $t('Bring back your name, photo and contacts.') }}</span>
            <span class="backup-choice-state" :class="{ 'backup-choice-state--saved': identity.backupConfirmed }">
              <Icon v-if="identity.backupConfirmed" icon="tabler:check" width="13" height="13" aria-hidden="true" />
              {{ identity.backupConfirmed ? $t('Saved') : $t('Not saved yet') }}
            </span>
          </template>
        </SettingsRow>
        <SettingsRow
          v-if="cloudAvailable"
          icon="tabler:cloud-lock"
          :label="$t('Google Drive backup')"
          @click="selectBackup({ kind: 'cloud' })"
        />
      </div>
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
import { computed, ref } from 'vue';
import { i18n } from '../boot/i18n';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { walletBackupGroups } from '../utils/backupStatus.js';
import { isCloudBackupPlatform } from '../services/cloudStorage.js';
import SettingsRow from './settings/SettingsRow.vue';
import SparkSeedPhraseDialog from './SparkSeedPhraseDialog.vue';
import IdentitySeedPhraseDialog from './IdentitySeedPhraseDialog.vue';
import CloudBackupSheet from './CloudBackupSheet.vue';

const wallet = useWalletStore();
const identity = useIdentityStore();
const groups = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp));
const walletNeedsBackup = computed(() => groups.value.some((group) => !group.saved));
const identityNeedsBackup = computed(() => identity.bootstrapped && !identity.backupConfirmed);
const needsBackup = computed(() => walletNeedsBackup.value || identityNeedsBackup.value);
const pendingLabel = computed(() => walletNeedsBackup.value
  ? (identityNeedsBackup.value ? i18n.global.t('Wallet & identity') : i18n.global.t('Wallet'))
  : i18n.global.t('Identity'));
const cloudAvailable = isCloudBackupPlatform();
const showChoices = ref(false);
const showWalletWords = ref(false);
const showIdentityWords = ref(false);
const showCloudBackup = ref(false);
const selectedWalletId = ref(null);
const phraseMode = ref('backup');
let pendingChoice = null;

function selectBackup(choice) {
  pendingChoice = choice;
  showChoices.value = false;
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
.backup-shortcut {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 4px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 6px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font: 400 11px/1.15 'Manrope', sans-serif;
  cursor: pointer;
}
.backup-shortcut-keyring { flex-shrink: 0; }
.backup-shortcut-label { display: flex; flex-direction: column; align-items: flex-start; }
.backup-shortcut:hover, .backup-shortcut:active { background: var(--brand-accent-soft); }
.backup-shortcut:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: -2px; }
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
.backup-choices-list { margin-top: 12px; border: 1px solid var(--border-card); border-radius: 16px; overflow: hidden; }
.backup-choices-list :deep(.settings-row + .settings-row) { border-top: 1px solid var(--border-card); }
.backup-choices-list :deep(.settings-row:focus-visible) { outline: 2px solid var(--brand-accent); outline-offset: -2px; }
.backup-choice-state { display: flex; align-items: center; gap: 4px; margin-top: 5px; color: var(--text-secondary); }
.backup-choice-state--saved { color: var(--brand-accent-text); }
</style>
