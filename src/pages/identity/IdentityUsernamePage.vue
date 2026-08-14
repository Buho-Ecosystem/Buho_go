<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

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
        <div class="uname-sub">{{ $t('This is how people find you and pay you') }}</div>
      </div>

      <button type="button" class="btn-ghost" @click="showMarketplace = true">
        {{ $t('Change username') }}
      </button>

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

      <p v-else class="id-foot">
        {{ $t('Every username you have ever used keeps working forever. Only the newest one shows on your card.') }}
      </p>

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
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import Nip05MarketplaceSheet from '../../components/Nip05MarketplaceSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';

export default {
  name: 'IdentityUsernamePage',

  components: {
    Icon,
    SettingsHubNav,
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
    activeUsername() {
      return this.identity.nip05ActiveEntry?.handle || '';
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
      const result = await this.profile.publish();
      if (result && result.ok) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('{name} is yours', { name: '@' + this.activeUsername }),
          timeout: 2500,
        });
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

.btn-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  padding: 15px 18px;
  border-radius: 15px;
  min-height: 52px;
  margin-top: 20px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  cursor: pointer;
}

.uname-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: 14px;
  background: var(--bg-input);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 20px;
}

.uname-note svg { color: var(--text-muted); margin-top: 1px; flex: 0 0 auto; }

.id-foot {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 18px 6px 0;
}
</style>
