<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your profile') }}</h1>
      <p class="id-lede">
        {{ $t('Choose how people see and find you. Your private information stays on this phone.') }}
      </p>

      <button type="button" class="profile-summary" @click="$router.push('/identity/profile')">
        <span class="profile-avatar">
          <img v-if="profilePicture" :src="profilePicture" alt="" @error="avatarBroken = true" />
          <Icon v-else icon="tabler:user" width="30" height="30" />
        </span>
        <span class="profile-summary-copy">
          <span class="profile-kicker">{{ $t('Public profile') }}</span>
          <span class="profile-name">{{ profileCaption }}</span>
          <span class="profile-handle">{{ username ? '@' + username : $t('Add a username') }}</span>
        </span>
        <span class="profile-edit">{{ $t('Edit') }}</span>
      </button>

      <IdentityGroup :title="$t('Recovery')">
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
      </IdentityGroup>

      <IdentityGroup :title="$t('Accounts and access')">
        <IdentityRow
          icon="tabler:users"
          :label="$t('Your accounts')"
          :caption="identityCountCaption"
          @click="$router.push('/identity/identities')"
        />
      </IdentityGroup>

      <IdentityGroup :title="$t('Advanced')">
        <IdentityRow
          icon="tabler:at"
          tone="accent"
          :label="$t('Username')"
          :caption="username ? '@' + username : $t('Being reserved')"
          @click="$router.push('/identity/username')"
        />
        <IdentityRow
          icon="tabler:key"
          :label="$t('Keys and apps')"
          :caption="$t('Your npub and secret key')"
          @click="$router.push('/identity/advanced')"
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
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';

export default {
  name: 'IdentityManagePage',

  components: { SettingsHubNav, Icon, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return { ...useIdentityHealth() };
  },

  data() {
    return { identityCount: 1, avatarBroken: false };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    username() {
      return this.identity.nip05ActiveEntry?.handle || '';
    },

    profileCaption() {
      return this.profile.displayName || this.profile.name || this.$t('Not set yet');
    },

    profilePicture() {
      return this.avatarBroken ? '' : (this.profile.picture || '');
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

.profile-summary {
  width: 100%;
  min-height: 108px;
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 16px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  color: var(--text-primary);
  text-align: left;
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
  box-shadow: 0 14px 34px -30px rgba(0, 0, 0, 0.7);
}

.profile-summary:active { transform: scale(0.992); }

.profile-avatar {
  width: 68px;
  height: 68px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
}

.profile-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.profile-summary-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.profile-kicker { font-size: 11.5px; font-weight: 700; color: var(--text-secondary); }
.profile-name { margin-top: 2px; font-size: 19px; font-weight: 740; letter-spacing: -0.025em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-handle { margin-top: 2px; font-size: 12.5px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-edit { flex: 0 0 auto; min-height: 32px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: var(--radius-pill); background: var(--brand-accent-soft); color: var(--brand-accent-text); font-size: 12.5px; font-weight: 700; }

/* Air above the destructive group so it never reads as the next item in a
   list of routine settings. */
.id-danger-group { margin-top: 22px; }
</style>
