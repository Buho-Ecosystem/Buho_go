<template>
  <q-page class="security-page">
    <!-- Hub chrome: a peer of Settings, You and Spend, so the same header
         (title, home icon) and the same floating tab bar. -->
    <SettingsHubHeader :title="$t('Security')" />

    <div class="security-content">
      <BackupChoices @select="onSelect" />
    </div>

    <!-- One recovery flow for both subjects. Mounted per selection so the
         words never outlive the task that showed them. -->
    <RecoveryPhraseDialog
      v-if="selection"
      v-model="showWords"
      :kind="selection.kind"
      :wallet-id="selection.walletId"
      :mode="selection.mode"
      @closed="selection = null"
    />

    <!-- Always mounted: the rows that open it are platform-gated, and the
         sheet reports availability honestly if it is opened anyway. -->
    <CloudBackupSheet
      v-model="showCloudBackup"
      :intent="cloudIntent"
      @restored="onCloudRestored"
      @update:model-value="onCloudSheetToggled"
    />

    <!-- Which backup is in the person's hand. Bitcoin and identity words
         are both valid BIP-39, so the app asks instead of guessing. -->
    <q-dialog
      v-model="showRestoreChoice"
      position="bottom"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
      @hide="onRestoreChoiceHidden"
    >
      <q-card class="identity-surface restore-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('What are you bringing back?') }}</div>
          <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="showRestoreChoice = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body">
          <IdentityGroup>
            <IdentityRow
              :label="$t('Identity')"
              :caption="$t('Name, photo and contacts from another phone')"
              @click="pickRestore('identity')"
            ><template #leading><BackupSubjectIcon kind="identity" :size="26" /></template></IdentityRow>
            <IdentityRow
              :label="$t('Bitcoin')"
              :caption="$t('Bitcoin from another phone')"
              @click="pickRestore('wallet')"
            ><template #leading><BackupSubjectIcon kind="wallet" :size="26" /></template></IdentityRow>
            <IdentityRow
              v-if="cloudAvailable"
              :label="$t('Restore from Google Drive')"
              :caption="$t('Your cloud backup')"
              @click="pickRestore('cloud')"
            ><template #leading><BackupKeyring :size="26" /></template></IdentityRow>
          </IdentityGroup>
        </div>
      </q-card>
    </q-dialog>

    <IdentityRestoreDialog v-model="showRestoreDialog" @restored="onIdentityRestored" />
    <!-- The emergency exit kit receipt and its door, Spark wallets only. -->
    <ExitKitSheet v-model="showKitSheet" @how="onKitHow" />
    <HowExitWorksSheet v-model="showHowExit" />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import BackupChoices from '../components/BackupChoices.vue';
import BackupKeyring from '../components/BackupKeyring.vue';
import BackupSubjectIcon from '../components/BackupSubjectIcon.vue';
import CloudBackupSheet from '../components/CloudBackupSheet.vue';
import IdentityRestoreDialog from '../components/IdentityRestoreDialog.vue';
import RecoveryPhraseDialog from '../components/RecoveryPhraseDialog.vue';
import ExitKitSheet from '../components/exit/ExitKitSheet.vue';
import HowExitWorksSheet from '../components/exit/HowExitWorksSheet.vue';
import IdentityGroup from '../components/identity/IdentityGroup.vue';
import IdentityRow from '../components/identity/IdentityRow.vue';
import SettingsHubHeader from '../components/settings/SettingsHubHeader.vue';
import SettingsHubNav from '../components/settings/SettingsHubNav.vue';
import { useIdentityHealth } from '../composables/useIdentityHealth';
import { isCloudBackupPlatform } from '../services/cloudStorage.js';
import { useAddressBookStore } from '../stores/addressBook';

/**
 * Security: every backup and every way back, on one page.
 *
 * A tab of the Settings hub, so it is one tap away from Settings, You and
 * Spend; also a door in the home menu, and where the pending-backup keyring
 * lands while words are still unchecked. The rows are the whole split:
 * tapping Bitcoin or Identity starts that recovery flow directly, and Done
 * lands back here with the row checked. The page also owns the optional
 * Drive copy and the restore chooser, so Settings and Profile carry no
 * backup entries of their own.
 */
