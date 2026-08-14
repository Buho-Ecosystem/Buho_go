<template>
  <div class="hub-nav-safe">
    <nav
      class="hub-nav"
      :class="$q.dark.isActive ? 'hub-nav-dark' : 'hub-nav-light'"
      role="tablist"
      :aria-label="$t('Settings navigation')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="hub-nav-tab"
        :class="{ 'hub-nav-tab-active': activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-label="$t(tab.label)"
        @click="navigate(tab)"
      >
        <span class="hub-nav-tab-pill">
          <Icon :icon="tab.icon" class="hub-nav-tab-icon" width="22" height="22" />
        </span>
      </button>
    </nav>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import { haptics } from '../../utils/haptics';

/**
 * Floating bottom navigation for the Settings / Identity / Spend hub.
 * Same glass-pill recipe as EarnBottomNav (Learn & Earn), so the two
 * floating bars in the app read as one design language.
 *
 * Unlike EarnBottomNav, the active tab is derived from the current
 * route rather than passed in as a prop: this hub has a default-tab
 * redirect (bare `/settings` -> `/spend`) and a legacy alias
 * (`/profile` -> `/identity`), so deriving from `$route.path` means
 * every entry point resolves to the right highlighted tab automatically
 * instead of each hosting page having to know and repeat that logic.
 */
export default {
  name: 'SettingsHubNav',
  components: { Icon },
  data() {
    return {
      tabs: [
        { id: 'settings', icon: 'tabler:settings', label: 'Settings', route: '/settings' },
        { id: 'identity', icon: 'tabler:user', label: 'Identity', route: '/identity' },
        { id: 'spend', icon: 'tabler:shopping-bag', label: 'Spend', route: '/spend' },
      ],
    };
  },
  computed: {
    activeTab() {
      const path = this.$route.path;
      // Prefix match, not equality: the identity tab now has child routes
      // (/identity/manage, /identity/words …) and an exact comparison
      // silently dropped the highlight the moment a user pushed one.
      if (path === '/profile' || path === '/identity' || path.startsWith('/identity/')) return 'identity';
      if (path === '/spend') return 'spend';
      return 'settings';
    },
  },
  methods: {
    navigate(tab) {
      if (this.$route.path === tab.route) return;
      // Fire-and-forget: a native haptic tap gives the bar a proper
      // tactile feel on iOS/Android and is a silent no-op on web.
      haptics.tap();
      this.$router.push(tab.route);
    },
  },
};
</script>

<style scoped>
/* Wrapper only carries safe-area padding; the visible pill lives inside.
   Fixed so the pill stays anchored to the bottom as pages scroll.
   Icon-only pill is content-sized, so the wrapper centers it with flex
   rather than stretching a fixed max-width like the labelled version did. */
.hub-nav-safe {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 0 16px;
  /* var(--safe-bottom) so the Android gesture-nav fallback from
     src/boot/safe-area.js is honoured; env() alone returns 0 on
     most Android WebViews. */
  padding-bottom: max(14px, calc(var(--safe-bottom, 14px) + 4px));
  z-index: 100;
  pointer-events: none; /* only the nav pill receives events */
}

/* Floating pill container. Translucent + backdrop blur gives the
   modern "glass" look you see in current iOS and Android apps. */
.hub-nav {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 5px;
  border-radius: 28px;
  backdrop-filter: blur(32px) saturate(1.9);
  -webkit-backdrop-filter: blur(32px) saturate(1.9);
  transition: background 0.2s ease;
}

.hub-nav-light {
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 10px 30px -8px rgba(15, 23, 42, 0.22),
    0 2px 6px rgba(15, 23, 42, 0.06);
}

.hub-nav-dark {
  background: rgba(18, 20, 24, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 30px -8px rgba(0, 0, 0, 0.65),
    0 2px 6px rgba(0, 0, 0, 0.35);
}

/* Each tab is a fixed-size square touch target (44px meets the minimum
   recommended tap-target size even though the visible pill is smaller). */
.hub-nav-tab {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.18s ease;
}

.hub-nav-tab:active {
  transform: scale(0.94);
}

/* Icon-only: aria-label on the button carries the accessible name, the
   active tab's pill background is the only visual state indicator. */
.hub-nav-tab-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  color: var(--text-muted, #94a3b8);
  transition:
    background 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.2s ease;
}

.hub-nav-tab-active .hub-nav-tab-pill {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
}

.hub-nav-tab-icon {
  flex: 0 0 auto;
  /* Tabler icons carry stroke-width on the root <svg>; stroke-width
     inherits in SVG, so overriding it here thickens every path without
     needing separate "bold" icon variants. */
  stroke-width: 2.5;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.hub-nav-tab-active .hub-nav-tab-icon {
  transform: scale(1.08);
}

/* Respect the user's motion preference: static active indicator, no
   press or icon animations. */
@media (prefers-reduced-motion: reduce) {
  .hub-nav-tab,
  .hub-nav-tab-pill,
  .hub-nav-tab-icon {
    transition: none;
  }
  .hub-nav-tab:active {
    transform: none;
  }
}
</style>
