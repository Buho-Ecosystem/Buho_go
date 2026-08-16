<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" :title="$t('Photo and name')">
      <template #actions>
        <button
          type="button"
          class="nav-save"
          :disabled="!canSave || profile.isPublishing"
          @click="onSave"
        >
          <q-spinner v-if="profile.isPublishing" size="16px" />
          <span v-else>{{ $t('Save') }}</span>
        </button>
      </template>
    </IdentityNav>

    <div class="id-sub-body">
      <!--
        Two fields. That is the whole screen.

        The sheet this replaces carried the avatar, name, bio, a collapsed
        section, an outside payment address, a radio list of usernames, a buy
        button, a nested marketplace sheet, an error banner and a sticky save
        bar. Everything except photo, name and one line moved to the screen
        that owns it.
      -->
      <div class="avatar-wrap">
        <button
          type="button"
          class="avatar-btn"
          :disabled="profile.isUploadingAvatar"
          :aria-label="visibleAvatar ? $t('Change your photo') : $t('Add a photo')"
          @click="showPicker = true"
        >
          <span class="avatar">
            <img v-if="visibleAvatar" :src="visibleAvatar" alt="" @error="avatarBroken = true" />
            <Icon v-else icon="tabler:user" width="32" height="32" />
            <span v-if="profile.isUploadingAvatar" class="avatar-busy">
              <q-spinner color="white" size="22px" />
            </span>
          </span>
          <span v-if="!profile.isUploadingAvatar" class="avatar-badge" aria-hidden="true">
            <Icon icon="tabler:camera" width="13" height="13" />
          </span>
        </button>
      </div>

      <label class="field">
        <span class="field-label">{{ $t('Name') }}</span>
        <input
          v-model="form.displayName"
          type="text"
          class="field-input"
          :placeholder="$t('Your name')"
          maxlength="200"
          spellcheck="false"
          autocomplete="off"
        />
      </label>

      <label class="field">
        <span class="field-label">{{ $t('A line about you') }}</span>
        <textarea
          v-model="form.about"
          class="field-input field-input--multiline"
          rows="3"
          maxlength="280"
        ></textarea>
        <span class="field-help">{{ $t('Optional. Shown on your card.') }}</span>
      </label>

      <!-- Publish failures used to appear in a banner inside a sheet the
           user had already closed. Here it sits where the save happened. -->
      <div v-if="publishError" class="publish-error" role="alert">
        <Icon icon="tabler:alert-circle" width="18" height="18" />
        <div>
          <div class="publish-error-title">{{ publishError.title }}</div>
          <div class="publish-error-body">{{ publishError.caption }}</div>
        </div>
      </div>

      <p class="id-foot">
        {{ $t('Saving updates your card everywhere, including in other apps that show it. You can change or clear this any time.') }}
      </p>
    </div>

    <ProfileAvatarPickerSheet
      v-model="showPicker"
      @uploaded="avatarBroken = false"
      @removed="avatarBroken = false"
    />

      <SettingsHubNav />

  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import ProfileAvatarPickerSheet from '../../components/ProfileAvatarPickerSheet.vue';
import { useProfileStore } from '../../stores/profile';
import { useIdentityStore } from '../../stores/identity';

export default {
  name: 'IdentityProfilePage',

  components: { SettingsHubNav, Icon, IdentityNav, ProfileAvatarPickerSheet },

  setup() {
    return { profile: useProfileStore(), identity: useIdentityStore() };
  },

  data() {
    return {
      form: { displayName: '', about: '' },
      showPicker: false,
      avatarBroken: false,
      publishError: null,
    };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, '/identity/manage'); },

    visibleAvatar() {
      if (!this.profile.picture || this.avatarBroken) return '';
      return this.profile.picture;
    },

    /**
     * Save stays enabled while the store carries an unsaved publish from a
     * previous attempt, so a failed publish can be retried without editing
     * the form again.
     */
    canSave() {
      const dirty =
        this.form.displayName !== (this.profile.displayName || '') ||
        this.form.about !== (this.profile.about || '');
      return dirty || this.profile.isDirty;
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    if (!this.identity.bootstrapped) await this.identity.ensureIdentity();
    this.form.displayName = this.profile.displayName || '';
    this.form.about = this.profile.about || '';
  },

  watch: {
    'profile.picture'() {
      this.avatarBroken = false;
    },
  },

  methods: {
    async onSave() {
      this.publishError = null;
      this.profile.setField('displayName', this.form.displayName.trim());
      this.profile.setField('about', this.form.about.trim());

      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-profile] publish failed:', err);
      }
      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: this.$t('Saved'), timeout: 2000 });
        this.$router.back();
        return;
      }

      this.publishError = {
        title: this.$t('Your card was saved on this phone'),
        caption: this.$t('It could not be shared with other apps yet. Tap Save again when you have a connection.'),
      };
    },
  },
};
</script>

<style scoped>

.nav-save {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 650;
  padding: 10px 15px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  border: 0;
  background: #1A1A1C;
  color: #FAF7EF;
  cursor: pointer;
}

body.body--dark .nav-save { background: #F4F4F4; color: #0C0C0C; }

.nav-save:disabled { opacity: 0.4; cursor: default; }

.avatar-wrap { display: flex; justify-content: center; padding: 14px 0 22px; }

.avatar-btn {
  position: relative;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--bg-input);
  color: var(--text-muted);
  position: relative;
}

.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.avatar-busy {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.42);
}

.avatar-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #1A1A1C;
  color: #FAF7EF;
  display: grid;
  place-items: center;
  border: 3px solid var(--bg-primary);
}

body.body--dark .avatar-badge { background: #F4F4F4; color: #0C0C0C; }

.field-input--multiline { resize: none; line-height: 1.45; }

.publish-error {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 13px;
  border-radius: var(--radius-md);
  background: rgba(255, 68, 68, 0.09);
  color: var(--color-red);
  margin-bottom: 14px;
}

.publish-error-title { font-size: 13.5px; font-weight: 650; }
.publish-error-body { font-size: 12.5px; margin-top: 2px; line-height: 1.45; opacity: 0.9; }
</style>
