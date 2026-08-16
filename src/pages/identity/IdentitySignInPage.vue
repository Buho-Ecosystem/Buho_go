<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Sign in') }}</h1>
      <p class="id-lede">{{ $t('Some websites let you in with your card instead of a password.') }}</p>

      <!--
        The feature keeps everything it had and stops owning the middle of
        the identity page. When the list is empty there is no illustration
        and no call to action pushing a niche feature on everyone: the two
        rows below are the whole screen.
      -->
      <IdentityGroup v-if="sites.length > 0">
        <IdentityRow
          v-for="site in sites"
          :key="site.domain"
          :label="displayDomain(site.domain)"
          :caption="$t('Last used {when}', { when: lastUsed(site.lastUsedAt) })"
          data-audit="identity-site-row"
          @click="openSite(site)"
        >
          <template #leading>
            <SiteFavicon :domain="site.domain" :size="38" />
          </template>
        </IdentityRow>
      </IdentityGroup>

      <p v-else class="id-empty">{{ $t('You have not signed in to any website yet.') }}</p>

      <IdentityGroup
        class="id-block"
        :footer="$t('Websites never see your name, your photo, your contacts or your balance.')"
      >
        <IdentityRow
          icon="tabler:scan"
          :label="$t('Sign in somewhere new')"
          :caption="$t('Scan the code the website shows')"
          data-audit="identity-add-site"
          @click="showAddSite = true"
        />
        <IdentityRow
          icon="tabler:info-circle"
          :label="$t('Where does this work')"
          :caption="$t('{n} sites to try', { n: 5 })"
          data-audit="identity-site-help"
          @click="showExamples = true"
        />
      </IdentityGroup>
    </div>

    <AddSiteSheet v-model="showAddSite" @submit="onAddSiteSubmitted" />
    <SiteExamplesSheet v-model="showExamples" />
    <IdentityAuthDialog v-model="showAuth" :challenge="pendingChallenge" />
    <ConnectedSiteSheet v-model="showSiteSheet" :site="selectedSite" @forget="forgetSite" />

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
import SiteFavicon from '../../components/SiteFavicon.vue';
import AddSiteSheet from '../../components/AddSiteSheet.vue';
import SiteExamplesSheet from '../../components/SiteExamplesSheet.vue';
import IdentityAuthDialog from '../../components/IdentityAuthDialog.vue';
import ConnectedSiteSheet from '../../components/ConnectedSiteSheet.vue';
import { useIdentityStore } from '../../stores/identity';

export default {
  name: 'IdentitySignInPage',

  components: {
    SettingsHubNav,
    Icon,
    IdentityNav,
    IdentityGroup,
    IdentityRow,
    SiteFavicon,
    AddSiteSheet,
    SiteExamplesSheet,
    IdentityAuthDialog,
    ConnectedSiteSheet,
  },

  setup() {
    return { identity: useIdentityStore() };
  },

  data() {
    return {
      showAddSite: false,
      showExamples: false,
      showAuth: false,
      pendingChallenge: null,
      showSiteSheet: false,
      selectedDomain: null,
    };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, '/identity'); },

    sites() {
      return this.identity.connectedSitesSorted;
    },

    /** Read from the store at computed time so the sheet stays live if the
        record changes while it is open. */
    selectedSite() {
      if (!this.selectedDomain) return null;
      return this.identity.connectedSites.find((s) => s.domain === this.selectedDomain) || null;
    },
  },

  async created() {
    await this.identity.hydrate();
  },

  methods: {
    displayDomain(domain) {
      return String(domain || '').replace(/^www\./i, '');
    },

    lastUsed(timestamp) {
      if (!timestamp) return '';
      const days = Math.floor((Date.now() - timestamp) / 86400000);
      if (days === 0) return this.$t('today');
      if (days === 1) return this.$t('yesterday');
      if (days < 30) return this.$t('{n} days ago', { n: days });
      const months = Math.floor(days / 30);
      if (months < 12) return this.$t('{n} months ago', { n: months });
      return this.$t('{n} years ago', { n: Math.floor(months / 12) });
    },

    openSite(site) {
      this.selectedDomain = site.domain;
      this.showSiteSheet = true;
    },

    /** The add-site sheet parses the link; the auth dialog signs it. The gap
        lets the sheet finish leaving before the dialog arrives. */
    onAddSiteSubmitted(challenge) {
      this.pendingChallenge = challenge;
      setTimeout(() => { this.showAuth = true; }, 180);
    },

    forgetSite(domain) {
      this.identity.removeConnectedSite(domain);
      this.$q.notify({
        type: 'info',
        message: this.$t('Removed {site}', { site: this.displayDomain(domain) }),
        caption: this.$t('This only clears the record on your phone. Signing in there again will add it back.'),
        timeout: 4000,
      });
      this.showSiteSheet = false;
      this.selectedDomain = null;
    },
  },
};
</script>

<style scoped>

.id-empty {
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 4px 6px 0;
}


.nav-icon:active { background: rgba(127, 127, 127, 0.12); }
</style>
