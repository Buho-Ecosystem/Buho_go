<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your 12 words') }}</h1>

      <!--
        The signature screen of this redesign.

        BuhoGO can hand a user two unrelated sets of 12 words and the old UI
        called both of them "your recovery phrase", in two different parts of
        the app. Someone who verified one in Settings believed they were
        safe. They were not.

        Two cards, side by side, with their real states, so the difference is
        visual before it is verbal. Users with no seed-based wallet see one
        card and a sentence that fits their case, rather than being taught
        about a phrase they do not have.
      -->
      <p class="id-lede">
        {{ phraseCount === 2
          ? $t('BuhoGO gives you two sets of 12 words. They are different words and they bring back different things.')
          : $t('These 12 words are the only way to bring your card back on another phone.') }}
      </p>

      <div class="kit" :class="{ 'kit--single': phraseCount === 1 }">
        <button type="button" class="kit-card" @click="openCardWords">
          <span class="kit-icon" :class="cardWordsSaved ? 'kit-icon--ok' : 'kit-icon--warn'">
            <Icon icon="tabler:user" width="17" height="17" />
          </span>
          <span class="kit-title">{{ $t('Card words') }}</span>
          <span class="kit-body">{{ $t('Bring back your name, photo and contacts.') }}</span>
          <span class="kit-state" :class="cardWordsSaved ? 'kit-state--ok' : 'kit-state--warn'">
            <Icon v-if="cardWordsSaved" icon="tabler:check" width="12" height="12" />
            {{ cardWordsSaved ? $t('Saved') : $t('Not saved yet') }}
          </span>
        </button>

        <button v-if="phraseCount === 2" type="button" class="kit-card" @click="openWalletWords">
          <span class="kit-icon" :class="walletWordsSaved ? 'kit-icon--ok' : 'kit-icon--warn'">
            <Icon icon="tabler:wallet" width="17" height="17" />
          </span>
          <span class="kit-title">{{ $t('Wallet words') }}</span>
          <span class="kit-body">{{ $t('Bring back the Bitcoin in your wallet.') }}</span>
          <span class="kit-state" :class="walletWordsSaved ? 'kit-state--ok' : 'kit-state--warn'">
            <Icon v-if="walletWordsSaved" icon="tabler:check" width="12" height="12" />
            {{ walletWordsSaved ? $t('Saved') : $t('Not saved yet') }}
          </span>
        </button>
      </div>

      <div v-if="phraseCount === 2" class="kit-warn">
        <Icon icon="tabler:alert-triangle" width="17" height="17" />
        <span>{{ $t('Saving one does not save the other. Write both down and label which is which.') }}</span>
      </div>

      <IdentityGroup :title="$t('Coming back')">
        <IdentityRow
          icon="tabler:refresh"
          :label="$t('I have 12 words to enter')"
          :caption="$t('Bring back a card or a wallet')"
          @click="showRestoreChoice = true"
        />
      </IdentityGroup>
    </div>

    <!-- Card words: reveal, then the tap-in-order check that is the only
         thing proving the paper is right. Unchanged. -->
    <IdentitySeedPhraseDialog
      v-model="showSeedDialog"
      :mode="seedDialogMode"
      @verified="onCardWordsVerified"
    />

    <!-- Which of the two phrases is in the user's hand. Both are valid
         BIP-39, so the app genuinely cannot tell them apart and says so
         rather than pretending to detect it. -->
    <q-dialog v-model="showRestoreChoice" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="choice-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('What are you bringing back?') }}</div>
          <q-btn flat round dense :aria-label="$t('Close')" @click="showRestoreChoice = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body">
          <p class="sheet-lede">
            {{ $t('Both are 12 words, so we cannot tell them apart on our own. Pick what you wrote on the paper.') }}
          </p>
          <IdentityGroup :footer="$t('Not sure? Pick one and try it. Nothing is lost if it turns out to be the other one.')">
            <IdentityRow
              icon="tabler:user"
              :label="$t('My card')"
              :caption="$t('Name, photo and contacts from another phone')"
              @click="startCardRestore"
            />
            <IdentityRow
              icon="tabler:wallet"
              :label="$t('My wallet')"
              :caption="$t('Bitcoin from another phone')"
              @click="startWalletRestore"
            />
          </IdentityGroup>
        </div>
      </q-card>
    </q-dialog>

    <IdentityRestoreDialog v-model="showRestoreDialog" @restored="onIdentityRestored" />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentitySeedPhraseDialog from '../../components/IdentitySeedPhraseDialog.vue';
