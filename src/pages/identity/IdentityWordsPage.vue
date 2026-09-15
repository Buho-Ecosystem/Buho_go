<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Backups') }}</h1>
      <BackupCoverage :selected="selectedBackup" interactive @select="selectedBackup = $event" />
      <div id="backup-panel-identity" role="tabpanel" aria-labelledby="backup-tab-identity" :hidden="selectedBackup !== 'identity'">
        <section class="words-panel">
          <BackupSubjectIcon kind="identity" :size="40" />
          <h2>{{ $t('Identity backup') }}</h2>
          <p>{{ $t('Name, photo and contacts') }}</p>
          <button type="button" class="btn-primary" @click="openCardWords">
            {{ cardWordsSaved ? $t('View recovery words') : $t('Back up identity') }}
          </button>
        </section>
      </div>
      <div id="backup-panel-wallet" role="tabpanel" aria-labelledby="backup-tab-wallet" :hidden="selectedBackup !== 'wallet'">
        <section class="words-panel">
          <BackupSubjectIcon kind="wallet" :size="40" />
          <h2>{{ $t('Bitcoin backup') }}</h2>
          <IdentityGroup v-if="walletGroups.length">
            <IdentityRow v-for="group in walletGroups" :key="group.key" :label="bitcoinBackupName(group, $t)"
              @click="openWalletWords(group)">
              <template #caption>
                <span>{{ group.type === 'spark' ? 'Spark' : 'Arkade' }}</span>
                <span class="words-wallet-state">{{ group.saved ? $t('Words checked') : $t('Not checked yet') }}</span>
              </template>
            </IdentityRow>
          </IdentityGroup>
          <p v-else>{{ $t('For connected wallets, keep the recovery details from your wallet provider.') }}</p>
        </section>
      </div>
      <IdentityGroup :title="$t('Already have a backup?')">
        <IdentityRow icon="tabler:refresh" :label="$t('Restore from recovery words')" @click="showRestoreChoice = true" />
      </IdentityGroup>
      <IdentityGroup v-if="cloudAvailable" :title="$t('Optional backup')">
        <IdentityRow :label="$t('Google Drive backup')" :caption="$t('Wallet and identity together')" @click="showCloudBackup = true">
          <template #leading><BackupKeyring :size="28" /></template>
        </IdentityRow>
      </IdentityGroup>

    </div>
    <SparkSeedPhraseDialog v-model="showWalletWords" :wallet-id="selectedWalletId" :mode="walletPhraseMode" />
    <CloudBackupSheet v-if="cloudAvailable" v-model="showCloudBackup" />

    <!-- The shared phrase dialog verifies the selected paper copy. -->
    <IdentitySeedPhraseDialog
      v-model="showSeedDialog"
      :label-paper="hasWalletWords"
      :mode="seedDialogMode"
      @verified="onCardWordsVerified"
    />

    <!-- Which of the two phrases is in the user's hand. Both are valid
         BIP-39, so the app genuinely cannot tell them apart and says so
         rather than pretending to detect it. -->
    <q-dialog v-model="showRestoreChoice" position="bottom" @hide="onRestoreChoiceHidden" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="identity-surface choice-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('What are you bringing back?') }}</div>
          <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="showRestoreChoice = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body">
          <p class="sheet-lede">
            {{ $t('Which backup is on your paper?') }}
          </p>
          <IdentityGroup >
            <IdentityRow
              :label="$t('Identity')"
              :caption="$t('Name, photo and contacts from another phone')"
              @click="startCardRestore"
            ><template #leading><BackupSubjectIcon kind="identity" :size="26" /></template></IdentityRow>
            <IdentityRow
              :label="$t('Bitcoin')"
              :caption="$t('Bitcoin from another phone')"
              @click="startWalletRestore"
            ><template #leading><BackupSubjectIcon kind="wallet" :size="26" /></template></IdentityRow>
          </IdentityGroup>
        </div>
      </q-card>
    </q-dialog>

    <IdentityRestoreDialog v-model="showRestoreDialog" @restored="onIdentityRestored" />

      <SettingsHubNav />

  </q-page>
</template>

