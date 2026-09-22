<template>
  <div
    ref="card" class="app-toast" :class="[{ 'app-toast--dragging': dragging, 'app-toast--leaving': leaving }, colorClass, toast.config.classes]"
    :style="motionStyle" :data-toast-id="toast.id"
    @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
    @pointercancel="cancelPointer" @lostpointercapture="lostCapture"
    @pointerenter="pointerEnter" @pointerleave="pointerLeave"
    @focusin="focusIn" @focusout="focusOut"
    @click.capture="captureClick" @keydown.esc.stop.prevent="dismiss"
  >
    <div class="app-toast__row">
      <span v-if="toast.config.spinner || icon" class="app-toast__symbol" aria-hidden="true">
        <q-spinner v-if="toast.config.spinner" size="20px" />
        <Icon v-else-if="icon.includes(':')" :icon="icon" width="20" height="20" />
        <q-icon v-else :name="icon" size="20px" />
      </span>
      <img v-else-if="toast.config.avatar" :src="toast.config.avatar" class="app-toast__avatar" alt="" draggable="false" />
      <div class="app-toast__copy">
        <div :id="`toast-copy-${toast.id}`" :role="toast.config.type === 'negative' ? 'alert' : 'status'" aria-atomic="true">
          <div class="app-toast__message">{{ toast.config.message }}</div>
          <div v-if="toast.config.caption" class="app-toast__caption">{{ toast.config.caption }}</div>
        </div>
        <!-- A real button supplies the tap/keyboard/VoiceOver alternative.
             It overlays only the message, never the separate action buttons. -->
        <button v-if="simple" type="button" class="app-toast__tap-dismiss" :aria-label="$t('Dismiss')" :aria-describedby="`toast-copy-${toast.id}`" @click="dismiss" />
      </div>
      <span v-if="toast.count > 1" class="app-toast__count" :aria-label="`${toast.count}`">{{ toast.count }}</span>
    </div>
    <div v-if="!simple" class="app-toast__actions">
      <button type="button" class="app-toast__dismiss" :aria-describedby="`toast-copy-${toast.id}`" @click="dismiss">{{ dismissLabel }}</button>
      <button v-for="(action, index) in toast.config.actions" :key="index" type="button"
        :disabled="action.disable || action.disabled || action.loading"
        :aria-label="action['aria-label'] || action.label || $t('Open')"
        @click="$emit('action', index)">
        <Icon v-if="action.icon?.includes(':')" :icon="action.icon" width="18" height="18" />
        <q-icon v-else-if="action.icon" :name="action.icon" size="18px" />
        <span v-if="action.label">{{ action.label }}</span>
      </button>
    </div>
    <div v-if="toast.duration && toast.config.progress" class="app-toast__progress" aria-hidden="true">
      <span :key="toast.revision" :style="progressStyle" />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { i18n } from '../../boot/i18n.js';

