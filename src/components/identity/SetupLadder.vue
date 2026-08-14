<template>
  <!--
    Setup ladder.

    Replaces the amber warning dot the old surface used. Three differences
    that matter:

      - It starts with a step already done, because a list that has started
        gets finished far more often than one that has not.
      - It retitles itself to "One thing left" on the last step, which is more
        persuasive than a counter.
      - It disappears for good when complete, and the space it occupied
        becomes the people you actually pay.

    It never blocks anything. On the halfway screen it sits below the three
    verbs, because the card already works and setup must not stand in front
    of the thing the user opened the app to do.
  -->
  <div class="ladder">
    <div class="ladder-head">
      <div class="ladder-title">{{ title }}</div>
      <span class="ladder-count">{{ $t('{done} of {total}', { done, total }) }}</span>
    </div>

    <button
      v-for="step in steps"
      :key="step.id"
      type="button"
      class="ladder-step"
      :class="{ 'ladder-step--done': step.done }"
      :disabled="step.done || !step.route"
      @click="step.route ? $router.push(step.route) : null"
    >
      <span class="ladder-tick">
        <Icon v-if="step.done" icon="tabler:check" width="13" height="13" />
      </span>
      <span class="ladder-label">{{ $t(step.label) }}</span>
      <Icon
        v-if="!step.done && step.route"
        icon="tabler:chevron-right"
        width="16"
        height="16"
        class="ladder-chev"
      />
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'SetupLadder',

  components: { Icon },

  props: {
    steps: { type: Array, required: true },
    done: { type: Number, required: true },
    total: { type: Number, required: true },
  },

  computed: {
    title() {
      return this.total - this.done === 1
        ? this.$t('One thing left')
        : this.$t('Make it yours');
    },
  },
};
</script>

<style scoped>
.ladder {
  margin-top: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 18px;
  overflow: hidden;
}

.ladder-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 8px;
}

.ladder-title {
  flex: 1;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.ladder-count {
  font-size: 11.5px;
  font-weight: 650;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-secondary);
}

.ladder-step {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  min-height: 52px;
  text-align: left;
  background: transparent;
  border: 0;
  border-top: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
}

.ladder-step:disabled { cursor: default; }
.ladder-step:not(:disabled):active { background: rgba(127, 127, 127, 0.08); }

.ladder-tick {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.7px solid var(--border-card);
  display: grid;
  place-items: center;
  color: transparent;
  flex: 0 0 auto;
}

.ladder-step--done .ladder-tick {
  background: var(--brand-accent);
  border-color: var(--brand-accent);
  color: #fff;
}

.ladder-label {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ladder-step--done .ladder-label { color: var(--text-muted); }

.ladder-chev { color: var(--text-muted); }
</style>
