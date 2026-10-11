<!--
  Shown while the identity in use changes. A switch saves the outgoing
  identity's contacts and loads the incoming one's, which can take a few
  seconds on a slow connection, so the person sees who they are becoming
  and what is happening instead of a frozen list. Not dismissable: the
  change is already under way and finishes on its own.
-->
<template>
  <q-dialog :model-value="!!target" persistent no-esc-dismiss no-backdrop-dismiss transition-show="scale" transition-hide="fade">
    <q-card class="switching-card" role="status" aria-live="polite">
      <span class="switching-ring" aria-hidden="true">
        <span class="switching-avatar">
          <img v-if="target?.picture && !pictureBroken" :src="target.picture" alt="" @error="pictureBroken = true" />
          <Icon v-else icon="tabler:user" width="32" height="32" />
        </span>
      </span>
      <strong class="switching-title">{{ $t('Switching to {name}', { name: target?.name || '' }) }}</strong>
      <p class="switching-body">{{ $t('Updating your card and contacts across BuhoGO.') }}</p>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps({
  /** The identity being switched to, or null when no switch is running. */
  target: { type: Object, default: null },
});

const pictureBroken = ref(false);
watch(() => props.target?.picture, () => { pictureBroken.value = false; });
</script>

<style scoped>
.switching-card { width: min(300px, calc(100vw - 48px)); padding: 30px 24px 26px; border-radius: 26px; background: var(--bg-card); color: var(--text-primary); text-align: center; box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.55); }

/* A ring that sweeps around the incoming identity's photo. */
.switching-ring { position: relative; width: 96px; height: 96px; margin: 0 auto 20px; display: grid; place-items: center; border-radius: 50%; }
.switching-ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, var(--brand-accent-text) 300deg, transparent 360deg); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px)); mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px)); animation: switching-spin 1s linear infinite; }
.switching-avatar { width: 80px; height: 80px; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); animation: switching-breathe 2s ease-in-out infinite; }
.switching-avatar img { width: 100%; height: 100%; object-fit: cover; }

.switching-title { display: block; overflow-wrap: anywhere; font-family: 'Manrope', sans-serif; font-size: 18px; font-weight: 750; letter-spacing: -0.02em; line-height: 1.3; }
.switching-body { margin: 8px 0 0; color: var(--text-secondary); font-size: 14px; line-height: 1.45; }

@keyframes switching-spin { to { transform: rotate(360deg); } }
@keyframes switching-breathe { 50% { transform: scale(0.96); } }

/* Motion off: a still ring, and the text carries the state. */
@media (prefers-reduced-motion: reduce) {
  .switching-ring::before, .switching-avatar { animation: none; }
}
</style>
