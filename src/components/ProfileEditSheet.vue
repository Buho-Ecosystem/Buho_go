<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
    @hide="onHide"
  >
    <q-card
      class="edit-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle bar (light/dark variants) -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Sheet header: title + close -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Edit profile') }}
        </div>
        <q-btn
          flat
          round
          dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <!-- Avatar block. 96px circle, tappable → emits open-picker so
           the parent can chain in the Avatar Picker sub-sheet (Plan 09
           §7c). Shows an uploading state directly on the avatar while
           the store's `isUploadingAvatar` flag is true. -->
      <div class="avatar-section">
        <button
          type="button"
          class="avatar-btn"
          :aria-label="$t('Choose profile picture')"
          :disabled="profile.isUploadingAvatar"
          @click="$emit('open-picker')"
        >
          <div
            class="avatar"
            :class="$q.dark.isActive ? 'avatar-dark' : 'avatar-light'"
          >
            <img
              v-if="visibleAvatarUrl"
              :src="visibleAvatarUrl"
              :alt="$t('Profile picture')"
              class="avatar-img"
              @error="onAvatarLoadError"
            />
            <Icon
              v-else
              icon="tabler:user"
              width="40"
              height="40"
              class="avatar-glyph"
              aria-hidden="true"
            />
            <span
              v-if="!profile.isUploadingAvatar"
              class="avatar-edit-badge"
              aria-hidden="true"
            >
              <Icon icon="tabler:camera" width="14" height="14" />
            </span>
            <span
              v-else
              class="avatar-upload-overlay"
              aria-hidden="true"
            >
              <q-spinner color="white" size="22px" />
            </span>
          </div>
        </button>
      </div>

      <!-- Field group. Native inputs wrapped in styled containers,
           matching the AddSiteSheet pattern. Every label is its own
           element so screen readers announce them naturally. -->
      <div class="fields">
        <!-- Display name (single line, the most important field) -->
        <label class="field">
          <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Display name') }}
          </span>
          <div
            class="field-input-wrap"
            :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'"
          >
            <input
              v-model="form.displayName"
              type="text"
              :placeholder="$t('Your name')"
              spellcheck="false"
              autocomplete="off"
              maxlength="200"
              class="field-input"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            />
          </div>
        </label>

        <!-- About (multi-line, 280-char counter) -->
        <label class="field">
          <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('About') }}
          </span>
          <div
            class="field-input-wrap field-input-wrap--multiline"
            :class="$q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light'"
          >
            <textarea
              v-model="form.about"
              :placeholder="$t('A short bio (optional)')"
              maxlength="280"
              rows="3"
              class="field-input field-input--multiline"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            ></textarea>
          </div>
          <span
            class="field-counter"
            :class="[
              $q.dark.isActive ? 'text-grey-5' : 'text-grey-6',
              { 'is-near-limit': form.about.length >= 260 },
            ]"
            aria-live="polite"
          >
            {{ form.about.length }}/280
          </span>
        </label>

        <!-- Website (single line, URL validated on save) -->
        <label class="field">
          <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Website') }}
          </span>
          <div
            class="field-input-wrap"
            :class="[
              $q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light',
              { 'field-input-wrap--error': errors.website },
            ]"
          >
            <input
              v-model="form.website"
              type="url"
              placeholder="https://your-site.example"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              maxlength="200"
              class="field-input"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            />
          </div>
          <span v-if="errors.website" class="field-error" role="alert">
            {{ errors.website }}
          </span>
        </label>

        <!-- Lightning address (lud16, optional) -->
        <label class="field">
          <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Lightning address') }}
          </span>
          <div
            class="field-input-wrap"
            :class="[
              $q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light',
              { 'field-input-wrap--error': errors.lud16 },
            ]"
          >
            <input
              v-model="form.lud16"
              type="text"
              placeholder="you@your-site.example"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              maxlength="200"
              class="field-input"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            />
          </div>
          <span v-if="errors.lud16" class="field-error" role="alert">
            {{ errors.lud16 }}
          </span>
        </label>
      </div>

      <!-- Sticky bottom action bar. The button is disabled until
           either the form has local changes or the store carries an
           unsaved publish from a previous session. -->
      <div
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!canPublish || profile.isPublishing"
          @click="onSave"
        >
          <q-spinner v-if="profile.isPublishing" size="18px" />
          <span>{{ $t('Save & Publish') }}</span>
        </button>
        <div
          v-if="inlineStatus"
          class="action-status"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          aria-live="polite"
        >
          {{ inlineStatus }}
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useProfileStore, PROFILE_FIELDS } from '../stores/profile';
import { DEFAULT_RELAYS } from '../utils/nostrRelays.js';

