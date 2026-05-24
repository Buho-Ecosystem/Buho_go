<template>
  <!--
    Profile card — top of Settings. Mirrors the pattern used by every
    modern banking app: avatar + display name + handle, tappable to
    open the full profile editor at /profile. Acts as the single
    discoverable surface for the identity feature, so we don't need
    to duplicate a "Profile" row in any section below.

    States:
      • bootstrapped + profile filled  → avatar, name, lud16
      • bootstrapped + empty profile  → silhouette, "Set up your profile"
      • backup outstanding             → amber pill "Backup needed"
      • backup confirmed               → green pill "Identity backed up"
  -->
  <button type="button" class="profile-card" @click="onClick">
    <span class="profile-card-avatar">
      <img
        v-if="avatarUrl && !avatarBroken"
        :src="avatarUrl"
        :alt="$t('Profile picture')"
        class="profile-card-avatar-img"
        @error="avatarBroken = true"
      />
      <Icon
        v-else
        icon="tabler:user"
        width="28"
        height="28"
        class="profile-card-avatar-glyph"
        aria-hidden="true"
      />
    </span>

    <span class="profile-card-meta">
      <span class="profile-card-name">{{ displayName }}</span>
      <span class="profile-card-sub">{{ subline }}</span>
    </span>

    <span class="profile-card-right">
      <span
        v-if="backupBadge"
        class="profile-card-badge"
        :class="`profile-card-badge--${backupBadge.variant}`"
      >
        <Icon :icon="backupBadge.icon" width="11" height="11" />
        {{ backupBadge.label }}
      </span>
      <Icon icon="tabler:chevron-right" width="16" height="16" class="profile-card-chev" />
    </span>
  </button>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';

export default {
  name: 'SettingsProfileCard',
  components: { Icon },
  emits: ['click'],
  setup() {
    const identity = useIdentityStore();
    const profile = useProfileStore();
    return { identity, profile };
  },
  data() {
    return {
      avatarBroken: false,
    };
  },
  computed: {
    avatarUrl() {
      return this.profile.picture || '';
    },
    displayName() {
      const name = this.profile.displayName || this.profile.name;
      if (name) return name;
      if (this.identity.bootstrapped) return this.$t('Your profile');
      return this.$t('Set up your profile');
    },
    subline() {
      if (this.profile.lud16) return this.profile.lud16;
      if (this.identity.bootstrapped) return this.$t('Add a name and picture');
      return this.$t('Make it yours in a tap');
    },
    backupBadge() {
      if (!this.identity.bootstrapped) return null;
      if (this.identity.backupConfirmed) {
        return {
          variant: 'success',
          icon: 'tabler:shield-check',
          label: this.$t('Backed up'),
        };
      }
      return {
        variant: 'warning',
        icon: 'tabler:shield-exclamation',
        label: this.$t('Backup needed'),
      };
    },
  },
  watch: {
    avatarUrl() {
      // New URL → give it a fresh chance to load.
      this.avatarBroken = false;
    },
  },
  methods: {
    onClick() {
      this.$emit('click');
      this.$router.push('/profile');
    },
  },
};
</script>

<style scoped>
.profile-card {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  margin-bottom: 14px;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.profile-card:active {
  transform: scale(0.995);
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.06));
}

.profile-card-avatar {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.profile-card-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.profile-card-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.profile-card-name {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-card-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-card-right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.profile-card-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 9px 4px 7px;
  border-radius: 999px;
  white-space: nowrap;
}

.profile-card-badge--warning {
  background: rgba(255, 168, 0, 0.16);
  color: #FFB347;
}
.profile-card-badge--success {
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.16));
  color: var(--color-green, #15DE72);
}
body.body--light .profile-card-badge--warning { color: #B8780E; }

.profile-card-chev {
  color: var(--text-muted);
  opacity: 0.7;
}
</style>
