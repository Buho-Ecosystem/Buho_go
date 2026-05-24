<template>
  <!--
    Feature cards row — elevates valuable, action-y features above
    the configuration sections. Mainstream banking apps (Cash App,
    Revolut, Monzo) all do this: a compact band of "things you do"
    cards sits above the "things you configure" rows. Without it,
    features like Address Book and Kiosk Mode get visually buried
    among preference toggles.

    Each card is:
      icon  ─ visual anchor, single fixed colour per feature
      label ─ what the feature IS (not its current state)
      meta  ─ current state / count, optional

    Active state (e.g. Kiosk is running) gets a green border + tint
    so a user can see "this is on right now" at a glance.

    Feature shape:
      {
        id:    unique key (event payload),
        icon:  iconify name,
        label: short feature name (1–2 words),
        meta?: optional caption (e.g. "2 active", "12 saved", "Off"),
        active?: bool — green active treatment when true,
      }
  -->
  <div class="feature-cards">
    <button
      v-for="f in features"
      :key="f.id"
      type="button"
      class="feature-card"
      :class="{ 'feature-card--active': f.active }"
      @click="$emit('select', f.id)"
    >
      <span class="feature-card-icon">
        <Icon :icon="f.icon" width="22" height="22" />
      </span>
      <span class="feature-card-label">{{ f.label }}</span>
      <span v-if="f.meta" class="feature-card-meta">{{ f.meta }}</span>
      <span v-if="f.active" class="feature-card-dot" aria-hidden="true" />
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SettingsFeatureCards',
  components: { Icon },
  props: {
    features: { type: Array, required: true },
  },
  emits: ['select'],
};
</script>

<style scoped>
.feature-cards {
  display: grid;
  /*
    Default 2-up grid — best balance of breathing room and reach on
    a mobile screen where the app lives 99% of the time. A 3- or
    4-up row would crop labels on narrow phones; the 2x2 layout lets
    each card carry icon + label + meta line comfortably.
  */
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 0 0 22px;
}

.feature-card {
  all: unset;
  position: relative;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 14px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  text-align: left;
  min-height: 96px;
  transition: transform 0.12s ease, background 0.18s ease, border-color 0.18s ease;
  overflow: hidden;
}

.feature-card:active {
  transform: scale(0.97);
}

.feature-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.10));
  color: var(--color-green, #15DE72);
  margin-bottom: 2px;
}

body.body--light .feature-card-icon {
  background: rgba(5, 149, 115, 0.08);
  color: #059573;
}

.feature-card-label {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.feature-card-meta {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: -0.005em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

/* Active state — a soft tint + a pulsing dot. The pulse signals
   "running right now" (e.g. kiosk mode active) more clearly than
   colour alone, especially for users who don't immediately notice
   subtle border shifts. */
.feature-card--active {
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.10));
  border-color: rgba(21, 222, 114, 0.35);
}
.feature-card--active .feature-card-meta {
  color: var(--color-green, #15DE72);
  font-weight: 600;
}
body.body--light .feature-card--active {
  background: rgba(5, 149, 115, 0.07);
  border-color: rgba(5, 149, 115, 0.28);
}
body.body--light .feature-card--active .feature-card-meta {
  color: #059573;
}

.feature-card-dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-green, #15DE72);
  box-shadow: 0 0 0 3px rgba(21, 222, 114, 0.22);
  animation: feature-card-pulse 2.4s ease-out infinite;
}

@keyframes feature-card-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(21, 222, 114, 0.4); }
  70%  { box-shadow: 0 0 0 7px rgba(21, 222, 114, 0); }
  100% { box-shadow: 0 0 0 0 rgba(21, 222, 114, 0); }
}

/* Narrow phones (≤360px wide) — small fontsize drop so labels
   like "Auto-Transfer" don't ellipsise inside the 2x2 grid. */
@media (max-width: 360px) {
  .feature-cards { gap: 8px; }
  .feature-card { padding: 13px 11px 11px; min-height: 88px; }
  .feature-card-label { font-size: 13px; }
  .feature-card-meta  { font-size: 11px; }
}
</style>
