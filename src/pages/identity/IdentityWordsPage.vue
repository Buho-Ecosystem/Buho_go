<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

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
        {{ phraseCount > 1
          ? $t('You have {n} sets of 12 words. They are different words and they bring back different things.', { n: phraseCount })
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
          <span class="kit-action">
            {{ cardWordsSaved ? $t('View these words') : $t('Save these words') }}
            <Icon icon="tabler:chevron-right" width="14" height="14" />
          </span>
        </button>

        <button
          v-for="phrase in walletPhrases"
          :key="phrase.id"
          type="button"
          class="kit-card"
          @click="openWalletWords(phrase)"
        >
          <span class="kit-icon" :class="phrase.saved ? 'kit-icon--ok' : 'kit-icon--warn'">
            <Icon icon="tabler:wallet" width="17" height="17" />
          </span>
          <span class="kit-title">{{ $t('Wallet words') }}</span>
          <span class="kit-body">{{ phraseBody(phrase) }}</span>
          <span class="kit-state" :class="phrase.saved ? 'kit-state--ok' : 'kit-state--warn'">
            <Icon v-if="phrase.saved" icon="tabler:check" width="12" height="12" />
            {{ phrase.saved ? $t('Saved') : $t('Not saved yet') }}
          </span>
          <span class="kit-action">
            {{ phrase.saved ? $t('View these words') : $t('Save these words') }}
            <Icon icon="tabler:chevron-right" width="14" height="14" />
          </span>
        </button>
      </div>

      <!-- Only while it can still go wrong. Firing a warning at someone who
           has two green Saved chips is how people learn to ignore warnings. -->
      <div v-if="phraseCount > 1 && !allWordsSaved" class="kit-warn">
        <Icon icon="tabler:alert-triangle" width="17" height="17" />
        <span>{{ $t('Saving one does not save the others. Write each one down and label which is which.') }}</span>
      </div>
      <p v-else-if="phraseCount > 1" class="id-foot">
        {{ $t('Every set is written down. Keep them apart from each other.') }}
      </p>

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
      :label-paper="phraseCount > 1"
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

  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
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
    // The wallet half of the phrase count comes from the wallet store.
    await this.ensureWalletLoaded();
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, '/identity/manage'); },
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
    /**
     * Names what this paper brings back, so two wallet cards on the same
     * screen are told apart by what they restore rather than by position.
     */
    phraseBody(phrase) {
      if (phrase.restores === 'sparkMany') {
        return this.$t('Bring back the Bitcoin in your Spark wallets.');
      }
      if (phrase.restores === 'arkade') {
        return phrase.name
          ? this.$t('Bring back the Bitcoin in {wallet}.', { wallet: phrase.name })
          : this.$t('Bring back the Bitcoin in your Arkade wallet.');
      }
      return this.$t('Bring back the Bitcoin in your wallet.');
    },

    /**
     * The dialog reads whichever wallet it is given, so the id travels with
     * the tap. Without it a user with two different wallet phrases opened
     * whichever one Settings happened to consider active, and the other had
     * no way in from the screen built to keep them apart.
     */
    openWalletWords(phrase) {
      this.$router.push({
        path: '/settings',
        query: { section: 'backup', walletId: phrase?.walletId || undefined },
      });
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

.kit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.kit--single { grid-template-columns: 1fr; }

.kit-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-ms);
  display: grid;
  place-items: center;
  margin-bottom: 11px;
}

.kit-icon--ok { background: var(--brand-accent-soft); color: var(--brand-accent); }
.kit-icon--warn { background: var(--color-warn-soft); color: var(--color-warn); }

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
  border-radius: var(--radius-pill);
  margin-top: 11px;
}

.kit-state--ok { background: var(--brand-accent-soft); color: var(--brand-accent-text); }

/* The card is a button, so it says what pressing it does. Without this the
   screen offered two panels and no visible verb. */
.kit-action {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 12px;
  font-size: 12.5px;
  font-weight: 640;
  color: var(--brand-accent-text);
}
.kit-state--warn { background: var(--color-warn-soft); color: var(--color-warn); }

.kit-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: var(--radius-md);
  background: var(--color-warn-soft);
  color: var(--color-warn);
  font-size: 13px;
  line-height: 1.5;
  margin-top: 14px;
}

.kit-warn svg { margin-top: 1px; flex: 0 0 auto; }

body.body--dark .kit-icon--warn,
body.body--dark .kit-state--warn,


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
