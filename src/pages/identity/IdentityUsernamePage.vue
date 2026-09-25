<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Username') }}</h1>
      <p v-if="!usernameAddress" class="id-lede">
        {{ $t('A short name people can type to find you. Paid per year.') }}
      </p>

      <IdentityGroup
        v-if="usernameAddress || claimState"
        :footer="footer"
      >
        <!-- The username: the whole row copies the full address. -->
        <IdentityRow
          v-if="usernameAddress"
          icon="tabler:rosette-discount-check-filled"
          tone="accent"
          :label="usernameAddress"
          :caption="endDate ? $t('Until {date}', { date: endDate }) : $t('Tap to copy')"
          :chevron="false"
          @click="copyUsername"
        >
          <template #label>
            <NostrAddress :address="usernameAddress" />
          </template>
          <template #trailing>
            <Icon
              :icon="copied ? 'tabler:copy-check' : 'tabler:copy'"
              width="17"
              height="17"
              class="username-copy"
              aria-hidden="true"
            />
          </template>
        </IdentityRow>

        <!-- A purchase that is paid and finishing. -->
        <IdentityRow
          v-if="claimState === 'pending'"
          icon="tabler:rosette-discount-check"
          :label="$t('Almost ready')"
          :caption="$t('{name} will be on your card in a moment', { name: claimAddress })"
          :chevron="false"
          :interactive="false"
        >
          <template #trailing>
            <q-spinner size="16px" class="username-spinner" />
          </template>
        </IdentityRow>

        <!-- A paid purchase that went to someone else first. Shown once. -->
        <IdentityRow
          v-else-if="claimState === 'failed'"
          icon="tabler:alert-circle"
          tone="warn"
          :label="$t('We couldn\'t finish this name')"
          :caption="$t('Someone took it a moment earlier')"
          :chevron="false"
          :interactive="false"
        />
      </IdentityGroup>

      <button
        v-if="claimState !== 'pending'"
        type="button"
        class="btn-primary"
        @click="showSheet = true"
      >
        {{ usernameAddress ? $t('Change username') : $t('Choose a username') }}
      </button>
    </div>

    <Nip05MarketplaceSheet v-model="showSheet" :has-name="!!usernameAddress" />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { copyToClipboard } from 'quasar';
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import NostrAddress from '../../components/identity/NostrAddress.vue';
import Nip05MarketplaceSheet from '../../components/Nip05MarketplaceSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { nip05AddressFor } from '../../services/nip05';
import { formatCalendarDate } from '../../utils/timeFormatting';

export default {
  name: 'IdentityUsernamePage',

  components: {
    Icon,
    IdentityNav,
    SettingsHubNav,
    IdentityGroup,
    IdentityRow,
    NostrAddress,
    Nip05MarketplaceSheet,
  },

  setup() {
    return { identity: useIdentityStore(), profile: useProfileStore() };
  },

  data() {
    return { showSheet: false, copied: false, copyTimer: null };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    /** Full `maria@mybuho.de`, read from the published profile, or ''. */
    usernameAddress() {
      return nip05AddressFor(this.profile.username) || '';
    },

    /** End date this phone knows from the purchase; none rather than a guess. */
    endDate() {
      const expiresAt = this.identity.usernameExpiresAt(this.profile.username);
      return formatCalendarDate(expiresAt, this.$i18n.locale);
    },

    /** 'pending' for a paid purchase still finishing, 'failed' when lost, else ''. */
    claimState() {
      const claim = this.identity.pendingNip05Claim;
      if (claim?.failedAt) return 'failed';
      if (claim?.paidAt) return 'pending';
      return '';
    },

    claimAddress() {
      return nip05AddressFor(this.identity.pendingNip05Claim?.handle) || '';
    },

    /** Only after a change: the old name is still paid for and still resolves. */
    footer() {
      const paidNames = this.identity.nip05Handles.filter((entry) => !entry.isFree);
      return paidNames.length > 1 && this.usernameAddress
        ? this.$t('Your old username keeps working until its paid time ends.')
        : '';
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
  },

  beforeUnmount() {
    clearTimeout(this.copyTimer);
    // A lost purchase is reported once; leaving the page means it was seen.
    if (this.claimState === 'failed') this.identity.clearPendingNip05Claim();
  },

  methods: {
    async copyUsername() {
      try {
        await copyToClipboard(this.usernameAddress);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 2000 });
        return;
      }
      this.copied = true;
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => { this.copied = false; }, 2000);
      this.$q.notify({ type: 'positive', message: this.$t('Username copied'), timeout: 1600 });
    },
  },
};
</script>

<style scoped>
.username-copy,
.username-spinner {
  color: var(--text-muted);
  flex: 0 0 auto;
}
</style>
