<!--
  Why the identity in use cannot change right now: a payment is being sent
  (stores/paymentFlow.js `paymentBeingSent`; the identity store refuses the
  change until that send has ended).

  One plain line with a small progress indicator, placed next to the control
  it explains. It follows the payment by itself: it appears when a send
  starts and goes the moment that send has ended, when the control is
  available again, without the person leaving the screen.

  Announced once, when it appears: the region is always there and only its
  text comes and goes, which is what a screen reader listens for. Motion
  off: a still mark, and the text carries the state.
-->
<template>
  <div role="status" aria-live="polite">
    <p v-if="flow.paymentBeingSent" class="identity-waits">
      <q-spinner class="identity-waits-mark" size="16px" aria-hidden="true" />
      <span>{{ $t('A Bitcoin payment is being sent. You can change your identity as soon as it has finished.') }}</span>
    </p>
  </div>
</template>

<script setup>
import { usePaymentFlowStore } from '../../stores/paymentFlow.js';

const flow = usePaymentFlowStore();
</script>

<style scoped>
.identity-waits { display: flex; align-items: flex-start; gap: 8px; margin: 8px 6px 0; color: var(--text-secondary); font-size: 13px; line-height: 1.45; text-align: left; overflow-wrap: anywhere; }
/* Level with the first line of the text, however far the text wraps. */
.identity-waits-mark { flex: 0 0 auto; margin-top: 1px; color: var(--brand-accent-text); }
/* The spinner turns as a whole and its arc grows and shrinks: both stop, and a part of the ring stays drawn. */
@media (prefers-reduced-motion: reduce) {
  .identity-waits-mark, .identity-waits-mark :deep(.path) { animation: none; }
  .identity-waits-mark :deep(.path) { stroke-dasharray: 89, 200; }
}
</style>
