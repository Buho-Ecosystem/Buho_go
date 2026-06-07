<template>
  <!--
    Standalone success-checkmark primitive.

    Shared across every "operation succeeded" surface so a sent
    payment, a received payment, a withdrawn voucher, a completed
    batch, and a completed internal transfer all open with the same
    visual moment. Lifting this out of PaymentConfirmation lets
    surfaces with custom content (batch summary, transfer route)
    reuse the animation without inheriting the whole confirmation
    modal.

    Behaviour:
      - `animate` controls when the entrance sequence runs. Callers
        that mount the component eagerly (e.g. inside an always-
        rendered card) flip this to `true` only when their success
        state becomes truthy. Callers that mount lazily (v-if on
        open) can leave it `true` (default).
      - `accent` swaps the fill + pulse color between green
        (default) and Bitcoin orange (used for L1 / partial-failure
        surfaces).

    Accessibility: the SVG is decorative. The surface around it is
    expected to carry the meaningful title ("Payment Sent",
    "Batch Complete", …) which screen readers announce.
  -->
  <div class="success-checkmark" :class="{ 'animate': animate }">
    <div
      class="success-circle"
      :class="accent === 'orange' ? 'bitcoin-theme' : ''"
    >
      <svg class="checkmark" viewBox="0 0 52 52" aria-hidden="true">
        <path
          class="checkmark-check"
          fill="none"
          d="M14.1 27.2l7.1 7.2 16.7-16.8"
        />
      </svg>
    </div>
    <div
      v-if="animate"
      class="pulse-ring-once"
      :class="accent === 'orange' ? 'bitcoin-pulse' : ''"
      aria-hidden="true"
    ></div>
  </div>
</template>

<script>
export default {
  name: 'SuccessCheckmark',
  props: {
    /**
     * When true, the entrance sequence plays (zoom-in + stroke
     * draw + one-shot pulse). When false the checkmark sits idle —
     * useful for placeholders or for surfaces that want to control
     * the moment animation kicks off.
     */
    animate: {
      type: Boolean,
      default: true
    },
    /**
     * Accent palette. `green` is the default "everything worked"
     * tone; `orange` (Bitcoin) is for L1 surfaces and for batch
     * results that include any failure (so the icon itself signals
     * the partial outcome).
     */
    accent: {
      type: String,
      default: 'green',
      validator: (v) => v === 'green' || v === 'orange'
    }
  }
}
</script>

<style scoped>
.success-checkmark {
  position: relative;
  width: 110px;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.success-checkmark.animate {
  animation: success-checkmark-zoom-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

@keyframes success-checkmark-zoom-in {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  60% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.success-circle {
  width: 110px;
  height: 110px;
  background: #15DE72;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-circle.bitcoin-theme {
  background: #F7931A;
}

.checkmark {
  width: 52px;
  height: 52px;
}

.checkmark-check {
  stroke: white;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  /*
    Stroke draw is gated by the parent's `animate` class so the
    line only appears once the zoom-in begins. Idle (animate=false)
    leaves the checkmark unstroked — visually consistent with a
    pre-success placeholder.
  */
  animation: none;
}

.success-checkmark.animate .checkmark-check {
  animation: success-checkmark-stroke 0.32s cubic-bezier(0.65, 0, 0.45, 1) 0.18s forwards;
}

@keyframes success-checkmark-stroke {
  100% {
    stroke-dashoffset: 0;
  }
}

/* One-shot pulse ring (fires once on mount, then gone). */
.pulse-ring-once {
  position: absolute;
  width: 110px;
  height: 110px;
  border: 2px solid rgba(21, 222, 114, 0.45);
  border-radius: 50%;
  animation: success-checkmark-pulse 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  pointer-events: none;
}

.pulse-ring-once.bitcoin-pulse {
  border-color: rgba(247, 147, 26, 0.45);
}

@keyframes success-checkmark-pulse {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}
</style>
