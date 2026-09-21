<template>
  <button
    v-if="exit"
    type="button"
    class="exit-chip wallet-toolbar-status"
    :class="$q.dark.isActive ? 'exit-chip-dark' : 'exit-chip-light'"
    :aria-label="$t('Exit in progress')"
    @click="open"
  >
    <Icon icon="tabler:lifebuoy" width="14" height="14" />
    <span>{{ $t('Exit in progress') }}</span>
  </button>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useEmergencyExitStore } from '../../stores/emergencyExit';

/** Home toolbar chip while an exit runs: the way back to its page. */
export default {
  name: 'ExitProgressChip',
  components: { Icon },
  setup() { return { exits: useEmergencyExitStore() }; },
  computed: {
    exit() { return this.exits.activeExits[0] || null; },
  },
  methods: {
    open() { if (this.exit) this.$router.push(`/security/exit/${this.exit.walletId}`); },
  },
};
</script>

<style scoped>
.exit-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid transparent; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.exit-chip-light { background: rgba(5, 149, 115, 0.12); color: var(--brand-accent-text, #046B53); border-color: rgba(5, 149, 115, 0.2); }
.exit-chip-dark { background: rgba(21, 222, 114, 0.14); color: #15DE72; border-color: rgba(21, 222, 114, 0.22); }
</style>
