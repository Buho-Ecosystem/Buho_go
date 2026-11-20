<template>
  <div class="backup-choices">
    <!-- The tab opens on the keyring, the same mark as the Home reminder,
         and says in the reminder's words what is still open. The tab bar
         already says where you are, so there is no large title. -->
    <div class="backup-hero">
      <BackupKeyring :size="64" />
      <h1 class="backup-hero-title">{{ $t('Backup') }}</h1>
      <p class="backup-hero-status" :class="pendingLabel ? 'is-open' : 'is-done'" data-audit="backup-status" role="status">
        <template v-if="pendingLabel">{{ $t('{what} not checked yet', { what: pendingLabel }) }}</template>
        <template v-else-if="choices.length"><Icon icon="tabler:check" width="16" height="16" class="backup-hero-check" />{{ $t('All recovery words are checked') }}</template>
        <template v-else>{{ $t('Nothing on this phone needs recovery words') }}</template>
      </p>
    </div>

    <!-- The split: one row per set of recovery words, each with its own
         checked state. Tapping a row starts that backup straight away. All
         Spark wallets share one phrase, so they are one row that names them. -->
    <SettingsSection v-if="choices.length" :title="$t('Recovery words')" class="backup-choices-list">
      <SettingsRow
        v-for="choice in choices"
        :key="choice.key"
        class="backup-choice"
        tiled
        :label="choice.title"
        :caption="choice.detail"
        @click="$emit('select', choice)"
      >
        <template #icon>
          <WalletLogoTile v-if="choice.kind === 'wallet'" :type="choice.type" :size="30" />
          <span v-else class="backup-identity-tile"><BackupSubjectIcon kind="identity" :size="18" /></span>
        </template>
        <template #right>
          <span class="backup-choice-state" :class="choice.saved ? 'is-saved' : 'is-open'">
            <Icon v-if="choice.saved" icon="tabler:check" width="14" height="14" />{{ $t(choice.saved ? 'Checked' : 'Not checked yet') }}
          </span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="backup-choice-chevron" />
        </template>
      </SettingsRow>
      <template #footer>
        <template v-if="groups.length">{{ $t('Each set brings back what it covers on a new phone. Keep these words offline: no photos, no sharing.') }}</template>
        <template v-else>{{ $t('For connected wallets, keep the recovery details from your wallet provider.') }}</template>
      </template>
    </SettingsSection>
    <p v-else class="backup-choices-note">{{ $t('For connected wallets, keep the recovery details from your wallet provider.') }}</p>

    <!-- The emergency exit kit lives here and nowhere else: it only works
         together with the recovery words. -->
    <SettingsSection v-if="sparkWallets.length">
      <SettingsRow
        class="backup-choice"
        icon="tabler:fire-extinguisher"
        :tile="TILE_AMBER"
        :label="$t('Emergency exit kit')"
        data-audit="exit-kit-row"
        @click="$emit('select', { kind: 'exit-kit' })"
      >
        <template #right>
          <span class="backup-choice-state" :class="kitValue.ok ? 'is-saved' : 'is-open'">
            <Icon v-if="kitValue.ok" icon="tabler:check" width="14" height="14" />{{ kitValue.text }}
          </span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="backup-choice-chevron" />
        </template>
      </SettingsRow>
      <template #footer>{{ $t("Move your Spark wallets' money to plain Bitcoin without Spark's help.") }}</template>
    </SettingsSection>

    <!-- The optional Drive copy: never changes whether words are checked. -->
    <SettingsSection v-if="cloudAvailable">
      <SettingsRow
        class="backup-choice"
        icon="tabler:cloud"
        :tile="TILE_BLUE"
        :label="$t('Google Drive backup')"
        data-audit="drive-row"
        @click="$emit('select', { kind: 'cloud' })"
      >
        <template #right>
          <span class="backup-choice-state" :class="{ 'is-open': driveValue.open }">{{ driveValue.text }}</span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="backup-choice-chevron" />
        </template>
      </SettingsRow>
      <template #footer>{{ $t('Optional backup. An encrypted copy of your wallets and identity in your Google Drive.') }}</template>
    </SettingsSection>

    <!-- The way back for someone who already has a backup. -->
    <SettingsSection>
      <SettingsRow
        class="backup-choice"
        accent
        :label="$t('Restore from backup')"
        data-audit="restore-row"
        @click="$emit('select', { kind: 'restore' })"
      />
      <template #footer>{{ $t('Bitcoin or identity from another phone') }}</template>
    </SettingsSection>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue';
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { useCloudBackupStore } from '../stores/cloudBackup.js';
import { walletBackupGroups, pendingBackupLabel } from '../utils/backupStatus.js';
import { isCloudBackupPlatform } from '../services/cloudStorage.js';
import { useExitKitStore } from '../stores/exitKit';
import { kitState, isSameDay } from '../utils/exitKit.js';
import { relativeDay } from '../composables/useExitFormat.js';
import { WALLET_TYPES } from '../providers/WalletFactory';
import BackupKeyring from './BackupKeyring.vue';
import BackupSubjectIcon from './BackupSubjectIcon.vue';
import SettingsSection from './settings/SettingsSection.vue';
import SettingsRow from './settings/SettingsRow.vue';
import WalletLogoTile from './settings/WalletLogoTile.vue';