import IdentityRestoreDialog from '../../components/IdentityRestoreDialog.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useAddressBookStore } from '../../stores/addressBook';

export default {
  name: 'IdentityWordsPage',

  components: {
    Icon,
    SettingsHubNav,
    IdentityNav,
    IdentityGroup,
    IdentityRow,
    IdentitySeedPhraseDialog,
    IdentityRestoreDialog,
  },

  setup() {
    return { ...useIdentityHealth(), addressBook: useAddressBookStore() };
  },

  data() {
    return {
      showSeedDialog: false,
      seedDialogMode: 'backup',
      showRestoreChoice: false,
      showRestoreDialog: false,
    };
  },

  async created() {
    await this.identity.hydrate();
    // The wallet half of the phrase count comes from the wallet store.
    await this.ensureWalletLoaded();
  },

  methods: {
    async openCardWords() {
      await this.identity.ensureIdentity();
      this.seedDialogMode = this.cardWordsSaved ? 'view' : 'backup';
      this.showSeedDialog = true;
    },

    /**
     * The wallet phrase is owned by Settings, which already has the whole
     * flow including the per-wallet picker. Deep-linking there beats
     * duplicating it, and the query parameter is the one Settings already
     * understands.
     */
    openWalletWords() {
      this.$router.push({ path: '/settings', query: { section: 'backup' } });
    },

    onCardWordsVerified() {
      // The store flips backupConfirmed; the health composable re-renders
      // every surface that reports it, including the card footer.
    },

    startCardRestore() {
      this.showRestoreChoice = false;
      setTimeout(() => { this.showRestoreDialog = true; }, 180);
    },

    startWalletRestore() {
      this.showRestoreChoice = false;
      this.$router.push('/restore');
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
.id-sub-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  padding-top: var(--safe-top, 0px);
}

.id-sub-body {
  flex: 1 1 auto;
  padding: 0 16px calc(104px + var(--safe-bottom, 0px));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

.id-large-title {
  font-size: 30px;
  font-weight: 770;
  letter-spacing: -0.035em;
  line-height: 1.12;
  color: var(--text-primary);
  margin: 2px 2px 8px;
}

.id-lede {
  font-size: 14.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 2px 16px;
}

.kit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.kit--single { grid-template-columns: 1fr; }

.kit-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 18px;
  padding: 15px 13px;
  text-align: left;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
  display: block;
}

.kit-card:active { background: rgba(127, 127, 127, 0.06); }

.kit-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  margin-bottom: 11px;
}

.kit-icon--ok { background: var(--brand-accent-soft); color: var(--brand-accent); }
.kit-icon--warn { background: rgba(154, 107, 0, 0.10); color: #9A6B00; }

.kit-title {
  display: block;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.kit-body {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 5px;
  line-height: 1.4;
}

.kit-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 650;
  padding: 4px 9px;
  border-radius: 999px;
  margin-top: 11px;
}

.kit-state--ok { background: var(--brand-accent-soft); color: var(--brand-accent); }
.kit-state--warn { background: rgba(154, 107, 0, 0.10); color: #9A6B00; }

.kit-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: 14px;
  background: rgba(154, 107, 0, 0.10);
  color: #9A6B00;
  font-size: 13px;
  line-height: 1.5;
  margin-top: 14px;
}

.kit-warn svg { margin-top: 1px; flex: 0 0 auto; }

body.body--dark .kit-icon--warn,
body.body--dark .kit-state--warn,
body.body--dark .kit-warn { background: rgba(232, 196, 104, 0.12); color: #E8C468; }

/* Sheet */
.choice-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-grab { display: flex; justify-content: center; padding: 9px 0 2px; }
.sheet-grab span {
  width: 36px; height: 4px; border-radius: 999px;
  background: var(--border-card); display: block;
}

.sheet-head { display: flex; align-items: center; gap: 8px; padding: 8px 14px 4px; }

.sheet-title {
  flex: 1;
  padding-left: 4px;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.sheet-body { padding: 8px 16px 20px; }

.sheet-lede {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 14px;
}
</style>
