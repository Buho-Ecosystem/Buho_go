<!--
  SlideToSend
  Drag-to-confirm control used on the payment confirm step for amounts at or
  above the high-value threshold. Pointer-driven (works for touch + mouse +
  pen) with rAF-tweened snap-back so a half-drag doesn't twitch.

  Emits `complete` once the thumb crosses the trigger threshold (0.92 of the
  track). The parent is expected to either close the modal on success or
  call `reset()` (exposed via defineExpose) on failure to return the thumb
  to the start.
-->
<template>
  <div
    ref="trackEl"
    class="slide-track"
    :class="[
      themeClass,
      { 'slide-track--completed': completed, 'slide-track--disabled': disabled || loading }
    ]"
  >
    <div class="slide-fill" :style="{ width: progressPct + '%' }"></div>

    <div class="slide-label" :class="{ 'slide-label--fade': progressPct > 30 }">
      <template v-if="loading">
        <q-spinner-dots size="22px" />
      </template>
      <template v-else>
        <span>{{ label }}</span>
        <Icon icon="tabler:chevrons-right" width="16" height="16" class="slide-label-chev" />
      </template>
    </div>

    <div
      class="slide-thumb"
      :style="{ transform: `translateX(${thumbPx}px)` }"
      @pointerdown="onPointerDown"
    >
      <Icon
        v-if="completed"
        icon="tabler:check"
        width="22"
        height="22"
      />
      <Icon
        v-else
        icon="tabler:chevron-right"
        width="22"
        height="22"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';

const props = defineProps({
  label: { type: String, default: 'Slide to send' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(['complete']);

const $q = useQuasar();
const themeClass = computed(() => $q.dark.isActive ? 'slide-dark' : 'slide-light');

const trackEl = ref(null);
const thumbPx = ref(0);
const completed = ref(false);
const dragging = ref(false);

// Captured at gesture start so resize/reflows mid-drag don't desync the math.
let pointerOffset = 0;
let maxX = 0;
let rafSnap = 0;

const THUMB_WIDTH = 56;
const TRACK_INSET = 4; // matches CSS padding on each side

const progressPct = computed(() => {
  if (!maxX) return 0;
  return Math.min(100, (thumbPx.value / maxX) * 100);
});

function computeMaxX() {
  if (!trackEl.value) return 0;
  return trackEl.value.clientWidth - THUMB_WIDTH - TRACK_INSET * 2;
}

function onPointerDown(e) {
  if (props.disabled || props.loading || completed.value) return;
  cancelAnimationFrame(rafSnap);
  dragging.value = true;
  maxX = computeMaxX();
  pointerOffset = e.clientX - thumbPx.value;
  e.target.setPointerCapture?.(e.pointerId);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerUp, { once: true });
}

function onPointerMove(e) {
  if (!dragging.value) return;
  const x = Math.max(0, Math.min(maxX, e.clientX - pointerOffset));
  thumbPx.value = x;
}

function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  window.removeEventListener('pointermove', onPointerMove);

  if (maxX > 0 && thumbPx.value >= maxX * 0.92) {
    thumbPx.value = maxX;
    completed.value = true;
    emit('complete');
  } else {
    snapBack();
  }
}

function snapBack() {
  const start = thumbPx.value;
  const startTime = performance.now();
  const duration = 240;
  cancelAnimationFrame(rafSnap);
  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    thumbPx.value = start * (1 - ease);
    if (t < 1) rafSnap = requestAnimationFrame(tick);
  };
  rafSnap = requestAnimationFrame(tick);
}

function reset() {
  completed.value = false;
  snapBack();
}
defineExpose({ reset });

onBeforeUnmount(() => {
  cancelAnimationFrame(rafSnap);
  window.removeEventListener('pointermove', onPointerMove);
});
</script>

<style scoped>
.slide-track {
  position: relative;
  width: 100%;
  height: 64px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  user-select: none;
  touch-action: none;
  padding: 4px;
  display: flex;
  align-items: center;
  isolation: isolate;
}

.slide-dark {
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.slide-light {
  background: rgba(17, 24, 39, 0.05);
  box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.06);
}

.slide-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-pill);
  z-index: 0;
  background: linear-gradient(90deg, #059573 0%, #15DE72 60%, #78D53C 100%);
  /* No transition: the thumb sets width directly via the same drag tick,
     and any easing here makes the fill feel laggy behind the thumb. */
}

.slide-track--completed .slide-fill {
  background: linear-gradient(90deg, #059573 0%, #15DE72 100%);
}

.slide-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.18s ease;
}

.slide-dark .slide-label { color: #B0B0B0; }
.slide-light .slide-label { color: #5F5B52; }

.slide-label--fade { opacity: 0.35; }

.slide-label-chev {
  opacity: 0.55;
}

.slide-thumb {
  position: relative;
  z-index: 2;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #FFFFFF;
  color: #0C0C0C;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22),
              0 1px 3px rgba(0, 0, 0, 0.12);
  /* Drag uses transform; releasing animates via rAF so leaving a CSS
     transition here would fight the JS tween on snap-back. */
}

.slide-thumb:active {
  cursor: grabbing;
}

.slide-track--completed .slide-thumb {
  background: #fff;
  color: #059573;
}

.slide-track--disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
