<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Visible in other apps') }}</h1>
      <p class="id-lede">
        {{ $t('Your photo and name are kept in sync so other Bitcoin apps can show who you are when you pay someone.') }}
      </p>

      <section class="visibility-card" :class="{ 'visibility-card--ready': published }">
        <span class="visibility-mark">
          <Icon :icon="published ? 'tabler:check' : 'tabler:cloud-off'" width="28" height="28" />
        </span>
        <h2>{{ published ? $t('Up to date') : $t('Not shared yet') }}</h2>
        <p>{{ published ? $t('Last updated {when}', { when: lastUpdated }) : $t('Update now to make your profile visible in other apps.') }}</p>
      </section>

      <button type="button" class="btn-primary" :disabled="publishing" @click="republish">
        <q-spinner v-if="publishing" size="18px" />
        <Icon v-else icon="tabler:cloud-up" width="18" height="18" />
        <span>{{ publishing ? $t('Updating') : $t('Update now') }}</span>
      </button>

      <p class="id-foot">{{ $t('Shared: your photo, name, about line and payment name. Private: your contacts, balance, payments and 12 words.') }}</p>
    </div>

      <SettingsHubNav />

  </q-page>
</template>

<script>
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import { Icon } from '@iconify/vue';
import { useProfileStore } from '../../stores/profile';

export default {
  name: 'IdentityVisiblePage',

  components: { SettingsHubNav, Icon, IdentityNav },

  setup() {
    return { profile: useProfileStore() };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

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
      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-visible] publish failed:', err);
      }
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
.visibility-card { padding: 26px 20px 22px; text-align: center; border: 1px solid var(--border-card); border-radius: var(--radius-xl); background: var(--bg-card); }
.visibility-mark { width: 58px; height: 58px; margin: 0 auto 14px; display: grid; place-items: center; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); }
.visibility-card--ready .visibility-mark { background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.visibility-card h2 { margin: 0; color: var(--text-primary); font-size: 20px; font-weight: 740; letter-spacing: -0.025em; }
.visibility-card p { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.45; }
</style>
