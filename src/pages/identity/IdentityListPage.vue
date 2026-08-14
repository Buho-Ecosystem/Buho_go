<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your identities') }}</h1>
      <p class="id-lede">
        {{ $t('You can keep more than one card. They never see each other, and the same 12 words bring all of them back.') }}
      </p>

      <!--
        This list already shipped. Its only entry point was a kebab menu on
        the contacts page, which is why almost nobody knew identities were
        plural. It now has two: this screen and the photo on the card.
      -->
      <IdentityGroup
        :footer="$t('Switching changes your card and your contacts everywhere in BuhoGO. Your wallets and your Bitcoin stay exactly as they are.')"
      >
        <IdentityRow
          v-for="row in identities"
          :key="row.account"
          icon="tabler:user"
          :tone="row.active ? 'accent' : 'neutral'"
          :label="identityName(row)"
          :caption="row.active ? $t('{n} contacts', { n: contactCount }) : ''"
          :chip="row.active ? $t('In use') : $t('Switch')"
          :chip-tone="row.active ? 'ok' : 'mute'"
          :chevron="false"
          @click="onPick(row)"
        />
      </IdentityGroup>

      <IdentityGroup class="id-block">
        <IdentityRow
          icon="tabler:plus"
          :label="$t('Add an identity')"
          :caption="$t('For a shop, a stage name, a second life')"
          @click="showSwitchSheet = true"
        />
      </IdentityGroup>
    </div>

    <IdentitySwitchSheet v-model="showSwitchSheet" @changed="refresh" />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentitySwitchSheet from '../../components/identity/IdentitySwitchSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useAddressBookStore } from '../../stores/addressBook';

export default {
  name: 'IdentityListPage',

  components: { SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow, IdentitySwitchSheet },

  setup() {
    return { identity: useIdentityStore(), addressBook: useAddressBookStore() };
  },

  data() {
    return { identities: [], showSwitchSheet: false };
  },

  computed: {
    contactCount() {
      return this.addressBook.entries.length;
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.refresh();
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

    identityName(row) {
      return row.label || this.$t('Identity {n}', { n: row.account + 1 });
    },

    /**
     * Switching is a real change to what the whole app shows, so it runs
     * through the same sheet the card uses rather than firing from a row
     * tap. One flow, one set of confirmations, one place to fix bugs.
     */
    onPick(row) {
      if (row.active) return;
      this.showSwitchSheet = true;
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

.id-block { margin-top: 12px; }
</style>
