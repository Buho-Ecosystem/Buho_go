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
    <!-- Centred independently of the back label's width, and non-interactive
         so it never eats a tap meant for the control underneath. -->
    <span v-if="title" class="id-nav-title">{{ title }}</span>

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

    <span class="id-nav-spacer"></span>
    <slot name="actions" />

    <!-- The hub's one universal way out, on every screen, far right, the
         same glyph and place as the Settings and Spend headers. -->
    <button
      type="button"
      class="id-nav-home"
      :aria-label="$t('Home')"
      @click="$router.push('/wallet')"
    >
      <Icon icon="tabler:home" width="20" height="20" />
    </button>
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
/*
 * Not sticky, deliberately.
 *
 * The back control scrolling out of view on the long screens is real, and
 * `position: sticky; top: 0` is the obvious fix. It does not work here:
 * `body { overflow-x: hidden }` (app.css) makes body a scroll container whose
 * height equals its content, so a sticky descendant pins to a box that is
 * itself scrolling away with the document. Measured on Manage identity: with
 * sticky applied the nav still moved from y=0 to y=-384 after a 384px scroll.
 *
 * The settings hub header has the same declaration and the same behaviour, so
 * nothing in the app pins today; this surface is consistent, not worse. A real
 * fix means changing the app's scroll container, which is not this component's
 * call to make.
 */
.id-nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: calc(var(--safe-top, 0px) + 2px) 8px 2px;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
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
  color: var(--brand-accent-text);
  cursor: pointer;
  padding: 6px 8px 6px 2px;
  min-height: 44px;
  border-radius: var(--radius-ms);
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
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.id-nav-spacer { flex: 1; }

.id-nav-home {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-ms);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.id-nav-home:active { background: rgba(127, 127, 127, 0.12); }
</style>
