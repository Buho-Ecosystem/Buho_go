<template>
  <!--
    Settings section primitive.
    Renders an optional uppercase section label above a card, and a
    card body that slots its children with automatic hairline
    separators between them. All theming comes from CSS variables
    (--bg-card, --border-card, --text-muted), so no dark/light
    class chains are needed at the call site.

    Collapsible mode (opt-in via `collapsible`) turns the header
    into a clickable row with a chevron and animates the card body
    open/closed. Defaults to expanded; pass `:default-expanded="false"`
    for sections that should start collapsed (e.g. Advanced).
  -->
  <section class="settings-section">
    <header
      v-if="title || $slots.title"
      class="settings-section-label"
      :class="{ 'settings-section-label-collapsible': collapsible }"
      :role="collapsible ? 'button' : null"
      :tabindex="collapsible ? 0 : null"
      :aria-expanded="collapsible ? expanded : null"
      @click="onHeaderClick"
      @keydown.enter.prevent="onHeaderClick"
      @keydown.space.prevent="onHeaderClick"
    >
      <span class="settings-section-label-text">
        <slot name="title">{{ title }}</slot>
      </span>
      <Icon
        v-if="collapsible"
        icon="tabler:chevron-down"
        class="settings-section-chevron"
        :class="{ 'settings-section-chevron-expanded': expanded }"
        aria-hidden="true"
      />
    </header>
    <q-slide-transition>
      <div v-show="!collapsible || expanded" class="settings-section-card">
        <slot />
      </div>
    </q-slide-transition>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SettingsSection',
  components: { Icon },
  props: {
    title: { type: String, default: '' },
    /**
     * When true the header becomes a click target that expands /
     * collapses the card body, with a chevron on the right. Default
     * false keeps the section behaviour identical to its original
     * always-open form, so existing call sites need no change.
     */
    collapsible: { type: Boolean, default: false },
    /**
     * Initial expanded state when collapsible. Ignored when
     * collapsible is false (the section is always rendered).
     * Defaults to true so adding `collapsible` alone gives an
     * always-expanded-but-collapsible section, and an explicit
     * `:default-expanded="false"` is what tucks Advanced away.
     */
    defaultExpanded: { type: Boolean, default: true },
  },
  data() {
    return {
      expanded: this.defaultExpanded,
    };
  },
  methods: {
    onHeaderClick() {
      if (this.collapsible) {
        this.expanded = !this.expanded;
      }
    },
  },
};
</script>

<style scoped>
.settings-section {
  margin: 0 0 24px;
}

.settings-section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 0 18px 8px;
}

/*
  Collapsible header — same typography as the non-collapsible
  label but laid out as a row with a chevron. The whole strip
  becomes a tap target; the focus ring on keyboard nav uses the
  default browser outline since this is a tertiary control.
*/
.settings-section-label-collapsible {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.settings-section-label-text {
  flex: 1;
  min-width: 0;
}

.settings-section-chevron {
  width: 14px;
  height: 14px;
  transition: transform 0.2s ease;
  margin-left: 8px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.settings-section-chevron-expanded {
  transform: rotate(180deg);
}

.settings-section-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  overflow: hidden;
}

/*
  Auto-divider between settings rows. Targets `.settings-row`
  specifically so non-row helpers inside a section (kiosk
  tip-input grid, kiosk activate button, donation row) don't
  pick up a spurious border that would make them look like
  another clickable row.

  A row that is the literal last child of the card draws no
  border (clean bottom edge). A row followed by a non-row
  helper still draws its border — that's the right read,
  because there is more content directly below it.
*/
.settings-section-card > :deep(.settings-row):not(:last-child) {
  border-bottom: 1px solid var(--border-card);
}
</style>
