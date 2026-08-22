<template>
  <!--
    An inset grouped list, the workhorse of the identity surface.

    Two deliberate rules come from the redesign and are enforced here rather
    than left to each caller:

      - A group can carry a `footer`, and the footer is where explanation
        lives. No row gets a help icon and no screen gets an info button.
      - A `title` renders as plain sentence-case text, not an uppercase
        micro-label, because the surface is trying to read like sentences.
  -->
  <div class="id-group-wrap">
    <div v-if="title" class="id-group-title">{{ title }}</div>
    <div v-if="subtitle" class="id-group-sub">{{ subtitle }}</div>
    <div class="id-group" :class="{ 'id-group--flat': flat }">
      <slot />
    </div>
    <p v-if="footer" class="id-group-footer">{{ footer }}</p>
    <slot name="footer" />
  </div>
</template>

<script>
export default {
  name: 'IdentityGroup',
  props: {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    footer: { type: String, default: '' },
    /** Drops the card background, for groups that host their own content. */
    flat: { type: Boolean, default: false },
  },
};
</script>

<style scoped>
.id-group-wrap { margin-bottom: 4px; }

.id-group-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
  margin: 24px 4px 9px;
}

.id-group-sub {
  font-size: 12.5px;
  color: var(--text-secondary);
  opacity: 0.86;
  margin: -5px 4px 9px;
  line-height: 1.45;
}

.id-group {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.id-group--flat {
  background: transparent;
  border: 0;
  border-radius: 0;
}

/* This is where the surface keeps its teaching: no row has a help icon and no
   screen has an info button, so the footer carries the explanation. It cannot
   be the least readable text on the page. */
.id-group-footer {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.86;
  line-height: 1.5;
  margin: 8px 6px 0;
}
</style>
