<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

    <div class="id-sub-body">
      <div class="erase-head">
        <span class="erase-mark"><Icon icon="tabler:alert-triangle" width="34" height="34" /></span>
        <h1 class="erase-title">{{ $t('This cannot be undone') }}</h1>
      </div>

      <!--
        The old confirmation was a paragraph of prose plus a typed phrase.
        Prose gets skimmed. A list of real losses, counted from this user's
        own data, does not.

        The reassuring row comes first on purpose: "will I lose my money" is
        the actual fear, and answering it early buys attention for the rest.
      -->
      <IdentityGroup>
        <IdentityRow
          icon="tabler:check"
          tone="accent"
          :label="$t('Your wallets and Bitcoin stay untouched')"
          :interactive="false"
        />
        <IdentityRow
          icon="tabler:x"
          tone="danger"
          :label="lossLine"
          :interactive="false"
        />
        <IdentityRow
          v-if="siteCount > 0"
          icon="tabler:x"
          tone="danger"
          :label="$t('{n} websites will treat you as a new person', { n: siteCount })"
          :interactive="false"
        />
        <!-- Only when the words were never written down, which is the case
             where this is genuinely irreversible. -->
        <IdentityRow
          v-if="!cardWordsSaved"
          icon="tabler:alert-triangle"
          tone="warn"
          :label="$t('You never saved these card words')"
          :caption="$t('There is no way back to this card')"
          :interactive="false"
        />
      </IdentityGroup>

      <label class="field">
        <span class="field-label">{{ $t('Type "I understand" to continue') }}</span>
        <input
          v-model="confirmInput"
          type="text"
          class="field-input"
          :placeholder="confirmPhrase"
          spellcheck="false"
          autocomplete="off"
        />
      </label>

      <button
        type="button"
        class="btn-danger"
        :disabled="!canErase || busy"
        @click="onErase"
      >
        <q-spinner v-if="busy" size="18px" />
        <span>{{ $t('Erase and start fresh') }}</span>
      </button>
      <button type="button" class="btn-quiet" :disabled="busy" @click="$router.back()">
        {{ $t('Keep my identity') }}
      </button>
    </div>

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useAddressBookStore } from '../../stores/addressBook';
import { useWalletStore } from '../../stores/wallet';

/** Matched verbatim to the wallet-removal flow so the gesture is learned once. */
const CONFIRM_PHRASE = 'I understand';

export default {
  name: 'IdentityErasePage',

  components: { Icon, SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return {
      ...useIdentityHealth(),
      addressBook: useAddressBookStore(),
      walletStore: useWalletStore(),
    };
  },

  data() {
    return { confirmInput: '', busy: false, confirmPhrase: CONFIRM_PHRASE };
  },

  computed: {
    canErase() {
      return this.confirmInput.trim() === this.confirmPhrase;
    },

    siteCount() {
      return this.identity.connectedSites.length;
    },

    contactCount() {
      return this.addressBook.entries.length;
    },

    /** Counted from the user's own data, so it is their loss, not a warning. */
    lossLine() {
      const name = this.profile.displayName || this.profile.name;
      if (name && this.contactCount > 0) {
        return this.$t('{name} and {n} contacts are erased', { name, n: this.contactCount });
      }
      if (name) return this.$t('{name} is erased', { name });
      if (this.contactCount > 0) {
        return this.$t('{n} contacts are erased', { n: this.contactCount });
      }
      return this.$t('This card is erased');
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
  },

  methods: {
    async onErase() {
      if (!this.canErase || this.busy) return;
      this.busy = true;
      try {
        await this.identity.regenerate();
        // Card metadata is identity-scoped: the new key has published
        // nothing, so the old name and photo are meaningless under it.
        this.profile.reset();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Your new card is ready'),
          caption: this.$t('Save its 12 words so you can move it to another phone.'),
          timeout: 4500,
        });
        this.$router.push('/identity');
      } catch (err) {
        console.error('[identity-erase] failed', err);
        this.walletStore.showPaymentError(err, {
          context: 'identity',
          route: 'Erase identity',
          reason: this.$t('Please try again.'),
          t: this.$t.bind(this),
        });
      } finally {
        this.busy = false;
      }
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

.erase-head { text-align: center; padding: 20px 8px 6px; }

.erase-mark {
  width: 76px;
  height: 76px;
  border-radius: 26px;
  background: rgba(255, 68, 68, 0.10);
  color: var(--color-red);
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
}

.erase-title {
  font-size: 25px;
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.18;
  color: var(--text-primary);
  margin: 0 0 14px;
}

.field { display: block; margin: 18px 0 16px; }

.field-label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 6px 3px;
}

.field-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: 13px;
  padding: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  color: var(--text-primary);
  min-height: 50px;
}

.btn-danger,
.btn-quiet {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  padding: 15px 18px;
  border-radius: 15px;
  min-height: 52px;
  cursor: pointer;
  border: 0;
  margin-bottom: 9px;
}

.btn-danger { background: var(--color-red); color: #fff; }
.btn-danger:disabled { opacity: 0.4; cursor: default; }
.btn-quiet { background: transparent; color: var(--text-secondary); }
</style>