export default {
  name: 'SecurityPage',

  components: {
    Icon,
    BackupChoices,
    BackupKeyring,
    BackupSubjectIcon,
    CloudBackupSheet,
    IdentityRestoreDialog,
    RecoveryPhraseDialog,
    ExitKitSheet,
    HowExitWorksSheet,
    IdentityGroup,
    IdentityRow,
    SettingsHubHeader,
    SettingsHubNav,
  },

  setup() {
    const { identity, profile, ensureWalletLoaded } = useIdentityHealth();
    return { identity, profile, ensureWalletLoaded, addressBook: useAddressBookStore() };
  },

  data() {
    return {
      selection: null,
      showWords: false,
      showCloudBackup: false,
      cloudIntent: 'backup',
      cloudRestoreSucceeded: false,
      cloudAvailable: isCloudBackupPlatform(),
      showRestoreChoice: false,
      pendingRestore: null,
      showRestoreDialog: false,
      showKitSheet: false,
      showHowExit: false,
    };
  },

  async created() {
    // Both subjects must be known before the rows can report their state,
    // and a cold deep link arrives before either store has loaded.
    await this.identity.hydrate();
    await this.ensureWalletLoaded();
  },

  methods: {
    onSelect(choice) {
      if (choice.kind === 'cloud') {
        this.openCloud('backup');
      } else if (choice.kind === 'restore') {
        this.showRestoreChoice = true;
      } else if (choice.kind === 'kit') {
        this.showKitSheet = true;
      } else {
        this.selection = choice;
        this.showWords = true;
      }
    },

    onKitHow() {
      // One sheet at a time: let the kit sheet finish closing first.
      this.showKitSheet = false;
      setTimeout(() => { this.showHowExit = true; }, 250);
    },

    openCloud(intent) {
      this.cloudIntent = intent;
      this.cloudRestoreSucceeded = false;
      this.showCloudBackup = true;
    },

    onCloudRestored(result) {
      // Anything usable back on the device counts: freshly restored, or
      // already present after a partial first attempt.
      this.cloudRestoreSucceeded =
        (result?.restored?.length || 0) + (result?.skipped?.length || 0) > 0;
    },

    onCloudSheetToggled(open) {
      if (!open && this.cloudRestoreSucceeded) this.$router.push('/wallet');
    },

    pickRestore(target) {
      this.pendingRestore = target;
      this.showRestoreChoice = false;
    },

    /**
     * Open the chosen journey only once the chooser has finished closing,
     * so focus and the dialog stack hand over cleanly.
     */
    onRestoreChoiceHidden() {
      const target = this.pendingRestore;
      this.pendingRestore = null;
      if (target === 'identity') this.showRestoreDialog = true;
      else if (target === 'wallet') this.$router.push('/restore');
      else if (target === 'cloud') this.openCloud('restore');
    },

    /**
     * After an identity restore: resolve which account was actually in use,
     * then pull the profile and contacts back. Both are best effort and
     * neither can undo the restore itself.
     *
     * `isRecovering` is held across the pointer lookup so no sync driver
     * starts running under account 0 while the real account is still being
     * resolved. It is released in a finally and reclaimed synchronously by
     * the recovery calls below, so no gap opens in between.
     */
    async onIdentityRestored() {
      this.addressBook.isRecovering = true;
      try {
        await this.identity.resolveActiveNostrAccount();
      } finally {
        this.addressBook.isRecovering = false;
      }

      // Profile metadata is identity-scoped, so anything local is stale
      // under the restored key.
      this.profile.reset();

      const [profileResult, contactsResult] = await Promise.allSettled([
        this.profile.recoverFromNostr({ identityStore: this.identity }),
        this.addressBook.recoverFromNostr({ identityStore: this.identity }),
      ]);

      if (profileResult.status === 'fulfilled') {
        const r = profileResult.value;
        if (r && r.ok && r.hadRemote && r.applied > 0) {
          this.$q.notify({ type: 'positive', message: this.$t('Your card is back'), timeout: 4000 });
        }
      } else {
        console.warn('[security] profile recovery failed:', profileResult.reason);
      }

      if (contactsResult.status === 'fulfilled') {
        const r = contactsResult.value;
        if (r && r.ok && r.restored > 0) {
          this.$q.notify({
            type: 'positive',
            message: this.$t('{n} contacts came back with it', { n: r.restored }),
            timeout: 4000,
          });
        }
      } else {
        console.warn('[security] contact recovery failed:', contactsResult.reason);
      }

      this.$router.push('/identity');
    },
  },
};
</script>

<style scoped>
/* The hub header owns the safe-top inset, so the page cancels the global
   q-page top padding; otherwise the inset is applied twice. */
.security-page {
  min-height: 100vh;
  padding-top: 0;
  background: var(--bg-primary);
  font-family: 'Manrope', sans-serif;
}

/* Bottom padding clears the floating tab bar, same as the other hub tabs. */
.security-content {
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: 0.75rem 1rem calc(104px + var(--safe-bottom, 0px));
}

.restore-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
</style>
