<template>
  <!--
    Settings row primitive.

    One uniform row shape used by every settings list. Layout:
      [ icon-slot ]  label                   [ inlineValue ]  [ right-slot or chevron ]
                     caption                  [ badge ]

    Modes:
      • clickable navigation row  — default; emits @click, shows chevron
      • toggle / control row     — pass `interactive=false` and use #right slot
      • destructive row          — `destructive`, label turns red, centred
      • info-only row            — `interactive=false`, no chevron

    Theming: pure CSS variables (--bg-card, --text-primary, --text-muted,
    --color-green, --color-red). No dark/light class branches.
  -->
  <!--
    Render as <button> only when clickable so the browser doesn't
    apply its default disabled greying to info / toggle rows. We
    used to set [disabled] whenever `interactive=false`, which
    silently knocked the opacity of every toggle row, "Connected
    to" row, etc. down to 50% — making the whole page look broken.

    The `disabled` *prop* (explicit) still applies the dimmed
    look via the `.settings-row--disabled` class, which is the
    intent — that flag is reserved for "this exists but you can't
    use it right now" cases (e.g. Spark switcher mid-switch).
  -->
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    class="settings-row"
    :class="[
      { 'settings-row--clickable': interactive && !disabled },
      { 'settings-row--disabled': disabled },
      { 'settings-row--destructive': destructive },
    ]"
    :aria-disabled="disabled ? 'true' : null"
    @click="onClick"
  >
    <span v-if="icon || $slots.icon" class="settings-row-icon">
      <slot name="icon">
        <Icon :icon="icon" width="20" height="20" />
      </slot>
    </span>

    <span class="settings-row-body">
      <span class="settings-row-label">
        <slot name="label">{{ label }}</slot>
      </span>
      <span
        v-if="caption || $slots.caption"
        class="settings-row-caption"
        :class="{ 'settings-row-caption--mono': captionMono }"
      >
        <slot name="caption">{{ caption }}</slot>
      </span>
    </span>

    <span v-if="badge" class="settings-row-badge" :class="`settings-row-badge--${badgeVariant}`">
      {{ badge }}
    </span>

    <span v-if="inlineValue" class="settings-row-inline-value">{{ inlineValue }}</span>

    <span class="settings-row-right">
      <slot name="right">
        <Icon
          v-if="interactive && showChevron && !destructive"
          icon="tabler:chevron-right"
          width="16"
          height="16"
          class="settings-row-chevron"
        />
      </slot>
    </span>
  </component>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SettingsRow',
  components: { Icon },
  props: {
    icon: { type: String, default: '' },
    label: { type: String, default: '' },
    caption: { type: String, default: '' },
    captionMono: { type: Boolean, default: false },
    /** Right-side text shown before chevron (e.g. current language). */
    inlineValue: { type: String, default: '' },
    /** Small pill badge (e.g. "Backup needed"). */
    badge: { type: String, default: '' },
    badgeVariant: {
      type: String,
      default: 'warning',
      validator: v => ['warning', 'success', 'info', 'danger'].includes(v),
    },
    interactive: { type: Boolean, default: true },
    disabled: { type: Boolean, default: false },
    showChevron: { type: Boolean, default: true },
    destructive: { type: Boolean, default: false },
  },
  emits: ['click'],
  methods: {
    onClick(e) {
      if (!this.interactive || this.disabled) return;
      this.$emit('click', e);
    },
  },
};
</script>

<style scoped>
.settings-row {
  all: unset;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  background: transparent;
  box-sizing: border-box;
  cursor: default;
  font-family: 'Manrope', sans-serif;
}

.settings-row--clickable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.settings-row--clickable:active {
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.06));
}

.settings-row--disabled {
  opacity: 0.5;
}

.settings-row-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.settings-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.settings-row-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.settings-row-caption {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-muted);
  line-height: 1.4;
  letter-spacing: -0.005em;
  /* Allow caption to wrap naturally but never overflow the row. */
  overflow-wrap: anywhere;
}

.settings-row-caption--mono {
  font-family: var(--font-mono, 'SF Mono', Menlo, monospace);
  font-size: 12px;
}

.settings-row-inline-value {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: auto;
  letter-spacing: -0.005em;
}

.settings-row-right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.settings-row-chevron {
  color: var(--text-muted);
  opacity: 0.7;
}

/* Badges */
.settings-row-badge {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.settings-row-badge--warning {
  background: rgba(255, 168, 0, 0.14);
  color: #FFB347;
}
.settings-row-badge--success {
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.14));
  color: var(--color-green, #15DE72);
}
.settings-row-badge--info {
  background: rgba(80, 160, 255, 0.14);
  color: #6CB0FF;
}
.settings-row-badge--danger {
  background: rgba(255, 68, 68, 0.14);
  color: var(--color-red, #FF4444);
}

body.body--light .settings-row-badge--warning { color: #B8780E; }
body.body--light .settings-row-badge--info { color: #1E63B8; }

/* Destructive row */
.settings-row--destructive .settings-row-label {
  color: var(--color-red, #FF4444);
  text-align: center;
  width: 100%;
}
.settings-row--destructive .settings-row-body {
  align-items: center;
}
</style>
