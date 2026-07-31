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

      <!-- Identity row: avatar left (overlaps the card's tinted header
           gradient), display name
           input right. Compresses the previously-stacked "centered
           avatar" + "PROFILE label" + "Display name label" + "input"
           into one confident horizontal block. -->
      <div class="edit-identity">
        <button
          type="button"
          class="avatar-btn"
          :aria-label="$t('Choose profile picture')"
          :disabled="profile.isUploadingAvatar"
          @click="$emit('open-picker')"
        >
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
              <img
                v-else
                src="/buho_logo.svg"
                alt=""
                width="38"
                height="38"
                class="avatar-glyph"
                aria-hidden="true"
              />
              <span
                v-if="profile.isUploadingAvatar"
                class="avatar-upload-overlay"
                aria-hidden="true"
              >
                <q-spinner color="white" size="20px" />
              </span>
            </div>
            <span
              v-if="!profile.isUploadingAvatar"
              class="avatar-edit-badge"
              aria-hidden="true"
            >
              <Icon icon="tabler:camera" width="12" height="12" />
            </span>
          </div>
        </button>

        <label class="field edit-name-field">
          <span
            class="field-label"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
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
      </div>

      <!-- Field group. PROFILE section is gone now that avatar+name
           own that role inline above; About sits as its own field at
           the top, then PAYMENT and PUBLIC IDENTITY follow as section
           cards. Tighter top padding because the identity row already
           reserves the visual rhythm. -->
      <div class="fields">

        <!-- About (multi-line, 280-char counter). No longer wrapped
             in a PROFILE section card — at one field a section card
             added a box around a single textarea, which read as noise. -->
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

        <!-- ─────────── Extended profile ───────────
             Everything below About is optional depth (lightning
             address, verified name) that most people don't need to
             touch during onboarding. Collapsed by default behind a
             bare chevron — no label, no caption, just the affordance
             to go deeper for those who want to. The accessible name
             lives in aria-label since there's no visible text. -->
        <button
          type="button"
          class="extended-toggle"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          :aria-expanded="extendedOpen"
          :aria-label="$t('Extended profile')"
          aria-controls="extended-profile-body"
          @click="extendedOpen = !extendedOpen"
        >
          <Icon
            icon="tabler:chevron-down"
            width="18"
            height="18"
            class="extended-toggle-chevron"
            :class="{ 'extended-toggle-chevron--open': extendedOpen }"
            aria-hidden="true"
          />
        </button>

        <q-slide-transition>
          <div v-show="extendedOpen" id="extended-profile-body" class="extended-body">

            <!-- ─────────── Get paid ───────────
                 Flat field, same rhythm as About above: icon-led label,
                 input, one always-visible plain-language line underneath.
                 No tap-to-reveal tooltip - what used to require an extra
                 tap to learn now just sits on the page as the field's
                 own caption, and no extra card wraps a single input. -->
            <label class="field">
              <span class="field-label-row">
                <Icon icon="tabler:bolt-filled" width="15" height="15" class="field-label-icon field-label-icon--bolt" />
                <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                  {{ $t('Get paid') }}
                </span>
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
                Helper line under the input. Errors take priority and
                replace it, mirroring the standard form-field pattern.
              -->
              <span v-if="errors.lud16" class="field-error" role="alert">
                {{ errors.lud16 }}
              </span>
              <span
                v-else
                class="field-help"
                :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
              >
                {{ $t('Friends can send Bitcoin straight to this address. Leave blank if you don\'t have one.') }}
              </span>
            </label>

            <!-- ─────────── Your name ───────────
                 Same flat rhythm; the handle picker keeps its light card
                 because it's a list of rows, not a single input, but the
                 uppercase section-label + separate tooltip are gone. -->
            <div class="form-section">
              <span class="field-label-row">
                <Icon icon="tabler:rosette-discount-check-filled" width="15" height="15" class="field-label-icon field-label-icon--check" />
                <span class="field-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                  {{ $t('Your name') }}
                </span>
              </span>

              <!-- Handles as flat list rows. Active row shows the brand
                   check + an "Active" badge; tap any inactive row to
                   promote it, which marks the profile dirty so "Save"
                   lights up just like any other field edit. -->
              <div
                v-if="handles.length > 0"
                class="section-card section-card--list"
                :class="$q.dark.isActive ? 'section-card-dark' : 'section-card-light'"
                role="radiogroup"
                :aria-label="$t('Your verified addresses')"
              >
                <button
                  v-for="(h, idx) in handles"
                  :key="h.handle"
                  type="button"
                  class="handle-row"
                  :class="[
                    $q.dark.isActive ? 'handle-row-dark' : 'handle-row-light',
                    { 'handle-row--active': h.isActive },
                    { 'handle-row--first': idx === 0 },
                    { 'handle-row--last': idx === handles.length - 1 },
                  ]"
                  role="radio"
                  :aria-checked="h.isActive"
                  @click="onPickHandle(h.handle)"
                >
                  <span class="handle-radio" aria-hidden="true">
                    <Icon
                      v-if="h.isActive"
                      icon="tabler:rosette-discount-check-filled"
                      width="18"
                      height="18"
                      class="handle-radio-check"
                    />
                    <Icon
                      v-else
                      icon="tabler:circle"
                      width="18"
                      height="18"
                      class="handle-radio-empty"
                    />
                  </span>
                  <span class="handle-text">
                    <span class="handle-local">{{ h.handle }}</span>
                    <span class="handle-suffix" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
                      @{{ nip05Domain }}
                    </span>
                    <!-- Renewal feature disabled — extension doesn't enforce
                         expiry. When the upstream gains a renewal endpoint,
                         restore the `.handle-local-row` wrapper around the
                         two spans above and uncomment this caption.
                    <span
                      v-if="expiryHint(h)"
                      class="handle-expiry"
                      :class="[
                        $q.dark.isActive ? 'text-grey-4' : 'text-grey-6',
                        { 'handle-expiry--soon': isExpiringSoon(h) },
                      ]"
                    >
                      <Icon
                        v-if="isExpiringSoon(h)"
                        icon="tabler:clock-hour-4"
                        width="11"
                        height="11"
                        class="handle-expiry-icon"
                      />
                      {{ expiryHint(h) }}
                    </span>
                    -->
                  </span>
                  <span
                    v-if="h.isActive"
                    class="handle-active-badge"
                    :class="$q.dark.isActive ? 'handle-active-badge-dark' : 'handle-active-badge-light'"
                  >
                    {{ $t('Active') }}
                  </span>
                </button>
              </div>

              <!-- Empty state — should be vanishingly rare (the boot
                   orchestrator registers a free handle within seconds of
                   first launch), but a clean fallback beats showing the
                   Buy CTA in isolation if registration was offline. -->
              <div
                v-else
                class="handles-empty"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
              >
                {{ $t('Your free verified address will appear here in a moment.') }}
              </div>

              <span
                class="field-help"
                :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
              >
                {{ $t('Friends use this to find and pay you on BuhoGO.') }}
              </span>

              <button
                type="button"
                class="buy-cta"
                :class="$q.dark.isActive ? 'buy-cta-dark' : 'buy-cta-light'"
                @click="showMarketplace = true"
              >
                <Icon icon="tabler:plus" width="15" height="15" />
                <span>{{ $t('Buy a custom name') }}</span>
              </button>
            </div><!-- /form-section: IDENTITY -->
          </div><!-- /extended-body -->
        </q-slide-transition>
      </div>
      </div><!-- /sheet-scroll -->

      <!-- Nested marketplace sheet. Stacks on top of the editor;
           Quasar manages the z-index automatically. On purchase the
           identity store has already added the handle + promoted it
           active; `onPurchased` mirrors the dirty-flag path so the
           sticky Save & Publish lights up. -->
      <Nip05MarketplaceSheet
        v-model="showMarketplace"
        @purchased="onPurchased"
      />

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
import { useIdentityStore } from '../stores/identity';
import { NIP05_DOMAIN } from '../services/nip05';
import Nip05MarketplaceSheet from './Nip05MarketplaceSheet.vue';
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

  components: { Icon, Nip05MarketplaceSheet },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'open-picker'],

  setup() {
    const profile = useProfileStore();
    const identity = useIdentityStore();
    return { profile, identity };
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
      },

      /** Shape-validation errors keyed by field. Cleared on each edit. */
      errors: {
        lud16: '',
      },

      /** Visibility of the nested NIP-05 marketplace sheet (kept here so
       *  the editor remains a single entry-point for everything profile-
       *  related — including buying a custom name). */
      showMarketplace: false,

      /** Extended profile (lud16 + verified name) starts collapsed —
       *  only Display name, About and the avatar show by default. */
      extendedOpen: false,

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
        || this.form.lud16       !== this.profile.lud16
      );
    },

    /** All NIP-05 handles the identity owns, surfaced as-is for the
     *  Identity section. The store's reactivity keeps this current
     *  if a marketplace purchase mutates `nip05Handles` mid-edit. */
    handles() {
      return this.identity.nip05Handles;
    },

    /** Full @mybuho.de domain the editor uses for the handle pill. */
    nip05Domain() { return NIP05_DOMAIN; },

    /* Renewal feature disabled — extension doesn't enforce expiry.
    dateFormatter() {
      try {
        return new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return null;
      }
    },
    */

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
      this.errors.lud16     = '';
      this.avatarBroken     = false;
      this.publishError     = null;
      this.showMarketplace  = false;
      // Re-collapse extended profile on every open, unless the store
      // already carries a lud16 or a non-default active handle — a
      // returning user who has filled those in shouldn't have to
      // re-expand the section just to see what they set.
      this.extendedOpen     = Boolean(this.profile.lud16);
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
      const lud16 = (this.form.lud16 || '').trim();
      if (!isLikelyLud16(lud16)) {
        this.errors.lud16 = this.$t('Looks like an unfamiliar format. Try name@example.com.');
        // The error lives inside the collapsed Extended profile
        // section — expand it so the user can actually see it.
        this.extendedOpen = true;
        return false;
      }
      return true;
    },

    /**
     * Promote a handle to active and mark the profile dirty so the user
     * sees "Save & Publish" light up — switching the displayed name is a
     * legitimate profile edit and the user should be invited to broadcast
     * the new value. We deliberately don't auto-publish here; the
     * existing "Save & Publish" button stays the only relay-broadcast
     * gate (matches every other edit in this sheet).
     */
    onPickHandle(handle) {
      if (!handle) return;
      if (this.identity.nip05ActiveEntry?.handle === handle) return;
      this.identity.setActiveNip05(handle);
      const address = this.identity.nip05Address;
      if (!address) return;
      // `setField` marks the store dirty + persists, which is exactly
      // what we want here. Unlike `adoptNip05` (the silent boot-time
      // adoption), this represents an explicit user choice.
      this.profile.setField('nip05', address);
    },

    /* Renewal feature disabled — extension doesn't enforce expiry. The
       caption + tone helpers stay parked here so re-enablement is a
       single uncomment-and-restore-the-template-block change once the
       upstream gains a real renewal route.

    expiryHint(handle) {
      const ms = handle && handle.expiresAt;
      if (!Number.isFinite(ms)) return '';
      const diffMs = ms - Date.now();
      if (diffMs <= 0) return this.$t('Expired — renew it');
      const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
      if (days <= 1) return this.$t('Renews tomorrow');
      if (days <= 30) {
        return this.$t('Renew in {n} days', { n: days });
      }
      const date = this.dateFormatter ? this.dateFormatter.format(new Date(ms)) : null;
      return date ? this.$t('Renews {date}', { date }) : '';
    },

    isExpiringSoon(handle) {
      const ms = handle && handle.expiresAt;
      if (!Number.isFinite(ms)) return false;
      const diffMs = ms - Date.now();
      return diffMs <= 30 * 24 * 60 * 60 * 1000;
    },
    */

    /**
     * The marketplace sheet has already added the new handle and
     * promoted it to active via the identity store. Mirror the same
     * profile dirty-flagging path so Save & Publish picks it up.
     */
    onPurchased() {
      const address = this.identity.nip05Address;
      if (!address) return;
      this.profile.setField('nip05', address);
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
      // A single "Display name" field drives both NIP-01 fields —
      // `display_name` and `name` — so every relay/client reads the
      // same name regardless of which one it prefers to render.
      patch.name = this.form.displayName;
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
/* ---------- Top-of-sheet tinted hero zone ----------
   A soft brand-green wash painted as an overlay on the sheet card
   from top to ~160px down, fading to transparent. The drag handle,
   "Edit profile" title and close button now sit ON this tint instead
   of next to a separate thin banner strip, so the top of the sheet
   reads as ONE coherent hero zone rather than three stacked bands.
   The avatar overlaps the fade boundary naturally. */
.edit-sheet {
  position: relative;
}

.edit-sheet::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 160px;
  background: linear-gradient(
    to bottom,
    rgba(21, 222, 114, 0.18) 0%,
    rgba(21, 222, 114, 0.10) 50%,
    transparent 100%
  );
  pointer-events: none;
  z-index: 0;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
}

