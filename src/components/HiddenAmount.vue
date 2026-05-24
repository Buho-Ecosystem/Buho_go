<template>
  <!--
    Privacy gate for any balance / aggregate display.

    Wraps the formatted amount in a tiny span that swaps to a
    fixed-length bullet placeholder (`••••`) when the wallet
    store's `balanceHidden` flag is true. Reads the store directly
    so callers don't have to wire a prop chain through every
    parent — drop this around the amount and it does the right
    thing globally.

    Do NOT use for per-payment amounts inside action flows (send,
    receive, payment confirmation). Those are scoped to a specific
    action the user is actively taking; hiding them would break
    the flow ("you're about to send ••••?").
  -->
  <span class="hidden-amount">
    <span v-if="hidden" class="hidden-amount-placeholder">••••</span>
    <slot v-else />
  </span>
</template>

<script>
import { useWalletStore } from '../stores/wallet';

export default {
  name: 'HiddenAmount',
  setup() {
    const wallet = useWalletStore();
    return { wallet };
  },
  computed: {
    hidden() {
      return this.wallet.balanceHidden === true;
    },
  },
};
</script>

<style scoped>
.hidden-amount {
  /* Inherit colour / font from the parent so the placeholder reads
     as a styled substitution, not a separate widget. */
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
}

.hidden-amount-placeholder {
  /* Slightly heavier letter-spacing so the bullets look like
     intentional "redacted" glyphs rather than a typo. */
  letter-spacing: 0.18em;
  font-feature-settings: 'tnum';
}
</style>
