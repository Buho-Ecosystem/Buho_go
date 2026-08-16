<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <!--
        A username, treated the way every social app treats one.

        Underneath it is a verified address at a domain, and none of that is
        the user's problem. Here it is one line, one button, and the domain
        appears only on Get paid where an outside app needs the whole string.

        There is no active/inactive radio group any more. The newest username
        is the one on the card, older ones keep receiving forever, and that
        is the only fact about them worth stating.
      -->
      <div class="uname-hero">
        <div class="uname-big">{{ activeUsername ? '@' + activeUsername : '…' }}</div>
        <div class="uname-sub">{{ $t('This is how people find you') }}</div>
      </div>

      <button type="button" class="btn-ghost" @click="showMarketplace = true">
        {{ $t('Change username') }}
      </button>

      <p class="id-foot">{{ payFooter }}</p>

      <IdentityGroup
        v-if="oldUsernames.length > 0"
        :title="$t('Your old usernames')"
        :footer="$t('Every username you have ever used keeps working forever. Only the newest one shows on your card.')"
      >
        <IdentityRow
          v-for="entry in oldUsernames"
          :key="entry.handle"
          icon="tabler:at"
          :label="'@' + entry.handle"
          :caption="$t('Payments sent here still arrive')"
          :interactive="false"
        />
      </IdentityGroup>


      <!-- A username is a nickname. Nothing here may suggest it proves who
           somebody is, in either direction. -->
      <div class="uname-note">
        <Icon icon="tabler:info-circle" width="17" height="17" />
        <span>{{ $t('A username is a nickname, not proof of who someone is. Treat other people\'s usernames the same way.') }}</span>
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
    return { showMarketplace: false };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    activeUsername() {
      return this.identity.nip05ActiveEntry?.handle || '';
    },

    lud16() {
      return this.profile.lud16 || '';
    },

    /**
     * What the name is for, in the user's terms.
     *
     * It used to explain that a username resolves to a profile and then to a
     * Lightning address, which is true and is none of their business. The one
     * consequence they can act on is that the name is what makes their link
     * readable, and Get paid owns everything about receiving.
     */
    payFooter() {
      return this.lud16
        ? this.$t('It is also what makes your link short, so people can read it back to you.')
        : this.$t('Your name finds you. Get paid is where you set up receiving.');
    },

    /**
     * Everything that is not the current one. Sorted newest first so the
     * list reads as history rather than as a set of choices.
     */
    oldUsernames() {
      return this.identity.nip05Handles
        .filter((h) => !h.isActive)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
  },

  methods: {
    /**
     * The sheet has already added the username and promoted it. All that is
     * left is mirroring it onto the published card, which has no other save
     * gesture on this screen.
     */
    async onPurchased() {
      const address = this.identity.nip05Address;
      if (!address) return;
      this.profile.setField('nip05', address);
      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-username] publish failed:', err);
      }
      if (result && result.ok) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('{name} is yours', { name: '@' + this.activeUsername }),
          timeout: 2500,
        });
        return;
      }
      // The name is registered either way; only the card is behind.
      this.$q.notify({
        type: 'warning',
        message: this.$t('{name} is yours', { name: '@' + this.activeUsername }),
        caption: this.$t('Your card will show it once BuhoGO can reach the network.'),
        timeout: 4000,
      });
    },
  },
};
</script>

<style scoped>

.uname-hero { text-align: center; padding: 14px 0 4px; }

.uname-big {
  font-size: 32px;
  font-weight: 770;
  letter-spacing: -0.035em;
  color: var(--text-primary);
  word-break: break-all;
}

.uname-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.uname-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 20px;
}

.uname-note svg { color: var(--text-muted); margin-top: 1px; flex: 0 0 auto; }
</style>
