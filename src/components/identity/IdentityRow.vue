<template>
  <!--
    One row inside an IdentityGroup.

    Every row is a labelled sentence with an optional caption. There is no
    icon-only variant on purpose: the surface this replaces used unlabelled
    13px glyphs for its most important actions, which is the single most
    reported source of "I cannot find it".

    Rows are 60px tall, comfortably past the 44pt minimum, and the whole row
    is the target rather than the glyph inside it.
  -->
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : null"
    class="id-row"
    :class="[
      { 'id-row--static': !interactive },
      { 'id-row--danger': danger },
    ]"
    @click="interactive ? $emit('click') : null"
  >
    <span v-if="icon" class="id-row-glyph" :class="glyphClass">
      <Icon :icon="icon" width="17" height="17" />
    </span>
    <slot name="leading" />

    <span class="id-row-text">
      <span class="id-row-label">{{ label }}</span>
      <span v-if="caption || $slots.caption" class="id-row-caption" :class="{ 'id-row-caption--mono': mono }">
        <slot name="caption">{{ caption }}</slot>
      </span>
    </span>

    <slot name="trailing" />

    <span v-if="chip" class="id-row-chip" :class="`id-row-chip--${chipTone}`">
      <Icon v-if="chipIcon" :icon="chipIcon" width="12" height="12" />
      {{ chip }}
    </span>

    <Icon
      v-if="interactive && chevron"
      icon="tabler:chevron-right"
      width="17"
      height="17"
      class="id-row-chev"
    />
  </component>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'IdentityRow',

  components: { Icon },

  props: {
    label: { type: String, required: true },
    caption: { type: String, default: '' },
    icon: { type: String, default: '' },
    /** 'neutral' | 'accent' | 'warn' | 'danger' */
    tone: { type: String, default: 'neutral' },
    mono: { type: Boolean, default: false },
    chip: { type: String, default: '' },
    /** 'ok' | 'warn' | 'mute' */
    chipTone: { type: String, default: 'mute' },
    chipIcon: { type: String, default: '' },
    interactive: { type: Boolean, default: true },
    chevron: { type: Boolean, default: true },
    danger: { type: Boolean, default: false },
  },

  emits: ['click'],

  computed: {
    glyphClass() {
      return `id-row-glyph--${this.danger ? 'danger' : this.tone}`;
    },
  },
};
</script>

<style scoped>
.id-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 14px;
  min-height: 60px;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
  cursor: pointer;
}

.id-row--static { cursor: default; }

.id-row + .id-row { border-top: 1px solid var(--border-card); }

.id-row:not(.id-row--static):active { background: rgba(127, 127, 127, 0.08); }

.id-row-glyph {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--bg-input);
  color: var(--text-secondary);
}

.id-row-glyph--accent { background: var(--brand-accent-soft); color: var(--brand-accent); }
.id-row-glyph--warn   { background: rgba(154, 107, 0, 0.10); color: #9A6B00; }
.id-row-glyph--danger { background: rgba(255, 68, 68, 0.10); color: var(--color-red); }

.id-row-text { flex: 1; min-width: 0; }

.id-row-label {
  display: block;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: var(--text-primary);
}

.id-row--danger .id-row-label { color: var(--color-red); }

.id-row-caption {
  display: block;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.id-row-caption--mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.id-row-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 650;
  padding: 4px 9px;
  border-radius: 999px;
  white-space: nowrap;
  flex: 0 0 auto;
}

.id-row-chip--ok   { background: var(--brand-accent-soft); color: var(--brand-accent); }
.id-row-chip--warn { background: rgba(154, 107, 0, 0.10); color: #9A6B00; }
.id-row-chip--mute { background: var(--bg-input); color: var(--text-secondary); }

.id-row-chev { color: var(--text-muted); flex: 0 0 auto; }

body.body--dark .id-row-glyph--warn { background: rgba(232, 196, 104, 0.12); color: #E8C468; }
body.body--dark .id-row-chip--warn  { background: rgba(232, 196, 104, 0.12); color: #E8C468; }
</style>