/* Dark mode uses a quiet neutral lift instead of repeating the green
   wash - same call as the profile page's own hero banner, so the two
   don't compound into "everything BuhoGO opens is tinted green." */
body.body--dark .edit-sheet::before {
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.08) 0%,
    rgba(255, 255, 255, 0.04) 50%,
    transparent 100%
  );
}

/* Lift every direct child above the gradient overlay so the tint
   becomes a background, not something covering the controls. */
.edit-sheet > * {
  position: relative;
  z-index: 1;
}

/* ---------- Identity row ----------
   Avatar left, display-name field right. The card-wide gradient
   overlay already paints a tinted zone behind the row, so no negative
   margin is needed — the avatar naturally sits on the tint without
   risking clipping at the top of the scroll container. */
.edit-identity {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px 0;
  margin-bottom: 20px;
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
  width: 76px;
  height: 76px;
  flex-shrink: 0;
}

.avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

/* No outer ring — the avatar sits on a brand-green-tinted surface
   here, and a card-coloured ring (cream / near-black) reads as a
   halo against the tint. A slightly stronger inset border carries
   the edge definition on its own. */
.avatar-light {
  background: rgba(15, 23, 42, 0.04);
  color: #0f172a;
  box-shadow: inset 0 0 0 1.5px rgba(15, 23, 42, 0.12);
}

