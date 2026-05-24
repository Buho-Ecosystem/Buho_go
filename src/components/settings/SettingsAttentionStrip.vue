<template>
  <!--
    Attention strip — sticky warning area shown only when something
    needs the user's attention. Each warning is a self-contained card
    with icon, headline, helper, and a single CTA. No persistent
    nagging banners elsewhere in the app — this is the one place
    where "you should do X" lives so the rest of Settings stays calm.

    Empty by design: when `warnings.length === 0` the strip renders
    nothing (no header, no padding) so a healthy account sees zero
    visual weight here.

    Variants:
      • warning  — amber, the default for "you should fix this"
      • info     — blue, neutral state (e.g. "kiosk active")
      • danger   — red, immediate concern

    Warning shape:
      {
        id:          unique key,
        variant:     'warning' | 'info' | 'danger',
        icon:        iconify name,
        title:       short headline,
        description: optional one-liner,
        ctaLabel:    short verb (e.g. "Back up"),
      }
  -->
  <transition-group name="attention" tag="div" class="attention-strip" v-if="warnings.length">
    <div
      v-for="w in warnings"
      :key="w.id"
      class="attention-card"
      :class="`attention-card--${w.variant || 'warning'}`"
    >
      <span class="attention-icon">
        <Icon :icon="w.icon" width="20" height="20" />
      </span>
      <span class="attention-body">
        <span class="attention-title">{{ w.title }}</span>
        <span v-if="w.description" class="attention-desc">{{ w.description }}</span>
      </span>
      <button
        type="button"
        class="attention-cta"
        :class="`attention-cta--${w.variant || 'warning'}`"
        @click="$emit('action', w.id)"
      >
        {{ w.ctaLabel }}
      </button>
    </div>
  </transition-group>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SettingsAttentionStrip',
  components: { Icon },
  props: {
    warnings: {
      type: Array,
      default: () => [],
      // Shape documented in template comment; not enforced so the
      // call site stays terse. Bad shape will surface as a missing
      // field at render time — easy to spot and not a security issue.
    },
  },
  emits: ['action'],
};
</script>

<style scoped>
.attention-strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 18px;
}

.attention-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 14px 12px;
  border-radius: var(--radius-md, 16px);
  border: 1px solid var(--border-card);
}

.attention-card--warning {
  background: rgba(255, 168, 0, 0.08);
  border-color: rgba(255, 168, 0, 0.24);
}
.attention-card--info {
  background: rgba(80, 160, 255, 0.08);
  border-color: rgba(80, 160, 255, 0.24);
}
.attention-card--danger {
  background: rgba(255, 68, 68, 0.08);
  border-color: rgba(255, 68, 68, 0.24);
}

.attention-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.attention-card--warning .attention-icon { background: rgba(255, 168, 0, 0.15); color: #FFB347; }
.attention-card--info    .attention-icon { background: rgba(80, 160, 255, 0.15); color: #6CB0FF; }
.attention-card--danger  .attention-icon { background: rgba(255, 68, 68, 0.15); color: var(--color-red, #FF4444); }

body.body--light .attention-card--warning .attention-icon { color: #B8780E; }
body.body--light .attention-card--info    .attention-icon { color: #1E63B8; }

.attention-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.attention-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
  line-height: 1.3;
}

.attention-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-muted);
  line-height: 1.4;
}

.attention-cta {
  all: unset;
  cursor: pointer;
  flex-shrink: 0;
  align-self: center;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  padding: 8px 12px;
  border-radius: 10px;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease, background 0.15s ease;
}
.attention-cta:active {
  transform: scale(0.97);
}

.attention-cta--warning {
  background: #FFB347;
  color: #1A1A1A;
}
.attention-cta--info {
  background: #6CB0FF;
  color: #1A1A1A;
}
.attention-cta--danger {
  background: var(--color-red, #FF4444);
  color: #FFFFFF;
}

/* enter / leave so warnings appear and disappear gracefully */
.attention-enter-active,
.attention-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.attention-enter-from { opacity: 0; transform: translateY(-6px); }
.attention-leave-to   { opacity: 0; transform: translateY(-6px); }
</style>