/**
 * Lightweight shape validators. We accept anything that looks
 * roughly right; full URL / lud16 parsing belongs further upstream
 * (the relays themselves will reject malformed payloads). Goal here
 * is to catch the obvious typos that would otherwise eat a publish
 * round-trip.
 */
function isLikelyUrl(s) {
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLikelyLud16(s) {
  if (!s) return true;
  // local-part@domain.tld — at most one @, no whitespace, a dot in
  // the domain. Lenient on local-part chars on purpose.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default {
  name: 'ProfileEditSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'open-picker'],

  setup() {
    const profile = useProfileStore();
    return { profile };
  },

  data() {
    return {
      /**
       * Local working copy. Initialised from the store every time
       * the sheet opens; never written back to the store until the
       * user taps Save & Publish. Cancelling (close button, backdrop
       * dismiss) discards changes — same convention as Twitter and
       * other social-app editors.
       */
      form: {
        displayName: '',
        about: '',
        website: '',
        lud16: '',
      },

      /** Shape-validation errors keyed by field. Cleared on each edit. */
      errors: {
        website: '',
        lud16: '',
      },

      /** Avatar fallback flag — same pattern the page uses. */
      avatarBroken: false,

      /**
       * Whether the most recent publish attempt has completed; lets
       * the inline status text reflect the outcome before the user
       * closes the sheet themselves.
       */
      publishLanded: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Visible avatar URL. Reads `profile.picture` (the store is the
     * source of truth — avatar uploads bypass the local form so the
     * newly-picked photo shows up immediately). Suppressed after a
     * load failure so the silhouette renders instead.
     */
    visibleAvatarUrl() {
      if (!this.profile.picture) return '';
      if (this.avatarBroken) return '';
      return this.profile.picture;
    },

    /**
     * True if any text field differs from its persisted value. The
     * avatar isn't included because uploading already marks
     * `profile.isDirty` via the store action.
     */
    isLocalDirty() {
      return (
        this.form.displayName !== this.profile.displayName
        || this.form.about       !== this.profile.about
        || this.form.website     !== this.profile.website
        || this.form.lud16       !== this.profile.lud16
      );
    },

    /**
     * Enable the Save & Publish button if the user has local edits
     * OR the store already carried an unsaved publish (e.g. a
     * previous session failed mid-publish, or the avatar was just
     * uploaded). Either way the user has something legitimate to
     * push to the relays.
     */
    canPublish() {
      return this.isLocalDirty || this.profile.isDirty;
    },

    /**
     * Status line under the action button. Mirrors the
     * profileStore's publish lifecycle. The "settled" branch waits
     * until `publishLanded` flips so we don't show "Published" the
     * very moment the sheet opens (stale state from a previous
     * publish).
     */
    inlineStatus() {
      if (this.profile.isPublishing) {
        return this.$t('Publishing to {n} relays…', { n: DEFAULT_RELAYS.length });
      }
      if (!this.publishLanded) return '';
      if (!this.profile.lastPublishResult) return '';
      const accepted = this.profile.lastPublishResult.filter((r) => r.ok).length;
      if (accepted === 0) {
        return this.$t("Couldn't reach the relays. Try again in a moment.");
      }
      if (accepted < this.profile.lastPublishResult.length) {
        return this.$t('Saved. Some relays still catching up.');
      }
      return this.$t('Published');
    },

  },

  methods: {
    onShow() {
      // Refresh the local form from the store every time the sheet
      // opens. Avoids stale carry-over from a previous open if the
      // user dismissed without saving.
      this.form.displayName = this.profile.displayName;
      this.form.about       = this.profile.about;
      this.form.website     = this.profile.website;
      this.form.lud16       = this.profile.lud16;
      this.errors.website   = '';
      this.errors.lud16     = '';
      this.avatarBroken     = false;
      this.publishLanded    = false;
    },

    onHide() {
      // Best-effort: also reset publishLanded so the next open is
      // clean. The form values are repopulated on `onShow` so no
      // explicit reset needed here.
      this.publishLanded = false;
    },

    onAvatarLoadError() {
      this.avatarBroken = true;
    },

    /**
     * Validate the form. Returns true if everything looks OK,
     * false if any field carries a shape error.
     */
    validate() {
      this.errors.website = '';
      this.errors.lud16   = '';
      let ok = true;
      const website = (this.form.website || '').trim();
      const lud16   = (this.form.lud16   || '').trim();
      if (!isLikelyUrl(website)) {
        this.errors.website = this.$t('Please include http:// or https://');
        ok = false;
      }
      if (!isLikelyLud16(lud16)) {
        this.errors.lud16 = this.$t('Looks like an unfamiliar format. Try name@example.com.');
        ok = false;
      }
      return ok;
    },

    async onSave() {
      if (!this.canPublish || this.profile.isPublishing) return;
      if (!this.validate()) return;

      // Snapshot the form into the store as a single atomic edit.
      // `applyEdits` ignores unknown keys and is no-op on equal
      // values, so this is safe even if nothing actually changed.
      const patch = {};
      for (const field of PROFILE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(this.form, field)) {
          patch[field] = this.form[field];
        }
      }
      this.profile.applyEdits(patch);

      // Now publish. profileStore.publish never throws — failures
      // surface as a `lastPublishResult` array we render via the
      // computed `inlineStatus`.
      this.publishLanded = false;
      const result = await this.profile.publish();
      this.publishLanded = true;

      // If at least one relay accepted, auto-dismiss the sheet
      // shortly after showing the "Published" status. Total failure
      // keeps the sheet open so the user can adjust and retry.
      if (Array.isArray(result) && result.some((r) => r.ok)) {
        // Brief pause so the user sees the success confirmation.
        setTimeout(() => {
          if (!this.profile.isPublishing) this.open = false;
        }, 900);
      }
    },
  },
};
</script>

<style scoped>
.edit-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
}