.avatar-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #f8fafc;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.18);
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

/* BuhoGO's own mark, full-strength rather than dimmed - a deliberate
   brand fallback, not a muted "nothing here yet" placeholder. */
.avatar-glyph { object-fit: contain; }

/* Camera badge — neutral monochrome on both themes. No brand colour
   here; the avatar surface itself is the affordance. */
.avatar-edit-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 24px;
  height: 24px;
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

/* Display name lives inside the identity row right of the avatar; it
   needs to grow to fill the remaining width and pull its label and
   input upward so the input baseline sits roughly level with the
   avatar's vertical centre. */
.edit-name-field {
  flex: 1 1 auto;
  min-width: 0;
  padding-top: 30px;
  gap: 4px;
}

/* Form group — About on its own then the PAYMENT and PUBLIC IDENTITY
   section cards. The identity row above owns the top-of-sheet rhythm,
   so this block starts tight to it. */
.fields {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 0 18px 18px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Extended profile toggle — a bare chevron, no label, no caption.
   Centred, icon-only tap target (36px, comfortably above the iOS
   44pt floor once padding is included). Kept as a lightweight
   `<button>` (not a SettingsSection instance; that component is
   styled for the Settings page's card/row rhythm, not this sheet's
   flat field list). */
.extended-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0 auto;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  border: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease;
}

