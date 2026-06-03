<!--
  ProgressCta
  Shared "filling" loading control for confirm / commit flows. Once the user
  has committed an action (tap a button or complete a slide-to-confirm), the
  parent swaps its CTA for this component, which:
    - trickles a fill from left → ~90% and holds while the work is in flight
      (honest indeterminate progress — we rarely know the real duration), then
    - snaps to 100% + a checkmark the moment `done` flips true,
  giving a clean bridge into the success screen that follows.

  Purely presentational and self-contained: the parent decides WHEN it mounts
  (work started) and WHEN `done` becomes true (work succeeded). Brand colours
  mirror the primary CTA — black in light mode, green in dark mode.

  Reusable across every confirm surface (Lightning send, LNURL-withdraw,
  on-chain, …) — not Lightning-specific.
-->
<template>
  <div
    class="progress-cta"
    :class="{ 'progress-cta--tall': tall, 'progress-cta--done': done }"
    role="status"
    aria-live="polite"
  >
    <div class="progress-cta-fill" :style="{ width: fillPct + '%' }"></div>

    <!-- Completed: a single centred check on the full fill. -->
    <span v-if="done" class="progress-cta-label progress-cta-label--solid">
      <Icon icon="tabler:check" width="22" height="22" />
    </span>

    <!-- In flight: a two-tone label that reads on both the muted track and the
         growing fill — the fill-coloured copy is clipped to the fill width so
         it always stays in sync with the bar. -->
    <template v-else>
      <span class="progress-cta-label progress-cta-label--track">{{ label }}</span>
      <span
        class="progress-cta-label progress-cta-label--solid"
        :style="{ clipPath: `inset(0 ${100 - fillPct}% 0 0)` }"
      >{{ label }}</span>
    </template>
  </div>
</template>

<script>
export default {
  name: 'ProgressCta',
  props: {
    /** In-flight label, e.g. "Sending…". Hidden once `done`. */
    label: { type: String, default: '' },
    /** Flip true when the work succeeded → snap fill to 100% + checkmark. */
    done: { type: Boolean, default: false },
    /**
     * Match the height of the control being replaced: the slide-to-confirm
     * track (tall, 64px) or the tap button (default, 56px / 50px on mobile).
     */
    tall: { type: Boolean, default: false },
  },
  data() {
    return { fillPct: 0 };
  },
  watch: {
    done(complete) {
      this.fillPct = complete ? 100 : 85;
    },
  },
  mounted() {
    if (this.done) {
      this.fillPct = 100;
      return;
    }
    // Paint at 0 first, then creep steadily toward the ~85% cap. A looping
    // shimmer (CSS) keeps the bar visibly alive even after it reaches the cap,
    // so a longer wait never looks "stuck", and the leftover headroom makes
    // the snap to 100% on success feel snappy.
    requestAnimationFrame(() => {
      if (!this.done) this.fillPct = 85;
    });
  },
};
</script>

<style scoped>
.progress-cta {
  position: relative;
  width: 100%;
  height: 56px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.10); /* dark track */
  font-family: 'Manrope', sans-serif;
  isolation: isolate;
}
.body--light .progress-cta { background: rgba(17, 24, 39, 0.06); } /* light track */
.progress-cta--tall { height: 64px; }

.progress-cta-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  z-index: 0;
  overflow: hidden; /* clip the shimmer sweep to the filled area */
  background: var(--gradient-green); /* dark: brand green */
  transition: width 3s cubic-bezier(0.25, 0.7, 0.35, 1);
}
.body--light .progress-cta-fill { background: var(--btn-neutral-bg); } /* light: brand black */

/* Looping highlight sweep — keeps the bar visibly "working" while it holds at
   the cap, so a slow payment never reads as frozen. */
.progress-cta-fill::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
  transform: translateX(-100%);
  animation: cta-shimmer 1.3s ease-in-out infinite;
}

.progress-cta--done .progress-cta-fill {
  transition-duration: 0.34s;
  transition-timing-function: ease-out;
}
.progress-cta--done .progress-cta-fill::after { display: none; } /* settled — stop the sweep */

@keyframes cta-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.progress-cta-label {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  pointer-events: none;
}
.progress-cta-label--track { color: var(--text-primary); }
.progress-cta-label--solid {
  color: #fff;
  transition: clip-path 1.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.progress-cta--done .progress-cta-label--solid { transition-duration: 0.32s; }

@media (max-width: 480px) {
  .progress-cta:not(.progress-cta--tall) { height: 50px; }
}
</style>