/* Drag handle bar */
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

/* Sheet header — title + close button */
.sheet-header {
  display: flex;
  align-items: center;
  padding: 4px 16px 8px;
  gap: 8px;
}

.sheet-title {
  flex: 1 1 auto;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.sheet-close-btn {
  flex: 0 0 auto;
}

/* Avatar */
.avatar-section {
  display: flex;
  justify-content: center;
  padding: 12px 16px 20px;
}

.avatar-btn {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.avatar-btn:focus-visible {
  outline: 2px solid #15DE72;
  outline-offset: 4px;
  border-radius: 50%;
}

.avatar-btn:disabled {
  cursor: default;
}

.avatar {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.avatar-light {
  background: rgba(15, 23, 42, 0.04);
  color: #0f172a;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.avatar-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #f8fafc;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
}

.avatar-glyph { opacity: 0.7; }

/* Camera badge — neutral monochrome on both themes. No brand colour
   here; the avatar surface itself is the affordance. */
.avatar-edit-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0f172a;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  border: 2px solid var(--surface-card, #ffffff);
}

body.body--dark .avatar-edit-badge {
  background: rgba(255, 255, 255, 0.10);
  color: #f8fafc;
  border-color: rgba(0, 0, 0, 0.4);
}

/* In-flight upload spinner overlay */
.avatar-upload-overlay {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  border-radius: 50%;
}

/* Field group */
.fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 16px 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.field-input-wrap {
  display: flex;
  align-items: stretch;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.field-input-wrap-light {
  background: rgba(15, 23, 42, 0.04);
  border-color: rgba(15, 23, 42, 0.08);
}

.field-input-wrap-light:focus-within {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.32);
}

.field-input-wrap-dark {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

.field-input-wrap-dark:focus-within {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.28);
}

.field-input-wrap--error {
  border-color: #ef4444 !important;
}

.field-input-wrap--multiline {
  /* Let the textarea control its own height */
  align-items: flex-start;
}

.field-input {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  outline: none;
  padding: 12px 14px;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 14.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  line-height: 1.4;
  resize: none;
}

.field-input-light { color: #0f172a; }
.field-input-dark  { color: #f8fafc; }

.field-input--multiline {
  min-height: 88px;
}

.field-input::placeholder {
  opacity: 0.6;
}

.field-counter {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  align-self: flex-end;
}

.field-counter.is-near-limit {
  color: #b06d00;
}

.field-error {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #ef4444;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Sticky action bar at the bottom of the sheet */
.sheet-actions {
  position: sticky;
  bottom: 0;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid transparent;
}

.sheet-actions-light {
  background: var(--card-bg, #ffffff);
  border-top-color: rgba(15, 23, 42, 0.06);
}

.sheet-actions-dark {
  background: var(--card-bg, #0f172a);
  border-top-color: rgba(255, 255, 255, 0.06);
}

.primary-cta {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease;
}

.primary-cta:disabled {
  opacity: 0.45;
  cursor: default;
}

.primary-cta:not(:disabled):hover { filter: brightness(1.05); }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

/* Inline publish-status caption. Stays in the muted greyscale band
   so the action bar never reads as alarm-coloured. The Save &
   Publish button is the only saturated element in this row. */
.action-status {
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 500;
}

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