.extended-toggle:hover { background: rgba(128, 128, 128, 0.12); }

.extended-toggle-chevron {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.2s ease;
}

.extended-toggle-chevron--open {
  transform: rotate(180deg);
}

.extended-body {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* Row container laying an icon next to a field/section label. Used by
   every field now (About excepted - a plain label reads fine there),
   so "Get paid" and "Your name" carry the same small identifying
   glyph the rest of the app uses for icon-led rows. */
.field-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-label-icon {
  flex-shrink: 0;
}

.field-label-icon--bolt { color: #f7931a; }
.field-label-icon--check { color: #15a35b; }

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
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.10);
}

.field-input-wrap-dark:focus-within {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.32);
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
  /* A slightly taller input feels more confident on touch — 14px vertical
     padding lands at ~46px row height with the wrap border, matching the
     primary CTA's visual weight and keeping the field comfortably above
     iOS's 44pt tap-target minimum. */
  padding: 14px 16px;
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
  /* Smaller default so the About field doesn't add 100px of vertical
     real estate to a sheet that's already showing four sections. Still
     comfortable for ~3 lines of bio; the textarea grows naturally as
     the user types beyond that. */
  min-height: 64px;
}

.field-input::placeholder {
  opacity: 0.6;
}

.field-counter {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  align-self: flex-end;
  /* Pull the counter up so it sits closer to its textarea instead of
     floating mid-air between the field and the section below. */
  margin-top: -2px;
  opacity: 0.7;
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

/* ---------- Identity section: handles card + Buy CTA ----------
   Card surface reuses the field-input-wrap tokens so the visual
   weight matches text inputs above; each row is its own button so
   the radio-style selection is fully keyboard / screen-reader
   accessible. The Buy CTA below leans on the existing pill idiom
   from the hero — it stays a secondary affordance, not a primary
   one, because the sticky Save & Publish below is the actual
   primary action of the sheet. */

/* ---------- Section card ----------
   The visual container around each section's fields (or list rows).
   Gives the form an iOS-Settings cadence: a single soft tile per
   topic, with hairline dividers between rows or generous internal
   padding for input-heavy sections. The label sits *outside* the card
   above it, so the user reads "topic name → contents of topic." */

.section-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 14px 16px;
  border-radius: 16px;
}

