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
      <span class="id-row-label" :class="{ 'id-row-label--mono': monoLabel }">{{ label }}</span>
      <span
        v-if="caption || $slots.caption"
        class="id-row-caption"
        :class="{ 'id-row-caption--mono': mono, 'id-row-caption--wrap': wrap }"
      >
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
    /** Monospace the caption, for rows whose caption is a value. */
    mono: { type: Boolean, default: false },
    /** Monospace the label, for rows whose LABEL is the value. */
    monoLabel: { type: Boolean, default: false },
    chip: { type: String, default: '' },
    /** 'ok' | 'warn' | 'mute' */
    chipTone: { type: String, default: 'mute' },
    chipIcon: { type: String, default: '' },
    interactive: { type: Boolean, default: true },
    chevron: { type: Boolean, default: true },
    /**
     * Let the caption run past two lines.
     *
     * Captions clamp at two lines, which fits every sentence on the surface.
     * A caption that genuinely needs more opts in rather than being cut.
     */
    wrap: { type: Boolean, default: false },
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
  border-radius: var(--radius-ms);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--bg-input);
  color: var(--text-secondary);
}

.id-row-glyph--accent { background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.id-row-glyph--warn   { background: var(--color-warn-soft); color: var(--color-warn); }
.id-row-glyph--danger { background: rgba(255, 68, 68, 0.10); color: var(--color-red); }

.id-row-text { flex: 1; min-width: 0; }

.id-row-label {
  display: block;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: var(--text-primary);
}

.id-row-label--mono {
  font-family: var(--font-mono);
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.id-row--danger .id-row-label { color: var(--color-red); }

/* Two lines, not one. The caption is where this surface explains itself, and
   clipping mid-word made "Card words saved, wallet words still to save" read
   as "Card words saved, wallet words s…", which is ambiguous with the
   sentence that means the opposite. */
.id-row-caption {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
}

.id-row-caption--mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.id-row-caption--wrap {
  -webkit-line-clamp: unset;
  overflow: visible;
  line-height: 1.4;
}

.id-row-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 650;
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
  flex: 0 0 auto;
}

.id-row-chip--ok   { background: var(--brand-accent-soft); color: var(--brand-accent-text); }
.id-row-chip--warn { background: var(--color-warn-soft); color: var(--color-warn); }
.id-row-chip--mute { background: var(--bg-input); color: var(--text-secondary); }

.id-row-chev { color: var(--text-muted); flex: 0 0 auto; }

</style>
