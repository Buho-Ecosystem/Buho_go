<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="picker-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle bar -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Sheet header -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Profile picture') }}
        </div>
      </div>

      <!-- Upload-in-flight surface. Replaces the action list while a
           file is being read + uploaded so the user has one focused
           thing to look at, not a row of buttons they can't safely tap. -->
      <div
        v-if="state === 'uploading'"
        class="upload-block"
        :class="$q.dark.isActive ? 'upload-block-dark' : 'upload-block-light'"
        role="status"
        aria-live="polite"
      >
        <q-spinner size="28px" color="primary" />
        <div class="upload-text">
          <div class="upload-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Uploading your picture…') }}
          </div>
          <div class="upload-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Hold on a moment.') }}
          </div>
        </div>
      </div>

      <!-- Failure surface. The store's typed error code drives the
           message so a too-big file says "Image too large" rather
           than a generic "upload failed". -->
      <div
        v-else-if="state === 'error'"
        class="error-block"
        :class="$q.dark.isActive ? 'error-block-dark' : 'error-block-light'"
        role="alert"
      >
        <Icon icon="tabler:alert-circle" width="22" height="22" class="error-icon" />
        <div class="error-text">
          <div class="error-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t("We couldn't upload that picture") }}
          </div>
          <div class="error-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ errorMessage }}
          </div>
        </div>
      </div>

      <!-- Action list. The "Remove avatar" row only appears once
           there's an avatar to remove — keeps the empty state from
           offering a destructive action that does nothing. -->
      <q-list v-if="state !== 'uploading'" class="picker-list">
        <q-item
          clickable
          v-ripple
          :disable="state === 'uploading'"
          @click="triggerCameraPicker"
        >
          <q-item-section side>
            <Icon icon="tabler:camera" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Take photo') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Use your camera') }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

        <q-item
          clickable
          v-ripple
          :disable="state === 'uploading'"
          @click="triggerLibraryPicker"
        >
          <q-item-section side>
            <Icon icon="tabler:photo" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Choose from library') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Pick an existing photo') }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <template v-if="profile.picture">
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item
            clickable
            v-ripple
            class="picker-destructive-row"
            :disable="state === 'uploading'"
            @click="removeAvatar"
          >
            <q-item-section side>
              <Icon icon="tabler:trash" width="20" height="20" class="picker-destructive-icon" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="picker-destructive-label">
                {{ $t('Remove avatar') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Go back to the silhouette') }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </template>

        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
        <q-item
          clickable
          v-ripple
          :disable="state === 'uploading'"
          @click="open = false"
        >
          <q-item-section>
            <q-item-label
              class="picker-cancel-label"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            >
              {{ $t('Cancel') }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>

      <!-- Hidden file inputs. Two of them so we can hint the OS to
           prefer the camera for "Take photo" while leaving the
           library tap unambiguous. -->
      <input
        ref="cameraInputEl"
        type="file"
        :accept="acceptAttr"
        capture="environment"
        class="hidden-input"
        @change="onFileSelected"
      />
      <input
        ref="libraryInputEl"
        type="file"
        :accept="acceptAttr"
        class="hidden-input"
        @change="onFileSelected"
      />
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useProfileStore } from '../stores/profile';
import { ALLOWED_AVATAR_MIMES } from '../utils/blossomProfileMedia.js';

export default {
  name: 'ProfileAvatarPickerSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'uploaded', 'removed'],

  setup() {
    const profile = useProfileStore();
    return { profile };
  },

  data() {
    return {
      /**
       * One of:
       *   'idle'      – default action list visible
       *   'uploading' – read + Blossom PUT in flight; action list hidden
       *   'error'     – upload failed; show typed error + keep action list
       *                  so the user can immediately retry or cancel
       */
      state: 'idle',
      /** Human-readable message rendered on the error surface. */
      errorMessage: '',
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * `<input accept="…">` value built from the canonical MIME
     * allowlist in the upload helper. Keeps both surfaces honest
     * about which formats we actually support — adding a new format
     * is a one-line change in `blossomProfileMedia.js`.
     */
    acceptAttr() {
      return ALLOWED_AVATAR_MIMES.join(',');
    },
  },

  methods: {
    onShow() {
      this.state = 'idle';
      this.errorMessage = '';
    },

    onHide() {
      // Reset both hidden inputs so picking the same file twice in
      // a row still fires `change`. Without this, the second tap
      // is a silent no-op because the input's value hasn't changed.
      if (this.$refs.cameraInputEl) this.$refs.cameraInputEl.value = '';
      if (this.$refs.libraryInputEl) this.$refs.libraryInputEl.value = '';
    },

    triggerCameraPicker() {
      this.$refs.cameraInputEl?.click();
    },

    triggerLibraryPicker() {
      this.$refs.libraryInputEl?.click();
    },

    /**
     * File-input change handler. Either the camera or the library
     * input got a file; both route through the same upload path.
     * The store wipes the secret-key buffer + sets `picture` on
     * success, so we just need to flip the picker into its
     * uploading / error / done state.
     */
    async onFileSelected(ev) {
      const file = ev?.target?.files?.[0];
      if (!file) return;

      this.state = 'uploading';
      this.errorMessage = '';

      const result = await this.profile.uploadAvatar(file);

      // Always reset the file input so subsequent picks fire again.
      if (ev.target) ev.target.value = '';

      if (result?.ok) {
        // Close the picker; parent decides whether to chain back to
        // the edit sheet (Plan 09 spec says it should, hence the
        // emit-then-close ordering — matches the manage-sheet pattern).
        this.$emit('uploaded', result);
        this.open = false;
      } else {
        this.state = 'error';
        this.errorMessage = this.translateError(result);
      }
    },

    /**
     * Synchronously clear the avatar URL and emit so the parent
     * can re-open the edit sheet with the silhouette pre-rendered.
     * The store action persists immediately, same as upload.
     */
    removeAvatar() {
      this.profile.setField('picture', '');
      this.$emit('removed');
      this.open = false;
    },

    /**
     * Map the typed error code from `profile.uploadAvatar()` to a
     * user-facing message. Defaults to the raw `message` if the
     * code is unknown so we never silently swallow a useful detail.
     */
    translateError(result) {
      const code = result?.code || '';
      switch (code) {
        case 'AVATAR_TOO_LARGE':
          return this.$t('That image is too big. Try one under 5 MB.');
        case 'AVATAR_UNSUPPORTED_MIME':
          return this.$t('That file format is not supported. JPG, PNG, WebP, or GIF.');
        case 'AVATAR_NETWORK_ERROR':
          return this.$t('Network is having trouble. Check your connection and try again.');
        case 'AVATAR_HASH_MISMATCH':
          return this.$t('Upload looked tampered with. Please try again.');
        case 'AVATAR_UPLOAD_FAILED':
        case 'AVATAR_BAD_RESPONSE':
          return this.$t('The server did not accept the upload. Try again in a moment.');
        case 'IDENTITY_NOT_BOOTSTRAPPED':
          return this.$t('Your identity is not ready yet. Open the page again.');
        default:
          return result?.message || this.$t('Something went wrong. Please try again.');
      }
    },
  },
};
</script>

<style scoped>
.picker-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.sheet-handle-bar-light,
.sheet-handle-bar-dark {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  display: block;
}

.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark  { background: rgba(255, 255, 255, 0.22); }

.sheet-header {
  display: flex;
  align-items: center;
  padding: 4px 20px 12px;
}

.sheet-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

/* Uploading surface — replaces the action list while in flight */
.upload-block {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  margin: 0 16px 8px;
  border-radius: 14px;
}

.upload-block-light {
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.upload-block-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.upload-text {
  flex: 1 1 auto;
  min-width: 0;
}

.upload-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

.upload-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  margin-top: 2px;
}

/* Error surface — same shape as upload-block but with the alert tint */
.error-block {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin: 0 16px 8px;
  border-radius: 14px;
}

.error-block-light {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.22);
}

.error-block-dark {
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.28);
}

.error-icon {
  flex: 0 0 auto;
  color: #ef4444;
  margin-top: 1px;
}

.error-text {
  flex: 1 1 auto;
  min-width: 0;
}

.error-title {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
}

.error-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  margin-top: 3px;
  line-height: 1.4;
}

/* Action rows */
.picker-list :deep(.q-item) {
  padding: 12px 20px;
  min-height: 56px;
}

.picker-destructive-row .picker-destructive-icon {
  color: #ef4444;
}

.picker-destructive-label {
  color: #ef4444;
  font-weight: 500;
}

.picker-cancel-label {
  font-weight: 600;
  text-align: center;
}

/* File inputs are hidden — buttons trigger them programmatically */
.hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.separator-light { background: rgba(15, 23, 42, 0.06); }
.separator-dark  { background: rgba(255, 255, 255, 0.06); }
.chevron-light   { color: #94a3b8; }
.chevron-dark    { color: #cbd5e1; }
.item-label-light  { color: #0f172a; }
.item-label-dark   { color: #f8fafc; }
.item-caption-light { color: #64748b; }
.item-caption-dark  { color: #94a3b8; }
</style>
