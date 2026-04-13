<template>
  <div class="earn-nav" :class="$q.dark.isActive ? 'earn-nav-dark' : 'earn-nav-light'">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="earn-nav-tab"
      :class="{ 'earn-nav-tab-active': activeTab === tab.id }"
      @click="navigate(tab)"
    >
      <Icon :icon="tab.icon" width="22" height="22" />
      <span>{{ $t(tab.label) }}</span>
    </button>
  </div>
</template>

<script>
export default {
  name: 'EarnBottomNav',
  props: {
    activeTab: {
      type: String,
      default: 'learn'
    }
  },
  data() {
    return {
      tabs: [
        { id: 'wallet', icon: 'tabler:wallet', label: 'Wallet', route: '/wallet' },
        { id: 'learn', icon: 'tabler:school', label: 'Learn', route: '/learn' },
        { id: 'summary', icon: 'tabler:trophy', label: 'Summary', route: '/learn/summary' },
        { id: 'settings', icon: 'tabler:settings', label: 'Settings', route: '/settings' },
      ]
    }
  },
  methods: {
    navigate(tab) {
      if (this.$route.path === tab.route) return
      this.$router.push(tab.route)
    }
  }
}
</script>

<style scoped>
.earn-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 8px 0;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.earn-nav-dark {
  background: rgba(12, 12, 12, 0.9);
  border-top: 1px solid var(--border-card);
}

.earn-nav-light {
  background: rgba(255, 255, 255, 0.9);
  border-top: 1px solid #EBEBEB;
}

.earn-nav-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.2s ease;
}

.earn-nav-tab-active {
  color: var(--color-green, #15DE72);
}
</style>
