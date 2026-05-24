<template>
  <!--
    Quick-toggles row — four most-changed binary controls surfaced
    above the configuration sections. Because they are the *only*
    entry point for these settings (the duplicated rows in
    Preferences / Security have been removed), each pill must
    communicate three things at a glance:

      icon  ─ visual anchor for what it controls
      label ─ FIXED name of the setting (e.g. "Theme")
      value ─ CURRENT state (e.g. "Dark")

    The label stays fixed so a returning user always knows what
    the pill *does*; the value updates so they know its current
    state. Pills with `on: true|false` are true on/off toggles
    (e.g. App Lock, Hide Balance) and tint green when on. Pills
    that omit `on` are either-or choices (e.g. Theme: Dark/Light,
    Display: Bitcoin/Fiat) — they swap value text on tap but keep
    neutral styling because neither side is "active".

    Disabled pills (e.g. App Lock when no biometrics available)
    dim to ~55% — clearly inactive without looking broken.
  -->
  <div class="quick-toggles" role="toolbar" aria-label="Quick settings">
    <button
      v-for="t in toggles"
      :key="t.id"
      type="button"
      class="quick-toggle"
      :class="{
        'quick-toggle--on': t.on,
        'quick-toggle--disabled': t.disabled,
      }"
      :disabled="t.disabled"
      :aria-pressed="t.on != null ? (t.on ? 'true' : 'false') : null"
      @click="onClick(t)"
    >
      <span class="quick-toggle-icon">
        <Icon :icon="t.icon" width="18" height="18" />
      </span>
      <span class="quick-toggle-label">{{ t.label }}</span>
      <span class="quick-toggle-value">{{ t.value }}</span>
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SettingsQuickToggles',
  components: { Icon },
  props: {
    /**
     * Array of toggle definitions:
     *   {
     *     id:        unique key (event payload),
     *     icon:      iconify name (fixed across states),
     *     label:     fixed setting name (e.g. "Theme"),
     *     value:     current state text (e.g. "Dark"),
     *     on?:       optional true/false — only set for true binary
     *                on/off toggles (e.g. App Lock). When undefined
     *                the pill renders neutral regardless of value.
     *     disabled?: bool — pill renders dimmed, taps no-op.
     *   }
     */
    toggles: { type: Array, required: true },
  },
  emits: ['toggle'],
  methods: {
    onClick(t) {
      if (t.disabled) return;
      this.$emit('toggle', t.id);
    },
  },
};
</script>

<style scoped>
.quick-toggles {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 8px;
  margin: 0 0 22px;
}

.quick-toggle {
  all: unset;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 12px 11px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  text-align: left;
  min-height: 78px;
  box-sizing: border-box;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
  overflow: hidden;
}

.quick-toggle:active:not(.quick-toggle--disabled) {
  transform: scale(0.97);
}

.quick-toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--text-secondary);
  margin-bottom: 2px;
  transition: color 0.18s ease;
}

.quick-toggle-label {
  font-family: 'Manrope', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.quick-toggle-value {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: var(--text-primary);
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* True on/off pills (App Lock) get a soft green when on so the
   "this is active right now" semantic is visible at a glance.
   Either-or pills (Theme / Display / Format) don't get this — they
   are always one of two valid states, neither of which is "on". */
.quick-toggle--on {
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.12));
  border-color: rgba(21, 222, 114, 0.35);
}
.quick-toggle--on .quick-toggle-icon,
.quick-toggle--on .quick-toggle-value {
  color: var(--color-green, #15DE72);
}

body.body--light .quick-toggle--on {
  background: rgba(5, 149, 115, 0.09);
  border-color: rgba(5, 149, 115, 0.30);
}
body.body--light .quick-toggle--on .quick-toggle-icon,
body.body--light .quick-toggle--on .quick-toggle-value {
  color: #059573;
}

.quick-toggle--disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Narrow screens — the 4-up layout otherwise crops the value text. */
@media (max-width: 360px) {
  .quick-toggle { padding: 10px 8px 9px; min-height: 72px; }
  .quick-toggle-label { font-size: 9.5px; }
  .quick-toggle-value { font-size: 12.5px; }
}
</style>
