<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Visible in other apps') }}</h1>
      <p class="id-lede">
        {{ $t('Your photo and name are kept in sync so other Bitcoin apps can show who you are when you pay someone.') }}
      </p>

      <!--
        Every save already writes the card out to a handful of servers and
        the user never saw it happen, so a failure was invisible and a
        success was unprovable. One status line and a retry is all a person
        can act on.

        The servers are not named and not counted. That would be an accurate
        answer to a question nobody asked, and relay choice is exactly the
        kind of detail that should stay behind the curtain.
      -->
      <IdentityGroup
        :footer="$t('What is shared: your photo, your name, your line about you, and your payment name. What is never shared: your contacts, your balance, your payments and your 12 words.')"
      >
        <IdentityRow
          :icon="published ? 'tabler:check' : 'tabler:cloud-off'"
          :tone="published ? 'accent' : 'neutral'"
          :label="published ? $t('Up to date') : $t('Not shared yet')"
          :caption="published ? $t('Last updated {when}', { when: lastUpdated }) : $t('Save your card to share it')"
          :interactive="false"
        />
        <IdentityRow
          icon="tabler:refresh"
          :label="publishing ? $t('Updating') : $t('Update now')"
          :caption="$t('If another app still shows an old photo')"
          :chevron="false"
          @click="republish"
        />
      </IdentityGroup>
    </div>

    <SettingsHubNav />
  </q-page>
</template>

<script>
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useProfileStore } from '../../stores/profile';

export default {
  name: 'IdentityVisiblePage',

  components: { SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return { profile: useProfileStore() };
  },

  computed: {
    published() {
      return !!this.profile.lastPublishedAt;
    },

    publishing() {
      return this.profile.isPublishing;
    },

    lastUpdated() {
      const ts = this.profile.lastPublishedAt;
      if (!ts) return '';
      const mins = Math.floor((Date.now() - ts) / 60000);
      if (mins < 1) return this.$t('just now');
      if (mins < 60) return this.$t('{n} minutes ago', { n: mins });
      const hours = Math.floor(mins / 60);
      if (hours < 24) return this.$t('{n} hours ago', { n: hours });
      const days = Math.floor(hours / 24);
      if (days === 1) return this.$t('yesterday');
      return this.$t('{n} days ago', { n: days });
    },
  },

  async created() {
    await this.profile.hydrate();
  },

  methods: {
    async republish() {
      if (this.publishing) return;
      // publish() always writes the current payload, so a plain call is the
      // retry. There is no force flag to pass.
      const result = await this.profile.publish();
      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: this.$t('Updated'), timeout: 2000 });
      } else {
        this.$q.notify({
          type: 'negative',
          message: this.$t('That did not go through'),
          caption: this.$t('Try again in a moment.'),
          timeout: 3500,
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
</style>
