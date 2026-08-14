<template>
  <!--
    Navigation bar for every pushed identity screen.

    The back control carries the *previous* screen's name rather than a bare
    chevron, so a user who lands three levels deep always knows what they are
    returning to. `back-to` is the label, `to` is where it actually goes:
    identity screens are reachable from more than one place (Get paid opens
    from the card and from Manage), so the route cannot be inferred from the
    label alone.

    Top-level screens pass no `backTo` and get a large title in the body
    instead, which is where the title belongs on a screen the user did not
    push into.
  -->
  <div class="id-nav">
    <button
      v-if="backTo"
      type="button"
      class="id-nav-back"
      @click="onBack"
    >
      <Icon icon="tabler:chevron-left" width="18" height="18" />
      <span class="id-nav-back-label">{{ backTo }}</span>
    </button>
    <span v-else class="id-nav-pad" aria-hidden="true"></span>

    <span v-if="title" class="id-nav-title">{{ title }}</span>
    <span class="id-nav-spacer"></span>
    <slot name="actions" />
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'IdentityNav',

  components: { Icon },

  props: {
    /** Label of the screen we came from. Omit on top-level screens. */
    backTo: { type: String, default: '' },
    /** Route to return to. Defaults to router.back() when omitted. */
    to: { type: String, default: '' },
    /** Inline title. Most screens use a large title in the body instead. */
    title: { type: String, default: '' },
  },

  methods: {
    onBack() {
      if (this.to) this.$router.push(this.to);
      else this.$router.back();
    },
  },
};
</script>

<style scoped>
.id-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px 6px;
  min-height: 44px;
  flex: 0 0 auto;
}

/* Accent-coloured, iOS-style. Padded to a 44pt target even though the glyph
   and label are small. */
.id-nav-back {
  display: flex;
  align-items: center;
  gap: 1px;
  border: 0;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--brand-accent);
  cursor: pointer;
  padding: 6px 8px 6px 2px;
  min-height: 44px;
  border-radius: 10px;
}

.id-nav-back:active { opacity: 0.6; }

.id-nav-back-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.id-nav-pad { width: 8px; }

.id-nav-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.id-nav-spacer { flex: 1; }
</style>
