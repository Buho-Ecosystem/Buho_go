<template>
  <div class="backup-choices">
    <!-- The split: one row per set of recovery words, each with its own
         checked state. Tapping a row starts that backup straight away. -->
    <div class="backup-choices-list">
      <button v-for="choice in choices" :key="choice.key" type="button" class="backup-choice" @click="$emit('select', choice)">
        <span class="backup-choice-icon"><BackupSubjectIcon :kind="choice.kind" :size="28" /></span>
        <span class="backup-choice-copy">
          <strong>{{ $t(choice.kind === 'wallet' ? 'Bitcoin backup' : 'Identity backup') }}</strong>
          <span class="backup-choice-detail">{{ choice.detail }}</span>
          <span class="backup-choice-state" :class="{ 'is-saved': choice.saved }">
            <Icon v-if="choice.saved" icon="tabler:check" width="14" height="14" aria-hidden="true" />
            {{ $t(choice.saved ? 'Words checked' : 'Not checked yet') }}
          </span>
          <!-- The exit kit's state sits next to the backup it belongs to. -->
          <span v-if="choice.type === 'spark' && kitLine" class="backup-choice-state" :class="{ 'is-saved': kitLine.ok }">
            <Icon v-if="kitLine.ok" icon="tabler:check" width="14" height="14" aria-hidden="true" />
            {{ kitLine.text }}
          </span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
      </button>
    </div>
    <p v-if="!groups.length" class="backup-choices-note">
      {{ $t('For connected wallets, keep the recovery details from your wallet provider.') }}
    </p>

    <!-- Quieter rows: the optional cloud copy and the way back for someone
         who already has a backup. Neither changes whether words are checked. -->
    <div class="backup-choices-more">
      <button v-if="hasSpark" type="button" class="backup-choice backup-choice-quiet" @click="$emit('select', { kind: 'kit' })">
        <span class="backup-choice-icon"><Icon icon="tabler:lifebuoy" width="26" height="26" aria-hidden="true" /></span>
        <span class="backup-choice-copy">
          <strong>{{ $t('Emergency exit kit') }}</strong>
          <span class="backup-choice-detail">{{ $t('Move this wallet\'s money to plain Bitcoin without Spark\'s help.') }}</span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
      </button>
      <button v-if="cloudAvailable" type="button" class="backup-choice backup-choice-quiet" @click="$emit('select', { kind: 'cloud' })">
        <span class="backup-choice-icon"><BackupKeyring :size="28" /></span>
        <span class="backup-choice-copy">
          <strong>{{ $t('Google Drive backup') }}</strong>
          <span class="backup-choice-detail">{{ $t('Optional backup') }}</span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
      </button>
      <button type="button" class="backup-choice backup-choice-quiet" @click="$emit('select', { kind: 'restore' })">
        <span class="backup-choice-icon"><Icon icon="tabler:refresh" width="26" height="26" aria-hidden="true" /></span>
        <span class="backup-choice-copy">
          <strong>{{ $t('Restore from backup') }}</strong>
          <span class="backup-choice-detail">{{ $t('Bitcoin or identity from another phone') }}</span>
        </span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="backup-choice-chevron" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { bitcoinBackupName, walletBackupGroups } from '../utils/backupStatus.js';
import { isCloudBackupPlatform } from '../services/cloudStorage.js';
import { useExitKitStore } from '../stores/exitKit';
import { kitState, isSameDay } from '../utils/exitKit.js';
import { relativeDay } from '../composables/useExitFormat.js';
import BackupKeyring from './BackupKeyring.vue';
import BackupSubjectIcon from './BackupSubjectIcon.vue';

/**
 * Emits `select` with one of four kinds:
 *   wallet | identity  - a set of recovery words, with `walletId`, `saved`
 *                        and the `mode` the recovery dialog should open in
 *   cloud              - the optional Google Drive copy
 *   restore            - the person already has a backup and wants it back
 *   kit                - the emergency exit kit sheet (Spark wallets only)
 */
defineEmits(['select']);
const wallet = useWalletStore();
const identity = useIdentityStore();
const groups = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp));
const cloudAvailable = isCloudBackupPlatform();
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const kits = useExitKitStore();
const sparkWallets = computed(() => wallet.wallets.filter(w => w.type === 'spark'));
const hasSpark = computed(() => sparkWallets.value.length > 0);
// One line for the pair: the weakest kit decides what it says.
const kitLine = computed(() => {
  const metas = sparkWallets.value.map(w => kits.kitFor(w.id));
  if (!metas.length) return null;
  const states = metas.map(kitState);
  if (states.includes('failed')) return { ok: false, text: t('Exit kit needs a refresh') };
  if (states.includes('none')) return { ok: false, text: t('Exit kit not checked yet') };
  const oldest = Math.min(...metas.map(m => m.checkedAt || m.exportedAt));
  if (isSameDay(oldest, Date.now())) return { ok: true, text: t('Exit kit checked today') };
  return { ok: true, text: t('Exit kit checked {date}', { date: relativeDay(oldest, t, proxy.$i18n.locale) }) };
});
// Each button names the backup first; wallet/provider details remain subordinate.
const choices = computed(() => [
  ...groups.value.map(group => ({
    key: group.key, kind: 'wallet', type: group.type, walletId: group.walletId, saved: group.saved,
    mode: group.saved ? 'view' : 'backup',
    detail: `${bitcoinBackupName(group, t)} · ${group.type === 'spark' ? 'Spark' : 'Arkade'}`,
  })),
  ...(identity.bootstrapped ? [{
    key: 'identity', kind: 'identity', saved: identity.backupConfirmed,
    mode: identity.backupConfirmed ? 'view' : 'backup', detail: t('Name, photo and contacts'),
  }] : []),
]);
</script>

<style scoped>
.backup-choices-list, .backup-choices-more { display: grid; gap: 8px; }
.backup-choices-more { margin-top: 20px; }
.backup-choice { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 88px; padding: 16px; border: 0; border-radius: 18px; background: var(--bg-input); color: var(--text-primary); text-align: start; font: inherit; cursor: pointer; }
.backup-choice:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; }
.backup-choice:active { background: var(--brand-accent-soft); }
.backup-choice-quiet { min-height: 72px; background: transparent; }
.backup-choice-icon { display: grid; place-items: center; flex-shrink: 0; width: 32px; color: var(--text-secondary); }
.backup-choice-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.backup-choice-copy strong { font-size: 16px; font-weight: 650; line-height: 1.35; }
.backup-choice-detail { color: var(--text-secondary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.backup-choice-state { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.backup-choice-state.is-saved { color: var(--brand-accent-text); }
.backup-choice-state svg, .backup-choice-chevron { flex-shrink: 0; }
.backup-choice-chevron { color: var(--text-secondary); }
.backup-choices-note { font-size: 13px; color: var(--text-secondary); margin: 16px 0 0; }
</style>
