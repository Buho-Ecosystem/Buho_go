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

      <!-- Scrollable content region — handle + header above and the
           error banner + action bar below stay pinned; everything
           between scrolls, so the last field is always reachable on
           short viewports. -->
      <div class="sheet-scroll">

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
          <!-- Avatar slot: the circle clips its own image fill via
               overflow:hidden, but the camera badge lives *outside*
               that clip so it never gets cropped at the avatar
               border. The wrapper is positioned so the badge can
               anchor to the bottom-right of the visible circle. -->
          <div class="avatar-wrap">
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
                v-if="profile.isUploadingAvatar"
                class="avatar-upload-overlay"
                aria-hidden="true"
              >
                <q-spinner color="white" size="22px" />
              </span>
            </div>
            <span
              v-if="!profile.isUploadingAvatar"
              class="avatar-edit-badge"
              aria-hidden="true"
            >
              <Icon icon="tabler:camera" width="14" height="14" />
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
          <!--
            Helper line under the input. Explains in one sentence what
            the address is used for, so a first-time user knows whether
            to fill it in. Errors take priority and replace the helper
            line, mirroring the standard form-field pattern.
          -->
          <span v-if="errors.lud16" class="field-error" role="alert">
            {{ errors.lud16 }}
          </span>
          <span
            v-else
            class="field-help"
            :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
          >
            {{ $t('Your address for receiving Bitcoin payments. Leave blank if you don\'t have one.') }}
          </span>
        </label>

        <!-- NIP-05 verified identifier. Auto-managed (name@mybuho.de) by
             default; only advanced users who host their own NIP-05 need to
             touch it. -->
        <label class="field">
          <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('NIP-05 identifier') }}
          </span>
          <div
            class="field-input-wrap"
            :class="[
              $q.dark.isActive ? 'field-input-wrap-dark' : 'field-input-wrap-light',
              { 'field-input-wrap--error': errors.nip05 },
            ]"
          >
            <input
              v-model="form.nip05"
              type="text"
              placeholder="you@mybuho.de"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              maxlength="200"
              class="field-input"
              :class="$q.dark.isActive ? 'field-input-dark' : 'field-input-light'"
            />
          </div>
          <span v-if="errors.nip05" class="field-error" role="alert">
            {{ errors.nip05 }}
          </span>
          <span
            v-else
            class="field-help"
            :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
          >
            {{ $t('Your verified handle, managed for you. Only change it if you host your own NIP-05.') }}
          </span>
        </label>
      </div>
      </div><!-- /sheet-scroll -->

      <!-- Persistent publish-error banner. Lives next to the action
           bar so the user can read what went wrong and tap Save &
           Publish to retry without losing their place in the form.
           Same visual shape the avatar picker uses for its upload
           errors — one alert idiom across every profile surface. -->
      <div
        v-if="publishError"
        class="publish-error-block"
        :class="$q.dark.isActive ? 'publish-error-block-dark' : 'publish-error-block-light'"
        role="alert"
        aria-live="assertive"
      >
        <Icon icon="tabler:alert-circle" width="20" height="20" class="publish-error-icon" />
        <div class="publish-error-text">
          <div class="publish-error-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ publishError.title }}
          </div>
          <div class="publish-error-caption" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ publishError.caption }}
          </div>
        </div>
        <button
          type="button"
          class="publish-error-dismiss"
          :aria-label="$t('Dismiss')"
          @click="dismissPublishError"
        >
          <Icon icon="tabler:x" width="14" height="14" />
        </button>
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
          <span>{{ publishError ? $t('Try again') : $t('Save') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useProfileStore, PROFILE_FIELDS } from '../stores/profile';
/**
 * Lightweight shape validator. Lud16 only — accept anything that
 * looks roughly like `local@domain.tld`; canonical validation
 * belongs further upstream (the relays themselves will reject
 * malformed payloads). Goal here is to catch the obvious typos
 * that would otherwise eat a publish round-trip.
 */
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
        lud16: '',
        nip05: '',
      },

      /** Shape-validation errors keyed by field. Cleared on each edit. */
      errors: {
        lud16: '',
        nip05: '',
      },

      /** Avatar fallback flag — same pattern the page uses. */
      avatarBroken: false,

      /**
       * Inline publish-error block. Stays visible until the user
       * either retries successfully or dismisses it manually — a
       * transient toast would have vanished before they could read
       * what went wrong.
       *
       * Shape: `{ title: string, caption: string }` when set, `null`
       * otherwise. The mode is encoded in the title/caption pair
       * picked by `describePublishFailure`.
       */
      publishError: null,
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
        || this.form.nip05       !== this.profile.nip05
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

  },

  methods: {
    onShow() {
      // Refresh the local form from the store every time the sheet
      // opens. Avoids stale carry-over from a previous open if the
      // user dismissed without saving.
      this.form.displayName = this.profile.displayName;
      this.form.about       = this.profile.about;
      this.form.lud16       = this.profile.lud16;
      this.form.nip05       = this.profile.nip05;
      this.errors.lud16     = '';
      this.errors.nip05     = '';
      this.avatarBroken     = false;
      this.publishError     = null;
    },

    /**
     * Inspect the per-relay result array and return the most
     * specific failure description we can offer the user. Three
     * shapes worth distinguishing:
     *
     *   - Every error reads "timed out" → network is slow or down;
     *     retry has a real chance of working.
     *   - Every error reads "did not accept" → relays are reachable
     *     but bouncing the event; usually transient (rate limit,
     *     load-shedding), occasionally the event itself.
     *   - Mixed or unknown → fall back to a generic message but
     *     still offer retry.
     *
     * The `[profile] publish landed on zero relays` console.warn
     * from the store carries the raw detail for support; this
     * function just turns it into something a human can act on.
     */
    describePublishFailure(result) {
      const errors = Array.isArray(result)
        ? result.map((r) => (r && r.error) || '').filter(Boolean)
        : [];
      if (errors.length === 0) {
        return {
          title: this.$t("Couldn't save your profile"),
          caption: this.$t('Something went wrong on this device. Please try again.'),
        };
      }
      const allTimedOut = errors.every((e) => /timed?\s*out/i.test(e));
      const allRejected = errors.every((e) => /did not accept/i.test(e));
      if (allTimedOut) {
        return {
          title: this.$t("Couldn't reach the network in time"),
          caption: this.$t('Your connection is slow or offline. Check it and try again.'),
        };
      }
      if (allRejected) {
        return {
          title: this.$t('The servers refused this profile'),
          caption: this.$t('This is usually temporary. Wait a moment and try again.'),
        };
      }
      return {
        title: this.$t("Couldn't save your profile"),
        caption: this.$t('Check your connection and try again.'),
      };
    },

    dismissPublishError() {
      this.publishError = null;
    },

    onHide() {
      // Nothing to tear down — the form is repopulated on the next
      // `onShow` and the publish lifecycle lives entirely on the
      // store, surfaced via toasts rather than sheet-local state.
    },

    onAvatarLoadError() {
      this.avatarBroken = true;
    },

    /**
     * Validate the form. Returns true if everything looks OK,
     * false if any field carries a shape error.
     */
    validate() {
      this.errors.lud16 = '';
      this.errors.nip05 = '';
      const lud16 = (this.form.lud16 || '').trim();
      if (!isLikelyLud16(lud16)) {
        this.errors.lud16 = this.$t('Looks like an unfamiliar format. Try name@example.com.');
        return false;
      }
      // NIP-05 shares the name@domain shape; reuse the same lenient check.
      const nip05 = (this.form.nip05 || '').trim();
      if (!isLikelyLud16(nip05)) {
        this.errors.nip05 = this.$t('Looks like an unfamiliar format. Try name@example.com.');
        return false;
      }
      return true;
    },

    async onSave() {
      if (!this.canPublish || this.profile.isPublishing) return;
      if (!this.validate()) return;

      // Clear any previous error before kicking off the next attempt
      // so the banner doesn't linger from a stale failure.
      this.publishError = null;

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

      // Now publish. profileStore.publish never throws — it returns
      // `{ ok, acceptedRelay?, results?, settled }`. With eager
      // semantics, `ok=true` flips as soon as a single relay accepts;
      // the remaining attempts continue in the background.
      const result = await this.profile.publish();
      if (result === null) return; // re-entrancy guard fired

      if (result.ok) {
        this.open = false;
        this.$q.notify({
          type: 'positive',
          message: this.$t('Profile saved'),
          timeout: 2500,
        });
      } else {
        // Every relay refused the kind:0 event. The store waited
        // for the full settle before returning `ok: false`, so the
        // `results` array carries per-relay error detail we can map
        // to specific copy.
        this.publishError = this.describePublishFailure(result.results);
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
  /* Bound the column so the middle region can scroll instead of the
     last field being clipped behind the action bar. */
  max-height: 90vh;
  max-height: 90dvh;
}

/* Drag handle bar */
.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  flex-shrink: 0;
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
  flex-shrink: 0;
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

/* Scrollable content region — the only part of the sheet that
   scrolls. The handle/header above and the error banner + action
   bar below stay pinned. `min-height: 0` is required so this flex
   child can shrink below its content height and actually scroll. */
.sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
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

/* Positioning anchor for the camera badge — the badge has to sit
   outside the avatar's overflow-hidden clip so the icon never gets
   cropped at the circle border. The wrap is the relative parent;
   the avatar inside it still owns the clip for the image fill. */
.avatar-wrap {
  position: relative;
  width: 96px;
  height: 96px;
}

.avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
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

/*
  Inline helper text sitting where the error normally sits. Same
  type metrics as `.field-counter` so the row height stays stable
  when toggling between "no input yet" and "validation error".
*/
.field-help {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  display: block;
}

/* Pinned action bar — sits below the scroll region as a fixed flex
   child (not sticky; the scroll now lives in `.sheet-scroll`). */
.sheet-actions {
  flex-shrink: 0;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid transparent;
}

/* Action bar paints its OWN background — explicitly the same
   colour the q-card uses (`card_dark_style` ⇒ #0C0C0C,
   `card_light_style` ⇒ var(--bg-card)). Going transparent risked
   exposing Quasar's default q-card layers underneath, which read
   as a faint navy tint on dark mode. Painting the band ourselves
   keeps the surface clean. */
.sheet-actions-light {
  background: var(--bg-card, #FAF7EF);
  border-top-color: rgba(15, 23, 42, 0.06);
}

.sheet-actions-dark {
  background: #0C0C0C;
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

/* Persistent publish-error banner. Same shape as the avatar
   picker's `.error-block`; lives between the field group and the
   action bar so the user reads it on their way to the Retry CTA. */
.publish-error-block {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  margin: 0 16px 8px;
  border-radius: 12px;
  flex-shrink: 0;
}

.publish-error-block-light {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.22);
}

.publish-error-block-dark {
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.28);
}

.publish-error-icon {
  flex: 0 0 auto;
  color: #ef4444;
  margin-top: 1px;
}

.publish-error-text {
  flex: 1 1 auto;
  min-width: 0;
}

.publish-error-title {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
}

.publish-error-caption {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  margin-top: 3px;
  line-height: 1.4;
}

.publish-error-dismiss {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.15s ease, background-color 0.18s ease;
}

.publish-error-dismiss:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.10);
}

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
