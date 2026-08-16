<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your accounts') }}</h1>
      <p class="id-lede">
        {{ $t('You can keep more than one account. They never see each other, and the same 12 words bring all of them back.') }}
      </p>

      <button type="button" class="btn-primary add-account" :disabled="busy || bucket.isSweeping" @click="step = 'create'">
        <Icon icon="tabler:plus" width="18" height="18" />
        <span>{{ $t('Add an account') }}</span>
      </button>

      <!--
        This screen IS the switcher.
        It used to be a list whose rows opened a sheet containing the same
        list, so changing identity meant choosing the same one twice. Tapping a
        row here switches, which is the only thing a row naming an identity
        should do.
      -->
      <IdentityGroup
        :title="$t('Accounts')"
        :footer="$t('Switching changes your card and your contacts everywhere in BuhoGO. Your wallets and your Bitcoin stay exactly as they are.')"
      >
        <IdentityRow
          v-for="row in identities"
          :key="row.account"
          icon="tabler:user"
          :tone="row.active ? 'accent' : 'neutral'"
          :label="identityName(row)"
          :caption="row.active ? $t('{n} contacts', { n: contactCount }) : ''"
          :chip="row.active ? $t('In use') : ''"
          chip-tone="ok"
          :chevron="!row.active"
          :interactive="!row.active && !busy && !bucket.isSweeping"
          @click="onSwitch(row)"
        />
      </IdentityGroup>

    </div>

    <!--
      Both changes ask exactly one question first, because both replace what
      the entire app shows. Switching asks for confirmation; creating asks the
      only thing that cannot be undone afterwards.
    -->
    <q-dialog v-model="showAsk" :persistent="busy" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="ask-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="ask-body">
          <h2 class="ask-title">{{ askTitle }}</h2>
          <p class="ask-text">{{ askBody }}</p>

          <template v-if="step === 'create'">
            <button type="button" class="ask-primary" :disabled="busy" @click="onCreate(true)">
              <q-spinner v-if="busy" size="18px" />
              <span>{{ $t('Bring my contacts') }}</span>
            </button>
            <button type="button" class="ask-secondary" :disabled="busy" @click="onCreate(false)">
              {{ $t('Start empty') }}
            </button>
          </template>

          <template v-else>
            <button type="button" class="ask-primary" :disabled="busy" @click="confirmSwitch">
              <q-spinner v-if="busy" size="18px" />
              <span>{{ $t('Switch to {name}', { name: pendingName }) }}</span>
            </button>
          </template>

          <button type="button" class="ask-quiet" :disabled="busy" @click="closeAsk">
            {{ $t('Cancel') }}
          </button>
        </div>
      </q-card>
    </q-dialog>
      <SettingsHubNav />

  </q-page>
</template>

<script>
import IdentityNav from '../../components/identity/IdentityNav.vue';
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useAddressBookStore } from '../../stores/addressBook';
import { useSocialBucketStore } from '../../stores/socialBucket';

