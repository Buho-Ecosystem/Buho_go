<template>
  <div class="hub-header" :class="$q.dark.isActive ? 'hub-header-dark' : 'hub-header-light'">
    <div class="hub-header-title" :class="$q.dark.isActive ? 'hub-header-title-dark' : 'hub-header-title-light'">
      {{ title }}
    </div>
    <div class="hub-header-actions">
      <slot name="actions" />
      <q-btn
        flat
        round
        dense
        class="back-btn"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
        :aria-label="$t('Home')"
        @click="goHome"
      >
        <Icon icon="tabler:home" width="20" height="20" />
      </q-btn>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import { haptics } from '../../utils/haptics';

/**
 * Shared header for the Settings and Spend tabs. Identity is the third tab
 * in the same hub but owns its own top bar, so it does not use this.
 *
 * The tabs are peers reached via SettingsHubNav, not a push-stack, so there
 * is no back chevron here: the home icon (always present, far right) is the
 * one universal way out, back to the wallet. A tab that needs its own
 * contextual action passes it through the `actions` slot, rendered just left
 * of the home icon; no tab uses it today.
 */
export default {
  name: 'SettingsHubHeader',
  components: { Icon },
  props: {
    title: { type: String, required: true },
  },
  methods: {
    goHome() {
      haptics.tap();
      if (this.$route.path === '/wallet') return;
      this.$router.push('/wallet');
    },
  },
};
</script>

<style scoped>
/* Sticky so Title + Home stay reachable while the tab's own content
   scrolls underneath - the same role the floating bottom nav plays for
   navigation, the header plays for orientation + exit.
   Host page must cancel the global `.q-page { padding-top: var(--safe-top) }`
   rule (e.g. `padding-top: 0` on its own root class) since this header
   owns the safe-top inset itself; otherwise the inset is applied twice.
   Grid (not flex) so the title sits truly centered on the viewport no
   matter how wide the actions slot ends up - both flanking 1fr columns are
   forced to the same width by the grid algorithm, so the empty left column
   always mirrors the actions column and the title never drifts off-center. */
.hub-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: calc(0.875rem + var(--safe-top, 0px)) 1rem 0.875rem;
}

.hub-header-dark {
  background: #0C0C0C;
}

.hub-header-light {
  background: var(--bg-primary);
}

.hub-header-title {
  grid-column: 2;
  justify-self: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.hub-header-title-dark {
  color: #FFF;
}

.hub-header-title-light {
  color: var(--text-primary);
}

.hub-header-actions {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 4px;
}

.back-btn {
  width: 40px;
  height: 40px;
}
</style>
