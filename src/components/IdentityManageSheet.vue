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

      <!-- Sheet header. Now purely a title + short subtitle - backup
           status moved to its own tile on the Profile page directly
           (a quiet dot, not a banner), so this sheet no longer needs
           to duplicate that status here. Kept to a title only, matching
           the lean-utility-sheet pattern the rest of the app uses. -->
      <q-card-section class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Advanced') }}
        </div>
        <div class="sheet-status" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ $t('Restore a profile, sign in elsewhere, or start over.') }}
        </div>
      </q-card-section>

      <!-- Primary actions list. Identity-card rows from the old page
           are gathered here so the main Profile screen can stay calm. -->
      <q-list class="sheet-list">
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
                {{ $t('Nostr key') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Advanced. Sign in to other Nostr apps with this profile.') }}
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

export default {
  name: 'IdentityManageSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'restore', 'regenerate', 'view-nostr'],

  setup() {
    const identity = useIdentityStore();
    return { identity };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
  },

  methods: {
    /**
     * Close the sheet *before* emitting the action. The parent then
     * opens its own dialog (restore, regenerate) on the now-empty
     * surface — feels like a continuous flow rather than a dialog
     * stacked on a sheet.
     */
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
   sheet is a lean utility list now, not a mini profile view. */

.sheet-header {
  padding: 6px 20px 16px;
}

.sheet-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.2;
}

.sheet-status {
  margin-top: 3px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
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
