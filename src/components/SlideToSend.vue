<!--
  SlideToSend
  Drag-to-confirm: the deliberate gesture in front of a payment. Same
  contract for every caller: emits `complete` once, and the parent either
  moves on or calls `reset()` (exposed) to bring the thumb home.

  How it behaves (Apple HIG: gestures, feedback, haptics, accessibility):
    - The label shimmers at rest so it reads as "drag me". It fades and
      drifts as the thumb passes over it.
    - The fill follows the finger with no lag, then fills the whole track
      on completion while the thumb turns into a check.
    - Near the end the thumb "arms" with a detent haptic: letting go there
      completes. A quick flick past halfway completes too. Anything short
      of that springs back from wherever the finger let go.
    - `lockAtEnd` puts a lock at the end of the track when a PIN follows
      the slide, so the next step is never a surprise.
    - `tone="receive"` uses the brand green for money coming in. Sends
      keep their own fill.
    - Keyboard and assistive technology: the control is a button. Enter,
      Space or a screen reader's activate gesture run the same slide, so
      nobody depends on dragging. Reduce Motion drops the shimmer and the
      springs.
-->
<template>
  <div
    ref="trackEl"
    class="slide-track"
    :class="[
      themeClass,
      `slide-track--${tone}`,
      { 'slide-track--completed': completed, 'slide-track--armed': armed, 'slide-track--disabled': disabled || loading, 'slide-track--dragging': dragging }
    ]"
    role="button"
    :tabindex="disabled || loading ? -1 : 0"
    :aria-label="label"
    :aria-disabled="disabled || loading ? 'true' : 'false'"
    @keydown.enter.prevent="completeByAction"
    @keydown.space.prevent="completeByAction"
    @click="onClick"
  >
    <div
      class="slide-fill"
      :class="{ 'slide-fill--completed': completed }"
      :style="{ width: fillPx + 'px' }"
    ></div>

    <div
      class="slide-label"
      :style="labelStyle"
    >
      <q-spinner-dots v-if="loading" size="22px" />
      <span v-else class="slide-label-text" :class="{ 'slide-label-text--shimmer': shimmer }">{{ label }}</span>
    </div>

    <span v-if="lockAtEnd && !completed" class="slide-end" :style="{ opacity: endOpacity }" aria-hidden="true">
      <Icon icon="tabler:lock" width="18" height="18" />
    </span>

    <div
      class="slide-thumb"
      :style="{ transform: `translateX(${thumbPx}px) scale(${armed && !completed ? 1.06 : 1})` }"
      aria-hidden="true"
      @pointerdown="onPointerDown"
    >
      <transition name="slide-glyph" mode="out-in">
        <Icon v-if="completed" key="done" icon="tabler:check" width="24" height="24" />
        <svg v-else key="go" class="slide-chevrons" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 7l5 5-5 5" opacity="0.45" />
          <path d="M12 7l5 5-5 5" />
        </svg>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';
import { haptics } from '../utils/haptics.js';