.section-card-light {
  background: rgba(15, 23, 42, 0.025);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.04);
}

.section-card-dark {
  /* On the near-black sheet card the previous 0.025 alpha read as
     "invisible" — the section card vanished into the background. The
     bumped alphas keep the surface calm while still giving each
     section a discernible tile. */
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.09);
}

/* List-mode variant: zero internal padding/gap so the handle rows
   span edge-to-edge and the hairline dividers between rows do the
   visual work. Reserved for sections built from row affordances
   (Public identity), not labelled-input sections. */
.section-card--list {
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.handle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  /* A touch more vertical padding now that the row owns its slot
     inside the section card directly — no nested handles-card
     padding to inherit from. 44px total height stays well above the
     iOS tap-target floor on dense rows. */
  padding: 14px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease;
  text-align: left;
  width: 100%;
}

.handle-row + .handle-row { box-shadow: inset 0 1px 0 0 currentColor; opacity: 1; }
/* The divider colour is set on the row-tone classes so it picks up
   the right alpha for light vs dark without us writing it twice. */
.handle-row-light + .handle-row-light { box-shadow: inset 0 1px 0 0 rgba(15, 23, 42, 0.06); }
.handle-row-dark  + .handle-row-dark  { box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.06); }

.handle-row-light:hover { background: rgba(15, 23, 42, 0.04); }
.handle-row-dark:hover  { background: rgba(255, 255, 255, 0.04); }

.handle-row:active { transform: scale(0.997); }

.handle-row--active { cursor: default; }

.handle-radio { flex: 0 0 auto; display: inline-flex; }
.handle-radio-check { color: #15a35b; }
.handle-radio-empty {
  color: rgba(15, 23, 42, 0.30);
}
body.body--dark .handle-radio-empty { color: rgba(255, 255, 255, 0.30); }

.handle-text {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.handle-local { color: inherit; }
.handle-suffix { font-weight: 500; }

/* Renewal feature disabled — extension doesn't enforce expiry. When
   the upstream gains a renewal route, restore `.handle-text` to a
   flex-column layout, re-introduce the `.handle-local-row` wrapper,
   and uncomment the styles below.

.handle-local-row {
  display: inline-flex;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.handle-expiry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.handle-expiry-icon { flex-shrink: 0; }

.handle-expiry--soon { color: #b45309 !important; }
body.body--dark .handle-expiry--soon { color: #fbbf24 !important; }
*/

/* Explicit text colour on the handle row local part. Without this it
   inherits whatever the document default is, which in dark mode falls
   through to a near-invisible mid-grey and makes the actual name of
   the handle unreadable (only the muted `@domain` suffix stays
   legible). */
.section-card-light .handle-text { color: #0f172a; }
.section-card-dark  .handle-text { color: #f1f5f9; }

.handle-active-badge {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.handle-active-badge-light { background: rgba(21, 222, 114, 0.14); color: #0e7b3f; }
.handle-active-badge-dark  { background: rgba(21, 222, 114, 0.18); color: #6ee7a8; }

.handles-empty {
  padding: 14px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.04);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.4;
}

body.body--dark .handles-empty { background: rgba(255, 255, 255, 0.04); }

.buy-cta {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 999px;
  border: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.buy-cta:active { transform: scale(0.98); }

.buy-cta-light {
  background: rgba(15, 23, 42, 0.06);
  color: #0f172a;
}

.buy-cta-light:hover { background: rgba(15, 23, 42, 0.10); }

.buy-cta-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
}

.buy-cta-dark:hover { background: rgba(255, 255, 255, 0.10); }
</style>