/**
 * Emits `select` with one of these kinds:
 *   wallet | identity  - a set of recovery words, with `walletId`, `saved`
 *                        and the `mode` the recovery dialog should open in
 *   exit-kit           - the Spark emergency exit kit (and the exit itself)
 *   cloud              - the optional Google Drive copy
 *   restore            - the person already has a backup and wants it back
 */
defineEmits(['select']);
// Row tiles, same hues as Settings (white glyph on colour).
const TILE_AMBER = '#C27C0E';
const TILE_BLUE = '#2F7BD9';
const wallet = useWalletStore();
const identity = useIdentityStore();
const cloud = useCloudBackupStore();
cloud.init();
const groups = computed(() => walletBackupGroups(wallet.wallets, wallet.hasBackedUp));
const cloudAvailable = isCloudBackupPlatform();
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const kits = useExitKitStore();
const sparkWallets = computed(() => wallet.wallets.filter(w => w.type === WALLET_TYPES.SPARK));
const listFormat = (names) => {
  try { return new Intl.ListFormat(proxy.$i18n.locale, { style: 'long', type: 'conjunction' }).format(names); }
  catch { return names.join(', '); }
};
// The exit kit row: one value for all Spark wallets, the weakest kit decides.
const kitValue = computed(() => {
  const metas = sparkWallets.value.map(w => kits.kitFor(w.id));
  const states = metas.map(kitState);
  if (states.includes('failed')) return { ok: false, text: t('Needs a refresh') };
  if (!metas.length || states.includes('none')) return { ok: false, text: t('Not checked yet') };
  const oldest = Math.min(...metas.map(m => m.checkedAt || m.exportedAt));
  if (isSameDay(oldest, Date.now())) return { ok: true, text: t('Checked today') };
  return { ok: true, text: t('Checked {date}', { date: relativeDay(oldest, t, proxy.$i18n.locale) }) };
});
// The Drive row: when this phone last saved a copy, or that it is optional.
const driveValue = computed(() => {
  if (!cloud.lastBackupAt) return { open: false, text: t('Optional') };
  if (cloud.backupOutOfDate) return { open: true, text: t('Out of date') };
  const at = Date.parse(cloud.lastBackupAt);
  if (isSameDay(at, Date.now())) return { open: false, text: t('Saved today') };
  return { open: false, text: t('Saved {date}', { date: relativeDay(at, t, proxy.$i18n.locale) }) };
});
// Each row names the set of words; what it covers sits underneath.
const choices = computed(() => [
  ...groups.value.map(group => {
    const many = group.type === 'spark' && group.names.length > 1;
    const typeName = group.type === 'spark' ? 'Spark' : 'Arkade';
    const [only] = group.names;
    return {
      key: group.key, kind: 'wallet', type: group.type, walletId: group.walletId, saved: group.saved,
      mode: group.saved ? 'view' : 'backup', covers: group.type === 'spark' ? group.names.length : 1,
      title: many ? t('Spark wallets') : typeName,
      detail: many ? listFormat(group.names) : (only && only !== typeName ? only : ''),
    };
  }),
  ...(identity.bootstrapped ? [{
    key: 'identity', kind: 'identity', saved: identity.backupConfirmed,
    mode: identity.backupConfirmed ? 'view' : 'backup', title: t('Identity'), detail: t('Name, photo and contacts'),
  }] : []),
]);
// The Home reminder's words: what is still open (one owner, utils/backupStatus.js).
const pendingLabel = computed(() => pendingBackupLabel(groups.value, identity, t));
</script>

<style scoped>
.backup-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 16px 22px; text-align: center; }
.backup-hero-title { margin: 8px 0 0; font-family: 'Manrope', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; color: var(--text-primary); }
/* Inline, so the check stays with the first word when the line wraps. */
.backup-hero-status { display: block; margin: 0; font-size: 14px; font-weight: 650; line-height: 1.4; color: var(--text-secondary); text-wrap: balance; }
.backup-hero-check { display: inline; vertical-align: -0.15em; margin-right: 5px; }
.backup-hero-status.is-open { color: var(--color-warn); }
.backup-hero-status.is-done { color: var(--brand-accent-text); }
.backup-identity-tile { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 7px; background: #8E5BA8; color: #fff; }
.backup-choice-state { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 14px; font-weight: 500; white-space: nowrap; }
.backup-choice-state.is-open { color: var(--color-warn); }
.backup-choice-state.is-saved { color: var(--brand-accent-text); }
.backup-choice-state svg, .backup-choice-chevron { flex-shrink: 0; }
.backup-choice-chevron { color: var(--text-muted); opacity: 0.7; }
.backup-choices-note { margin: 0 4px 24px; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
</style>