const props = defineProps({
  label: { type: String, default: 'Slide to send' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  /** 'send' (money leaves) or 'receive' (money comes in: brand green). */
  tone: { type: String, default: 'send', validator: (v) => ['send', 'receive'].includes(v) },
  /** A PIN follows the slide: show a lock where the thumb is headed. */
  lockAtEnd: { type: Boolean, default: false },
});
const emit = defineEmits(['complete']);

const $q = useQuasar();
const themeClass = computed(() => $q.dark.isActive ? 'slide-dark' : 'slide-light');
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const trackEl = ref(null);
const thumbPx = ref(0);
const completed = ref(false);
const dragging = ref(false);
const armed = ref(false);

const THUMB_WIDTH = 56;
const TRACK_INSET = 4; // matches the CSS padding on each side
const ARM_AT = 0.9; // share of the travel where letting go completes
const FLICK_FROM = 0.5; // a fast release past this share completes too
const FLICK_SPEED = 0.6; // px per ms

// Captured at gesture start so a reflow mid-drag cannot desync the math.
let pointerOffset = 0;
let maxX = 0;
let raf = 0;
let samples = [];

const travel = () => maxX || computeMaxX();
const progress = computed(() => {
  if (completed.value) return 1;
  const max = travel();
  return max > 0 ? Math.min(1, thumbPx.value / max) : 0;
});
// The fill reaches through the thumb's far edge, so it reads as the
// thumb's own trail.
const fillPx = computed(() => THUMB_WIDTH + thumbPx.value);
const shimmer = computed(() => !reducedMotion && !dragging.value && !completed.value && !props.disabled && thumbPx.value === 0);
const labelStyle = computed(() => ({
  opacity: completed.value ? 0 : Math.max(0, 1 - progress.value * 1.8),
  transform: `translateX(${Math.round(progress.value * 18)}px)`,
}));
const endOpacity = computed(() => 0.35 + progress.value * 0.65);

function computeMaxX() {
  if (!trackEl.value) return 0;
  return trackEl.value.clientWidth - THUMB_WIDTH - TRACK_INSET * 2;
}

function setThumb(x) {
  thumbPx.value = x;
  const isArmed = maxX > 0 && x >= maxX * ARM_AT;
  if (isArmed && !armed.value) haptics.medium();
  armed.value = isArmed;
}

function onPointerDown(e) {
  if (props.disabled || props.loading || completed.value) return;
  cancelAnimationFrame(raf);
  dragging.value = true;
  maxX = computeMaxX();
  pointerOffset = e.clientX - thumbPx.value;
  samples = [{ x: thumbPx.value, t: performance.now() }];
  e.target.setPointerCapture?.(e.pointerId);
  haptics.tap();
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerUp, { once: true });
}

function onPointerMove(e) {
  if (!dragging.value) return;
  const x = Math.max(0, Math.min(maxX, e.clientX - pointerOffset));
  setThumb(x);
  const now = performance.now();
  samples.push({ x, t: now });
  while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
}

/**
 * Release speed over the last ~90 ms, px per ms (positive = toward the
 * end). A finger that stopped before lifting did not flick: zero.
 */
function releaseSpeed() {
  if (samples.length < 2) return 0;
  const first = samples[0], last = samples[samples.length - 1];
  if (performance.now() - last.t > 60) return 0;
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  window.removeEventListener('pointermove', onPointerMove);
  const speed = releaseSpeed();
  const share = maxX > 0 ? thumbPx.value / maxX : 0;
  if (maxX > 0 && (share >= ARM_AT || (share >= FLICK_FROM && speed >= FLICK_SPEED))) {
    springTo(maxX, speed, finish);
  } else {
    springTo(0, speed);
  }
}

function finish() {
  if (completed.value) return;
  thumbPx.value = maxX;
  armed.value = false;
  completed.value = true;
  haptics.success();
  emit('complete');
}

/**
 * A critically damped spring from the current position (and the finger's
 * release speed) to `target`: fast, no wobble, no fixed duration.
 * Reduce Motion: jump.
 */
