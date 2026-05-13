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
          <Icon icon="tabler:user" width="22" height="22" />
        </div>
        <div class="sheet-meta">
          <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
            {{ $t('Your BuhoGO identity') }}
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
                {{ identity.backupConfirmed ? $t('Backed up') : $t('Backup needed') }}
              </span>
            </template>
          </div>
        </div>
      </q-card-section>

      <!-- Primary actions list. Identity-card rows from the old page
           are gathered here so the main Profile screen can stay calm. -->
      <q-list class="sheet-list">
        <q-item
          clickable
          v-ripple
          :disable="!identity.bootstrapped"
          @click="emitView"
        >
          <q-item-section side>
            <Icon icon="tabler:eye" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('View seed phrase') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ $t('Show your 12 recovery words') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>
        <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>

        <q-item clickable v-ripple @click="emitRestore">
          <q-item-section side>
            <Icon icon="tabler:reload" width="20" height="20" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
          <q-item-section>
            <q-item-label :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ $t('Restore from seed phrase') }}
            </q-item-label>
            <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
              {{ identity.bootstrapped
                  ? $t('Use an identity from another device')
                  : $t('Already have an identity? Bring it back') }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <Icon icon="tabler:chevron-right" :class="$q.dark.isActive ? 'chevron-dark' : 'chevron-light'" />
          </q-item-section>
        </q-item>

        <!-- Destructive action sits at the bottom of the sheet,
             visually separated by a wider gap and red typography. Same
             role as the page-level Danger Zone before — same protection
             (typed-phrase confirmation behind it) — just less in-your-face. -->
        <template v-if="identity.bootstrapped">
          <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'"/>
          <q-item clickable v-ripple class="sheet-danger-row" @click="emitRegenerate">
            <q-item-section side>
              <Icon icon="tabler:user-x" width="20" height="20" class="sheet-danger-icon" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="sheet-danger-label">
                {{ $t('Generate new identity') }}
              </q-item-label>
              <q-item-label caption :class="$q.dark.isActive ? 'item-caption-dark' : 'item-caption-light'">
                {{ $t('Start over. Every linked site forgets you.') }}
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

  emits: ['update:modelValue', 'view-seed', 'restore', 'regenerate'],

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
