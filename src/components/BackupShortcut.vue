<template>
  <button
    type="button"
    class="backup-shortcut"
    :aria-label="needsBackup ? `${$t('Backup')}: ${pendingLabel}` : $t('Backups')"
    aria-haspopup="dialog"
    :aria-expanded="showChoices"
    @click="showChoices = true"
  >
    <BackupKeyring :size="29" />
    <span v-if="needsBackup" class="backup-shortcut-label">
      <span>{{ $t('Backup') }}</span>
      <span>{{ pendingLabel }}</span>
    </span>
  </button>

  <BackupsSheet v-model="showChoices" />
</template>

<script setup>
import { computed, ref } from 'vue';
import { i18n } from '../boot/i18n';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { walletBackupGroups } from '../utils/backupStatus.js';
import BackupKeyring from './BackupKeyring.vue';
import BackupsSheet from './BackupsSheet.vue';
const wallet = useWalletStore();
const identity = useIdentityStore();
const showChoices = ref(false);
const walletNeedsBackup = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp).some(group => !group.saved));
const identityNeedsBackup = computed(() => identity.bootstrapped && !identity.backupConfirmed);
const needsBackup = computed(() => walletNeedsBackup.value || identityNeedsBackup.value);
const pendingLabel = computed(() => walletNeedsBackup.value
  ? (identityNeedsBackup.value ? i18n.global.t('Bitcoin & identity') : i18n.global.t('Bitcoin'))
  : i18n.global.t('Identity'));
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
</style>