function springTo(target, velocity = 0, done) {
  cancelAnimationFrame(raf);
  if (reducedMotion) { setThumb(target); done?.(); return; }
  const stiffness = 0.0009; // per ms²
  const damping = 2 * Math.sqrt(stiffness);
  let x = thumbPx.value;
  let v = velocity;
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    const a = -stiffness * (x - target) - damping * v;
    v += a * dt;
    x += v * dt;
    x = Math.max(0, Math.min(maxX || travel(), x));
    setThumb(x);
    if (Math.abs(x - target) < 0.5 && Math.abs(v) < 0.02) {
      setThumb(target);
      done?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Keyboard and assistive technology: the same slide, run for them. */
function completeByAction() {
  if (props.disabled || props.loading || completed.value || dragging.value) return;
  maxX = computeMaxX();
  if (maxX <= 0) return;
  springTo(maxX, 1.2, finish);
}

// A screen reader's activate gesture arrives as a click with no pointer
// behind it (detail 0). A finger's tap on the track is not a slide.
function onClick(e) {
  if (e.detail === 0) completeByAction();
}

function reset() {
  completed.value = false;
  armed.value = false;
  maxX = computeMaxX();
  springTo(0);
}
defineExpose({ reset });

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
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
  outline: none;
}
.slide-track:focus-visible { box-shadow: 0 0 0 3px var(--brand-accent, #059573) !important; }

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
  left: 4px;
  top: 4px;
  bottom: 4px;
  border-radius: var(--radius-pill);
  z-index: 0;
  background: linear-gradient(90deg, #1D4ED8 0%, #3B82F6 100%);
  /* No transition while dragging: the fill moves in the same tick as the
     thumb; easing here would make it trail behind the finger. */
}
.slide-light .slide-fill { background: #1A1A1C; }
.slide-track--receive .slide-fill,
.slide-light.slide-track--receive .slide-fill { background: var(--gradient-green, linear-gradient(90deg, #059573 0%, #78D53C 100%)); }

/* On completion the fill reaches the pill's edge, so it reads finished. */
.slide-fill--completed {
  inset: 0;
  width: auto !important;
  transition: inset 0.2s ease;
}
.slide-track--completed { animation: slide-done 0.6s ease-out; }

.slide-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 52px 0 64px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  pointer-events: none;
  z-index: 1;
  white-space: nowrap;
}
.slide-label-text { overflow: hidden; text-overflow: ellipsis; }
.slide-dark .slide-label { color: #E2E8F0; }
.slide-light .slide-label { color: #3C3A35; }

/* The shimmer: a band of light sweeping across the words. */
.slide-label-text--shimmer {
  background-image: linear-gradient(100deg, currentColor 0%, currentColor 40%, var(--slide-shine) 50%, currentColor 60%, currentColor 100%);
  background-size: 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: slide-shimmer 2.8s linear infinite;
}
.slide-dark { --slide-shine: #FFFFFF; }
.slide-light { --slide-shine: #A8A296; }

.slide-end {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.slide-dark .slide-end { color: #E2E8F0; }
.slide-light .slide-end { color: #3C3A35; }
.slide-track--armed .slide-end { color: #FFFFFF; }

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
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.12);
  will-change: transform;
  /* Position comes from the drag and the spring; only the arming scale eases. */
  transition: box-shadow 0.2s ease;
}
.slide-thumb:active { cursor: grabbing; }
.slide-track--receive .slide-thumb { color: #059573; }
.slide-track--armed .slide-thumb { box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.22), 0 6px 16px rgba(0, 0, 0, 0.25); }
.slide-track--completed .slide-thumb { color: #059573; }

.slide-chevrons { width: 24px; height: 24px; }
/* At rest the chevrons lean toward the end now and then: the way to go. */
.slide-track:not(.slide-track--dragging):not(.slide-track--disabled) .slide-chevrons { animation: slide-nudge 2.8s ease-in-out infinite; }

.slide-glyph-enter-active, .slide-glyph-leave-active { transition: transform 0.18s ease, opacity 0.18s ease; }
.slide-glyph-enter-from { transform: scale(0.4) rotate(-30deg); opacity: 0; }
.slide-glyph-leave-to { transform: scale(0.6); opacity: 0; }

.slide-track--disabled {
  opacity: 0.45;
  pointer-events: none;
}

@keyframes slide-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@keyframes slide-nudge { 0%, 70%, 100% { transform: translateX(0); } 80% { transform: translateX(4px); } 90% { transform: translateX(0); } }
@keyframes slide-done { 0% { box-shadow: 0 0 0 0 rgba(21, 222, 114, 0.35); } 100% { box-shadow: 0 0 0 14px rgba(21, 222, 114, 0); } }

@media (prefers-reduced-motion: reduce) {
  .slide-label-text--shimmer, .slide-chevrons, .slide-track--completed { animation: none !important; }
  .slide-label-text--shimmer { -webkit-text-fill-color: currentColor; background-image: none; }
}
</style>
