<template>
  <div class="earn-nav-safe">
    <nav
      class="earn-nav"
      :class="$q.dark.isActive ? 'earn-nav-dark' : 'earn-nav-light'"
      role="tablist"
      :aria-label="$t('Learn & Earn navigation')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="earn-nav-tab"
        :class="{ 'earn-nav-tab-active': activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-label="$t(tab.label)"
        @click="navigate(tab)"
      >
        <span class="earn-nav-tab-pill">
          <Icon :icon="tab.icon" class="earn-nav-tab-icon" width="20" height="20" />
          <span class="earn-nav-tab-label">{{ $t(tab.label) }}</span>
        </span>
      </button>
    </nav>
  </div>
</template>

<script>
import { haptics } from '../utils/haptics';

/**
 * Floating bottom navigation for the Learn & Earn section.
 *
 * Three section-scoped tabs: Lessons, Summary, and Exit. Designed to
 * look and feel like a modern mobile app bar — a translucent floating
 * pill detached from the screen edges, with a soft animated "active"
 * indicator that expands to reveal the label (Material 3 style) and a
 * gentle press animation. Haptic feedback fires on native platforms.
 *
 * Exit always routes to `/wallet` rather than using router.back() so
 * the destination is predictable no matter how the user arrived here.
 */
export default {
  name: 'EarnBottomNav',
  props: {
    activeTab: {
      type: String,
      default: 'lessons',
      validator: (v) => ['lessons', 'summary', 'exit'].includes(v),
    },
  },
  data() {
    return {
      tabs: [
        { id: 'lessons', icon: 'tabler:book-2', label: 'Lessons', route: '/learn' },
        { id: 'summary', icon: 'tabler:trophy', label: 'Summary', route: '/learn/summary' },
        { id: 'exit', icon: 'tabler:door-exit', label: 'Exit', route: '/wallet' },
      ],
    };
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
   Fixed so the pill stays anchored to the bottom as pages scroll. */
.earn-nav-safe {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 16px;
  /* var(--safe-bottom) so the Android gesture-nav fallback from
     src/boot/safe-area.js is honoured; env() alone returns 0 on
     most Android WebViews. */
  padding-bottom: max(16px, calc(var(--safe-bottom, 16px) + 4px));
  z-index: 100;
  pointer-events: none; /* only the nav pill receives events */
}

/* Floating pill container. Translucent + backdrop blur gives the
   modern "glass" look you see in current iOS and Android apps. */
.earn-nav {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 480px;
  margin: 0 auto;
  padding: 6px;
  border-radius: 32px;
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  transition: background 0.2s ease;
}

.earn-nav-light {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow:
    0 10px 30px -8px rgba(15, 23, 42, 0.18),
    0 2px 6px rgba(15, 23, 42, 0.04);
}

.earn-nav-dark {
  background: rgba(18, 20, 24, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow:
    0 10px 30px -8px rgba(0, 0, 0, 0.6),
    0 2px 6px rgba(0, 0, 0, 0.3);
}

/* Each tab is a full-height, equal-width button. The inner "pill"
   carries the active-state background so the background animates
   within the tab rather than from tab to tab. */
.earn-nav-tab {
  flex: 1 1 0;
  min-width: 0;
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

.earn-nav-tab:active {
  transform: scale(0.94);
}

/* Always shows icon + label. Labels improve discoverability ("door" =
   exit?), accessibility, and learnability. With only 3 tabs there's no
   space pressure to hide them. The active-state pill + colour shift
   still tells the user where they are. */
.earn-nav-tab-pill {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 12px;
  border-radius: 20px;
  color: var(--text-muted, #94a3b8);
  transition:
    background 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.2s ease;
}

.earn-nav-tab-active .earn-nav-tab-pill {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
}

.earn-nav-tab-icon {
  flex: 0 0 auto;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.earn-nav-tab-active .earn-nav-tab-icon {
  transform: scale(1.05);
}

.earn-nav-tab-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.01em;
  white-space: nowrap;
  transition: font-weight 0.2s ease;
}

.earn-nav-tab-active .earn-nav-tab-label {
  font-weight: 700;
}

/* Respect the user's motion preference: static active indicator, no
   press or icon animations. */
@media (prefers-reduced-motion: reduce) {
  .earn-nav-tab,
  .earn-nav-tab-pill,
  .earn-nav-tab-icon,
  .earn-nav-tab-label {
    transition: none;
  }
  .earn-nav-tab:active {
    transform: none;
  }
}
</style>
