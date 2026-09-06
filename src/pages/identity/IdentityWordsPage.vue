<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Back up your card') }}</h1>

      <!--
        Story first, artifact second: the screen explains what the paper is
        for in three beats, and the 12 words themselves stay behind the one
        CTA (reveal, order-check and biometric gate unchanged in the dialog).
        Wallet backups belong to Settings, next to the wallets; one quiet
        sentence at the bottom points anyone who came for those.
      -->
      <p class="id-lede">
        {{ $t('Your card lives only on this phone. If the phone is lost or broken, 12 words on paper are the only way back. It takes two minutes.') }}
      </p>

      <section class="words-panel">
        <!-- The same illustration the onboarding tour uses for backing up,
             so the two moments read as one idea. -->
        <img
          src="/Onboarding wizard spark/storyset-secure-login-bro.svg"
          class="words-illustration"
          alt=""
        />

        <ol class="words-beats">
          <li class="words-beat">
            <span class="words-beat-num" aria-hidden="true">1</span>
            <span class="words-beat-copy">
              <strong>{{ $t('Write 12 words on paper') }}</strong>
              <span>{{ $t('We show them to you. You copy them down, in order.') }}</span>
            </span>
          </li>
          <li class="words-beat">
            <span class="words-beat-num" aria-hidden="true">2</span>
            <span class="words-beat-copy">
              <strong>{{ $t('Check your paper once') }}</strong>
              <span>{{ $t('Tap the words in order, so a mistake shows now and not on your next phone.') }}</span>
            </span>
          </li>
          <li class="words-beat">
            <span class="words-beat-num" aria-hidden="true">3</span>
            <span class="words-beat-copy">
              <strong>{{ $t('Keep it somewhere safe') }}</strong>
              <span>{{ $t('Whoever holds the paper holds your card. No photos, no screenshots.') }}</span>
            </span>
          </li>
        </ol>

        <span class="words-state" :class="cardWordsSaved ? 'words-state--ok' : 'words-state--warn'">
          <Icon v-if="cardWordsSaved" icon="tabler:check" width="12" height="12" />
          {{ cardWordsSaved ? $t('Backed up') : $t('Not backed up yet') }}
        </span>
        <button type="button" class="btn-primary" @click="openCardWords">
          {{ cardWordsSaved ? $t('View my 12 words') : $t('Show my 12 words') }}
        </button>
      </section>

      <IdentityGroup :title="$t('Coming back')">
        <IdentityRow
          icon="tabler:refresh"
          :label="$t('I already have 12 words')"
          :caption="$t('Bring back what you saved on another phone')"
          @click="showRestoreChoice = true"
        />
      </IdentityGroup>

      <!-- For whoever came here looking for a wallet backup: where it lives,
           without putting it back on the screen as a competing set. -->
      <p v-if="hasWalletWords" class="id-foot">
        {{ $t('Your wallets keep their own recovery words. Those live in Settings, next to each wallet.') }}
      </p>
    </div>

    <!-- Card words: reveal, then the tap-in-order check that is the only
         thing proving the paper is right. Unchanged. -->
    <IdentitySeedPhraseDialog
      v-model="showSeedDialog"
      :label-paper="hasWalletWords"
      :mode="seedDialogMode"
      @verified="onCardWordsVerified"
    />

    <!-- Which of the two phrases is in the user's hand. Both are valid
         BIP-39, so the app genuinely cannot tell them apart and says so
         rather than pretending to detect it. -->
    <q-dialog v-model="showRestoreChoice" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
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
    SettingsHubNav,
    Icon,
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
    // Whether wallet phrases exist decides the label-the-paper hint and the
    // Settings pointer, and that fact lives in the wallet store.
    await this.ensureWalletLoaded();
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },
  },

  methods: {
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
/* One panel: the story in three beats, then the single verb. */
.words-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 20px 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.words-illustration {
  width: 148px;
  height: auto;
  margin: 2px auto 14px;
  display: block;
}

.words-beats {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.words-beat {
  display: flex;
  gap: 13px;
  align-items: flex-start;
}

.words-beat-num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 750;
}

.words-beat-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
}

.words-beat-copy strong {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.words-beat-copy span {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.words-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 650;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  margin-top: 12px;
}

.words-state--ok   { background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.words-state--warn { background: var(--color-warn-soft); color: var(--color-warn); }

/* Sheet */
.choice-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-lede {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 14px;
}
</style>