const props = defineProps({ toast: { type: Object, required: true } });
const emit = defineEmits(['dismiss', 'pause', 'resume', 'action']);
const card = ref(null), dx = ref(0), dragging = ref(false), leaving = ref(false);
let pointer = null, leaveTimer = null, suppressUntil = 0, returnFocus = null;
const simple = computed(() => props.toast.duration > 0 && !props.toast.config.actions.length && !props.toast.config.closeBtn);
const dismissLabel = computed(() => typeof props.toast.config.closeBtn === 'string' ? props.toast.config.closeBtn : i18n.global.t('Dismiss'));
const icon = computed(() => props.toast.config.icon === 'las la-exclamation-triangle' ? 'warning' : (props.toast.config.icon || ''));
const colorClass = computed(() => `app-toast--${props.toast.config.color || props.toast.config.type || 'neutral'}`);
const motionStyle = computed(() => ({ '--toast-x': `${dx.value}px`, '--toast-opacity': leaving.value ? 0 : Math.max(0.45, 1 - Math.abs(dx.value) / 420) }));
const progressStyle = computed(() => ({ animationDuration: `${props.toast.duration}ms`, animationPlayState: props.toast.running ? 'running' : 'paused' }));
const pause = reason => emit('pause', reason);
const resume = reason => emit('resume', reason);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function dismiss() {
  if (leaving.value) return;
  leaving.value = true;
  emit('dismiss');
}
function pointerDown(event) {
  if (!event.isPrimary || event.button !== 0 || leaving.value || pointer) return;
  // A new deliberate tap is not the compatibility click from the last drag.
  suppressUntil = 0;
  // Controls pause the timer too, but never start a dismissal gesture.
  const control = event.target.closest('.app-toast__actions, .app-toast__dismiss');
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: control ? 'control' : null, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0 };
  pause('pointer');
  // Capture only after horizontal intent; capturing here steals taps from
  // the message's native button and interferes with vertical scrolling.
  window.addEventListener('pointerup', windowEnd);
  window.addEventListener('pointercancel', windowEnd);
}
function pointerMove(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
  if (!pointer.axis) {
    if (Math.max(Math.abs(x), Math.abs(y)) < 10) return;
    pointer.axis = Math.abs(x) > Math.abs(y) * 1.2 ? 'horizontal' : 'vertical';
    if (pointer.axis === 'horizontal') {
      dragging.value = true;
      card.value.setPointerCapture(event.pointerId);
    }
  }
  if (pointer.axis !== 'horizontal') return;
  const elapsed = event.timeStamp - pointer.lastTime;
  if (elapsed > 0) pointer.velocity = (event.clientX - pointer.lastX) / elapsed;
  pointer.lastX = event.clientX;
  pointer.lastTime = event.timeStamp;
  dx.value = x;
  event.preventDefault();
}
function clearPointer() {
  const id = pointer?.id;
  pointer = null;
  window.removeEventListener('pointerup', windowEnd);
  window.removeEventListener('pointercancel', windowEnd);
  if (id !== undefined && card.value?.hasPointerCapture(id)) card.value.releasePointerCapture(id);
  dragging.value = false;
}
function end(event, cancelled) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const horizontal = pointer.axis === 'horizontal';
  const distance = Math.abs(dx.value);
  const threshold = Math.max(56, (card.value?.offsetWidth || 300) * 0.25);
  const flick = event.timeStamp - pointer.lastTime < 100 && Math.abs(pointer.velocity) > 0.65 && distance > 32;
  const shouldDismiss = !cancelled && horizontal && (distance >= threshold || flick);
  if (pointer.axis === 'horizontal' || pointer.axis === 'vertical') suppressUntil = performance.now() + 400;
  clearPointer();
  if (shouldDismiss) {
    leaving.value = true;
    dx.value = Math.sign(dx.value) * (window.innerWidth + 40);
    // Keep the timer paused through the exit; dismissal stays exactly once.
    leaveTimer = setTimeout(() => emit('dismiss'), reducedMotion() ? 0 : 160);
  } else {
    dx.value = 0;
    resume('pointer');
  }
}
const pointerUp = event => end(event, false);
const cancelPointer = event => end(event, true);
// Touch starts with implicit capture on the message button. Moving capture
// to the card emits a bubbled loss from that button; it is not cancellation.
const lostCapture = event => { if (event.target === card.value) end(event, true); };
const windowEnd = event => end(event, event.type === 'pointercancel');
function captureClick(event) {
  if (event.detail > 0 && performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
}
function pointerEnter(event) { if (event.pointerType === 'mouse') pause('hover'); }
function pointerLeave(event) { if (event.pointerType === 'mouse') resume('hover'); }
function focusIn(event) {
  if (!card.value?.contains(event.relatedTarget)) returnFocus = event.relatedTarget;
  pause('focus');
}
function focusOut() { nextTick(() => { if (!card.value?.contains(document.activeElement)) resume('focus'); }); }
// Grouped replacements keep the card and any active gesture. An update must
// never reset pointer ownership or accidentally call the previous action.
watch(() => props.toast.id, () => { clearPointer(); dx.value = 0; });
onBeforeUnmount(() => {
  clearPointer(); clearTimeout(leaveTimer);
  if (card.value?.contains(document.activeElement) && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
});
</script>

<style scoped>
.app-toast { --toast-accent: #56616e; --toast-tint: #eef0f3; position: relative; width: max-content; max-width: min(440px, calc(100vw - 32px)); min-width: 180px; padding: 8px 14px; border: 1px solid #deddd7; border-radius: 16px; background: #fffefa; color: #202122; box-shadow: 0 4px 16px #24231f24, 0 1px 3px #24231f14; font: 600 .875rem/1.45 'Manrope', sans-serif; pointer-events: auto; touch-action: pan-y pinch-zoom; transform: translateX(var(--toast-x)); opacity: var(--toast-opacity); transition: transform 160ms ease-out, opacity 160ms ease-out; user-select: none; overflow: hidden; }
body.body--dark .app-toast { --toast-accent: #bec8d5; --toast-tint: #394049; background: #2a2b2d; color: #fafafa; border-color: #535456; box-shadow: 0 4px 16px #0006, 0 1px 3px #0004; }
.app-toast--dragging { transition: none; }
.app-toast__row { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.app-toast__symbol { flex: 0 0 30px; width: 30px; height: 30px; align-self: flex-start; margin-top: 7px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--toast-accent); background: var(--toast-tint); }
.app-toast--positive, .app-toast--accent { --toast-accent: #007b59; --toast-tint: #e2f5eb; }
.app-toast--negative { --toast-accent: #bc303b; --toast-tint: #ffe9eb; }
.app-toast--warning { --toast-accent: #965300; --toast-tint: #fff0d7; }
.app-toast--info { --toast-accent: #236ba6; --toast-tint: #e7f1ff; }
body.body--dark .app-toast--positive, body.body--dark .app-toast--accent { --toast-accent: #70e4b5; --toast-tint: #224c3e; }
body.body--dark .app-toast--negative { --toast-accent: #ff9da4; --toast-tint: #583039; }
body.body--dark .app-toast--warning { --toast-accent: #ffd08a; --toast-tint: #55422b; }
body.body--dark .app-toast--info { --toast-accent: #9ccbff; --toast-tint: #2d445e; }
.app-toast__avatar { width: 24px; height: 24px; border-radius: 50%; }
.app-toast__copy { flex: 1; min-width: 0; min-height: 44px; display: flex; flex-direction: column; justify-content: center; position: relative; padding: 5px 0; }
.app-toast__message, .app-toast__caption { overflow-wrap: anywhere; white-space: pre-line; }
.app-toast__caption { font-weight: 400; opacity: .8; margin-top: 2px; }
.app-toast button { font: inherit; color: inherit; background: transparent; border: 0; border-radius: 8px; cursor: pointer; min-height: 44px; min-width: 44px; }
.app-toast button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.app-toast button:active { background: #8882; }
.app-toast__tap-dismiss { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0 !important; }
.app-toast__dismiss { flex-shrink: 0; padding: 0 8px; }
.app-toast__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.app-toast__actions button { display: flex; gap: 6px; align-items: center; justify-content: center; padding: 0 12px; color: var(--toast-accent); }
.app-toast__actions .app-toast__dismiss { color: inherit; font-weight: 500; }
.app-toast button:disabled { opacity: .5; cursor: default; }
.app-toast__count { border-radius: 12px; padding: 2px 6px; background: #8882; font-size: 11px; }
.app-toast__progress { position: absolute; bottom: 0; left: 14px; right: 14px; height: 2px; opacity: .5; }
.app-toast__progress span { display: block; height: 100%; background: var(--toast-accent); transform-origin: left; animation: toast-countdown linear forwards; }
@keyframes toast-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .app-toast { transition: none; transform: none; } .app-toast__progress { display: none; } }
</style>