<script>
import SparkSeedPhraseDialog from '../../components/SparkSeedPhraseDialog.vue';
import { useWalletStore } from '../../stores/wallet';
import { bitcoinBackupName, walletBackupGroups } from '../../utils/backupStatus.js';
import BackupKeyring from '../../components/BackupKeyring.vue';
import BackupSubjectIcon from '../../components/BackupSubjectIcon.vue';
import BackupCoverage from '../../components/BackupCoverage.vue';
import CloudBackupSheet from '../../components/CloudBackupSheet.vue';
import { isCloudBackupPlatform } from '../../services/cloudStorage.js';
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentitySeedPhraseDialog from '../../components/IdentitySeedPhraseDialog.vue';
import IdentityRestoreDialog from '../../components/IdentityRestoreDialog.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useAddressBookStore } from '../../stores/addressBook';

export default {
  name: 'IdentityWordsPage',

  components: {
    BackupKeyring, BackupSubjectIcon, BackupCoverage, CloudBackupSheet, SparkSeedPhraseDialog,
    SettingsHubNav,
    Icon,
    IdentityNav,
    IdentityGroup,
    IdentityRow,
    IdentitySeedPhraseDialog,
    IdentityRestoreDialog,
  },

  setup() {
    return { wallet: useWalletStore(), ...useIdentityHealth(), addressBook: useAddressBookStore() };
  },

  data() {
    return {
      selectedBackup: 'identity',
      showWalletWords: false,
      selectedWalletId: null,
      walletPhraseMode: 'backup',
      showSeedDialog: false,
      showCloudBackup: false,
      cloudAvailable: isCloudBackupPlatform(),
      pendingRestore: null,
      seedDialogMode: 'backup',
      showRestoreChoice: false,
      showRestoreDialog: false,
    };
  },

  async created() {
    await this.identity.hydrate();
    // Both segments must reflect persisted wallets, including on a cold deep link.
    await this.ensureWalletLoaded();
  },

  computed: {
    walletGroups() { return walletBackupGroups(this.wallet.wallets, this.wallet.hasBackedUp); },
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },
  },

  methods: {
    bitcoinBackupName,
    openWalletWords(group) {
      this.selectedWalletId = group.walletId;
      this.walletPhraseMode = group.saved ? 'view' : 'backup';
      this.showWalletWords = true;
    },
    async openCardWords() {
      await this.identity.ensureIdentity();
      this.seedDialogMode = this.cardWordsSaved ? 'view' : 'backup';
      this.showSeedDialog = true;
    },

    onCardWordsVerified() {
      // The store flips backupConfirmed; the health composable re-renders
      // every surface that reports it, including the card footer.
    },

    startCardRestore() {
      this.showRestoreChoice = false;
      this.pendingRestore = 'identity';
    },

    startWalletRestore() {
      this.showRestoreChoice = false;
      this.pendingRestore = 'wallet';
    },

    onRestoreChoiceHidden() {
      const target = this.pendingRestore;
      this.pendingRestore = null;
      if (target === 'identity') this.showRestoreDialog = true;
      if (target === 'wallet') this.$router.push('/restore');
    },

    /**
     * After a card restore: resolve which identity was actually in use,
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
          this.$q.notify({
            type: 'positive',
            message: this.$t('Your card is back'),
            timeout: 4000,
          });
        }
      } else {
        console.warn('[identity] profile recovery failed:', profileResult.reason);
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
        console.warn('[identity] contact recovery failed:', contactsResult.reason);
      }

      this.$router.push('/identity');
    },
  },
};
</script>

<style scoped>
.words-wallet-state { display: block; margin-top: 4px; }
.words-panel { padding: 24px; border: 0; border-radius: 20px; background: var(--bg-card); margin-bottom: 24px; }
.words-panel h2 { font: 700 22px/1.3 'Manrope', sans-serif; margin: 16px 0 10px; color: var(--text-primary); }
.words-panel p { color: var(--text-secondary); font-size: 14px; line-height: 1.5; margin: 0 0 22px; }
.words-panel .btn-primary { width: 100%; min-height: 48px; }
.choice-sheet { width: 100%; max-width: 520px; border-radius: 24px 24px 0 0; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
.sheet-lede { color: var(--text-secondary); font-size: 14px; line-height: 1.5; margin: 0 0 16px; }
</style>
