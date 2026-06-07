<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-manage-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Identity header inside the sheet — same visual anchor as the
           strip on the Profile page so users understand "this is the
           same thing, expanded". -->
      <q-card-section class="sheet-header">
        <div
          class="sheet-avatar"
          :class="[
            $q.dark.isActive ? 'sheet-avatar-dark' : 'sheet-avatar-light',
            { 'sheet-avatar--warn': identity.bootstrapped && !identity.backupConfirmed },
          ]"
          aria-hidden="true"
        >
          <!-- Show the user's actual profile picture when one is set;
               fall back to the silhouette glyph for fresh identities
               and after a load failure. Same `avatarBroken` pattern
               the page hero uses, so a broken URL isn't retried on
               every re-render. -->
          <img
            v-if="visibleAvatarUrl"
            :src="visibleAvatarUrl"
            alt=""
            class="sheet-avatar-img"
            @error="onAvatarLoadError"
          />
          <Icon
            v-else
            icon="tabler:user"
            width="22"
            height="22"
          />
        </div>
        <div class="sheet-meta">
          <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Your profile') }}
          </div>
          <div class="sheet-status">
            <template v-if="!identity.bootstrapped">
              <Icon icon="tabler:sparkles" width="13" height="13" class="sheet-status-icon" />
              <span :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
                {{ $t('Not set up yet') }}
              </span>
            </template>
            <template v-else>
              <Icon
                :icon="identity.backupConfirmed ? 'tabler:shield-check' : 'tabler:shield-exclamation'"
                width="13"
                height="13"
                :class="['sheet-status-icon', identity.backupConfirmed ? 'is-ok' : 'is-warn']"
              />
              <span :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ identity.backupConfirmed ? $t('Recovery phrase backed up') : $t('Recovery phrase not backed up yet') }}
              </span>
            </template>
          </div>
        </div>
      </q-card-section>

      <!-- Primary actions list. Identity-card rows from the old page
           are gathered here so the main Profile screen can stay calm. -->
      <q-list class="sheet-list">
        <!--
          Recovery phrase row.
          For fresh installs the same row creates the phrase on first
          tap (ProfilePage.openIdentitySeedDialog → ensureIdentity).
          Once an identity exists, the row reveals + verifies it.
        -->
        <q-item
          clickable
          v-ripple
          @click="emitView"
        >
          <q-item-section side>
            <Icon icon="tabler:key" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ identity.bootstrapped ? $t('Recovery phrase') : $t('Set up your profile') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ identity.bootstrapped
                  ? $t('Your 12-word backup. Anyone with these words can sign in as you.')
                  : $t('Create your 12-word backup so you never lose your profile.') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

        <!-- Restore an existing profile from its 12-word backup. -->
        <q-item clickable v-ripple @click="emitRestore">
          <q-item-section side>
            <Icon icon="tabler:reload" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Restore from recovery phrase') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ identity.bootstrapped
                  ? $t('Use a profile from another device')
                  : $t('Already have a profile? Bring it back') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>

        <!--
          Advanced row: reveal the underlying private key.
          Hidden until an identity exists. Caption flags this as a
          power-user thing so casual users skip past it. Same dialog
          backs the row but the surfaced action is now unambiguous.
        -->
        <template v-if="identity.bootstrapped">
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple @click="emitViewNostr">
            <q-item-section side>
              <Icon icon="tabler:lock" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
            <q-item-section>
              <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
                {{ $t('Reveal private key') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Advanced. Lets you sign in to your profile on other apps.') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
            </q-item-section>
          </q-item>
        </template>

        <!--
          Destructive action — wipe profile + start fresh. Sits at the
          bottom of the sheet, red typography, typed-phrase
          confirmation behind it. The first sentence in the confirm
          dialog leads with "your wallets are safe", which is the
          user's #1 fear.
        -->
        <template v-if="identity.bootstrapped">
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple class="sheet-danger-row" @click="emitRegenerate">
            <q-item-section side>
              <Icon icon="tabler:user-x" width="20" height="20" class="sheet-danger-icon" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="sheet-danger-label">
                {{ $t('Start a new profile') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Wipe this profile and begin fresh. Your wallets are not affected.') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <Icon icon="tabler:chevron-right" class="sheet-danger-icon" />
            </q-item-section>
          </q-item>
        </template>
      </q-list>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';

export default {
  name: 'IdentityManageSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'view-seed', 'restore', 'regenerate', 'view-nostr'],

  setup() {
    const identity = useIdentityStore();
    const profile = useProfileStore();
    return { identity, profile };
  },

  data() {
    return {
      /**
       * Sticky flag for a failed avatar load — same pattern the
       * page hero uses. Once an `<img>` 404s in this session we
       * silently fall back to the silhouette glyph instead of
       * retrying the broken URL on every re-render.
       */
      avatarBroken: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Resolved avatar URL for the sheet header. Reads
     * `profileStore.picture` (the source of truth) and respects
     * the runtime `avatarBroken` flag so a failing URL falls back
     * to the silhouette without a retry loop.
     */
    visibleAvatarUrl() {
      if (!this.profile.picture) return '';
      if (this.avatarBroken) return '';
      return this.profile.picture;
    },
  },

  watch: {
    'profile.picture'() {
      // Avatar URL changed (likely a fresh upload) → reset the
      // failure flag so the new URL gets a fresh fetch attempt.
      this.avatarBroken = false;
    },
  },

  methods: {
    onAvatarLoadError() {
      this.avatarBroken = true;
    },


    /**
     * Close the sheet *before* emitting the action. The parent then
     * opens its own dialog (seed phrase view, restore, regenerate) on
     * the now-empty surface — feels like a continuous flow rather than
     * a dialog stacked on a sheet.
     */
    emitView() {
      this.open = false;
      // `nextTick` gives the sheet a moment to begin its leave animation
      // so the seed-phrase dialog doesn't pop on top of it. The 180ms
      // matches Quasar's default dialog transition.
      setTimeout(() => this.$emit('view-seed'), 180);
    },
    emitRestore() {
      this.open = false;
      setTimeout(() => this.$emit('restore'), 180);
    },
    emitRegenerate() {
      this.open = false;
      setTimeout(() => this.$emit('regenerate'), 180);
    },
    emitViewNostr() {
      this.open = false;
      setTimeout(() => this.$emit('view-nostr'), 180);
    },
  },
};
</script>

<style scoped>
.identity-manage-sheet {
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

.sheet-handle-bar-light {
  background: rgba(15, 23, 42, 0.18);
}

.sheet-handle-bar-dark {
  background: rgba(255, 255, 255, 0.22);
}

/* Header: mirrors the identity strip from the Profile page so the
   sheet feels like a natural extension of the strip the user just
   tapped. Same avatar treatment + same status semantics. */

.sheet-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 20px 16px;
}

.sheet-avatar {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  /* Clip the inner <img> to the circle. The warn ring (when set)
     uses an outer box-shadow so it sits OUTSIDE this clip. */
  overflow: hidden;
}

.sheet-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
}

.sheet-avatar-light {
  background: var(--btn-neutral-bg, #0f172a);
  color: var(--btn-neutral-fg, #ffffff);
}

.sheet-avatar-dark {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}

.sheet-avatar--warn {
  box-shadow: 0 0 0 2px #f59e0b;
}

.sheet-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.sheet-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.2;
}

.sheet-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
}

.sheet-status-icon {
  flex: 0 0 auto;
}

.sheet-status-icon.is-ok {
  color: #0f9c54;
}

.sheet-status-icon.is-warn {
  color: #b06d00;
}

/* Action list */

.sheet-list :deep(.q-item) {
  padding: 12px 20px;
  min-height: 56px;
}

/* Destructive row — red typography only. No alarm-red background, no
   warning icon: this is a deliberate user choice they've made by
   reaching into the sheet, not a state we need to scream about. */

.sheet-danger-row .sheet-danger-icon {
  color: #ef4444;
}

.sheet-danger-label {
  color: #ef4444;
  font-weight: 500;
}

/* Nostr logo — rendered as-is in its brand colour. Sized to match a
   20px tabler icon so it lines up visually with the rows above and below. */
.nostr-row-icon {
  display: block;
  width: 20px;
  height: 20px;
  user-select: none;
  -webkit-user-drag: none;
}

/* Dark-mode separators */
.separator-light { background: rgba(15, 23, 42, 0.06); }
.separator-dark  { background: rgba(255, 255, 255, 0.06); }
.chevron-light   { color: #94a3b8; }
.chevron-dark    { color: #cbd5e1; }
.item-label-light  { color: #0f172a; }
.item-label-dark   { color: #f8fafc; }
.item-caption-light { color: #64748b; }
.item-caption-dark  { color: #94a3b8; }
</style>
