/**
 * v-balance-updating: a soft pulse on a balance the app is still loading
 * or confirming. The figure itself says so; there is no label beside it.
 *
 *   <div v-balance-updating="!view.known || view.stale">...</div>
 *
 * Put it on an element that stays mounted while the figure inside changes
 * (placeholder, then amount), so the pulse runs on without restarting.
 * Once the value is confirmed, the pulse eases back to full strength
 * from wherever it is instead of snapping. With reduced motion the figure
 * is dimmed instead of animated.
 */
const PULSE = {
  frames: [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }],
  timing: { duration: 1800, easing: 'ease-in-out', iterations: Infinity },
};
const DIMMED = {
  frames: [{ opacity: 0.6 }, { opacity: 0.6 }],
  timing: { duration: 1000, iterations: Infinity },
};
const SETTLE_MS = 250;

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function start(el) {
  if (el.__balancePulse || typeof el.animate !== 'function') return;
  const { frames, timing } = reducedMotion() ? DIMMED : PULSE;
  el.__balancePulse = el.animate(frames, timing);
}

function stop(el) {
  const pulse = el.__balancePulse;
  if (!pulse) return;
  el.__balancePulse = null;
  const from = Number(getComputedStyle(el).opacity);
  pulse.cancel();
  if (from < 1) el.animate([{ opacity: from }, { opacity: 1 }], { duration: SETTLE_MS, easing: 'ease-out' });
}

export default {
  mounted(el, { value }) {
    if (value) start(el);
  },
  updated(el, { value }) {
    if (value) start(el);
    else stop(el);
  },
  unmounted(el) {
    el.__balancePulse?.cancel();
    el.__balancePulse = null;
  },
};
