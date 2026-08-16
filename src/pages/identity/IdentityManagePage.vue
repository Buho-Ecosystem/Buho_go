<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Manage your card') }}</h1>

      <!-- What is on the card. Sections are named by the question a user is
           asking, not by the feature that answers it. -->
      <IdentityGroup :footer="$t('Your photo and name are public. Your contacts, your balance and your 12 words never leave your phone.')">
        <IdentityRow
          icon="tabler:user"
          :label="$t('Photo and name')"
          :caption="profileCaption"
          @click="$router.push('/identity/profile')"
        />
        <IdentityRow
          icon="tabler:at"
          tone="accent"
          :label="$t('Username')"
          :caption="username ? '@' + username : $t('Being reserved')"
          @click="$router.push('/identity/username')"
        />
        <IdentityRow
          icon="tabler:arrow-bar-to-down"
          :tone="lud16 ? 'neutral' : 'warn'"
          :label="$t('Get paid')"
          :caption="lud16 ? $t('Your code, your link, where money lands') : $t('Setting up')"
          @click="$router.push('/identity/get-paid')"
        />
        <IdentityRow
          icon="tabler:cloud"
          :label="$t('Visible in other apps')"
          :caption="publishCaption"
          :chip="publishChip"
          :chip-tone="publishChipTone"
          @click="$router.push('/identity/visible')"
        />
      </IdentityGroup>

      <IdentityGroup :title="$t('Safety')">
        <IdentityRow
          icon="tabler:shield-lock"
          :tone="cardWordsSaved ? 'neutral' : 'warn'"
          :label="$t('Your 12 words')"
          :caption="$t('Bring back your name, photo and contacts.')"
          :chip="cardWordsSaved ? $t('Done') : $t('To do')"
          :chip-tone="cardWordsSaved ? 'ok' : 'warn'"
          :chip-icon="cardWordsSaved ? 'tabler:check' : ''"
          @click="$router.push('/identity/words')"
        />
        <IdentityRow
          icon="tabler:lock"
          :label="$t('App lock')"
          :caption="appLockCaption"
          :chip="biometricsEnabled ? $t('On') : $t('Off')"
          :chip-tone="biometricsEnabled ? 'ok' : 'mute'"
          :interactive="false"
        />
      </IdentityGroup>

      <IdentityGroup :title="$t('More')">
        <IdentityRow
          icon="tabler:users"
          :label="$t('Your accounts')"
          :caption="identityCountCaption"
          @click="$router.push('/identity/identities')"
        />
        <IdentityRow
          icon="tabler:key"
          :label="$t('Advanced')"
          :caption="$t('Use this card in other apps')"
          @click="$router.push('/identity/advanced')"
        />
        <IdentityRow
          icon="tabler:info-circle"
          :label="$t('What is this card for')"
          @click="$router.push('/identity/about')"
        />
      </IdentityGroup>

      <!-- Destructive, in its own group, with air above it, no chevron, and
           a footer that answers the fear before the tap. -->
      <IdentityGroup
        class="id-danger-group"
        :footer="$t('Erasing a card never touches your wallets or your Bitcoin.')"
      >
        <IdentityRow
          icon="tabler:trash"
          danger
          :label="$t('Erase this card')"
          :chevron="false"
          @click="$router.push('/identity/erase')"
        />
      </IdentityGroup>
    </div>

      <SettingsHubNav />

  </q-page>
</template>

<script>
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useWalletStore } from '../../stores/wallet';

export default {
  name: 'IdentityManagePage',

  components: { SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return { ...useIdentityHealth(), walletStore: useWalletStore() };
  },

  data() {
    return { identityCount: 1 };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, '/identity'); },

    username() {
      return this.identity.nip05ActiveEntry?.handle || '';
    },

    /** The payment destination behind the username. */
    lud16() {
      return this.profile.lud16 || '';
    },

    profileCaption() {
      return this.profile.displayName || this.profile.name || this.$t('Not set yet');
    },

    publishCaption() {
      if (!this.profile.lastPublishedAt) return this.$t('Not shared yet');
      return this.$t('Up to date');
    },

    publishChip() {
      return this.profile.lastPublishedAt ? this.$t('On') : '';
    },

    publishChipTone() {
      return 'ok';
    },

    /**
     * The one line that has to carry the two-phrase problem. It names both
     * halves explicitly, because a user who saved one genuinely believes
     * they are done.
     */

    biometricsEnabled() {
      return !!this.walletStore.biometricsEnabled;
    },

    appLockCaption() {
      return this.biometricsEnabled
        ? this.$t('Fingerprint needed to open BuhoGO')
        : this.$t('Anyone who opens your phone can open BuhoGO');
    },

    identityCountCaption() {
      return this.identityCount > 1
        ? this.$t('{n} accounts, same 12 words', { n: this.identityCount })
        : this.$t('One account. You can add more');
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    // Needed before the 12-words row can say how many phrases exist.
    await this.ensureWalletLoaded();
    try {
      const list = await this.identity.listNostrIdentities();
      this.identityCount = Array.isArray(list) ? list.length : 1;
    } catch {
      this.identityCount = 1;
    }
  },
};
</script>

<style scoped>

/* Air above the destructive group so it never reads as the next item in a
   list of routine settings. */
.id-danger-group { margin-top: 22px; }
</style>
