<template>
  <!-- The home reminder. Present only while a set of recovery words is still
       unchecked; once every applicable set is checked it leaves entirely and
       Security stays reachable from the menu. -->
  <button
    v-if="needsBackup"
    type="button"
    class="backup-shortcut"
    :aria-label="`${$t('Backup')}: ${pendingLabel}`"
    @click="router.push('/security')"
  >
    <BackupKeyring :size="29" />
    <span class="backup-shortcut-label">
      <span>{{ $t('Backup') }}</span>
      <span>{{ pendingLabel }}</span>
    </span>
  </button>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { i18n } from '../boot/i18n';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { walletBackupGroups } from '../utils/backupStatus.js';
import BackupKeyring from './BackupKeyring.vue';

const router = useRouter();
const wallet = useWalletStore();
const identity = useIdentityStore();
// Same source as the Security rows, so the reminder and the page never disagree.
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
.backup-shortcut-label { display: flex; flex-direction: column; align-items: flex-start; }
.backup-shortcut:hover, .backup-shortcut:active { background: var(--brand-accent-soft); }
.backup-shortcut:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: -2px; }
</style>
