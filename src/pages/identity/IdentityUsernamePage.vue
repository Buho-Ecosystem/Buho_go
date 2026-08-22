<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your usernames') }}</h1>
      <p class="id-lede">
        {{ $t('Choose which name appears on your public profile. Every username you add keeps working.') }}
      </p>

      <button type="button" class="btn-primary" @click="showMarketplace = true">
        <Icon icon="tabler:plus" width="18" height="18" />
        {{ $t('Add another username') }}
      </button>

      <IdentityGroup
        v-if="usernames.length > 0"
        class="username-list"
        :title="$t('Your usernames')"
        :footer="$t('The checked name appears on your public profile. Your other usernames still find you and receive payments.')"
      >
        <IdentityRow
          v-for="entry in usernames"
          :key="entry.handle"
          icon="tabler:at"
          :tone="entry.isActive ? 'accent' : 'neutral'"
          :label="'@' + entry.handle"
          :caption="entry.isActive ? $t('Shown on your public profile') : $t('Tap to make this your public username')"
          :chip="entry.isActive ? $t('Current') : ''"
          chip-tone="ok"
          :chip-icon="entry.isActive ? 'tabler:check' : ''"
          :chevron="false"
          :interactive="!entry.isActive && !switchingHandle"
          @click="selectUsername(entry)"
        />
      </IdentityGroup>

      <div v-else class="username-empty">
        <span class="username-empty-mark"><Icon icon="tabler:at" width="24" height="24" /></span>
        <strong>{{ $t('No username yet') }}</strong>
        <span>{{ $t('Add one so people can find you more easily.') }}</span>
      </div>
    </div>

    <!--
      The purchase itself is unchanged. Availability lookup, the free
      fallback suggestion, the wallet picker, the invoice and the external
      pay disclosure all still live in the marketplace sheet, because
      reskinning a payment flow is where a redesign starts costing people
      real money. The reframe of that sheet is the next piece of work.
    -->
    <Nip05MarketplaceSheet v-model="showMarketplace" @purchased="onPurchased" />

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
import Nip05MarketplaceSheet from '../../components/Nip05MarketplaceSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { nip05AddressFor } from '../../services/nip05';

export default {
  name: 'IdentityUsernamePage',

  components: {
    SettingsHubNav,
    Icon,
    IdentityNav,
    IdentityGroup,
    IdentityRow,
    Nip05MarketplaceSheet,
  },

  setup() {
    return { identity: useIdentityStore(), profile: useProfileStore() };
  },

  data() {
    return { showMarketplace: false, switchingHandle: '' };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    usernames() {
      return [...this.identity.nip05Handles].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
  },

  methods: {
    async publishUsername(handle, successMessage) {
      this.profile.setField('nip05', nip05AddressFor(handle));
      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-username] publish failed:', err);
      }

      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: successMessage, timeout: 2200 });
        return true;
      }

      this.$q.notify({
        type: 'warning',
        message: successMessage,
        caption: this.$t('Your public profile will update once BuhoGO can reach the network.'),
        timeout: 4000,
      });
      return false;
    },

    async selectUsername(entry) {
      if (!entry || entry.isActive || this.switchingHandle) return;
      this.switchingHandle = entry.handle;
      try {
        this.identity.setActiveNip05(entry.handle);
        await this.publishUsername(
          entry.handle,
          this.$t('{name} is now on your profile', { name: '@' + entry.handle }),
        );
      } finally {
        this.switchingHandle = '';
      }
    },

    /**
     * The sheet has already added the username and promoted it. All that is
     * left is mirroring it onto the published card, which has no other save
     * gesture on this screen.
     */
    async onPurchased() {
      const handle = this.identity.nip05ActiveEntry?.handle;
      if (!handle) return;
      await this.publishUsername(
        handle,
        this.$t('{name} is yours', { name: '@' + handle }),
      );
    },
  },
};
</script>

<style scoped>

.username-list { margin-top: 6px; }

.username-empty {
  min-height: 190px;
  margin-top: 22px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
}

.username-empty-mark { width: 48px; height: 48px; margin-bottom: 12px; border-radius: 50%; display: grid; place-items: center; background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.username-empty strong { color: var(--text-primary); font-size: 16px; margin-bottom: 4px; }
</style>
