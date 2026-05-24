<template>
  <!--
    Settings section primitive.
    Renders an optional uppercase section label above a card, and a
    card body that slots its children with automatic hairline
    separators between them. All theming comes from CSS variables
    (--bg-card, --border-card, --text-muted), so no dark/light
    class chains are needed at the call site.
  -->
  <section class="settings-section">
    <header v-if="title || $slots.title" class="settings-section-label">
      <slot name="title">{{ title }}</slot>
    </header>
    <div class="settings-section-card">
      <slot />
    </div>
  </section>
</template>

<script>
export default {
  name: 'SettingsSection',
  props: {
    title: { type: String, default: '' },
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

.settings-section-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md, 16px);
  overflow: hidden;
}

/*
  Auto-divider between settings rows. Scoped to `.settings-row`
  specifically (rather than every direct child) so non-row helpers
  inside a section — kiosk tip-input rows, the kiosk activate
  button, the donation row — don't pick up a spurious border that
  makes them look like clickable rows when they aren't.

  Note: the last-of-type selector inside :deep() picks the final
  .settings-row in the card. If a non-row helper sits after a row,
  the row still draws its border-bottom (correct — there is more
  content below it).
*/
.settings-section-card > :deep(.settings-row):not(:last-child) {
  border-bottom: 1px solid var(--border-card);
}
</style>