export default {
  name: 'IdentityListPage',

  components: { SettingsHubNav, Icon, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return {
      identity: useIdentityStore(),
      addressBook: useAddressBookStore(),
      bucket: useSocialBucketStore(),
    };
  },

  data() {
    return {
      identities: [],
      step: null, // null | 'switch' | 'create'
      pending: null,
      busy: false,
    };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },


    contactCount() {
      return this.addressBook.entries.length;
    },

    showAsk: {
      get() { return this.step !== null; },
      set(v) { if (!v) this.closeAsk(); },
    },

    pendingName() {
      return this.pending ? this.identityName(this.pending) : '';
    },

    askTitle() {
      return this.step === 'create'
        ? this.$t('Bring your contacts along?')
        : this.$t('Switch account?');
    },

    askBody() {
      return this.step === 'create'
        ? this.$t('Your new account can start with a copy of your contacts, or with none. The same 12 words cover both.')
        : this.$t('Your card, your contacts and your username all change. Your wallets and your Bitcoin stay as they are.');
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.refresh();

    // A stale pointer means another device cannot find these identities after
    // a restore. The moment the user is looking at the list is the moment it
    // matters most, and it is our retry to make, not a task to hand over.
    if (this.identity.pointerDirty) {
      this.identity.republishNostrPointer().catch(() => {});
    }
  },

  methods: {
    async refresh() {
      try {
        this.identities = await this.identity.listNostrIdentities();
      } catch (err) {
        console.warn('[identity-list] listing failed:', err);
        this.identities = [];
      }
    },

    /**
     * A user-set label wins, then the card's own username, then the
     * numbered fallback for a card that has neither yet.
     */
    identityName(row) {
      if (row.label) return row.label;
      if (row.username) return `@${row.username}`;
      return this.$t('Account {n}', { n: row.account + 1 });
    },

    onSwitch(row) {
      if (row.active || this.busy || this.bucket.isSweeping) return;
      this.pending = row;
      this.step = 'switch';
    },

    closeAsk() {
      if (this.busy) return;
      this.step = null;
      this.pending = null;
    },

    /**
     * The profile is scoped to a key, so a changed identity leaves it stale.
     * Reset and refetch, the same treatment a phrase restore gets.
     */
    _refreshProfileForNewIdentity() {
      const profile = useProfileStore();
      profile.reset();
      profile.recoverFromNostr({ identityStore: this.identity }).catch(() => {});
      this.bucket.hydrate({ pubkey: this.identity.nostrPubkeyHex })
        .then(() => this.bucket.sync({ identityStore: this.identity }))
        .catch(() => {});
    },

    _notifyFailed(result, message) {
      const caption = result.reason === 'flush-failed'
        ? this.$t('Your contacts have not finished saving, so nothing was changed. Check your connection and try again.')
        : this.$t('Check your connection and try again.');
      this.$q.notify({ type: 'negative', message, caption, timeout: 4500 });
    },

    async confirmSwitch() {
      if (!this.pending || this.busy || this.bucket.isSweeping) return;
      const target = this.pending;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identity,
          changeIdentity: () => this.identity.switchNostrIdentity(target.account),
          keepContacts: false,
        });

        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Still finishing the last change'),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t("Couldn't switch account"));
          await this.refresh();
          return;
        }

        this._refreshProfileForNewIdentity();
        await this.refresh();
        this.$q.notify({ type: 'positive', message: this.$t('Switched account'), timeout: 3000 });
        this.step = null;
        this.pending = null;
      } catch (err) {
        console.warn('[identity-list] switch failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't switch account"),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },

    async onCreate(keepContacts) {
      if (this.busy || this.bucket.isSweeping) return;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identity,
          changeIdentity: () => this.identity.createAnotherNostrIdentity(),
          keepContacts,
        });

        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Still finishing the last change'),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t("Couldn't create the account"));
          await this.refresh();
          return;
        }

        this._refreshProfileForNewIdentity();
        await this.refresh();
        this.$q.notify({ type: 'positive', message: this.$t('New account created'), timeout: 3000 });
        this.step = null;
      } catch (err) {
        console.warn('[identity-list] create failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't create the account"),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>

.add-account { margin-top: 0 !important; margin-bottom: 4px; }

/* A question with an answer, so a centred card rather than a bottom sheet. */
.ask-card {
  width: 100%;
  max-width: 380px;
  border-radius: var(--radius-lg);
}

.ask-body { padding: 24px 20px 18px; text-align: center; }

.ask-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.028em;
  line-height: 1.22;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.ask-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 20px;
}

.ask-primary,
.ask-secondary,
.ask-quiet {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  min-height: 50px;
  cursor: pointer;
  margin-bottom: 8px;
  border: 1px solid transparent;
}

.ask-primary { background: #1A1A1C; color: #FAF7EF; }
body.body--dark .ask-primary { background: #F4F4F4; color: #0C0C0C; }
.ask-secondary { background: transparent; color: var(--text-primary); border-color: var(--border-card); }
.ask-quiet { background: transparent; color: var(--text-secondary); margin-bottom: 0; }

.ask-primary:disabled,
.ask-secondary:disabled,
.ask-quiet:disabled { opacity: 0.5; cursor: default; }
</style>
