<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

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
        <!-- The bucket belongs to the key being thrown away, so its ecash
             goes with it. This is the only loss here made of money, so it
             is stated in sats and says what to do instead. -->
        <IdentityRow
          v-if="bucketSats > 0"
          icon="tabler:alert-triangle"
          tone="danger"
          :label="$t('{n} sats in your Social Bucket are lost', { n: bucketSats })"
          :caption="$t('Move it to a wallet first')"
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
        <span class="field-label">{{ $t('Type "{phrase}" to continue', { phrase: confirmPhrase }) }}</span>
        <input
          v-model="confirmInput"
          type="text"
          class="field-input"
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
        {{ $t('Keep my card') }}
      </button>
    </div>

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
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useAddressBookStore } from '../../stores/addressBook';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { useWalletStore } from '../../stores/wallet';

export default {
  name: 'IdentityErasePage',

  components: { SettingsHubNav, Icon, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return {
      ...useIdentityHealth(),
      addressBook: useAddressBookStore(),
      bucket: useSocialBucketStore(),
      walletStore: useWalletStore(),
    };
  },

  data() {
    return { confirmInput: '', busy: false };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    /**
     * Matched verbatim to the wallet-removal gate so the gesture is learned
     * once, and translated for the same reason it is there at all: copying
     * characters in a language you do not read is not understanding.
     */
    confirmPhrase() {
      return this.$t('I understand');
    },

    canErase() {
      return this.confirmInput.trim() === this.confirmPhrase;
    },

    siteCount() {
      return this.identity.connectedSites.length;
    },

    bucketSats() {
      return this.bucket.balanceSats;
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
    // The bucket balance is part of what this screen promises to destroy, so
    // it has to be read before the promise is shown.
    await this.bucket.hydrate({ pubkey: this.identity.nostrPubkeyHex });
  },

  methods: {
    async onErase() {
      if (!this.canErase || this.busy) return;
      this.busy = true;
      try {
        // The screen counts the contacts it is about to erase, so it has to
        // actually erase them. Regenerating the key alone left the local book
        // in place, and the next sync republished every contact under the new
        // identity: the one thing the user was told would not survive.
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identity,
          changeIdentity: () => this.identity.regenerate(),
          keepContacts: false,
          discardUnsynced: true,
        });
        if (result === null) {
          this.$q.notify({
            type: 'info',
            message: this.$t('Still finishing the last change'),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        // Card metadata is identity-scoped: the new key has published
        // nothing, so the old name and photo are meaningless under it.
        this.profile.reset();
        // The bucket is the old key's, and the screen said so.
        this.bucket.reset();
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

.erase-head { text-align: center; padding: 20px 8px 6px; }

.erase-mark {
  width: 76px;
  height: 76px;
  border-radius: var(--radius-xl);
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
</style>
